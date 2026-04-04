/**
 * copyLabBridge.ts — SocialLab v1.3
 *
 * Puente CopyLab → SocialLab.
 * Permite importar el output JSON de CopyLab directamente al queue de SocialLab,
 * eliminando el copy-paste manual entre labs.
 *
 * Coloca este archivo en: src/services/copyLabBridge.ts
 *
 * FORMATO DE ENTRADA (CopyLab export JSON):
 * CopyLab exporta su output como texto. Cuando Sam genera copy en CopyLab,
 * puede copiar el resultado y pegarlo en SocialLab.
 * Este bridge lo parsea y crea un ScheduledPost draft listo para publicar.
 *
 * También soporta el formato VideoPodcast JSON de CopyLab:
 * { label, speaker, content }[] → se convierte en un bloque de texto.
 *
 * TIPOS DE IMPORT SOPORTADOS:
 * 1. Texto libre (copy directo de CopyLab) → 1 post borrador
 * 2. JSON array de bloques VideoPodcast → texto concatenado
 * 3. JSON object con { copy, brand_id, platform, ... } → post estructurado
 */

import { PlatformId, ScheduledPost } from '../core/types';

// ── SUPABASE (para leer brand_social_accounts) ────────────────────────────────

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL  ?? '';
const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';
const SB_HEADERS = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

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
  /** Texto pegado desde CopyLab (copy listo, JSON de bloques, o JSON estructurado) */
  rawInput:   string;
  /** Marca que viene de CopyLab — debería matchear con la seleccionada en SocialLab */
  brandId?:   string;
  /** Plataforma sugerida desde CopyLab (puede no venir) */
  platform?:  PlatformId;
}

export interface ParseResult {
  success:    boolean;
  copy:       string;
  brandId?:   string;
  platform?:  PlatformId;
  sourceType: 'text' | 'video_podcast_json' | 'structured_json' | 'error';
  error?:     string;
  /** Bloques originales si era VideoPodcast */
  blocks?:    { id: string; type: string; text: string; speaker?: string }[];
}

// ── PARSER ────────────────────────────────────────────────────────────────────

/**
 * Parsea el input de CopyLab y devuelve un objeto estructurado.
 * Acepta texto libre, JSON de bloques VP, o JSON de objeto copy.
 */
export function parseCopyLabInput(input: CopyLabImport): ParseResult {
  const raw = input.rawInput.trim();
  if (!raw) {
    return { success: false, copy: '', sourceType: 'error', error: 'Input vacío.' };
  }

  // Intentar parsear como JSON
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);

      // Caso 1: Array de bloques VideoPodcast [ { id, type, text, speaker? } ]
      if (Array.isArray(parsed) && parsed.length > 0 && 'text' in parsed[0]) {
        const blocks = parsed as { id: string; type: string; text: string; speaker?: string }[];
        const copy = blocks
          .map(b => b.speaker ? `[${b.speaker}] ${b.text}` : b.text)
          .join('\n\n');
        return {
          success: true,
          copy,
          brandId: input.brandId,
          platform: input.platform,
          sourceType: 'video_podcast_json',
          blocks,
        };
      }

      // Caso 2: Objeto estructurado { copy, brand_id?, platform?, ... }
      if (!Array.isArray(parsed) && typeof parsed === 'object') {
        const obj = parsed as Record<string, any>;
        const copy = obj.copy || obj.content || obj.text || JSON.stringify(parsed, null, 2);
        return {
          success: true,
          copy,
          brandId: obj.brand_id || input.brandId,
          platform: (obj.platform || input.platform) as PlatformId | undefined,
          sourceType: 'structured_json',
        };
      }
    } catch {
      // Not valid JSON — fall through to text mode
    }
  }

  // Caso 3: Texto libre (copy directo de CopyLab)
  return {
    success: true,
    copy: raw,
    brandId: input.brandId,
    platform: input.platform,
    sourceType: 'text',
  };
}

// ── POST BUILDER ──────────────────────────────────────────────────────────────

/**
 * Convierte un ParseResult en un ScheduledPost draft.
 * scheduledAt queda vacío — el usuario lo completa en SocialLab antes de publicar.
 */
export function buildDraftPost(result: ParseResult, brandId: string, platform: PlatformId): ScheduledPost {
  return {
    id:          `copylab_import_${Date.now()}`,
    brandId:     result.brandId || brandId,
    platform:    result.platform || platform,
    copy:        result.copy,
    hashtags:    [],
    mediaUrls:   [],
    mediaType:   null,
    scheduledAt: '',          // usuario completa en SocialLab
    status:      'draft' as any,
    createdAt:   new Date().toISOString(),
    // Meta para saber que viene de CopyLab
    _meta: {
      source:     'copylab_import',
      sourceType: result.sourceType,
      importedAt: new Date().toISOString(),
    } as any,
  };
}

// ── CONVENIENCE: IMPORT FROM CLIPBOARD ───────────────────────────────────────

/**
 * Lee el clipboard y devuelve el resultado parseado.
 * Se llama cuando el usuario hace clic en "Importar de CopyLab".
 */
export async function importFromClipboard(
  brandId: string,
  platform: PlatformId
): Promise<ParseResult> {
  try {
    const text = await navigator.clipboard.readText();
    return parseCopyLabInput({ rawInput: text, brandId, platform });
  } catch {
    return {
      success: false,
      copy: '',
      sourceType: 'error',
      error: 'No se pudo leer el portapapeles. Pega el texto manualmente.',
    };
  }
}
