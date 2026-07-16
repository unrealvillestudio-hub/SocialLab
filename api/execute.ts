/**
 * SocialLab — POST /api/execute
 * v2 — CORS * fix + status pending_publish + image_url en scheduled_posts
 *
 * maxDuration se declara en vercel.json (no aquí, para no duplicar la fuente).
 */

declare const process: { env: Record<string, string | undefined> };

const CLAUDE_MODEL = 'claude-sonnet-5';
// Env vars: prefijo VITE_ no existe en runtime Vercel serverless (es build-time
// del cliente Vite). Usamos las vars estándar de server.
const SB_URL  = () => process.env.SUPABASE_URL ?? '';
const SB_KEY  = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANT_KEY = () => process.env.ANTHROPIC_API_KEY ?? '';

interface ExecuteRequest {
  brandId: string | null;
  stage: { labId: string; label: string; description: string; order: number };
  params: {
    platforms?: string[];
    schedule_at?: string;
    extra_instructions?: string;
  };
  previousOutputs: Record<string, string>;
}

interface ScheduledPost {
  brand_id: string;
  platform: string;
  copy_text: string;
  image_url?: string | null;
  status: string;
  scheduled_at: string;
  source_lab: string;
  orchestrator_stage_label: string;
  created_at: string;
}

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
    if (!res.ok) return { error: await res.text() };
    const result = await res.json();
    return { id: Array.isArray(result) ? result[0]?.id : result?.id };
  } catch (e) {
    return { error: String(e) };
  }
}

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
      // Sonnet 5 rechaza temperature/top_p/top_k con 400 → se elimina.
      // Sonnet 5 corre adaptive thinking si se omite `thinking`; con
      // max_tokens 600 eso truncaría el copy, así que se desactiva explícito.
      thinking: { type: 'disabled' },
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

  if (!res.ok) return rawCopy;
  const data = await res.json();
  return data.content?.[0]?.text ?? rawCopy;
}

function setCors(res: any): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // req.body ya viene parseado por el runtime Node de Vercel cuando el
  // Content-Type es application/json. Guarda por si llega vacío o sin parsear.
  let body: ExecuteRequest;
  if (typeof req.body === 'string') {
    try { body = JSON.parse(req.body); }
    catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as ExecuteRequest;
  } else {
    body = {} as ExecuteRequest;
  }

  if (!body.brandId) {
    return res.status(400).json({ error: 'brandId is required' });
  }

  const rawCopy =
    body.previousOutputs?.copylab ??
    body.previousOutputs?.CopyLab ??
    body.previousOutputs?.weblab ??
    body.stage.description ??
    '';

  if (!rawCopy) {
    return res.status(400).json({ error: 'No copy available. Run CopyLab stage first.' });
  }

  // GAP 2 FIX: recibir image_url de previousOutputs (inyectada por Orchestrator tras ImageLab)
  const imageUrl = body.previousOutputs?.image_url ?? null;

  const platforms  = body.params.platforms ?? ['INSTAGRAM', 'FACEBOOK'];
  const scheduleAt = body.params.schedule_at
    ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    const results = await Promise.all(
      platforms.map(async (platform) => {
        const adaptedCopy = await adaptForPlatform(rawCopy, platform, body.brandId!);

        const { id, error } = await sbInsert('scheduled_posts', {
          brand_id:                 body.brandId!,
          platform:                 platform.toUpperCase(),
          copy_text:                adaptedCopy,
          image_url:                imageUrl,   // ← GAP 2: imagen del Orchestrator
          status:                   'pending_publish',
          scheduled_at:             scheduleAt,
          source_lab:               'sociallab_orchestrator',
          orchestrator_stage_label: body.stage.label,
          created_at:               new Date().toISOString(),
        } satisfies ScheduledPost);

        return {
          platform,
          post_id:      id,
          status:       error ? 'queued_local' : 'queued_supabase',
          copy_preview: adaptedCopy.slice(0, 120) + (adaptedCopy.length > 120 ? '...' : ''),
        };
      })
    );

    const output = [
      `✅ ${results.length} post(s) encolados — scheduled para ${new Date(scheduleAt).toLocaleString('es-ES')}`,
      imageUrl ? `🖼️ imagen: ${imageUrl}` : '⚠️ sin imagen',
      '',
      ...results.map(r =>
        `${r.platform}: ${r.status}${r.post_id ? ` (id: ${r.post_id})` : ''}\n"${r.copy_preview}"`
      ),
      '',
      '📬 Posts en scheduled_posts con status pending_publish → /api/publish los publicará via Meta MCP.',
    ].join('\n');

    return res.status(200).json({ output, results, status: 'ok' });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg, status: 'error' });
  }
}
