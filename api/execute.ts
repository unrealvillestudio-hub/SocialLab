/**
 * SocialLab — POST /api/execute
 * v2 — CORS * fix + status pending_publish + image_url en scheduled_posts
 *
 * maxDuration se declara en vercel.json (no aquí, para no duplicar la fuente).
 */

declare const process: { env: Record<string, string | undefined> };

// MODELO-DATO (2026-10-25) — el modelo NO vive aquí: es la fila activa de `public.ops_lab_models` para
// lab `sociallab`, rol `sync` (la adaptación del texto que se publica). Sin fila, la petición falla con
// `MODELO_SIN_DATO`: no hay un modelo de respaldo escrito, que sería la constante de antes con otro nombre.
const MODELO_LAB = 'sociallab';
const MODELO_ROL = 'sync';
// Env vars: prefijo VITE_ no existe en runtime Vercel serverless (es build-time
// del cliente Vite). Usamos las vars estándar de server.
const SB_URL  = () => process.env.SUPABASE_URL ?? '';
const SB_KEY  = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANT_KEY = () => process.env.ANTHROPIC_API_KEY ?? '';
const KEY_LABEL = () => process.env.ANTHROPIC_KEY_LABEL ?? null;

// COSTO (2026-10-28) — Sam: «sí instrumenta». Hasta hoy esta ruta llamaba al proveedor sin dejar asiento: su
// gasto no existía en `ops_generation_ledger` ni, por lo tanto, en unrlvl-ops. Ahora cada llamada se asienta por
// `ops_log_generation`, con la tarifa resuelta por `ops_resolve_rate` (dato, nunca un literal), igual que el
// asesor. Sin `usage` o sin tarifa, el asiento lleva ceros y su motivo en `rate_source`: nunca una estimación.
// Asentar no bloquea la publicación: si el asiento falla, se registra en el log del servidor y se sigue.
const SOURCE_APP  = 'sociallab';
const OUTPUT_TYPE = 'adaptation';

/** Costo en USD de una llamada, o null si falta alguna tarifa. Puro. */
export function costoDe(inTok: number, outTok: number, rIn: number | null, rOut: number | null): number | null {
  if (rIn === null || rOut === null) return null;
  return Math.round((inTok / 1e6 * rIn + outTok / 1e6 * rOut) * 1e6) / 1e6;
}

/** De dónde sale el costo asentado. Puro: es lo que el tablero lee para separar ceros afirmados de inciertos. */
export function fuenteDeTarifa(httpStatus: number, usageReportado: boolean, rIn: { id: string } | null, rOut: { id: string } | null): string {
  if (httpStatus < 200 || httpStatus >= 300) return `NOT_BILLED:PROVIDER_HTTP_${httpStatus}`;
  if (!usageReportado) return 'USAGE_UNREPORTED';
  return rIn && rOut ? `ops_lab_rates:${rIn.id}+${rOut.id}` : 'UNSEEDED';
}

async function rpc(fn: string, args: object): Promise<any> {
  const res = await fetch(`${SB_URL()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

async function tarifa(modelo: string, unitType: string, at: string): Promise<{ rate: number; id: string; from: string } | null> {
  try {
    const r = await rpc('ops_resolve_rate', { p_lab: MODELO_LAB, p_model_id: modelo, p_unit_type: unitType, p_at: at });
    const row = Array.isArray(r) ? r[0] : r;
    return row?.rate_usd != null ? { rate: Number(row.rate_usd), id: String(row.rate_id), from: String(row.effective_from) } : null;
  } catch (e) { console.error(`[execute] ops_resolve_rate: ${e}`); return null; }
}

/** Asienta UNA llamada al proveedor. Nunca lanza: un asiento que falla no tumba la publicación. */
async function asentar(a: {
  brandId: string; platform: string; modelo: string; httpStatus: number; usage: any; durationMs: number; error: string | null;
}): Promise<void> {
  try {
    const inTok  = Number(a.usage?.input_tokens)  || 0;
    const outTok = Number(a.usage?.output_tokens) || 0;
    const usageReportado = Number.isFinite(a.usage?.input_tokens) && Number.isFinite(a.usage?.output_tokens);
    const ok = a.httpStatus >= 200 && a.httpStatus < 300;
    const at = new Date().toISOString().slice(0, 10);
    const [rIn, rOut] = ok && usageReportado
      ? await Promise.all([tarifa(a.modelo, 'tokens_in', at), tarifa(a.modelo, 'tokens_out', at)])
      : [null, null];
    const costo = ok && usageReportado ? costoDe(inTok, outTok, rIn?.rate ?? null, rOut?.rate ?? null) : 0;
    await rpc('ops_log_generation', {
      p_lab: MODELO_LAB, p_brand_id: a.brandId, p_job_id: null, p_piece_id: null, p_output_type: OUTPUT_TYPE,
      p_platform: a.platform.toLowerCase(), p_provider: 'anthropic', p_model_id: a.modelo, p_unit_type: 'tokens_in',
      p_input_units: inTok, p_output_units: outTok, p_cost_usd: costo, p_content_score: null,
      p_status: ok ? 'ok' : 'error', p_duration_ms: a.durationMs, p_error_msg: a.error,
      p_agent_name: null, p_domain: null, p_rate_in: rIn?.rate ?? null, p_rate_out: rOut?.rate ?? null,
      p_rate_source: fuenteDeTarifa(a.httpStatus, usageReportado, rIn, rOut), p_rate_effective_at: rIn?.from ?? null,
      p_voice_id: null, p_source_app: SOURCE_APP, p_api_key_ref: KEY_LABEL(), p_billable: null,
    });
  } catch (e) { console.error(`[execute] ops_log_generation: ${e}`); }
}

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

async function modeloDeLab(): Promise<string> {
  const res = await fetch(
    `${SB_URL()}/rest/v1/ops_lab_models?select=model_id&lab=eq.${MODELO_LAB}&role=eq.${MODELO_ROL}&active=is.true&limit=2`,
    { headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` } },
  );
  if (!res.ok) throw new Error(`MODELO_ILEGIBLE: ops_lab_models ${MODELO_LAB}/${MODELO_ROL} — HTTP ${res.status}`);
  const filas = (await res.json()) as Array<{ model_id?: string }>;
  const modelo = filas.length === 1 ? String(filas[0].model_id ?? '').trim() : '';
  if (!modelo) throw new Error(`MODELO_SIN_DATO: ops_lab_models no tiene una fila activa para ${MODELO_LAB}/${MODELO_ROL} (${filas.length})`);
  return modelo;
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
  brandId: string,
  modelo: string,
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

  const t0 = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANT_KEY(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelo,
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

  const data = await res.json().catch(() => ({} as any));
  await asentar({
    brandId, platform, modelo, httpStatus: res.status, usage: data?.usage, durationMs: Date.now() - t0,
    error: res.ok ? null : String(data?.error?.message ?? `HTTP ${res.status}`).slice(0, 300),
  });
  if (!res.ok) return rawCopy;
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
    // Una sola lectura por petición: todas las plataformas se adaptan con el mismo modelo.
    const modelo = await modeloDeLab();
    const results = await Promise.all(
      platforms.map(async (platform) => {
        const adaptedCopy = await adaptForPlatform(rawCopy, platform, body.brandId!, modelo);

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
