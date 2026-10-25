import React from 'react';
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

export const Cargando = () => <div className="text-xs text-zinc-500 animate-pulse">Cargando…</div>;
