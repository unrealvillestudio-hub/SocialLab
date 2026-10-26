/**
 * ASESOR · núcleo puro de las tarjetas de acción (SignalLab, `intel.signal_cards`; Sam, 2026-10-25).
 *
 * El tablero no inventa consejos: los escribe SignalLab con su cifra y su base. Aquí sólo se decide qué
 * tarjeta ve cada operador, en qué orden, y qué cambio de estado puede pedir. Sin red ni base, para probarlo.
 *
 * Vocabulario de SignalLab (contrato de #488): `severity` info | oportunidad | atencion; `status` nueva |
 * vista | seguida | descartada | resuelta; `via` de la acción api | app_nativa | interna.
 */

export type Severidad = 'atencion' | 'oportunidad' | 'info';
export type EstadoTarjeta = 'nueva' | 'vista' | 'seguida' | 'descartada' | 'resuelta';
export type ViaAccion = 'api' | 'app_nativa' | 'interna';

export interface TarjetaFila {
  id: string; rule_key: string; card_type: string; severity: string; brand_id: string; platform: string;
  scheduled_post_id: string | null; post_comment_id: number | null; action_key: string;
  objective: string; what_text: string; why_text: string;
  metric: string | null; value: number | string | null; baseline_value: number | string | null;
  baseline_level: string | null; baseline_size: number | null;
  status: string; status_by: string | null; status_at: string | null; created_at: string;
}
export interface AccionTipo { action_key: string; label: string; objective: string; via: string }

/** Lo que sigue pidiendo atención del operador. */
export const ESTADOS_ABIERTOS: readonly EstadoTarjeta[] = ['nueva', 'vista', 'seguida'];
/** Lo que el operador puede pedir. `resuelta` la pone el sistema, nunca una persona. */
export const ESTADOS_DEL_OPERADOR: readonly EstadoTarjeta[] = ['vista', 'seguida', 'descartada'];

const PESO_SEVERIDAD: Record<string, number> = { atencion: 0, oportunidad: 1, info: 2 };
export const pesoSeveridad = (s: string) => PESO_SEVERIDAD[s] ?? 3;

/**
 * Una acción `interna` (aprendizaje del estudio) no la ve el operador del cliente: sólo quien tiene
 * alcance total. Una acción sin tipo en el catálogo se muestra (no se esconde lo que no se entiende).
 */
export function visiblePara(accion: AccionTipo | undefined, alcanceTotal: boolean): boolean {
  return alcanceTotal || accion?.via !== 'interna';
}

/** Nuevas primero; luego por gravedad (atención → oportunidad → info); luego la más reciente. */
export function ordenarTarjetas<T extends Pick<TarjetaFila, 'status' | 'severity' | 'created_at'>>(ts: readonly T[]): T[] {
  return [...ts].sort((a, b) =>
    Number(b.status === 'nueva') - Number(a.status === 'nueva')
    || pesoSeveridad(a.severity) - pesoSeveridad(b.severity)
    || b.created_at.localeCompare(a.created_at));
}

/**
 * ¿Puede el operador pasar la tarjeta de `actual` a `nuevo`? Devuelve el motivo si no, o `null` si sí.
 * `vista` sobre algo ya visto o seguido no es error: es un no-op (abrir dos veces no cambia nada).
 */
export function cambioDeEstado(actual: string, nuevo: string): { error: string } | { noop: true } | { ok: true } {
  if (!ESTADOS_DEL_OPERADOR.includes(nuevo as EstadoTarjeta)) return { error: `estado no permitido para un operador: «${nuevo}»` };
  if (actual === 'resuelta' || actual === 'descartada') return { error: `la tarjeta ya está ${actual}` };
  if (nuevo === 'vista') return actual === 'nueva' ? { ok: true } : { noop: true };
  if (actual === nuevo) return { noop: true };
  return { ok: true };
}

// ── Recomendaciones del asesor (`intel.social_advisor_recommendations`, SignalLab 2026-10-25) ───────
//
// El asesor escribe una recomendación para el operador y, a veces, un borrador. Estados: nueva |
// seguida | descartada | caducada (esta última la pone el sistema). Cuando el operador envía el borrador,
// se guarda en `sent_text` lo que de verdad salió: así se mide cuánto se edita.

export type EstadoRecomendacion = 'nueva' | 'seguida' | 'descartada' | 'caducada';

/**
 * Las que se muestran. SignalLab pidió (2026-10-25) mostrar sólo las `nueva` mientras no entre su
 * arreglo iid #493 (respuestas de la marca guardadas como ajenas en Instagram; enlaces inventados).
 */
export const RECOMENDACIONES_VISIBLES: readonly EstadoRecomendacion[] = ['nueva'];

/** ¿Puede el operador pasar la recomendación de `actual` a `nuevo`? */
export function cambioDeRecomendacion(actual: string, nuevo: string): { error: string } | { noop: true } | { ok: true } {
  if (nuevo !== 'seguida' && nuevo !== 'descartada') return { error: `estado no permitido para un operador: «${nuevo}»` };
  if (actual === 'caducada' || actual === 'descartada') return { error: `la recomendación ya está ${actual}` };
  if (actual === nuevo) return { noop: true };
  return { ok: true };
}

// ── Consejo pedido sobre un comentario (Sam, 2026-10-26) ────────────────────────────────────────
//
// El operador pide consejo sobre UN comentario: SocialLab inserta un despertar `a_pedido` con su
// `post_comment_id` (`intel.social_advisor_wakes`, unrlvl-iid-functions #496). Al tablero sólo le llega
// cómo va cada pedido, sin nada del despertar (costo, tokens, modelo, error interno).

export type EstadoPedido = 'pendiente' | 'sin_consejo' | 'con_consejo';
export interface PedidoFila { post_comment_id: number | string | null; status: string; recommendations: number | null; created_at: string }

/**
 * El último pedido de cada comentario: `pendiente` mientras el asesor no lo atendió; `con_consejo` si dejó
 * recomendación; `sin_consejo` si terminó sin ella (omitido, fallido o sin recomendación válida).
 */
export function estadoDePedidos(filas: readonly PedidoFila[]): Array<{ post_comment_id: number; estado: EstadoPedido }> {
  const ultimo = new Map<number, PedidoFila>();
  for (const f of filas) {
    const id = Number(f.post_comment_id);
    if (f.post_comment_id == null || !Number.isFinite(id)) continue;
    const prev = ultimo.get(id);
    if (!prev || f.created_at > prev.created_at) ultimo.set(id, f);
  }
  return [...ultimo.entries()].map(([id, f]) => ({
    post_comment_id: id,
    estado: f.status === 'pendiente' ? 'pendiente' : f.status === 'hecho' && Number(f.recommendations) > 0 ? 'con_consejo' : 'sin_consejo',
  }));
}

/** El id de un comentario recibido en el cuerpo: entero positivo, o null si no vino. `undefined` = inválido. */
export function idDeComentario(v: unknown): number | null | undefined {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** Lo que se envió de verdad: recortado y con tope, o null si no se envió nada. */
export function textoEnviado(v: unknown, max = 5000): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}
