/**
 * SocialLab — GET /api/ops?vista=… · Tablero de operadores, sólo lectura (Fase 2, 2026-10-24).
 *
 * Vistas:
 *   catalogo    las marcas del alcance del operador, con sus plataformas leíbles en vivo
 *   publicado   lo publicado en la ventana, leído del LIBRO (`scheduled_posts`, status='published'),
 *               que asienta toda publicación: carril, manual y externa (#479). La vía sale del canal
 *               y el formato de la pieza. Conteos por marca/plataforma/formato y las métricas de
 *               SignalLab cuando existan
 *   envivo      las publicaciones recientes leídas DESDE LA PLATAFORMA (MCP de Meta), cruzadas con
 *               el registro por `platform_post_id`
 *   calendario  franjas (`intel.brand_publish_slots`) y filas de `scheduled_posts` en la ventana
 *   ahora       «happening now»: sin medir mientras SignalLab no escriba instantáneas
 *   estadisticas resumen por marca y plataforma: totales, medianas, formatos y top de la ventana
 *
 * Autenticación: `Authorization: Bearer <session_token de iid-inbound>`. Ver `_opsShared.ts`.
 * No escribe nada: ni en la base ni en las plataformas.
 */
import {
  ventana, contar, formatoDe, ultimasMetricas, marcasConsultadas, lectorDe, normalizarRespuesta,
  LECTORES_EN_VIVO, TODAS, viasPorCanal, viaDe, formatoDeFila, enlaceDeId, estadisticas, resumenCuenta, canalesPorMarca,
  type Alcance, type Instantanea, type MetricaLeida, type PublicacionEnVivo, type Canal, type Via, type FilaCuenta, type MetricaCatalogo,
} from './_opsCore.js';
import { exigirOperador, sbGet, enLista, esTablaInexistente, mcpLeer, LecturaFallida } from './_opsShared.js';
import { mejorHora, valorAEdad, type PublicacionMedida } from './_mejorHoraCore.js';

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

/**
 * El color de cada plataforma (`intel.signal_platforms.display_color`, Sam 2026-10-26). Antes de la migración la columna
 * no existe: el tablero las ve neutras, no deja de cargar.
 */
async function coloresDePlataforma(): Promise<{ platform: string; color: string | null }[]> {
  try {
    const filas = await sbGet<{ platform: string; display_color: string | null }>('signal_platforms?select=platform,display_color', 'intel');
    return filas.map((f) => ({ platform: f.platform, color: f.display_color ?? null }));
  } catch (err) {
    console.error(`[ops] colores de plataforma sin leer: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/**
 * La maqueta con que el tablero dibuja cada plataforma y formato (`intel.platform_previews`, Sam 2026-10-27). Antes de la
 * migración la tabla no existe: las tarjetas se ven sin maqueta, el tablero no deja de cargar.
 */
async function maquetasDePlataforma(): Promise<{ platform: string; media_format: string | null; layout: string; aspect: string }[]> {
  try {
    return await sbGet<{ platform: string; media_format: string | null; layout: string; aspect: string }>(
      'platform_previews?select=platform,media_format,layout,aspect&active=is.true', 'intel');
  } catch (err) {
    console.error(`[ops] maquetas de plataforma sin leer: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/**
 * El usuario y la foto de cada cuenta (`intel.account_profiles`, los lee SignalLab; Sam 2026-10-27). Antes de la migración
 * la tabla no existe: las maquetas se ven con la inicial, el tablero no deja de cargar.
 */
async function perfilesDeCuenta(ids: string[]): Promise<{ brand_id: string; platform: string; username: string | null; display_name: string | null; picture_url: string | null }[]> {
  if (!ids.length) return [];
  try {
    return await sbGet<{ brand_id: string; platform: string; username: string | null; display_name: string | null; picture_url: string | null }>(
      `account_profiles?select=brand_id,platform,username,display_name,picture_url&brand_id=${enLista(ids)}`, 'intel');
  } catch (err) {
    console.error(`[ops] perfiles de cuenta sin leer: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

async function catalogo(alcance: Alcance) {
  const [cuentas, plataformas, maquetas] = await Promise.all([cuentasDe(alcance), coloresDePlataforma(), maquetasDePlataforma()]);
  const ids = alcance === TODAS ? [...new Set(cuentas.map((c) => c.brand_id))] : alcance;
  const marcas = ids.length
    ? await sbGet<{ id: string; display_name: string | null; publish_timezone: string | null }>(
      `brands?select=id,display_name,publish_timezone&id=${enLista(ids)}`)
    : [];
  const porId = new Map(marcas.map((m) => [m.id, m]));
  const perfiles = await perfilesDeCuenta(ids);
  const canales = ids.length
    ? canalesPorMarca(await sbGet<Canal>(
      `brand_publish_channels?select=brand_id,platform_key,publication_path,provider:config->>provider_platform&brand_id=${enLista(ids)}`, 'intel'))
    : new Map();
  return {
    marcas: ids.map((id) => ({
      brand_id: id,
      nombre: porId.get(id)?.display_name ?? id,
      huso: porId.get(id)?.publish_timezone ?? null,
      plataformas_en_vivo: plataformasEnVivo(cuentas.find((c) => c.brand_id === id)),
      canales: canales.get(id) ?? [],
    })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    alcance_total: alcance === TODAS,
    plataformas,
    maquetas,
    perfiles,
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
  source_lab?: string | null;
}

/** Las columnas del libro que lee el tablero. */
const COLUMNAS_LIBRO = 'id,brand_id,platform,media_type,platform_post_id,published_at,copy_text,image_url,media_urls,piece_id,source_lab';
/** Las vías que tienen lector de métricas (SignalLab mide lo que está en el libro con `platform_post_id` de Meta). */
const CON_METRICAS: readonly Via[] = ['carril', 'detectada'];

/**
 * La vía y el formato de cada fila del libro. La vía sale del canal; el formato, de `media_type` en el
 * carril y de la pieza en lo manual o externo (ver `formatoDeFila`).
 */
async function clasificar<T extends Publicada>(filas: T[], marcas: typeof TODAS | string[]) {
  const canales = await sbGet<Canal>(
    `brand_publish_channels?select=brand_id,platform_key,publication_path,provider:config->>provider_platform${filtroMarcas(marcas)}`, 'intel');
  const vias = viasPorCanal(canales);
  const conVia = filas.map((f) => ({ f, via: viaDe(vias, f.brand_id, f.platform, f.source_lab) }));
  const ids = [...new Set(conVia.filter((x) => !CON_METRICAS.includes(x.via) && !x.f.media_type && x.f.piece_id).map((x) => x.f.piece_id as string))];
  const formatos = new Map<string, string | null>();
  for (const t of trozos(ids, TROZO)) {
    for (const p of await sbGet<{ id: string; format: string | null }>(`content_pieces?id=${enLista(t)}&select=id,format`, 'content')) {
      formatos.set(p.id, p.format);
    }
  }
  return conVia.map(({ f, via }) => ({
    ...f,
    via,
    formato: formatoDeFila(f.media_type, via, f.piece_id ? formatos.get(f.piece_id) : null),
    enlace: enlaceDeId(f.platform_post_id)
      ?? (f.platform_post_id && ENLACE_POR_PLATAFORMA[f.platform] ? ENLACE_POR_PLATAFORMA[f.platform](f.platform_post_id) : null),
  }));
}

async function publicado(req: any, marcas: typeof TODAS | string[]) {
  const v = ventana(q(req, 'desde'), q(req, 'hasta'));
  const plataforma = q(req, 'plataforma');
  const formato = q(req, 'formato');
  const filas = await sbGet<Publicada>(
    `scheduled_posts?status=eq.published&published_at=gte.${encodeURIComponent(v.desde)}&published_at=lt.${encodeURIComponent(v.hasta)}`
    + filtroMarcas(marcas)
    + (plataforma ? `&platform=eq.${encodeURIComponent(plataforma)}` : '')
    + `&select=${COLUMNAS_LIBRO}`
    + `&order=published_at.desc&limit=${MAX_FILAS + 1}`);
  const truncado = filas.length > MAX_FILAS;
  const clasificadas = (await clasificar(truncado ? filas.slice(0, MAX_FILAS) : filas, marcas))
    .filter((f) => !formato || f.formato === formato);
  // Sólo el carril tiene lector de métricas hoy; una fila manual o externa dice «sin lector», nunca cero.
  const m = await metricasDe(clasificadas.filter((f) => CON_METRICAS.includes(f.via)).map((f) => f.id));
  const publicaciones = clasificadas.map((f) => ({ ...f, metricas: m.porPost.get(f.id) ?? ([] as MetricaLeida[]) }));
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
  // `cuentas=marca:PLATAFORMA,...` limita la lectura a esas cuentas (el tablero lee cada minuto sólo las
  // activas). Sólo restringe: una cuenta fuera del alcance del operador nunca entra por aquí.
  const pedidas = q(req, 'cuentas');
  const soloEstas = pedidas ? new Set(pedidas.split(',').map((x) => x.trim()).filter(Boolean)) : null;
  const tareas = cuentas.flatMap((c) => plataformasEnVivo(c).map((platform) => ({ brand_id: c.brand_id, platform })))
    .filter((t) => !soloEstas || soloEstas.has(`${t.brand_id}:${t.platform}`));
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
    + `&select=${COLUMNAS_LIBRO}&order=published_at.desc`);
  const clasificadas = await clasificar(filas, marcas);
  const m = await metricasDe(clasificadas.filter((f) => CON_METRICAS.includes(f.via)).map((f) => f.id));
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
    publicaciones: clasificadas.map((f) => ({ ...f, metricas: m.porPost.get(f.id) ?? [] })),
  };
}

// ── handler ───────────────────────────────────────────────────────────────────

// ── estadisticas ──────────────────────────────────────────────────────────────

/**
 * Resumen por marca y plataforma de lo publicado en la ventana (30 días por defecto), con la última
 * lectura de SignalLab de cada post. Lo que es de la CUENTA (seguidores, alcance diario, visitas al
 * perfil) todavía no lo escribe nadie: va en `cuenta` como «pendiente», nunca como cero.
 */
async function estadisticasVista(req: any, marcas: typeof TODAS | string[]) {
  const ahora = Date.now();
  const v = ventana(q(req, 'desde') ?? new Date(ahora - 30 * 86_400_000).toISOString(), q(req, 'hasta'), ahora);
  const filas = await sbGet<Publicada>(
    `scheduled_posts?status=eq.published&published_at=gte.${encodeURIComponent(v.desde)}&published_at=lt.${encodeURIComponent(v.hasta)}`
    + filtroMarcas(marcas) + `&select=${COLUMNAS_LIBRO}&order=published_at.desc&limit=${MAX_FILAS + 1}`);
  const truncado = filas.length > MAX_FILAS;
  const clasificadas = (await clasificar(truncado ? filas.slice(0, MAX_FILAS) : filas, marcas))
    .filter((f) => CON_METRICAS.includes(f.via));
  const m = await metricasDe(clasificadas.map((f) => f.id));
  const conMetricas = clasificadas.map((f) => ({ ...f, metricas: m.porPost.get(f.id) ?? ([] as MetricaLeida[]) }));
  const porId = new Map(conMetricas.map((f) => [f.id, f]));
  return {
    ventana: v,
    truncado,
    metricas: m.estado,
    estadisticas: estadisticas(conMetricas).map((e) => ({ ...e, top: e.top.map((id) => porId.get(id)!) })),
    cuenta: await cuentaDe(v, marcas, ahora),
  };
}

/** Tope de filas de cuenta por consulta: 90 días de desgloses de varias cuentas caben de sobra. */
const MAX_FILAS_CUENTA = 20_000;
const PAGINA_CUENTA = 1000;

/** El catálogo de métricas de cuenta. `aggregation` (sum | last, #499) puede no existir todavía: sin ella, todo suma. */
async function catalogoDeCuenta(): Promise<MetricaCatalogo[]> {
  const base = 'signal_account_metrics?active=is.true&select=platform,metric,breakdown,read_as,min_followers,notes';
  try { return await sbGet<MetricaCatalogo>(`${base},aggregation`, 'intel'); }
  catch (err) {
    console.error(`[ops] catálogo de cuenta sin aggregation: ${err instanceof Error ? err.message : err}`);
    return sbGet<MetricaCatalogo>(base, 'intel');
  }
}

/**
 * Lo que SignalLab mide de la CUENTA en la ventana (`content.account_metric_daily`), con su catálogo y
 * los días de relectura de su configuración. Si la tabla no existe, `pendiente`; nunca ceros.
 */
async function cuentaDe(v: { desde: string; hasta: string }, marcas: typeof TODAS | string[], ahora: number) {
  const desde = v.desde.slice(0, 10), hasta = v.hasta.slice(0, 10);
  try {
    const [catalogoCuenta, config] = await Promise.all([
      catalogoDeCuenta(),
      sbGet<{ value: unknown }>('signal_collector_config?key=eq.account_series_days&select=value', 'intel'),
    ]);
    const relectura = Number(config[0]?.value);
    if (!Number.isFinite(relectura)) throw new LecturaFallida('signal_collector_config', 'falta account_series_days');
    const filas: FilaCuenta[] = [];
    for (let offset = 0; offset < MAX_FILAS_CUENTA; offset += PAGINA_CUENTA) {
      const pagina = await sbGet<FilaCuenta>(
        `account_metric_daily?metric_date=gte.${desde}&metric_date=lte.${hasta}${filtroMarcas(marcas)}`
        + '&select=brand_id,platform,metric_date,metric,breakdown,breakdown_value,value,unavailable_reason'
        + `&order=brand_id,platform,metric,breakdown,breakdown_value,metric_date&limit=${PAGINA_CUENTA}&offset=${offset}`, 'content');
      filas.push(...pagina);
      if (pagina.length < PAGINA_CUENTA) break;
    }
    return {
      estado: 'medida' as const,
      relectura_dias: relectura,
      truncado: filas.length >= MAX_FILAS_CUENTA,
      cuentas: resumenCuenta(filas, catalogoCuenta, relectura, new Date(ahora).toISOString().slice(0, 10)),
    };
  } catch (err) {
    if (esTablaInexistente(err)) return { estado: 'pendiente' as const, motivo: 'SignalLab todavía no guarda las métricas diarias de la cuenta' };
    throw err;
  }
}

// ── mejor hora (Sam, 2026-10-26; mejora 6) ─────────────────────────────────────

/**
 * La mejor hora de cada marca y plataforma, o por qué todavía no la hay (`_mejorHoraCore`). Cómo se compara es dato
 * (unrlvl-iid-functions, migración 20261027000000): la métrica de cada plataforma (`best_time_metric`), la edad y su
 * tolerancia, el ancho de la franja, el mínimo por franja y la ventana. Sin la migración, `disponible: false`.
 */
async function mejorHoraVista(_req: any, marcas: typeof TODAS | string[]) {
  let plataformas: { platform: string; best_time_metric: string | null }[];
  let conf: { key: string; value: unknown }[];
  try {
    [plataformas, conf] = await Promise.all([
      sbGet<{ platform: string; best_time_metric: string | null }>('signal_platforms?select=platform,best_time_metric&active=is.true&best_time_metric=not.is.null', 'intel'),
      sbGet<{ key: string; value: unknown }>('signal_collector_config?select=key,value&key=like.best_time_*', 'intel'),
    ]);
  } catch (err) {
    if (err instanceof LecturaFallida && /best_time_metric|42703|PGRST/.test(err.message)) {
      return { disponible: false, motivo: 'la comparación por franjas todavía no está configurada: falta aplicar su migración', cuentas: [] };
    }
    throw err;
  }
  const c = new Map(conf.map((k) => [k.key, Number(k.value)]));
  const edad = c.get('best_time_age_minutes'), tol = c.get('best_time_age_tolerance_minutes'), banda = c.get('best_time_band_hours');
  const minimo = c.get('best_time_min_posts_per_band'), dias = c.get('best_time_window_days');
  if (![edad, tol, banda, minimo, dias].every((x) => Number.isFinite(x) && (x as number) > 0) || !plataformas.length) {
    return { disponible: false, motivo: 'la comparación por franjas todavía no está configurada: falta aplicar su migración', cuentas: [] };
  }
  const metricaDe = new Map(plataformas.map((p) => [p.platform, p.best_time_metric as string]));
  const desde = new Date(Date.now() - (dias as number) * 86_400_000).toISOString();
  const posts = await sbGet<{ id: string; brand_id: string; platform: string; published_at: string }>(
    `scheduled_posts?select=id,brand_id,platform,published_at&status=eq.published&platform_post_id=not.is.null`
    + `&platform=${enLista([...metricaDe.keys()])}&published_at=gte.${encodeURIComponent(desde)}${filtroMarcas(marcas)}&order=published_at.desc&limit=${MAX_FILAS}`);
  const lecturas = new Map<string, { age_minutes: number; value: number | null }[]>();
  for (const ids of trozos(posts.map((p) => p.id), TROZO)) {
    const filas = await sbGet<{ scheduled_post_id: string; metric: string; age_minutes: number; value: number | null }>(
      `post_metric_snapshots?select=scheduled_post_id,metric,age_minutes,value&scheduled_post_id=${enLista(ids)}`
      + `&metric=${enLista([...new Set(metricaDe.values())])}&age_minutes=gte.${edad}&age_minutes=lte.${(edad as number) + (tol as number)}`, 'content');
    const plataformaDe = new Map(posts.map((p) => [p.id, p.platform]));
    for (const f of filas) {
      if (metricaDe.get(plataformaDe.get(f.scheduled_post_id) ?? '') !== f.metric) continue;
      lecturas.set(f.scheduled_post_id, [...(lecturas.get(f.scheduled_post_id) ?? []), { age_minutes: f.age_minutes, value: f.value === null ? null : Number(f.value) }]);
    }
  }
  const ids = [...new Set(posts.map((p) => p.brand_id))];
  const husos = ids.length
    ? new Map((await sbGet<{ id: string; publish_timezone: string | null }>(`brands?select=id,publish_timezone&id=${enLista(ids)}`)).map((b) => [b.id, b.publish_timezone]))
    : new Map<string, string | null>();
  const grupos = new Map<string, PublicacionMedida[]>();
  for (const p of posts) {
    const k = `${p.brand_id}|${p.platform}`;
    grupos.set(k, [...(grupos.get(k) ?? []), {
      brand_id: p.brand_id, platform: p.platform, published_at: p.published_at,
      valor: valorAEdad(lecturas.get(p.id) ?? [], edad as number, tol as number),
    }]);
  }
  return {
    disponible: true, motivo: null,
    config: { edad_minutos: edad, banda_horas: banda, minimo_por_franja: minimo, ventana_dias: dias },
    cuentas: [...grupos.values()].map((ps) => mejorHora(ps, husos.get(ps[0].brand_id) ?? null, metricaDe.get(ps[0].platform)!,
      { banda_horas: banda as number, minimo_por_franja: minimo as number })),
  };
}

const VISTAS: Record<string, (req: any, marcas: typeof TODAS | string[]) => Promise<unknown>> = {
  publicado, envivo, calendario, ahora: ahoraMismo, estadisticas: estadisticasVista, mejorhora: mejorHoraVista,
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
