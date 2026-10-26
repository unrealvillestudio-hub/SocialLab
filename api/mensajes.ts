/**
 * SocialLab — /api/mensajes · Bandeja de mensajes directos (DMs) del operador (Sam, 2026-10-26; mejora 5).
 *
 *   GET  ?marca=&desde=&hasta=   las conversaciones de las marcas del alcance con actividad en la ventana, leídas de
 *                                `content.dm_threads` / `dm_messages` (las escribe el colector de SignalLab,
 *                                unrlvl-iid-functions #506), con su estado, sus últimos mensajes, la intención de lo que
 *                                la persona escribió sin contestar, la meta de respuesta y si todavía se puede responder
 *                                (ventana de la plataforma, `dm_reply_window_minutes`). Lo que espera respuesta, primero.
 *   POST { thread_id, message }  responde la conversación como la marca:
 *                                1. comprueba alcance, que no haya otra respuesta en curso y la ventana;
 *                                2. asienta la respuesta en `content.dm_replies` como `requested`, con quién la pidió;
 *                                3. llama la herramienta del MCP de Meta (`signal_platforms.dm_send_tool`,
 *                                   unrlvl-meta-mcp #13) → `sent`;
 *                                4. la relee (`message_read_tool`) → `verified` sólo si la plataforma devuelve el mismo id.
 *                                Un fallo de la plataforma queda `failed` con el error.
 *   POST { tipo: 'allegado' | 'quitar_allegado', thread_id, relation? }
 *                                marca (o desmarca) a la persona como allegada o del equipo: la misma lista que la bandeja
 *                                de comentarios (`content.brand_close_accounts`). Sus conversaciones dejan de esperar.
 *
 * Antes de la migración las tablas no existen: el GET responde `disponible: false` con el motivo y el POST, 503.
 * Autenticación: la sesión del tablero (`exigirOperador`). Nada de este archivo nombra una plataforma ni una marca.
 */
import { ventana, enAlcance, marcasConsultadas, TODAS } from './_opsCore.js';
import { exigirOperador, sbGet, enLista, mcpLeer, LecturaFallida, esTablaInexistente } from './_opsShared.js';
import { leerAllegados, marcarAllegado, quitarAllegado } from './_allegados.js';
import { sbEscribir, catalogoDeIntenciones, metasDeRespuesta, ultimaLecturaDeSignalLab } from './_bandejaShared.js';
import { claveDeAutor, esRelacion, mensajeValido, metaDe, verificada } from './_commentsCore.js';
import {
  estadoDeHilo, ventanaDeRespuesta, ordenarHilos, sinContestar, ultimoDeLaPersona, ESTADOS_HILO_PENDIENTES,
  type MensajeDM, type RespuestaDM,
} from './_mensajesCore.js';

const MAX_HILOS = 300;
const MENSAJES_POR_HILO = 30;
const TROZO = 100;

const q = (req: any, k: string): string | null => {
  const v = req.query?.[k];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
};

interface Hilo {
  id: number; platform: string; platform_thread_id: string; brand_id: string; participant_platform_id: string | null;
  participant_name: string | null; updated_at: string | null; first_seen_at: string;
}
const COLUMNAS_HILO = 'id,platform,platform_thread_id,brand_id,participant_platform_id,participant_name,updated_at,first_seen_at';
const COLUMNAS_MENSAJE = 'id,thread_id,from_brand,author_name,author_platform_id,text,sent_at';
const COLUMNAS_RESPUESTA = 'id,thread_id,status,message,requested_by,requested_at,sent_at,platform_message_id,error';

interface Plataforma { platform: string; dm_send_tool: string | null; dm_reply_window_minutes: number | null; message_read_tool: string | null }
const COLUMNAS_PLATAFORMA = 'platform,dm_send_tool,dm_reply_window_minutes,message_read_tool';

async function porTrozos<T>(ids: number[], ruta: (lista: string) => string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += TROZO) out.push(...await sbGet<T>(ruta(ids.slice(i, i + TROZO).join(',')), 'content'));
  return out;
}

// ── GET ───────────────────────────────────────────────────────────────────────

async function bandeja(req: any, marcas: typeof TODAS | string[]) {
  const v = ventana(q(req, 'desde'), q(req, 'hasta'));
  const filtro = marcas === TODAS ? '' : `&brand_id=${enLista(marcas)}`;
  let hilos: Hilo[];
  try {
    hilos = await sbGet<Hilo>(`dm_threads?select=${COLUMNAS_HILO}${filtro}&updated_at=gte.${encodeURIComponent(v.desde)}`
      + `&updated_at=lt.${encodeURIComponent(v.hasta)}&order=updated_at.desc&limit=${MAX_HILOS}`, 'content');
  } catch (err) {
    if (esTablaInexistente(err)) {
      return { disponible: false, motivo: 'los mensajes directos todavía no se leen: falta aplicar su migración', ventana: v, total: 0, pendientes: 0, hilos: [] };
    }
    throw err;
  }
  const ids = hilos.map((h) => h.id);
  const [mensajes, respuestas, allegados, metasR, intenciones, plataformas, leidoEn] = await Promise.all([
    porTrozos<MensajeDM>(ids, (l) => `dm_messages?select=${COLUMNAS_MENSAJE}&thread_id=in.(${l})&order=sent_at.desc`),
    porTrozos<RespuestaDM>(ids, (l) => `dm_replies?select=${COLUMNAS_RESPUESTA}&thread_id=in.(${l})&order=requested_at.desc`),
    leerAllegados(marcas), metasDeRespuesta(marcas), catalogoDeIntenciones(marcas),
    sbGet<Plataforma>(`signal_platforms?select=${COLUMNAS_PLATAFORMA}&active=is.true`, 'intel'), ultimaLecturaDeSignalLab(),
  ]);
  const ventanaDe = new Map(plataformas.map((p) => [p.platform, p.dm_send_tool ? p.dm_reply_window_minutes : null]));
  const mensajesDe = new Map<number, MensajeDM[]>();
  for (const m of mensajes) mensajesDe.set(m.thread_id, [...(mensajesDe.get(m.thread_id) ?? []), m]);
  const respuestasDe = new Map<number, RespuestaDM[]>();
  for (const r of respuestas) respuestasDe.set(r.thread_id, [...(respuestasDe.get(r.thread_id) ?? []), r]);
  const ahora = Date.now();

  const filas = ordenarHilos(hilos.map((h) => {
    const ms = mensajesDe.get(h.id) ?? [];
    const rs = respuestasDe.get(h.id) ?? [];
    const allegado = h.participant_name ? allegados.get(claveDeAutor(h.brand_id, h.platform, h.participant_name))?.relation ?? null : null;
    const pendiente = sinContestar(ms);
    const tp = ultimoDeLaPersona(ms);
    const ultimo = ms.reduce<string | null>((u, m) => (!u || Date.parse(m.sent_at) > Date.parse(u) ? m.sent_at : u), null);
    return {
      ...h,
      estado: estadoDeHilo(ms, rs, allegado !== null, ahora),
      allegado,
      // Los últimos mensajes, del más viejo al más nuevo, para leerlos como conversación.
      mensajes: ms.slice(0, MENSAJES_POR_HILO).reverse(),
      respuestas: rs,
      ultimo_at: ultimo,
      espera_desde: tp !== null ? new Date(tp).toISOString() : null,
      intencion: pendiente.length ? intenciones.intencionDe(h.brand_id, pendiente.map((m) => m.text ?? '').join('\n')) : null,
      meta_min: metaDe(metasR.metas, metasR.porDefecto, h.brand_id, h.platform),
      responder: ventanaDeRespuesta(ms, ventanaDe.get(h.platform) ?? null, ahora),
    };
  }));
  const pendientes = filas.filter((f) => ESTADOS_HILO_PENDIENTES.includes(f.estado)).length;
  return { disponible: true, motivo: null, ventana: v, leido_en: leidoEn, total: filas.length, pendientes, truncado: hilos.length >= MAX_HILOS, hilos: filas };
}

// ── POST ──────────────────────────────────────────────────────────────────────

async function hiloDelAlcance(cuerpo: any, alcance: typeof TODAS | string[]): Promise<{ hilo: Hilo } | { status: number; body: unknown }> {
  const id = Number(cuerpo?.thread_id);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, body: { error: 'thread_id inválido' } };
  let h: Hilo | undefined;
  try { [h] = await sbGet<Hilo>(`dm_threads?select=${COLUMNAS_HILO}&id=eq.${id}`, 'content'); }
  catch (err) {
    if (esTablaInexistente(err)) return { status: 503, body: { error: 'los mensajes directos todavía no están disponibles: falta aplicar su migración' } };
    throw err;
  }
  if (!h) return { status: 404, body: { error: 'conversación no encontrada' } };
  if (!enAlcance(alcance, h.brand_id)) return { status: 403, body: { error: 'forbidden: esa marca no está en tu alcance' } };
  return { hilo: h };
}

async function responder(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  let message: string;
  try { message = mensajeValido(cuerpo?.message); } catch (e) { return { status: 400, body: { error: (e as Error).message } }; }
  const r = await hiloDelAlcance(cuerpo, alcance);
  if (!('hilo' in r)) return r;
  const h = r.hilo;
  if (!h.participant_platform_id) return { status: 422, body: { error: 'la conversación no tiene destinatario identificado' } };

  const [p] = await sbGet<Plataforma>(`signal_platforms?select=${COLUMNAS_PLATAFORMA}&platform=eq.${encodeURIComponent(h.platform)}&active=is.true`, 'intel');
  if (!p?.dm_send_tool || !p.message_read_tool) {
    return { status: 422, body: { error: `la plataforma ${h.platform} no tiene respuesta de mensajes configurada` } };
  }
  const [ms, previas] = await Promise.all([
    sbGet<MensajeDM>(`dm_messages?select=${COLUMNAS_MENSAJE}&thread_id=eq.${h.id}&order=sent_at.desc&limit=${MENSAJES_POR_HILO}`, 'content'),
    sbGet<RespuestaDM>(`dm_replies?select=${COLUMNAS_RESPUESTA}&thread_id=eq.${h.id}&order=requested_at.desc&limit=20`, 'content'),
  ]);
  if (estadoDeHilo(ms, previas, false) === 'en_curso') {
    return { status: 409, body: { error: 'ya hay una respuesta en curso para esta conversación; espera a que termine' } };
  }
  const v = ventanaDeRespuesta(ms, p.dm_reply_window_minutes);
  if (!v.puede) return { status: 422, body: { error: `no se puede responder: ${v.motivo}` } };

  const [fila] = await sbEscribir<RespuestaDM>('POST', 'dm_replies', {
    thread_id: h.id, brand_id: h.brand_id, platform: h.platform, recipient_id: h.participant_platform_id, message, requested_by: sub,
  }, 'content');
  const filtro = `dm_replies?id=eq.${encodeURIComponent(fila.id)}`;

  let idMensaje: string | null = null;
  try {
    const res = await mcpLeer(p.dm_send_tool, { brand_id: h.brand_id, recipient_id: h.participant_platform_id, message }) as { message_id?: unknown };
    idMensaje = typeof res?.message_id === 'string' && res.message_id ? res.message_id : null;
    if (!idMensaje) throw new Error('la plataforma no devolvió el id del mensaje');
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[mensajes] respuesta fallida ${fila.id}: ${error}`);
    const [f] = await sbEscribir<RespuestaDM>('PATCH', filtro, { status: 'failed', error }, 'content');
    return { status: 502, body: { error: 'la plataforma rechazó la respuesta', respuesta: f ?? fila } };
  }
  await sbEscribir('PATCH', filtro, { status: 'sent', platform_message_id: idMensaje, sent_at: new Date().toISOString() }, 'content');

  let motivo: string | null = null;
  try {
    const leida = await mcpLeer(p.message_read_tool, { brand_id: h.brand_id, message_id: idMensaje });
    if (!verificada(leida, idMensaje)) motivo = 'al leerlo, la plataforma no devolvió el mensaje';
  } catch (err) {
    motivo = `no se pudo leer el mensaje: ${err instanceof Error ? err.message : String(err)}`;
  }
  const [f] = await sbEscribir<RespuestaDM>('PATCH', filtro,
    motivo ? { error: motivo } : { status: 'verified', verified_at: new Date().toISOString() }, 'content');
  return { status: 200, body: { respuesta: f } };
}

async function allegado(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  const r = await hiloDelAlcance(cuerpo, alcance);
  if (!('hilo' in r)) return r;
  const h = r.hilo;
  if (!h.participant_name) return { status: 422, body: { error: 'la conversación no trae el nombre de la persona: no se puede marcar' } };
  const cuenta = { brand_id: h.brand_id, platform: h.platform, author_name: h.participant_name };
  if (cuerpo?.tipo === 'quitar_allegado') {
    const x = await quitarAllegado(cuenta);
    return x.ok ? { status: 200, body: { ok: true } } : { status: x.status, body: { error: x.error } };
  }
  if (!esRelacion(cuerpo?.relation)) return { status: 400, body: { error: 'relation inválida (equipo | allegado)' } };
  const x = await marcarAllegado(cuenta, cuerpo.relation, sub);
  return x.ok ? { status: 200, body: { ok: true } } : { status: x.status, body: { error: x.error } };
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
    const r = cuerpo?.tipo === 'allegado' || cuerpo?.tipo === 'quitar_allegado'
      ? await allegado(cuerpo, puerta.sesion.sub, puerta.alcance)
      : await responder(cuerpo, puerta.sesion.sub, puerta.alcance);
    return res.status(r.status).json(r.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('VENTANA_INVALIDA')) return res.status(400).json({ error: msg });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'cuerpo JSON ilegible' });
    console.error(`[mensajes] ${req.method} falló: ${msg}`);
    return res.status(503).json({ error: err instanceof LecturaFallida ? 'lectura_fallida' : 'error', detail: msg });
  }
}
