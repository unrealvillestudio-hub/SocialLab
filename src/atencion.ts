/**
 * HOY · LO QUE PIDE ATENCIÓN (Sam, 2026-10-26: «¿no se supone que aquí estaría lo que más atención deberíamos prestarle
 * o estar pendientes?»). Núcleo puro: junta lo que ya leen las bandejas —comentarios, mensajes, consejos del asesor,
 * objetivos por decidir y las franjas de hoy— y lo ordena por urgencia. Sin red ni estado; nada se inventa: lo que no
 * llegó (una lectura que falló) simplemente no aparece, y la vista lo dice aparte.
 *
 * Urgencia:
 *   · urgente  — una respuesta que falló, una ventana de mensaje directo a punto de cerrarse, algo fuera de la meta de
 *                respuesta de su marca, una franja de hoy que falló, una publicación manual de días anteriores.
 *   · atencion — lo que espera respuesta dentro de la meta, consejos del asesor, objetivos sin decidir y las
 *                publicaciones manuales de hoy.
 *   · aviso    — huecos de hoy: una franja sin pieza aprobada.
 */
import type { Comentario, Franja, HiloDM, Recomendacion, Tarjeta } from './api';

export type Nivel = 'urgente' | 'atencion' | 'aviso';
export type Destino = 'comentarios' | 'mensajes' | 'acciones' | 'calendario' | 'hoy';
export interface ItemAtencion {
  clave: string; nivel: Nivel; brand_id: string; platform: string | null;
  titulo: string; detalle: string | null;
  /** Desde cuándo espera (ISO): ordena dentro del mismo nivel, lo más viejo primero. */
  desde: string | null;
  destino: Destino;
}

/** Horas antes del cierre de la ventana de un mensaje directo en que pasa a urgente. */
export const HORAS_VENTANA_URGENTE = 4;
const ORDEN: Record<Nivel, number> = { urgente: 0, atencion: 1, aviso: 2 };
const ms = (s: string | null | undefined) => Date.parse(String(s ?? ''));

/** «hace 5 min», «hace 3 h», «hace 2 d». */
export function haceCuanto(desde: string | null | undefined, ahora = Date.now()): string {
  const t = ms(desde);
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((ahora - t) / 60_000));
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
}

const fueraDeMeta = (desde: string | null, metaMin: number | null | undefined, ahora: number) =>
  metaMin != null && metaMin > 0 && Number.isFinite(ms(desde)) && ahora - ms(desde) > metaMin * 60_000;

const corto = (t: string | null | undefined, n = 90) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s || null;
};

export interface Entradas {
  comentarios?: readonly Comentario[];
  hilos?: readonly HiloDM[];
  recomendaciones?: readonly Recomendacion[];
  tarjetas?: readonly Tarjeta[];
  /** Objetivos de la semana por decidir, por marca. */
  propuestas?: ReadonlyArray<{ brand_id: string; n: number }>;
  /** Franjas de la ventana leída; sólo cuentan las del día de hoy de cada marca, en su huso. */
  franjas?: readonly Franja[];
  husos?: ReadonlyMap<string, string | null>;
  /** La plataforma de un canal de la marca (`meta_ig` → la plataforma del canal): la franja trae la clave del canal. */
  plataformaDeCanal?: (brand: string, platformKey: string) => string;
}

/** «25 oct», en el huso de la marca. */
const fechaCorta = (iso: string, huso: string | null) => {
  try { return new Date(ms(iso)).toLocaleDateString('es', { timeZone: huso ?? undefined, day: 'numeric', month: 'short' }); }
  catch { return iso.slice(0, 10); }
};

/** El día (AAAA-MM-DD) de un instante en un huso; sin huso válido, UTC. */
export function diaEn(iso: string | number, huso: string | null | undefined): string {
  const d = new Date(typeof iso === 'number' ? iso : ms(iso));
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: huso || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch { return d.toISOString().slice(0, 10); }
}

export function itemsDeAtencion(e: Entradas, ahora = Date.now()): ItemAtencion[] {
  const out: ItemAtencion[] = [];

  for (const h of e.hilos ?? []) {
    if (h.estado !== 'sin_responder' && h.estado !== 'fallida') continue;
    const ultimo = [...h.mensajes].filter((m) => !m.from_brand).sort((a, b) => ms(b.sent_at) - ms(a.sent_at))[0];
    const desde = h.espera_desde ?? ultimo?.sent_at ?? h.ultimo_at;
    const restanH = h.responder.puede && h.responder.hasta ? (ms(h.responder.hasta) - ahora) / 3_600_000 : null;
    const porCerrar = restanH !== null && restanH <= HORAS_VENTANA_URGENTE;
    const fuera = fueraDeMeta(desde, h.meta_min, ahora);
    if (!h.responder.puede && h.estado !== 'fallida') continue;   // la plataforma ya no deja responder desde aquí
    out.push({
      clave: `dm:${h.id}`, brand_id: h.brand_id, platform: h.platform, desde, destino: 'mensajes',
      nivel: h.estado === 'fallida' || porCerrar || fuera ? 'urgente' : 'atencion',
      titulo: `${h.estado === 'fallida' ? 'Respuesta fallida a' : 'Mensaje de'} ${h.participant_name ?? 'alguien'}`,
      detalle: [porCerrar ? `la ventana para responder cierra en ${Math.max(0, Math.round(restanH! * 10) / 10)} h` : null,
        fuera ? 'fuera de la meta de respuesta' : null, corto(ultimo?.text)].filter(Boolean).join(' · ') || null,
    });
  }

  for (const c of e.comentarios ?? []) {
    if (c.estado !== 'sin_responder' && c.estado !== 'fallida') continue;
    const fuera = fueraDeMeta(c.commented_at, c.meta_min, ahora);
    out.push({
      clave: `com:${c.id}`, brand_id: c.brand_id, platform: c.platform, desde: c.commented_at, destino: 'comentarios',
      nivel: c.estado === 'fallida' || fuera ? 'urgente' : 'atencion',
      titulo: `${c.estado === 'fallida' ? 'Respuesta fallida a' : 'Comentario de'} ${c.author_name ?? 'alguien'}`,
      detalle: [fuera ? 'fuera de la meta de respuesta' : null, c.intencion && !c.intencion.fallback ? c.intencion.label : null,
        corto(c.text)].filter(Boolean).join(' · ') || null,
    });
  }

  const porMarca = <T extends { brand_id: string }>(xs: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(x.brand_id, [...(m.get(x.brand_id) ?? []), x]);
    return m;
  };
  for (const [b, rs] of porMarca((e.recomendaciones ?? []).filter((r) => r.status === 'nueva'))) {
    const viejo = rs.map((r) => r.created_at).sort()[0] ?? null;
    out.push({ clave: `reco:${b}`, nivel: 'atencion', brand_id: b, platform: null, desde: viejo, destino: 'acciones',
      titulo: `${rs.length} ${rs.length === 1 ? 'consejo' : 'consejos'} del asesor sin decidir`,
      detalle: corto(rs[0]?.recommendation) });
  }
  for (const [b, ts] of porMarca((e.tarjetas ?? []).filter((t) => t.status === 'nueva' && t.severity === 'atencion'))) {
    out.push({ clave: `tarjeta:${b}`, nivel: 'atencion', brand_id: b, platform: null, desde: ts.map((t) => t.created_at).sort()[0] ?? null,
      destino: 'acciones', titulo: ts.length === 1 ? '1 señal de SignalLab que pide atención' : `${ts.length} señales de SignalLab que piden atención`,
      detalle: corto(ts[0]?.what_text) });
  }
  for (const p of e.propuestas ?? []) {
    if (p.n <= 0) continue;
    out.push({ clave: `obj:${p.brand_id}`, nivel: 'atencion', brand_id: p.brand_id, platform: null, desde: null, destino: 'hoy',
      titulo: `${p.n} ${p.n === 1 ? 'objetivo propuesto' : 'objetivos propuestos'} para esta semana`,
      detalle: p.n === 1 ? 'apruébalo, edítalo o descártalo arriba' : 'apruébalos, edítalos o descártalos arriba' });
  }

  for (const f of e.franjas ?? []) {
    const huso = e.husos?.get(f.brand_id) ?? null;
    const plataforma = e.plataformaDeCanal ? e.plataformaDeCanal(f.brand_id, f.platform_key) : f.platform_key;
    const hora = new Date(ms(f.slot_at)).toLocaleTimeString('es', { timeZone: huso ?? undefined, hour: '2-digit', minute: '2-digit' });
    // Una publicación manual (un canal sin publicación automática) espera a una persona: la de días anteriores, urgente.
    if (f.status === 'manual_pending' && ms(f.slot_at) <= ahora + 86_400_000) {
      const vencida = diaEn(f.slot_at, huso) < diaEn(ahora, huso);
      if (vencida || diaEn(f.slot_at, huso) === diaEn(ahora, huso)) {
        out.push({ clave: `franja:${f.id}`, nivel: vencida ? 'urgente' : 'atencion', brand_id: f.brand_id, platform: plataforma,
          desde: f.slot_at, destino: 'calendario',
          titulo: vencida ? 'Publicación manual atrasada' : `Publicación manual de las ${hora}`,
          detalle: vencida ? `era para el ${fechaCorta(f.slot_at, huso)} a las ${hora}: sigue sin publicarse` : 'es de un canal que se publica a mano' });
      }
      continue;
    }
    if (diaEn(f.slot_at, huso) !== diaEn(ahora, huso)) continue;
    if (f.status === 'failed') {
      out.push({ clave: `franja:${f.id}`, nivel: 'urgente', brand_id: f.brand_id, platform: plataforma, desde: f.slot_at,
        destino: 'calendario', titulo: `La publicación de las ${hora} falló`, detalle: corto(f.failed_reason) });
    } else if (f.status === 'free' && !f.piece_id && ms(f.slot_at) > ahora) {
      out.push({ clave: `franja:${f.id}`, nivel: 'aviso', brand_id: f.brand_id, platform: plataforma, desde: f.slot_at,
        destino: 'calendario', titulo: `Hueco a las ${hora}: no hay pieza aprobada`, detalle: null });
    }
  }

  return out.sort((a, b) => ORDEN[a.nivel] - ORDEN[b.nivel]
    || (Number.isFinite(ms(a.desde)) ? ms(a.desde) : Infinity) - (Number.isFinite(ms(b.desde)) ? ms(b.desde) : Infinity));
}

/** Lo que sale hoy, por marca y en su huso: reservado (listo), libre (hueco), publicado o fallido. */
export function franjasDeHoy(franjas: readonly Franja[], husos: ReadonlyMap<string, string | null>, ahora = Date.now()): Franja[] {
  return franjas.filter((f) => { const h = husos.get(f.brand_id) ?? null; return diaEn(f.slot_at, h) === diaEn(ahora, h); })
    .sort((a, b) => ms(a.slot_at) - ms(b.slot_at));
}
