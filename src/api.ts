// Cliente del tablero. Todo pasa por la API de SocialLab (`/api/session`, `/api/ops`): el navegador
// nunca lee la base ni las plataformas directamente.

export interface Sesion { session_token: string; sub: string; role: string; brand_scope: string[]; expires_in: number }

export class ErrorApi extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function leer<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // `message` nombra la causa concreta (por ejemplo, qué variable de entorno falta); `error` sólo su clase.
    const d = data as { error?: string; message?: string; detail?: string };
    throw new ErrorApi(String(d.message ?? d.detail ?? d.error ?? `Error ${res.status}`), res.status);
  }
  return data as T;
}

export async function entrar(password: string): Promise<Sesion> {
  return leer<Sesion>(await fetch('/api/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  }));
}

export async function ops<T>(token: string, vista: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams({ vista });
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return leer<T>(await fetch(`/api/ops?${qs}`, { headers: { Authorization: `Bearer ${token}` } }));
}

// ── Formas de las respuestas ─────────────────────────────────────────────────

export interface Canal { platform_key: string; platform: string; via: 'carril' | 'manual' | 'externa' }
export interface Marca { brand_id: string; nombre: string; huso: string | null; plataformas_en_vivo: string[]; canales: Canal[] }

/** Las plataformas que se pueden filtrar: los canales activos y las cuentas con lectura en vivo de las marcas elegidas. */
export function plataformasDe(marcas: readonly Marca[], marca: string): string[] {
  const elegidas = marca ? marcas.filter((m) => m.brand_id === marca) : marcas;
  return [...new Set(elegidas.flatMap((m) => [...(m.canales ?? []).map((c) => c.platform), ...m.plataformas_en_vivo]))].sort();
}
/** El color con que el tablero distingue cada plataforma (`intel.signal_platforms.display_color`, dato). */
export interface PlataformaColor { platform: string; color: string | null }
export interface Catalogo { sub: string; role: string; marcas: Marca[]; alcance_total: boolean; plataformas?: PlataformaColor[] }

export interface Metrica { metric: string; value: number; age_minutes: number; fetched_at: string }
export interface Conteo { brand_id: string; platform: string; formato: string; total: number }

export interface Publicada {
  id: string; brand_id: string; platform: string; media_type: string | null; formato: string;
  platform_post_id: string | null; published_at: string; copy_text: string | null; image_url: string | null;
  media_urls: string[] | null; piece_id: string | null; enlace?: string | null; metricas: Metrica[];
  /** La vía por la que salió, según su canal: el carril, una persona a mano o un publicador externo (blog). */
  via?: 'carril' | 'manual' | 'externa' | 'detectada' | 'sin_canal';
}
export interface RespPublicado {
  ventana: { desde: string; hasta: string }; truncado: boolean; total: number; conteos: Conteo[];
  metricas: 'medidas' | 'tabla_inexistente'; publicaciones: Publicada[];
}

export interface EnVivo {
  brand_id: string; platform: string; platform_post_id: string; permalink: string | null; imagen: string | null;
  texto: string | null; publicado_en: string | null; formato: string; scheduled_post_id: string | null;
  piece_id: string | null; en_carril: boolean;
  /** Me gusta y comentarios leídos de la plataforma en esta misma lectura (ver `src/pulso.ts`). */
  contadores: { metric: string; value: number }[];
}
export interface RespEnVivo {
  limite: number; lecturas: Array<{ brand_id: string; platform: string; publicaciones: number; error: string | null }>;
  publicaciones: EnVivo[];
}

export interface Franja {
  id: string; brand_id: string; platform_key: string; slot_at: string; status: string; format: string | null;
  piece_id: string | null; published_at: string | null; failed_reason: string | null;
}
export interface FilaCalendario {
  id: string; brand_id: string; platform: string; status: string; media_type: string | null; scheduled_at: string;
  published_at: string | null; piece_id: string | null; platform_post_id: string | null;
}
export interface RespCalendario { ventana: { desde: string; hasta: string }; franjas: Franja[]; publicaciones: FilaCalendario[] }

export interface RespAhora { minutos: number; estado: 'sin_medir' | 'sin_orden'; motivo: string; publicaciones: Publicada[] }

export interface ResumenMetrica { metric: string; total: number; mediana: number; posts: number }
export interface Estadistica {
  brand_id: string; platform: string; publicaciones: number; medidas: number;
  metricas: ResumenMetrica[];
  porFormato: { formato: string; publicaciones: number }[];
  metricaTop: string | null;
  top: Publicada[];
  porDia: { dia: string; publicaciones: number }[];
}
export interface RespEstadisticas {
  ventana: { desde: string; hasta: string }; truncado: boolean; metricas: 'medidas' | 'tabla_inexistente';
  estadisticas: Estadistica[];
  cuenta: { estado: 'pendiente'; motivo: string } | { estado: 'medida'; relectura_dias: number; truncado: boolean; cuentas: ResumenCuenta[] };
}

/** Lo que SignalLab mide de la cuenta (ver `resumenCuenta` en `api/_opsCore.ts`). */
export interface ResumenCuenta {
  brand_id: string; platform: string;
  seguidores: { value: number; fecha: string } | null;
  series: { metric: string; nota: string | null; agregacion?: 'sum' | 'last'; puntos: { fecha: string; value: number | null; motivo: string | null; provisional: boolean }[] }[];
  totales: { metric: string; total: number; dias: number; nota: string | null }[];
  campos: { metric: string; value: number; fecha: string }[];
  desgloses: { metric: string; breakdown: string; valores: { valor: string; total: number }[] }[];
  bloqueadas: { metric: string; breakdown: string; min_followers: number | null; motivo: string; nota: string | null }[];
  sinDatos: { metric: string; breakdown: string }[];
}

// ── Comentarios (`/api/comments`, SocialLab #14) ──────────────────────────────

export type EstadoComentario = 'sin_responder' | 'fallida' | 'en_curso' | 'respondido' | 'cerrado' | 'allegado' | 'de_la_marca';
/** Cuenta del equipo o allegada de la marca (Sam, 2026-10-26): sus comentarios no esperan respuesta. */
export type Relacion = 'equipo' | 'allegado';
/** Cómo se cierra un comentario sin responderlo desde el tablero (Sam, 2026-10-26). */
export type TipoCierre = 'hecho' | 'descartado' | 'contestado_fuera';
export interface CierreComentario { kind: TipoCierre; closed_by: string; closed_at: string }
export interface RespuestaComentario {
  id: string; post_comment_id: number; status: 'requested' | 'sent' | 'verified' | 'failed';
  /** `publica` (en el hilo) o `privada` (mensaje a quien comentó). */
  kind?: 'publica' | 'privada';
  message: string | null; requested_by: string | null; requested_at: string;
  platform_reply_id: string | null; sent_at: string | null; verified_at: string | null; error: string | null;
}
export interface Comentario {
  id: number; platform: string; platform_comment_id: string; scheduled_post_id: string | null; brand_id: string;
  platform_post_id: string; parent_comment_id: string | null; author_name: string | null; from_brand: boolean;
  text: string | null; like_count: number | null; commented_at: string; first_seen_at: string | null;
  estado: EstadoComentario; respuestas: RespuestaComentario[];
  /** Si se puede responder en privado a quien comentó y, si no, por qué (SocialLab #20). */
  privada?: { puede: boolean; motivo: string | null; hasta: string | null };
  /** El cierre del comentario, si el operador lo cerró sin responderlo. */
  cierre?: CierreComentario | null;
  /** Si quien lo escribió está marcado como allegado o del equipo. */
  allegado?: Relacion | null;
  /** La meta de respuesta de su marca y plataforma, en minutos, y lo que se tardó en responderlo (null = sin respuesta). */
  meta_min?: number | null; respondido_en_min?: number | null;
  /** La intención del comentario según el catálogo (`intel.comment_intents`); null sin catálogo o si es de la marca. */
  intencion?: IntencionComentario | null;
}
/** Una intención del catálogo: etiqueta, prioridad (menor = antes) y color, todo dato (Sam, 2026-10-26). */
export interface IntencionComentario { intent_key: string; label: string; priority: number; display_color: string | null; fallback: boolean }
/** Tiempo de respuesta de una marca en una plataforma, en la ventana (Sam, 2026-10-26). */
export interface TiempoDeRespuesta {
  brand_id: string; platform: string; meta_min: number | null; respondidos: number; mediana_min: number | null;
  dentro_pct: number | null; fuera_de_meta: number;
}
export interface RespComentarios {
  ventana: { desde: string; hasta: string }; total: number; pendientes: number; truncado: boolean; comentarios: Comentario[];
  tiempos?: TiempoDeRespuesta[];
}

export async function comentarios(token: string, params: Record<string, string | undefined> = {}): Promise<RespComentarios> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return leer<RespComentarios>(await fetch(`/api/comments?${qs}`, { headers: { Authorization: `Bearer ${token}` } }));
}

export async function responderComentario(token: string, postCommentId: number, message: string, privada = false): Promise<{ respuesta: RespuestaComentario }> {
  return leer(await fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ post_comment_id: postCommentId, message, ...(privada ? { privada: true } : {}) }),
  }));
}

/** Cierra un comentario sin responderlo (`kind`) o lo reabre (`null`). */
export async function cerrarComentario(token: string, postCommentId: number, kind: TipoCierre | null): Promise<unknown> {
  return leer(await fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(kind ? { tipo: 'cierre', post_comment_id: postCommentId, kind } : { tipo: 'reabrir', post_comment_id: postCommentId }),
  }));
}

/** Marca a quien escribió el comentario como allegado o del equipo (`relation`), o quita la marca (`null`). */
export async function marcarAllegado(token: string, postCommentId: number, relation: Relacion | null): Promise<unknown> {
  return leer(await fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(relation ? { tipo: 'allegado', post_comment_id: postCommentId, relation } : { tipo: 'quitar_allegado', post_comment_id: postCommentId }),
  }));
}

/**
 * Publica un comentario de la marca en su propia publicación (Sam, 2026-10-26): abrir un debate, mencionar a un aliado.
 * Con `recomendacionId`, el consejo queda seguido con lo publicado. `verificado` = la plataforma lo devolvió al leerlo.
 */
export async function comentarEnPublicacion(token: string, scheduledPostId: string, message: string, recomendacionId?: string):
  Promise<{ comentario: { id: string; verificado: boolean; motivo: string | null } }> {
  return leer(await fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tipo: 'comentar', scheduled_post_id: scheduledPostId, message, ...(recomendacionId ? { recomendacion_id: recomendacionId } : {}) }),
  }));
}

// ── Asesor (`/api/tarjetas`, tarjetas de acción de SignalLab) ─────────────────

export type Severidad = 'atencion' | 'oportunidad' | 'info';
export type EstadoTarjeta = 'nueva' | 'vista' | 'seguida' | 'descartada' | 'resuelta';
export interface Tarjeta {
  id: string; rule_key: string; card_type: string; severity: Severidad; brand_id: string; platform: string;
  scheduled_post_id: string | null; post_comment_id: number | null; action_key: string;
  objective: string; what_text: string; why_text: string;
  metric: string | null; value: number | null; baseline_value: number | null; baseline_level: string | null; baseline_size: number | null;
  status: EstadoTarjeta; status_by: string | null; status_at: string | null; created_at: string;
  accion: { label: string; via: 'api' | 'app_nativa' | 'interna' };
}
/** Una recomendación del asesor: texto para el operador y, a veces, un borrador de respuesta. */
export interface Recomendacion {
  id: string; brand_id: string; platform: string | null; card_id: string | null;
  post_comment_id: number | null; scheduled_post_id: string | null; action_key: string;
  objective: string; recommendation: string; draft: string | null;
  status: 'nueva' | 'seguida' | 'descartada' | 'caducada'; status_by: string | null; status_at: string | null;
  sent_text: string | null; created_at: string;
  accion: { label: string; via: 'api' | 'app_nativa' | 'interna' };
}
/** Cómo va el último pedido de consejo sobre un comentario (sin nada del despertar: ni costo ni modelo). */
export interface PedidoConsejo { post_comment_id: number; estado: 'pendiente' | 'sin_consejo' | 'con_consejo' }
/** Lo mismo, sobre una publicación (Sam, 2026-10-26). */
export interface PedidoConsejoPublicacion { scheduled_post_id: string; estado: 'pendiente' | 'sin_consejo' | 'con_consejo' }
export interface RespTarjetas {
  truncado: boolean; nuevas: number; tarjetas: Tarjeta[]; recomendaciones?: Recomendacion[]; pedidos?: PedidoConsejo[];
  pedidos_publicacion?: PedidoConsejoPublicacion[];
}

export async function tarjetas(token: string, params: Record<string, string | undefined> = {}): Promise<RespTarjetas> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return leer<RespTarjetas>(await fetch(`/api/tarjetas?${qs}`, { headers: { Authorization: `Bearer ${token}` } }));
}

export async function cambiarTarjeta(token: string, id: string, status: 'vista' | 'seguida' | 'descartada'): Promise<{ tarjeta: Tarjeta }> {
  return leer(await fetch('/api/tarjetas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id, status }),
  }));
}

/** Seguir o descartar una recomendación. `sent_text` es lo que de verdad se envió (para medir la edición del borrador). */
export async function cambiarRecomendacion(token: string, id: string, status: 'seguida' | 'descartada', sentText?: string): Promise<unknown> {
  return leer(await fetch('/api/tarjetas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tipo: 'recomendacion', id, status, ...(sentText ? { sent_text: sentText } : {}) }),
  }));
}

/**
 * Pone en cola un despertar del asesor para una marca; con `postCommentId`, consejo sobre ese comentario; con
 * `scheduledPostId`, sobre esa publicación (Sam, 2026-10-26). 409 = ya hay uno en cola.
 */
export async function pedirConsejo(token: string, marca: string, postCommentId?: number, scheduledPostId?: string): Promise<unknown> {
  return leer(await fetch('/api/tarjetas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tipo: 'despertar', marca, ...(postCommentId != null ? { post_comment_id: postCommentId } : {}),
      ...(scheduledPostId ? { scheduled_post_id: scheduledPostId } : {}) }),
  }));
}

// ── MENSAJES DIRECTOS (Sam, 2026-10-26; mejora 5) ─────────────────────────────────────────────────

export type EstadoHilo = 'sin_responder' | 'fallida' | 'en_curso' | 'respondido' | 'allegado';
export interface MensajeDM {
  id: number; thread_id: number; from_brand: boolean; author_name: string | null; author_platform_id: string | null;
  text: string | null; sent_at: string;
}
export interface RespuestaDM {
  id: string; thread_id: number; status: 'requested' | 'sent' | 'verified' | 'failed'; message: string;
  requested_by: string; requested_at: string; sent_at: string | null; platform_message_id: string | null; error: string | null;
}
export interface HiloDM {
  id: number; platform: string; brand_id: string; participant_platform_id: string | null; participant_name: string | null;
  updated_at: string | null; estado: EstadoHilo; allegado: Relacion | null; mensajes: MensajeDM[]; respuestas: RespuestaDM[];
  ultimo_at: string | null; espera_desde: string | null; intencion: IntencionComentario | null; meta_min: number | null;
  /** Si todavía se puede responder: la plataforma sólo deja hacerlo dentro de su ventana tras el último mensaje. */
  responder: { puede: boolean; hasta: string | null; motivo: string | null };
}
export interface RespMensajes {
  disponible: boolean; motivo: string | null; ventana: { desde: string; hasta: string }; total: number; pendientes: number;
  truncado?: boolean; hilos: HiloDM[];
}

export async function mensajes(token: string, params: Record<string, string | undefined> = {}): Promise<RespMensajes> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return leer<RespMensajes>(await fetch(`/api/mensajes?${qs}`, { headers: { Authorization: `Bearer ${token}` } }));
}

export async function responderMensaje(token: string, threadId: number, message: string): Promise<{ respuesta: RespuestaDM }> {
  return leer(await fetch('/api/mensajes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ thread_id: threadId, message }),
  }));
}

/** Marca (o desmarca, con `null`) a la persona de la conversación como allegada o del equipo. */
export async function marcarAllegadoDM(token: string, threadId: number, relation: Relacion | null): Promise<unknown> {
  return leer(await fetch('/api/mensajes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(relation ? { tipo: 'allegado', thread_id: threadId, relation } : { tipo: 'quitar_allegado', thread_id: threadId }),
  }));
}

// ── MEJOR HORA (Sam, 2026-10-26; mejora 6) ──────────────────────────────────────────────────────────

export interface FranjaHora { inicio: number; fin: number; publicaciones: number; mediana: number | null; comparable: boolean }
export interface MejorHoraCuenta {
  brand_id: string; platform: string; huso: string | null; metrica: string; franjas: FranjaHora[];
  estado: 'comparable' | 'datos_insuficientes';
  mejor: { inicio: number; fin: number; mediana: number; ventaja_pct: number | null } | null;
  motivo: string;
}
export interface RespMejorHora {
  disponible: boolean; motivo: string | null;
  config?: { edad_minutos: number; banda_horas: number; minimo_por_franja: number; ventana_dias: number };
  cuentas: MejorHoraCuenta[];
}
