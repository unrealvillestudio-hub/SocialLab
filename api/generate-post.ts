/**
 * api/generate-post.ts
 * Vercel serverless function — Claude server-side for all SocialLab AI operations.
 * Replaces the Gemini client-side calls entirely.
 *
 * POST /api/generate-post
 * Body: GeneratePostRequest
 * Response: { result: string } | { hashtags: string[] }
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

type Operation = 'generate' | 'enhance' | 'hashtags' | 'adapt';

interface GeneratePostRequest {
  operation: Operation;
  // Common
  brandName: string;
  brandDescription: string;
  brandMarket: string;
  brandId?: string;          // local camelCase ID for humanize lookup
  platform: string;
  language?: string;
  humanizeBlock?: string;    // resolved by client from Supabase/fallback
  // generate
  brief?: string;
  // enhance / hashtags / adapt
  copy?: string;
  // adapt
  sourcePlatform?: string;
  targetPlatform?: string;
}

// ---------------------------------------------------------------------------
// PLATFORM VOICE MAP
// ---------------------------------------------------------------------------

const PLATFORM_VOICE: Record<string, string> = {
  INSTAGRAM: 'Visual y aspiracional. Emojis moderados. Hashtags al final. Frases cortas e impactantes. CTA claro. Max 2200 chars.',
  FACEBOOK:  'Conversacional y cercano. Puede ser más largo. Storytelling funciona. Emojis opcionales. Invita a comentar/compartir.',
  TIKTOK:    'Hook en la primera línea (primeras 3 palabras deben atrapar). Lenguaje nativo gen-z/millennial. Ritmo rápido. Bajo en hashtags pero relevantes. Max 150 chars visibles.',
  LINKEDIN:  'Profesional pero humano. Primera línea es el hook. Sin emojis excesivos. Insight + historia personal + CTA. Max 3000 chars.',
  YOUTUBE:   'Descripción SEO-optimizada. Keywords naturales en los primeros 150 chars. Timestamps si aplica. Links y CTAs al final.',
  THREADS:   'Micro-copy directo. Máximo 500 chars. Una sola idea por post. Conversacional. Sin hashtags en exceso.',
};

const HASHTAG_CONFIG: Record<string, string> = {
  INSTAGRAM: 'Entre 8 y 15 hashtags. Mix de: 3-4 muy populares (>1M posts), 4-5 nicho (100K-1M), 2-3 micro-nicho (<100K) y 1-2 de marca.',
  TIKTOK:    'Entre 3 y 6 hashtags. Prioriza tendencias actuales y hashtags virales de la categoría.',
  FACEBOOK:  'Máximo 3-5 hashtags relevantes. Facebook no es hashtag-driven.',
  LINKEDIN:  'Entre 3 y 5 hashtags profesionales y de industria.',
  THREADS:   'Máximo 3 hashtags o ninguno.',
  YOUTUBE:   'Entre 5 y 10 keywords/hashtags SEO relevantes para el video.',
};

// ---------------------------------------------------------------------------
// PROMPT BUILDERS
// ---------------------------------------------------------------------------

function buildGeneratePrompt(req: GeneratePostRequest): string {
  const langLabel = req.language === 'es-FL'
    ? 'Español latino para audiencia Miami/Florida (Spanglish natural)'
    : (req.language || 'es-ES');

  return `Eres un copywriter senior especializado en social media para marcas hispanas en Miami.

MARCA: ${req.brandName}
DESCRIPCIÓN: ${req.brandDescription}
MERCADO: ${req.brandMarket}
PLATAFORMA: ${req.platform}
IDIOMA: ${langLabel}

BRIEF DE CAMPAÑA:
${req.brief}

REGLAS DE PLATAFORMA:
${PLATFORM_VOICE[req.platform] || 'Genera copy nativo y efectivo para esta plataforma.'}

${req.humanizeBlock ? `CAPA HUMANIZE (aplicar siempre):\n${req.humanizeBlock}` : ''}

INSTRUCCIONES:
- Genera el copy completo listo para publicar en ${req.platform}
- Aplica las reglas de plataforma al pie de la letra
- Incluye emojis y hashtags si corresponde a la plataforma
- NO incluyas meta-comentarios, instrucciones ni explicaciones. Solo el copy final.

GENERA EL COPY AHORA:`;
}

function buildEnhancePrompt(req: GeneratePostRequest): string {
  return `Eres un editor senior de social media especializado en marcas hispanas Miami.

MARCA: ${req.brandName}
DESCRIPCIÓN: ${req.brandDescription}
PLATAFORMA: ${req.platform}

COPY ORIGINAL:
${req.copy}

REGLAS DE PLATAFORMA:
${PLATFORM_VOICE[req.platform] || ''}

${req.humanizeBlock ? `CAPA HUMANIZE:\n${req.humanizeBlock}` : ''}

TAREA: Mejora y reescribe este copy para maximizar su impacto en ${req.platform}.
Mantén la voz y la intención original pero:
- Fortalece el hook de apertura
- Mejora el ritmo y la legibilidad
- Refuerza el CTA si existe
- Optimiza para las reglas específicas de ${req.platform}
- Corrige cualquier debilidad de estructura

Devuelve SOLO el copy mejorado, sin explicaciones ni comparaciones.
COPY MEJORADO:`;
}

function buildHashtagsPrompt(req: GeneratePostRequest): string {
  return `Eres un estratega de social media especializado en marcas hispanas Miami.

MARCA: ${req.brandName}
MERCADO: ${req.brandMarket}
PLATAFORMA: ${req.platform}

COPY DEL POST:
${req.copy}

INSTRUCCIONES DE HASHTAGS PARA ${req.platform}:
${HASHTAG_CONFIG[req.platform] || 'Genera hashtags relevantes y específicos al contenido.'}

Genera hashtags en español e inglés según aplique al mercado hispano Miami.
Incluye hashtags de ubicación Miami/Florida cuando sean relevantes.
Devuelve SOLO los hashtags en una sola línea separados por espacios, con el símbolo #.
Ejemplo: #MiamiBusiness #NegociosMiami #BellezaMiami

HASHTAGS:`;
}

function buildAdaptPrompt(req: GeneratePostRequest): string {
  return `Eres un copywriter senior especializado en social media para marcas hispanas en Miami.

MARCA: ${req.brandName}
DESCRIPCIÓN: ${req.brandDescription}

COPY ORIGINAL (${req.sourcePlatform}):
${req.copy}

PLATAFORMA DESTINO: ${req.targetPlatform}
REGLAS DE ${req.targetPlatform}:
${PLATFORM_VOICE[req.targetPlatform!] || ''}

${req.humanizeBlock ? `CAPA HUMANIZE:\n${req.humanizeBlock}` : ''}

TAREA: Adapta el copy original para que funcione nativamente en ${req.targetPlatform}.
- Mantén la esencia del mensaje y la voz de marca
- Reformatea completamente para las convenciones de ${req.targetPlatform}
- Ajusta longitud, emojis, hashtags y estructura al estilo nativo de la plataforma
- NO es una traducción — es una reinterpretación nativa

Devuelve SOLO el copy adaptado, sin explicaciones.
COPY ADAPTADO PARA ${req.targetPlatform}:`;
}

// ---------------------------------------------------------------------------
// HANDLER
// ---------------------------------------------------------------------------

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body: GeneratePostRequest = req.body;

  if (!body.operation || !body.brandName || !body.platform) {
    return res.status(400).json({ error: 'Missing required fields: operation, brandName, platform' });
  }

  try {
    let prompt: string;

    switch (body.operation) {
      case 'generate':
        if (!body.brief?.trim()) return res.status(400).json({ error: 'Brief required for generate' });
        prompt = buildGeneratePrompt(body);
        break;
      case 'enhance':
        if (!body.copy?.trim()) return res.status(400).json({ error: 'Copy required for enhance' });
        prompt = buildEnhancePrompt(body);
        break;
      case 'hashtags':
        if (!body.copy?.trim()) return res.status(400).json({ error: 'Copy required for hashtags' });
        prompt = buildHashtagsPrompt(body);
        break;
      case 'adapt':
        if (!body.copy?.trim() || !body.targetPlatform) {
          return res.status(400).json({ error: 'Copy and targetPlatform required for adapt' });
        }
        prompt = buildAdaptPrompt(body);
        break;
      default:
        return res.status(400).json({ error: `Unknown operation: ${body.operation}` });
    }

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = message.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');

    // For hashtags, parse into array
    if (body.operation === 'hashtags') {
      const matches = rawText.match(/#[\w\u00C0-\u024F\u00F1]+/g) || [];
      const hashtags = [...new Set(matches)] as string[];
      return res.status(200).json({ hashtags });
    }

    return res.status(200).json({ result: rawText.trim() });

  } catch (err: any) {
    console.error('[generate-post] Error:', err);
    return res.status(500).json({ error: 'Generation failed', detail: err.message });
  }
}
