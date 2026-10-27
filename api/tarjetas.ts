/**
 * ASESOR · las tarjetas de acción de SignalLab para el tablero (Sam, 2026-10-25).
 *
 *   GET  ?marca=&cerradas=1   → { tarjetas, nuevas }. Por defecto sólo las abiertas (nueva · vista · seguida);
 *                               con `cerradas=1`, también las descartadas o resueltas de los últimos 7 días.
 *   POST { id, status }       → { tarjeta }. `status` ∈ vista | seguida | descartada. Queda quién y cuándo
 *                               (`status_by` = sub del operador). 409 si la tarjeta cambió entretanto.
 *
 * Recomendaciones del asesor (`intel.social_advisor_recommendations`, 2026-10-25): el GET las trae en
 * `recomendaciones` (sólo `RECOMENDACIONES_VISIBLES`).
 *   POST { tipo: 'recomendacion', id, status, sent_text? } → seguida | descartada; `sent_text` = lo que
 *                               se envió de verdad, para medir cuánto se edita el borrador.
 *   POST { tipo: 'despertar', marca }                      → pone en cola un despertar del asesor para esa
 *                               marca (`intel.social_advisor_wakes`). 409 si ya hay uno pendiente.
 *   POST { tipo: 'despertar', marca, post_comment_id }     → consejo sobre ESE comentario (Sam, 2026-10-26): el
 *                               asesor lo atiende aunque tenga más de 72 h. 409 si ya hay un pedido en cola
 *                               para él. El GET trae `pedidos`: cómo va el último pedido de cada comentario.
 *   POST { tipo: 'despertar', marca, scheduled_post_id }   → consejo sobre ESA publicación (Sam, 2026-10-26), desde
 *                               Publicado o Acciones. El GET trae `pedidos_publicacion`.
 *   «Hecho» (`seguida`) en una recomendación de un comentario cierra el comentario como `hecho` (2026-10-26): sale de la
 *                               bandeja y el asesor no lo vuelve a proponer.
 * Costos, tokens y modelo viven en `social_advisor_wakes` y NUNCA salen de aquí: el operador puede ser
 * del cliente.
 *
 * Autenticación y alcance: los del tablero (`exigirOperador`). Una acción `interna` sólo la ve quien tiene
 * alcance total. Las tarjetas no llevan costos ni datos internos (contrato de SignalLab, #488).
 */
import { marcasConsultadas, TODAS } from './_opsCore.js';
import { exigirOperador, sbGet, enLista, LecturaFallida, SB_URL, SB_KEY } from './_opsShared.js';
import { cerrar } from './_cierres.js';
import {
  cambioDeEstado, cambioDeRecomendacion, estadoDePedidos, estadoDePedidosDePublicacion, idDeComentario, idDePublicacion, ordenarTarjetas, textoEnviado, visiblePara,
  ESTADOS_ABIERTOS, RECOMENDACIONES_VISIBLES, type AccionTipo, type PedidoFila, type TarjetaFila,
} from './_asesorCore.js';

const q = (req: any, k: string): string | undefined => {
  const v = req.query?.[k];
  return Array.isArray(v) ? v[0] : (v ?? undefined);
};
const COLUMNAS = 'id,rule_key,card_type,severity,brand_id,platform,scheduled_post_id,post_comment_id,action_key,objective,'
  + 'what_text,why_text,metric,value,baseline_value,baseline_level,baseline_size,status,status_by,status_at,created_at';
const MAX_TARJETAS = 500;
/** Sin `wake_id` ni nada del despertar: lo que es costo o modelo no sale hacia el operador. */
const COLUMNAS_RECO = 'id,brand_id,platform,card_id,post_comment_id,scheduled_post_id,action_key,objective,recommendation,draft,'
  + 'status,status_by,status_at,sent_text,created_at';
interface RecoFila { id: string; brand_id: string; platform: string | null; action_key: string; status: string; [k: string]: unknown }
const DIAS_CERRADAS = 7;
/** Los pedidos de consejo que el tablero mira: los de estos días. */
const DIAS_PEDIDOS = 7;

/**
 * Cómo va el último pedido de consejo de cada comentario. Sólo columnas sin costo. Si la lectura falla
 * (p. ej. antes de la migración que crea la columna), las tarjetas siguen: sin pedidos, no sin tablero.
 */
async function pedidos(marcas: typeof TODAS | string[]) {
  const desde = new Date(Date.now() - DIAS_PEDIDOS * 86_400_000).toISOString();
  const cola = `&created_at=gte.${encodeURIComponent(desde)}${filtroMarcas(marcas)}&order=created_at.desc&limit=500`;
  try {
    let filas: PedidoFila[];
    try {
      filas = await sbGet<PedidoFila>(`social_advisor_wakes?select=post_comment_id,scheduled_post_id,status,recommendations,created_at`
        + `&or=(post_comment_id.not.is.null,scheduled_post_id.not.is.null)${cola}`, 'intel');
    } catch (e) {
      // Antes de la migración de pedidos por publicación (#499) la columna no existe: los de comentario siguen.
      console.error(`[asesor] pedidos por publicación sin leer: ${e instanceof Error ? e.message : e}`);
      filas = await sbGet<PedidoFila>(`social_advisor_wakes?select=post_comment_id,status,recommendations,created_at&post_comment_id=not.is.null${cola}`, 'intel');
    }
    return { comentarios: estadoDePedidos(filas), publicaciones: estadoDePedidosDePublicacion(filas) };
  } catch (e) {
    console.error(`[asesor] pedidos de consejo sin leer: ${e instanceof Error ? e.message : e}`);
    return { comentarios: [], publicaciones: [] };
  }
}

/**
 * Las recomendaciones visibles, con el objetivo semanal al que apuntan (`growth_goal_id`, 2026-10-27). Antes de la
 * migración de objetivos la columna no existe: se leen sin ella y el tablero sigue.
 */
async function leerRecomendaciones(marcas: typeof TODAS | string[]): Promise<RecoFila[]> {
  const ruta = (cols: string) => `social_advisor_recommendations?select=${cols}&status=${enLista(RECOMENDACIONES_VISIBLES as string[])}`
    + `${filtroMarcas(marcas)}&order=created_at.desc&limit=${MAX_TARJETAS}`;
  try { return await sbGet<RecoFila>(ruta(`${COLUMNAS_RECO},growth_goal_id`), 'intel'); }
  catch (e) {
    if (!(e instanceof LecturaFallida) || e.codigo !== '42703') throw e;
    console.error(`[asesor] recomendaciones sin objetivo: ${e.message}`);
    return sbGet<RecoFila>(ruta(COLUMNAS_RECO), 'intel');
  }
}

async function acciones(): Promise<Map<string, AccionTipo>> {
  const filas = await sbGet<AccionTipo>('engagement_action_types?select=action_key,label,objective,via', 'intel');
  return new Map(filas.map((a) => [a.action_key, a]));
}

const filtroMarcas = (marcas: typeof TODAS | string[]) => (marcas === TODAS ? '' : `&brand_id=${enLista(marcas)}`);

async function listar(req: any, marcas: typeof TODAS | string[], alcanceTotal: boolean) {
  const abiertas = `status=${enLista(ESTADOS_ABIERTOS as string[])}`;
  const desde = new Date(Date.now() - DIAS_CERRADAS * 86_400_000).toISOString();
  const filtro = q(req, 'cerradas') === '1'
    ? `or=(${abiertas.replace('=', '.')},created_at.gte.${encodeURIComponent(desde)})` : abiertas;
  const [filas, tipos, recos, pedidosDeConsejo] = await Promise.all([
    sbGet<TarjetaFila>(`signal_cards?select=${COLUMNAS}&${filtro}${filtroMarcas(marcas)}&order=created_at.desc&limit=${MAX_TARJETAS + 1}`, 'intel'),
    acciones(),
    leerRecomendaciones(marcas),
    pedidos(marcas),
  ]);
  const truncado = filas.length > MAX_TARJETAS;
  const visibles = (truncado ? filas.slice(0, MAX_TARJETAS) : filas)
    .filter((t) => visiblePara(tipos.get(t.action_key), alcanceTotal))
    .map((t) => {
      const a = tipos.get(t.action_key);
      return { ...t, accion: a ? { label: a.label, via: a.via } : { label: t.action_key, via: 'app_nativa' } };
    });
  const recomendaciones = recos
    .filter((r) => visiblePara(tipos.get(r.action_key), alcanceTotal))
    .map((r) => {
      const a = tipos.get(r.action_key);
      return { ...r, accion: a ? { label: a.label, via: a.via } : { label: r.action_key, via: 'app_nativa' } };
    });
  return { truncado, nuevas: visibles.filter((t) => t.status === 'nueva').length, tarjetas: ordenarTarjetas(visibles), recomendaciones,
    pedidos: pedidosDeConsejo.comentarios, pedidos_publicacion: pedidosDeConsejo.publicaciones };
}

/** PATCH condicionado al estado leído: si otro operador lo cambió entretanto, devuelve [] (→ 409). */
async function patchCondicionado<T>(tabla: string, id: string, actual: string, cambios: Record<string, unknown>): Promise<T[]> {
  const res = await fetch(`${SB_URL()}/rest/v1/${tabla}?id=eq.${id}&status=eq.${encodeURIComponent(actual)}`, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Profile': 'intel',
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify(cambios),
  });
  if (!res.ok) throw new LecturaFallida(`${tabla} (PATCH)`, `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return (await res.json().catch(() => [])) as T[];
}

async function cambiarRecomendacion(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  const id = String(cuerpo?.id ?? '');
  const nuevo = String(cuerpo?.status ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400, body: { error: 'id inválido' } };
  const [r] = await sbGet<RecoFila>(`social_advisor_recommendations?select=${COLUMNAS_RECO}&id=eq.${id}`, 'intel');
  if (!r || (alcance !== TODAS && !alcance.includes(r.brand_id))) return { status: 404, body: { error: 'recomendación no encontrada' } };
  if (!visiblePara((await acciones()).get(r.action_key), alcance === TODAS)) return { status: 404, body: { error: 'recomendación no encontrada' } };
  const c = cambioDeRecomendacion(r.status, nuevo);
  if ('error' in c) return { status: 422, body: { error: c.error } };
  if ('noop' in c) return { status: 200, body: { recomendacion: r } };
  const enviado = nuevo === 'seguida' ? textoEnviado(cuerpo?.sent_text) : null;
  const filas = await patchCondicionado<RecoFila>('social_advisor_recommendations', id, r.status,
    { status: nuevo, status_by: sub, status_at: new Date().toISOString(), ...(enviado ? { sent_text: enviado } : {}) });
  if (!filas.length) return { status: 409, body: { error: 'la recomendación cambió de estado mientras tanto; vuelve a cargarla' } };
  // «Hecho» sobre el consejo de un comentario: el comentario queda atendido (Sam, 2026-10-26). Si ya estaba cerrado o
  // la tabla aún no existe, la recomendación igual queda seguida: se registra y se sigue.
  const comentario = idDeComentario(r.post_comment_id);
  if (nuevo === 'seguida' && typeof comentario === 'number') {
    try {
      const c = await cerrar(comentario, 'hecho', sub, id);
      if (!c.ok && c.status !== 409) console.error(`[asesor] cerrar el comentario ${comentario}: ${c.error}`);
    } catch (e) { console.error(`[asesor] cerrar el comentario ${comentario}: ${e instanceof Error ? e.message : e}`); }
  }
  return { status: 200, body: { recomendacion: filas[0] } };
}

/**
 * Un despertar a demanda del asesor para UNA marca del alcance; con `post_comment_id`, sobre ese comentario.
 * El índice único deja uno pendiente por marca y comentario.
 */
async function despertar(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  const marca = String(cuerpo?.marca ?? '').trim();
  if (!marca) return { status: 400, body: { error: 'falta la marca' } };
  if (alcance !== TODAS && !alcance.includes(marca)) return { status: 403, body: { error: 'forbidden: esa marca no está en tu alcance' } };
  const comentario = idDeComentario(cuerpo?.post_comment_id);
  if (comentario === undefined) return { status: 400, body: { error: 'post_comment_id inválido' } };
  const publicacion = idDePublicacion(cuerpo?.scheduled_post_id);
  if (publicacion === undefined) return { status: 400, body: { error: 'scheduled_post_id inválido' } };
  if (comentario !== null && publicacion !== null) return { status: 400, body: { error: 'pide consejo sobre un comentario o sobre una publicación, no ambos' } };
  if (publicacion !== null) {
    const [p] = await sbGet<{ brand_id: string }>(`scheduled_posts?select=brand_id&id=eq.${publicacion}`);
    if (!p || p.brand_id !== marca) return { status: 404, body: { error: 'publicación no encontrada' } };
  }
  if (comentario !== null) {
    // El comentario tiene que ser de esa marca y de un tercero: de otra marca responde igual que inexistente.
    const [c] = await sbGet<{ brand_id: string; from_brand: boolean }>(`post_comments?select=brand_id,from_brand&id=eq.${comentario}`, 'content');
    if (!c || c.brand_id !== marca) return { status: 404, body: { error: 'comentario no encontrado' } };
    if (c.from_brand) return { status: 422, body: { error: 'ese comentario es de la marca: no hay nada que responder' } };
  }
  const res = await fetch(`${SB_URL()}/rest/v1/social_advisor_wakes`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Profile': 'intel',
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ brand_id: marca, reasons: ['a_pedido'], requested_by: sub, status: 'pendiente',
      ...(comentario !== null ? { post_comment_id: comentario } : {}), ...(publicacion !== null ? { scheduled_post_id: publicacion } : {}) }),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    // 23505 = el índice único de «un pendiente por marca»: no es un fallo, es que ya hay uno en cola.
    if (res.status === 409 || detalle.includes('23505')) {
      return { status: 409, body: { error: comentario !== null
        ? 'ya pediste consejo sobre este comentario: llega en unos minutos'
        : publicacion !== null ? 'ya pediste consejo sobre esta publicación: llega en unos minutos'
        : 'ya hay un pedido de consejo en cola para esta marca' } };
    }
    if (publicacion !== null && detalle.includes('PGRST204')) {
      return { status: 503, body: { error: 'pedir consejo sobre una publicación todavía no está disponible: falta aplicar su migración' } };
    }
    throw new LecturaFallida('social_advisor_wakes (POST)', `HTTP ${res.status} ${detalle.slice(0, 300)}`);
  }
  return { status: 202, body: { ok: true } };
}

async function cambiar(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  if (cuerpo?.tipo === 'recomendacion') return cambiarRecomendacion(cuerpo, sub, alcance);
  if (cuerpo?.tipo === 'despertar') return despertar(cuerpo, sub, alcance);
  const id = String(cuerpo?.id ?? '');
  const nuevo = String(cuerpo?.status ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400, body: { error: 'id inválido' } };
  const [t] = await sbGet<TarjetaFila>(`signal_cards?select=${COLUMNAS}&id=eq.${id}`, 'intel');
  // Fuera del alcance responde igual que inexistente: no se confirma que exista una tarjeta de otra marca.
  if (!t || (alcance !== TODAS && !alcance.includes(t.brand_id))) return { status: 404, body: { error: 'tarjeta no encontrada' } };
  const tipos = await acciones();
  if (!visiblePara(tipos.get(t.action_key), alcance === TODAS)) return { status: 404, body: { error: 'tarjeta no encontrada' } };
  const c = cambioDeEstado(t.status, nuevo);
  if ('error' in c) return { status: 422, body: { error: c.error } };
  if ('noop' in c) return { status: 200, body: { tarjeta: t } };
  // Escritura condicionada al estado leído: si otro operador la cambió entretanto, 409 y no se pisa.
  const filas = await patchCondicionado<TarjetaFila>('signal_cards', id, t.status,
    { status: nuevo, status_by: sub, status_at: new Date().toISOString() });
  if (!filas.length) return { status: 409, body: { error: 'la tarjeta cambió de estado mientras tanto; vuelve a cargarla' } };
  return { status: 200, body: { tarjeta: filas[0] } };
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
      return res.status(200).json(await listar(req, c.marcas, puerta.alcance === TODAS));
    }
    const cuerpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const r = await cambiar(cuerpo, puerta.sesion.sub, puerta.alcance);
    return res.status(r.status).json(r.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'cuerpo JSON ilegible' });
    console.error(`[asesor] ${req.method} falló: ${msg}`);
    return res.status(503).json({ error: err instanceof LecturaFallida ? 'lectura_fallida' : 'error', detail: msg });
  }
}
