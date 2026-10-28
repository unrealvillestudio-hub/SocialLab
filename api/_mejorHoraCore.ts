/**
 * MEJOR HORA — el núcleo puro (Sam, 2026-10-26; mejora 6, opción «a»). Sin red ni estado.
 *
 * Compara franjas horarias del día (en el huso de la marca) por la métrica de cada publicación a la MISMA edad (dato:
 * `signal_platforms.best_time_metric`, `signal_collector_config.best_time_*`). Una franja sólo cuenta con un mínimo de
 * publicaciones; con menos de dos franjas comparables NO hay mejor hora y se dice cuántas publicaciones faltan. Nunca
 * se inventa una hora: «por ahora y sin medir no hay cómo identificar las mejores horas» (Sam).
 */

export interface ConfigMejorHora { banda_horas: number; minimo_por_franja: number }
export interface PublicacionMedida { brand_id: string; platform: string; published_at: string; valor: number | null }
export interface Franja { inicio: number; fin: number; publicaciones: number; mediana: number | null; comparable: boolean }
export interface MejorHora {
  brand_id: string; platform: string; huso: string | null; metrica: string;
  franjas: Franja[];
  estado: 'comparable' | 'datos_insuficientes';
  /** La franja con la mediana más alta entre las comparables, y cuánto supera a la segunda. */
  mejor: { inicio: number; fin: number; mediana: number; ventaja_pct: number | null } | null;
  /** En palabras: por qué no hay mejor hora o qué tan sólida es. */
  motivo: string;
}

/** La hora del día (0–23) de un instante en un huso. Sin huso válido, UTC. */
export function horaEn(instante: string, huso: string | null): number | null {
  const t = Date.parse(instante);
  if (!Number.isFinite(t)) return null;
  try {
    const h = new Intl.DateTimeFormat('en-GB', { timeZone: huso || 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t));
    const n = Number(h);
    return Number.isInteger(n) && n >= 0 && n < 24 ? n : null;
  } catch {
    return new Date(t).getUTCHours();
  }
}

/** El inicio de la franja de una hora: 19 con franjas de 3 h → 18. */
export const inicioDeFranja = (hora: number, bandaHoras: number): number => Math.floor(hora / bandaHoras) * bandaHoras;

const mediana = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

/** El valor de una publicación a la edad de comparación: la primera lectura entre `edad` y `edad + tolerancia`. */
export function valorAEdad(lecturas: readonly { age_minutes: number; value: number | null }[], edad: number, tolerancia: number): number | null {
  const enRango = lecturas.filter((l) => l.age_minutes >= edad && l.age_minutes <= edad + tolerancia && l.value !== null && Number.isFinite(l.value))
    .sort((a, b) => a.age_minutes - b.age_minutes);
  return enRango.length ? Number(enRango[0].value) : null;
}

/** La mejor hora de una marca en una plataforma, o por qué todavía no la hay. */
export function mejorHora(publicaciones: readonly PublicacionMedida[], huso: string | null, metrica: string, cfg: ConfigMejorHora): MejorHora {
  const base = publicaciones[0];
  const medidas = publicaciones.filter((p) => p.valor !== null && Number.isFinite(p.valor));
  const porFranja = new Map<number, number[]>();
  for (const p of medidas) {
    const h = horaEn(p.published_at, huso);
    if (h === null) continue;
    const i = inicioDeFranja(h, cfg.banda_horas);
    porFranja.set(i, [...(porFranja.get(i) ?? []), p.valor as number]);
  }
  const franjas: Franja[] = [...porFranja].sort((a, b) => a[0] - b[0]).map(([inicio, vs]) => ({
    inicio, fin: (inicio + cfg.banda_horas) % 24, publicaciones: vs.length, mediana: mediana(vs),
    comparable: vs.length >= cfg.minimo_por_franja,
  }));
  const comparables = franjas.filter((f) => f.comparable).sort((a, b) => (b.mediana ?? 0) - (a.mediana ?? 0));
  const comun = { brand_id: base?.brand_id ?? '', platform: base?.platform ?? '', huso, metrica, franjas };

  if (comparables.length < 2) {
    const n = cfg.minimo_por_franja;
    const motivo = !medidas.length
      ? `todavía no hay publicaciones con lectura a la edad de comparación: hacen falta ${n} en al menos dos franjas`
      : comparables.length === 0
        ? `${medidas.length} publicaciones medidas, ninguna franja llega a ${n}: hacen falta ${n} en al menos dos franjas`
        : `sólo la franja de ${etiquetaFranja(comparables[0])} tiene ${n} o más; para comparar hace falta otra franja con ${n}`
          + (franjas.length > 1 ? ` (la siguiente tiene ${Math.max(...franjas.filter((f) => !f.comparable).map((f) => f.publicaciones))})` : ', y todas las publicaciones salen a esa hora');
    return { ...comun, estado: 'datos_insuficientes', mejor: null, motivo };
  }
  const [a, b] = comparables;
  const ventaja = a.mediana !== null && b.mediana ? Math.round(100 * (a.mediana - b.mediana) / b.mediana) : null;
  return {
    ...comun, estado: 'comparable',
    mejor: { inicio: a.inicio, fin: a.fin, mediana: a.mediana ?? 0, ventaja_pct: ventaja },
    motivo: `entre ${comparables.length} franjas con ${cfg.minimo_por_franja} o más publicaciones, la de ${etiquetaFranja(a)} rinde más`
      + (ventaja !== null ? ` (+${ventaja}% sobre la siguiente)` : ''),
  };
}

/** «18–21 h». */
export const etiquetaFranja = (f: { inicio: number; fin: number }): string => `${f.inicio}–${f.fin === 0 ? 24 : f.fin} h`;
