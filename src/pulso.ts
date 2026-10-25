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

// ── Lectura en vivo por actividad de la cuenta (Sam, 2026-10-25) ───────────────
//
// Cada lectura en vivo cuesta una llamada por CUENTA (marca × plataforma), no por post: el listado trae
// los últimos posts de la cuenta de una vez. Por eso el ahorro está en leer menos seguido las cuentas
// quietas: las que publicaron en los últimos `DIAS_ACTIVA` días se leen cada minuto; todas las demás,
// en la lectura completa de cada `LECTURA_COMPLETA_CADA` minutos.

/** Una cuenta con publicaciones en estos días se lee cada minuto. */
export const DIAS_ACTIVA = 7;
/** Cada cuántos ciclos de un minuto se leen TODAS las cuentas. */
export const LECTURA_COMPLETA_CADA = 10;

export interface LecturaCuenta { brand_id: string; platform: string; publicaciones: number; error: string | null }
export interface PostEnVivo { brand_id: string; platform: string; publicado_en: string | null }
export interface Lectura<P extends PostEnVivo> { limite: number; lecturas: LecturaCuenta[]; publicaciones: P[] }

export const claveCuenta = (brand_id: string, platform: string) => `${brand_id}:${platform}`;

/** Las cuentas con al menos una publicación dentro de los últimos `dias`, según la última lectura. */
export function cuentasActivas(publicaciones: readonly PostEnVivo[], ahora: number, dias = DIAS_ACTIVA): string[] {
  const desde = ahora - dias * 86_400_000;
  return [...new Set(publicaciones
    .filter((p) => p.publicado_en && Date.parse(p.publicado_en) >= desde)
    .map((p) => claveCuenta(p.brand_id, p.platform)))].sort();
}

/**
 * Qué leer en este ciclo: `'todas'` en el primero y cada `cada` ciclos; si no, sólo las activas.
 * Sin cuentas activas, `[]`: ese ciclo no llama a la plataforma.
 */
export function planDeLectura(ciclo: number, hayLecturaPrevia: boolean, activas: readonly string[], cada = LECTURA_COMPLETA_CADA): 'todas' | string[] {
  if (!hayLecturaPrevia || ciclo % cada === 0) return 'todas';
  return [...activas];
}

/** Sustituye en la lectura previa sólo las cuentas que se acaban de leer; las demás se conservan. */
export function fusionarLectura<P extends PostEnVivo>(previa: Lectura<P> | null, nueva: Lectura<P>): Lectura<P> {
  if (!previa) return nueva;
  const leidas = new Set(nueva.lecturas.map((l) => claveCuenta(l.brand_id, l.platform)));
  const fuera = (x: { brand_id: string; platform: string }) => !leidas.has(claveCuenta(x.brand_id, x.platform));
  return {
    limite: nueva.limite,
    lecturas: [...previa.lecturas.filter(fuera), ...nueva.lecturas],
    publicaciones: [...previa.publicaciones.filter(fuera), ...nueva.publicaciones]
      .sort((a, b) => String(b.publicado_en ?? '').localeCompare(String(a.publicado_en ?? ''))),
  };
}
