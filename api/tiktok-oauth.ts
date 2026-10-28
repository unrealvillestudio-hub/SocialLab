/**
 * SocialLab — GET /api/tiktok-oauth
 *
 * EL OAUTH DE TIKTOK (Login Kit v2, 3-legged) en un solo endpoint, que es también la REDIRECT URI:
 *
 *   1) INICIO   GET /api/tiktok-oauth?brand_id=<marca>
 *               → redirige a TikTok (authorize) con el `state` firmado que lleva la marca.
 *   2) CALLBACK GET /api/tiktok-oauth?code=...&state=...&scopes=...
 *               → verifica el `state`, intercambia el `code` por tokens y los guarda por marca.
 *
 * La REDIRECT URI que Sam registra en el portal de TikTok (Login Kit → Redirect URI) es la URL de
 * ESTE endpoint, y debe coincidir EXACTAMENTE con `TIKTOK_REDIRECT_URI` del runtime. Se reporta al
 * final para que Sam la registre.
 *
 * El `state` va firmado con HMAC del client_secret (`_tiktok.signState`), así el callback se verifica
 * sin almacén de sesión. Los secretos de app (client_key/secret) viven en env/Vault y los carga Sam;
 * los tokens de usuario se guardan en `social_oauth_tokens` por (proveedor, marca).
 *
 * Env vars: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI,
 *           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { randomBytes } from 'node:crypto';
import { signState, verifyState } from './_oauthState.js';
import { buildAuthorizeUrl, TIKTOK_SCOPES_INBOX } from './_tiktok.js';
import { exchangeCode, storeToken } from './_tiktokApi.js';

declare const process: { env: Record<string, string | undefined> };

const CLIENT_KEY    = () => process.env.TIKTOK_CLIENT_KEY ?? '';
const CLIENT_SECRET = () => process.env.TIKTOK_CLIENT_SECRET ?? '';
const REDIRECT_URI  = () => process.env.TIKTOK_REDIRECT_URI ?? '';

function page(title: string, body: string): string {
  // Página mínima de resultado. Sin estilos de marca: la ve quien hace el OAuth, no el público.
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

  if (!CLIENT_KEY() || !CLIENT_SECRET() || !REDIRECT_URI()) {
    return res.status(503).send(page('TikTok OAuth no configurado',
      '<p>Faltan <code>TIKTOK_CLIENT_KEY</code>, <code>TIKTOK_CLIENT_SECRET</code> o '
      + '<code>TIKTOK_REDIRECT_URI</code> en el runtime. Los carga Sam.</p>'));
  }

  const q = getQuery(req);

  // ── CALLBACK ──────────────────────────────────────────────────────────────
  if (q.code || q.error) {
    if (q.error) {
      return res.status(400).send(page('TikTok rechazó la autorización',
        `<p><code>${q.error}</code>: ${q.error_description ?? ''}</p>`));
    }
    const payload = verifyState(q.state ?? '', CLIENT_SECRET());
    if (!payload) {
      return res.status(400).send(page('State inválido',
        '<p>El <code>state</code> no cuadra con su firma. El callback no se originó en este endpoint; '
        + 'se rechaza por CSRF.</p>'));
    }
    try {
      const rec = await exchangeCode(q.code);
      await storeToken(payload.brand_id, rec);
      return res.status(200).send(page('TikTok conectado',
        `<p>La cuenta de TikTok quedó conectada para la marca <code>${payload.brand_id}</code>.</p>`
        + `<p>open_id: <code>${rec.open_id || '—'}</code> · scope: <code>${rec.scope || '—'}</code></p>`
        + '<p>El carril ya puede enviar borradores al inbox por <code>video.upload</code>. Puedes cerrar esta pestaña.</p>'));
    } catch (err) {
      return res.status(502).send(page('Falló el intercambio del code',
        `<p>${err instanceof Error ? err.message : String(err)}</p>`));
    }
  }

  // ── INICIO ────────────────────────────────────────────────────────────────
  const brandId = (q.brand_id ?? '').trim();
  if (!brandId) {
    return res.status(400).send(page('Falta brand_id',
      '<p>Inicia el flujo con <code>?brand_id=&lt;marca&gt;</code>: la cuenta de TikTok se conecta a esa marca.</p>'));
  }
  const state = signState({ brand_id: brandId, nonce: randomBytes(16).toString('hex') }, CLIENT_SECRET());
  const url = buildAuthorizeUrl({
    clientKey: CLIENT_KEY(),
    redirectUri: REDIRECT_URI(),
    scope: TIKTOK_SCOPES_INBOX,
    state,
  });
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
}
