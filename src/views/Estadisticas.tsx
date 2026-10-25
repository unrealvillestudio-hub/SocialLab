import React, { useEffect, useState } from 'react';
import { ExternalLink, Lock } from 'lucide-react';
import { ops, type Estadistica, type Marca, type RespEstadisticas } from '../api';
import { Aviso, Cargando, Chip, cn, etiquetaFormato, etiquetaPlataforma, fechaHora } from '../ui/components';

/**
 * ESTADÍSTICAS · una tarjeta por marca y plataforma, al estilo del panel profesional de la plataforma
 * (pedido de Sam, 2026-10-25). Hoy se alimenta de lo que SignalLab mide POR PUBLICACIÓN. Lo que es de la
 * CUENTA (seguidores, alcance diario, visitas al perfil, audiencia) lo guardará SignalLab; mientras no
 * exista, esa sección dice «pendiente», nunca cero.
 */

const RANGOS = [7, 30, 90] as const;
const DIA = 86_400_000;
const etiquetaMetrica = (m: string) => m.replace(/_/g, ' ');
const numero = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 10) / 10).toLocaleString('en-US');

export default function Estadisticas({ token, marca, marcas }: { token: string; marca: string; marcas: Marca[] }) {
  const [dias, setDias] = useState<(typeof RANGOS)[number]>(30);
  const [data, setData] = useState<RespEstadisticas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 5 * 60_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let vivo = true;
    setData(null);
    ops<RespEstadisticas>(token, 'estadisticas', {
      marca: marca || undefined, desde: new Date(Date.now() - dias * DIA).toISOString(),
    }).then((r) => { if (vivo) { setData(r); setError(null); } }).catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [token, marca, dias, tick]);

  const nombre = (b: string) => marcas.find((m) => m.brand_id === b)?.nombre ?? b;
  const huso = (b: string) => marcas.find((m) => m.brand_id === b)?.huso ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {RANGOS.map((r) => (
          <button key={r} onClick={() => setDias(r)}
            className={cn('px-3 py-1.5 rounded-lg text-xs border', dias === r ? 'bg-accent text-black border-accent' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-800')}>
            {r} días
          </button>
        ))}
        <span className="ml-auto text-[11px] text-zinc-500">Publicaciones del carril y detectadas; las manuales y externas no tienen lector de métricas.</span>
      </div>

      {error && <Aviso tono="error">No se pudieron leer las estadísticas: {error}</Aviso>}
      {!data && !error && <Cargando />}
      {data && (
        <>
          {data.metricas === 'tabla_inexistente' && <Aviso>Métricas: <b>sin medir</b>. SignalLab todavía no escribe instantáneas.</Aviso>}
          {data.truncado && <Aviso tono="error">La ventana tiene más publicaciones de las que se resumen: acota el rango.</Aviso>}
          {data.estadisticas.length === 0 && <Aviso>No hay publicaciones medibles en estos {dias} días.</Aviso>}
          <div className="grid gap-4 xl:grid-cols-2">
            {data.estadisticas.map((e) => (
              <Tarjeta key={`${e.brand_id}-${e.platform}`} e={e} nombre={nombre(e.brand_id)} huso={huso(e.brand_id)} motivoCuenta={data.cuenta.motivo} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Tarjeta({ e, nombre, huso, motivoCuenta }: { e: Estadistica; nombre: string; huso: string | null; motivoCuenta: string }) {
  const maxFormato = Math.max(1, ...e.porFormato.map((f) => f.publicaciones));
  const maxDia = Math.max(1, ...e.porDia.map((d) => d.publicaciones));
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <Chip className="text-zinc-100">{nombre}</Chip>
        <Chip>{etiquetaPlataforma(e.platform)}</Chip>
        <span className="ml-auto text-[11px] text-zinc-500">{e.publicaciones} publicadas · {e.medidas} medidas</span>
      </header>

      <p className="text-[10px] text-zinc-500">
        Totales = suma de la última lectura de cada publicación. El alcance sumado cuenta varias veces a quien vio varios posts:
        no es el alcance único de la cuenta, que llegará con las métricas de cuenta.
      </p>

      {/* Totales: una tarjeta por métrica, en el orden de su total. */}
      {e.metricas.length === 0
        ? <p className="text-[11px] font-mono text-zinc-600">sin medir</p>
        : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {e.metricas.map((m, i) => (
              <div key={m.metric} className={cn('rounded-xl border p-3', i === 0 ? 'border-accent/50 bg-accent/5' : 'border-zinc-800 bg-zinc-950/40')}>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">{etiquetaMetrica(m.metric)}</div>
                <div className="text-xl font-semibold text-zinc-100">{numero(m.total)}</div>
                <div className="text-[10px] text-zinc-500">mediana {numero(m.mediana)} · {m.posts} posts</div>
              </div>
            ))}
          </div>
        )}

      {/* Por formato */}
      <div>
        <h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">Por formato</h4>
        <div className="space-y-1">
          {e.porFormato.map((f) => (
            <div key={f.formato} className="flex items-center gap-2 text-[11px]">
              <span className="w-24 text-zinc-400">{etiquetaFormato(f.formato)}</span>
              <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div className="h-full bg-accent/80" style={{ width: `${(f.publicaciones / maxFormato) * 100}%` }} />
              </div>
              <span className="w-6 text-right text-zinc-300">{f.publicaciones}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Publicaciones por día de publicación */}
      <div>
        <h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">Publicaciones por día</h4>
        <div className="flex items-end gap-1 h-14">
          {e.porDia.map((d) => (
            <div key={d.dia} title={`${d.dia}: ${d.publicaciones}`} className="flex-1 min-w-[4px] rounded-t bg-zinc-600 hover:bg-accent"
              style={{ height: `${(d.publicaciones / maxDia) * 100}%` }} />
          ))}
        </div>
      </div>

      {/* Top content */}
      {e.metricaTop && e.top.length > 0 && (
        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">Top por {etiquetaMetrica(e.metricaTop)}</h4>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {e.top.map((p) => {
              const v = p.metricas.find((m) => m.metric === e.metricaTop)?.value;
              const img = p.image_url ?? p.media_urls?.[0] ?? null;
              return (
                <a key={p.id} href={p.enlace ?? undefined} target="_blank" rel="noreferrer" title={`${fechaHora(p.published_at, huso)} · ${p.copy_text ?? ''}`}
                  className="relative block aspect-square rounded-lg overflow-hidden bg-zinc-800 group">
                  {img && <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />}
                  <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono text-zinc-100">{v != null ? numero(v) : '—'}</span>
                  {p.enlace && <ExternalLink className="absolute top-1 right-1 w-3 h-3 text-white/70 opacity-0 group-hover:opacity-100" />}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Lo que es de la cuenta: pendiente de SignalLab */}
      <div className="rounded-xl border border-dashed border-zinc-700 p-3 flex items-start gap-2 text-[11px] text-zinc-500">
        <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          <b className="text-zinc-300">Seguidores, alcance diario, visitas al perfil y audiencia:</b> pendiente. {motivoCuenta}.
        </span>
      </div>
    </section>
  );
}
