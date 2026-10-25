import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, Radio } from 'lucide-react';
import { ops, type Marca, type RespPublicado, type RespEnVivo, type EnVivo, type Publicada } from '../api';
import { Aviso, Cargando, Chip, cn, etiquetaFormato, etiquetaPlataforma, fechaHora } from '../ui/components';
import { Pills } from '../ui/Pills';

/** Cada cuánto se vuelve a leer el registro y las métricas (sólo base: barato). */
const REFRESCO_REGISTRO_MS = 60_000;
/** Cada cuánto se vuelve a leer la plataforma en vivo (gasta llamadas a Graph: más espaciado). */
const REFRESCO_EN_VIVO_MS = 5 * 60_000;

const DIA = 86_400_000;
const isoDia = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * PUBLICADO. La fuente de la verdad del conteo es el registro (`scheduled_posts`, status='published').
 * Cada tarjeta se cruza con la lectura EN VIVO de la plataforma por `platform_post_id`: la imagen y el
 * enlace salen de ahí cuando la plataforma la devuelve. Lo que la plataforma muestra y el registro no
 * tiene se lista aparte, «fuera del carril».
 */
export default function Publicado({ token, marca, marcas }: { token: string; marca: string; marcas: Marca[] }) {
  const [desde, setDesde] = useState(isoDia(Date.now() - 7 * DIA));
  const [hasta, setHasta] = useState(isoDia(Date.now() + DIA));
  const [plataforma, setPlataforma] = useState('');
  const [formato, setFormato] = useState('');
  const [reg, setReg] = useState<RespPublicado | null>(null);
  const [vivo, setVivo] = useState<RespEnVivo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorVivo, setErrorVivo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [cargandoVivo, setCargandoVivo] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [tickRegistro, setTickRegistro] = useState(0);
  const [tickVivo, setTickVivo] = useState(0);
  const [leidoEn, setLeidoEn] = useState<number | null>(null);

  // Refresco automático: el registro (con las métricas de SignalLab) cada minuto; la plataforma, cada 5.
  // Una pill sólo celebra cuando su valor cambia entre dos lecturas.
  useEffect(() => {
    const a = setInterval(() => setTickRegistro((n) => n + 1), REFRESCO_REGISTRO_MS);
    const b = setInterval(() => setTickVivo((n) => n + 1), REFRESCO_EN_VIVO_MS);
    return () => { clearInterval(a); clearInterval(b); };
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

  useEffect(() => {
    let vivoAqui = true;
    setCargandoVivo(true);
    ops<RespEnVivo>(token, 'envivo', { marca: marca || undefined, limite: '50' })
      .then((r) => { if (vivoAqui) { setVivo(r); setErrorVivo(null); } })
      .catch((e) => vivoAqui && setErrorVivo(e.message)).finally(() => vivoAqui && setCargandoVivo(false));
    return () => { vivoAqui = false; };
  }, [token, marca, recarga, tickVivo]);

  const porId = useMemo(() => new Map((vivo?.publicaciones ?? []).map((v) => [v.platform_post_id, v])), [vivo]);
  const fueraDelCarril = useMemo(() => {
    const d = Date.parse(`${desde}T00:00:00`), h = Date.parse(`${hasta}T00:00:00`);
    return (vivo?.publicaciones ?? []).filter((v) => !v.en_carril
      && (!plataforma || v.platform === plataforma)
      && (!v.publicado_en || (Date.parse(v.publicado_en) >= d && Date.parse(v.publicado_en) < h)));
  }, [vivo, plataforma, desde, hasta]);

  const plataformas = useMemo(() => [...new Set([...(reg?.conteos ?? []).map((c) => c.platform), ...marcas.flatMap((m) => m.plataformas_en_vivo)])].sort(), [reg, marcas]);
  const formatos = useMemo(() => [...new Set((reg?.conteos ?? []).map((c) => c.formato))].sort(), [reg]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="entrada" /></Campo>
        <Campo etiqueta="Hasta (excluido)"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="entrada" /></Campo>
        <Campo etiqueta="Plataforma">
          <select value={plataforma} onChange={(e) => setPlataforma(e.target.value)} className="entrada">
            <option value="">Todas</option>
            {plataformas.map((p) => <option key={p} value={p}>{etiquetaPlataforma(p)}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Formato">
          <select value={formato} onChange={(e) => setFormato(e.target.value)} className="entrada">
            <option value="">Todos</option>
            {[...new Set([...formatos, formato].filter(Boolean))].map((f) => <option key={f} value={f}>{etiquetaFormato(f)}</option>)}
          </select>
        </Campo>
        <button onClick={() => setRecarga((n) => n + 1)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700">
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
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <Radio className={cn('w-3.5 h-3.5', cargandoVivo ? 'animate-pulse text-amber-400' : 'text-emerald-400')} />
            {cargandoVivo ? 'Leyendo las plataformas…'
              : vivo ? `En vivo: ${vivo.publicaciones.length} publicaciones recientes leídas de las plataformas (hasta ${vivo.limite} por cuenta; se relee cada 5 min).` : 'Sin lectura en vivo.'}
            {leidoEn && <span className="ml-auto font-mono text-zinc-600">métricas releídas {new Date(leidoEn).toLocaleTimeString('es')} · cada 60 s</span>}
          </div>
          <Rejilla>
            {reg.publicaciones.map((p) => <Tarjeta key={`${p.via ?? 'carril'}-${p.id}`} p={p} vivo={p.platform_post_id ? porId.get(p.platform_post_id) : undefined}
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
          <Rejilla>{fueraDelCarril.map((v) => <TarjetaVivo key={v.platform_post_id} v={v} nombre={nombre(v.brand_id)} huso={huso(v.brand_id)} />)}</Rejilla>
        </section>
      )}
    </div>
  );
}

const Campo = ({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-zinc-500">{etiqueta}{children}</label>
);

const Rejilla = ({ children }: { children: React.ReactNode }) => (
  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>
);

function Conteos({ reg, nombre }: { reg: RespPublicado; nombre: (b: string) => string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-xs text-zinc-400 mb-2"><b className="text-zinc-100 text-base">{reg.total}</b> publicadas en la ventana</div>
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
  if (!src || rota) return <div className="aspect-square bg-zinc-900 flex items-center justify-center text-[10px] text-zinc-600">sin imagen</div>;
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setRota(true)} className="aspect-square w-full object-cover bg-zinc-900" />;
}

function Tarjeta({ p, vivo, leidoEnVivo, nombre, huso }: { p: Publicada; vivo?: EnVivo; leidoEnVivo: boolean; nombre: string; huso: string | null }) {
  const enlace = vivo?.permalink ?? p.enlace ?? null;
  const imagen = vivo?.imagen ?? p.image_url ?? p.media_urls?.[0] ?? null;
  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden flex flex-col">
      <Imagen src={imagen} />
      <div className="p-3 space-y-2 flex-1 flex flex-col">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip className="text-zinc-200">{nombre}</Chip>
          <Chip>{etiquetaPlataforma(p.platform)}</Chip>
          <Chip>{etiquetaFormato(p.formato)}</Chip>
          {p.via === 'manual' ? <Chip className="bg-sky-500/10 text-sky-300">manual</Chip>
            : p.via === 'externa' ? <Chip className="bg-violet-500/10 text-violet-300">externa</Chip>
            : p.via === 'detectada' ? <Chip className="bg-orange-500/10 text-orange-300" >detectada fuera del sistema</Chip>
            : p.via === 'sin_canal' ? <Chip className="bg-red-500/10 text-red-300">sin canal</Chip>
            : vivo ? <Chip className="bg-emerald-500/10 text-emerald-300">en vivo</Chip>
            : leidoEnVivo ? <Chip className="bg-amber-500/10 text-amber-300" >no está en la lectura reciente</Chip> : null}
        </div>
        <div className="text-[11px] text-zinc-500">{fechaHora(p.published_at, huso)}</div>
        <p className="text-xs text-zinc-300 line-clamp-3 whitespace-pre-line flex-1">{vivo?.texto ?? p.copy_text ?? ''}</p>
        <Pills metricas={p.metricas} sinMedir={p.via === 'manual' || p.via === 'externa' ? `sin lector de métricas (publicación ${p.via})` : 'sin medir'} />
        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-600">
          <span title="piece_id">{p.piece_id ?? 'sin piece_id'}</span>
          {enlace && <a href={enlace} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline">Ver <ExternalLink className="w-3 h-3" /></a>}
        </div>
      </div>
    </article>
  );
}

function TarjetaVivo({ v, nombre, huso }: { v: EnVivo; nombre: string; huso: string | null }) {
  return (
    <article className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/20 overflow-hidden flex flex-col">
      <Imagen src={v.imagen} />
      <div className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip className="text-zinc-200">{nombre}</Chip>
          <Chip>{etiquetaPlataforma(v.platform)}</Chip>
          {v.formato && <Chip>{etiquetaFormato(v.formato)}</Chip>}
        </div>
        <div className="text-[11px] text-zinc-500">{fechaHora(v.publicado_en, huso)}</div>
        <p className="text-xs text-zinc-400 line-clamp-3 whitespace-pre-line">{v.texto ?? ''}</p>
        {v.permalink && <a href={v.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-mono text-accent hover:underline">Ver <ExternalLink className="w-3 h-3" /></a>}
      </div>
    </article>
  );
}
