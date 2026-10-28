/**
 * SocialLab — GET /api/linkedin-oauth   (ESQUELETO)
 *
 * El OAuth de LinkedIn (3-legged) en un endpoint que es también la REDIRECT URI, igual que
 * `tiktok-oauth.ts`. Es ESQUELETO a propósito: conecta la cuenta y guarda el token (lo que NO
 * depende de la entidad legal), pero el posteo a la Página de empresa está BLOQUEADO hasta tener
 * la Community Management API (ver `_linkedin.ts`). El token guardado queda listo para ese día.
 *
 *   INICIO   GET /api/linkedin-oauth?brand_id=<marca>   → redirige al authorize de LinkedIn.
 *   CALLBACK GET /api/linkedin-oauth?code=...&state=...  → verifica el state, intercambia y guarda.
 *
 * Scopes del esqueleto: `openid profile` (identidad básica), NO los de posteo de Página. La
 * REDIRECT URI que Sam registra en el portal de LinkedIn es la URL de este endpoint y debe coincidir
 * con `LINKEDIN_REDIRECT_URI`.
 *
 * Env vars: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI,
 *           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { randomBytes } from 'node:crypto';
import { signState, verifyState } from './_oauthState.js';
import {
  LINKEDIN_TOKEN_URL, LINKEDIN_PROVIDER, LINKEDIN_SCOPES_SKELETON,
  buildAuthorizeUrl, parseLinkedInTokenResponse,
} from './_linkedin.js';
import { upsertSocialToken, msToIso, type SocialTokenRow } from './_socialTokens.js';

declare const process: { env: Record<string, string | undefined> };

const CLIENT_ID     = () => process.env.LINKEDIN_CLIENT_ID ?? '';
const CLIENT_SECRET = () => process.env.LINKEDIN_CLIENT_SECRET ?? '';
const REDIRECT_URI  = () => process.env.LINKEDIN_REDIRECT_URI ?? '';

function pageHtml(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>`
    + `<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5">`
    + `<h1>${title}</h1>${body}</body>`;
}

function getQuery(req: any): Record<string, string> {
  if (req.query && typeof req.query === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) out[k] = Array.isArray(v) ? String(v[0]) : String(v ?? '');
    return out;
  }
  try {
    const u = new URL(req.url, 'http://localhost');
    return Object.fromEntries(u.searchParams.entries());
  } catch {
    return {};
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!CLIENT_ID() || !CLIENT_SECRET() || !REDIRECT_URI()) {
    return res.status(503).send(pageHtml('LinkedIn OAuth no configurado',
      '<p>Faltan <code>LINKEDIN_CLIENT_ID</code>, <code>LINKEDIN_CLIENT_SECRET</code> o '
      + '<code>LINKEDIN_REDIRECT_URI</code> en el runtime. Los carga Sam.</p>'
      + '<p><strong>Nota:</strong> el posteo a la Página sigue bloqueado por la Community Management API '
      + '(entidad legal). Esto conecta la cuenta; no habilita publicar.</p>'));
  }

  const q = getQuery(req);

  // ── CALLBACK ──────────────────────────────────────────────────────────────
  if (q.code || q.error) {
    if (q.error) {
      return res.status(400).send(pageHtml('LinkedIn rechazó la autorización',
        `<p><code>${q.error}</code>: ${q.error_description ?? ''}</p>`));
    }
    const payload = verifyState(q.state ?? '', CLIENT_SECRET());
    if (!payload) {
      return res.status(400).send(pageHtml('State inválido',
        '<p>El <code>state</code> no cuadra con su firma. Se rechaza por CSRF.</p>'));
    }
    try {
      const res2 = await fetch(LINKEDIN_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: q.code,
          redirect_uri: REDIRECT_URI(),
          client_id: CLIENT_ID(),
          client_secret: CLIENT_SECRET(),
        }).toString(),
      });
      const parsed = parseLinkedInTokenResponse(await res2.json().catch(() => ({})), Date.now());
      if (!parsed.ok) {
        return res.status(502).send(pageHtml('Falló el intercambio del code', `<p>${parsed.error}</p>`));
      }
      const row: SocialTokenRow = {
        provider: LINKEDIN_PROVIDER,
        brand_id: payload.brand_id,
        open_id: null,
        access_token: parsed.record.access_token,
        refresh_token: parsed.record.refresh_token,
        scope: parsed.record.scope || null,
        access_token_expires_at: msToIso(parsed.record.access_token_expires_at),
        refresh_token_expires_at: msToIso(parsed.record.refresh_token_expires_at),
      };
      await upsertSocialToken(row);
      return res.status(200).send(pageHtml('LinkedIn conectado (sólo identidad)',
        `<p>La cuenta de LinkedIn quedó conectada para la marca <code>${payload.brand_id}</code>.</p>`
        + `<p>scope: <code>${parsed.record.scope || '—'}</code></p>`
        + '<p><strong>El posteo a la Página sigue BLOQUEADO</strong> hasta la Community Management API '
        + '(entidad legal). El token queda guardado para cuando el bloqueo se levante.</p>'));
    } catch (err) {
      return res.status(502).send(pageHtml('Falló el intercambio del code',
        `<p>${err instanceof Error ? err.message : String(err)}</p>`));
    }
  }

  // ── INICIO ────────────────────────────────────────────────────────────────
  const brandId = (q.brand_id ?? '').trim();
  if (!brandId) {
    return res.status(400).send(pageHtml('Falta brand_id',
      '<p>Inicia el flujo con <code>?brand_id=&lt;marca&gt;</code>.</p>'));
  }
  const state = signState({ brand_id: brandId, nonce: randomBytes(16).toString('hex') }, CLIENT_SECRET());
  const url = buildAuthorizeUrl({
    clientId: CLIENT_ID(),
    redirectUri: REDIRECT_URI(),
    scope: LINKEDIN_SCOPES_SKELETON,
    state,
  });
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
}
