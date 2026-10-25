/**
 * PULSO · lo que cambia mientras el operador mira (pedido de Sam, 2026-10-25: «las principales pills
 * deberán ser realtime» y «cuando hay un nuevo comentario … abrirse un warn para que el operario lo
 * atienda»).
 *
 * Núcleo puro, sin React ni red, para poder probarlo (`tests/tablero_test.mjs`).
 *
 * Dos fuentes, cada una con su ritmo:
 *   · EN VIVO — el listado de la plataforma (MCP de Meta) trae me gusta y comentarios en la misma
 *     llamada. Se relee cada minuto con la pestaña visible.
 *   · MEDIDO — SignalLab (`content.post_metric_snapshots`) mide alcance, vistas, guardados, etc. a su
 *     ritmo: cada 15 min las primeras 6 h, luego a las 24 h, 72 h y 7 días.
 * Cuando las dos traen la misma métrica, gana la más reciente: la en vivo.
 */

export interface MetricaMedida { metric: string; value: number; fetched_at?: string }
export interface Contador { metric: string; value: number }
export type Fuente = 'vivo' | 'medido';
export interface MetricaPill { metric: string; value: number; fuente: Fuente }

/** La métrica que cuenta comentarios. Es vocabulario de la plataforma (SignalLab y Meta la llaman igual). */
export const METRICA_COMENTARIOS = 'comments';

/**
 * Une lo medido con lo leído en vivo. Lo en vivo sustituye a la misma métrica medida y se añade si
 * SignalLab todavía no la midió. El orden es el de lo medido, con lo nuevo al final.
 */
export function combinarMetricas(medidas: readonly MetricaMedida[], vivo: readonly Contador[] | undefined): MetricaPill[] {
  const enVivo = new Map((vivo ?? []).map((c) => [c.metric, c.value]));
  const out: MetricaPill[] = medidas.map((m) => enVivo.has(m.metric)
    ? { metric: m.metric, value: enVivo.get(m.metric)!, fuente: 'vivo' as const }
    : { metric: m.metric, value: Number(m.value), fuente: 'medido' as const });
  for (const [metric, value] of enVivo) {
    if (!medidas.some((m) => m.metric === metric)) out.push({ metric, value, fuente: 'vivo' });
  }
  return out;
}

export interface LecturaComentarios { platform_post_id: string; comments: number }
export interface Aumento { platform_post_id: string; antes: number; ahora: number }

/**
 * Los posts cuyo contador de comentarios SUBIÓ entre dos lecturas en vivo. La primera lectura no
 * avisa de nada: sin lectura anterior no hay «nuevo». Un post que no estaba antes tampoco avisa,
 * porque sus comentarios ya existían cuando entró en la lectura.
 */
export function aumentosDeComentarios(
  previo: ReadonlyMap<string, number> | null, actual: readonly LecturaComentarios[],
): Aumento[] {
  if (!previo) return [];
  const out: Aumento[] = [];
  for (const l of actual) {
    const antes = previo.get(l.platform_post_id);
    if (antes !== undefined && l.comments > antes) out.push({ platform_post_id: l.platform_post_id, antes, ahora: l.comments });
  }
  return out;
}
