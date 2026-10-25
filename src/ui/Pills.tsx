import React, { useEffect, useRef, useState } from 'react';
import { cn } from './components';

/**
 * PILLS DE MÉTRICAS, con premio animado (pedido de Sam, 2026-10-25: «que cuando cambien de valor se
 * genere un efecto visual … como una especie de premio como en videogames»).
 *
 * Cada pill guarda su valor anterior. Cuando el valor sube, ESA pill —y sólo esa— salta, brilla y
 * suelta un «+N» que flota hacia arriba. La primera vez que se pinta no hay premio: el premio es por
 * el cambio, no por existir.
 *
 * Las métricas son dato (las escribe SignalLab, `intel.signal_metrics`). El color se asigna por nombre
 * de métrica, que es eje de la plataforma, no de una marca; una métrica nueva recibe un color estable
 * calculado de su nombre, sin tocar este archivo.
 */

const COLOR: Record<string, string> = {
  views: 'pill-cian', reach: 'pill-azul', likes: 'pill-rosa', comments: 'pill-ambar', shares: 'pill-verde',
  saved: 'pill-violeta', total_interactions: 'pill-naranja', profile_visits: 'pill-lima', follows: 'pill-rojo',
};
const PALETA = ['pill-cian', 'pill-azul', 'pill-rosa', 'pill-ambar', 'pill-verde', 'pill-violeta', 'pill-naranja', 'pill-lima', 'pill-rojo'];

function colorDe(metric: string): string {
  if (COLOR[metric]) return COLOR[metric];
  let h = 0;
  for (const c of metric) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETA[h % PALETA.length];
}

const etiqueta = (m: string) => m.replace(/_/g, ' ');

function Pill({ metric, value }: { metric: string; value: number }) {
  const previo = useRef<number | null>(null);
  const [premio, setPremio] = useState<{ delta: number; n: number } | null>(null);

  useEffect(() => {
    const antes = previo.current;
    previo.current = value;
    if (antes === null || antes === value) return;
    setPremio((p) => ({ delta: value - antes, n: (p?.n ?? 0) + 1 }));
    const t = setTimeout(() => setPremio(null), 1800);
    return () => clearTimeout(t);
  }, [value]);

  const sube = !!premio && premio.delta > 0;
  return (
    <span
      key={premio?.n ?? 0}
      className={cn('pill', colorDe(metric), premio && (sube ? 'pill-premio' : 'pill-baja'))}
      title={`${etiqueta(metric)}: ${value.toLocaleString('en-US')}`}
    >
      <span className="pill-etiqueta">{etiqueta(metric)}</span>
      <b className="pill-valor">{value.toLocaleString('en-US')}</b>
      {premio && (
        <span className={cn('pill-delta', sube ? 'pill-delta-sube' : 'pill-delta-baja')}>
          {sube ? '+' : '−'}{Math.abs(premio.delta).toLocaleString('en-US')}
        </span>
      )}
      {sube && <span className="pill-chispas" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>}
    </span>
  );
}

/** Las pills de un post. Sin métricas, el motivo en texto: nunca un cero que nadie midió. */
export function Pills({ metricas, sinMedir = 'sin medir' }: { metricas: { metric: string; value: number }[]; sinMedir?: string }) {
  if (metricas.length === 0) return <span className="text-[10px] font-mono text-zinc-600">{sinMedir}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {metricas.map((m) => <Pill key={m.metric} metric={m.metric} value={Number(m.value)} />)}
    </div>
  );
}
