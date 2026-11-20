/**
 * SocialLab — api/_tiktok.ts
 *
 * EL BLOQUE PURO DE TIKTOK: URLs de la API, construcción del authorize URL, lectura de las
 * respuestas de OAuth y de Content Posting, caducidad del access token y la firma del `state`
 * del callback. Sin red, sin Supabase y sin reloj del sistema (el `now` entra por parámetro),
 * para que un test lo ejecute tal cual con Node >= 22 (type stripping nativo).
 *
 * El prefijo `_` marca módulo, NO ruta de Vercel. Lo que habla con la red vive en `_tiktokApi.ts`
 * y en `tiktok-oauth.ts`; aquí queda lo que se decide sin red y se prueba caso por caso — mismo
 * criterio que `_igContainer.ts`.
 *
 * ── LA VÍA, MEDIDA CONTRA LA DOC OFICIAL EL 2026-10-28 ────────────────────────
 *   Authorize   GET  https://www.tiktok.com/v2/auth/authorize/           (Login Kit v2 web)
 *   Token       POST https://open.tiktokapis.com/v2/oauth/token/         (x-www-form-urlencoded)
 *   Inbox init  POST https://open.tiktokapis.com/v2/post/publish/inbox/video/init/   (JSON)
 *   Subida      PUT  <upload_url que devuelve el init>, por partes con Content-Range  (FILE_UPLOAD)
 *   Status      POST https://open.tiktokapis.com/v2/post/publish/status/fetch/       (JSON)
 *   Creator     POST https://open.tiktokapis.com/v2/post/publish/creator_info/query/ (Direct Post, antes de cada post)
 *   Direct init POST https://open.tiktokapis.com/v2/post/publish/video/init/         (Direct Post, `video.publish`)
 *
 * DOS MODOS, ELEGIDOS POR DATO EN EL CANAL DE CADA MARCA (`intel.brand_publish_channels.config.post_mode`):
 *   · `inbox`  (`video.upload`)  — borrador al inbox; la persona lo termina en la app. Exento de auditoría.
 *                                  Es el modo si el canal no declara ninguno: el comportamiento de siempre.
 *   · `direct` (`video.publish`) — Direct Post: TikTok lo publica. Sam lo autorizó el 2026-11-20. Mientras
 *                                  la app no esté auditada, TikTok sólo admite `SELF_ONLY` (privado).
 *
 * > ⛔ NO OPERATIVO — redacción anterior (hasta 2026-11-20): «`video.upload` (borrador al inbox) es la vía
 * > EXENTA de auditoría. El posteo público directo (`video.publish`) exige auditoría con video demo y
 * > queda fuera de este módulo a propósito.»
 */

// El `state` firmado del OAuth es genérico (TikTok y LinkedIn lo comparten) y vive en
// `_oauthState.ts`. No se re-exporta desde aquí a propósito: así este módulo puro no importa a
// ningún otro y el test de Node lo carga tal cual (el type stripping nativo no reescribe `.js`→`.ts`).

// ── CONSTANTES DE LA API ───────────────────────────────────────────────────────

export const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_TOKEN_URL     = 'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_INBOX_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
export const TIKTOK_STATUS_URL     = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
export const TIKTOK_CREATOR_INFO_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
export const TIKTOK_DIRECT_INIT_URL  = 'https://open.tiktokapis.com/v2/post/publish/video/init/';

/**
 * Scopes que pide el OAuth. `user.info.basic` identifica a la cuenta en el callback; `video.upload` crea el
 * borrador (modo `inbox`); `video.publish` publica directo (modo `direct`, Sam 2026-11-20). Se piden los dos
 * para que cambiar el modo de una marca sea cambiar un dato, sin volver a autorizar. Una cuenta autorizada
 * antes del 2026-11-20 no tiene `video.publish`: hay que reautorizarla. Lista de SUPERFICIES, no de marcas.
 */
export const TIKTOK_SCOPES = ['user.info.basic', 'video.upload', 'video.publish'] as const;

/** Nombre del proveedor en la tabla de tokens. Es un eje (la superficie), no una marca. */
export const TIKTOK_PROVIDER = 'tiktok';

/**
 * Margen de seguridad para considerar caducado un access token antes de su hora real. El token
 * dura 24 h; refrescar un minuto antes evita que una publicación larga se quede sin token a medias.
 */
export const ACCESS_TOKEN_SKEW_MS = 60_000;

// ── TIPOS ────────────────────────────────────────────────────────────────────

/** Un token normalizado tal como se guarda en `social_oauth_tokens`. Épocas en ms. */
export interface TikTokTokenRecord {
  open_id: string;
  access_token: string;
  refresh_token: string;
  scope: string;
  access_token_expires_at: number;   // epoch ms
  refresh_token_expires_at: number;  // epoch ms
}

// ── AUTHORIZE URL ──────────────────────────────────────────────────────────────

/**
 * El authorize URL de Login Kit v2. `scope` va como lista separada por comas (lo exige TikTok).
 * `state` es obligatorio en la práctica: TikTok lo devuelve sin tocar y así se verifica el callback.
 * No se usa PKCE: es un cliente confidencial de servidor (el `client_secret` vive en el backend),
 * y la doc de web no lista parámetros PKCE.
 */
export function buildAuthorizeUrl(params: {
  clientKey: string;
  redirectUri: string;
  scope: readonly string[];
  state: string;
}): string {
  const u = new URL(TIKTOK_AUTHORIZE_URL);
  u.searchParams.set('client_key', params.clientKey);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', params.scope.join(','));
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('state', params.state);
  return u.toString();
}

// ── LECTURA DE LA RESPUESTA DE TOKEN ─────────────────────────────────────────────

/** Lo que resulta de leer una respuesta de `/oauth/token/`: un token normalizado o un motivo. */
export type TokenParse =
  | { ok: true; record: TikTokTokenRecord }
  | { ok: false; error: string };

/**
 * Normaliza la respuesta de intercambio o de refresh. `now` entra por parámetro para fijar las
 * épocas de caducidad sin leer el reloj aquí. OJO: el refresh puede devolver un refresh_token
 * DISTINTO del enviado — hay que guardar el nuevo (doc oficial), y por eso el almacén es de
 * escritura y no un secreto de sólo lectura.
 */
export function parseTokenResponse(json: unknown, now: number): TokenParse {
  const j = (json ?? {}) as Record<string, unknown>;
  // La respuesta de error de OAuth v2 trae `error` (string) y `error_description`.
  if (typeof j.error === 'string' && j.error && j.error !== 'ok') {
    return { ok: false, error: `${j.error}: ${String(j.error_description ?? '')}`.trim() };
  }
  const access = j.access_token;
  const refresh = j.refresh_token;
  const openId = j.open_id;
  if (typeof access !== 'string' || !access) return { ok: false, error: 'respuesta sin access_token' };
  if (typeof refresh !== 'string' || !refresh) return { ok: false, error: 'respuesta sin refresh_token' };
  const expiresIn = Number(j.expires_in ?? 0);
  const refreshExpiresIn = Number(j.refresh_expires_in ?? 0);
  return {
    ok: true,
    record: {
      open_id: typeof openId === 'string' ? openId : '',
      access_token: access,
      refresh_token: refresh,
      scope: typeof j.scope === 'string' ? j.scope : '',
      access_token_expires_at: now + Math.max(0, expiresIn) * 1000,
      refresh_token_expires_at: now + Math.max(0, refreshExpiresIn) * 1000,
    },
  };
}

/** ¿Hay que refrescar el access token? `true` también si falta la fecha, por prudencia. */
export function isAccessTokenExpired(expiresAtMs: number, now: number, skewMs = ACCESS_TOKEN_SKEW_MS): boolean {
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return true;
  return now + skewMs >= expiresAtMs;
}

// ── INBOX INIT (FILE_UPLOAD) ────────────────────────────────────────────────────
//
// Decisión de Sam del 2026-11-20 (reportada por la sesión de la app de TikTok): el video se SUBE
// (`FILE_UPLOAD`), no se hace que TikTok lo descargue (`PULL_FROM_URL`). Motivo, medido por esa sesión
// en el portal: `pull_by_url` exige verificar el dominio que aloja el video, y el MP4 vive en un host
// de almacenamiento que no es nuestro y no se puede verificar; `push_by_file` no lo exige.
//
// REGLAS DE LAS PARTES — `reportado`: citadas textualmente del portal de TikTok («Media Transfer Guide»
// y «API Reference / Video / Upload», ambas «Last updated August 4, 2026») por la sesión «AAA -
// UNRLVL-Publisher + LinkedIn + TikTok APP» el 2026-11-20 (developers.tiktok.com no resuelve desde el
// contenedor de CC). Viven SÓLO aquí:
//   · «Videos with a total size less than 5 MB must be uploaded as a whole, with chunk_size equal to
//     the entire video's byte size»; entre 5 y 64 MB puede ir en una sola parte; más de 64 MB, en varias.
//   · «Each chunk must be at least 5 MB but no greater than 64 MB, except for the final chunk, which can
//     be greater than chunk_size (up to 128 MB) to accommodate any trailing bytes.»
//   · «total_chunk_count should be equal to video_size divided by chunk_size, rounded down»; «a minimum
//     of 1 chunk and a maximum of 1000 chunks»; «File chunks must be uploaded sequentially.»
//   · PUT al upload_url COMPLETO con Content-Type (sólo video/mp4, video/quicktime, video/webm),
//     Content-Length de ESA parte y «Content-Range: bytes {FIRST_BYTE}-{LAST_BYTE}/{TOTAL_BYTE_LENGTH}»;
//     206 en las intermedias, 201 en la última. «The upload_url is valid for one hour after issuance.»
//   · Video de hasta 4 GB. Errores del PUT: 400, 403 (upload_url caducada), 404, 416; 5xx se reintenta.
//   · El init puede devolver 403 `spam_risk_too_many_pending_share`: como mucho 5 borradores pendientes
//     por usuario en 24 h.

export const TIKTOK_CHUNK_MIN_BYTES   = 5 * 1024 * 1024;
export const TIKTOK_CHUNK_MAX_BYTES   = 64 * 1024 * 1024;
export const TIKTOK_FINAL_CHUNK_MAX_BYTES = 128 * 1024 * 1024;
export const TIKTOK_MAX_CHUNKS        = 1000;
export const TIKTOK_MAX_VIDEO_BYTES   = 4 * 1024 * 1024 * 1024;
/** Reintentos de UNA parte ante un 5xx de la subida. 4xx no se reintenta: es un error de la petición. */
export const TIKTOK_CHUNK_RETRIES_5XX = 1;
/**
 * Tamaño de parte preferido. Pequeño a propósito: cada parte se descarga del almacenamiento y se sube
 * sin tener el MP4 entero en memoria, así que el pico de memoria es como mucho dos partes (la última
 * recoge el resto, < 2 × chunk).
 */
export const TIKTOK_CHUNK_PREFERRED_BYTES = 10 * 1024 * 1024;
/**
 * Tiempo máximo para descargar y subir todas las partes, por debajo del `maxDuration: 300` de `vercel.json`
 * (y muy por debajo de la hora que vale el upload_url).
 */
export const TIKTOK_UPLOAD_BUDGET_MS = 240_000;
/** Tipos de video que acepta la subida. Cualquier otro se envía como `video/mp4`. */
export const TIKTOK_UPLOAD_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

/** Una parte: bytes [start, end], ambos incluidos. */
export interface ChunkRange { start: number; end: number }

/** El plan de subida, o el motivo por el que no se puede subir. */
export type ChunkPlan =
  | { ok: true; video_size: number; chunk_size: number; total_chunk_count: number; ranges: ChunkRange[] }
  | { ok: false; error: string };

/** Parte un video de `videoSize` bytes según las reglas de arriba. Puro: no toca red ni memoria. */
export function planChunks(videoSize: number, preferred = TIKTOK_CHUNK_PREFERRED_BYTES): ChunkPlan {
  if (!Number.isSafeInteger(videoSize) || videoSize <= 0) {
    return { ok: false, error: `tamaño de video inválido: ${videoSize}` };
  }
  if (videoSize > TIKTOK_MAX_VIDEO_BYTES) {
    return { ok: false, error: `el video (${videoSize} bytes) pasa del máximo de TikTok (${TIKTOK_MAX_VIDEO_BYTES} bytes)` };
  }
  if (videoSize < TIKTOK_CHUNK_MIN_BYTES || videoSize <= preferred) {
    return { ok: true, video_size: videoSize, chunk_size: videoSize, total_chunk_count: 1,
      ranges: [{ start: 0, end: videoSize - 1 }] };
  }
  // Con el tope de 4 GB y partes de al menos 5 MB salen como mucho 819 partes: el máximo de 1000 se
  // comprueba igual abajo, como guarda, por si cambian el tope o el tamaño preferido.
  const chunk = Math.min(Math.max(preferred, TIKTOK_CHUNK_MIN_BYTES), TIKTOK_CHUNK_MAX_BYTES);
  const count = Math.floor(videoSize / chunk);
  if (count === 1) {
    // Menos de dos partes: se sube entero (cabe en una parte, por debajo del máximo de 64 MB).
    return { ok: true, video_size: videoSize, chunk_size: videoSize, total_chunk_count: 1,
      ranges: [{ start: 0, end: videoSize - 1 }] };
  }
  const ultima = videoSize - (count - 1) * chunk;
  if (count > TIKTOK_MAX_CHUNKS || ultima > TIKTOK_FINAL_CHUNK_MAX_BYTES) {
    return { ok: false, error: `el video (${videoSize} bytes) no cabe en ${TIKTOK_MAX_CHUNKS} partes de hasta ${TIKTOK_CHUNK_MAX_BYTES} bytes` };
  }
  const ranges: ChunkRange[] = [];
  for (let i = 0; i < count; i++) {
    ranges.push({ start: i * chunk, end: i === count - 1 ? videoSize - 1 : (i + 1) * chunk - 1 });
  }
  return { ok: true, video_size: videoSize, chunk_size: chunk, total_chunk_count: count, ranges };
}

/** El cuerpo JSON del init del inbox por subida de archivo. */
export function buildInboxInitBody(plan: { video_size: number; chunk_size: number; total_chunk_count: number }): {
  source_info: { source: 'FILE_UPLOAD'; video_size: number; chunk_size: number; total_chunk_count: number };
} {
  return { source_info: { source: 'FILE_UPLOAD', video_size: plan.video_size,
    chunk_size: plan.chunk_size, total_chunk_count: plan.total_chunk_count } };
}

/** La cabecera `Content-Range` de una parte. */
/**
 * El mensaje de un init fallido (borrador o Direct Post). Los códigos que tienen una acción conocida se
 * explican: no son fallos del carril.
 */
export function inboxInitErrorMessage(code: string, message: string): string {
  const base = `TikTok init falló (${code})${message ? `: ${message}` : ''}`;
  if (code === 'spam_risk_too_many_pending_share') {
    return `${base}. La cuenta ya tiene 5 borradores pendientes en las últimas 24 h: hay que publicarlos o descartarlos en la app de TikTok antes de enviar otro.`;
  }
  if (code === 'unaudited_client_can_only_post_to_private_accounts') {
    return `${base}. La app no está auditada: Direct Post sólo admite privacy_level SELF_ONLY. Revisar config.privacy_level del canal.`;
  }
  if (code === 'scope_not_authorized') {
    return `${base}. El token de la marca no tiene el permiso que pide este modo (video.publish para direct): hay que reautorizar la cuenta con /api/tiktok-oauth.`;
  }
  return base;
}

/** ¿Se reintenta la subida de una parte con este código HTTP? Sólo 5xx. */
export function chunkStatusRetryable(status: number): boolean {
  return status >= 500 && status <= 599;
}

export function contentRangeOf(r: ChunkRange, total: number): string {
  return `bytes ${r.start}-${r.end}/${total}`;
}

/** El tipo de contenido de la subida: el del origen si es uno aceptado, si no `video/mp4`. */
export function uploadContentTypeOf(sourceType: string | null | undefined): string {
  const t = (sourceType ?? '').split(';')[0].trim().toLowerCase();
  return (TIKTOK_UPLOAD_CONTENT_TYPES as readonly string[]).includes(t) ? t : 'video/mp4';
}

/**
 * El tamaño total del video a partir de las cabeceras del origen: `Content-Range: bytes 0-0/<total>`
 * de una lectura parcial, o si no `Content-Length`. Sin un número entero positivo devuelve `null`:
 * no se sube un video cuyo tamaño no se conoce, porque el init lo exige.
 */
export function videoSizeFromHeaders(h: { contentRange?: string | null; contentLength?: string | null }): number | null {
  const m = /\/(\d+)\s*$/.exec(h.contentRange ?? '');
  const n = m ? Number(m[1]) : Number(h.contentLength ?? NaN);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// ── DIRECT POST (video.publish) ─────────────────────────────────────────────────────
//
// Especificación `reportado`: citada textualmente del portal por la sesión «AAA - UNRLVL-Publisher + LinkedIn +
// TikTok APP» el 2026-11-20 (developers.tiktok.com no resuelve desde el contenedor de CC):
//   · POST /v2/post/publish/video/init/ con `post_info` y `source_info` (FILE_UPLOAD, idéntico al del inbox);
//   · `post_info`: privacy_level OBLIGATORIO (PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS | FOLLOWER_OF_CREATOR |
//     SELF_ONLY), title ≤ 2200 unidades UTF-16, disable_comment / disable_duet / disable_stitch,
//     video_cover_timestamp_ms, brand_content_toggle / brand_organic_toggle, is_aigc;
//   · ANTES de cada post: POST /v2/post/publish/creator_info/query/, y privacy_level tiene que estar en los
//     privacy_level_options que devuelve;
//   · app sin auditar: sólo SELF_ONLY; con otro valor, 403 `unaudited_client_can_only_post_to_private_accounts`.

/** Los modos de publicar en TikTok. Nombran lo que HACE el carril, no una marca. */
export const TIKTOK_POST_MODE = { INBOX: 'inbox', DIRECT: 'direct' } as const;
export type TikTokPostMode = typeof TIKTOK_POST_MODE[keyof typeof TIKTOK_POST_MODE];

/** Privacidad por defecto de Direct Post: la única que admite una app sin auditar. */
export const TIKTOK_DEFAULT_PRIVACY = 'SELF_ONLY';
export const TIKTOK_TITLE_MAX_UTF16 = 2200;

/**
 * El modo del canal, leído de su `config`. Sin `post_mode` → `inbox` (como siempre). Un valor que no sea
 * uno de los dos modos es error DICHO: no se adivina si se quiso publicar o dejar borrador.
 */
export function resolvePostMode(config: unknown): { ok: true; mode: TikTokPostMode } | { ok: false; error: string } {
  const bruto = (config as Record<string, unknown> | null | undefined)?.post_mode;
  if (bruto === undefined || bruto === null || String(bruto).trim() === '') return { ok: true, mode: TIKTOK_POST_MODE.INBOX };
  const v = String(bruto).trim().toLowerCase();
  if (v === TIKTOK_POST_MODE.INBOX || v === TIKTOK_POST_MODE.DIRECT) return { ok: true, mode: v };
  return { ok: false, error: `config.post_mode=${JSON.stringify(bruto)} no es un modo de TikTok (inbox | direct)` };
}

/** Lo que importa de `creator_info/query`. */
export interface CreatorInfo {
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
}

/** Lee la respuesta de `creator_info/query`. Sin `error.code === 'ok'` o sin opciones de privacidad, es fallo. */
export function readCreatorInfo(json: unknown): { ok: true; info: CreatorInfo } | { ok: false; code: string; message: string } {
  const j = (json ?? {}) as Record<string, unknown>;
  const error = (j.error ?? {}) as Record<string, unknown>;
  const code = typeof error.code === 'string' ? error.code : 'unknown_error';
  const message = typeof error.message === 'string' ? error.message : '';
  if (code !== 'ok') return { ok: false, code, message };
  const d = (j.data ?? {}) as Record<string, unknown>;
  const opciones = Array.isArray(d.privacy_level_options) ? d.privacy_level_options.filter((x): x is string => typeof x === 'string') : [];
  if (!opciones.length) return { ok: false, code: 'no_privacy_options', message: 'creator_info sin privacy_level_options' };
  const max = Number(d.max_video_post_duration_sec);
  return { ok: true, info: {
    privacyOptions: opciones,
    commentDisabled: d.comment_disabled === true,
    duetDisabled: d.duet_disabled === true,
    stitchDisabled: d.stitch_disabled === true,
    maxVideoPostDurationSec: Number.isFinite(max) && max > 0 ? max : null,
  } };
}

/** Corta un texto a `max` unidades UTF-16 sin partir un par sustituto (un emoji a medias). */
export function truncateUtf16(text: string, max: number): string {
  if (text.length <= max) return text;
  let corte = max;
  const c = text.charCodeAt(corte - 1);
  if (c >= 0xd800 && c <= 0xdbff) corte -= 1;
  return text.slice(0, corte);
}

export interface DirectPostInfo {
  title: string;
  privacy_level: string;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
  is_aigc: boolean;
}

/**
 * El `post_info` de Direct Post, a partir del dato del canal y de lo que dice la cuenta. PURO.
 *   · privacy_level: `config.privacy_level` o `SELF_ONLY`; tiene que estar en las opciones de la cuenta, o
 *     se dice (no se cambia por otra).
 *   · disable_*: `true` si la cuenta lo tiene desactivado (manda la cuenta) o si el canal lo pide.
 *   · is_aigc: `true` salvo que el canal declare `false`: el carril produce contenido generado con IA.
 *   · title: el copy de la publicación, cortado a 2200 unidades UTF-16.
 */
export function buildDirectPostInfo(params: { config: unknown; creator: CreatorInfo; title: string }):
  { ok: true; postInfo: DirectPostInfo } | { ok: false; error: string } {
  const cfg = (params.config ?? {}) as Record<string, unknown>;
  const pedida = typeof cfg.privacy_level === 'string' && cfg.privacy_level.trim()
    ? cfg.privacy_level.trim().toUpperCase() : TIKTOK_DEFAULT_PRIVACY;
  if (!params.creator.privacyOptions.includes(pedida)) {
    return { ok: false, error: `privacy_level ${pedida} no está entre las opciones de la cuenta (${params.creator.privacyOptions.join(', ')})` };
  }
  return { ok: true, postInfo: {
    title: truncateUtf16(String(params.title ?? ''), TIKTOK_TITLE_MAX_UTF16),
    privacy_level: pedida,
    disable_comment: params.creator.commentDisabled || cfg.disable_comment === true,
    disable_duet: params.creator.duetDisabled || cfg.disable_duet === true,
    disable_stitch: params.creator.stitchDisabled || cfg.disable_stitch === true,
    is_aigc: cfg.is_aigc !== false,
  } };
}

/** El cuerpo del init de Direct Post: `post_info` más el mismo `source_info` FILE_UPLOAD del inbox. */
export function buildDirectPostInitBody(postInfo: DirectPostInfo, plan: { video_size: number; chunk_size: number; total_chunk_count: number }) {
  return { post_info: { ...postInfo }, ...buildInboxInitBody(plan) };
}

/** Lo que resulta de leer el init: un `publish_id` o un motivo (con el `error.code` de TikTok). */
export type InboxInitResult =
  | { ok: true; publishId: string; uploadUrl: string | null }
  | { ok: false; code: string; message: string };

/**
 * Lee la respuesta del init. `error.code === 'ok'` es el único éxito; cualquier otro código es un
 * fallo DICHO (p. ej. `access_token_invalid`, `spam_risk_...`). Un
 * cuerpo sin `publish_id` aunque el código diga `ok` también es fallo: no se da por hecho sin prueba.
 */
export function readInboxInitResult(json: unknown): InboxInitResult {
  const j = (json ?? {}) as Record<string, unknown>;
  const error = (j.error ?? {}) as Record<string, unknown>;
  const code = typeof error.code === 'string' ? error.code : 'unknown_error';
  const message = typeof error.message === 'string' ? error.message : '';
  if (code !== 'ok') return { ok: false, code, message };
  const data = (j.data ?? {}) as Record<string, unknown>;
  const publishId = data.publish_id;
  if (typeof publishId !== 'string' || !publishId) {
    return { ok: false, code: 'no_publish_id', message: 'error.code=ok pero sin data.publish_id' };
  }
  const uploadUrl = typeof data.upload_url === 'string' && /^https:\/\//.test(data.upload_url) ? data.upload_url : null;
  return { ok: true, publishId, uploadUrl };
}

/** Los estados que devuelve `/status/fetch/`. Cualquier otro texto es `UNKNOWN`. */
export type TikTokPublishStatus =
  | 'PROCESSING_UPLOAD' | 'PROCESSING_DOWNLOAD' | 'SEND_TO_USER_INBOX'
  | 'PUBLISH_COMPLETE' | 'FAILED' | 'UNKNOWN';

const ESTADOS_CONOCIDOS: TikTokPublishStatus[] = [
  'PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD', 'SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE', 'FAILED',
];

/** Lee `data.status` y, si falló, el `data.fail_reason`. Todo lo desconocido es `UNKNOWN`. */
export function readStatusResult(json: unknown): { status: TikTokPublishStatus; failReason: string | null } {
  const j = (json ?? {}) as Record<string, unknown>;
  const data = (j.data ?? {}) as Record<string, unknown>;
  const crudo = typeof data.status === 'string' ? data.status.toUpperCase() : '';
  const status = (ESTADOS_CONOCIDOS as string[]).includes(crudo) ? (crudo as TikTokPublishStatus) : 'UNKNOWN';
  const failReason = typeof data.fail_reason === 'string' && data.fail_reason ? data.fail_reason : null;
  return { status, failReason };
}

// ── LA URL DE VIDEO DEL POST ─────────────────────────────────────────────────────

/**
 * La URL de origen del video: de ahí se descarga, por partes, lo que se sube a TikTok (FILE_UPLOAD).
 * TikTok sólo admite video (`supportsMedia: ['video']`),
 * así que se toma la primera URL https de `media_urls`; si no hay, no hay nada que publicar y se
 * dice. NO se cae a `image_url`: una imagen no es un video y el init la rechazaría sin motivo claro.
 */
export function tiktokVideoUrlOf(post: { media_urls?: string[] | null; video_url?: string | null }): string | null {
  const directo = typeof post.video_url === 'string' && /^https:\/\//.test(post.video_url) ? post.video_url : null;
  if (directo) return directo;
  const urls = Array.isArray(post.media_urls) ? post.media_urls : [];
  const primera = urls.find((u) => typeof u === 'string' && /^https:\/\//.test(u));
  return primera ?? null;
}
