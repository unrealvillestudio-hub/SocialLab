/**
 * SocialLab — /api/comments · Bandeja de comentarios del operador (SignalLab Fase 3, 2026-10-25).
 *
 *   GET  ?marca=&desde=&hasta=   los comentarios de las marcas del alcance, leídos de
 *                                `content.post_comments` (los escribe el colector de SignalLab), con
 *                                su estado; lo que espera respuesta va primero
 *   POST { post_comment_id, message }
 *                                responde un comentario desde la cuenta de la marca:
 *                                1. asienta la respuesta en `content.comment_replies` como `requested`,
 *                                   con quién la pidió (`sub` de la sesión) y desde qué cuenta;
 *                                2. llama la herramienta de respuesta del MCP de Meta
 *                                   (`intel.signal_platforms.reply_tool`) → `sent`;
 *                                3. la vuelve a leer (`comment_read_tool`) → `verified` sólo si la
 *                                   plataforma devuelve el mismo id. Si no, queda `sent` con el motivo.
 *                                Un fallo de la plataforma queda `failed` con el error: nada se pierde
 *                                en silencio.
 *
 * Autenticación: la misma sesión del tablero (`exigirOperador`). Un comentario de una marca fuera del
 * alcance es 403. Nada de este archivo nombra una plataforma: qué herramienta responde y cuál lee viene
 * de la tabla.
 */
import { ventana, enAlcance, marcasConsultadas, TODAS } from './_opsCore.js';
import { exigirOperador, sbGet, enLista, mcpLeer, LecturaFallida, SB_URL, SB_KEY } from './_opsShared.js';
import {
  estados, ordenar, objetivoDeRespuesta, mensajeValido, hayEnVuelo, verificada,
  type Comentario, type Respuesta, type Estado,
} from './_commentsCore.js';

const MAX_COMENTARIOS = 1000;
const TROZO = 100;

const q = (req: any, k: string): string | null => {
  const v = req.query?.[k];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
};

class EscrituraFallida extends Error {
  ruta: string;
  constructor(ruta: string, detalle: string) {
    super(`ESCRITURA_FALLIDA: ${ruta} — ${detalle}`);
    this.name = 'EscrituraFallida';
    this.ruta = ruta;
  }
}

/** POST o PATCH a PostgREST con `service_role`. Devuelve las filas escritas. */
async function sbEscribir<T>(metodo: 'POST' | 'PATCH', ruta: string, cuerpo: unknown, perfil: string): Promise<T[]> {
  let res: Response;
  try {
    res = await fetch(`${SB_URL()}/rest/v1/${ruta}`, {
      method: metodo,
      headers: {
        apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Profile': perfil,
        'Content-Type': 'application/json', Prefer: 'return=representation',
      },
      body: JSON.stringify(cuerpo),
    });
  } catch (err) {
    throw new EscrituraFallida(ruta, `la petición no llegó: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new EscrituraFallida(ruta, `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const data = await res.json().catch(() => []);
  return (Array.isArray(data) ? data : [data]) as T[];
}

const COLUMNAS_COMENTARIO = [
  'id', 'platform', 'platform_comment_id', 'scheduled_post_id', 'brand_id', 'platform_post_id', 'parent_comment_id',
  'author_name', 'from_brand', 'text', 'like_count', 'commented_at', 'first_seen_at',
].join(',');
const COLUMNAS_RESPUESTA = 'id,post_comment_id,status,message,requested_by,requested_at,platform_reply_id,sent_at,verified_at,error';

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
  const respuestas = await respuestasDe(comentarios.map((c) => c.id));
  const est = estados(comentarios, respuestas);
  const porComentario = new Map<number, FilaRespuesta[]>();
  for (const r of respuestas) porComentario.set(r.post_comment_id, [...(porComentario.get(r.post_comment_id) ?? []), r]);
  const filas = ordenar(comentarios.map((c) => ({
    ...c, estado: est.get(c.id) as Estado, respuestas: porComentario.get(c.id) ?? [],
  })));
  const pendientes = filas.filter((f) => f.estado === 'sin_responder' || f.estado === 'fallida').length;
  return { ventana: v, total: filas.length, pendientes, truncado: comentarios.length >= MAX_COMENTARIOS, comentarios: filas };
}

// ── POST ──────────────────────────────────────────────────────────────────────

interface Plataforma { platform: string; account_column: string | null; reply_tool: string | null; comment_read_tool: string | null }

async function responder(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  const id = Number(cuerpo?.post_comment_id);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, body: { error: 'post_comment_id inválido' } };
  let message: string;
  try { message = mensajeValido(cuerpo?.message); } catch (e) { return { status: 400, body: { error: (e as Error).message } }; }

  const [c] = await sbGet<FilaComentario>(`post_comments?select=${COLUMNAS_COMENTARIO}&id=eq.${id}`, 'content');
  if (!c) return { status: 404, body: { error: 'comentario no encontrado' } };
  if (!enAlcance(alcance, c.brand_id)) return { status: 403, body: { error: 'forbidden: esa marca no está en tu alcance' } };
  if (c.from_brand) return { status: 422, body: { error: 'ese comentario es de la propia marca' } };

  const [p] = await sbGet<Plataforma>(
    `signal_platforms?select=platform,account_column,reply_tool,comment_read_tool&platform=eq.${encodeURIComponent(c.platform)}&active=is.true`,
    'intel');
  if (!p?.reply_tool || !p.comment_read_tool || !p.account_column) {
    return { status: 422, body: { error: `la plataforma ${c.platform} no tiene respuesta configurada en intel.signal_platforms` } };
  }
  if (!/^[a-z_]+$/.test(p.account_column)) throw new LecturaFallida('signal_platforms', `account_column ilegible: ${p.account_column}`);
  const [cuenta] = await sbGet<Record<string, unknown>>(
    `meta_accounts?select=${p.account_column}&brand_id=eq.${encodeURIComponent(c.brand_id)}`);
  const accountId = cuenta?.[p.account_column];
  if (accountId == null || accountId === '') {
    return { status: 422, body: { error: `la marca no tiene cuenta de ${c.platform} conectada` } };
  }

  if (hayEnVuelo(await respuestasDe([id]))) {
    return { status: 409, body: { error: 'ya hay una respuesta en curso para este comentario; espera a que termine' } };
  }

  const [fila] = await sbEscribir<FilaRespuesta>('POST', 'comment_replies', {
    post_comment_id: id, brand_id: c.brand_id, platform: c.platform, account_id: String(accountId),
    message, requested_by: sub,
  }, 'content');
  const filtro = `comment_replies?id=eq.${encodeURIComponent(fila.id)}`;

  let idRespuesta: string | null = null;
  try {
    const r = await mcpLeer(p.reply_tool, {
      brand_id: c.brand_id, post_id: c.platform_post_id, comment_id: objetivoDeRespuesta(c), message,
    }) as { id?: unknown };
    idRespuesta = typeof r?.id === 'string' && r.id ? r.id : null;
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
    const leida = await mcpLeer(p.comment_read_tool, { brand_id: c.brand_id, comment_id: idRespuesta });
    if (!verificada(leida, idRespuesta)) motivo = 'al leerla, la plataforma no devolvió la respuesta';
  } catch (err) {
    motivo = `no se pudo leer la respuesta: ${err instanceof Error ? err.message : String(err)}`;
  }
  const [f] = await sbEscribir<FilaRespuesta>('PATCH', filtro,
    motivo ? { error: motivo } : { status: 'verified', verified_at: new Date().toISOString() }, 'content');
  return { status: 200, body: { respuesta: f } };
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
    const r = await responder(cuerpo, puerta.sesion.sub, puerta.alcance);
    return res.status(r.status).json(r.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('VENTANA_INVALIDA')) return res.status(400).json({ error: msg });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'cuerpo JSON ilegible' });
    console.error(`[comentarios] ${req.method} falló: ${msg}`);
    return res.status(503).json({ error: err instanceof LecturaFallida ? 'lectura_fallida' : 'error', detail: msg });
  }
}
