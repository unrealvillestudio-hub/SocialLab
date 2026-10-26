/**
 * SocialLab — /api/comments · Bandeja de comentarios del operador (SignalLab Fase 3, 2026-10-25).
 *
 *   GET  ?marca=&desde=&hasta=   los comentarios de las marcas del alcance, leídos de
 *                                `content.post_comments` (los escribe el colector de SignalLab), con
 *                                su estado; lo que espera respuesta va primero
 *   POST { post_comment_id, message, privada? }
 *                                responde un comentario desde la cuenta de la marca:
 *                                1. asienta la respuesta en `content.comment_replies` como `requested`,
 *                                   con quién la pidió (`sub` de la sesión) y desde qué cuenta;
 *                                2. llama la herramienta de respuesta del MCP de Meta
 *                                   (`intel.signal_platforms.reply_tool`) → `sent`;
 *                                3. la vuelve a leer (`comment_read_tool`) → `verified` sólo si la
 *                                   plataforma devuelve el mismo id. Si no, queda `sent` con el motivo.
 *                                Un fallo de la plataforma queda `failed` con el error: nada se pierde
 *                                en silencio.
 *                                Con `privada: true` (2026-10-25) responde en privado a quien comentó, con
 *                                `private_reply_tool` y `message_read_tool`: una vez por comentario y dentro
 *                                de `private_reply_window_minutes`. El GET dice, por comentario, si se puede
 *                                (`privada.puede`) y, si no, por qué (`privada.motivo`).
 *   POST { tipo: 'cierre', post_comment_id, kind }
 *                                cierra el comentario sin responderlo (Sam, 2026-10-26): `kind` ∈ hecho | descartado |
 *                                contestado_fuera. Sale de la bandeja y el asesor no lo vuelve a proponer. El GET trae
 *                                `cierre` por comentario y su estado pasa a `cerrado`.
 *   POST { tipo: 'reabrir', post_comment_id }   deshace el cierre.
 *                                Responder o cerrar caduca las recomendaciones abiertas de ese comentario.
 *   POST { tipo: 'allegado', post_comment_id, relation }   (Sam, 2026-10-26)
 *                                marca a quien escribió ese comentario como cuenta del equipo o allegada de la marca
 *                                (`relation` ∈ equipo | allegado): sus comentarios dejan de esperar respuesta (estado
 *                                `allegado`) y el asesor no los considera. El GET trae `allegado` por comentario.
 *   POST { tipo: 'quitar_allegado', post_comment_id }      deshace la marca.
 *   POST { tipo: 'comentar', scheduled_post_id, message, recomendacion_id? }
 *                                publica un comentario de la marca en SU publicación (Sam, 2026-10-26): abrir un debate,
 *                                mencionar a un aliado. La herramienta es dato (`signal_platforms.post_comment_tool`,
 *                                unrlvl-meta-mcp #11) y se verifica leyéndolo con `comment_read_tool`. Con
 *                                `recomendacion_id`, el consejo queda `seguida` con lo que salió (`sent_text`).
 *
 * Autenticación: la misma sesión del tablero (`exigirOperador`). Un comentario de una marca fuera del
 * alcance es 403. Nada de este archivo nombra una plataforma: qué herramienta responde y cuál lee viene
 * de la tabla.
 */
import { ventana, enAlcance, marcasConsultadas, TODAS } from './_opsCore.js';
import { exigirOperador, sbGet, enLista, mcpLeer, LecturaFallida } from './_opsShared.js';
import { leerCierres, cerrar, reabrir, caducarRecomendaciones } from './_cierres.js';
import { leerAllegados, marcarAllegado, quitarAllegado } from './_allegados.js';
import { idDePublicacion } from './_asesorCore.js';
import { sbEscribir, EscrituraFallida, catalogoDeIntenciones, metasDeRespuesta } from './_bandejaShared.js';
import {
  esTipoDeCierre, esRelacion, claveDeAutor, estados, ordenar, metaDe, minutosHastaRespuesta, tiemposDeRespuesta, objetivoDeRespuesta, objetivoDePrivada, mensajeValido, hayEnVuelo, verificada, privadaDisponible,
  type Comentario, type Respuesta, type Estado, type Clase,
} from './_commentsCore.js';

const MAX_COMENTARIOS = 1000;
const TROZO = 100;

const q = (req: any, k: string): string | null => {
  const v = req.query?.[k];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
};

const COLUMNAS_COMENTARIO = [
  'id', 'platform', 'platform_comment_id', 'scheduled_post_id', 'brand_id', 'platform_post_id', 'parent_comment_id',
  'author_name', 'from_brand', 'text', 'like_count', 'commented_at', 'first_seen_at',
].join(',');
const COLUMNAS_RESPUESTA = 'id,post_comment_id,kind,status,message,requested_by,requested_at,platform_reply_id,sent_at,verified_at,error';

type FilaComentario = Comentario & Record<string, unknown>;
type FilaRespuesta = Respuesta & Record<string, unknown>;

async function respuestasDe(ids: number[]): Promise<FilaRespuesta[]> {
  const out: FilaRespuesta[] = [];
  for (let i = 0; i < ids.length; i += TROZO) {
    out.push(...await sbGet<FilaRespuesta>(
      `comment_replies?select=${COLUMNAS_RESPUESTA}&post_comment_id=in.(${ids.slice(i, i + TROZO).join(',')})&order=requested_at.desc`,
      'content'));
  }
  return out;
}

// ── GET ───────────────────────────────────────────────────────────────────────

async function bandeja(req: any, marcas: typeof TODAS | string[]) {
  const v = ventana(q(req, 'desde'), q(req, 'hasta'));
  const filtro = marcas === TODAS ? '' : `&brand_id=${enLista(marcas)}`;
  const comentarios = await sbGet<FilaComentario>(
    `post_comments?select=${COLUMNAS_COMENTARIO}${filtro}&commented_at=gte.${encodeURIComponent(v.desde)}`
    + `&commented_at=lt.${encodeURIComponent(v.hasta)}&order=commented_at.desc&limit=${MAX_COMENTARIOS}`, 'content');
  const [respuestas, cierres, allegados, metasR, intenciones] = await Promise.all([
    respuestasDe(comentarios.map((c) => c.id)), leerCierres(comentarios.map((c) => c.id)), leerAllegados(marcas), metasDeRespuesta(marcas),
    catalogoDeIntenciones(marcas)]);
  const meta = (b: string, p: string) => metaDe(metasR.metas, metasR.porDefecto, b, p);
  const minutos = minutosHastaRespuesta(comentarios, respuestas);
  const est = estados(comentarios, respuestas, new Set(cierres.keys()), new Set(allegados.keys()));
  const plataformas = await sbGet<Plataforma>(`signal_platforms?select=${COLUMNAS_PLATAFORMA}&active=is.true`, 'intel');
  const ventanaDe = new Map(plataformas.map((p) => [p.platform, p.private_reply_window_minutes && p.private_reply_tool ? p.private_reply_window_minutes : null]));
  const ahora = Date.now();
  const porComentario = new Map<number, FilaRespuesta[]>();
  for (const r of respuestas) porComentario.set(r.post_comment_id, [...(porComentario.get(r.post_comment_id) ?? []), r]);
  const filas = ordenar(comentarios.map((c) => ({
    ...c, estado: est.get(c.id) as Estado, respuestas: porComentario.get(c.id) ?? [], cierre: cierres.get(c.id) ?? null,
    allegado: c.author_name ? allegados.get(claveDeAutor(c.brand_id, c.platform, c.author_name as string))?.relation ?? null : null,
    privada: privadaDisponible(c, porComentario.get(c.id) ?? [], ventanaDe.get(c.platform) ?? null, ahora),
    meta_min: c.from_brand ? null : meta(c.brand_id, c.platform), respondido_en_min: minutos.get(c.id) ?? null,
    intencion: c.from_brand ? null : intenciones.intencionDe(c.brand_id, c.text as string | null),
  })));
  const pendientes = filas.filter((f) => f.estado === 'sin_responder' || f.estado === 'fallida').length;
  return { ventana: v, total: filas.length, pendientes, truncado: comentarios.length >= MAX_COMENTARIOS, comentarios: filas,
    tiempos: tiemposDeRespuesta(filas, minutos, meta, ahora) };
}

// ── POST ──────────────────────────────────────────────────────────────────────

interface Plataforma {
  platform: string; account_column: string | null; reply_tool: string | null; comment_read_tool: string | null;
  private_reply_tool: string | null; private_reply_window_minutes: number | null; message_read_tool: string | null;
}
const COLUMNAS_PLATAFORMA =
  'platform,account_column,reply_tool,comment_read_tool,private_reply_tool,private_reply_window_minutes,message_read_tool';

async function responder(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  const id = Number(cuerpo?.post_comment_id);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, body: { error: 'post_comment_id inválido' } };
  let message: string;
  try { message = mensajeValido(cuerpo?.message); } catch (e) { return { status: 400, body: { error: (e as Error).message } }; }
  const clase: Clase = cuerpo?.privada === true ? 'privada' : 'publica';

  const [c] = await sbGet<FilaComentario>(`post_comments?select=${COLUMNAS_COMENTARIO}&id=eq.${id}`, 'content');
  if (!c) return { status: 404, body: { error: 'comentario no encontrado' } };
  if (!enAlcance(alcance, c.brand_id)) return { status: 403, body: { error: 'forbidden: esa marca no está en tu alcance' } };
  if (c.from_brand) return { status: 422, body: { error: 'ese comentario es de la propia marca' } };

  const [p] = await sbGet<Plataforma>(
    `signal_platforms?select=${COLUMNAS_PLATAFORMA}&platform=eq.${encodeURIComponent(c.platform)}&active=is.true`,
    'intel');
  const herramienta = clase === 'privada' ? p?.private_reply_tool : p?.reply_tool;
  const lectora = clase === 'privada' ? p?.message_read_tool : p?.comment_read_tool;
  if (!herramienta || !lectora || !p?.account_column) {
    return { status: 422, body: { error: `la plataforma ${c.platform} no tiene respuesta ${clase} configurada en intel.signal_platforms` } };
  }
  if (!/^[a-z_]+$/.test(p.account_column)) throw new LecturaFallida('signal_platforms', `account_column ilegible: ${p.account_column}`);
  const [cuenta] = await sbGet<Record<string, unknown>>(
    `meta_accounts?select=${p.account_column}&brand_id=eq.${encodeURIComponent(c.brand_id)}`);
  const accountId = cuenta?.[p.account_column];
  if (accountId == null || accountId === '') {
    return { status: 422, body: { error: `la marca no tiene cuenta de ${c.platform} conectada` } };
  }

  const previas = await respuestasDe([id]);
  if (hayEnVuelo(previas, Date.now(), clase)) {
    return { status: 409, body: { error: 'ya hay una respuesta en curso para este comentario; espera a que termine' } };
  }
  if (clase === 'privada') {
    const d = privadaDisponible(c, previas, p!.private_reply_window_minutes, Date.now());
    if (!d.puede) return { status: 422, body: { error: `no se puede responder en privado: ${d.motivo}` } };
  }

  let fila: FilaRespuesta;
  try {
    [fila] = await sbEscribir<FilaRespuesta>('POST', 'comment_replies', {
      post_comment_id: id, brand_id: c.brand_id, platform: c.platform, account_id: String(accountId),
      message, requested_by: sub, kind: clase,
    }, 'content');
  } catch (err) {
    // El índice único de la base deja una sola privada viva por comentario: dos envíos a la vez no salen dos veces.
    if (err instanceof EscrituraFallida && /23505|duplicate key/.test(err.message)) {
      return { status: 409, body: { error: 'este comentario ya tiene una respuesta privada' } };
    }
    throw err;
  }
  const filtro = `comment_replies?id=eq.${encodeURIComponent(fila.id)}`;

  let idRespuesta: string | null = null;
  try {
    const r = await mcpLeer(herramienta, {
      brand_id: c.brand_id, post_id: c.platform_post_id,
      comment_id: clase === 'privada' ? objetivoDePrivada(c) : objetivoDeRespuesta(c), message,
    }) as { id?: unknown; message_id?: unknown };
    const crudo = clase === 'privada' ? r?.message_id : r?.id;
    idRespuesta = typeof crudo === 'string' && crudo ? crudo : null;
    if (!idRespuesta) throw new Error('la plataforma no devolvió el id de la respuesta');
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[comentarios] respuesta fallida ${fila.id}: ${error}`);
    const [f] = await sbEscribir<FilaRespuesta>('PATCH', filtro, { status: 'failed', error }, 'content');
    return { status: 502, body: { error: 'la plataforma rechazó la respuesta', respuesta: f ?? fila } };
  }
  await sbEscribir('PATCH', filtro, { status: 'sent', platform_reply_id: idRespuesta, sent_at: new Date().toISOString() }, 'content');

  let motivo: string | null = null;
  try {
    const leida = await mcpLeer(lectora, clase === 'privada'
      ? { brand_id: c.brand_id, message_id: idRespuesta } : { brand_id: c.brand_id, comment_id: idRespuesta });
    if (!verificada(leida, idRespuesta)) motivo = 'al leerla, la plataforma no devolvió la respuesta';
  } catch (err) {
    motivo = `no se pudo leer la respuesta: ${err instanceof Error ? err.message : String(err)}`;
  }
  const [f] = await sbEscribir<FilaRespuesta>('PATCH', filtro,
    motivo ? { error: motivo } : { status: 'verified', verified_at: new Date().toISOString() }, 'content');
  // Respondido: el consejo abierto sobre este comentario ya no hace falta.
  await caducarRecomendaciones(id, `sistema: comentario respondido por ${sub}`);
  return { status: 200, body: { respuesta: f } };
}

/** Cierra o reabre un comentario del alcance (Sam, 2026-10-26). */
async function cierre(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  const id = Number(cuerpo?.post_comment_id);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, body: { error: 'post_comment_id inválido' } };
  const reabre = cuerpo?.tipo === 'reabrir';
  if (!reabre && !esTipoDeCierre(cuerpo?.kind)) return { status: 400, body: { error: 'kind debe ser hecho, descartado o contestado_fuera' } };
  const [c] = await sbGet<FilaComentario>(`post_comments?select=id,brand_id,from_brand&id=eq.${id}`, 'content');
  if (!c || !enAlcance(alcance, c.brand_id)) return { status: 404, body: { error: 'comentario no encontrado' } };
  if (c.from_brand) return { status: 422, body: { error: 'ese comentario es de la propia marca' } };
  const r = reabre ? await reabrir(id) : await cerrar(id, cuerpo.kind, sub);
  return r.ok ? { status: 200, body: { cierre: r.cierre } } : { status: r.status, body: { error: r.error } };
}

/** Marca o desmarca como allegada la cuenta que escribió un comentario del alcance (Sam, 2026-10-26). */
async function allegado(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  const id = Number(cuerpo?.post_comment_id);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, body: { error: 'post_comment_id inválido' } };
  const quita = cuerpo?.tipo === 'quitar_allegado';
  if (!quita && !esRelacion(cuerpo?.relation)) return { status: 400, body: { error: 'relation debe ser equipo o allegado' } };
  const [c] = await sbGet<FilaComentario>(`post_comments?select=id,brand_id,platform,author_name,from_brand&id=eq.${id}`, 'content');
  if (!c || !enAlcance(alcance, c.brand_id)) return { status: 404, body: { error: 'comentario no encontrado' } };
  if (c.from_brand) return { status: 422, body: { error: 'ese comentario es de la propia marca' } };
  const autor = typeof c.author_name === 'string' ? c.author_name.trim() : '';
  if (!autor) return { status: 422, body: { error: 'la plataforma no dio el autor de este comentario: no se puede marcar' } };
  const cuenta = { brand_id: c.brand_id, platform: c.platform, author_name: autor };
  const r = quita ? await quitarAllegado(cuenta) : await marcarAllegado(cuenta, cuerpo.relation, sub);
  if (r.ok && !quita) await caducarRecomendaciones(id, `sistema: cuenta ${cuerpo.relation} marcada por ${sub}`);
  return r.ok ? { status: 200, body: { ok: true } } : { status: r.status, body: { error: r.error } };
}

/**
 * Un comentario de la marca en su propia publicación (Sam, 2026-10-26). Alcance antes de escribir; la herramienta sale
 * de la tabla; se verifica leyéndolo. No hay registro en `comment_replies` (no responde a nadie): queda en el consejo
 * seguido (`sent_text`, `status_by`) y el colector de SignalLab lo lee como comentario de la marca.
 */
async function comentarEnPublicacion(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  const postId = idDePublicacion(cuerpo?.scheduled_post_id);
  if (!postId) return { status: 400, body: { error: 'scheduled_post_id inválido' } };
  let message: string;
  try { message = mensajeValido(cuerpo?.message); } catch (e) { return { status: 400, body: { error: (e as Error).message } }; }
  const recoId = cuerpo?.recomendacion_id == null || cuerpo.recomendacion_id === '' ? null : String(cuerpo.recomendacion_id);
  if (recoId !== null && !/^[0-9a-f-]{36}$/i.test(recoId)) return { status: 400, body: { error: 'recomendacion_id inválido' } };

  const [p] = await sbGet<{ brand_id: string; platform: string; platform_post_id: string | null }>(
    `scheduled_posts?select=brand_id,platform,platform_post_id&id=eq.${postId}`);
  if (!p || !enAlcance(alcance, p.brand_id)) return { status: 404, body: { error: 'publicación no encontrada' } };
  if (!p.platform_post_id) return { status: 422, body: { error: 'la publicación no tiene id en la plataforma' } };
  if (recoId !== null) {
    const [r] = await sbGet<{ brand_id: string; scheduled_post_id: string | null; status: string }>(
      `social_advisor_recommendations?select=brand_id,scheduled_post_id,status&id=eq.${recoId}`, 'intel');
    if (!r || r.brand_id !== p.brand_id || r.scheduled_post_id !== postId) return { status: 404, body: { error: 'recomendación no encontrada' } };
    if (r.status !== 'nueva') return { status: 409, body: { error: `la recomendación ya está ${r.status}` } };
  }

  let herramientas: { post_comment_tool: string | null; comment_read_tool: string | null } | undefined;
  try {
    [herramientas] = await sbGet<{ post_comment_tool: string | null; comment_read_tool: string | null }>(
      `signal_platforms?select=post_comment_tool,comment_read_tool&platform=eq.${encodeURIComponent(p.platform)}&active=is.true`, 'intel');
  } catch (err) {
    if (err instanceof LecturaFallida && /post_comment_tool|42703|PGRST/.test(err.message)) {
      return { status: 503, body: { error: 'comentar desde el tablero todavía no está disponible: falta aplicar su migración' } };
    }
    throw err;
  }
  if (!herramientas?.post_comment_tool || !herramientas.comment_read_tool) {
    return { status: 422, body: { error: `la plataforma ${p.platform} no permite comentar desde el tablero` } };
  }

  let id: string | null = null;
  try {
    const r = await mcpLeer(herramientas.post_comment_tool, { brand_id: p.brand_id, post_id: p.platform_post_id, message }) as { id?: unknown };
    id = typeof r?.id === 'string' && r.id ? r.id : null;
    if (!id) throw new Error('la plataforma no devolvió el id del comentario');
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[comentarios] comentar en ${postId} falló: ${error}`);
    return { status: 502, body: { error: `la plataforma rechazó el comentario: ${error}` } };
  }

  let motivo: string | null = null;
  try {
    const leida = await mcpLeer(herramientas.comment_read_tool, { brand_id: p.brand_id, comment_id: id });
    if (!verificada(leida, id)) motivo = 'al leerlo, la plataforma no devolvió el comentario';
  } catch (err) {
    motivo = `no se pudo leer el comentario: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (recoId !== null) {
    // El comentario ya salió: el consejo queda seguido con lo que se publicó. Un fallo aquí no deshace lo publicado.
    try {
      await sbEscribir('PATCH', `social_advisor_recommendations?id=eq.${recoId}&status=eq.nueva`,
        { status: 'seguida', status_by: sub, status_at: new Date().toISOString(), sent_text: message }, 'intel');
    } catch (err) { console.error(`[comentarios] marcar seguida ${recoId}: ${err instanceof Error ? err.message : err}`); }
  }
  return { status: 200, body: { comentario: { id, verificado: !motivo, motivo } } };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const puerta = await exigirOperador(req, res);
  if (!puerta) return;
  try {
    if (req.method === 'GET') {
      const c = marcasConsultadas(puerta.alcance, q(req, 'marca'));
      if ('prohibida' in c) return res.status(403).json({ error: 'forbidden: esa marca no está en tu alcance' });
      return res.status(200).json(await bandeja(req, c.marcas));
    }
    const cuerpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const r = cuerpo?.tipo === 'cierre' || cuerpo?.tipo === 'reabrir'
      ? await cierre(cuerpo, puerta.sesion.sub, puerta.alcance)
      : cuerpo?.tipo === 'allegado' || cuerpo?.tipo === 'quitar_allegado'
        ? await allegado(cuerpo, puerta.sesion.sub, puerta.alcance)
      : cuerpo?.tipo === 'comentar'
        ? await comentarEnPublicacion(cuerpo, puerta.sesion.sub, puerta.alcance)
        : await responder(cuerpo, puerta.sesion.sub, puerta.alcance);
    return res.status(r.status).json(r.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('VENTANA_INVALIDA')) return res.status(400).json({ error: msg });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'cuerpo JSON ilegible' });
    console.error(`[comentarios] ${req.method} falló: ${msg}`);
    return res.status(503).json({ error: err instanceof LecturaFallida ? 'lectura_fallida' : 'error', detail: msg });
  }
}
