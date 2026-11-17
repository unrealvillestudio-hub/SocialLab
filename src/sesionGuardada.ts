// La sesión del operador se guarda en el dispositivo hasta que caduca (Sam, 2026-11-17: «sí, mantén la sesión»).
//
// Por qué: con la app instalada en el teléfono, el sistema cierra y reabre la app muy seguido; con la sesión sólo en
// memoria, la operadora volvía a escribir la contraseña cada vez. Se guarda con su hora de caducidad (la que da el
// servidor en `expires_in`) y se borra al pulsar «Salir», al caducar o cuando la API responde 401.
// El riesgo, aceptado por Sam: quien tenga el teléfono desbloqueado entra sin contraseña hasta que la sesión caduca.
import type { Sesion } from './api';

export const CLAVE_SESION = 'sociallab.sesion';
/** Margen para no usar una sesión que caduca mientras se carga la pantalla. */
export const MARGEN_CADUCIDAD_MS = 60_000;

interface Almacen { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
interface Guardada { sesion: Sesion; caduca_en: number }

function almacenPorDefecto(): Almacen | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function guardarSesion(sesion: Sesion, ahora = Date.now(), almacen = almacenPorDefecto()): void {
  if (!almacen || !(sesion.expires_in > 0)) return;
  const g: Guardada = { sesion, caduca_en: ahora + sesion.expires_in * 1000 };
  try { almacen.setItem(CLAVE_SESION, JSON.stringify(g)); } catch { /* sin almacenamiento: la sesión vive en memoria */ }
}

/** La sesión guardada si sigue vigente; si caducó o está dañada, la borra y devuelve null. */
export function leerSesion(ahora = Date.now(), almacen = almacenPorDefecto()): Sesion | null {
  if (!almacen) return null;
  let g: Guardada | null = null;
  try { g = JSON.parse(almacen.getItem(CLAVE_SESION) ?? 'null'); } catch { g = null; }
  const valida = g && typeof g.sesion?.session_token === 'string' && g.sesion.session_token
    && typeof g.caduca_en === 'number' && g.caduca_en - MARGEN_CADUCIDAD_MS > ahora;
  if (!valida) { borrarSesion(almacen); return null; }
  return g!.sesion;
}

export function borrarSesion(almacen = almacenPorDefecto()): void {
  try { almacen?.removeItem(CLAVE_SESION); } catch { /* nada que borrar */ }
}
