/**
 * UNRLVL — SocialLab Social Engine v2.0
 *
 * v2.0 changelog:
 * - Gemini client-side REMOVED — API key exposure eliminated
 * - All AI operations now call /api/generate-post (Claude server-side)
 * - humanizeBlock resolved server-side via resolveHumanizeCopy() before calling API
 * - Brand IDs passed as canonical via toCanonicalId() in the caller
 *
 * ARCHITECTURE:
 * This service is the ONLY file that changes when real APIs are activated.
 * publishPost() runs the mock layer. To go live: implement OAuth token storage
 * per brand × platform, replace mockPublish() with real fetch() calls.
 */

import { PlatformId, PublishResult, ScheduledPost } from '../core/types';

// ---------------------------------------------------------------------------
// INTERNAL API CALLER — replaces callGemini()
// ---------------------------------------------------------------------------

async function callGeneratePost(
  body: Record<string, any>,
  signal?: AbortSignal
): Promise<any> {
  const res = await fetch('/api/generate-post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `API error ${res.status}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// 1. GENERATE COPY FROM BRIEF
// ---------------------------------------------------------------------------

export async function generateSocialCopy(params: {
  brief: string;
  brandName: string;
  brandDescription: string;
  brandMarket: string;
  brandId?: string;
  platform: PlatformId;
  language?: string;
  humanizeBlock?: string;   // resolved by PostBuilderModule from context
  signal?: AbortSignal;
}): Promise<string> {
  const data = await callGeneratePost(
    {
      operation: 'generate',
      brief: params.brief,
      brandName: params.brandName,
      brandDescription: params.brandDescription,
      brandMarket: params.brandMarket,
      brandId: params.brandId,
      platform: params.platform,
      language: params.language ?? 'es-FL',
      humanizeBlock: params.humanizeBlock ?? '',
    },
    params.signal
  );
  return data.result ?? '';
}

// ---------------------------------------------------------------------------
// 2. ENHANCE EXISTING COPY
// ---------------------------------------------------------------------------

export async function enhanceCopy(params: {
  copy: string;
  brandName: string;
  brandDescription: string;
  brandId?: string;
  platform: PlatformId;
  humanizeBlock?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const data = await callGeneratePost(
    {
      operation: 'enhance',
      copy: params.copy,
      brandName: params.brandName,
      brandDescription: params.brandDescription,
      brandId: params.brandId,
      platform: params.platform,
      humanizeBlock: params.humanizeBlock ?? '',
    },
    params.signal
  );
  return data.result ?? '';
}

// ---------------------------------------------------------------------------
// 3. SUGGEST HASHTAGS
// NOTE: Humanize NOT applied here by design (hashtags are technical, not copy)
// ---------------------------------------------------------------------------

export async function suggestHashtags(params: {
  copy: string;
  brandName: string;
  brandMarket: string;
  platform: PlatformId;
  signal?: AbortSignal;
}): Promise<string[]> {
  const data = await callGeneratePost(
    {
      operation: 'hashtags',
      copy: params.copy,
      brandName: params.brandName,
      brandMarket: params.brandMarket,
      platform: params.platform,
    },
    params.signal
  );
  return data.hashtags ?? [];
}

// ---------------------------------------------------------------------------
// 4. ADAPT COPY FOR PLATFORM
// ---------------------------------------------------------------------------

export async function adaptCopyForPlatform(params: {
  copy: string;
  brandName: string;
  brandDescription: string;
  brandId?: string;
  sourcePlatform: PlatformId;
  targetPlatform: PlatformId;
  humanizeBlock?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const data = await callGeneratePost(
    {
      operation: 'adapt',
      copy: params.copy,
      brandName: params.brandName,
      brandDescription: params.brandDescription,
      brandId: params.brandId,
      platform: params.targetPlatform,
      sourcePlatform: params.sourcePlatform,
      targetPlatform: params.targetPlatform,
      humanizeBlock: params.humanizeBlock ?? '',
    },
    params.signal
  );
  return data.result ?? '';
}

// ---------------------------------------------------------------------------
// MOCK PUBLISH LAYER — unchanged, real API is next sprint (SocialLab Launch)
// ---------------------------------------------------------------------------

const MOCK_DELAY_MS     = 1200;
const MOCK_SUCCESS_RATE = 0.92;

function generateMockPostId(platform: PlatformId): string {
  const prefixes: Record<PlatformId, string> = {
    INSTAGRAM: 'IG_', FACEBOOK: 'FB_', TIKTOK: 'TT_',
    LINKEDIN: 'LI_', YOUTUBE: 'YT_', THREADS: 'TH_',
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

export async function publishPost(post: ScheduledPost): Promise<PublishResult> {
  return mockPublish(post);
}

// ---------------------------------------------------------------------------
// UTILITIES — unchanged
// ---------------------------------------------------------------------------

export function estimateCharCount(copy: string, hashtags: string[]): number {
  const hashtagStr = hashtags.length ? '\n\n' + hashtags.join(' ') : '';
  return (copy + hashtagStr).length;
}

export function validatePost(post: Partial<ScheduledPost>, maxChars: number): string[] {
  const errors: string[] = [];
  if (!post.copy?.trim())         errors.push('El copy no puede estar vacío.');
  if (post.copy && estimateCharCount(post.copy, post.hashtags || []) > maxChars)
    errors.push(`Supera el límite de ${maxChars} caracteres para esta plataforma.`);
  if (!post.scheduledAt)          errors.push('Debes programar una fecha y hora.');
  if (!post.brandId)              errors.push('Selecciona una marca.');
  return errors;
}

export function extractHashtags(copy: string): string[] {
  const matches = copy.match(/#[\w\u00C0-\u024F]+/g) || [];
  return matches.map(h => h.slice(1));
}
