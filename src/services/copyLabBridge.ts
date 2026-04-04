/**
 * copyLabBridge.ts — SocialLab v1.3
 * Coloca en: src/services/copyLabBridge.ts
 * Fix 2026-04-04: eliminado _meta (no existe en ScheduledPost)
 */

import { PlatformId, ScheduledPost } from '../core/types';

// ── SUPABASE ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL  ?? '';
const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';
const SB_HEADERS   = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

export interface BrandSocialAccount {
  id:             string;
  brand_id:       string;
  platform:       string;
  account_handle: string | null;
  account_name:   string | null;
  is_connected:   boolean;
  is_primary:     boolean;
  status:         string;
}

export async function loadBrandSocialAccounts(brandId: string): Promise<BrandSocialAccount[]> {
  if (!SUPABASE_URL || !brandId) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/brand_social_accounts?brand_id=eq.${encodeURIComponent(brandId)}` +
      `&order=platform.asc&select=id,brand_id,platform,account_handle,account_name,is_connected,is_primary,status`,
      { headers: SB_HEADERS }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ── BRIDGE TYPES ──────────────────────────────────────────────────────────────

export interface CopyLabImport {
  rawInput:  string;
  brandId?:  string;
  platform?: PlatformId;
}

export interface ParseResult {
  success:    boolean;
  copy:       string;
  brandId?:   string;
  platform?:  PlatformId;
  sourceType: 'text' | 'video_podcast_json' | 'structured_json' | 'error';
  error?:     string;
  blocks?:    { id: string; type: string; text: string; speaker?: string }[];
}

// ── PARSER ────────────────────────────────────────────────────────────────────

export function parseCopyLabInput(input: CopyLabImport): ParseResult {
  const raw = input.rawInput.trim();
  if (!raw) return { success: false, copy: '', sourceType: 'error', error: 'Input vacío.' };

  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);

      // Caso 1: Array de bloques VideoPodcast
      if (Array.isArray(parsed) && parsed.length > 0 && 'text' in parsed[0]) {
        const blocks = parsed as { id: string; type: string; text: string; speaker?: string }[];
        const copy   = blocks.map(b => b.speaker ? `[${b.speaker}] ${b.text}` : b.text).join('\n\n');
        return { success: true, copy, brandId: input.brandId, platform: input.platform, sourceType: 'video_podcast_json', blocks };
      }

      // Caso 2: Objeto estructurado { copy, brand_id?, platform? }
      if (!Array.isArray(parsed) && typeof parsed === 'object') {
        const obj  = parsed as Record<string, any>;
        const copy = obj.copy || obj.content || obj.text || JSON.stringify(parsed, null, 2);
        return {
          success: true, copy,
          brandId:  obj.brand_id || input.brandId,
          platform: (obj.platform || input.platform) as PlatformId | undefined,
          sourceType: 'structured_json',
        };
      }
    } catch { /* Not valid JSON */ }
  }

  // Caso 3: Texto libre
  return { success: true, copy: raw, brandId: input.brandId, platform: input.platform, sourceType: 'text' };
}

// ── POST BUILDER ──────────────────────────────────────────────────────────────

export function buildDraftPost(result: ParseResult, brandId: string, platform: PlatformId): ScheduledPost {
  return {
    id:          `copylab_import_${Date.now()}`,
    brandId:     result.brandId || brandId,
    platform:    result.platform || platform,
    copy:        result.copy,
    hashtags:    [],
    mediaUrls:   [],
    mediaType:   null,
    scheduledAt: '',
    status:      'scheduled',
    createdAt:   new Date().toISOString(),
  };
}

// ── CLIPBOARD IMPORT ──────────────────────────────────────────────────────────

export async function importFromClipboard(brandId: string, platform: PlatformId): Promise<ParseResult> {
  try {
    const text = await navigator.clipboard.readText();
    return parseCopyLabInput({ rawInput: text, brandId, platform });
  } catch {
    return { success: false, copy: '', sourceType: 'error', error: 'No se pudo leer el portapapeles. Pega el texto manualmente.' };
  }
}
