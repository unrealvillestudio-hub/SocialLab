/**
 * OBJETIVOS SEMANALES — el núcleo puro (Sam, 2026-10-27: «banner lo decido yo según sugerencia del asesor»). Sin red ni
 * estado.
 *
 * El asesor (SignalLab, `social-advisor`) propone objetivos de crecimiento para la semana de cada marca; el operador los
 * aprueba —tal cual o editados— o los descarta. Al empezar la semana siguiente SignalLab los cierra con lo logrado, el
 * resultado y la revisión (qué faltó y cómo corregirlo). Aquí sólo se decide qué cambio de estado vale y qué edición es
 * legítima; lo logrado y el avance los mide SQL (`intel.v_growth_goals`), no este archivo.
 */

export type EstadoObjetivo = 'propuesta' | 'activa' | 'descartada' | 'cerrada';
export type AccionObjetivo = 'aprobar' | 'descartar' | 'editar';
export interface ObjetivoFila {
  id: string; brand_id: string; week_start: string; objective: string; platform: string | null; metric: string | null;
  measure: 'nivel' | 'suma' | null; baseline_value: number | null; target_value: number | null; rationale: string | null;
  status: EstadoObjetivo; decided_by: string | null; decided_at: string | null; outcome: string | null;
  achieved_value: number | null; review_missing: string | null; review_correction: string | null;
  current_value: number | null; progress: number | null; created_at: string;
}

/** El estado al que lleva una acción, o por qué no vale. Editar no cambia el estado. */
export function transicion(actual: EstadoObjetivo, accion: string): { nuevo: EstadoObjetivo } | { error: string } {
  if (accion === 'aprobar') return actual === 'propuesta' ? { nuevo: 'activa' } : { error: `sólo se aprueba una propuesta (está ${actual})` };
  if (accion === 'descartar') {
    return actual === 'propuesta' || actual === 'activa' ? { nuevo: 'descartada' } : { error: `ya está ${actual}` };
  }
  if (accion === 'editar') {
    return actual === 'propuesta' || actual === 'activa' ? { nuevo: actual } : { error: `un objetivo ${actual} ya no se edita` };
  }
  return { error: `acción desconocida: «${accion}»` };
}

/** Lo que el operador cambia al aprobar o editar: la frase (1–200) y, si el objetivo se mide, la meta. Una meta tiene
 *  que mejorar el punto de partida (nivel) o ser positiva (suma); sin métrica no hay meta que poner. */
export function edicion(o: Pick<ObjetivoFila, 'metric' | 'measure' | 'baseline_value'>, cuerpo: { objective?: unknown; target_value?: unknown }):
  { cambios: { objective?: string; target_value?: number } } | { error: string } {
  const cambios: { objective?: string; target_value?: number } = {};
  if (cuerpo.objective !== undefined) {
    const t = typeof cuerpo.objective === 'string' ? cuerpo.objective.trim() : '';
    if (!t || t.length > 200) return { error: 'el objetivo tiene que tener entre 1 y 200 caracteres' };
    cambios.objective = t;
  }
  if (cuerpo.target_value !== undefined && cuerpo.target_value !== null && cuerpo.target_value !== '') {
    if (!o.metric) return { error: 'este objetivo no se mide solo: no lleva meta numérica' };
    const n = Number(cuerpo.target_value);
    if (!Number.isFinite(n)) return { error: 'la meta tiene que ser un número' };
    if (o.measure === 'nivel' && o.baseline_value !== null && n <= Number(o.baseline_value)) {
      return { error: `la meta tiene que superar el punto de partida (${o.baseline_value})` };
    }
    if (n <= 0) return { error: 'la meta tiene que ser mayor que cero' };
    cambios.target_value = n;
  }
  return { cambios };
}

/** El lunes (AAAA-MM-DD) de la semana de un instante, en el huso de la marca. La misma regla que SignalLab. */
export function lunesLocal(ms: number, huso: string | null): string {
  let y: number, m: number, d: number;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: huso || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    [y, m, d] = [Number(p.year), Number(p.month), Number(p.day)];
  } catch {
    const f = new Date(ms); [y, m, d] = [f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()];
  }
  const dia = new Date(Date.UTC(y, m - 1, d));
  const isodow = dia.getUTCDay() === 0 ? 7 : dia.getUTCDay();
  return new Date(dia.getTime() - (isodow - 1) * 86_400_000).toISOString().slice(0, 10);
}

const restarDias = (iso: string, dias: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

export interface SemanaDeMarca {
  brand_id: string; semana: string;
  /** Los objetivos de esta semana que siguen en juego: los activos primero, luego las propuestas. */
  objetivos: ObjetivoFila[];
  /** La revisión de la semana anterior: lo que se cerró, con su resultado. */
  revision: ObjetivoFila[];
}

/** Agrupa por marca: la semana en curso (en su huso) y la revisión de la anterior. Lo descartado no se muestra. */
export function semanasPorMarca(filas: readonly ObjetivoFila[], marcas: readonly string[], husos: ReadonlyMap<string, string | null>,
  ahora = Date.now()): SemanaDeMarca[] {
  const orden: Record<string, number> = { activa: 0, propuesta: 1 };
  return marcas.map((b) => {
    const semana = lunesLocal(ahora, husos.get(b) ?? null);
    const deLaMarca = filas.filter((f) => f.brand_id === b);
    return {
      brand_id: b, semana,
      objetivos: deLaMarca.filter((f) => f.week_start === semana && (f.status === 'activa' || f.status === 'propuesta'))
        .sort((a, z) => orden[a.status] - orden[z.status] || a.created_at.localeCompare(z.created_at)),
      revision: deLaMarca.filter((f) => f.week_start === restarDias(semana, 7) && f.status === 'cerrada'),
    };
  });
}
