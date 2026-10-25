/**
 * ASESOR en el cliente · dónde va cada tarjeta (pura, sin React; probada en `tests/asesor_test.mjs`).
 *
 * Una tarjeta viaja con su publicación: la de un post, en ese post; la de un comentario, en el post del
 * comentario; la que no es de ninguno de los dos (p. ej. «faltan N seguidores»), en la tarjeta de su cuenta.
 */

export interface TarjetaMin {
  id: string; brand_id: string; platform: string; severity: string; status: string;
  scheduled_post_id: string | null; post_comment_id: number | null;
}

export const claveDeCuenta = (brand_id: string, platform: string) => `${brand_id}|${platform}`;

const PESO: Record<string, number> = { atencion: 0, oportunidad: 1, info: 2 };

/** La severidad más alta de un grupo: la que pinta la pill. */
export function severidadMayor(ts: readonly { severity: string }[]): string | null {
  return ts.reduce<string | null>((m, t) => (m === null || (PESO[t.severity] ?? 3) < (PESO[m] ?? 3) ? t.severity : m), null);
}

/** Agrupa las tarjetas por publicación y por cuenta. `postDeComentario` resuelve el post de un comentario. */
export function agruparTarjetas<T extends TarjetaMin>(
  ts: readonly T[], postDeComentario: (id: number) => string | null | undefined,
): { porPost: Map<string, T[]>; porCuenta: Map<string, T[]> } {
  const porPost = new Map<string, T[]>();
  const porCuenta = new Map<string, T[]>();
  for (const t of ts) {
    const post = t.scheduled_post_id ?? (t.post_comment_id != null ? postDeComentario(t.post_comment_id) ?? null : null);
    if (post) porPost.set(post, [...(porPost.get(post) ?? []), t]);
    else {
      const k = claveDeCuenta(t.brand_id, t.platform);
      porCuenta.set(k, [...(porCuenta.get(k) ?? []), t]);
    }
  }
  return { porPost, porCuenta };
}
