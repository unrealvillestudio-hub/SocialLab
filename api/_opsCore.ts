/**
 * TABLERO DE OPERADORES — núcleo puro (Fase 2, 2026-10-24).
 *
 * Todo lo que decide el tablero sin red ni base: la sesión, el alcance del operador, la ventana de
 * fechas, el formato, los conteos y cómo se lee cada plataforma. Se prueba en aislamiento
 * (`tests/tablero_test.mjs`); la E/S vive en `_opsShared.ts`.
 *
 * MULTIMARCA. Aquí no hay ninguna marca. Los ejes son:
 *   · el operador y su alcance — dato en `intel.operator_review_scope`, con la vista `social_ops`;
 *   · la plataforma — `LECTORES_EN_VIVO` enumera PLATAFORMAS, nunca marcas, y una plataforma sin
 *     lector se declara «sin lector en vivo» en vez de degradar en silencio;
 *   · el formato — sale de `media_type`, sin catálogo cerrado.
 *
 * IDENTIDAD. El operador entra con el mismo JWT que emite `iid-inbound` para el Orchestrator
 * (HS256, `{sub, role, brand_scope, exp}`). La verificación es la misma que la de
 * `Orchestrator/api/_calibrationShared.ts` (`verifyToken`).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Sesión ────────────────────────────────────────────────────────────────────

export interface Sesion { sub: string; role: string; brand_scope: string[] }

function b64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** El JWT de sesión verificado, o null. `ahora` en segundos (se inyecta para probar la caducidad). */
export function verificarSesion(token: unknown, secreto: string, ahora = Math.floor(Date.now() / 1000)): Sesion | null {
  if (!token || typeof token !== 'string' || !secreto) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [h, p, firma] = partes;
  try {
    const esperada = createHmac('sha256', secreto).update(`${h}.${p}`).digest();
    const recibida = b64url(firma);
    if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
    const carga = JSON.parse(b64url(p).toString('utf8')) as Record<string, unknown>;
    if (!carga?.sub || !carga?.role) return null;
    if (typeof carga.exp === 'number' && carga.exp < ahora) return null;
    return {
      sub: String(carga.sub),
      role: String(carga.role),
      brand_scope: Array.isArray(carga.brand_scope) ? carga.brand_scope.map(String) : [],
    };
  } catch {
    return null;
  }
}

// ── Alcance ───────────────────────────────────────────────────────────────────

/** La vista del tablero en `intel.operator_review_scope.views`. Vocabulario del sistema, no de una marca. */
export const VISTA_TABLERO = 'social_ops';
/** Los roles que ven todas las marcas. Mismo criterio que `ALLOWED_ROLES` del Orchestrator. */
export const ROLES_TOTALES: readonly string[] = ['admin'];
export const TODAS = '*' as const;
export type Alcance = typeof TODAS | string[];

/** Una fila de `intel.operator_review_scope`. `views` null = todas las vistas. */
export interface Concesion { brand_id: string; views?: readonly string[] | null }

/**
 * Las marcas que la sesión puede ver en el tablero, o null si ninguna (→ 403).
 * `concesiones` null = no se pudieron leer: fail-closed, un permiso que no se leyó no se presume.
 */
export function alcanceDe(sesion: Sesion, concesiones: readonly Concesion[] | null): Alcance | null {
  if (ROLES_TOTALES.includes(sesion.role)) return TODAS;
  if (!concesiones) return null;
  const techoTotal = sesion.brand_scope.includes(TODAS);
  const marcas = concesiones
    .filter((c) => c.views == null || c.views.includes(VISTA_TABLERO))
    .map((c) => String(c.brand_id ?? '').trim())
    .filter((b) => b && (techoTotal || sesion.brand_scope.includes(b)));
  const unicas = [...new Set(marcas)];
  return unicas.length ? unicas : null;
}

export function enAlcance(alcance: Alcance, brandId: string | null | undefined): boolean {
  if (alcance === TODAS) return true;
  return !!brandId && alcance.includes(brandId);
}

/**
 * Las marcas que se consultan: la pedida (si está en el alcance) o todas las del alcance.
 * Devuelve `{ prohibida: true }` si se pide una marca fuera del alcance: no se responde vacío,
 * se responde 403, para que «no puedes verla» no se lea como «no publicó nada».
 */
export function marcasConsultadas(alcance: Alcance, pedida: string | null | undefined):
  { marcas: typeof TODAS | string[] } | { prohibida: true } {
  const p = (pedida ?? '').trim();
  if (p) return enAlcance(alcance, p) ? { marcas: [p] } : { prohibida: true };
  return { marcas: alcance };
}

// ── Ventana de fechas ─────────────────────────────────────────────────────────

export const DIAS_POR_DEFECTO = 7;
export const DIAS_MAXIMOS = 366;
const DIA_MS = 86_400_000;

/** `[desde, hasta)` en ISO. Por defecto, los últimos 7 días. Lanza si la ventana no es válida. */
export function ventana(desde: string | null | undefined, hasta: string | null | undefined, ahora = Date.now()):
  { desde: string; hasta: string } {
  const h = hasta ? Date.parse(hasta) : ahora;
  const d = desde ? Date.parse(desde) : h - DIAS_POR_DEFECTO * DIA_MS;
  if (Number.isNaN(h) || Number.isNaN(d)) throw new Error('VENTANA_INVALIDA: fecha ilegible');
  if (d >= h) throw new Error('VENTANA_INVALIDA: «desde» debe ser anterior a «hasta»');
  if (h - d > DIAS_MAXIMOS * DIA_MS) throw new Error(`VENTANA_INVALIDA: más de ${DIAS_MAXIMOS} días`);
  return { desde: new Date(d).toISOString(), hasta: new Date(h).toISOString() };
}

// ── Formato ───────────────────────────────────────────────────────────────────

/**
 * La clave de formato de una fila. `media_type` NULL es una imagen sola: es el contrato de
 * `scheduled_posts` que escribe `content-scheduler` (ver `carouselUrlsOf` en `api/publish.ts`).
 * Cualquier otro valor pasa tal cual, así que un formato nuevo (video, reel) aparece sin tocar código.
 */
export const FORMATO_SIN_TIPO = 'SINGLE_IMAGE';
export function formatoDe(mediaType: string | null | undefined): string {
  const t = String(mediaType ?? '').trim().toUpperCase();
  return t || FORMATO_SIN_TIPO;
}

// ── Conteos ───────────────────────────────────────────────────────────────────

export interface FilaPublicada { brand_id: string; platform: string; media_type: string | null; formato?: string }
export interface Conteo { brand_id: string; platform: string; formato: string; total: number }

/** Conteo por (marca, plataforma, formato), ordenado. Es lo que se compara con el `count(*)` directo. */
export function contar(filas: readonly FilaPublicada[]): Conteo[] {
  const m = new Map<string, Conteo>();
  for (const f of filas) {
    // Una fila que ya trae su formato (una publicación manual) lo conserva; si no, sale de `media_type`.
    const formato = f.formato ?? formatoDe(f.media_type);
    const k = `${f.brand_id}\u0000${f.platform}\u0000${formato}`;
    const c = m.get(k) ?? { brand_id: f.brand_id, platform: f.platform, formato, total: 0 };
    c.total += 1;
    m.set(k, c);
  }
  return [...m.values()].sort((a, b) =>
    a.brand_id.localeCompare(b.brand_id) || a.platform.localeCompare(b.platform) || a.formato.localeCompare(b.formato));
}

// ── La vía y el formato de cada fila del libro ────────────────────────────────

/**
 * `public.scheduled_posts` es EL LIBRO de toda publicación (`unrlvl-iid-functions` #479, 2026-10-25): el
 * carril asienta lo que publica SocialLab, `blog-promoter` lo externo y la bandeja manual del
 * Orchestrator lo publicado a mano. El tablero lee sólo el libro: una segunda fuente (las franjas)
 * duplicaba cada publicación manual (ICR C-09).
 *
 * La VÍA no está en la fila: sale del canal (`intel.brand_publish_channels.publication_path`), cruzado
 * por marca y plataforma. La plataforma del canal es `config.provider_platform`, o su clave en
 * mayúsculas si no la declara: la misma regla con la que el libro asienta (#479).
 */
export interface Canal { brand_id: string; platform_key: string; publication_path: string | null; provider?: string | null }

/** La vía por la que salió una publicación. `sin_canal` se dice, no se adivina. */
export type Via = 'carril' | 'manual' | 'externa' | 'detectada' | 'sin_canal';

/**
 * El `source_lab` con el que SignalLab asienta en el libro una publicación que encontró en la plataforma
 * sin fila previa: alguien publicó fuera del sistema (`unrlvl-iid-functions` #483). Es vocabulario del
 * sistema, no de una marca. Manda sobre el canal: esa fila cae en un canal `drained` y, sin esta regla,
 * se leería como «carril».
 */
export const ORIGEN_DETECTADO = 'deteccion_plataforma';

const VIA_POR_RUTA: Readonly<Record<string, Via>> = { drained: 'carril', manual: 'manual', external: 'externa' };

export const plataformaDelCanal = (c: Canal): string => String(c.provider || c.platform_key || '').toUpperCase();

/** Índice (marca, plataforma) → vía. */
export function viasPorCanal(canales: readonly Canal[]): Map<string, Via> {
  const m = new Map<string, Via>();
  for (const c of canales) m.set(`${c.brand_id}\u0000${plataformaDelCanal(c)}`, VIA_POR_RUTA[String(c.publication_path ?? '')] ?? 'sin_canal');
  return m;
}

export function viaDe(vias: Map<string, Via>, brandId: string, platform: string, sourceLab?: string | null): Via {
  if (sourceLab === ORIGEN_DETECTADO) return 'detectada';
  return vias.get(`${brandId}\u0000${String(platform ?? '').toUpperCase()}`) ?? 'sin_canal';
}

/**
 * El formato de una fila. `media_type` NULL = una imagen sola es el contrato de las filas que asienta
 * el CARRIL (`content-scheduler`); una fila manual o externa con NULL no es «una imagen»: su formato es
 * el de la pieza (`content_pieces.format`: post, artículo…), y si no hay pieza, se queda vacío.
 */
export function formatoDeFila(mediaType: string | null | undefined, via: Via, formatoPieza: string | null | undefined): string {
  if (via === 'carril') return formatoDe(mediaType);
  if (mediaType && String(mediaType).trim()) return formatoDe(mediaType);
  return formatoPieza && String(formatoPieza).trim() ? String(formatoPieza).trim().toUpperCase() : '';
}

/** El enlace de una fila: el `platform_post_id` cuando ya es una URL (manual, externa); si no, null. */
export function enlaceDeId(platformPostId: string | null | undefined): string | null {
  return platformPostId && /^https?:\/\//i.test(platformPostId) ? platformPostId : null;
}

// ── Estadísticas por marca y plataforma ───────────────────────────────────────

export interface FilaConMetricas {
  id: string; brand_id: string; platform: string; formato: string; published_at: string;
  metricas: { metric: string; value: number }[];
}
export interface ResumenMetrica { metric: string; total: number; mediana: number; posts: number }
export interface Estadistica {
  brand_id: string; platform: string;
  publicaciones: number; medidas: number;
  metricas: ResumenMetrica[];
  porFormato: { formato: string; publicaciones: number }[];
  /** La métrica con la que se ordena el top: la de mayor total en esta plataforma (dato, no literal). */
  metricaTop: string | null;
  top: string[];
  porDia: { dia: string; publicaciones: number }[];
}

const mediana = (xs: number[]): number => {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/**
 * Resumen por (marca, plataforma) de lo publicado en la ventana, con la última lectura de cada post.
 * - `total` y `mediana` se calculan SÓLO sobre los posts que tienen esa métrica: un post sin medir no
 *   suma un cero.
 * - Las métricas salen de los datos: cada plataforma muestra las suyas, sin lista en el código.
 * - `porDia` agrupa por fecha de publicación (UTC), no es la serie diaria de la cuenta.
 */
export function estadisticas(filas: readonly FilaConMetricas[], topN = 6): Estadistica[] {
  const grupos = new Map<string, FilaConMetricas[]>();
  for (const f of filas) {
    const k = `${f.brand_id}\u0000${f.platform}`;
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  const out: Estadistica[] = [];
  for (const g of grupos.values()) {
    const valores = new Map<string, number[]>();
    for (const f of g) for (const m of f.metricas) valores.set(m.metric, [...(valores.get(m.metric) ?? []), Number(m.value)]);
    const metricas = [...valores.entries()]
      .map(([metric, xs]) => ({ metric, total: xs.reduce((a, b) => a + b, 0), mediana: mediana(xs), posts: xs.length }))
      .sort((a, b) => b.total - a.total || a.metric.localeCompare(b.metric));
    const metricaTop = metricas[0]?.metric ?? null;
    const valorDe = (f: FilaConMetricas) => f.metricas.find((m) => m.metric === metricaTop)?.value ?? -1;
    const formatos = new Map<string, number>();
    const dias = new Map<string, number>();
    for (const f of g) {
      formatos.set(f.formato, (formatos.get(f.formato) ?? 0) + 1);
      const d = f.published_at.slice(0, 10);
      dias.set(d, (dias.get(d) ?? 0) + 1);
    }
    out.push({
      brand_id: g[0].brand_id, platform: g[0].platform,
      publicaciones: g.length, medidas: g.filter((f) => f.metricas.length > 0).length,
      metricas,
      porFormato: [...formatos.entries()].map(([formato, publicaciones]) => ({ formato, publicaciones })).sort((a, b) => b.publicaciones - a.publicaciones),
      metricaTop,
      top: metricaTop ? g.filter((f) => valorDe(f) >= 0).sort((a, b) => Number(valorDe(b)) - Number(valorDe(a))).slice(0, topN).map((f) => f.id) : [],
      porDia: [...dias.entries()].map(([dia, publicaciones]) => ({ dia, publicaciones })).sort((a, b) => a.dia.localeCompare(b.dia)),
    });
  }
  return out.sort((a, b) => a.brand_id.localeCompare(b.brand_id) || a.platform.localeCompare(b.platform));
}

// ── Lectura en vivo, por plataforma ───────────────────────────────────────────

/** Una publicación tal como la devuelve la plataforma, ya normalizada. */
export interface PublicacionEnVivo {
  platform: string;
  platform_post_id: string;
  permalink: string | null;
  imagen: string | null;
  texto: string | null;
  publicado_en: string | null;
  formato: string;
}

interface Lector {
  /** La tool del MCP de Meta que lista las publicaciones recientes de una cuenta. */
  tool: string;
  /** La columna de `public.meta_accounts` que dice si la marca tiene cuenta en esta plataforma. */
  columnaCuenta: string;
  normalizar: (item: Record<string, unknown>) => PublicacionEnVivo | null;
}

const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * Cómo se lee cada PLATAFORMA en vivo. Las claves son los valores de `scheduled_posts.platform`.
 * Una plataforma nueva entra con su lector aquí (es eje: cómo se habla con esa API); una marca nueva
 * entra con su fila en `meta_accounts`, sin tocar este archivo.
 */
export const LECTORES_EN_VIVO: Readonly<Record<string, Lector>> = {
  INSTAGRAM: {
    tool: 'ig_get_media',
    columnaCuenta: 'ig_user_id',
    normalizar: (i) => {
      const id = txt(i.id);
      if (!id) return null;
      const tipo = String(i.media_type ?? '').toUpperCase();
      return {
        platform: 'INSTAGRAM',
        platform_post_id: id,
        permalink: txt(i.permalink),
        // En un video, `media_url` es el archivo de video: la miniatura es `thumbnail_url`.
        imagen: tipo === 'VIDEO' ? txt(i.thumbnail_url) ?? null : txt(i.media_url) ?? txt(i.thumbnail_url),
        texto: txt(i.caption),
        publicado_en: txt(i.timestamp),
        formato: tipo === 'CAROUSEL_ALBUM' ? 'CAROUSEL' : tipo === 'IMAGE' ? FORMATO_SIN_TIPO : formatoDe(tipo),
      };
    },
  },
  FACEBOOK: {
    tool: 'fb_get_posts',
    columnaCuenta: 'page_id',
    normalizar: (i) => {
      const id = txt(i.id);
      if (!id) return null;
      return {
        platform: 'FACEBOOK',
        platform_post_id: id,
        permalink: txt(i.permalink_url),
        imagen: txt(i.full_picture),
        texto: txt(i.message) ?? txt(i.story),
        publicado_en: txt(i.created_time),
        // El feed de Facebook no declara el formato; se toma el del registro al cruzar.
        formato: '',
      };
    },
  },
};

export function lectorDe(platform: string): Lector | null {
  return LECTORES_EN_VIVO[String(platform ?? '').toUpperCase()] ?? null;
}

/** Normaliza la respuesta de un lector (`{ data: [...] }`). Lanza si la forma no es la esperada. */
export function normalizarRespuesta(platform: string, respuesta: unknown): PublicacionEnVivo[] {
  const lector = lectorDe(platform);
  if (!lector) throw new Error(`SIN_LECTOR_EN_VIVO: ${platform}`);
  const r = respuesta as { data?: unknown; error?: unknown };
  if (r && typeof r === 'object' && r.error) {
    throw new Error(`LECTURA_EN_VIVO_FALLIDA: ${typeof r.error === 'string' ? r.error : JSON.stringify(r.error)}`);
  }
  if (!r || !Array.isArray(r.data)) throw new Error('LECTURA_EN_VIVO_ILEGIBLE: la respuesta no trae «data»');
  return (r.data as Record<string, unknown>[]).map(lector.normalizar).filter((x): x is PublicacionEnVivo => !!x);
}

// ── Métricas de SignalLab ─────────────────────────────────────────────────────

export interface Instantanea { scheduled_post_id: string; age_minutes: number; metric: string; value: number; fetched_at: string }
export interface MetricaLeida { metric: string; value: number; age_minutes: number; fetched_at: string }

/**
 * La última lectura de cada métrica de un post (la de mayor edad). Un post sin instantáneas devuelve
 * `[]`, que la interfaz pinta como «sin medir»: nunca como cero.
 */
export function ultimasMetricas(instantaneas: readonly Instantanea[]): Map<string, MetricaLeida[]> {
  const porPost = new Map<string, Map<string, MetricaLeida>>();
  for (const s of instantaneas) {
    const m = porPost.get(s.scheduled_post_id) ?? new Map<string, MetricaLeida>();
    const prev = m.get(s.metric);
    if (!prev || s.age_minutes > prev.age_minutes || (s.age_minutes === prev.age_minutes && s.fetched_at > prev.fetched_at)) {
      m.set(s.metric, { metric: s.metric, value: Number(s.value), age_minutes: s.age_minutes, fetched_at: s.fetched_at });
    }
    porPost.set(s.scheduled_post_id, m);
  }
  const out = new Map<string, MetricaLeida[]>();
  for (const [id, m] of porPost) out.set(id, [...m.values()].sort((a, b) => a.metric.localeCompare(b.metric)));
  return out;
}
