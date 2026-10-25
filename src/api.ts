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

export interface Marca { brand_id: string; nombre: string; huso: string | null; plataformas_en_vivo: string[] }
export interface Catalogo { sub: string; role: string; marcas: Marca[]; alcance_total: boolean }

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
  series: { metric: string; nota: string | null; puntos: { fecha: string; value: number | null; motivo: string | null; provisional: boolean }[] }[];
  totales: { metric: string; total: number; dias: number; nota: string | null }[];
  campos: { metric: string; value: number; fecha: string }[];
  desgloses: { metric: string; breakdown: string; valores: { valor: string; total: number }[] }[];
  bloqueadas: { metric: string; breakdown: string; min_followers: number | null; motivo: string; nota: string | null }[];
  sinDatos: { metric: string; breakdown: string }[];
}

// ── Comentarios (`/api/comments`, SocialLab #14) ──────────────────────────────

export type EstadoComentario = 'sin_responder' | 'fallida' | 'en_curso' | 'respondido' | 'de_la_marca';
export interface RespuestaComentario {
  id: string; post_comment_id: number; status: 'requested' | 'sent' | 'verified' | 'failed';
  message: string | null; requested_by: string | null; requested_at: string;
  platform_reply_id: string | null; sent_at: string | null; verified_at: string | null; error: string | null;
}
export interface Comentario {
  id: number; platform: string; platform_comment_id: string; scheduled_post_id: string | null; brand_id: string;
  platform_post_id: string; parent_comment_id: string | null; author_name: string | null; from_brand: boolean;
  text: string | null; like_count: number | null; commented_at: string; first_seen_at: string | null;
  estado: EstadoComentario; respuestas: RespuestaComentario[];
}
export interface RespComentarios {
  ventana: { desde: string; hasta: string }; total: number; pendientes: number; truncado: boolean; comentarios: Comentario[];
}

export async function comentarios(token: string, params: Record<string, string | undefined> = {}): Promise<RespComentarios> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return leer<RespComentarios>(await fetch(`/api/comments?${qs}`, { headers: { Authorization: `Bearer ${token}` } }));
}

export async function responderComentario(token: string, postCommentId: number, message: string): Promise<{ respuesta: RespuestaComentario }> {
  return leer(await fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ post_comment_id: postCommentId, message }),
  }));
}
