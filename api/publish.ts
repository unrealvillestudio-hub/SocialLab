/**
 * SocialLab — POST /api/publish
 * Publish worker: lee scheduled_posts con status='pending_publish'
 * y los publica via Meta MCP (ig_create_container, ig_publish_container, fb_publish_post)
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

declare const process: { env: Record<string, string | undefined> };

const SB_URL     = () => process.env.SUPABASE_URL ?? '';
const SB_KEY     = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const META_MCP   = () => process.env.META_MCP_URL ?? 'https://unrlvl-meta-mcp.vercel.app/api/mcp/mcp';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

async function sbGet<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
      headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [data];
  } catch { return []; }
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

// ── PUBLISH PER PLATFORM ──────────────────────────────────────────────────────

async function publishPost(post: ScheduledPost): Promise<PublishResult> {
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

      // Paso 2: publicar container
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
      const fbRes = await mcpCall('fb_publish_post', {
        brand_id: post.brand_id,
        message:  post.copy_text,
        ...(post.image_url ? { link: post.image_url } : {}),
      });
      const fbText = extractMcpText(fbRes);
      let platformPostId: string | null = null;
      try {
        const parsed = JSON.parse(fbText ?? '{}');
        platformPostId = parsed.id ?? null;
      } catch { /* no JSON */ }

      return {
        post_id:          post.id,
        platform,
        brand_id:         post.brand_id,
        status:           platformPostId ? 'published' : 'failed',
        platform_post_id: platformPostId ?? undefined,
        error:            platformPostId ? undefined : `FB publish failed: ${fbText}`,
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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

  let body: { brand_id?: string; post_id?: string } = {};
  try { body = await req.json(); } catch { /* vacío OK */ }

  if (!body.brand_id && !body.post_id) {
    return new Response(JSON.stringify({ error: 'brand_id or post_id required' }), { status: 400, headers: CORS });
  }

  // Leer posts pendientes
  let posts: ScheduledPost[] = [];
  if (body.post_id) {
    posts = await sbGet<ScheduledPost>(`scheduled_posts?id=eq.${body.post_id}&status=eq.pending_publish`);
  } else {
    posts = await sbGet<ScheduledPost>(`scheduled_posts?brand_id=eq.${body.brand_id}&status=eq.pending_publish&order=scheduled_at.asc`);
  }

  if (!posts.length) {
    return new Response(JSON.stringify({ message: 'No pending posts found', results: [] }), { status: 200, headers: CORS });
  }

  const results: PublishResult[] = [];

  for (const post of posts) {
    // Solo publicar si scheduled_at <= ahora
    const scheduledAt = new Date(post.scheduled_at).getTime();
    if (scheduledAt > Date.now()) {
      results.push({ post_id: post.id, platform: post.platform, brand_id: post.brand_id, status: 'failed', error: `Not yet scheduled (${post.scheduled_at})` });
      continue;
    }

    const result = await publishPost(post);
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

  return new Response(JSON.stringify({ output, results, published, failed, status: 'ok' }), { status: 200, headers: CORS });
}
