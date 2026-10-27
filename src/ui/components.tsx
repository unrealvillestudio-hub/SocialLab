import React, { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Etiqueta de un formato. Un valor sin etiqueta se muestra tal cual: un formato nuevo no se esconde. */
const ETIQUETA_FORMATO: Record<string, string> = {
  SINGLE_IMAGE: 'Una imagen', CAROUSEL: 'Carrusel', VIDEO: 'Video', REELS: 'Reel', POST: 'Post', ARTICLE: 'Artículo',
};
export const etiquetaFormato = (f: string) => ETIQUETA_FORMATO[f] ?? (f || 'sin formato');
export const etiquetaPlataforma = (p: string) => (p ? p.charAt(0) + p.slice(1).toLowerCase() : p);

/**
 * EL COLOR DE CADA PLATAFORMA (Sam, 2026-10-26: «diferenciación visual para cada plataforma, para no confundir al
 * operador»). El color es dato (`intel.signal_platforms.display_color`) y llega con el catálogo; aquí no se nombra
 * ninguna plataforma. Sin color, neutro.
 */
const COLORES = new Map<string, string>();
export function registrarColoresDePlataforma(xs: readonly { platform: string; color: string | null }[] | undefined): void {
  COLORES.clear();
  for (const x of xs ?? []) if (x.color && /^#[0-9a-f]{6}$/i.test(x.color)) COLORES.set(x.platform, x.color);
}
export const colorDePlataforma = (p: string | null | undefined): string | null => (p ? COLORES.get(p) ?? null : null);
/** `#rrggbb` + alfa (0–1) → `rgba(...)`. */
export function conAlfa(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
/** El borde izquierdo de una tarjeta, en el color de su plataforma. */
export const bordeDePlataforma = (p: string | null | undefined): React.CSSProperties => {
  const c = colorDePlataforma(p);
  return c ? { borderLeftColor: c, borderLeftWidth: 3 } : {};
};

/** El chip de la plataforma: su nombre sobre su color, con un punto para que se distinga también sin color de fondo. */
export function ChipPlataforma({ platform, className }: { platform: string; className?: string }) {
  const c = colorDePlataforma(platform);
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide bg-zinc-800 text-zinc-300', className)}
      style={c ? { backgroundColor: conAlfa(c, 0.18), color: '#F2F0EC', boxShadow: `inset 0 0 0 1px ${conAlfa(c, 0.55)}` } : undefined}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c ?? '#71717a' }} aria-hidden />
      {etiquetaPlataforma(platform)}
    </span>
  );
}

/**
 * VISTA PREVIA DE UNA IMAGEN (Sam, 2026-10-26): la miniatura se abre en grande al tocarla; se cierra con la X, tocando
 * fuera o con Escape.
 */
export function VistaPrevia({ src, onCerrar }: { src: string; onCerrar: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Vista previa" onClick={onCerrar}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
      <img src={src} alt="" referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full rounded-lg object-contain shadow-2xl" />
      <button onClick={onCerrar} aria-label="Cerrar" className="absolute top-3 right-3 p-2 rounded-full bg-zinc-900/90 text-zinc-200 hover:bg-zinc-800">
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

/** Una miniatura que abre su vista previa. `className` es el de la imagen. */
export function Miniatura({ src, className }: { src: string; className?: string }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAbierta(true); }} title="Ver en grande"
        className="shrink-0 cursor-zoom-in">
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className={className} />
      </button>
      {abierta && <VistaPrevia src={src} onCerrar={() => setAbierta(false)} />}
    </>
  );
}

/** Fecha y hora en el huso de la marca; sin huso declarado, en el del navegador (y se dice). */
export function fechaHora(iso: string | null | undefined, huso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  try {
    return d.toLocaleString('es', { timeZone: huso ?? undefined, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      + (huso ? '' : ' (hora local)');
  } catch {
    return d.toISOString();
  }
}

export const Chip = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide bg-zinc-800 text-zinc-400', className)}>
    {children}
  </span>
);

export const Aviso = ({ children, tono = 'info' }: { children: React.ReactNode; tono?: 'info' | 'error' }) => (
  <div className={cn('rounded-lg border px-3 py-2 text-xs',
    tono === 'error' ? 'border-red-500/30 bg-red-500/5 text-red-300' : 'border-zinc-800 bg-zinc-900/60 text-zinc-400')}>
    {children}
  </div>
);

/**
 * El icono del asesor: el chevron «>» de Unrealville, cian y parpadeando como en el logotipo (Sam, 2026-10-26).
 * Se dimensiona como un icono de lucide (`w-4 h-4`…): el glifo llena el alto de su caja.
 */
export const ChevronAsesor = ({ className }: { className?: string }) => (
  <span className={cn('chevron-asesor', className)} aria-hidden><span className="lt-chevron">&gt;</span></span>
);

export const Cargando = () => <div className="text-xs text-zinc-500 animate-pulse">Cargando…</div>;

/** La intención de un comentario o de un mensaje, en su color (dato del catálogo). La de reserva no se pinta: no dice nada. */
export function ChipIntencion({ i }: { i: { label: string; display_color: string | null } }) {
  const c = i.display_color && /^#[0-9a-f]{6}$/i.test(i.display_color) ? i.display_color : null;
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-200"
      style={c ? { backgroundColor: conAlfa(c, 0.18), color: '#F2F0EC', boxShadow: `inset 0 0 0 1px ${conAlfa(c, 0.6)}` } : undefined}
      title="Intención del comentario: la bandeja pone primero las de mayor prioridad">
      {i.label}
    </span>
  );
}

/**
 * «Actualizar» de una bandeja (Sam, 2026-10-26: «el botón de Actualizar no ejecuta nada»). Relee la base al instante y
 * lo dice: gira mientras lee. Lo nuevo de la plataforma llega con la lectura de SignalLab, que `EstadoDeLectura` fecha.
 */
export function BotonActualizar({ cargando, onClick }: { cargando: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={cargando} aria-busy={cargando}
      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-60">
      <RefreshCw className={cn('w-3.5 h-3.5', cargando && 'animate-spin')} /> {cargando ? 'Actualizando…' : 'Actualizar'}
    </button>
  );
}

/** Cuándo se releyó la bandeja y cuándo leyó SignalLab las plataformas por última vez (cada 15 min). */
export function EstadoDeLectura({ actualizadoEn, leidoEn, ahora = Date.now() }: { actualizadoEn: number | null; leidoEn?: string | null; ahora?: number }) {
  if (!actualizadoEn && !leidoEn) return null;
  const min = leidoEn ? Math.max(0, Math.round((ahora - Date.parse(leidoEn)) / 60_000)) : null;
  return (
    <p className="text-[10px] text-zinc-500">
      {actualizadoEn && <>Bandeja actualizada a las {new Date(actualizadoEn).toLocaleTimeString('es')}.</>}
      {min !== null && <> Las plataformas se leyeron {min === 0 ? 'hace menos de un minuto' : `hace ${min} min`}; se vuelven a leer cada 15 min: lo que llegue después aparece en la próxima lectura.</>}
    </p>
  );
}
