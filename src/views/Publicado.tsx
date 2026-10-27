import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, LayoutGrid, MessageCircle, RefreshCw, Radio, Square } from 'lucide-react';
import { ops, ErrorApi, type Marca, type RespPublicado, type EnVivo, type Publicada } from '../api';
import { Aviso, Cargando, Chip, ChipPlataforma, ChevronAsesor, VistaPrevia, bordeDePlataforma, cn, etiquetaFormato, etiquetaPlataforma, fechaHora } from '../ui/components';
import { PillsDePost, usePulso } from '../ui/Pulso';
import { Maqueta, maquetaDe } from '../ui/Maqueta';

/** Cada cuánto se vuelve a leer el registro y las métricas de SignalLab (sólo base: barato). */
const REFRESCO_REGISTRO_MS = 60_000;

const DIA = 86_400_000;
const isoDia = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * PUBLICADO. La fuente de la verdad del conteo es el registro (`scheduled_posts`, status='published').
 * Cada tarjeta se cruza con la lectura EN VIVO de la plataforma por `platform_post_id`: la imagen y el
 * enlace salen de ahí cuando la plataforma la devuelve. Lo que la plataforma muestra y el registro no
 * tiene se lista aparte, «fuera del carril».
 *
 * DESDE CADA TARJETA (Sam, 2026-10-26): «Comentarios» abre la bandeja filtrada a esa publicación, «Acciones» abre los
 * consejos del asesor sobre ella (donde se piden más) y el chevron pide consejo en el acto. La imagen se abre en grande.
 */
export default function Publicado({ token, marca, plataforma, marcas }: { token: string; marca: string; plataforma: string; marcas: Marca[] }) {
  const [desde, setDesde] = useState(isoDia(Date.now() - 7 * DIA));
  const [hasta, setHasta] = useState(isoDia(Date.now() + DIA));
  // En el teléfono: 2 columnas (tarjeta compacta) o 1 (tarjeta completa). Se recuerda en este navegador.
  const [columnas, setColumnas] = useState<1 | 2>(() => { try { return localStorage.getItem('sociallab.columnas') === '1' ? 1 : 2; } catch { return 2; } });
  useEffect(() => { try { localStorage.setItem('sociallab.columnas', String(columnas)); } catch { /* sin almacenamiento */ } }, [columnas]);
  const [formato, setFormato] = useState('');
  const [reg, setReg] = useState<RespPublicado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [tickRegistro, setTickRegistro] = useState(0);
  // La lectura en vivo es del tablero entero (`ProveedorPulso`): una sola para todas las pestañas.
  const { vivo, errorVivo, cargandoVivo, vivoPorId: porId, recargar: recargarVivo } = usePulso();
  const [leidoEn, setLeidoEn] = useState<number | null>(null);

  // Refresco automático del registro (con las métricas de SignalLab) cada minuto. La plataforma se
  // relee en `ProveedorPulso`. Una pill sólo celebra cuando su valor cambia entre dos lecturas.
  useEffect(() => {
    const a = setInterval(() => setTickRegistro((n) => n + 1), REFRESCO_REGISTRO_MS);
    return () => clearInterval(a);
  }, []);

  const huso = (b: string) => marcas.find((m) => m.brand_id === b)?.huso ?? null;
  const nombre = (b: string) => marcas.find((m) => m.brand_id === b)?.nombre ?? b;

  useEffect(() => {
    let vivoAqui = true;
    setCargando(true);
    ops<RespPublicado>(token, 'publicado', {
      marca: marca || undefined, plataforma: plataforma || undefined, formato: formato || undefined,
      desde: new Date(`${desde}T00:00:00`).toISOString(), hasta: new Date(`${hasta}T00:00:00`).toISOString(),
    }).then((r) => { if (vivoAqui) { setReg(r); setError(null); setLeidoEn(Date.now()); } })
      .catch((e) => vivoAqui && setError(e.message)).finally(() => vivoAqui && setCargando(false));
    return () => { vivoAqui = false; };
  }, [token, marca, plataforma, formato, desde, hasta, recarga, tickRegistro]);

  const fueraDelCarril = useMemo(() => {
    const d = Date.parse(`${desde}T00:00:00`), h = Date.parse(`${hasta}T00:00:00`);
    return (vivo?.publicaciones ?? []).filter((v) => !v.en_carril
      && (!plataforma || v.platform === plataforma)
      && (!v.publicado_en || (Date.parse(v.publicado_en) >= d && Date.parse(v.publicado_en) < h)));
  }, [vivo, plataforma, desde, hasta]);

  const formatos = useMemo(() => [...new Set((reg?.conteos ?? []).map((c) => c.formato))].sort(), [reg]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-3">
        <Campo etiqueta="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="entrada" /></Campo>
        <Campo etiqueta="Hasta (excluido)"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="entrada" /></Campo>
        <Campo etiqueta="Formato">
          <select value={formato} onChange={(e) => setFormato(e.target.value)} className="entrada">
            <option value="">Todos</option>
            {[...new Set([...formatos, formato].filter(Boolean))].map((f) => <option key={f} value={f}>{etiquetaFormato(f)}</option>)}
          </select>
        </Campo>
        <div className="sm:hidden flex items-end gap-1" role="group" aria-label="Columnas">
          {([2, 1] as const).map((n) => (
            <button key={n} onClick={() => setColumnas(n)} aria-pressed={columnas === n} title={n === 2 ? 'Grid de 2 columnas' : '1 columna'}
              className={cn('flex-1 flex items-center justify-center py-2.5 rounded-lg border',
                columnas === n ? 'bg-accent/10 text-accent border-accent/50' : 'border-zinc-800 text-zinc-500')}>
              {n === 2 ? <LayoutGrid className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            </button>
          ))}
        </div>
        <button onClick={() => { setRecarga((n) => n + 1); recargarVivo(); }} className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700">
          <RefreshCw className="w-3.5 h-3.5" /> Actualizar
        </button>
      </div>

      {error && <Aviso tono="error">No se pudo leer el registro: {error}</Aviso>}
      {errorVivo && <Aviso tono="error">No se pudo leer las plataformas en vivo: {errorVivo}</Aviso>}
      {vivo?.lecturas.filter((l) => l.error).map((l) => (
        <Aviso key={`${l.brand_id}-${l.platform}`} tono="error">
          Lectura en vivo de {nombre(l.brand_id)} · {etiquetaPlataforma(l.platform)} falló: {l.error}
        </Aviso>
      ))}

      {cargando && !reg ? <Cargando /> : reg && (
        <>
          <Conteos reg={reg} nombre={nombre} />
          {reg.truncado && <Aviso tono="error">La ventana tiene más filas de las que se muestran: acota las fechas.</Aviso>}
          {reg.metricas === 'tabla_inexistente' && (
            <Aviso>Métricas: <b>sin medir</b>. SignalLab todavía no escribe instantáneas (content.post_metric_snapshots no existe).</Aviso>
          )}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
            <Radio className={cn('w-3.5 h-3.5', cargandoVivo ? 'animate-pulse text-amber-400' : 'text-emerald-400')} />
            {cargandoVivo ? 'Leyendo las plataformas…'
              : vivo ? <span>En vivo: {vivo.publicaciones.length} publicaciones recientes.<span className="hidden sm:inline"> Hasta {vivo.limite} por cuenta. Me gusta y comentarios: cada minuto las cuentas que publicaron en los últimos 7 días, las demás cada 10 min (con la pestaña visible). Las demás métricas, al ritmo de SignalLab.</span></span> : 'Sin lectura en vivo.'}
            {leidoEn && <span className="sm:ml-auto text-zinc-600">tablero actualizado {new Date(leidoEn).toLocaleTimeString('es')} · cada 60 s</span>}
          </div>
          <Rejilla columnas={columnas}>
            {reg.publicaciones.map((p) => <Tarjeta compacta={columnas === 2} key={`${p.via ?? 'carril'}-${p.id}`} p={p} vivo={p.platform_post_id ? porId.get(p.platform_post_id) : undefined}
              leidoEnVivo={!!vivo && vivo.lecturas.some((l) => l.brand_id === p.brand_id && l.platform === p.platform && !l.error)}
              nombre={nombre(p.brand_id)} huso={huso(p.brand_id)} />)}
          </Rejilla>
          {reg.publicaciones.length === 0 && <Aviso>No hay publicaciones registradas en esta ventana.</Aviso>}
        </>
      )}

      {fueraDelCarril.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-300">En la plataforma, fuera del carril <span className="text-zinc-500 font-normal">({fueraDelCarril.length})</span></h3>
          <p className="text-[11px] text-zinc-500">Publicadas en la cuenta de la marca sin fila en el registro: manuales o de otra vía. No entran en los conteos.</p>
          <Rejilla columnas={columnas}>{fueraDelCarril.map((v) => <TarjetaVivo key={v.platform_post_id} v={v} nombre={nombre(v.brand_id)} huso={huso(v.brand_id)} />)}</Rejilla>
        </section>
      )}
    </div>
  );
}

const Campo = ({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 min-w-0 text-[10px] uppercase tracking-wider text-zinc-500">{etiqueta}{children}</label>
);

const Rejilla = ({ children, columnas = 1 }: { children: React.ReactNode; columnas?: 1 | 2 }) => (
  <div className={cn('grid sm:gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', columnas === 2 ? 'grid-cols-2 gap-2' : 'grid-cols-1 gap-3')}>{children}</div>
);

function Conteos({ reg, nombre }: { reg: RespPublicado; nombre: (b: string) => string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-xs text-zinc-400 mb-2"><b className="titulo text-accent text-2xl mr-1">{reg.total}</b> publicadas en la ventana</div>
      <div className="flex flex-wrap gap-2">
        {reg.conteos.map((c) => (
          <span key={`${c.brand_id}-${c.platform}-${c.formato}`} className="text-[11px] px-2 py-1 rounded-md bg-zinc-800/80 text-zinc-300">
            {nombre(c.brand_id)} · {etiquetaPlataforma(c.platform)} · {etiquetaFormato(c.formato)} <b className="text-accent">{c.total}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Imagen({ src }: { src: string | null }) {
  const [rota, setRota] = useState(false);
  const [abierta, setAbierta] = useState(false);
  if (!src || rota) return <div className="aspect-square bg-zinc-900 flex items-center justify-center text-[10px] text-zinc-600">sin imagen</div>;
  return (
    <>
      <button type="button" onClick={() => setAbierta(true)} title="Ver en grande" className="block w-full cursor-zoom-in">
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setRota(true)} className="aspect-square w-full object-cover bg-zinc-900" />
      </button>
      {abierta && <VistaPrevia src={src} onCerrar={() => setAbierta(false)} />}
    </>
  );
}

/** Los botones de una publicación del carril: a sus comentarios, a sus consejos y pedir consejo ya. */
function AccionesDePublicacion({ p, compacta }: { p: Publicada; compacta: boolean }) {
  const { atender, abrirAsesor, pedirConsejo, pedidoPorPublicacion, pendientesPorPost } = usePulso();
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pedido = pedidoPorPublicacion.get(p.id);
  const esperan = pendientesPorPost.get(p.id) ?? 0;
  const pedir = async () => {
    setPidiendo(true); setError(null);
    try { await pedirConsejo(p.brand_id, undefined, p.id); }
    catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); }
    finally { setPidiendo(false); }
  };
  const boton = 'flex items-center justify-center gap-1 rounded-lg text-[11px] font-bold disabled:opacity-40';
  return (
    <div className="space-y-1">
      <div className={cn('grid gap-1.5', compacta ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3')}>
        <button onClick={() => atender(p.id)} title="Los comentarios de esta publicación" aria-label={`Comentarios${esperan ? `, ${esperan} esperan` : ''}`}
          className={cn(boton, 'px-2 py-2 bg-zinc-800 text-zinc-200 hover:bg-zinc-700')}>
          <MessageCircle className="w-3.5 h-3.5 shrink-0" /> <span className={cn(compacta && 'max-sm:hidden')}>Comentarios</span>
          {esperan ? <span className="px-1 rounded bg-amber-500/20 text-amber-300 tabular-nums" title={`${esperan} esperan respuesta`}>{esperan}</span> : null}
        </button>
        <button onClick={() => abrirAsesor({ post: p.id })} title="Los consejos del asesor sobre esta publicación"
          className={cn(boton, 'px-2 py-2 bg-zinc-800 text-zinc-200 hover:bg-zinc-700')}>
          Acciones
        </button>
        <button onClick={pedir} disabled={pidiendo || pedido === 'pendiente'} title="Pedir consejo al asesor sobre esta publicación"
          className={cn(boton, 'px-2 py-2 border border-accent/40 text-accent hover:bg-accent/10', compacta && 'col-span-2 sm:col-span-1')}>
          <ChevronAsesor className="w-3.5 h-3.5" /> {pedido === 'pendiente' ? 'Pedido' : pidiendo ? 'Pidiendo…' : 'Consejo'}
        </button>
      </div>
      {pedido === 'pendiente' && <p className="text-[10px] text-accent">Consejo pedido: aparece en Acciones en unos minutos.</p>}
      {error && <p className="text-[10px] text-red-300">{error}</p>}
    </div>
  );
}

/** `compacta`: en el grid de 2 columnas del teléfono sólo queda lo esencial (imagen, marca, plataforma, fecha y pills). */
function Tarjeta({ p, vivo, leidoEnVivo, nombre, huso, compacta = false }: {
  p: Publicada; vivo?: EnVivo; leidoEnVivo: boolean; nombre: string; huso: string | null; compacta?: boolean;
}) {
  const oculta = compacta ? 'max-sm:hidden' : '';
  const enlace = vivo?.permalink ?? p.enlace ?? null;
  const imagen = vivo?.imagen ?? p.image_url ?? p.media_urls?.[0] ?? null;
  const texto = vivo?.texto ?? p.copy_text ?? '';
  // La tarjeta se dibuja como la publicación en su plataforma, si su plataforma tiene maqueta (Sam, 2026-10-27).
  const conMaqueta = !!maquetaDe(p.platform, p.formato);
  const [vista, setVista] = useState<string | null>(null);
  const contador = (m: string) => vivo?.contadores.find((c) => c.metric === m)?.value ?? null;
  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden flex flex-col" style={bordeDePlataforma(p.platform)}>
      {conMaqueta ? (
        <>
          <Maqueta platform={p.platform} formato={p.formato} datos={{
            cuenta: nombre, imagenes: [...new Set([imagen, ...(p.media_urls ?? [])].filter((x): x is string => !!x))], texto,
            fecha: fechaHora(p.published_at, huso), likes: contador('likes'), comentarios: contador('comments'), onImagen: setVista,
          }} />
          {vista && <VistaPrevia src={vista} onCerrar={() => setVista(null)} />}
        </>
      ) : <Imagen src={imagen} />}
      <div className={cn('space-y-2 flex-1 flex flex-col', compacta ? 'p-2 sm:p-3' : 'p-3')}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip className="text-zinc-200">{nombre}</Chip>
          <ChipPlataforma platform={p.platform} />
          <Chip className={oculta}>{etiquetaFormato(p.formato)}</Chip>
          {p.via === 'manual' ? <Chip className="bg-sky-500/10 text-sky-300">manual</Chip>
            : p.via === 'externa' ? <Chip className="bg-violet-500/10 text-violet-300">externa</Chip>
            : p.via === 'detectada' ? <Chip className="bg-orange-500/10 text-orange-300" >detectada fuera del sistema</Chip>
            : p.via === 'sin_canal' ? <Chip className="bg-red-500/10 text-red-300">sin canal</Chip>
            : vivo ? <Chip className="bg-emerald-500/10 text-emerald-300">en vivo</Chip>
            : leidoEnVivo ? <Chip className="bg-amber-500/10 text-amber-300" >no está en la lectura reciente</Chip> : null}
        </div>
        {!conMaqueta && <div className="text-[11px] text-zinc-500">{fechaHora(p.published_at, huso)}</div>}
        {!conMaqueta && <p className={cn('texto-editorial text-xs text-zinc-300 line-clamp-3 whitespace-pre-line flex-1', oculta)}>{texto}</p>}
        {conMaqueta && <div className="flex-1" />}
        <PillsDePost id={p.id} platformPostId={p.platform_post_id} metricas={p.metricas}
          sinMedir={p.via === 'manual' || p.via === 'externa' ? `sin lector de métricas (publicación ${p.via})` : 'sin medir'} />
        {/* Con id en la plataforma: sin él no hay comentarios que leer ni consejo que pedir. */}
        {p.platform_post_id && <AccionesDePublicacion p={p} compacta={compacta} />}
        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-600">
          <span title="piece_id" className={cn('truncate', oculta)}>{p.piece_id ?? 'sin piece_id'}</span>
          {enlace && <a href={enlace} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline">Ver <ExternalLink className="w-3 h-3" /></a>}
        </div>
      </div>
    </article>
  );
}

function TarjetaVivo({ v, nombre, huso }: { v: EnVivo; nombre: string; huso: string | null }) {
  const conMaqueta = !!maquetaDe(v.platform, v.formato);
  const [vista, setVista] = useState<string | null>(null);
  const contador = (m: string) => v.contadores.find((c) => c.metric === m)?.value ?? null;
  return (
    <article className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/20 overflow-hidden flex flex-col" style={bordeDePlataforma(v.platform)}>
      {conMaqueta ? (
        <>
          <Maqueta platform={v.platform} formato={v.formato} datos={{
            cuenta: nombre, imagenes: v.imagen ? [v.imagen] : [], texto: v.texto, fecha: fechaHora(v.publicado_en, huso),
            likes: contador('likes'), comentarios: contador('comments'), onImagen: setVista,
          }} />
          {vista && <VistaPrevia src={vista} onCerrar={() => setVista(null)} />}
        </>
      ) : <Imagen src={v.imagen} />}
      <div className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip className="text-zinc-200">{nombre}</Chip>
          <ChipPlataforma platform={v.platform} />
          {v.formato && <Chip>{etiquetaFormato(v.formato)}</Chip>}
        </div>
        {!conMaqueta && <div className="text-[11px] text-zinc-500">{fechaHora(v.publicado_en, huso)}</div>}
        {!conMaqueta && <p className="text-xs text-zinc-400 line-clamp-3 whitespace-pre-line">{v.texto ?? ''}</p>}
        {v.permalink && <a href={v.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-mono text-accent hover:underline">Ver <ExternalLink className="w-3 h-3" /></a>}
      </div>
    </article>
  );
}
