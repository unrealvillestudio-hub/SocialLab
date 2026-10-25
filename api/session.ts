/**
 * SocialLab — POST /api/session · entrada del operador al tablero (Fase 2, 2026-10-24).
 *
 * Reenvía la contraseña a `iid-inbound` (`action: 'login'`), la misma puerta del Orchestrator, y
 * devuelve su sesión tal cual: `{ session_token, sub, role, brand_scope, expires_in }`. SocialLab no
 * guarda usuarios ni contraseñas: la identidad es una sola en el ecosistema.
 *
 * Body: { password: string }
 */
import { SB_URL, SB_KEY } from './_opsShared.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SB_URL() || !SB_KEY()) {
    return res.status(503).json({ error: 'config_missing', message: 'Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el runtime' });
  }
  let body: { password?: unknown } = {};
  if (typeof req.body === 'string') { try { body = JSON.parse(req.body); } catch { /* vacío */ } }
  else if (req.body && typeof req.body === 'object') body = req.body;
  if (typeof body.password !== 'string' || !body.password) return res.status(400).json({ error: 'falta la contraseña' });

  try {
    const r = await fetch(`${SB_URL()}/functions/v1/iid-inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` },
      body: JSON.stringify({ action: 'login', password: body.password }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status === 401 || r.status === 403 ? 401 : 502).json({ error: data?.error ?? `login HTTP ${r.status}` });
    if (typeof data?.session_token !== 'string') return res.status(502).json({ error: 'login sin session_token' });
    return res.status(200).json(data);
  } catch (err) {
    console.error('[tablero] login: iid-inbound no respondió:', err instanceof Error ? err.message : err);
    return res.status(502).json({ error: 'no se pudo contactar la puerta de entrada' });
  }
}
