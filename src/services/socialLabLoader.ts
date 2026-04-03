/**
 * socialLabLoader.ts
 * Loads SocialLab data from Supabase with automatic fallback to hardcoded config.
 *
 * CRITICAL: SocialLab uses camelCase brand IDs (diamondDetails, neuroneCosmetics)
 * that DON'T match the canonical Supabase PKs (DiamondDetails, NeuroneSCF).
 * This loader handles the translation transparently so the rest of the app
 * can keep using the local IDs while Supabase gets the canonical ones.
 */

import { BRAND_LIST, Brand } from '../config/brands';
import { HUMANIZE_DEFAULTS, getHumanizeBlock, HumanizeProfile } from '../config/humanizeConfig';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// CANONICAL ID MAP — local camelCase → Supabase PK
// ---------------------------------------------------------------------------

export const LOCAL_TO_CANONICAL: Record<string, string> = {
  neuroneCosmetics:          'NeuroneSCF',
  patriciaOsorioPersonal:    'PatriciaOsorioPersonal',
  patriciaOsorioComunidad:   'PatriciaOsorioComunidad',
  patriciaOsorioVizosSalon:  'PatriciaOsorioVizosSalon',
  diamondDetails:            'DiamondDetails',
  d7Herbal:                  'D7Herbal',
  vivoseMask:                'VivoseMask',
  vizosCosmetics:            'VizosCosmetics',
  phas:                      'ForumPHs',       // closest match — PHAS not in Supabase yet
  unrealilleStudio:          'UnrealvilleStudio',
};

/** Returns the canonical Supabase brand ID for a local brand ID. */
export function toCanonicalId(localId: string): string {
  return LOCAL_TO_CANONICAL[localId] ?? localId;
}

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/** Humanize profile for a single brand, keyed by medium. */
export interface SocialHumanizeProfile {
  canonicalBrandId: string;
  copy:  string;
  image: string;
  video: string;
  voice: string;
  web:   string;
}

export interface SocialLabData {
  /** Raw humanize profiles from Supabase, keyed by canonical brand ID */
  humanizeByBrand: Record<string, Partial<HumanizeProfile>>;
}

// ---------------------------------------------------------------------------
// SUPABASE FETCH
// ---------------------------------------------------------------------------

async function sbFetch(table: string, params: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`[SocialLabLoader] ${table} fetch failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// MAIN LOADER
// ---------------------------------------------------------------------------

export async function loadSocialLabData(): Promise<SocialLabData> {
  const rows = await sbFetch(
    'humanize_profiles',
    'select=brand_id,medium,tone,personality,sentence_style&active=eq.true'
  );

  // Build a map: canonicalBrandId → { medium: assembled string }
  const humanizeByBrand: Record<string, Partial<HumanizeProfile>> = {};

  for (const row of rows) {
    if (!row.brand_id || !row.medium) continue;
    if (!humanizeByBrand[row.brand_id]) humanizeByBrand[row.brand_id] = {};

    const parts: string[] = [];
    if (row.tone)           parts.push(row.tone);
    if (row.personality)    parts.push(row.personality);
    if (row.sentence_style) parts.push(row.sentence_style);

    if (parts.length > 0) {
      (humanizeByBrand[row.brand_id] as any)[row.medium] = parts.join('\n');
    }
  }

  return { humanizeByBrand };
}

// ---------------------------------------------------------------------------
// RESOLVE HUMANIZE — Supabase → brandOverride → DEFAULT (fallback chain)
// ---------------------------------------------------------------------------

/**
 * Returns the humanize copy block for a given local brand ID.
 * Chain: Supabase humanize_profiles → hardcoded BRAND_HUMANIZE_OVERRIDES → HUMANIZE_DEFAULTS
 */
export function resolveHumanizeCopy(
  localBrandId: string,
  supabaseData: SocialLabData | null
): string {
  const canonicalId = toCanonicalId(localBrandId);

  // 1. Supabase data (real-time, takes priority)
  if (supabaseData) {
    const profile = supabaseData.humanizeByBrand[canonicalId];
    if (profile?.copy?.trim()) return profile.copy.trim();
  }

  // 2. Hardcoded brand override (fallback)
  return getHumanizeBlock('copy', localBrandId);
}

// ---------------------------------------------------------------------------
// FALLBACK DATA
// ---------------------------------------------------------------------------

export const FALLBACK_DATA: SocialLabData = {
  humanizeByBrand: {},
};
