/**
 * ASESOR · las tarjetas de acción de SignalLab para el tablero (Sam, 2026-10-25).
 *
 *   GET  ?marca=&cerradas=1   → { tarjetas, nuevas }. Por defecto sólo las abiertas (nueva · vista · seguida);
 *                               con `cerradas=1`, también las descartadas o resueltas de los últimos 7 días.
 *   POST { id, status }       → { tarjeta }. `status` ∈ vista | seguida | descartada. Queda quién y cuándo
 *                               (`status_by` = sub del operador). 409 si la tarjeta cambió entretanto.
 *
 * Autenticación y alcance: los del tablero (`exigirOperador`). Una acción `interna` sólo la ve quien tiene
 * alcance total. Las tarjetas no llevan costos ni datos internos (contrato de SignalLab, #488).
 */
import { marcasConsultadas, TODAS } from './_opsCore.js';
import { exigirOperador, sbGet, enLista, LecturaFallida, SB_URL, SB_KEY } from './_opsShared.js';
import {
  cambioDeEstado, ordenarTarjetas, visiblePara, ESTADOS_ABIERTOS, type AccionTipo, type TarjetaFila,
} from './_asesorCore.js';

const q = (req: any, k: string): string | undefined => {
  const v = req.query?.[k];
  return Array.isArray(v) ? v[0] : (v ?? undefined);
};
const COLUMNAS = 'id,rule_key,card_type,severity,brand_id,platform,scheduled_post_id,post_comment_id,action_key,objective,'
  + 'what_text,why_text,metric,value,baseline_value,baseline_level,baseline_size,status,status_by,status_at,created_at';
const MAX_TARJETAS = 500;
const DIAS_CERRADAS = 7;

async function acciones(): Promise<Map<string, AccionTipo>> {
  const filas = await sbGet<AccionTipo>('engagement_action_types?select=action_key,label,objective,via', 'intel');
  return new Map(filas.map((a) => [a.action_key, a]));
}

const filtroMarcas = (marcas: typeof TODAS | string[]) => (marcas === TODAS ? '' : `&brand_id=${enLista(marcas)}`);

async function listar(req: any, marcas: typeof TODAS | string[], alcanceTotal: boolean) {
  const abiertas = `status=${enLista(ESTADOS_ABIERTOS as string[])}`;
  const desde = new Date(Date.now() - DIAS_CERRADAS * 86_400_000).toISOString();
  const filtro = q(req, 'cerradas') === '1'
    ? `or=(${abiertas.replace('=', '.')},created_at.gte.${encodeURIComponent(desde)})` : abiertas;
  const [filas, tipos] = await Promise.all([
    sbGet<TarjetaFila>(`signal_cards?select=${COLUMNAS}&${filtro}${filtroMarcas(marcas)}&order=created_at.desc&limit=${MAX_TARJETAS + 1}`, 'intel'),
    acciones(),
  ]);
  const truncado = filas.length > MAX_TARJETAS;
  const visibles = (truncado ? filas.slice(0, MAX_TARJETAS) : filas)
    .filter((t) => visiblePara(tipos.get(t.action_key), alcanceTotal))
    .map((t) => {
      const a = tipos.get(t.action_key);
      return { ...t, accion: a ? { label: a.label, via: a.via } : { label: t.action_key, via: 'app_nativa' } };
    });
  return { truncado, nuevas: visibles.filter((t) => t.status === 'nueva').length, tarjetas: ordenarTarjetas(visibles) };
}

async function cambiar(cuerpo: any, sub: string, alcance: typeof TODAS | string[]) {
  const id = String(cuerpo?.id ?? '');
  const nuevo = String(cuerpo?.status ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400, body: { error: 'id inválido' } };
  const [t] = await sbGet<TarjetaFila>(`signal_cards?select=${COLUMNAS}&id=eq.${id}`, 'intel');
  // Fuera del alcance responde igual que inexistente: no se confirma que exista una tarjeta de otra marca.
  if (!t || (alcance !== TODAS && !alcance.includes(t.brand_id))) return { status: 404, body: { error: 'tarjeta no encontrada' } };
  const tipos = await acciones();
  if (!visiblePara(tipos.get(t.action_key), alcance === TODAS)) return { status: 404, body: { error: 'tarjeta no encontrada' } };
  const c = cambioDeEstado(t.status, nuevo);
  if ('error' in c) return { status: 422, body: { error: c.error } };
  if ('noop' in c) return { status: 200, body: { tarjeta: t } };
  // Escritura condicionada al estado leído: si otro operador la cambió entretanto, 409 y no se pisa.
  const res = await fetch(`${SB_URL()}/rest/v1/signal_cards?id=eq.${id}&status=eq.${encodeURIComponent(t.status)}`, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Profile': 'intel',
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify({ status: nuevo, status_by: sub, status_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new LecturaFallida('signal_cards (PATCH)', `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const filas = (await res.json().catch(() => [])) as TarjetaFila[];
  if (!filas.length) return { status: 409, body: { error: 'la tarjeta cambió de estado mientras tanto; vuelve a cargarla' } };
  return { status: 200, body: { tarjeta: filas[0] } };
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
      return res.status(200).json(await listar(req, c.marcas, puerta.alcance === TODAS));
    }
    const cuerpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const r = await cambiar(cuerpo, puerta.sesion.sub, puerta.alcance);
    return res.status(r.status).json(r.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'cuerpo JSON ilegible' });
    console.error(`[asesor] ${req.method} falló: ${msg}`);
    return res.status(503).json({ error: err instanceof LecturaFallida ? 'lectura_fallida' : 'error', detail: msg });
  }
}
