/**
 * SocialLab — GET /api/ops?vista=… · Tablero de operadores, sólo lectura (Fase 2, 2026-10-24).
 *
 * Vistas:
 *   catalogo    las marcas del alcance del operador, con sus plataformas leíbles en vivo
 *   publicado   lo publicado en la ventana, por las dos vías: el carril (`scheduled_posts`,
 *               status='published') y a mano (franjas `published` de los canales con
 *               `publication_path = 'manual'`, con su enlace). Conteos por marca/plataforma/formato
 *               y las métricas de SignalLab cuando existan
 *   envivo      las publicaciones recientes leídas DESDE LA PLATAFORMA (MCP de Meta), cruzadas con
 *               el registro por `platform_post_id`
 *   calendario  franjas (`intel.brand_publish_slots`) y filas de `scheduled_posts` en la ventana
 *   ahora       «happening now»: sin medir mientras SignalLab no escriba instantáneas
 *
 * Autenticación: `Authorization: Bearer <session_token de iid-inbound>`. Ver `_opsShared.ts`.
 * No escribe nada: ni en la base ni en las plataformas.
 */
import {
  ventana, contar, formatoDe, ultimasMetricas, marcasConsultadas, lectorDe, normalizarRespuesta,
  LECTORES_EN_VIVO, TODAS, publicacionesManuales, type Alcance, type Instantanea, type MetricaLeida, type PublicacionEnVivo,
  type Canal, type FranjaPublicada, type PiezaManual, type Via,
} from './_opsCore.js';
import { exigirOperador, sbGet, enLista, esTablaInexistente, mcpLeer, LecturaFallida } from './_opsShared.js';

const MAX_FILAS = 2000;
const TROZO = 100;
/** Ventana de «ahora» en minutos. Provisional hasta que exista `intel.signal_fast_window` (SignalLab, Fase 1). */
const MINUTOS_AHORA_POR_DEFECTO = 360;

const q = (req: any, k: string): string | null => {
  const v = req.query?.[k];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
};

function filtroMarcas(marcas: typeof TODAS | string[]): string {
  return marcas === TODAS ? '' : `&brand_id=${enLista(marcas)}`;
}

function trozos<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** El enlace a la plataforma que se puede construir sin leerla. Instagram necesita el `permalink` en vivo. */
const ENLACE_POR_PLATAFORMA: Readonly<Record<string, (id: string) => string>> = {
  FACEBOOK: (id) => `https://www.facebook.com/${id}`,
};

// ── catalogo ──────────────────────────────────────────────────────────────────

interface Cuenta { brand_id: string; [col: string]: unknown }

async function cuentasDe(marcas: typeof TODAS | string[]): Promise<Cuenta[]> {
  // Sólo las columnas que dicen QUÉ cuenta existe; el token de la cuenta nunca sale de la base.
  const cols = ['brand_id', ...new Set(Object.values(LECTORES_EN_VIVO).map((l) => l.columnaCuenta))].join(',');
  return sbGet<Cuenta>(`meta_accounts?select=${cols}${filtroMarcas(marcas)}`);
}

function plataformasEnVivo(c: Cuenta | undefined): string[] {
  if (!c) return [];
  return Object.entries(LECTORES_EN_VIVO).filter(([, l]) => c[l.columnaCuenta] != null && c[l.columnaCuenta] !== '').map(([p]) => p);
}

async function catalogo(alcance: Alcance) {
  const cuentas = await cuentasDe(alcance);
  const ids = alcance === TODAS ? [...new Set(cuentas.map((c) => c.brand_id))] : alcance;
  const marcas = ids.length
    ? await sbGet<{ id: string; display_name: string | null; publish_timezone: string | null }>(
      `brands?select=id,display_name,publish_timezone&id=${enLista(ids)}`)
    : [];
  const porId = new Map(marcas.map((m) => [m.id, m]));
  return {
    marcas: ids.map((id) => ({
      brand_id: id,
      nombre: porId.get(id)?.display_name ?? id,
      huso: porId.get(id)?.publish_timezone ?? null,
      plataformas_en_vivo: plataformasEnVivo(cuentas.find((c) => c.brand_id === id)),
    })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    alcance_total: alcance === TODAS,
  };
}

// ── métricas de SignalLab ─────────────────────────────────────────────────────

type EstadoMetricas = 'medidas' | 'tabla_inexistente';

async function metricasDe(ids: string[]): Promise<{ estado: EstadoMetricas; porPost: Map<string, MetricaLeida[]> }> {
  const todas: Instantanea[] = [];
  try {
    for (const t of trozos(ids, TROZO)) {
      todas.push(...await sbGet<Instantanea>(
        `post_metric_snapshots?select=scheduled_post_id,age_minutes,metric,value,fetched_at&scheduled_post_id=${enLista(t)}`, 'content'));
    }
  } catch (err) {
    if (esTablaInexistente(err)) return { estado: 'tabla_inexistente', porPost: new Map() };
    throw err;
  }
  return { estado: 'medidas', porPost: ultimasMetricas(todas) };
}

// ── publicado ─────────────────────────────────────────────────────────────────

interface Publicada {
  id: string; brand_id: string; platform: string; media_type: string | null; platform_post_id: string | null;
  published_at: string; copy_text: string | null; image_url: string | null; media_urls: string[] | null; piece_id: string | null;
}

/** Lo publicado a mano en la ventana: franjas `published` de canales manuales, con su pieza. */
async function manualesDe(v: { desde: string; hasta: string }, marcas: typeof TODAS | string[]) {
  const [canales, franjas] = await Promise.all([
    sbGet<Canal>(`brand_publish_channels?publication_path=eq.manual&select=brand_id,platform_key,publication_path${filtroMarcas(marcas)}`, 'intel'),
    sbGet<FranjaPublicada>(`brand_publish_slots?status=eq.published&published_at=gte.${encodeURIComponent(v.desde)}`
      + `&published_at=lt.${encodeURIComponent(v.hasta)}${filtroMarcas(marcas)}`
      + `&select=id,brand_id,platform_key,published_at,piece_id&order=published_at.desc&limit=${MAX_FILAS}`, 'intel'),
  ]);
  const ids = [...new Set(franjas.map((f) => f.piece_id).filter((x): x is string => !!x))];
  const piezas: PiezaManual[] = [];
  for (const t of trozos(ids, TROZO)) {
    piezas.push(...await sbGet<PiezaManual>(
      `content_pieces?id=${enLista(t)}&select=id,post_url,format,copy:assets->copy->>raw,imagen:assets->image->>url`, 'content'));
  }
  return publicacionesManuales(canales, franjas, piezas);
}

async function publicado(req: any, marcas: typeof TODAS | string[]) {
  const v = ventana(q(req, 'desde'), q(req, 'hasta'));
  const plataforma = q(req, 'plataforma');
  const formato = q(req, 'formato');
  const [filas, manuales] = await Promise.all([
    sbGet<Publicada>(
      `scheduled_posts?status=eq.published&published_at=gte.${encodeURIComponent(v.desde)}&published_at=lt.${encodeURIComponent(v.hasta)}`
      + filtroMarcas(marcas)
      + (plataforma ? `&platform=eq.${encodeURIComponent(plataforma)}` : '')
      + `&select=id,brand_id,platform,media_type,platform_post_id,published_at,copy_text,image_url,media_urls,piece_id`
      + `&order=published_at.desc&limit=${MAX_FILAS + 1}`),
    manualesDe(v, marcas),
  ]);
  const truncado = filas.length > MAX_FILAS;
  const delCarril = (truncado ? filas.slice(0, MAX_FILAS) : filas)
    .filter((f) => !formato || formatoDe(f.media_type) === formato);
  const aMano = manuales.filter((f) => (!plataforma || f.platform === plataforma) && (!formato || f.formato === formato));
  const m = await metricasDe(delCarril.map((f) => f.id));
  const publicaciones = [
    ...delCarril.map((f) => ({
      ...f,
      formato: formatoDe(f.media_type),
      via: 'carril' as Via,
      enlace: f.platform_post_id && ENLACE_POR_PLATAFORMA[f.platform] ? ENLACE_POR_PLATAFORMA[f.platform](f.platform_post_id) : null,
      metricas: m.porPost.get(f.id) ?? [],
    })),
    // Una plataforma manual no tiene lector de métricas: sus tarjetas dicen «sin lector», nunca cero.
    ...aMano.map((f) => ({ ...f, metricas: [] as MetricaLeida[] })),
  ].sort((a, b) => b.published_at.localeCompare(a.published_at));
  return {
    ventana: v,
    truncado,
    total: publicaciones.length,
    conteos: contar(publicaciones),
    metricas: m.estado,
    publicaciones,
  };
}

// ── envivo ────────────────────────────────────────────────────────────────────

async function envivo(req: any, marcas: typeof TODAS | string[]) {
  const limite = Math.min(Math.max(Number(q(req, 'limite') ?? 25) || 25, 1), 50);
  const cuentas = await cuentasDe(marcas);
  const tareas = cuentas.flatMap((c) => plataformasEnVivo(c).map((platform) => ({ brand_id: c.brand_id, platform })));
  const resultados = await Promise.all(tareas.map(async (t) => {
    try {
      const lector = lectorDe(t.platform)!;
      const crudo = await mcpLeer(lector.tool, { brand_id: t.brand_id, limit: limite });
      return { ...t, items: normalizarRespuesta(t.platform, crudo), error: null as string | null };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // Un fallo de una cuenta no tumba las demás, y tampoco se calla: va en `errores` y en el log.
      console.error(`[tablero] lectura en vivo ${t.brand_id}/${t.platform} falló: ${error}`);
      return { ...t, items: [] as PublicacionEnVivo[], error };
    }
  }));
  const items = resultados.flatMap((r) => r.items.map((i) => ({ ...i, brand_id: r.brand_id })));
  const ids = [...new Set(items.map((i) => i.platform_post_id))];
  const registro: Array<{ id: string; platform_post_id: string; media_type: string | null; piece_id: string | null }> = [];
  for (const t of trozos(ids, TROZO)) {
    registro.push(...await sbGet<typeof registro[number]>(
      `scheduled_posts?select=id,platform_post_id,media_type,piece_id&platform_post_id=${enLista(t)}`));
  }
  const porId = new Map(registro.map((r) => [r.platform_post_id, r]));
  return {
    limite,
    lecturas: resultados.map((r) => ({ brand_id: r.brand_id, platform: r.platform, publicaciones: r.items.length, error: r.error })),
    publicaciones: items
      .map((i) => {
        const r = porId.get(i.platform_post_id);
        return {
          ...i,
          formato: i.formato || (r ? formatoDe(r.media_type) : ''),
          scheduled_post_id: r?.id ?? null,
          piece_id: r?.piece_id ?? null,
          en_carril: !!r,
        };
      })
      .sort((a, b) => String(b.publicado_en ?? '').localeCompare(String(a.publicado_en ?? ''))),
  };
}

// ── calendario ────────────────────────────────────────────────────────────────

async function calendario(req: any, marcas: typeof TODAS | string[]) {
  const ahora = Date.now();
  const v = ventana(q(req, 'desde') ?? new Date(ahora - 3 * 86_400_000).toISOString(),
    q(req, 'hasta') ?? new Date(ahora + 14 * 86_400_000).toISOString(), ahora);
  const rango = (col: string) => `&${col}=gte.${encodeURIComponent(v.desde)}&${col}=lt.${encodeURIComponent(v.hasta)}`;
  const [franjas, filas] = await Promise.all([
    sbGet(`brand_publish_slots?select=id,brand_id,platform_key,slot_at,status,format,piece_id,published_at,failed_reason`
      + rango('slot_at') + filtroMarcas(marcas) + `&order=slot_at.asc&limit=${MAX_FILAS}`, 'intel'),
    sbGet(`scheduled_posts?select=id,brand_id,platform,status,media_type,scheduled_at,published_at,piece_id,platform_post_id`
      + rango('scheduled_at') + filtroMarcas(marcas) + `&order=scheduled_at.asc&limit=${MAX_FILAS}`),
  ]);
  return { ventana: v, franjas, publicaciones: filas };
}

// ── ahora ─────────────────────────────────────────────────────────────────────

async function ahoraMismo(req: any, marcas: typeof TODAS | string[]) {
  const minutos = Math.min(Math.max(Number(q(req, 'minutos') ?? MINUTOS_AHORA_POR_DEFECTO) || MINUTOS_AHORA_POR_DEFECTO, 15), 10080);
  const desde = new Date(Date.now() - minutos * 60_000).toISOString();
  const filas = await sbGet<Publicada>(
    `scheduled_posts?status=eq.published&published_at=gte.${encodeURIComponent(desde)}${filtroMarcas(marcas)}`
    + `&select=id,brand_id,platform,media_type,platform_post_id,published_at,copy_text,image_url,media_urls,piece_id&order=published_at.desc`);
  const m = await metricasDe(filas.map((f) => f.id));
  const conMedida = filas.filter((f) => (m.porPost.get(f.id) ?? []).length > 0);
  return {
    minutos,
    // «sin_medir» mientras no haya instantáneas; «sin_orden» mientras SignalLab no publique la
    // comparación justa. En ningún caso se inventa un orden ni un cero.
    estado: m.estado === 'tabla_inexistente' || conMedida.length === 0 ? 'sin_medir' : 'sin_orden',
    motivo: m.estado === 'tabla_inexistente'
      ? 'content.post_metric_snapshots todavía no existe (SignalLab, Fase 1)'
      : conMedida.length === 0
        ? 'ninguna publicación de la ventana tiene instantáneas todavía'
        : 'la comparación justa de SignalLab todavía no está disponible: se listan sin ordenar',
    publicaciones: filas.map((f) => ({ ...f, formato: formatoDe(f.media_type), metricas: m.porPost.get(f.id) ?? [] })),
  };
}

// ── handler ───────────────────────────────────────────────────────────────────

const VISTAS: Record<string, (req: any, marcas: typeof TODAS | string[]) => Promise<unknown>> = {
  publicado, envivo, calendario, ahora: ahoraMismo,
};

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const puerta = await exigirOperador(req, res);
  if (!puerta) return;
  const vista = q(req, 'vista') ?? '';
  try {
    if (vista === 'catalogo') return res.status(200).json({ sub: puerta.sesion.sub, role: puerta.sesion.role, ...await catalogo(puerta.alcance) });
    const fn = VISTAS[vista];
    if (!fn) return res.status(400).json({ error: `vista desconocida: «${vista}»`, vistas: ['catalogo', ...Object.keys(VISTAS)] });
    const c = marcasConsultadas(puerta.alcance, q(req, 'marca'));
    if ('prohibida' in c) return res.status(403).json({ error: 'forbidden: esa marca no está en tu alcance' });
    return res.status(200).json(await fn(req, c.marcas));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('VENTANA_INVALIDA')) return res.status(400).json({ error: msg });
    console.error(`[tablero] ${vista} falló: ${msg}`);
    return res.status(503).json({ error: err instanceof LecturaFallida ? 'lectura_fallida' : 'error', detail: msg });
  }
}
