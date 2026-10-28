/**
 * SocialLab — api/_oauthState.ts
 *
 * EL `state` FIRMADO DEL OAUTH, GENÉRICO Y PURO. Lleva la marca del flujo y un nonce, firmado con
 * HMAC de un secreto del backend. Así el callback verifica que el `state` salió de aquí sin un
 * almacén de sesión: si la firma no cuadra, se rechaza por CSRF.
 *
 * Es genérico a propósito —lo usan TikTok y LinkedIn— porque un mismo mecanismo copiado en dos
 * sitios diverge (`CC_PROTOCOL.md` §6, `MULTIBRAND_RULE.md` §7.0). El secreto entra por parámetro;
 * cada proveedor pasa el suyo (su client_secret). Sin red, sin reloj: se prueba tal cual.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** El payload que viaja firmado dentro del `state`: a qué marca pertenece este flujo. */
export interface StatePayload {
  brand_id: string;
  nonce: string;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/** Firma `{brand_id, nonce}` y devuelve el `state`: `<payload>.<hmac>`. */
export function signState(payload: StatePayload, secret: string): string {
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const mac = b64urlEncode(createHmac('sha256', secret).update(body).digest());
  return `${body}.${mac}`;
}

/**
 * Verifica el `state` del callback y devuelve su payload, o `null` si la firma no cuadra o el
 * formato no es el esperado. Comparación en tiempo constante — una verificación que se corta en la
 * primera diferencia filtra la firma byte a byte.
 */
export function verifyState(state: string, secret: string): StatePayload | null {
  if (typeof state !== 'string' || !state.includes('.')) return null;
  const [body, mac] = state.split('.', 2);
  if (!body || !mac) return null;
  const esperado = b64urlEncode(createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(mac);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(body).toString('utf8')) as Record<string, unknown>;
    if (typeof parsed.brand_id === 'string' && typeof parsed.nonce === 'string' && parsed.brand_id) {
      return { brand_id: parsed.brand_id, nonce: parsed.nonce };
    }
    return null;
  } catch {
    return null;
  }
}
