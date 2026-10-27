import React, { useState } from 'react';
import { BarChart2, Bookmark, Globe, Heart, MessageCircle, MoreHorizontal, Repeat2, Send, Share2, ThumbsUp } from 'lucide-react';
import { maquetaDe, type Proporcion } from '../maqueta';
export { maquetaDe, registrarMaquetas, type FormaMaqueta, type Proporcion, type ReglaMaqueta } from '../maqueta';

/**
 * LA TARJETA COMO LA PUBLICACIÓN EN SU PLATAFORMA (Sam, 2026-10-27: «una simulación real de cada plataforma, que se
 * active en la tarjeta según la plataforma que se proyecte en cada tarjeta, no un botón más»).
 *
 * Qué maqueta usa cada plataforma —y, si hace falta, cada formato— es dato (`intel.platform_previews`) y llega con el
 * catálogo. Aquí sólo están las FORMAS, nombradas por lo que hacen: `feed_imagen`, `feed_texto`, `feed_breve`,
 * `vertical` y `articulo`. Ninguna plataforma se nombra en este archivo. Una plataforma sin maqueta declarada devuelve
 * null y la tarjeta se ve como antes.
 */

export interface DatosMaqueta {
  /** El nombre de la cuenta tal como se ve. */
  cuenta: string;
  imagenes: readonly string[];
  texto: string | null;
  /** La fecha ya formateada en el huso de la marca. */
  fecha: string;
  likes?: number | null;
  comentarios?: number | null;
  /** Al tocar la imagen (p. ej. verla en grande). */
  onImagen?: (src: string) => void;
}

const ESTILO_REAL: React.CSSProperties = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', letterSpacing: 'normal', textTransform: 'none',
};
const PROPORCION: Record<Exclude<Proporcion, 'natural'>, string> = { '1:1': '1 / 1', '4:5': '4 / 5', '9:16': '9 / 16', '16:9': '16 / 9', '1.91:1': '1.91 / 1' };
const num = (n: number | null | undefined) => (n == null ? null : new Intl.NumberFormat('es', { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n));
const inicial = (s: string) => (s.trim()[0] ?? '·').toUpperCase();

function Avatar({ cuenta, tam = 32, anillo = false }: { cuenta: string; tam?: number; anillo?: boolean }) {
  return (
    <span className="shrink-0 rounded-full p-[2px]" style={anillo ? { background: 'linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)' } : undefined}>
      <span className="flex items-center justify-center rounded-full bg-zinc-700 text-white font-semibold border-2 border-black"
        style={{ width: tam, height: tam, fontSize: tam * 0.42 }}>{inicial(cuenta)}</span>
    </span>
  );
}

/** La imagen en su proporción: fija si la regla la fija; si no, la suya, entre 4:5 y 1.91:1 (como los feeds). */
function Medio({ src, aspect, onImagen, className }: { src: string | undefined; aspect: Proporcion; onImagen?: (s: string) => void; className?: string }) {
  const [rota, setRota] = useState(false);
  const [natural, setNatural] = useState<number | null>(null);
  const ratio = aspect === 'natural'
    ? `${Math.min(1.91, Math.max(0.8, natural ?? 1))} / 1`
    : PROPORCION[aspect];
  if (!src || rota) {
    return <div className={`w-full bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-500 ${className ?? ''}`} style={{ aspectRatio: ratio }}>sin imagen</div>;
  }
  return (
    <button type="button" onClick={() => onImagen?.(src)} className={`block w-full ${onImagen ? 'cursor-zoom-in' : 'cursor-default'} ${className ?? ''}`} style={{ aspectRatio: ratio }}>
      <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setRota(true)}
        onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setNatural(i.naturalWidth / i.naturalHeight); }}
        className="w-full h-full object-cover bg-zinc-900" />
    </button>
  );
}

/** Los puntos de un carrusel. */
const Puntos = ({ n, color = 'bg-sky-400' }: { n: number; color?: string }) => n > 1 ? (
  <div className="flex justify-center gap-1 py-1.5" aria-label={`${n} imágenes`}>
    {Array.from({ length: Math.min(n, 10) }, (_, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === 0 ? color : 'bg-zinc-600'}`} />)}
  </div>
) : null;

/** El texto recortado como lo recorta la plataforma: hasta unas líneas y, si sigue, «… más» en gris al final. */
function Recortado({ texto, lineas, mas, prefijo }: { texto: string | null; lineas: number; mas: string; prefijo?: React.ReactNode }) {
  const t = (texto ?? '').trim();
  if (!t && !prefijo) return null;
  const tope = lineas * 42;
  const corto = t.length > tope ? `${t.slice(0, tope).replace(/\s+\S*$/, '').trimEnd()}… ` : null;
  return (
    <p className="text-[12px] @[15rem]:text-[13px] leading-snug whitespace-pre-line break-words">
      {prefijo}{corto ?? t}
      {corto && <span className="text-zinc-400">{mas}</span>}
    </p>
  );
}

function FeedImagen({ d, aspect }: { d: DatosMaqueta; aspect: Proporcion }) {
  return (
    <div className="bg-black text-zinc-100">
      <div className="flex items-center gap-2 px-3 py-2">
        <Avatar cuenta={d.cuenta} anillo />
        <span className="text-[13px] font-semibold truncate flex-1">{d.cuenta}</span>
        <MoreHorizontal className="w-4 h-4 text-zinc-300" />
      </div>
      <Medio src={d.imagenes[0]} aspect={aspect} onImagen={d.onImagen} />
      <div className="px-3 pt-2 pb-3 space-y-1">
        <div className="flex items-center gap-3.5">
          <Heart className="w-[22px] h-[22px]" /><MessageCircle className="w-[22px] h-[22px] -scale-x-100" /><Send className="w-[21px] h-[21px]" />
          <span className="flex-1"><Puntos n={d.imagenes.length} /></span>
          <Bookmark className="w-[22px] h-[22px]" />
        </div>
        {num(d.likes) && <p className="text-[13px] font-semibold">{num(d.likes)} Me gusta</p>}
        <Recortado texto={d.texto} lineas={2} mas="más" prefijo={<span className="font-semibold mr-1">{d.cuenta}</span>} />
        {!!d.comentarios && <p className="text-[13px] text-zinc-400">Ver {d.comentarios === 1 ? 'el comentario' : `los ${num(d.comentarios)} comentarios`}</p>}
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">{d.fecha}</p>
      </div>
    </div>
  );
}

function FeedTexto({ d, aspect }: { d: DatosMaqueta; aspect: Proporcion }) {
  return (
    <div className="bg-[#242526] text-[#e4e6eb]">
      <div className="flex items-center gap-2 px-3 pt-3">
        <Avatar cuenta={d.cuenta} tam={36} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[13px] font-semibold truncate">{d.cuenta}</p>
          <p className="text-[11px] text-[#b0b3b8] flex items-center gap-1 truncate">{d.fecha} · <Globe className="w-3 h-3 shrink-0" /></p>
        </div>
        <MoreHorizontal className="w-5 h-5 text-[#b0b3b8]" />
      </div>
      <div className="px-3 py-2"><Recortado texto={d.texto} lineas={4} mas="Ver más" /></div>
      <Medio src={d.imagenes[0]} aspect={aspect} onImagen={d.onImagen} />
      <Puntos n={d.imagenes.length} color="bg-[#2d88ff]" />
      {(num(d.likes) || num(d.comentarios)) && (
        <div className="flex items-center justify-between px-3 py-1.5 text-[12px] text-[#b0b3b8]">
          <span className="flex items-center gap-1">{num(d.likes) && <><span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#2d88ff]"><ThumbsUp className="w-2.5 h-2.5 text-white" /></span>{num(d.likes)}</>}</span>
          {num(d.comentarios) && <span>{num(d.comentarios)} {d.comentarios === 1 ? 'comentario' : 'comentarios'}</span>}
        </div>
      )}
      <div className="mx-3 border-t border-[#3e4042] grid grid-cols-3 text-[12px] text-[#b0b3b8] font-semibold">
        <span className="flex items-center justify-center gap-1.5 py-2"><ThumbsUp className="w-4 h-4" /><span className="hidden @[17rem]:inline">Me gusta</span></span>
        <span className="flex items-center justify-center gap-1.5 py-2"><MessageCircle className="w-4 h-4" /><span className="hidden @[17rem]:inline">Comentar</span></span>
        <span className="flex items-center justify-center gap-1.5 py-2"><Share2 className="w-4 h-4" /><span className="hidden @[17rem]:inline">Compartir</span></span>
      </div>
    </div>
  );
}

function FeedBreve({ d, aspect }: { d: DatosMaqueta; aspect: Proporcion }) {
  return (
    <div className="bg-black text-[#e7e9ea] flex gap-2.5 px-3 py-3">
      <Avatar cuenta={d.cuenta} tam={36} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-[13px] truncate"><span className="font-bold">{d.cuenta}</span> <span className="text-[#71767b]">· {d.fecha}</span></p>
        <Recortado texto={d.texto} lineas={6} mas="Mostrar más" />
        {d.imagenes[0] && <div className="rounded-2xl overflow-hidden border border-[#2f3336]"><Medio src={d.imagenes[0]} aspect={aspect} onImagen={d.onImagen} /></div>}
        <div className="flex justify-between text-[#71767b] text-[12px] pr-6">
          <span className="flex items-center gap-1"><MessageCircle className="w-4 h-4" />{num(d.comentarios) ?? ''}</span>
          <Repeat2 className="w-4 h-4" />
          <span className="flex items-center gap-1"><Heart className="w-4 h-4" />{num(d.likes) ?? ''}</span>
          <BarChart2 className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

function Vertical({ d }: { d: DatosMaqueta }) {
  return (
    <div className="relative bg-black text-white overflow-hidden" style={{ aspectRatio: '9 / 16' }}>
      <div className="absolute inset-0"><Medio src={d.imagenes[0]} aspect="9:16" onImagen={d.onImagen} className="h-full" /></div>
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent pointer-events-none" />
      <div className="absolute right-1.5 bottom-14 flex flex-col items-center gap-2 @[14rem]:gap-3 text-[10px] @[14rem]:text-[11px] font-semibold drop-shadow">
        <Avatar cuenta={d.cuenta} tam={34} />
        <span className="flex flex-col items-center"><Heart className="w-5 h-5 @[14rem]:w-7 @[14rem]:h-7 fill-white/10" />{num(d.likes) ?? ''}</span>
        <span className="flex flex-col items-center"><MessageCircle className="w-5 h-5 @[14rem]:w-7 @[14rem]:h-7" />{num(d.comentarios) ?? ''}</span>
        <Bookmark className="w-5 h-5 @[14rem]:w-6 @[14rem]:h-6" />
        <Share2 className="w-5 h-5 @[14rem]:w-6 @[14rem]:h-6" />
      </div>
      <div className="absolute left-2.5 right-10 @[14rem]:right-14 bottom-3 space-y-1 pointer-events-none">
        <p className="text-[13px] font-semibold drop-shadow">{d.cuenta}</p>
        <Recortado texto={d.texto} lineas={2} mas="más" />
      </div>
    </div>
  );
}

function Articulo({ d, aspect }: { d: DatosMaqueta; aspect: Proporcion }) {
  const lineas = (d.texto ?? '').split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).filter(Boolean);
  return (
    <div className="bg-[#1d2226] text-[#e9e9e9]">
      <Medio src={d.imagenes[0]} aspect={aspect} onImagen={d.onImagen} />
      <div className="px-3 py-2.5 space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-[#a8a8a8]">{d.cuenta} · {d.fecha}</p>
        <p className="text-[15px] font-semibold leading-snug" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{lineas[0] ?? ''}</p>
        {lineas[1] && <p className="text-[12px] text-[#a8a8a8]" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{lineas.slice(1).join(' ')}</p>}
      </div>
    </div>
  );
}

/** La maqueta de la publicación, o null si su plataforma no tiene una declarada. */
export function Maqueta({ platform, formato, datos, className }: { platform: string; formato?: string | null; datos: DatosMaqueta; className?: string }) {
  const m = maquetaDe(platform, formato);
  if (!m) return null;
  const cuerpo = m.layout === 'feed_imagen' ? <FeedImagen d={datos} aspect={m.aspect} />
    : m.layout === 'feed_texto' ? <FeedTexto d={datos} aspect={m.aspect} />
    : m.layout === 'feed_breve' ? <FeedBreve d={datos} aspect={m.aspect} />
    : m.layout === 'vertical' ? <Vertical d={datos} />
    : <Articulo d={datos} aspect={m.aspect} />;
  // `@container`: la maqueta se adapta a SU ancho (una tarjeta de dos columnas en el teléfono es estrecha).
  return <div className={`@container overflow-hidden ${className ?? ''}`} style={ESTILO_REAL} data-maqueta={m.layout}>{cuerpo}</div>;
}
