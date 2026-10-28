/**
 * SocialLab — api/_linkedin.ts
 *
 * ESQUELETO DE LINKEDIN. Sólo lo que NO depende de la entidad legal: el authorize URL, la lectura
 * del token y el almacenamiento (vía `_socialTokens`, igual que TikTok). Puro y testable; la red
 * del OAuth vive en `linkedin-oauth.ts`.
 *
 * ⛔ BLOQUEADO — EL POSTEO A LA PÁGINA DE EMPRESA NO SE IMPLEMENTA Y NO SE SIMULA.
 * Publicar en la Página de empresa exige la **Community Management API**, y esa API exige una
 * **entidad legal registrada** + aprobación de LinkedIn. Estado medido/reportado el 2026-10-28:
 * la app `266664900` existe y está verificada con la Página; el formulario de la CMA quedó
 * desbloqueado pero **NO enviado**, y LinkedIn **no es flexible** con el requisito de entidad legal.
 * Hasta que eso exista, `publishLinkedInBlocked` falla DICIENDO el motivo — nunca devuelve un
 * «publicado» falso. El OAuth y el almacén quedan listos para cuando el bloqueo se levante.
 */

export const LINKEDIN_AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_TOKEN_URL     = 'https://www.linkedin.com/oauth/v2/accessToken';

/** Nombre del proveedor en la tabla de tokens. Eje (superficie), no marca. */
export const LINKEDIN_PROVIDER = 'linkedin';

/**
 * Scopes del esqueleto: SÓLO identidad básica (`openid`, `profile`), que NO dependen de la CMA ni de
 * la entidad legal. NO se piden `w_organization_social` ni `r_organization_social` — ésos son el
 * posteo a la Página, que está bloqueado. Lista explícita de superficies de permiso, no de marcas.
 */
export const LINKEDIN_SCOPES_SKELETON = ['openid', 'profile'] as const;

/** Motivo único del bloqueo, para que el fallo diga lo mismo en todos lados. */
export const LINKEDIN_POSTING_BLOCKED =
  'LinkedIn: el posteo a la Página de empresa está BLOQUEADO — requiere la Community Management API, '
  + 'que exige entidad legal registrada + aprobación de LinkedIn (app 266664900 verificada con la Página; '
  + 'formulario CMA desbloqueado pero NO enviado, medido 2026-10-28). No se simula.';

/** Un token normalizado tal como se guarda. Épocas en ms. LinkedIn puede no devolver refresh_token. */
export interface LinkedInTokenRecord {
  access_token: string;
  refresh_token: string;
  scope: string;
  access_token_expires_at: number;   // epoch ms
  refresh_token_expires_at: number;  // epoch ms (0 si no vino)
}

/** El authorize URL de LinkedIn. `scope` va separado por espacios (lo exige LinkedIn). */
export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  scope: readonly string[];
  state: string;
}): string {
  const u = new URL(LINKEDIN_AUTHORIZE_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('state', params.state);
  u.searchParams.set('scope', params.scope.join(' '));
  return u.toString();
}

export type LinkedInTokenParse =
  | { ok: true; record: LinkedInTokenRecord }
  | { ok: false; error: string };

/** Normaliza la respuesta de `/accessToken`. `now` entra por parámetro (sin reloj aquí). */
export function parseLinkedInTokenResponse(json: unknown, now: number): LinkedInTokenParse {
  const j = (json ?? {}) as Record<string, unknown>;
  if (typeof j.error === 'string' && j.error) {
    return { ok: false, error: `${j.error}: ${String(j.error_description ?? '')}`.trim() };
  }
  const access = j.access_token;
  if (typeof access !== 'string' || !access) return { ok: false, error: 'respuesta sin access_token' };
  const expiresIn = Number(j.expires_in ?? 0);
  const refreshExpiresIn = Number(j.refresh_token_expires_in ?? 0);
  return {
    ok: true,
    record: {
      access_token: access,
      refresh_token: typeof j.refresh_token === 'string' ? j.refresh_token : '',
      scope: typeof j.scope === 'string' ? j.scope : '',
      access_token_expires_at: now + Math.max(0, expiresIn) * 1000,
      refresh_token_expires_at: refreshExpiresIn > 0 ? now + refreshExpiresIn * 1000 : 0,
    },
  };
}

/** El resultado de publicar, en la misma forma que usa `publish.ts`. */
export interface LinkedInPublishResult {
  post_id: string;
  platform: string;
  brand_id: string;
  status: 'failed';
  error: string;
}

/**
 * EL POSTEO BLOQUEADO. No llama a LinkedIn: devuelve un fallo con el motivo escrito. Está aquí para
 * que el dispatcher de `publish.ts` tenga una rama TikTok-simétrica y para que, el día que se
 * levante el bloqueo, haya un único sitio que cambiar. Nunca finge un posteo.
 */
export function publishLinkedInBlocked(post: { id: string; brand_id: string; platform: string }): LinkedInPublishResult {
  return {
    post_id: post.id,
    platform: post.platform.toUpperCase(),
    brand_id: post.brand_id,
    status: 'failed',
    error: LINKEDIN_POSTING_BLOCKED,
  };
}
