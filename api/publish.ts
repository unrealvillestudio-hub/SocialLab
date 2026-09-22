/**
 * SocialLab — POST /api/publish
 * Publish worker: lee scheduled_posts con status='pending_publish'
 * y los publica via Meta MCP:
 *   INSTAGRAM  ig_create_container + ig_get_container_status (hasta FINISHED) + ig_publish_container
 *   FACEBOOK   fb_publish_photo si el post lleva imagen · fb_publish_post si no (N11, 2026-09-08)
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
  dormir, leerEstadoContenedor, type ContainerStatus,
} from './_igContainer.js';

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
): Promise<EsperaResultado> {
  const hasta = Math.min(Date.now() + CONTAINER_TIMEOUT_MS, deadline);
  let ultimo: ContainerStatus = 'UNKNOWN';
  let detalle: string | null = null;
  let consultas = 0;

  await dormir(Math.min(FIRST_CHECK_MS, Math.max(0, hasta - Date.now())));

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
    `Container not ready after ${Math.round((Date.now() - (hasta - CONTAINER_TIMEOUT_MS)) / 1000)}s `
    + `(${consultas} check(s), last status ${ultimo}${detalle ? `: ${detalle}` : ''}). `
    + 'Publishing now would fail with 9007.' };
}

// ── PUBLISH PER PLATFORM ──────────────────────────────────────────────────────

async function publishPost(post: ScheduledPost, deadline: number): Promise<PublishResult> {
  const platform = post.platform.toUpperCase();

  try {
    if (platform === 'INSTAGRAM') {
      // Paso 1: crear container
      const containerRes = await mcpCall('ig_create_container', {
        brand_id:  post.brand_id,
        caption:   post.copy_text,
        ...(post.image_url ? { image_url: post.image_url, media_type: 'IMAGE' } : {}),
      });

      const containerText = extractMcpText(containerRes);
      let creationId: string | null = null;
      try {
        const parsed = JSON.parse(containerText ?? '{}');
        creationId = parsed.id ?? null;
      } catch { /* no JSON */ }

      if (!creationId) {
        return { post_id: post.id, platform, brand_id: post.brand_id, status: 'failed', error: `Container creation failed: ${containerText}` };
      }

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

    // Plataformas sin soporte en Meta MCP aún (TikTok, LinkedIn, etc.)
    return {
      post_id:  post.id,
      platform,
      brand_id: post.brand_id,
      status:   'failed',
      error:    `Platform ${platform} not yet supported in Meta MCP. Post queued for manual publish.`,
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
