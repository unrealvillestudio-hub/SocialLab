/**
 * SocialLab — POST /api/session · entrada del operador al tablero (Fase 2, 2026-10-24).
 *
 * Reenvía la contraseña a `iid-inbound` (`action: 'login'`), la misma puerta del Orchestrator, y
 * devuelve su sesión tal cual: `{ session_token, sub, role, brand_scope, expires_in }`. SocialLab no
 * guarda usuarios ni contraseñas: la identidad es una sola en el ecosistema.
 *
 * Body: { password: string }
 *
 * AGENTES DEL ECOSISTEMA (Ayra, Sam 2026-10-27). Una agente no es una operadora de NSCF y no está en `iid-inbound`.
 * Entra con `{ agente, credencial }`: la credencial se verifica en la base (`intel.agente_verificar_credencial`, que
 * compara contra el hash; el texto vive en Vault) y SocialLab le firma la sesión con el rol `agente` y el mismo secreto
 * que verifica `exigirOperador`. Su alcance se decide en cada petición (`intel.agente_alcance`), no en el token.
 */
import { SB_URL, SB_KEY, SESSION_SECRET } from './_opsShared.js';
import { firmarSesion, HORAS_SESION_AGENTE, ROL_AGENTE } from './_opsCore.js';

/** La agente de una credencial válida, o null. Sin detalles hacia fuera: credencial inválida es sólo 401. */
async function agenteVerificada(agente: string, credencial: string): Promise<string | null> {
  const r = await fetch(`${SB_URL()}/rest/v1/rpc/agente_verificar_credencial`, {
    method: 'POST',
    headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Type': 'application/json', 'Content-Profile': 'intel' },
    body: JSON.stringify({ p_agent_id: agente, p_credencial: credencial }),
  });
  if (!r.ok) throw new Error(`agente_verificar_credencial HTTP ${r.status}`);
  const filas = await r.json().catch(() => []);
  const f = Array.isArray(filas) ? filas[0] : null;
  return f?.agent_id && f?.role === ROL_AGENTE ? String(f.agent_id) : null;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SB_URL() || !SB_KEY()) {
    return res.status(503).json({ error: 'config_missing', message: 'Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el runtime' });
  }
  let body: { password?: unknown; agente?: unknown; credencial?: unknown } = {};
  if (typeof req.body === 'string') { try { body = JSON.parse(req.body); } catch { /* vacío */ } }
  else if (req.body && typeof req.body === 'object') body = req.body;

  if (body.agente !== undefined) {
    if (typeof body.agente !== 'string' || typeof body.credencial !== 'string' || !body.agente || !body.credencial) {
      return res.status(400).json({ error: 'faltan agente y credencial' });
    }
    if (!SESSION_SECRET()) return res.status(503).json({ error: 'config_missing', message: 'Falta OPERATOR_SESSION_JWT_SECRET en el runtime' });
    try {
      const agente = await agenteVerificada(body.agente, body.credencial);
      if (!agente) return res.status(401).json({ error: 'credenciales inválidas' });
      const sesion = { sub: agente, role: ROL_AGENTE, brand_scope: ['*'] };
      return res.status(200).json({ session_token: firmarSesion(sesion, SESSION_SECRET()), ...sesion, expires_in: HORAS_SESION_AGENTE * 3600 });
    } catch (err) {
      console.error('[tablero] login de agente:', err instanceof Error ? err.message : err);
      return res.status(502).json({ error: 'no se pudo verificar la credencial de la agente' });
    }
  }

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
