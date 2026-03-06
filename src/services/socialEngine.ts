/**
 * UNRLVL — SocialLab Social Engine v1.2
 *
 * v1.2 changelog:
 * - Humanize layer (F2.5): getHumanizeBlock('copy') inyectado automáticamente en
 *   generateSocialCopy, enhanceCopy y adaptCopyForPlatform.
 *   suggestHashtags excluido por diseño (hashtags son técnicos, no copy).
 *
 * v1.1 changelog:
 * - generateSocialCopy()    — genera copy desde brief + marca + plataforma
 * - enhanceCopy()           — mejora/reescribe copy existente para la plataforma
 * - suggestHashtags()       — sugiere hashtags relevantes desde el copy
 * - adaptCopyForPlatform()  — adapta copy de plataforma origen a destino
 *
 * ARCHITECTURE NOTE:
 * This service is the ONLY file that changes when real APIs are activated.
 * All platform calls go through publishPost() which currently runs the mock layer.
 * To go live: implement OAuth token storage per brand x platform, replace
 * mockPublish() with real fetch() calls, handle platform-specific media uploads.
 */
import { PlatformId, PublishResult, ScheduledPost, Platform } from '../core/types';
import { getHumanizeBlock } from '../config/humanizeConfig';

const GEMINI_MODEL = "gemini-2.0-flash";

// ── GEMINI CALLER ─────────────────────────────────────────────────────────────
async function callGemini(prompt: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${(import.meta as any).env?.VITE_GEMINI_API_KEY ?? ""}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 800 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

// ── PLATFORM VOICE MAP ────────────────────────────────────────────────────────
const PLATFORM_VOICE: Record<PlatformId, string> = {
  INSTAGRAM: "Visual y aspiracional. Emojis moderados. Hashtags al final. Frases cortas e impactantes. CTA claro. Max 2200 chars.",
  FACEBOOK:  "Conversacional y cercano. Puede ser más largo. Storytelling funciona. Emojis opcionales. Invita a comentar/compartir.",
  TIKTOK:    "Hook en la primera línea (primeras 3 palabras deben atrapar). Lenguaje nativo gen-z/millennial. Ritmo rápido. Bajo en hashtags pero relevantes. Max 150 chars visibles.",
  LINKEDIN:  "Profesional pero humano. Primera línea es el hook (se corta antes de 'ver más'). Sin emojis excesivos. Insight + historia personal + CTA. Max 3000 chars.",
  YOUTUBE:   "Descripción SEO-optimizada. Keywords naturales en los primeros 150 chars. Timestamps si aplica. Links y CTAs al final.",
  THREADS:   "Micro-copy directo. Máximo 500 chars. Una sola idea por post. Conversacional. Sin hashtags en exceso.",
};

const PLATFORM_LABEL: Record<PlatformId, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK:  "Facebook",
  TIKTOK:    "TikTok",
  LINKEDIN:  "LinkedIn",
  YOUTUBE:   "YouTube",
  THREADS:   "Threads",
};

// ── 1. GENERATE COPY FROM BRIEF ───────────────────────────────────────────────
export async function generateSocialCopy(params: {
  brief: string;
  brandName: string;
  brandDescription: string;
  brandMarket: string;
  brandId?: string;
  platform: PlatformId;
  language?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const {
    brief, brandName, brandDescription, brandMarket,
    brandId, platform, language = "es-FL", signal
  } = params;

  // ── Humanize (F2.5) — siempre activo ────────────────────────────────────────
  const humanizeBlock = getHumanizeBlock('copy', brandId);

  const prompt = `Eres un copywriter senior especializado en social media para marcas hispanas en Miami.

MARCA: ${brandName}
DESCRIPCIÓN: ${brandDescription}
MERCADO: ${brandMarket}
PLATAFORMA: ${PLATFORM_LABEL[platform]}
IDIOMA: ${language === "es-FL" ? "Español latino para audiencia Miami/Florida (Spanglish natural)" : language}

BRIEF DE CAMPAÑA:
${brief}

REGLAS DE PLATAFORMA:
${PLATFORM_VOICE[platform]}

${humanizeBlock}

INSTRUCCIONES:
- Genera el copy completo listo para publicar en ${PLATFORM_LABEL[platform]}
- Aplica las reglas de plataforma al pie de la letra
- Incluye emojis y hashtags si corresponde a la plataforma
- NO incluyas meta-comentarios, instrucciones ni explicaciones. Solo el copy final.

GENERA EL COPY AHORA:`;

  return callGemini(prompt, signal);
}

// ── 2. ENHANCE EXISTING COPY ──────────────────────────────────────────────────
export async function enhanceCopy(params: {
  copy: string;
  brandName: string;
  brandDescription: string;
  brandId?: string;
  platform: PlatformId;
  signal?: AbortSignal;
}): Promise<string> {
  const { copy, brandName, brandDescription, brandId, platform, signal } = params;

  // ── Humanize (F2.5) — siempre activo ────────────────────────────────────────
  const humanizeBlock = getHumanizeBlock('copy', brandId);

  const prompt = `Eres un editor senior de social media especializado en marcas hispanas Miami.

MARCA: ${brandName}
DESCRIPCIÓN: ${brandDescription}
PLATAFORMA: ${PLATFORM_LABEL[platform]}

COPY ORIGINAL:
${copy}

REGLAS DE PLATAFORMA:
${PLATFORM_VOICE[platform]}

${humanizeBlock}

TAREA: Mejora y reescribe este copy para maximizar su impacto en ${PLATFORM_LABEL[platform]}.
Mantén la voz y la intención original pero:
- Fortalece el hook de apertura
- Mejora el ritmo y la legibilidad
- Refuerza el CTA si existe
- Optimiza para las reglas específicas de ${PLATFORM_LABEL[platform]}
- Corrige cualquier debilidad de estructura

Devuelve SOLO el copy mejorado, sin explicaciones ni comparaciones.

COPY MEJORADO:`;

  return callGemini(prompt, signal);
}

// ── 3. SUGGEST HASHTAGS ───────────────────────────────────────────────────────
// NOTE (F2.5): Humanize NO aplica aquí por diseño.
// Los hashtags son técnicos/estratégicos, no copy narrativo.
export async function suggestHashtags(params: {
  copy: string;
  brandName: string;
  brandMarket: string;
  platform: PlatformId;
  signal?: AbortSignal;
}): Promise<string[]> {
  const { copy, brandName, brandMarket, platform, signal } = params;

  const hashtagConfig: Partial<Record<PlatformId, string>> = {
    INSTAGRAM: "Entre 8 y 15 hashtags. Mix de: 3-4 muy populares (>1M posts), 4-5 nicho (100K-1M), 2-3 micro-nicho (<100K) y 1-2 de marca.",
    TIKTOK:    "Entre 3 y 6 hashtags. Prioriza tendencias actuales y hashtags virales de la categoría.",
    FACEBOOK:  "Máximo 3-5 hashtags relevantes. Facebook no es hashtag-driven.",
    LINKEDIN:  "Entre 3 y 5 hashtags profesionales y de industria.",
    THREADS:   "Máximo 3 hashtags o ninguno. Threads no depende de hashtags.",
    YOUTUBE:   "Entre 5 y 10 keywords/hashtags SEO relevantes para el video.",
  };

  const prompt = `Eres un estratega de social media especializado en marcas hispanas Miami.

MARCA: ${brandName}
MERCADO: ${brandMarket}
PLATAFORMA: ${PLATFORM_LABEL[platform]}

COPY DEL POST:
${copy}

INSTRUCCIONES DE HASHTAGS PARA ${PLATFORM_LABEL[platform]}:
${hashtagConfig[platform] || "Genera hashtags relevantes y específicos al contenido."}

Genera hashtags en español e inglés según aplique al mercado hispano Miami.
Incluye hashtags de ubicación Miami/Florida cuando sean relevantes.
Devuelve SOLO los hashtags en una sola línea separados por espacios, con el símbolo #.
Ejemplo: #MiamiBusiness #NegociosMiami #BellezaMiami

HASHTAGS:`;

  const raw = await callGemini(prompt, signal);
  const matches = raw.match(/#[\w\u00C0-\u024F\u00F1]+/g) || [];
  return [...new Set(matches)];
}

// ── 4. ADAPT COPY FOR PLATFORM ────────────────────────────────────────────────
export async function adaptCopyForPlatform(params: {
  copy: string;
  brandName: string;
  brandDescription: string;
  brandId?: string;
  sourcePlatform: PlatformId;
  targetPlatform: PlatformId;
  signal?: AbortSignal;
}): Promise<string> {
  const {
    copy, brandName, brandDescription, brandId,
    sourcePlatform, targetPlatform, signal
  } = params;

  // ── Humanize (F2.5) — siempre activo ────────────────────────────────────────
  const humanizeBlock = getHumanizeBlock('copy', brandId);

  const prompt = `Eres un copywriter senior especializado en social media para marcas hispanas en Miami.

MARCA: ${brandName}
DESCRIPCIÓN: ${brandDescription}

COPY ORIGINAL (${PLATFORM_LABEL[sourcePlatform]}):
${copy}

PLATAFORMA DESTINO: ${PLATFORM_LABEL[targetPlatform]}

REGLAS DE ${PLATFORM_LABEL[targetPlatform]}:
${PLATFORM_VOICE[targetPlatform]}

${humanizeBlock}

TAREA: Adapta el copy original para que funcione nativamente en ${PLATFORM_LABEL[targetPlatform]}.
- Mantén la esencia del mensaje y la voz de marca
- Reformatea completamente para las convenciones de ${PLATFORM_LABEL[targetPlatform]}
- Ajusta longitud, emojis, hashtags y estructura al estilo nativo de la plataforma
- NO es una traducción — es una reinterpretación nativa

Devuelve SOLO el copy adaptado, sin explicaciones.

COPY ADAPTADO PARA ${PLATFORM_LABEL[targetPlatform]}:`;

  return callGemini(prompt, signal);
}

// ── MOCK PUBLISH LAYER ────────────────────────────────────────────────────────
const MOCK_DELAY_MS     = 1200;
const MOCK_SUCCESS_RATE = 0.92;

function generateMockPostId(platform: PlatformId): string {
  const prefixes: Record<PlatformId, string> = {
    INSTAGRAM: "IG_", FACEBOOK: "FB_", TIKTOK: "TT_",
    LINKEDIN: "LI_", YOUTUBE: "YT_", THREADS: "TH_",
  };
  return `${prefixes[platform]}${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function mockPublish(post: ScheduledPost): Promise<PublishResult> {
  await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
  const success = Math.random() < MOCK_SUCCESS_RATE;
  return success
    ? { success: true, mockPostId: generateMockPostId(post.platform), platform: post.platform }
    : { success: false, errorMsg: `[MOCK] Simulated API error — ${post.platform} rate limit`, platform: post.platform };
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────
export async function publishPost(post: ScheduledPost): Promise<PublishResult> {
  return mockPublish(post);
}

export function estimateCharCount(copy: string, hashtags: string[]): number {
  const hashtagStr = hashtags.length ? "\n\n" + hashtags.map(h => `#${h}`).join(" ") : "";
  return (copy + hashtagStr).length;
}

export function validatePost(post: Partial<ScheduledPost>, maxChars: number): string[] {
  const errors: string[] = [];
  if (!post.copy?.trim()) errors.push("El copy no puede estar vacío.");
  if (post.copy && estimateCharCount(post.copy, post.hashtags || []) > maxChars)
    errors.push(`Supera el límite de ${maxChars} caracteres para esta plataforma.`);
  if (!post.scheduledAt) errors.push("Debes programar una fecha y hora.");
  if (!post.brandId) errors.push("Selecciona una marca.");
  return errors;
}

export function extractHashtags(copy: string): string[] {
  const matches = copy.match(/#[\w\u00C0-\u024F]+/g) || [];
  return matches.map(h => h.slice(1));
}