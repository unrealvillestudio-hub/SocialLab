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
  TIKTOK_TOKEN_URL, TIKTOK_INBOX_INIT_URL, TIKTOK_DIRECT_INIT_URL, TIKTOK_CREATOR_INFO_URL,
  TIKTOK_PROVIDER, TIKTOK_SCOPES, TIKTOK_POST_MODE,
  resolvePostMode, readCreatorInfo, buildDirectPostInfo, buildDirectPostInitBody,
  TIKTOK_CONTENT_INIT_URL, storageObjectOf, mediaProxyUrlOf, tiktokPhotoUrlsOf, buildPhotoInitBody,
  parseTokenResponse, isAccessTokenExpired,
  buildInboxInitBody, readInboxInitResult,
  tiktokVideoUrlOf, planChunks, contentRangeOf, uploadContentTypeOf, videoSizeFromHeaders,
  inboxInitErrorMessage, chunkStatusRetryable, TIKTOK_UPLOAD_BUDGET_MS, TIKTOK_CHUNK_RETRIES_5XX,
  type TikTokTokenRecord,
} from './_tiktok.js';
import {
  getSocialToken, upsertSocialToken, getPublishChannelConfig, isoToMs, msToIso, SocialStoreError,
  type SocialTokenRow,
} from './_socialTokens.js';

declare const process: { env: Record<string, string | undefined> };

const CLIENT_KEY    = () => process.env.TIKTOK_CLIENT_KEY ?? '';
const CLIENT_SECRET = () => process.env.TIKTOK_CLIENT_SECRET ?? '';
const REDIRECT_URI  = () => process.env.TIKTOK_REDIRECT_URI ?? '';
/** El dominio verificado desde el que TikTok descarga las fotos (Sam 2026-11-20: `media.unrealvillestudio.com`). */
const MEDIA_BASE_URL = () => process.env.TIKTOK_MEDIA_BASE_URL ?? '';
const SUPABASE_URL   = () => process.env.SUPABASE_URL ?? '';

export { TIKTOK_SCOPES, REDIRECT_URI as tiktokRedirectUri, CLIENT_KEY as tiktokClientKey };

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

/** Llama a un init (borrador o Direct Post). Devuelve la respuesta cruda parseada; la lee `readInboxInitResult`. */
async function callInit(url: string, accessToken: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

/** `creator_info/query`: lo que la cuenta permite. Se llama antes de cada Direct Post. */
async function callCreatorInfo(accessToken: string): Promise<unknown> {
  const res = await fetch(TIKTOK_CREATOR_INFO_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
  });
  return res.json().catch(() => ({}));
}

/** Tamaño y tipo del video en el origen, con una lectura del primer byte (sin descargar el archivo). */
async function sondearOrigen(videoUrl: string): Promise<{ size: number | null; contentType: string | null }> {
  const res = await fetch(videoUrl, { headers: { Range: 'bytes=0-0' } });
  await res.arrayBuffer().catch(() => undefined);
  if (!res.ok) throw new Error(`TikTok: el origen del video respondió ${res.status} al leer su tamaño`);
  const size = res.status === 206
    ? videoSizeFromHeaders({ contentRange: res.headers.get('content-range') })
    : videoSizeFromHeaders({ contentLength: res.headers.get('content-length') });
  return { size, contentType: res.headers.get('content-type') };
}

/**
 * Publica un post por la vía EXENTA de auditoría: crea un borrador en el inbox de la cuenta por
 * `FILE_UPLOAD`. Pasos: tamaño del video en el origen → plan de partes → init (devuelve `publish_id`
 * y `upload_url`) → por cada parte, en orden, se descarga ESA parte del origen (`Range`) y se sube con
 * `PUT` + `Content-Range`. Nunca se tiene el MP4 entero en memoria: como mucho una parte.
 *
 * Éxito = todas las partes subidas con 2xx y un `publish_id`, que se guarda como `platform_post_id`
 * para seguir el estado (`/status/fetch/`). Un fallo se DICE con su motivo, nunca se da por hecho. Si
 * se agota `TIKTOK_UPLOAD_BUDGET_MS` falla con `TIKTOK_UPLOAD_TIME_BUDGET`: el borrador no se crea
 * hasta que llega la última parte, así que reintentar no duplica nada.
 *
 * NO espera a que el borrador llegue al inbox: el procesamiento de TikTok es asíncrono y el desenlace
 * lo cierra la persona en la app, no el carril.
 */
export async function publishTikTok(post: {
  id: string; brand_id: string; platform: string; copy_text?: string | null; media_type?: string | null;
  image_url?: string | null; media_urls?: string[] | null; video_url?: string | null;
}): Promise<TikTokPublishResult> {
  const base = { post_id: post.id, platform: post.platform.toUpperCase(), brand_id: post.brand_id };
  const fail = (error: string): TikTokPublishResult => ({ ...base, status: 'failed', error });
  const inicio = Date.now();

  // SIN VIDEO, FOTOS (2026-11-20). La fila de imagen o carrusel se publica como post de fotos.
  const esVideo = ['REELS', 'VIDEO'].includes(String(post.media_type ?? '').toUpperCase()) || !!post.video_url;
  if (!esVideo) return publishTikTokPhotos(post);

  const videoUrl = tiktokVideoUrlOf(post);
  if (!videoUrl) {
    return fail('TikTok: la fila declara video y no hay URL https de video en media_urls');
  }

  let accessToken: string;
  try {
    accessToken = (await getValidAccessToken(post.brand_id)).accessToken;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  let origen: { size: number | null; contentType: string | null };
  try {
    origen = await sondearOrigen(videoUrl);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (!origen.size) return fail('TikTok: no se pudo leer el tamaño del video en el origen (sin Content-Range ni Content-Length)');
  const plan = planChunks(origen.size);
  if (!plan.ok) return fail(`TikTok: ${plan.error}`);

  // EL MODO ES DATO DEL CANAL DE LA MARCA. Sin canal o sin `post_mode`: borrador, como siempre.
  let config: Record<string, unknown> | null;
  try {
    config = await getPublishChannelConfig(post.brand_id, base.platform);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  const modo = resolvePostMode(config);
  if (!modo.ok) return fail(`TikTok: ${modo.error}`);

  let initUrl = TIKTOK_INBOX_INIT_URL;
  let initBody: unknown = buildInboxInitBody(plan);
  if (modo.mode === TIKTOK_POST_MODE.DIRECT) {
    const creator = readCreatorInfo(await callCreatorInfo(accessToken));
    if (!creator.ok) return fail(`TikTok creator_info falló (${creator.code})${creator.message ? `: ${creator.message}` : ''}`);
    const info = buildDirectPostInfo({ config, creator: creator.info, title: post.copy_text ?? '' });
    if (!info.ok) return fail(`TikTok: ${info.error}`);
    initUrl = TIKTOK_DIRECT_INIT_URL;
    initBody = buildDirectPostInitBody(info.postInfo, plan);
  }

  const init = readInboxInitResult(await callInit(initUrl, accessToken, initBody));
  if (!init.ok) {
    return fail(inboxInitErrorMessage(init.code, init.message));
  }
  if (!init.uploadUrl) return fail('TikTok inbox init sin data.upload_url: no hay dónde subir el video');

  const contentType = uploadContentTypeOf(origen.contentType);
  for (let i = 0; i < plan.ranges.length; i++) {
    const r = plan.ranges[i];
    const parte = `parte ${i + 1}/${plan.total_chunk_count}`;
    if (Date.now() - inicio > TIKTOK_UPLOAD_BUDGET_MS) {
      return fail(`TIKTOK_UPLOAD_TIME_BUDGET: se agotaron ${TIKTOK_UPLOAD_BUDGET_MS} ms antes de la ${parte}`);
    }
    const largo = r.end - r.start + 1;
    const bajada = await fetch(videoUrl, { headers: { Range: `bytes=${r.start}-${r.end}` } });
    const bytes = new Uint8Array(await bajada.arrayBuffer());
    if (!bajada.ok || bytes.byteLength !== largo) {
      return fail(`TikTok: el origen devolvió ${bajada.status} y ${bytes.byteLength} de ${largo} bytes en la ${parte}`);
    }
    let subida: Response;
    let texto = '';
    for (let intento = 0; ; intento++) {
      subida = await fetch(init.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(largo),
          'Content-Range': contentRangeOf(r, plan.video_size),
        },
        body: bytes,
      });
      texto = await subida.text().catch(() => '');
      if (subida.ok || !chunkStatusRetryable(subida.status) || intento >= TIKTOK_CHUNK_RETRIES_5XX) break;
    }
    if (!subida.ok) {
      return fail(`TikTok: la subida de la ${parte} respondió ${subida.status}${texto ? `: ${texto.slice(0, 200)}` : ''}`);
    }
  }
  return { ...base, status: 'published', platform_post_id: init.publishId };
}

// ── FOTOS (media_type PHOTO, PULL_FROM_URL desde el dominio verificado) ────────────────────────

/**
 * Publica una fila de imagen o carrusel como post de FOTOS. TikTok descarga cada imagen desde el dominio verificado
 * (`TIKTOK_MEDIA_BASE_URL`), donde `api/tiktok-media` la sirve como WebP de hasta 1080 px. Mismo modo por dato que el
 * video (`config.post_mode`): `direct` (DIRECT_POST, con creator_info y privacidad validada) o `inbox` (MEDIA_UPLOAD).
 * Toda imagen tiene que ser un objeto público de NUESTRO almacenamiento; si no, falla dicho, sin llamar a TikTok.
 */
async function publishTikTokPhotos(post: {
  id: string; brand_id: string; platform: string; copy_text?: string | null; title?: string | null; media_type?: string | null;
  image_url?: string | null; media_urls?: string[] | null;
}): Promise<TikTokPublishResult> {
  const base = { post_id: post.id, platform: post.platform.toUpperCase(), brand_id: post.brand_id };
  const fail = (error: string): TikTokPublishResult => ({ ...base, status: 'failed', error });

  if (!MEDIA_BASE_URL()) return fail('TikTok fotos: falta TIKTOK_MEDIA_BASE_URL (el dominio verificado de las imágenes) en el runtime');
  if (!SUPABASE_URL()) return fail('TikTok fotos: falta SUPABASE_URL en el runtime');
  const urls = tiktokPhotoUrlsOf(post);
  if (!urls.length) return fail('TikTok: la fila no trae video ni imágenes https');
  const fotos: string[] = [];
  for (const u of urls) {
    const ref = storageObjectOf(u, SUPABASE_URL());
    if (!ref) return fail(`TikTok fotos: la imagen no es un objeto público de nuestro almacenamiento: ${u.slice(0, 120)}`);
    fotos.push(mediaProxyUrlOf(MEDIA_BASE_URL(), ref));
  }

  let accessToken: string;
  try {
    accessToken = (await getValidAccessToken(post.brand_id)).accessToken;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  let config: Record<string, unknown> | null;
  try {
    config = await getPublishChannelConfig(post.brand_id, base.platform);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  const modo = resolvePostMode(config);
  if (!modo.ok) return fail(`TikTok: ${modo.error}`);

  let direct = null;
  if (modo.mode === TIKTOK_POST_MODE.DIRECT) {
    const creator = readCreatorInfo(await callCreatorInfo(accessToken));
    if (!creator.ok) return fail(`TikTok creator_info falló (${creator.code})${creator.message ? `: ${creator.message}` : ''}`);
    const info = buildDirectPostInfo({ config, creator: creator.info, title: '' });
    if (!info.ok) return fail(`TikTok: ${info.error}`);
    direct = info.postInfo;
  }
  const body = buildPhotoInitBody({ mode: modo.mode, photoUrls: fotos, description: post.copy_text ?? '', title: post.title ?? null, direct,
    autoAddMusic: (config ?? {}).auto_add_music === true });
  const init = readInboxInitResult(await callInit(TIKTOK_CONTENT_INIT_URL, accessToken, body));
  if (!init.ok) return fail(inboxInitErrorMessage(init.code, init.message));
  return { ...base, status: 'published', platform_post_id: init.publishId };
}
