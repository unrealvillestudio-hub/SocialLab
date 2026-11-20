/**
 * SocialLab — POST /api/publish
 * Publish worker: lee scheduled_posts con status='pending_publish'
 * y los publica via Meta MCP:
 *   INSTAGRAM  ig_create_container + ig_get_container_status (hasta FINISHED) + ig_publish_container
 *   FACEBOOK   fb_publish_photo si el post lleva imagen · fb_publish_post si no (N11, 2026-09-08)
 *   REELS      IG: contenedor REELS (video + portada) · FB: fb_publish_reel + confirmación (2026-11-19)
 *   STORY      IG: contenedor STORIES · FB: fb_publish_story, de foto o de video (2026-11-19)
 *   Qué se publica según la fila lo decide `mediaPlanOf` (`_mediaPlan.ts`, puro y probado).
 *
 * Puede llamarse:
 * - Manualmente desde Claude / Ayra
 * - Como stage del Orchestrator (labId: 'sociallab', execute_path: '/api/publish')
 * - Futuro: cron de Ayra para publicación autónoma
 *
 * Body: { brand_id?: string, post_id?: string }
 * - Si brand_id → publica todos los pending_publish de esa marca
 * - Si post_id → publica ese post específico
 * - Si ninguno → error
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, META_MCP_URL
 *   (Prefijo VITE_ no existe en runtime Vercel serverless — es build-time del cliente.)
 */

import {
  CONTAINER_TIMEOUT_MS, FIRST_CHECK_MS, CHECK_EVERY_MS, PUBLISH_DEADLINE_MS,
  CREATE_RETRY_WAITS_MS, dormir, leerEstadoContenedor, esFalloTransitorioDeCreacion, type ContainerStatus,
} from './_igContainer.js';
// TikTok (borrador al inbox o Direct Post, según el dato del canal de la marca) y LinkedIn (BLOQUEADO).
import { publishTikTok } from './_tiktokApi.js';
import { publishLinkedInBlocked } from './_linkedin.js';
import {
  mediaPlanOf, leerEstadoVideoFb, VIDEO_CONTAINER_TIMEOUT_MS, VIDEO_FIRST_CHECK_MS,
  FB_VIDEO_CONFIRM_TIMEOUT_MS, FB_VIDEO_CHECK_EVERY_MS,
} from './_mediaPlan.js';

declare const process: { env: Record<string, string | undefined> };

const SB_URL     = () => process.env.SUPABASE_URL ?? '';
const SB_KEY     = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const META_MCP   = () => process.env.META_MCP_URL ?? 'https://unrlvl-meta-mcp.vercel.app/api/mcp/mcp';

function setCors(res: any): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface ScheduledPost {
  id: string;
  brand_id: string;
  platform: string;
  copy_text: string;
  image_url: string | null;
  status: string;
  scheduled_at: string;
  // CARRUSEL (2026-09-29) — lo escribe content-scheduler cuando la pieza es carrusel. NULL = una imagen.
  media_type?: string | null;
  media_urls?: string[] | null;
}

/** Las URL de un carrusel, si la fila lo declara. PURO. 2 a 10 en orden; si no, null (se publica como siempre). */
export function carouselUrlsOf(post: Pick<ScheduledPost, 'media_type' | 'media_urls'>): string[] | null {
  if (String(post.media_type ?? '').toUpperCase() !== 'CAROUSEL') return null;
  const urls = (Array.isArray(post.media_urls) ? post.media_urls : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
  return urls.length >= 2 ? urls.slice(0, 10) : null;
}

interface PublishResult {
  post_id: string;
  platform: string;
  brand_id: string;
  status: 'published' | 'failed';
  platform_post_id?: string;
  error?: string;
}

// ── SUPABASE HELPERS ───────────────────────────────────────────────────────────

/**
 * N11 cambio 3 — UN FALLO DE LECTURA YA NO SE LEE COMO «NO HAY NADA PENDIENTE».
 *
 * El `catch { return [] }` anterior devolvia lo mismo ante las dos situaciones, y el handler
 * respondia `200 {"message":"No pending posts found"}` en las dos. Con las credenciales ausentes
 * eso produjo un NOOP: el drenaje leyo un 200 y conto la corrida como hecha sin publicar nada.
 * Es el mismo fail-silent que N09 cerro en `content-scheduler`, en otro archivo y un piso mas
 * abajo — y ahi tambien lo que faltaba no era mas informacion, sino que el error tuviera
 * PROHIBIDO parecerse a un resultado.
 *
 * Ahora lanza `SbReadError` y el handler responde `503`. Cero filas sigue siendo `[]` y sigue
 * siendo legitimo: lo que deja de existir es la tercera lectura, la que no distingue una de otra.
 */
class SbReadError extends Error {
  constructor(public path: string, public detail: string) {
    super(`SUPABASE_READ_FAILED: ${path} — ${detail}`);
    this.name = 'SbReadError';
  }
}

async function sbGet<T>(path: string): Promise<T[]> {
  // La configuracion ausente se nombra por su nombre. Es la causa real del NOOP de hoy, y un
  // `fetch` contra `''` no dice nada parecido a «falta SUPABASE_SERVICE_ROLE_KEY».
  if (!SB_URL() || !SB_KEY()) {
    throw new SbReadError(path, 'faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el runtime');
  }
  let res: Response;
  try {
    res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
      headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` },
    });
  } catch (err) {
    throw new SbReadError(path, `la peticion no llego: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '');
    throw new SbReadError(path, `HTTP ${res.status} ${cuerpo.slice(0, 300)}`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    // Un 2xx con cuerpo ilegible tampoco es una lista vacia: es una respuesta que no se entendio.
    throw new SbReadError(path, `respuesta 2xx ilegible: ${err instanceof Error ? err.message : String(err)}`);
  }
  return (Array.isArray(data) ? data : [data]) as T[];
}

async function sbUpdate(table: string, id: string, data: object): Promise<boolean> {
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: SB_KEY(),
        Authorization: `Bearer ${SB_KEY()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch { return false; }
}

// ── META MCP CALLER ────────────────────────────────────────────────────────────

let mcpMsgId = 1;

async function mcpCall(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(META_MCP(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: mcpMsgId++,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });

  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('event-stream')) {
    const txt = await res.text();
    for (const line of txt.split('\n')) {
      if (line.startsWith('data:')) {
        try { return JSON.parse(line.slice(5).trim()); } catch { /* skip */ }
      }
    }
    return null;
  }
  return res.json();
}

function extractMcpText(result: unknown): string | null {
  const r = result as Record<string, unknown>;
  const content = (r?.result as Record<string, unknown>)?.content ?? r?.content;
  if (Array.isArray(content)) {
    const t = (content as Array<{ type: string; text: string }>).find(c => c.type === 'text');
    return t?.text ?? null;
  }
  return null;
}

// ── ESPERAR A QUE EL CONTENEDOR DE INSTAGRAM ESTE LISTO · 9007 ────────────────
//
// Los plazos y la lectura del estado viven en `_igContainer.ts`, que es puro y se prueba solo.
// Aqui queda lo que necesita hablar con el MCP: el bucle de espera.
/** Lo que resulta de esperar: o se puede publicar, o hay un motivo escrito para no hacerlo. */
type EsperaResultado = { listo: true } | { listo: false; error: string };

async function esperarContenedorListo(
  brand_id: string, creation_id: string, deadline: number,
  plazos: { timeoutMs: number; firstCheckMs: number } = { timeoutMs: CONTAINER_TIMEOUT_MS, firstCheckMs: FIRST_CHECK_MS },
): Promise<EsperaResultado> {
  const hasta = Math.min(Date.now() + plazos.timeoutMs, deadline);
  let ultimo: ContainerStatus = 'UNKNOWN';
  let detalle: string | null = null;
  let consultas = 0;

  await dormir(Math.min(plazos.firstCheckMs, Math.max(0, hasta - Date.now())));

  while (Date.now() < hasta) {
    consultas++;
    const res = await mcpCall('ig_get_container_status', { brand_id, creation_id });
    const leido = leerEstadoContenedor(extractMcpText(res));
    ultimo = leido.estado;
    detalle = leido.detalle;

    if (ultimo === 'FINISHED') return { listo: true };

    if (ultimo === 'ERROR' || ultimo === 'EXPIRED') {
      return { listo: false, error:
        `Container ${ultimo.toLowerCase()} after ${consultas} check(s): ${detalle ?? 'sin detalle'}` };
    }
    if (ultimo === 'PUBLISHED') {
      // NO se vuelve a publicar. Un duplicado en la cuenta de la marca no se deshace con un reintento.
      return { listo: false, error:
        'Container already PUBLISHED — not publishing again to avoid a duplicate post' };
    }

    const queda = hasta - Date.now();
    if (queda <= 0) break;
    await dormir(Math.min(CHECK_EVERY_MS, queda));
  }

  return { listo: false, error:
    `Container not ready after ${Math.round((Date.now() - (hasta - plazos.timeoutMs)) / 1000)}s `
    + `(${consultas} check(s), last status ${ultimo}${detalle ? `: ${detalle}` : ''}). `
    + 'Publishing now would fail with 9007.' };
}

/**
 * Crea un contenedor de Instagram y reintenta SOLO si Graph falló de forma transitoria (ver
 * `esFalloTransitorioDeCreacion`). Devuelve el id, o el último texto de Graph como motivo.
 * Respeta el plazo de la corrida: si no queda tiempo para esperar, no reintenta.
 */
async function crearContenedorIg(
  args: Record<string, unknown>, deadline: number,
): Promise<{ id: string; intentos: number } | { id: null; texto: string | null; intentos: number }> {
  let texto: string | null = null;
  for (let intento = 0; intento <= CREATE_RETRY_WAITS_MS.length; intento++) {
    if (intento > 0) {
      const espera = CREATE_RETRY_WAITS_MS[intento - 1];
      if (Date.now() + espera >= deadline) break;
      console.warn(`[IG] creación de contenedor falló de forma transitoria, reintento ${intento} en ${espera} ms: ${String(texto).slice(0, 200)}`);
      await dormir(espera);
    }
    texto = extractMcpText(await mcpCall('ig_create_container', args));
    let id: string | null = null;
    try { id = JSON.parse(texto ?? '{}').id ?? null; } catch { /* no JSON */ }
    if (id) return { id, intentos: intento + 1 };
    if (!esFalloTransitorioDeCreacion(texto)) return { id: null, texto, intentos: intento + 1 };
  }
  return { id: null, texto, intentos: CREATE_RETRY_WAITS_MS.length + 1 };
}

// ── REELS Y STORIES (2026-11-19) ──────────────────────────────────────────────
//
// Instagram: el mismo camino de tres pasos que la imagen —crear, ESPERAR a FINISHED, publicar—, con
// los plazos del video (`_mediaPlan.ts`). Si el contenedor no llega a FINISHED en plazo, no se publica:
// la fila falla con su motivo y el contenedor caduca solo a las 24 h sin haber salido.
//
// Facebook: el MCP sube el video por URL y Facebook lo publica AL TERMINAR DE PROCESARLO. Aquí se lee el
// estado hasta que consta publicado. Si el plazo se agota antes, el video ya está en manos de Facebook y
// saldrá solo: la fila se da por publicada con el `video_id` y se avisa en el log. Marcarla `failed`
// invitaría a reintentar, y un reintento subiría un SEGUNDO reel a la Página.

type Resultado = PublishResult;

/** Crea, espera y publica un contenedor de Instagram de video o de story. */
async function publicarContenedorIg(
  post: ScheduledPost, platform: string, args: Record<string, unknown>, esVideo: boolean,
  etiqueta: string, deadline: number,
): Promise<Resultado> {
  const base = { post_id: post.id, platform, brand_id: post.brand_id };
  const creado = await crearContenedorIg({ brand_id: post.brand_id, ...args }, deadline);
  if (!creado.id) {
    return { ...base, status: 'failed',
             error: `${etiqueta} container creation failed after ${creado.intentos} attempt(s): ${'texto' in creado ? creado.texto : ''}` };
  }
  const espera = await esperarContenedorListo(post.brand_id, creado.id, deadline, esVideo
    ? { timeoutMs: VIDEO_CONTAINER_TIMEOUT_MS, firstCheckMs: VIDEO_FIRST_CHECK_MS }
    : { timeoutMs: CONTAINER_TIMEOUT_MS, firstCheckMs: FIRST_CHECK_MS });
  if (!espera.listo) {
    return { ...base, status: 'failed', error: `${etiqueta} container not publishable: ${'error' in espera ? espera.error : ''}` };
  }
  const pubText = extractMcpText(await mcpCall('ig_publish_container', { brand_id: post.brand_id, creation_id: creado.id }));
  let pid: string | null = null;
  try { pid = JSON.parse(pubText ?? '{}').id ?? null; } catch { /* no JSON */ }
  return { ...base, status: pid ? 'published' : 'failed', platform_post_id: pid ?? undefined,
           error: pid ? undefined : `${etiqueta} publish failed: ${pubText}` };
}

/** Lee el estado de un video de Página hasta que consta publicado, falla o se acaba el plazo. */
async function confirmarVideoFb(brand_id: string, video_id: string, deadline: number) {
  const hasta = Math.min(Date.now() + FB_VIDEO_CONFIRM_TIMEOUT_MS, deadline);
  let ultimo: ReturnType<typeof leerEstadoVideoFb> = { estado: 'pending', detalle: null };
  while (Date.now() < hasta) {
    await dormir(Math.min(FB_VIDEO_CHECK_EVERY_MS, Math.max(0, hasta - Date.now())));
    ultimo = leerEstadoVideoFb(extractMcpText(await mcpCall('fb_get_video_status', { brand_id, video_id })));
    if (ultimo.estado !== 'pending') return ultimo;
  }
  return ultimo;
}

/** Reel o story de video en una Página: subir, y confirmar la publicación con el estado del video. */
async function publicarVideoFb(
  post: ScheduledPost, platform: string, tool: 'fb_publish_reel' | 'fb_publish_story',
  args: Record<string, unknown>, etiqueta: string, deadline: number,
): Promise<Resultado> {
  const base = { post_id: post.id, platform, brand_id: post.brand_id };
  const texto = extractMcpText(await mcpCall(tool, { brand_id: post.brand_id, ...args }));
  console.log(`[${etiqueta}][FACEBOOK] post=${post.id} respuesta_cruda=${String(texto).slice(0, 800)}`);
  let videoId: string | null = null;
  let postId: string | null = null;
  try {
    const d = JSON.parse(texto ?? '{}');
    videoId = d.video_id != null ? String(d.video_id) : null;
    postId = d.post_id != null ? String(d.post_id) : null;
    if (d.success === false) videoId = null;
  } catch { /* no JSON */ }
  if (!videoId) return { ...base, status: 'failed', error: `${etiqueta} upload failed (via ${tool}): ${texto}` };

  const estado = await confirmarVideoFb(post.brand_id, videoId, deadline);
  if (estado.estado === 'error') {
    return { ...base, status: 'failed', error: `${etiqueta} rejected by Facebook (video ${videoId}): ${estado.detalle}` };
  }
  if (estado.estado === 'pending') {
    console.warn(`[${etiqueta}][FACEBOOK] post=${post.id} video=${videoId} todavía sin publicar al agotar el plazo `
      + `(${estado.detalle ?? 'sin detalle'}); Facebook lo publica al terminar de procesarlo. NO se reintenta.`);
  }
  return { ...base, status: 'published', platform_post_id: postId ?? videoId };
}

// ── PUBLISH PER PLATFORM ──────────────────────────────────────────────────────

async function publishPost(post: ScheduledPost, deadline: number): Promise<PublishResult> {
  const platform = post.platform.toUpperCase();

  try {
    const plan = mediaPlanOf(post);
    if (plan.kind === 'invalid') {
      return { post_id: post.id, platform, brand_id: post.brand_id, status: 'failed', error: plan.error };
    }
    const carrusel = plan.kind === 'carousel' ? plan.urls : null;

    // ── REEL ── Instagram y Facebook. TikTok sigue en su propio carril (abajo): ya lee el MP4 de
    // `media_urls[0]`, la misma posición que usa el reel.
    if (plan.kind === 'reel' && platform === 'INSTAGRAM') {
      return publicarContenedorIg(post, platform, {
        media_type: 'REELS', video_url: plan.videoUrl, caption: post.copy_text, share_to_feed: true,
        ...(plan.coverUrl ? { cover_url: plan.coverUrl } : {}),
      }, true, 'Reel', deadline);
    }
    if (plan.kind === 'reel' && platform === 'FACEBOOK') {
      return publicarVideoFb(post, platform, 'fb_publish_reel',
        { video_url: plan.videoUrl, description: post.copy_text }, 'Reel', deadline);
    }

    // ── STORY ── Sin texto: ninguna de las dos plataformas acepta pie en una story.
    if (plan.kind === 'story' && platform === 'INSTAGRAM') {
      return publicarContenedorIg(post, platform, {
        media_type: 'STORIES', ...(plan.videoUrl ? { video_url: plan.videoUrl } : { image_url: plan.imageUrl }),
      }, Boolean(plan.videoUrl), 'Story', deadline);
    }
    if (plan.kind === 'story' && platform === 'FACEBOOK') {
      if (plan.videoUrl) {
        return publicarVideoFb(post, platform, 'fb_publish_story', { video_url: plan.videoUrl }, 'Story', deadline);
      }
      const texto = extractMcpText(await mcpCall('fb_publish_story', { brand_id: post.brand_id, url: plan.imageUrl }));
      console.log(`[Story][FACEBOOK] post=${post.id} respuesta_cruda=${String(texto).slice(0, 800)}`);
      let pid: string | null = null;
      try { const d = JSON.parse(texto ?? '{}'); pid = d.success === false ? null : (d.post_id ?? null); } catch { /* no JSON */ }
      return { post_id: post.id, platform, brand_id: post.brand_id,
               status: pid ? 'published' : 'failed', platform_post_id: pid ? String(pid) : undefined,
               error: pid ? undefined : `Story publish failed (via fb_publish_story): ${texto}` };
    }
    if (plan.kind === 'story' || (plan.kind === 'reel' && platform !== 'TIKTOK')) {
      return { post_id: post.id, platform, brand_id: post.brand_id, status: 'failed',
               error: `MEDIA_PLAN_PLATFORM_UNSUPPORTED: ${plan.kind} no tiene camino de publicación en ${platform}` };
    }

    if (platform === 'INSTAGRAM' && carrusel) {
      // CARRUSEL (2026-09-29). Un contenedor por lámina (`is_carousel_item`), cada uno ESPERADO hasta
      // FINISHED —el mismo 9007 que el contenedor simple—, después el contenedor CAROUSEL con los
      // hijos en orden, esperado también, y recién entonces se publica. Si una lámina falla, no se
      // publica nada: un carrusel con láminas de menos no es el que se aprobó.
      const hijos: string[] = [];
      for (const url of carrusel) {
        const c = await crearContenedorIg({
          brand_id: post.brand_id, image_url: url, media_type: 'IMAGE', is_carousel_item: true,
        }, deadline);
        if (!c.id) return { post_id: post.id, platform, brand_id: post.brand_id, status: 'failed',
                            error: `Carousel item ${hijos.length + 1} creation failed after ${c.intentos} attempt(s): ${c.texto}` };
        const id = c.id;
        const e = await esperarContenedorListo(post.brand_id, id, deadline);
        if (!e.listo) return { post_id: post.id, platform, brand_id: post.brand_id, status: 'failed',
                               error: `Carousel item ${hijos.length + 1} not publishable: ${'error' in e ? e.error : ''}` };
        hijos.push(id);
      }
      const padreRes = await mcpCall('ig_create_container', {
        brand_id: post.brand_id, media_type: 'CAROUSEL', children: hijos, caption: post.copy_text,
      });
      const padreText = extractMcpText(padreRes);
      let padre: string | null = null;
      try { padre = JSON.parse(padreText ?? '{}').id ?? null; } catch { /* no JSON */ }
      if (!padre) return { post_id: post.id, platform, brand_id: post.brand_id, status: 'failed',
                           error: `Carousel container creation failed: ${padreText}` };
      const listo = await esperarContenedorListo(post.brand_id, padre, deadline);
      if (!listo.listo) return { post_id: post.id, platform, brand_id: post.brand_id, status: 'failed',
                                 error: `Carousel container not publishable: ${'error' in listo ? listo.error : ''}` };
      const pubText = extractMcpText(await mcpCall('ig_publish_container', { brand_id: post.brand_id, creation_id: padre }));
      let pid: string | null = null;
      try { pid = JSON.parse(pubText ?? '{}').id ?? null; } catch { /* no JSON */ }
      return { post_id: post.id, platform, brand_id: post.brand_id,
               status: pid ? 'published' : 'failed', platform_post_id: pid ?? undefined,
               error: pid ? undefined : `Carousel publish failed: ${pubText}` };
    }

    if (platform === 'FACEBOOK' && carrusel) {
      // CARRUSEL en una Página = una publicación con N fotos en orden (MCP `fb_publish_photos`).
      const fbText = extractMcpText(await mcpCall('fb_publish_photos', {
        brand_id: post.brand_id, urls: carrusel, message: post.copy_text,
      }));
      console.log(`[CARRUSEL][FACEBOOK] post=${post.id} láminas=${carrusel.length} respuesta_cruda=${String(fbText).slice(0, 800)}`);
      let pid: string | null = null;
      try { const d = JSON.parse(fbText ?? '{}'); pid = d.post_id ?? d.id ?? null; } catch { /* no JSON */ }
      return { post_id: post.id, platform, brand_id: post.brand_id,
               status: pid ? 'published' : 'failed', platform_post_id: pid ? String(pid) : undefined,
               error: pid ? undefined : `FB multi-photo publish failed (via fb_publish_photos): ${fbText}` };
    }

    if (platform === 'INSTAGRAM') {
      // Paso 1: crear container
      const creado = await crearContenedorIg({
        brand_id:  post.brand_id,
        caption:   post.copy_text,
        ...(post.image_url ? { image_url: post.image_url, media_type: 'IMAGE' } : {}),
      }, deadline);

      if (!creado.id) {
        return { post_id: post.id, platform, brand_id: post.brand_id, status: 'failed',
                 error: `Container creation failed after ${creado.intentos} attempt(s): ${creado.texto}` };
      }
      const creationId: string = creado.id;

      // Paso 2: ESPERAR a que el contenedor este listo.
      //
      // Es el paso que faltaba y la causa entera del 9007. Instagram procesa el medio de forma
      // asincrona; el id que acaba de volver todavia no sirve. Ver el bloque de arriba.
      const espera = await esperarContenedorListo(post.brand_id, creationId, deadline);
      if (!espera.listo) {
        return { post_id: post.id, platform, brand_id: post.brand_id, status: 'failed',
                 error: `Container not publishable: ${espera.error}` };
      }

      // Paso 3: publicar container
      const publishRes = await mcpCall('ig_publish_container', {
        brand_id:    post.brand_id,
        creation_id: creationId,
      });
      const publishText = extractMcpText(publishRes);
      let platformPostId: string | null = null;
      try {
        const parsed = JSON.parse(publishText ?? '{}');
        platformPostId = parsed.id ?? null;
      } catch { /* no JSON */ }

      return {
        post_id:          post.id,
        platform,
        brand_id:         post.brand_id,
        status:           platformPostId ? 'published' : 'failed',
        platform_post_id: platformPostId ?? undefined,
        error:            platformPostId ? undefined : `Publish failed: ${publishText}`,
      };
    }

    if (platform === 'FACEBOOK') {
      // ── N11 cambio 1 · UNA IMAGEN SE PUBLICA COMO FOTO, NO COMO ENLACE ─────────────────────────
      // `fb_publish_post` con `link` pide a Facebook que PREVISUALICE una URL: el resultado es una
      // tarjeta de enlace, y la imagen queda servida desde `external-…/emg1/` —el cache de enlaces
      // externos de Meta— en vez de `scontent-…/v/t39.30808-6/`, que es donde vive una foto subida.
      // Se ve distinto, se recorta distinto y depende de que la URL de origen siga viva.
      //
      // `fb_publish_photo` sube la foto a la pagina (`POST /{page_id}/photos`) y el pie va en
      // `caption`, no en `message`. Sin imagen no hay foto que subir y el camino de siempre es el
      // correcto: se conserva intacto.
      const conFoto = typeof post.image_url === 'string' && post.image_url.trim().length > 0;
      const fbRes = conFoto
        ? await mcpCall('fb_publish_photo', {
            brand_id: post.brand_id,
            url:      post.image_url,
            caption:  post.copy_text,
          })
        : await mcpCall('fb_publish_post', {
            brand_id: post.brand_id,
            message:  post.copy_text,
          });
      const fbText = extractMcpText(fbRes);

      // ── N11 cambio 2 · EL IDENTIFICADOR DEL POST, NO EL DE LA FOTO ────────────────────────────
      // `POST /{page_id}/photos` devuelve DOS identificadores: `id` es el de la foto y `post_id` el
      // del post publicado. Guardar el de la foto deja `platform_post_id` apuntando a un objeto que
      // no es el que se publico, y cualquier lectura posterior —engagement, borrado, verificacion—
      // pregunta por lo que no es.
      //
      // `post_id` primero y `id` como respaldo: `fb_publish_post` sigue devolviendo solo `id`, y esa
      // rama tiene que seguir funcionando igual.
      //
      // NO SE ASUME QUE `post_id` VENGA. El contrato lo dice, pero nadie lo ha medido contra una
      // respuesta real; por eso la respuesta cruda se registra entera y, si no viene ninguno de los
      // dos, esto falla DICIENDO lo que llego en vez de dar por publicado algo sin prueba.
      console.log(`[N11][FACEBOOK] post=${post.id} conFoto=${conFoto} respuesta_cruda=${String(fbText).slice(0, 800)}`);

      let platformPostId: string | null = null;
      try {
        const parsed = JSON.parse(fbText ?? '{}');
        const elegido = parsed.post_id ?? parsed.id ?? null;
        platformPostId = elegido == null ? null : String(elegido);
      } catch { /* no JSON */ }

      return {
        post_id:          post.id,
        platform,
        brand_id:         post.brand_id,
        status:           platformPostId ? 'published' : 'failed',
        platform_post_id: platformPostId ?? undefined,
        error:            platformPostId
          ? undefined
          : `FB publish failed (via ${conFoto ? 'fb_publish_photo' : 'fb_publish_post'}): ${fbText}`,
      };
    }

    if (platform === 'TIKTOK') {
      // Dos modos, elegidos por DATO en `intel.brand_publish_channels.config.post_mode` de la marca:
      // `inbox` (`video.upload`, borrador; el modo si no se declara) o `direct` (`video.publish`,
      // Direct Post, autorizado por Sam el 2026-11-20). En los dos el video se sube por `FILE_UPLOAD`.
      // El token se resuelve por marca desde `social_oauth_tokens`, igual que Meta por `meta_accounts`.
      return publishTikTok(post);
    }

    if (platform === 'LINKEDIN') {
      // BLOQUEADO: la Página de empresa exige la Community Management API (entidad legal). No se
      // simula — falla diciendo el motivo. El esqueleto del OAuth y el almacén de token sí existen.
      return publishLinkedInBlocked(post);
    }

    // Plataformas sin carril de publicación todavía (YouTube, Threads, etc.)
    return {
      post_id:  post.id,
      platform,
      brand_id: post.brand_id,
      status:   'failed',
      error:    `Platform ${platform} not yet supported. Post queued for manual publish.`,
    };

  } catch (err) {
    return {
      post_id:  post.id,
      platform,
      brand_id: post.brand_id,
      status:   'failed',
      error:    err instanceof Error ? err.message : String(err),
    };
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // req.body ya viene parseado por el runtime Node de Vercel cuando el
  // Content-Type es application/json. Guarda por si llega vacío o sin parsear.
  let body: { brand_id?: string; post_id?: string } = {};
  if (typeof req.body === 'string') {
    try { body = JSON.parse(req.body); } catch { /* vacío OK */ }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body;
  }

  if (!body.brand_id && !body.post_id) {
    return res.status(400).json({ error: 'brand_id or post_id required' });
  }

  // Leer posts pendientes.
  //
  // N11 cambio 3 — «no pude leer» y «no hay nada» dejan de responder lo mismo. El `503` es
  // deliberado y no un `500`: quien llama —el drenaje de `content-scheduler`— trata cualquier
  // no-2xx como fallo y ahora lo VE, en vez de leer un `200 No pending posts found` y contar la
  // corrida como hecha. Un NOOP silencioso cuesta una franja; un 503 cuesta un reintento.
  let posts: ScheduledPost[] = [];
  try {
    if (body.post_id) {
      posts = await sbGet<ScheduledPost>(`scheduled_posts?id=eq.${body.post_id}&status=eq.pending_publish`);
    } else {
      posts = await sbGet<ScheduledPost>(`scheduled_posts?brand_id=eq.${body.brand_id}&status=eq.pending_publish&order=scheduled_at.asc`);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[N11] lectura de scheduled_posts fallida: ${detail}`);
    return res.status(503).json({ error: 'supabase_read_failed', detail, results: [] });
  }

  // Cero filas SIGUE siendo legitimo y sigue respondiendo 200: la marca no tiene nada pendiente.
  // Lo que ya no puede pasar por aqui es un fallo de lectura disfrazado de bandeja vacia.
  if (!posts.length) {
    return res.status(200).json({ message: 'No pending posts found', results: [] });
  }

  const results: PublishResult[] = [];
  // 9007 — el plazo de TODA la corrida. Instagram ahora espera a su contenedor, asi que una llamada
  // con `brand_id` y varios pendientes puede sumar. Se declara aqui, una vez, y cada post recibe lo
  // que queda de el.
  const deadline = Date.now() + PUBLISH_DEADLINE_MS;

  for (const post of posts) {
    // Solo publicar si scheduled_at <= ahora
    const scheduledAt = new Date(post.scheduled_at).getTime();
    if (scheduledAt > Date.now()) {
      results.push({ post_id: post.id, platform: post.platform, brand_id: post.brand_id, status: 'failed', error: `Not yet scheduled (${post.scheduled_at})` });
      continue;
    }

    // SIN PLAZO NO SE EMPIEZA. Publicar con el tiempo agotado deja la fila a medias y la funcion
    // cortada por Vercel sin motivo escrito; esto la deja pendiente, con el suyo.
    if (Date.now() >= deadline) {
      results.push({ post_id: post.id, platform: post.platform, brand_id: post.brand_id, status: 'failed',
        error: 'Run deadline reached before this post was attempted — still pending, retry' });
      continue;
    }

    const result = await publishPost(post, deadline);
    results.push(result);

    // Actualizar status en Supabase
    await sbUpdate('scheduled_posts', post.id, {
      status:           result.status === 'published' ? 'published' : 'failed',
      published_at:     result.status === 'published' ? new Date().toISOString() : null,
      platform_post_id: result.platform_post_id ?? null,
      error_message:    result.error ?? null,
      updated_at:       new Date().toISOString(),
    });
  }

  const published = results.filter(r => r.status === 'published').length;
  const failed    = results.filter(r => r.status === 'failed').length;

  const output = [
    `📤 Publicación completada: ${published} publicados · ${failed} fallidos`,
    '',
    ...results.map(r =>
      r.status === 'published'
        ? `✅ ${r.platform} (${r.brand_id}): publicado · id: ${r.platform_post_id}`
        : `❌ ${r.platform} (${r.brand_id}): ${r.error}`
    ),
  ].join('\n');

  return res.status(200).json({ output, results, published, failed, status: 'ok' });
}
