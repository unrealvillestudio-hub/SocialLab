/**
 * SocialLab — api/_tiktokApi.ts
 *
 * LO QUE HABLA CON TIKTOK POR RED: intercambio de código, refresh, resolución del access token
 * vigente (refrescando y guardando si caducó) y el posteo por `video.upload` (borrador al inbox).
 * Las decisiones puras —URLs, lectura de respuestas, caducidad, firma del state— viven en
 * `_tiktok.ts` y se prueban allí; aquí queda la red, que no se prueba sin credenciales (igual que
 * el `mcpCall` de `publish.ts`). El prefijo `_` marca módulo, NO ruta de Vercel.
 */

import {
  TIKTOK_TOKEN_URL, TIKTOK_INBOX_INIT_URL,
  TIKTOK_PROVIDER, TIKTOK_SCOPES_INBOX,
  parseTokenResponse, isAccessTokenExpired,
  buildInboxInitBody, readInboxInitResult,
  tiktokVideoUrlOf, videoUrlHostAllowed,
  type TikTokTokenRecord,
} from './_tiktok.js';
import {
  getSocialToken, upsertSocialToken, isoToMs, msToIso, SocialStoreError,
  type SocialTokenRow,
} from './_socialTokens.js';

declare const process: { env: Record<string, string | undefined> };

const CLIENT_KEY    = () => process.env.TIKTOK_CLIENT_KEY ?? '';
const CLIENT_SECRET = () => process.env.TIKTOK_CLIENT_SECRET ?? '';
const REDIRECT_URI  = () => process.env.TIKTOK_REDIRECT_URI ?? '';
/** Hosts verificados para `video_url` (CSV). Vacío → no se comprueba localmente (TikTok lo exige igual). */
const VERIFIED_HOSTS = (): string[] =>
  (process.env.TIKTOK_MEDIA_VERIFIED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export { TIKTOK_SCOPES_INBOX, REDIRECT_URI as tiktokRedirectUri, CLIENT_KEY as tiktokClientKey };

/** El resultado de publicar, en la misma forma que usa `publish.ts`. */
export interface TikTokPublishResult {
  post_id: string;
  platform: string;
  brand_id: string;
  status: 'published' | 'failed';
  platform_post_id?: string;
  error?: string;
}

// ── OAUTH ────────────────────────────────────────────────────────────────────

async function postToken(body: Record<string, string>): Promise<TikTokTokenRecord> {
  if (!CLIENT_KEY() || !CLIENT_SECRET()) {
    throw new SocialStoreError('faltan TIKTOK_CLIENT_KEY y/o TIKTOK_CLIENT_SECRET en el runtime');
  }
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_key: CLIENT_KEY(), client_secret: CLIENT_SECRET(), ...body }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  const parsed = parseTokenResponse(json, Date.now());
  if (!parsed.ok) throw new Error(`TikTok OAuth: ${parsed.error}`);
  return parsed.record;
}

/** Intercambia el `code` del callback por tokens. `redirect_uri` debe coincidir con el del authorize. */
export async function exchangeCode(code: string): Promise<TikTokTokenRecord> {
  return postToken({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI() });
}

/** Refresca el access token. El refresh_token devuelto PUEDE ser nuevo: el que guarda es el de vuelta. */
export async function refreshAccessToken(refreshToken: string): Promise<TikTokTokenRecord> {
  return postToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

/** Guarda un token normalizado en la tabla, para una marca. */
export async function storeToken(brandId: string, rec: TikTokTokenRecord): Promise<void> {
  const row: SocialTokenRow = {
    provider: TIKTOK_PROVIDER,
    brand_id: brandId,
    open_id: rec.open_id || null,
    access_token: rec.access_token,
    refresh_token: rec.refresh_token,
    scope: rec.scope || null,
    access_token_expires_at: msToIso(rec.access_token_expires_at),
    refresh_token_expires_at: msToIso(rec.refresh_token_expires_at),
  };
  await upsertSocialToken(row);
}

/**
 * El access token vigente de una marca. Si caducó, lo refresca y GUARDA el resultado (incluido el
 * refresh_token nuevo si cambió). Falla con un motivo escrito si la marca no se conectó aún o si el
 * refresh_token también caducó (365 días): ahí hace falta un OAuth nuevo, que es acción de Sam.
 */
export async function getValidAccessToken(brandId: string): Promise<{ accessToken: string; openId: string | null }> {
  const row = await getSocialToken(TIKTOK_PROVIDER, brandId);
  if (!row) {
    throw new Error(`TikTok no conectado para la marca "${brandId}": falta el OAuth (no hay fila en social_oauth_tokens)`);
  }
  if (!isAccessTokenExpired(isoToMs(row.access_token_expires_at), Date.now())) {
    return { accessToken: row.access_token, openId: row.open_id };
  }
  const refreshMs = isoToMs(row.refresh_token_expires_at);
  if (refreshMs > 0 && Date.now() >= refreshMs) {
    throw new Error(`TikTok: el refresh_token de "${brandId}" caducó — hace falta reautorizar (OAuth), acción de Sam`);
  }
  const fresco = await refreshAccessToken(row.refresh_token);
  await storeToken(brandId, fresco);
  return { accessToken: fresco.access_token, openId: fresco.open_id };
}

// ── POSTEO: BORRADOR AL INBOX (video.upload) ───────────────────────────────────

/** Llama al init del inbox. Devuelve la respuesta cruda parseada; la lee `readInboxInitResult`. */
async function callInboxInit(accessToken: string, videoUrl: string): Promise<unknown> {
  const res = await fetch(TIKTOK_INBOX_INIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(buildInboxInitBody(videoUrl)),
  });
  return res.json().catch(() => ({}));
}

/**
 * Publica un post por la vía EXENTA de auditoría: crea un borrador en el inbox de la cuenta por
 * `PULL_FROM_URL`. Éxito = TikTok devolvió `publish_id` (el borrador está en camino al inbox, donde
 * la persona lo termina y publica). El `publish_id` se guarda como `platform_post_id` para poder
 * consultar el estado después. Un fallo se DICE con el `error.code` de TikTok, nunca se da por hecho.
 *
 * NO espera a que el borrador llegue al inbox: la descarga de TikTok es asíncrona y para un borrador
 * el desenlace lo cierra la persona, no el carril. El `publish_id` basta para seguirlo
 * (`/status/fetch/`), que es lo que hace `_tiktok.readStatusResult`.
 */
export async function publishTikTokInbox(post: {
  id: string; brand_id: string; platform: string;
  image_url?: string | null; media_urls?: string[] | null; video_url?: string | null;
}): Promise<TikTokPublishResult> {
  const base = { post_id: post.id, platform: post.platform.toUpperCase(), brand_id: post.brand_id };
  const fail = (error: string): TikTokPublishResult => ({ ...base, status: 'failed', error });

  const videoUrl = tiktokVideoUrlOf(post);
  if (!videoUrl) {
    return fail('TikTok requiere un video: no hay URL https de video en media_urls (video.upload no acepta imagen)');
  }
  if (!videoUrlHostAllowed(videoUrl, VERIFIED_HOSTS())) {
    return fail(`TikTok: el host de la URL de video no está entre los dominios verificados (${VERIFIED_HOSTS().join(', ')}). `
      + 'El init devolvería url_ownership_unverified. Verificar el dominio en el portal o corregir la URL.');
  }

  let accessToken: string;
  try {
    accessToken = (await getValidAccessToken(post.brand_id)).accessToken;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  const init = readInboxInitResult(await callInboxInit(accessToken, videoUrl));
  if (!init.ok) {
    return fail(`TikTok inbox init falló (${init.code})${init.message ? `: ${init.message}` : ''}`);
  }
  return { ...base, status: 'published', platform_post_id: init.publishId };
}
