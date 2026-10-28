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
 *   Status      POST https://open.tiktokapis.com/v2/post/publish/status/fetch/       (JSON)
 *
 * `video.upload` (borrador al inbox) es la vía EXENTA de auditoría. El posteo público directo
 * (`video.publish`) exige auditoría con video demo y queda fuera de este módulo a propósito.
 */

// El `state` firmado del OAuth es genérico (TikTok y LinkedIn lo comparten) y vive en
// `_oauthState.ts`. No se re-exporta desde aquí a propósito: así este módulo puro no importa a
// ningún otro y el test de Node lo carga tal cual (el type stripping nativo no reescribe `.js`→`.ts`).

// ── CONSTANTES DE LA API ───────────────────────────────────────────────────────

export const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_TOKEN_URL     = 'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_INBOX_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
export const TIKTOK_STATUS_URL     = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

/**
 * Scopes de la vía exenta de auditoría. `user.info.basic` identifica a la cuenta en el callback;
 * `video.upload` crea el borrador en el inbox. NO se pide `video.publish`: eso es posteo público y
 * exige auditoría (ver cabecera). Es una lista explícita de SUPERFICIES de permiso, no de marcas.
 */
export const TIKTOK_SCOPES_INBOX = ['user.info.basic', 'video.upload'] as const;

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

// ── INBOX INIT (PULL_FROM_URL) ──────────────────────────────────────────────────

/** El cuerpo JSON del init del inbox por URL. Sin archivo que subir: TikTok lo descarga. */
export function buildInboxInitBody(videoUrl: string): { source_info: { source: 'PULL_FROM_URL'; video_url: string } } {
  return { source_info: { source: 'PULL_FROM_URL', video_url: videoUrl } };
}

/** Lo que resulta de leer el init: un `publish_id` o un motivo (con el `error.code` de TikTok). */
export type InboxInitResult =
  | { ok: true; publishId: string }
  | { ok: false; code: string; message: string };

/**
 * Lee la respuesta del init. `error.code === 'ok'` es el único éxito; cualquier otro código es un
 * fallo DICHO (p. ej. `url_ownership_unverified`, `access_token_invalid`, `spam_risk_...`). Un
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
  return { ok: true, publishId };
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
 * La URL de video que se le pasa a TikTok. TikTok sólo admite video (`supportsMedia: ['video']`),
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

/**
 * ¿El host de la URL de video está entre los dominios verificados? TikTok exige que el prefijo/host
 * de `video_url` esté verificado en el portal (si no, `url_ownership_unverified`). Comprobarlo aquí
 * convierte ese 403 en un motivo escrito ANTES de gastar la llamada. Lista vacía → no se comprueba
 * (TikTok lo exige igual; la comprobación local es una cortesía, no la autoridad).
 */
export function videoUrlHostAllowed(videoUrl: string, allowedHosts: readonly string[]): boolean {
  if (!allowedHosts.length) return true;
  let host: string;
  try { host = new URL(videoUrl).host.toLowerCase(); } catch { return false; }
  return allowedHosts.some((h) => {
    const d = h.trim().toLowerCase();
    return !!d && (host === d || host.endsWith(`.${d}`));
  });
}
