import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarClock, CircleDot, Info } from 'lucide-react';
import {
  comentarios as leerComentarios, mensajes as leerMensajes, objetivos as leerObjetivos, ops, tarjetas as leerTarjetas,
  type Marca, type RespAhora, type RespCalendario, type RespComentarios, type RespMensajes, type RespObjetivos, type RespTarjetas,
} from '../api';
import { franjasDeHoy, haceCuanto, itemsDeAtencion, type Destino, type ItemAtencion, type Nivel } from '../atencion';
import { Aviso, BotonActualizar, Chip, cn, etiquetaFormato, etiquetaPlataforma, fechaHora } from '../ui/components';
import { BannerObjetivos } from '../ui/Objetivos';
import { PillsDePost } from '../ui/Pulso';

/**
 * HOY · el centro de atención (Sam, 2026-10-26: «¿no se supone que aquí estaría lo que más atención deberíamos prestarle
 * o estar pendientes?»). De arriba abajo:
 *   1. La estrategia de la semana: los objetivos que el operador aprobó, lo que llevan, las propuestas del asesor por
 *      decidir y la revisión de la semana pasada.
 *   2. Lo que pide atención, por urgencia (`src/atencion.ts`): respuestas fallidas, ventanas de mensaje por cerrar, lo que
 *      pasó la meta de respuesta, lo que espera, consejos y objetivos sin decidir, publicaciones manuales y huecos.
 *   3. Lo que sale hoy: las franjas del día de cada marca, en su huso.
 *   4. Lo publicado en las últimas horas, con sus métricas (lo que antes era toda la pestaña).
 * Cada fuente se lee por separado: si una falla, las demás se ven y la que falló se nombra. Nada se inventa.
 */

const NIVEL: Record<Nivel, { etiqueta: string; clase: string; icono: React.ElementType }> = {
  urgente: { etiqueta: 'Urgente', clase: 'text-red-300 border-red-500/40 bg-red-500/5', icono: AlertTriangle },
  atencion: { etiqueta: 'Pendiente', clase: 'text-amber-300 border-amber-500/30 bg-amber-500/5', icono: CircleDot },
  aviso: { etiqueta: 'Aviso', clase: 'text-zinc-300 border-zinc-700 bg-zinc-900/40', icono: Info },
};
const ESTADO_FRANJA: Record<string, { texto: string; clase: string }> = {
  reserved: { texto: 'lista', clase: 'bg-sky-500/10 text-sky-300' },
  free: { texto: 'hueco', clase: 'bg-amber-500/10 text-amber-300' },
  published: { texto: 'publicada', clase: 'bg-emerald-500/10 text-emerald-300' },
  manual_pending: { texto: 'a mano', clase: 'bg-violet-500/10 text-violet-300' },
  failed: { texto: 'falló', clase: 'bg-red-500/10 text-red-300' },
};
const MAX_ITEMS = 15;

type Fuente<T> = { data: T | null; error: string | null };
const vacia = <T,>(): Fuente<T> => ({ data: null, error: null });

export default function Hoy({ token, marca, plataforma, marcas, irA }: {
  token: string; marca: string; plataforma: string; marcas: Marca[]; irA: (p: Destino) => void;
}) {
  const [coment, setComent] = useState<Fuente<RespComentarios>>(vacia);
  const [dms, setDms] = useState<Fuente<RespMensajes>>(vacia);
  const [asesor, setAsesor] = useState<Fuente<RespTarjetas>>(vacia);
  const [cal, setCal] = useState<Fuente<RespCalendario>>(vacia);
  const [ahoraResp, setAhoraResp] = useState<Fuente<RespAhora>>(vacia);
  const [obj, setObj] = useState<Fuente<RespObjetivos>>(vacia);
  const [cargando, setCargando] = useState(false);
  const [actualizadoEn, setActualizadoEn] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [verTodos, setVerTodos] = useState(false);

  // Se relee cada minuto: lo nuevo de las plataformas llega con SignalLab, cada 15 min.
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  const cargar = useCallback(async (vivo: () => boolean) => {
    setCargando(true);
    const m = marca || undefined;
    const ahora = Date.now();
    const lee = async <T,>(p: Promise<T>, set: (f: Fuente<T>) => void) => {
      try { const d = await p; if (vivo()) set({ data: d, error: null }); }
      catch (e) { if (vivo()) set({ data: null, error: e instanceof Error ? e.message : String(e) }); }
    };
    await Promise.all([
      lee(leerComentarios(token, { marca: m }), setComent),
      lee(leerMensajes(token, { marca: m }), setDms),
      lee(leerTarjetas(token, { marca: m }), setAsesor),
      lee(ops<RespCalendario>(token, 'calendario', { marca: m, desde: new Date(ahora - 3 * 86_400_000).toISOString(),
        hasta: new Date(ahora + 2 * 86_400_000).toISOString() }), setCal),
      lee(ops<RespAhora>(token, 'ahora', { marca: m }), setAhoraResp),
      lee(leerObjetivos(token, { marca: m }), setObj),
    ]);
    if (vivo()) { setCargando(false); setActualizadoEn(Date.now()); }
  }, [token, marca]);

  useEffect(() => {
    let vivo = true;
    void cargar(() => vivo);
    return () => { vivo = false; };
  }, [cargar, tick]);

  const husos = useMemo(() => new Map(marcas.map((m) => [m.brand_id, m.huso])), [marcas]);
  const nombre = (b: string) => marcas.find((m) => m.brand_id === b)?.nombre ?? b;
  const plataformaDeCanal = useCallback((brand: string, key: string) =>
    marcas.find((m) => m.brand_id === brand)?.canales?.find((c) => c.platform_key === key)?.platform ?? key.toUpperCase(), [marcas]);

  const items = useMemo(() => itemsDeAtencion({
    comentarios: coment.data?.comentarios, hilos: dms.data?.disponible ? dms.data.hilos : [],
    recomendaciones: asesor.data?.recomendaciones, tarjetas: asesor.data?.tarjetas,
    propuestas: (obj.data?.semanas ?? []).map((s) => ({ brand_id: s.brand_id, n: s.objetivos.filter((o) => o.status === 'propuesta').length })),
    franjas: cal.data?.franjas, husos, plataformaDeCanal,
  }).filter((i) => !plataforma || !i.platform || i.platform === plataforma), [coment.data, dms.data, asesor.data, obj.data, cal.data, husos, plataformaDeCanal, plataforma]);

  const hoy = useMemo(() => franjasDeHoy(cal.data?.franjas ?? [], husos)
    .filter((f) => !plataforma || plataformaDeCanal(f.brand_id, f.platform_key) === plataforma), [cal.data, husos, plataforma, plataformaDeCanal]);
  const publicadas = (ahoraResp.data?.publicaciones ?? []).filter((p) => !plataforma || p.platform === plataforma);

  const fallidas = [
    ['comentarios', coment.error], ['mensajes', dms.error], ['consejos del asesor', asesor.error],
    ['franjas', cal.error], ['publicaciones', ahoraResp.error], ['objetivos', obj.error],
  ].filter(([, e]) => e) as [string, string][];
  const cuenta = (n: Nivel) => items.filter((i) => i.nivel === n).length;
  const visibles = verTodos ? items : items.slice(0, MAX_ITEMS);
  const variasMarcas = !marca && marcas.length > 1;

  return (
    <div className="space-y-5">
      <BannerObjetivos token={token} data={obj.data} nombre={nombre} onCambio={() => setTick((n) => n + 1)} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="titulo text-xl text-zinc-100">Requiere tu atención</h3>
          {cuenta('urgente') > 0 && <Chip className="bg-red-500/15 text-red-300">{cuenta('urgente')} urgente{cuenta('urgente') === 1 ? '' : 's'}</Chip>}
          {cuenta('atencion') > 0 && <Chip className="bg-amber-500/15 text-amber-300">{cuenta('atencion')} pendiente{cuenta('atencion') === 1 ? '' : 's'}</Chip>}
          <BotonActualizar cargando={cargando} onClick={() => setTick((n) => n + 1)} />
        </div>
        {actualizadoEn && <p className="text-[10px] text-zinc-500">Actualizado a las {new Date(actualizadoEn).toLocaleTimeString('es')}. Lo nuevo de las plataformas llega con la lectura de SignalLab, cada 15 min.</p>}
        {fallidas.length > 0 && (
          <Aviso tono="error">No se pudo leer: {fallidas.map(([q, e]) => `${q} (${e})`).join(' · ')}. Lo demás está al día.</Aviso>
        )}
        {actualizadoEn && items.length === 0 && fallidas.length === 0 && (
          <Aviso>Nada pendiente: no hay comentarios ni mensajes esperando, ni consejos, objetivos o publicaciones por atender.</Aviso>
        )}
        <ul className="space-y-1.5">
          {visibles.map((i) => <FilaAtencion key={i.clave} i={i} nombre={variasMarcas ? nombre(i.brand_id) : null} onIr={() => irA(i.destino)} />)}
        </ul>
        {items.length > MAX_ITEMS && (
          <button onClick={() => setVerTodos((v) => !v)} className="text-[11px] text-accent hover:underline">
            {verTodos ? 'Ver menos' : `Ver los ${items.length - MAX_ITEMS} restantes`}
          </button>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="titulo text-xl text-zinc-100 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-zinc-400" />Sale hoy</h3>
        {cal.data && hoy.length === 0 && <Aviso>No hay franjas para hoy{plataforma ? ' en esta plataforma' : ''}.</Aviso>}
        <ul className="space-y-1">
          {hoy.map((f) => {
            const e = ESTADO_FRANJA[f.status] ?? { texto: f.status, clase: '' };
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-2 text-[11px] rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2">
                <span className="text-zinc-300 w-12">{new Date(f.slot_at).toLocaleTimeString('es', { timeZone: husos.get(f.brand_id) ?? undefined, hour: '2-digit', minute: '2-digit' })}</span>
                {variasMarcas && <Chip className="text-zinc-200">{nombre(f.brand_id)}</Chip>}
                <Chip>{etiquetaPlataforma(plataformaDeCanal(f.brand_id, f.platform_key))}</Chip>
                {f.format && <Chip>{etiquetaFormato(f.format)}</Chip>}
                <Chip className={e.clase}>{e.texto}</Chip>
                {f.failed_reason && <span className="text-red-300 truncate">{f.failed_reason}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="titulo text-xl text-zinc-100">Publicado en las últimas {ahoraResp.data ? Math.round(ahoraResp.data.minutos / 60) : 24} h</h3>
        {ahoraResp.data && <p className="text-[10px] text-zinc-500">{ahoraResp.data.estado === 'sin_medir' ? 'Sin medir' : 'Sin ordenar'} — {ahoraResp.data.motivo}.</p>}
        {ahoraResp.data && publicadas.length === 0 && <Aviso>No hay publicaciones en la ventana{plataforma ? ' para esta plataforma' : ''}.</Aviso>}
        <ul className="space-y-2">
          {publicadas.map((p) => (
            <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-zinc-500 basis-full sm:basis-auto sm:w-28">{fechaHora(p.published_at, husos.get(p.brand_id))}</span>
              {variasMarcas && <Chip className="text-zinc-200">{nombre(p.brand_id)}</Chip>}
              <Chip>{etiquetaPlataforma(p.platform)}</Chip>
              <Chip>{etiquetaFormato(p.formato)}</Chip>
              <span className="texto-editorial basis-full sm:basis-auto sm:flex-1 min-w-0 truncate text-zinc-400">{p.copy_text ?? ''}</span>
              <PillsDePost id={p.id} platformPostId={p.platform_post_id} metricas={p.metricas} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function FilaAtencion({ i, nombre, onIr }: { i: ItemAtencion; nombre: string | null; onIr: () => void }) {
  const n = NIVEL[i.nivel];
  const ir = i.destino !== 'hoy';
  return (
    <li>
      <button onClick={ir ? onIr : undefined} disabled={!ir}
        className={cn('w-full text-left rounded-lg border px-3 py-2 flex items-start gap-2.5 transition-colors', n.clase,
          ir && 'hover:brightness-125')}>
        <n.icono className="w-4 h-4 mt-0.5 shrink-0" aria-label={n.etiqueta} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-zinc-100">{i.titulo}</span>
            {nombre && <Chip className="text-zinc-300">{nombre}</Chip>}
            {i.platform && <Chip>{etiquetaPlataforma(i.platform)}</Chip>}
            {i.desde && i.destino !== 'calendario' && <span className="text-[10px] text-zinc-500">{haceCuanto(i.desde)}</span>}
          </div>
          {i.detalle && <p className="text-[11px] text-zinc-400 truncate">{i.detalle}</p>}
        </div>
        {ir && <ArrowRight className="w-3.5 h-3.5 mt-1 shrink-0 text-zinc-500" />}
      </button>
    </li>
  );
}
