/**
 * COMENTARIOS — el núcleo puro (SignalLab Fase 3, 2026-10-25). Sin red ni base.
 *
 * El colector de SignalLab (`unrlvl-iid-functions`, EF `signal-collector`) guarda los comentarios en
 * `content.post_comments`. Este módulo decide, sin efectos, qué comentario espera respuesta, a qué
 * comentario se responde y cuándo una respuesta cuenta como verificada. `api/comments.ts` hace la E/S.
 *
 * Nada aquí nombra una plataforma ni una marca: qué herramienta responde y cuál lee la respuesta
 * viene de `intel.signal_platforms` (`reply_tool`, `comment_read_tool`).
 */

export interface Comentario {
  id: number;
  platform: string;
  platform_comment_id: string;
  brand_id: string;
  platform_post_id: string;
  parent_comment_id: string | null;
  from_brand: boolean;
  commented_at: string;
}

export interface Respuesta {
  id: string;
  post_comment_id: number;
  status: 'requested' | 'sent' | 'verified' | 'failed';
  requested_at: string;
}

export type Estado = 'sin_responder' | 'fallida' | 'en_curso' | 'respondido' | 'de_la_marca';

/** El orden de la bandeja: lo que espera a alguien va primero. */
export const ORDEN_DE_ESTADO: Readonly<Record<Estado, number>> = {
  sin_responder: 0, fallida: 1, en_curso: 2, respondido: 3, de_la_marca: 4,
};

/** Minutos durante los que una respuesta pedida o enviada bloquea otra al mismo comentario. */
export const MINUTOS_EN_VUELO = 10;

/** El hilo de un comentario: el de primer nivel del que cuelga, o él mismo. */
export const hiloDe = (c: Pick<Comentario, 'parent_comment_id' | 'platform_comment_id'>): string =>
  c.parent_comment_id ?? c.platform_comment_id;

/**
 * A qué comentario se responde. Las plataformas leídas hoy anidan un solo nivel, así que la
 * respuesta va al comentario de primer nivel del hilo; la respuesta queda visible bajo el mismo hilo.
 */
export const objetivoDeRespuesta = hiloDe;

/**
 * El estado de cada comentario. Cuenta como respondido si hay una respuesta verificada desde
 * SocialLab o si la marca contestó en el mismo hilo después del comentario, desde donde sea.
 */
export function estados(comentarios: readonly Comentario[], respuestas: readonly Respuesta[]): Map<number, Estado> {
  const porComentario = new Map<number, Respuesta[]>();
  for (const r of respuestas) {
    const xs = porComentario.get(r.post_comment_id) ?? [];
    xs.push(r);
    porComentario.set(r.post_comment_id, xs);
  }
  const ultimaDeLaMarca = new Map<string, number>();
  for (const c of comentarios) {
    if (!c.from_brand) continue;
    const k = `${c.platform}|${hiloDe(c)}`;
    const t = Date.parse(c.commented_at);
    if (!Number.isNaN(t) && t > (ultimaDeLaMarca.get(k) ?? -Infinity)) ultimaDeLaMarca.set(k, t);
  }
  const out = new Map<number, Estado>();
  for (const c of comentarios) {
    if (c.from_brand) { out.set(c.id, 'de_la_marca'); continue; }
    const rs = (porComentario.get(c.id) ?? []).slice().sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at));
    const t = Date.parse(c.commented_at);
    if (rs.some((r) => r.status === 'verified') || (ultimaDeLaMarca.get(`${c.platform}|${hiloDe(c)}`) ?? -Infinity) > t) {
      out.set(c.id, 'respondido');
    } else if (rs[0] && (rs[0].status === 'requested' || rs[0].status === 'sent')) {
      out.set(c.id, 'en_curso');
    } else if (rs[0]?.status === 'failed') {
      out.set(c.id, 'fallida');
    } else {
      out.set(c.id, 'sin_responder');
    }
  }
  return out;
}

/** Ordena la bandeja: por estado y, dentro de cada estado, lo más reciente primero. */
export function ordenar<T extends { estado: Estado; commented_at: string }>(xs: readonly T[]): T[] {
  return xs.slice().sort((a, b) =>
    ORDEN_DE_ESTADO[a.estado] - ORDEN_DE_ESTADO[b.estado] || Date.parse(b.commented_at) - Date.parse(a.commented_at));
}

/** El mensaje, recortado. Lanza si está vacío: un mensaje vacío no es una respuesta. */
export function mensajeValido(m: unknown): string {
  const s = typeof m === 'string' ? m.trim() : '';
  if (!s) throw new Error('MENSAJE_VACIO: la respuesta no puede estar vacía');
  return s;
}

/** ¿Hay una respuesta pedida o enviada hace menos de `MINUTOS_EN_VUELO`? Evita el doble envío. */
export function hayEnVuelo(respuestas: readonly Respuesta[], ahora = Date.now()): boolean {
  return respuestas.some((r) => (r.status === 'requested' || r.status === 'sent')
    && ahora - Date.parse(r.requested_at) < MINUTOS_EN_VUELO * 60_000);
}

/** La respuesta está verificada si la plataforma devuelve, al leerla, el mismo id que dio al crearla. */
export function verificada(leida: unknown, idRespuesta: string | null | undefined): boolean {
  return !!idRespuesta && !!leida && typeof leida === 'object' && (leida as { id?: unknown }).id === idRespuesta;
}
