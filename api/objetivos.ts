/**
 * OBJETIVOS SEMANALES · el banner de Hoy (Sam, 2026-10-27: «banner lo decido yo según sugerencia del asesor»).
 *
 *   GET  ?marca=                         → { disponible, semanas: [{ brand_id, semana, objetivos, revision }], pedidos }.
 *                                          `objetivos`: los de la semana en curso de la marca (en su huso) que siguen en
 *                                          juego —activos y propuestas—; `revision`: los de la semana anterior, cerrados
 *                                          con su resultado, qué faltó y cómo corregirlo. Lo lee de `intel.v_growth_goals`,
 *                                          que mide lo que lleva cada uno con la misma función que lo cierra.
 *   POST { id, accion, objective?, target_value? } → `aprobar` (propuesta → activa, quizá editada), `descartar`
 *                                          (propuesta o activa → descartada) o `editar` (frase o meta). Queda quién y
 *                                          cuándo. 409 si cambió entretanto.
 *   POST { tipo: 'pedir', marca }        → pide al asesor una propuesta nueva para la semana (despertar `a_pedido` +
 *                                          `semana`). Las propuestas sin decidir de la semana quedan reemplazadas.
 *
 * Antes de la migración de SignalLab (unrlvl-iid-functions, objetivos semanales) la vista no existe: el GET responde
 * `disponible: false` con el motivo y el tablero sigue.
 *
 * Autenticación y alcance: los del tablero (`exigirOperador`). Sin costos ni datos del despertar.
 */
import { marcasConsultadas, TODAS } from './_opsCore.js';
import { exigirOperador, sbGet, enLista, esTablaInexistente, LecturaFallida, SB_URL, SB_KEY } from './_opsShared.js';
import { edicion, semanasPorMarca, transicion, type ObjetivoFila } from './_objetivosCore.js';

const q = (req: any, k: string): string | undefined => {
  const v = req.query?.[k];
  return Array.isArray(v) ? v[0] : (v ?? undefined);
};
const COLUMNAS = 'id,brand_id,week_start,objective,platform,metric,measure,baseline_value,target_value,rationale,status,'
  + 'decided_by,decided_at,outcome,achieved_value,review_missing,review_correction,current_value,progress,created_at';
const filtroMarcas = (marcas: typeof TODAS | string[]) => (marcas === TODAS ? '' : `&brand_id=${enLista(marcas)}`);
const numero = (x: unknown): number | null => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x));
const aFila = (f: any): ObjetivoFila => ({ ...f, baseline_value: numero(f.baseline_value), target_value: numero(f.target_value),
  achieved_value: numero(f.achieved_value), current_value: numero(f.current_value), progress: numero(f.progress) });

async function listar(marcas: typeof TODAS | string[]) {
  const desde = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10);
  let filas: ObjetivoFila[];
  try {
    filas = (await sbGet<any>(`v_growth_goals?select=${COLUMNAS}&week_start=gte.${desde}${filtroMarcas(marcas)}&order=created_at.asc&limit=500`, 'intel')).map(aFila);
  } catch (e) {
    if (esTablaInexistente(e)) {
      return { disponible: false, motivo: 'los objetivos semanales todavía no están disponibles: falta aplicar su migración en SignalLab', semanas: [], pedidos: [] };
    }
    throw e;
  }
  // Las marcas: las del alcance, o las que tiene el asesor activas si el alcance es total.
  const ids = marcas === TODAS
    ? (await sbGet<{ brand_id: string }>('social_advisor_brands?select=brand_id&active=is.true', 'intel')).map((m) => m.brand_id)
    : marcas;
  const [husos, pendientes] = ids.length ? await Promise.all([
    sbGet<{ id: string; publish_timezone: string | null }>(`brands?select=id,publish_timezone&id=${enLista(ids)}`),
    sbGet<{ brand_id: string }>(`social_advisor_wakes?select=brand_id&status=eq.pendiente&reasons=cs.{semana}&brand_id=${enLista(ids)}`, 'intel'),
  ]) : [[], []];
  return {
    disponible: true, motivo: null,
    semanas: semanasPorMarca(filas, ids, new Map(husos.map((b) => [b.id, b.publish_timezone]))),
    /** Marcas con una propuesta en camino: el asesor la escribe en unos minutos. */
    pedidos: [...new Set(pendientes.map((p) => p.brand_id))],
  };
}

/** PATCH condicionado al estado leído: si otro operador lo cambió entretanto, devuelve [] (→ 409). */
async function patchCondicionado(id: string, actual: string, cambios: Record<string, unknown>): Promise<any[]> {
  const res = await fetch(`${SB_URL()}/rest/v1/growth_goals?id=eq.${id}&status=eq.${encodeURIComponent(actual)}`, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Profile': 'intel',
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify(cambios),
  });
  if (!res.ok) throw new LecturaFallida('growth_goals (PATCH)', `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return (await res.json().catch(() => [])) as any[];
}

async function decidir(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  const id = String(cuerpo?.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400, body: { error: 'id inválido' } };
  const [o] = await sbGet<any>(`growth_goals?select=id,brand_id,status,metric,measure,baseline_value&id=eq.${id}`, 'intel');
  // Fuera del alcance responde igual que inexistente.
  if (!o || (alcance !== TODAS && !alcance.includes(o.brand_id))) return { status: 404, body: { error: 'objetivo no encontrado' } };
  const t = transicion(o.status, String(cuerpo?.accion ?? ''));
  if ('error' in t) return { status: 422, body: { error: t.error } };
  const e = cuerpo?.accion === 'descartar' ? { cambios: {} } : edicion({ ...o, baseline_value: numero(o.baseline_value) }, cuerpo ?? {});
  if ('error' in e) return { status: 422, body: { error: e.error } };
  const ahora = new Date().toISOString();
  const filas = await patchCondicionado(id, o.status, {
    ...e.cambios, status: t.nuevo, updated_at: ahora,
    ...(t.nuevo !== o.status ? { decided_by: sub, decided_at: ahora } : {}),
  });
  if (!filas.length) return { status: 409, body: { error: 'el objetivo cambió mientras tanto; vuelve a cargarlo' } };
  return { status: 200, body: { objetivo: filas[0] } };
}

async function pedir(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  const marca = String(cuerpo?.marca ?? '').trim();
  if (!marca) return { status: 400, body: { error: 'falta la marca' } };
  if (alcance !== TODAS && !alcance.includes(marca)) return { status: 403, body: { error: 'forbidden: esa marca no está en tu alcance' } };
  const res = await fetch(`${SB_URL()}/rest/v1/social_advisor_wakes`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Profile': 'intel',
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ brand_id: marca, reasons: ['a_pedido', 'semana'], requested_by: sub, status: 'pendiente' }),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    // 23505 = «un pendiente por marca»: ya hay un despertar en cola; la propuesta llega con el siguiente.
    if (res.status === 409 || detalle.includes('23505')) {
      return { status: 409, body: { error: 'el asesor ya tiene un pedido en cola para esta marca: inténtalo en unos minutos' } };
    }
    throw new LecturaFallida('social_advisor_wakes (POST)', `HTTP ${res.status} ${detalle.slice(0, 300)}`);
  }
  return { status: 202, body: { ok: true } };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const puerta = await exigirOperador(req, res);
  if (!puerta) return;
  try {
    if (req.method === 'GET') {
      const c = marcasConsultadas(puerta.alcance, q(req, 'marca'));
      if ('prohibida' in c) return res.status(403).json({ error: 'forbidden: esa marca no está en tu alcance' });
      return res.status(200).json(await listar(c.marcas));
    }
    const cuerpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const r = cuerpo?.tipo === 'pedir' ? await pedir(cuerpo, puerta.sesion.sub, puerta.alcance)
      : await decidir(cuerpo, puerta.sesion.sub, puerta.alcance);
    return res.status(r.status).json(r.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'cuerpo JSON ilegible' });
    console.error(`[objetivos] ${req.method} falló: ${msg}`);
    return res.status(503).json({ error: err instanceof LecturaFallida ? 'lectura_fallida' : 'error', detail: msg });
  }
}
