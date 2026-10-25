import React, { useEffect, useRef, useState } from 'react';
import { cn } from './components';
import { Sparkles } from 'lucide-react';
import { METRICA_COMENTARIOS } from '../pulso';
import { severidadMayor } from '../asesor';

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

interface AccionComentarios { pendientes: number; nuevo: boolean; onClick: () => void }

function Pill({ metric, value, fuente, comentarios }: {
  metric: string; value: number; fuente?: 'vivo' | 'medido'; comentarios?: AccionComentarios;
}) {
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
  const Raiz = comentarios ? 'button' : 'span';
  const titulo = `${etiqueta(metric)}: ${value.toLocaleString('en-US')}`
    + (fuente === 'vivo' ? ' · en vivo, leído de la plataforma' : fuente === 'medido' ? ' · medido por SignalLab' : '')
    + (comentarios ? ` · ${comentarios.pendientes ? `${comentarios.pendientes} sin responder · ` : ''}abrir la bandeja de este post` : '');
  return (
    <Raiz
      key={premio?.n ?? 0}
      {...(comentarios ? { type: 'button' as const, onClick: comentarios.onClick } : {})}
      className={cn('pill', colorDe(metric), premio && (sube ? 'pill-premio' : 'pill-baja'),
        comentarios && 'pill-accion', comentarios?.nuevo && 'pill-nuevo')}
      title={titulo}
    >
      {fuente === 'vivo' && <span className="pill-vivo" aria-label="en vivo" />}
      <span className="pill-etiqueta">{etiqueta(metric)}</span>
      <b className="pill-valor">{value.toLocaleString('en-US')}</b>
      {comentarios?.nuevo && <span className="pill-insignia pill-insignia-nuevo">nuevo</span>}
      {!comentarios?.nuevo && !!comentarios?.pendientes && <span className="pill-insignia">{comentarios.pendientes} sin resp.</span>}
      {premio && (
        <span className={cn('pill-delta', sube ? 'pill-delta-sube' : 'pill-delta-baja')}>
          {sube ? '+' : '−'}{Math.abs(premio.delta).toLocaleString('en-US')}
        </span>
      )}
      {sube && <span className="pill-chispas" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>}
    </Raiz>
  );
}

/**
 * Las pills de un post. Sin métricas, el motivo en texto: nunca un cero que nadie midió.
 * `comentarios` convierte la pill de comentarios en el acceso a la bandeja de ese post.
 */
export function Pills({ metricas, sinMedir = 'sin medir', comentarios }: {
  metricas: { metric: string; value: number; fuente?: 'vivo' | 'medido' }[]; sinMedir?: string; comentarios?: AccionComentarios;
}) {
  if (metricas.length === 0) return <span className="text-[10px] font-mono text-zinc-600">{sinMedir}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {metricas.map((m) => (
        <Pill key={m.metric} metric={m.metric} value={Number(m.value)} fuente={m.fuente}
          comentarios={m.metric === METRICA_COMENTARIOS ? comentarios : undefined} />
      ))}
    </div>
  );
}

/** El color de la pill del asesor dice la urgencia (Sam, 2026-10-25): ámbar atención, cian oportunidad, chalk info. */
const COLOR_SEVERIDAD: Record<string, string> = { atencion: 'pill-asesor-atencion', oportunidad: 'pill-asesor-oportunidad', info: 'pill-asesor-info' };
const ETIQUETA_SEVERIDAD: Record<string, string> = { atencion: 'atención', oportunidad: 'oportunidad', info: 'info' };

/**
 * LA PILL DEL ASESOR · especial: late sin parar mientras haya un consejo NUEVO y deja de latir cuando
 * alguien lo abre (la tarjeta pasa a «vista» para todos). Abrirla lleva la publicación a Acciones.
 */
export function PillAsesor({ tarjetas, onClick }: { tarjetas: { severity: string; status: string }[]; onClick: () => void }) {
  const sev = severidadMayor(tarjetas) ?? 'info';
  const nuevas = tarjetas.filter((t) => t.status === 'nueva').length;
  return (
    <button type="button" onClick={onClick}
      title={`${tarjetas.length} ${tarjetas.length === 1 ? 'consejo' : 'consejos'} del asesor (${ETIQUETA_SEVERIDAD[sev] ?? sev})${nuevas ? ` · ${nuevas} sin abrir` : ''}`}
      className={cn('pill pill-asesor pill-accion', COLOR_SEVERIDAD[sev] ?? 'pill-asesor-info', nuevas > 0 && 'pill-asesor-nueva')}>
      <Sparkles className="w-3 h-3" />
      <span className="pill-etiqueta">asesor</span>
      <b className="pill-valor">{tarjetas.length}</b>
      {nuevas > 0 && <span className="pill-insignia pill-insignia-nuevo">nuevo</span>}
    </button>
  );
}
