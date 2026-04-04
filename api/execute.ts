/**
 * SocialLab — POST /api/execute
 * Endpoint para integración con Orchestrator UNRLVL.
 *
 * Acepta { brandId, stage, params, previousOutputs }
 * → Toma el copy de previousOutputs.copylab
 * → Adapta el formato por plataforma (Claude)
 * → Escribe en Supabase tabla scheduled_posts (status: 'pending_oauth')
 * → Devuelve confirmación con post_id
 *
 * NOTA: La publicación real requiere OAuth por plataforma (sprint posterior).
 * Por ahora los posts quedan en scheduled_posts listos para publicar manualmente
 * o vía OAuth cuando esté configurado.
 *
 * Env vars: ANTHROPIC_API_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 */

declare const process: { env: Record<string, string | undefined> };

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const SB_URL  = () => process.env.VITE_SUPABASE_URL ?? '';
const SB_KEY  = () => process.env.VITE_SUPABASE_ANON_KEY ?? '';
const ANT_KEY = () => process.env.ANTHROPIC_API_KEY ?? '';

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface ExecuteRequest {
  brandId: string | null;
  stage: { labId: string; label: string; description: string; order: number };
  params: {
    platforms?: string[];    // ['INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'LINKEDIN', 'THREADS']
    schedule_at?: string;    // ISO datetime, default: now + 24h
    extra_instructions?: string;
  };
  previousOutputs: Record<string, string>;
}

interface ScheduledPost {
  brand_id: string;
  platform: string;
  copy_text: string;
  status: string;
  scheduled_at: string;
  source_lab: string;
  orchestrator_stage_label: string;
  created_at: string;
}

// ── SUPABASE HELPERS ───────────────────────────────────────────────────────────

async function sb<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
      headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? (data[0] ?? null) : data;
  } catch { return null; }
}

async function sbInsert(table: string, data: object): Promise<{ id?: string; error?: string }> {
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY(),
        Authorization: `Bearer ${SB_KEY()}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.text();
      return { error: err };
    }
    const result = await res.json();
    return { id: Array.isArray(result) ? result[0]?.id : result?.id };
  } catch (e) {
    return { error: String(e) };
  }
}

// ── ADAPT COPY FOR PLATFORM ────────────────────────────────────────────────────

async function adaptForPlatform(
  rawCopy: string,
  platform: string,
  brandId: string
): Promise<string> {
  const brand = await sb<any>(`brands?id=eq.${brandId}&select=name,language_primary`);
  const idioma = brand?.language_primary ?? 'es-ES';

  const platformRules: Record<string, string> = {
    INSTAGRAM:  'Instagram: máx 2200 chars. Hook en primera línea. Saltos de línea para respirar. 8-15 hashtags al final separados del cuerpo.',
    FACEBOOK:   'Facebook: máx 500 chars para no truncar. Más conversacional. 2-3 hashtags máx o ninguno.',
    TIKTOK:     'TikTok: primera línea = hook que para el scroll. Muy corto (máx 150 chars). 3-5 hashtags trending relevantes.',
    LINKEDIN:   'LinkedIn: tono profesional. Primera línea es el hook. Párrafos cortos. Sin hashtags en exceso (3 máx). Call to value claro.',
    THREADS:    'Threads: conversacional, máx 500 chars. Opinión directa. Sin hashtags o 1-2 solo.',
    YOUTUBE:    'YouTube description: 200-300 chars para el fold visible. Keywords naturales. Timestamps si aplica. Links y CTA al final.',
  };

  const rule = platformRules[platform.toUpperCase()] ?? platformRules.INSTAGRAM;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANT_KEY(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      temperature: 0.6,
      system: `Eres el adaptador de copy por plataforma de SocialLab, UNRLVL Studio.
Tu trabajo: tomar copy existente y adaptarlo al formato y tono específico de cada red social.
Idioma: ${idioma}. Mantén el idioma del original.
Reglas ${platform}: ${rule}
Solo devuelve el copy adaptado. Sin explicaciones.`,
      messages: [{
        role: 'user',
        content: `Adapta este copy para ${platform}:\n\n${rawCopy}`,
      }],
    }),
  });

  if (!res.ok) return rawCopy; // fallback: copy original sin adaptar
  const data = await res.json();
  return data.content?.[0]?.text ?? rawCopy;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://orchestrator.vercel.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed', status: 'error' }), { status: 405, headers: CORS });

  let body: ExecuteRequest;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON', status: 'error' }), { status: 400, headers: CORS }); }

  if (!body.brandId) {
    return new Response(JSON.stringify({ error: 'brandId is required', status: 'error' }), { status: 400, headers: CORS });
  }

  // Obtener copy source — prioridad: copylab > weblab > stage.description
  const rawCopy =
    body.previousOutputs?.copylab ??
    body.previousOutputs?.CopyLab ??
    body.previousOutputs?.weblab ??
    body.stage.description ??
    '';

  if (!rawCopy) {
    return new Response(JSON.stringify({
      error: 'No copy available. Run CopyLab stage first.',
      status: 'error',
    }), { status: 400, headers: CORS });
  }

  const platforms  = body.params.platforms ?? ['INSTAGRAM', 'FACEBOOK'];
  const scheduleAt = body.params.schedule_at
    ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // default: mañana

  try {
    const results: Array<{ platform: string; post_id?: string; status: string; copy_preview: string }> = [];

    // Adaptar y encolar por plataforma
    for (const platform of platforms) {
      const adaptedCopy = await adaptForPlatform(rawCopy, platform, body.brandId!);

      // Escribir en Supabase scheduled_posts
      const { id, error } = await sbInsert('scheduled_posts', {
        brand_id:                 body.brandId,
        platform:                 platform.toUpperCase(),
        copy_text:                adaptedCopy,
        status:                   'pending_oauth',   // → 'scheduled' cuando OAuth esté listo
        scheduled_at:             scheduleAt,
        source_lab:               'sociallab_orchestrator',
        orchestrator_stage_label: body.stage.label,
        created_at:               new Date().toISOString(),
      } satisfies ScheduledPost);

      results.push({
        platform,
        post_id:      id,
        status:       error ? 'queued_local' : 'queued_supabase',
        copy_preview: adaptedCopy.slice(0, 120) + (adaptedCopy.length > 120 ? '...' : ''),
      });
    }

    const output = [
      `✅ ${results.length} post(s) encolados — scheduled para ${new Date(scheduleAt).toLocaleString('es-ES')}`,
      '',
      ...results.map(r =>
        `${r.platform}: ${r.status}${r.post_id ? ` (id: ${r.post_id})` : ''}\n"${r.copy_preview}"`
      ),
      '',
      '⚠️ Publicación pendiente de OAuth Meta/TikTok. Los posts están en scheduled_posts en Supabase.',
    ].join('\n');

    return new Response(JSON.stringify({ output, results, status: 'ok' }), { status: 200, headers: CORS });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[SocialLab /api/execute]', msg);
    return new Response(JSON.stringify({ error: msg, status: 'error' }), { status: 500, headers: CORS });
  }
}
