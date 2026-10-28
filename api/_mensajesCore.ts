/**
 * MENSAJES DIRECTOS — el núcleo puro de la bandeja «Mensajes» (Sam, 2026-10-26; mejora 5). Sin red ni estado.
 *
 * Una conversación espera respuesta cuando el último mensaje de la persona no tiene, después, uno de la marca: ni
 * escrito en la app de la plataforma (lo trae el colector) ni enviado desde SocialLab. La plataforma sólo deja
 * responder dentro de una ventana tras el último mensaje de la persona: es dato (`dm_reply_window_minutes`), no de una
 * marca, y aquí no se nombra ninguna plataforma.
 */

/** Minutos que una respuesta pedida bloquea otra: el mismo margen que en comentarios (un test lo comprueba). */
export const MINUTOS_EN_VUELO = 10;

export interface MensajeDM {
  id: number; thread_id: number; from_brand: boolean; author_name: string | null; author_platform_id: string | null;
  text: string | null; sent_at: string;
}
export interface RespuestaDM {
  id: string; thread_id: number; status: 'requested' | 'sent' | 'verified' | 'failed'; message: string;
  requested_by: string; requested_at: string; sent_at: string | null; platform_message_id: string | null; error: string | null;
}
export type EstadoHilo = 'sin_responder' | 'fallida' | 'en_curso' | 'respondido' | 'allegado';

export const ORDEN_DE_ESTADO_HILO: Readonly<Record<EstadoHilo, number>> = {
  sin_responder: 0, fallida: 1, en_curso: 2, respondido: 3, allegado: 4,
};
export const ESTADOS_HILO_PENDIENTES: readonly EstadoHilo[] = ['sin_responder', 'fallida'];

const ms = (s: string | null | undefined): number => Date.parse(String(s ?? ''));

/** El último mensaje de la persona (no de la marca), en ms; null si no escribió o la fecha es ilegible. */
export function ultimoDeLaPersona(mensajes: readonly MensajeDM[]): number | null {
  let u: number | null = null;
  for (const m of mensajes) {
    if (m.from_brand) continue;
    const t = ms(m.sent_at);
    if (Number.isFinite(t) && (u === null || t > u)) u = t;
  }
  return u;
}

/** Lo que la persona escribió desde la última vez que habló la marca: lo que hay que contestar. */
export function sinContestar(mensajes: readonly MensajeDM[]): MensajeDM[] {
  const orden = [...mensajes].sort((a, b) => ms(a.sent_at) - ms(b.sent_at));
  const out: MensajeDM[] = [];
  for (const m of orden) { if (m.from_brand) out.length = 0; else out.push(m); }
  return out;
}

/**
 * El estado de una conversación. Allegado manda (no espera respuesta). Respondido si después del último mensaje de la
 * persona hay uno de la marca o una respuesta de SocialLab que salió. Si no: en curso mientras haya una pedida hace
 * menos de `MINUTOS_EN_VUELO`; fallida si la última respuesta posterior falló; si no, sin responder.
 */
export function estadoDeHilo(mensajes: readonly MensajeDM[], respuestas: readonly RespuestaDM[], allegado: boolean,
  ahora = Date.now()): EstadoHilo {
  if (allegado) return 'allegado';
  const tp = ultimoDeLaPersona(mensajes);
  if (tp === null) return 'respondido';
  if (mensajes.some((m) => m.from_brand && ms(m.sent_at) > tp)) return 'respondido';
  const posteriores = respuestas.filter((r) => ms(r.requested_at) >= tp)
    .sort((a, b) => ms(b.requested_at) - ms(a.requested_at));
  if (posteriores.some((r) => r.status === 'sent' || r.status === 'verified')) return 'respondido';
  if (posteriores.some((r) => r.status === 'requested' && ahora - ms(r.requested_at) < MINUTOS_EN_VUELO * 60_000)) return 'en_curso';
  if (posteriores[0]?.status === 'failed') return 'fallida';
  return 'sin_responder';
}

/** ¿Se puede responder ahora? Sólo dentro de la ventana de la plataforma tras el último mensaje de la persona. */
export function ventanaDeRespuesta(mensajes: readonly MensajeDM[], ventanaMin: number | null, ahora = Date.now()):
  { puede: boolean; hasta: string | null; motivo: string | null } {
  if (!ventanaMin || ventanaMin <= 0) return { puede: false, hasta: null, motivo: 'la plataforma no tiene respuesta configurada' };
  const tp = ultimoDeLaPersona(mensajes);
  if (tp === null) return { puede: false, hasta: null, motivo: 'la persona todavía no ha escrito' };
  const hasta = tp + ventanaMin * 60_000;
  return ahora <= hasta
    ? { puede: true, hasta: new Date(hasta).toISOString(), motivo: null }
    : { puede: false, hasta: new Date(hasta).toISOString(),
        motivo: `pasaron ${Math.round(ventanaMin / 60)} h desde su último mensaje: la plataforma ya no deja responder desde aquí` };
}

/** Ordena la bandeja: por estado; dentro, por intención (sin intención al final) y lo más reciente primero. */
export function ordenarHilos<T extends { estado: EstadoHilo; ultimo_at: string | null; intencion?: { priority: number } | null }>(xs: readonly T[]): T[] {
  const p = (x: T) => x.intencion?.priority ?? Number.POSITIVE_INFINITY;
  return xs.slice().sort((a, b) =>
    ORDEN_DE_ESTADO_HILO[a.estado] - ORDEN_DE_ESTADO_HILO[b.estado]
    || (p(a) === p(b) ? 0 : p(a) < p(b) ? -1 : 1)
    || (ms(b.ultimo_at) || 0) - (ms(a.ultimo_at) || 0));
}
