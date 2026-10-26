/**
 * COMENTARIOS — el núcleo puro (SignalLab Fase 3, 2026-10-25). Sin red ni base.
 *
 * El colector de SignalLab (`unrlvl-iid-functions`, EF `signal-collector`) guarda los comentarios en
 * `content.post_comments`. Este módulo decide, sin efectos, qué comentario espera respuesta, a qué
 * comentario se responde y cuándo una respuesta cuenta como verificada. `api/comments.ts` hace la E/S.
 *
 * Nada aquí nombra una plataforma ni una marca: qué herramienta responde y cuál lee la respuesta
 * viene de `intel.signal_platforms` (`reply_tool`, `comment_read_tool`).
 */

export interface Comentario {
  id: number;
  platform: string;
  platform_comment_id: string;
  brand_id: string;
  platform_post_id: string;
  parent_comment_id: string | null;
  from_brand: boolean;
  commented_at: string;
  /** El autor tal como lo guarda el colector (en Instagram, el usuario). Para reconocer cuentas allegadas. */
  author_name?: string | null;
}

export interface Respuesta {
  id: string;
  post_comment_id: number;
  status: 'requested' | 'sent' | 'verified' | 'failed';
  requested_at: string;
  /** `publica` (en el hilo) o `privada` (mensaje a quien comentó). Sin el campo, `publica`. */
  kind?: 'publica' | 'privada';
}

export type Clase = 'publica' | 'privada';
const claseDe = (r: Respuesta): Clase => (r.kind === 'privada' ? 'privada' : 'publica');

export type Estado = 'sin_responder' | 'fallida' | 'en_curso' | 'respondido' | 'cerrado' | 'allegado' | 'de_la_marca';

/** El orden de la bandeja: lo que espera a alguien va primero. */
export const ORDEN_DE_ESTADO: Readonly<Record<Estado, number>> = {
  sin_responder: 0, fallida: 1, en_curso: 2, respondido: 3, cerrado: 4, allegado: 5, de_la_marca: 6,
};

/**
 * Lo que la bandeja muestra por defecto (Sam, 2026-10-26: «tan pronto respondamos la tarjeta se libera hasta que
 * esa misma persona vuelva a comentar»). Lo respondido —también lo enviado que aún se verifica—, y lo cerrado, sale; un
 * comentario nuevo es otra fila y entra. Una respuesta fallida vuelve: no salió.
 */
export const ESTADOS_PENDIENTES: readonly Estado[] = ['sin_responder', 'fallida'];

/**
 * Cómo se cierra un comentario sin responderlo desde el tablero (`content.post_comment_closures.kind`):
 * `hecho` (la acción se hizo, p. ej. fijarlo en la app), `descartado` (no es viable) o `contestado_fuera`.
 */
export const TIPOS_DE_CIERRE = ['hecho', 'descartado', 'contestado_fuera'] as const;
export type TipoCierre = (typeof TIPOS_DE_CIERRE)[number];
/**
 * Cuentas del equipo o allegadas (amigos y familia) de una marca (`content.brand_close_accounts`, Sam 2026-10-26): sus
 * comentarios no esperan respuesta. Se reconocen por plataforma y autor.
 */
export const RELACIONES = ['equipo', 'allegado'] as const;
export type Relacion = (typeof RELACIONES)[number];
export const esRelacion = (v: unknown): v is Relacion => typeof v === 'string' && (RELACIONES as readonly string[]).includes(v);
export const claveDeAutor = (brandId: string, platform: string, autor: string | null | undefined): string =>
  `${brandId}|${platform}|${String(autor ?? '').trim()}`;

export const esTipoDeCierre = (v: unknown): v is TipoCierre => typeof v === 'string' && (TIPOS_DE_CIERRE as readonly string[]).includes(v);

/** Minutos durante los que una respuesta pedida o enviada bloquea otra al mismo comentario. */
export const MINUTOS_EN_VUELO = 10;

/** El hilo de un comentario: el de primer nivel del que cuelga, o él mismo. */
export const hiloDe = (c: Pick<Comentario, 'parent_comment_id' | 'platform_comment_id'>): string =>
  c.parent_comment_id ?? c.platform_comment_id;

/**
 * A qué comentario se responde. Las plataformas leídas hoy anidan un solo nivel, así que la
 * respuesta va al comentario de primer nivel del hilo; la respuesta queda visible bajo el mismo hilo.
 */
export const objetivoDeRespuesta = hiloDe;

/**
 * El estado de cada comentario. Cuenta como respondido si hay una respuesta verificada desde
 * SocialLab o si la marca contestó en el mismo hilo después del comentario, desde donde sea. Un comentario cerrado
 * en el tablero (`cerrados`) queda `cerrado`, salvo que además esté respondido. El de una cuenta allegada o del equipo
 * (`allegados`, claves de `claveDeAutor`) queda `allegado`: no espera respuesta.
 */
export function estados(comentarios: readonly Comentario[], respuestas: readonly Respuesta[],
  cerrados: ReadonlySet<number> = new Set(), allegados: ReadonlySet<string> = new Set()): Map<number, Estado> {
  const porComentario = new Map<number, Respuesta[]>();
  for (const r of respuestas) {
    const xs = porComentario.get(r.post_comment_id) ?? [];
    xs.push(r);
    porComentario.set(r.post_comment_id, xs);
  }
  const ultimaDeLaMarca = new Map<string, number>();
  for (const c of comentarios) {
    if (!c.from_brand) continue;
    const k = `${c.platform}|${hiloDe(c)}`;
    const t = Date.parse(c.commented_at);
    if (!Number.isNaN(t) && t > (ultimaDeLaMarca.get(k) ?? -Infinity)) ultimaDeLaMarca.set(k, t);
  }
  const out = new Map<number, Estado>();
  for (const c of comentarios) {
    if (c.from_brand) { out.set(c.id, 'de_la_marca'); continue; }
    const rs = (porComentario.get(c.id) ?? []).slice().sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at));
    const t = Date.parse(c.commented_at);
    if (rs.some((r) => r.status === 'verified') || (ultimaDeLaMarca.get(`${c.platform}|${hiloDe(c)}`) ?? -Infinity) > t) {
      out.set(c.id, 'respondido');
    } else if (cerrados.has(c.id)) {
      out.set(c.id, 'cerrado');
    } else if (c.author_name && allegados.has(claveDeAutor(c.brand_id, c.platform, c.author_name))) {
      out.set(c.id, 'allegado');
    } else if (rs[0] && (rs[0].status === 'requested' || rs[0].status === 'sent')) {
      out.set(c.id, 'en_curso');
    } else if (rs[0]?.status === 'failed') {
      out.set(c.id, 'fallida');
    } else {
      out.set(c.id, 'sin_responder');
    }
  }
  return out;
}

/** Ordena la bandeja: por estado; dentro de cada estado, por la prioridad de su intención (sin intención, al final) y
 *  luego lo más reciente primero. Sin catálogo de intenciones, el orden es el de siempre. */
export function ordenar<T extends { estado: Estado; commented_at: string; intencion?: { priority: number } | null }>(xs: readonly T[]): T[] {
  const prioridad = (x: T) => x.intencion?.priority ?? Number.POSITIVE_INFINITY;
  return xs.slice().sort((a, b) =>
    ORDEN_DE_ESTADO[a.estado] - ORDEN_DE_ESTADO[b.estado]
    || (prioridad(a) === prioridad(b) ? 0 : prioridad(a) < prioridad(b) ? -1 : 1)
    || Date.parse(b.commented_at) - Date.parse(a.commented_at));
}

// ── PRIORIDAD POR INTENCIÓN (Sam, 2026-10-26) ─────────────────────────────────────────────────────
//
// La intención de un comentario es dato: `intel.comment_intents` (etiqueta, prioridad, color, la de reserva) e
// `intel.comment_intent_patterns` (regex sin distinguir mayúsculas; `brand_id` NULL = todas las marcas, con
// `brand_id` = sólo esa). Un comentario recibe la intención de menor prioridad cuyo patrón case; si ninguno casa, la
// de reserva. Aquí no se nombra ninguna intención ni ninguna palabra: todo llega del catálogo.

export interface Intencion { intent_key: string; label: string; priority: number; display_color: string | null; fallback: boolean }
export interface PatronDeIntencion { intent_key: string; brand_id: string | null; pattern: string }

/**
 * El clasificador de un catálogo: compila cada patrón una vez. Un patrón que no compila se omite y se devuelve en
 * `invalidos` (lo demás sigue clasificando). Sin intenciones, devuelve siempre null: la bandeja ordena como antes.
 */
export function clasificador(intenciones: readonly Intencion[], patrones: readonly PatronDeIntencion[]): {
  intencionDe: (brandId: string, texto: string | null | undefined) => Intencion | null; invalidos: PatronDeIntencion[];
} {
  const porClave = new Map(intenciones.map((i) => [i.intent_key, i]));
  const reserva = intenciones.find((i) => i.fallback) ?? null;
  const invalidos: PatronDeIntencion[] = [];
  const compilados: Array<{ intencion: Intencion; brand_id: string | null; re: RegExp }> = [];
  for (const p of patrones) {
    const intencion = porClave.get(p.intent_key);
    if (!intencion) continue;
    try { compilados.push({ intencion, brand_id: p.brand_id, re: new RegExp(p.pattern, 'iu') }); }
    catch { invalidos.push(p); }
  }
  compilados.sort((a, b) => a.intencion.priority - b.intencion.priority);
  return {
    invalidos,
    intencionDe: (brandId, texto) => {
      if (!intenciones.length) return null;
      const t = String(texto ?? '');
      return compilados.find((c) => (c.brand_id === null || c.brand_id === brandId) && c.re.test(t))?.intencion ?? reserva;
    },
  };
}

/** El mensaje, recortado. Lanza si está vacío: un mensaje vacío no es una respuesta. */
export function mensajeValido(m: unknown): string {
  const s = typeof m === 'string' ? m.trim() : '';
  if (!s) throw new Error('MENSAJE_VACIO: la respuesta no puede estar vacía');
  return s;
}

/** ¿Hay una respuesta pedida o enviada hace menos de `MINUTOS_EN_VUELO`? Evita el doble envío. */
export function hayEnVuelo(respuestas: readonly Respuesta[], ahora = Date.now(), clase: Clase = 'publica'): boolean {
  return respuestas.some((r) => claseDe(r) === clase && (r.status === 'requested' || r.status === 'sent')
    && ahora - Date.parse(r.requested_at) < MINUTOS_EN_VUELO * 60_000);
}

/** La respuesta está verificada si la plataforma devuelve, al leerla, el mismo id que dio al crearla. */
export function verificada(leida: unknown, idRespuesta: string | null | undefined): boolean {
  return !!idRespuesta && !!leida && typeof leida === 'object' && (leida as { id?: unknown }).id === idRespuesta;
}

/**
 * ¿Se puede responder en privado a este comentario? La plataforma lo permite una vez por comentario y dentro de su
 * ventana (`intel.signal_platforms.private_reply_window_minutes`, dato). El motivo va al tablero tal cual: «no se puede»
 * siempre dice por qué.
 */
export function privadaDisponible(
  c: Pick<Comentario, 'from_brand' | 'commented_at'>,
  respuestas: readonly Respuesta[],
  ventanaMinutos: number | null,
  ahora = Date.now(),
): { puede: boolean; motivo: string | null; hasta: string | null } {
  if (c.from_brand) return { puede: false, motivo: 'es un comentario de la propia marca', hasta: null };
  if (!ventanaMinutos) return { puede: false, motivo: 'la plataforma no tiene respuesta privada configurada', hasta: null };
  const t = Date.parse(c.commented_at);
  if (Number.isNaN(t)) return { puede: false, motivo: 'fecha del comentario ilegible', hasta: null };
  const hasta = new Date(t + ventanaMinutos * 60_000).toISOString();
  if (respuestas.some((r) => claseDe(r) === 'privada' && r.status !== 'failed')) {
    return { puede: false, motivo: 'ya tiene una respuesta privada', hasta };
  }
  if (ahora > t + ventanaMinutos * 60_000) return { puede: false, motivo: 'pasó la ventana de la plataforma', hasta };
  return { puede: true, motivo: null, hasta };
}

/** La respuesta privada va a la persona de ESE comentario, no al primer nivel del hilo. */
export const objetivoDePrivada = (c: Pick<Comentario, 'platform_comment_id'>): string => c.platform_comment_id;

// ── TIEMPO DE RESPUESTA (Sam, 2026-10-26) ─────────────────────────────────────────────────────────
//
// Cuánto tarda la marca en responder, contra una meta que es dato: `intel.brand_response_targets` (marca y plataforma
// → marca) y, si no hay, `signal_collector_config.response_target_minutes`. La primera respuesta es la primera que salió
// desde SocialLab (enviada o verificada) o la primera de la marca en el mismo hilo, desde donde sea. Lo cerrado sin
// responder y lo de allegados no cuenta: no es trabajo de respuesta.

export interface MetaDeRespuesta { brand_id: string; platform: string | null; target_minutes: number }

/** La meta de una marca y plataforma: la suya, la de la marca o la de por defecto. Sin ninguna, null. */
export function metaDe(metas: readonly MetaDeRespuesta[], porDefecto: number | null, brandId: string, platform: string): number | null {
  return metas.find((m) => m.brand_id === brandId && m.platform === platform)?.target_minutes
    ?? metas.find((m) => m.brand_id === brandId && m.platform === null)?.target_minutes
    ?? porDefecto;
}

/**
 * Minutos hasta la primera respuesta de cada comentario ajeno, o null si nadie respondió. `respuestas` son las de
 * SocialLab (con `sent_at`); `comentarios` incluye los de la marca, para ver si contestó en el hilo.
 */
export function minutosHastaRespuesta(
  comentarios: readonly Comentario[], respuestas: readonly (Respuesta & { sent_at?: string | null })[],
): Map<number, number | null> {
  const marcaPorHilo = new Map<string, number[]>();
  for (const m of comentarios) {
    if (!m.from_brand) continue;
    const k = `${m.platform}|${hiloDe(m)}`;
    const t = Date.parse(m.commented_at);
    if (!Number.isNaN(t)) marcaPorHilo.set(k, [...(marcaPorHilo.get(k) ?? []), t]);
  }
  const salidaPorComentario = new Map<number, number[]>();
  for (const r of respuestas) {
    if (r.status !== 'sent' && r.status !== 'verified') continue;
    const t = Date.parse(r.sent_at ?? r.requested_at);
    if (!Number.isNaN(t)) salidaPorComentario.set(r.post_comment_id, [...(salidaPorComentario.get(r.post_comment_id) ?? []), t]);
  }
  const out = new Map<number, number | null>();
  for (const c of comentarios) {
    if (c.from_brand) continue;
    const t0 = Date.parse(c.commented_at);
    const candidatas = [...(salidaPorComentario.get(c.id) ?? []), ...(marcaPorHilo.get(`${c.platform}|${hiloDe(c)}`) ?? [])].filter((t) => t > t0);
    out.set(c.id, candidatas.length ? Math.round((Math.min(...candidatas) - t0) / 60_000) : null);
  }
  return out;
}

export interface TiempoDeRespuesta {
  brand_id: string; platform: string; meta_min: number | null;
  /** Comentarios respondidos en la ventana y la mediana de lo que se tardó. */
  respondidos: number; mediana_min: number | null;
  /** Porcentaje de respondidos dentro de la meta (null sin meta o sin respondidos). */
  dentro_pct: number | null;
  /** Comentarios que siguen esperando y ya pasaron la meta. */
  fuera_de_meta: number;
}

const mediana = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2);
};

/** El resumen por marca y plataforma. Sólo cuenta lo que es trabajo de respuesta: ni la marca, ni allegados, ni cerrado. */
export function tiemposDeRespuesta(
  filas: readonly { brand_id: string; platform: string; commented_at: string; estado: Estado; from_brand: boolean; id: number }[],
  minutos: ReadonlyMap<number, number | null>, meta: (brandId: string, platform: string) => number | null, ahora = Date.now(),
): TiempoDeRespuesta[] {
  const grupos = new Map<string, { brand_id: string; platform: string; tiempos: number[]; fuera: number }>();
  for (const f of filas) {
    if (f.from_brand || f.estado === 'allegado' || f.estado === 'cerrado' || f.estado === 'de_la_marca') continue;
    const k = `${f.brand_id}|${f.platform}`;
    const g = grupos.get(k) ?? { brand_id: f.brand_id, platform: f.platform, tiempos: [], fuera: 0 };
    const m = minutos.get(f.id) ?? null;
    const objetivo = meta(f.brand_id, f.platform);
    if (m !== null) g.tiempos.push(m);
    else if ((f.estado === 'sin_responder' || f.estado === 'fallida') && objetivo !== null
      && (ahora - Date.parse(f.commented_at)) / 60_000 > objetivo) g.fuera++;
    grupos.set(k, g);
  }
  return [...grupos.values()].map((g) => {
    const objetivo = meta(g.brand_id, g.platform);
    return {
      brand_id: g.brand_id, platform: g.platform, meta_min: objetivo, respondidos: g.tiempos.length,
      mediana_min: mediana(g.tiempos),
      dentro_pct: objetivo !== null && g.tiempos.length ? Math.round(100 * g.tiempos.filter((t) => t <= objetivo).length / g.tiempos.length) : null,
      fuera_de_meta: g.fuera,
    };
  }).sort((a, b) => a.brand_id.localeCompare(b.brand_id) || a.platform.localeCompare(b.platform));
}
