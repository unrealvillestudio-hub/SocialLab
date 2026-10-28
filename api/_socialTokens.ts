/**
 * SocialLab — api/_socialTokens.ts
 *
 * EL ALMACÉN DE TOKENS OAUTH POR (PROVEEDOR, MARCA). Espeja el patrón del carril Meta, donde la
 * config y el token de cada marca viven en una tabla de Supabase resuelta por `brand_id`
 * (`unrlvl-meta-mcp/lib/meta.ts → getBrand`, tabla `meta_accounts`). Aquí la tabla es
 * `social_oauth_tokens`, con clave `(provider, brand_id)`:
 *
 *   - **El eje** es «un token OAuth por (proveedor, marca)». Vive en el código.
 *   - **La instancia** es cada fila: una marca, un proveedor. Vive en el dato.
 *   Meter otra marca o conectar otra cuenta es un INSERT, nunca una edición de código (test N+1).
 *
 * POR QUÉ UNA TABLA Y NO VAULT. El refresh de TikTok puede devolver un refresh_token DISTINTO del
 * enviado y hay que guardar el nuevo (doc oficial, medido 2026-10-28). Un secreto de sólo lectura
 * no puede rotar; el token de usuario necesita un almacén de ESCRITURA. El secreto de APP
 * (client_key/client_secret) sí va a env/Vault y lo carga Sam — eso es lo que CC no puede cargar
 * (`CC_PROTOCOL.md` §13 P0-B).
 *
 * Usa REST de Supabase con el service role, igual que `publish.ts`. No se usa `@supabase/supabase-js`
 * (no es dependencia del repo). El prefijo `_` marca módulo, NO ruta de Vercel.
 *
 * ── ESQUEMA (lo crea Sam; el DDL va documentado en el cuerpo del PR) ──────────
 *   create table if not exists public.social_oauth_tokens (
 *     provider                  text        not null,
 *     brand_id                  text        not null,
 *     open_id                   text,
 *     access_token              text        not null,
 *     refresh_token             text        not null,
 *     scope                     text,
 *     access_token_expires_at   timestamptz,
 *     refresh_token_expires_at  timestamptz,
 *     updated_at                timestamptz not null default now(),
 *     primary key (provider, brand_id)
 *   );
 *   -- RLS: sin políticas para anon/authenticated. Sólo el service role (que las omite) la toca.
 */

declare const process: { env: Record<string, string | undefined> };

const SB_URL = () => process.env.SUPABASE_URL ?? '';
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const TABLE = 'social_oauth_tokens';

/** Una fila de token tal como se lee/escribe. Épocas en ISO en la base; en ms en el código puro. */
export interface SocialTokenRow {
  provider: string;
  brand_id: string;
  open_id: string | null;
  access_token: string;
  refresh_token: string;
  scope: string | null;
  access_token_expires_at: string | null;   // ISO
  refresh_token_expires_at: string | null;  // ISO
}

/** Falta de configuración: se nombra por su nombre, no se deja caer en un fetch contra `''`. */
export class SocialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocialStoreError';
  }
}

function requireConfig(): void {
  if (!SB_URL() || !SB_KEY()) {
    throw new SocialStoreError('faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el runtime');
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, ...extra };
}

/** Lee el token de una (marca, proveedor). `null` si no hay fila: la cuenta no se conectó aún. */
export async function getSocialToken(provider: string, brandId: string): Promise<SocialTokenRow | null> {
  requireConfig();
  const q = `${TABLE}?provider=eq.${encodeURIComponent(provider)}&brand_id=eq.${encodeURIComponent(brandId)}&limit=1`;
  const res = await fetch(`${SB_URL()}/rest/v1/${q}`, { headers: headers() });
  if (!res.ok) {
    throw new SocialStoreError(`lectura de ${TABLE} falló: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }
  const rows = (await res.json().catch(() => [])) as SocialTokenRow[];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Guarda (upsert) el token de una (marca, proveedor). `Prefer: resolution=merge-duplicates` hace el
 * upsert contra la PK `(provider, brand_id)`. Devuelve `true` si la base lo aceptó.
 */
export async function upsertSocialToken(row: SocialTokenRow): Promise<boolean> {
  requireConfig();
  const res = await fetch(`${SB_URL()}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    throw new SocialStoreError(`upsert en ${TABLE} falló: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }
  return true;
}

/** ISO → epoch ms, o 0 si no hay fecha legible. */
export function isoToMs(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** epoch ms → ISO, o null si no es una fecha válida. */
export function msToIso(ms: number): string | null {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}
