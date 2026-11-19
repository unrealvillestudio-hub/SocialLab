/**
 * SocialLab — api/_mediaPlan.ts
 *
 * QUÉ SE PUBLICA, SEGÚN LA FILA (2026-11-19). Puro: sin red, sin Supabase y sin MCP, para que un test
 * lo ejecute tal cual. `api/publish.ts` no se puede importar desde Node (ver `_igContainer.ts`).
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────────────────────
 * Sam (2026-10-31): el feed va «lo más vertical posible», con 25 % imagen, 50 % reel y 25 % carrusel.
 * Sam (2026-11-01 y 2026-11-08): cada publicación de feed y cada reel generan una story derivada, en
 * Instagram y en la Página de Facebook. Sam (2026-11-19): «SI al MCP de Meta y al PR2».
 * Hasta hoy el publicador sólo sabía de imagen y carrusel [medido: `api/publish.ts` de `main` 1d733c5].
 *
 * ── EL CONTRATO DE LA FILA (`public.scheduled_posts`) ─────────────────────────
 * La fila no gana columnas: el CHECK `scheduled_posts_media_type_check` ya admite IMAGE, CAROUSEL,
 * REELS, VIDEO y STORY [medido el 2026-11-01 contra `pg_constraint`].
 *   media_type NULL / IMAGE  → una imagen en `image_url` (o sólo texto en Facebook). Igual que antes.
 *   media_type CAROUSEL      → 2 a 10 láminas en `media_urls`. Igual que antes.
 *   media_type REELS         → el MP4 en `media_urls[0]`; la portada (JPG) en `image_url`, opcional.
 *                              Es la misma posición donde TikTok ya lee su video (`tiktokVideoUrlOf`).
 *   media_type STORY         → video en `media_urls[0]` si lo hay; si no, imagen en `image_url`.
 *                              Sin texto: ni Instagram ni Facebook aceptan pie en una story.
 *   media_type VIDEO         → no se publica: es el tipo con que la detección registra lo que ya salió
 *                              a mano. Un video para publicar se declara REELS.
 *
 * ── ANTE LA DUDA, NO SE PUBLICA ───────────────────────────────────────────────
 * Un REELS sin video no cae a imagen: se publicaría otra cosa que la aprobada. Falla y dice por qué.
 * Un tipo desconocido tampoco se interpreta: falla con su nombre. La regla es la misma que el 9007.
 */

/** Lo que el publicador hace con una fila. */
export type MediaPlan =
  | { kind: 'single' }
  | { kind: 'carousel'; urls: string[] }
  | { kind: 'reel'; videoUrl: string; coverUrl: string | null }
  | { kind: 'story'; videoUrl: string | null; imageUrl: string | null }
  | { kind: 'invalid'; error: string };

type Fila = { media_type?: string | null; media_urls?: string[] | null; image_url?: string | null };

const esUrl = (u: unknown): u is string => typeof u === 'string' && /^https:\/\//.test(u.trim());

/** Primera URL https de `media_urls`, o null. */
function primeraUrl(fila: Fila): string | null {
  const urls = Array.isArray(fila.media_urls) ? fila.media_urls : [];
  const u = urls.find(esUrl);
  return u ? u.trim() : null;
}

/**
 * Decide qué se publica. PURA. Un error de plan lleva un código nominal al inicio para que el log y
 * `error_message` se puedan agrupar: MEDIA_PLAN_<MOTIVO>.
 */
export function mediaPlanOf(fila: Fila): MediaPlan {
  const tipo = String(fila.media_type ?? '').trim().toUpperCase();
  const imagen = esUrl(fila.image_url) ? fila.image_url!.trim() : null;

  if (tipo === '' || tipo === 'IMAGE') return { kind: 'single' };

  if (tipo === 'CAROUSEL') {
    const urls = (Array.isArray(fila.media_urls) ? fila.media_urls : [])
      .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
    // Menos de 2 láminas: se publica como siempre, como una imagen (comportamiento previo, sin cambios).
    return urls.length >= 2 ? { kind: 'carousel', urls: urls.slice(0, 10) } : { kind: 'single' };
  }

  if (tipo === 'REELS') {
    const video = primeraUrl(fila);
    if (!video) return { kind: 'invalid', error: 'MEDIA_PLAN_REEL_WITHOUT_VIDEO: REELS sin URL https de video en media_urls[0]; no se publica como imagen' };
    return { kind: 'reel', videoUrl: video, coverUrl: imagen };
  }

  if (tipo === 'STORY') {
    const video = primeraUrl(fila);
    if (video) return { kind: 'story', videoUrl: video, imageUrl: null };
    if (imagen) return { kind: 'story', videoUrl: null, imageUrl: imagen };
    return { kind: 'invalid', error: 'MEDIA_PLAN_STORY_WITHOUT_MEDIA: STORY sin video en media_urls[0] ni imagen en image_url' };
  }

  if (tipo === 'VIDEO') {
    return { kind: 'invalid', error: 'MEDIA_PLAN_VIDEO_NOT_PUBLISHABLE: VIDEO registra lo publicado a mano; para publicar un video la fila se declara REELS' };
  }

  return { kind: 'invalid', error: `MEDIA_PLAN_UNKNOWN_TYPE: media_type '${tipo}' no tiene camino de publicación` };
}

// ── LOS PLAZOS DEL VIDEO ──────────────────────────────────────────────────────
//
// Un contenedor de video tarda más que uno de imagen: Instagram descarga el MP4 y lo procesa. Con 90 s
// —el plazo de la imagen— un reel de 60 s podría no llegar a FINISHED. Los dos plazos siguen dentro del
// `PUBLISH_DEADLINE_MS` de la corrida (240 s), que sigue mandando.

/** Cuánto se espera, como mucho, a que UN contenedor de video de Instagram esté listo. */
export const VIDEO_CONTAINER_TIMEOUT_MS = 200_000;
/** Primera consulta de un contenedor de video: antes de esto casi nunca está listo. */
export const VIDEO_FIRST_CHECK_MS = 8_000;
/** Cuánto se espera, como mucho, la confirmación de que Facebook publicó un video de Página. */
export const FB_VIDEO_CONFIRM_TIMEOUT_MS = 150_000;
/** Entre lecturas del estado de un video de Facebook. */
export const FB_VIDEO_CHECK_EVERY_MS = 5_000;

// ── EL ESTADO DE UN VIDEO DE FACEBOOK ─────────────────────────────────────────
//
// Medido hoy en la documentación de Meta (reels-publishing, page-stories-api): `GET /{video-id}?fields=status`
// devuelve `status.video_status` y tres fases. La publicación consta en `publishing_phase.publish_status`.
//
// Facebook publica un reel AL TERMINAR DE PROCESARLO, después de que `finish` respondió `success`. Por
// eso este estado tiene tres salidas y no dos:
//   published  consta publicado.
//   error      el video falló (subida, procesamiento o publicación). No saldrá.
//   pending    todavía no consta. Facebook lo publicará solo: NO es un fallo y NO se reintenta, porque
//              reintentar subiría un segundo reel. El publicador lo da por enviado con su `video_id`.

export type FbVideoState = 'published' | 'error' | 'pending';

/** Lee la respuesta de `fb_get_video_status`. PURA. Lo que no se sabe leer es `pending`, nunca `published`. */
export function leerEstadoVideoFb(texto: string | null): { estado: FbVideoState; detalle: string | null } {
  if (!texto) return { estado: 'pending', detalle: null };
  let d: any;
  try { d = JSON.parse(texto); } catch { return { estado: 'pending', detalle: texto.slice(0, 200) }; }
  const s = d?.status ?? {};
  const video = String(s.video_status ?? '').toLowerCase();
  const pub = String(s.publishing_phase?.publish_status ?? '').toLowerCase();
  const fases = ['uploading_phase', 'processing_phase', 'publishing_phase'];
  const faseError = fases.find((f) => String(s?.[f]?.status ?? '').toLowerCase() === 'error');
  if (faseError || ['error', 'expired', 'upload_failed'].includes(video) || pub === 'error') {
    const msg = faseError ? s[faseError]?.error?.message ?? null : null;
    return { estado: 'error', detalle: `${faseError ?? `video_status=${video || pub}`}${msg ? `: ${msg}` : ''}` };
  }
  if (pub === 'published') return { estado: 'published', detalle: null };
  return { estado: 'pending', detalle: `video_status=${video || '?'} publish_status=${pub || '?'}` };
}
