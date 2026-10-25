import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Lock, Users } from 'lucide-react';
import { ops, type Estadistica, type Marca, type RespEstadisticas, type ResumenCuenta } from '../api';
import { PillAsesorDeCuenta } from '../ui/Pulso';
import { Aviso, Cargando, Chip, cn, etiquetaFormato, etiquetaPlataforma, fechaHora } from '../ui/components';

/**
 * ESTADÍSTICAS · una tarjeta por marca y plataforma, al estilo del panel profesional de la plataforma
 * (pedido de Sam, 2026-10-25). Dos fuentes de SignalLab: lo medido POR PUBLICACIÓN y lo medido de la
 * CUENTA (`content.account_metric_daily`: seguidores, alcance diario, visitas al perfil, desgloses).
 * Lo que la plataforma todavía no da sale como meta («se desbloquea con N seguidores»), nunca como cero.
 */

const RANGOS = [7, 30, 90] as const;
const DIA = 86_400_000;
const etiquetaMetrica = (m: string) => m.replace(/_/g, ' ');
const numero = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 10) / 10).toLocaleString('en-US');

export default function Estadisticas({ token, marca, plataforma, marcas }: { token: string; marca: string; plataforma: string; marcas: Marca[] }) {
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
  // Una tarjeta por marca y plataforma con publicaciones medidas O con métricas de cuenta.
  const claves = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, { k: string; e?: Estadistica; c?: ResumenCuenta }>();
    for (const e of data.estadisticas) m.set(`${e.brand_id}|${e.platform}`, { k: `${e.brand_id}|${e.platform}`, e });
    for (const c of data.cuenta.estado === 'medida' ? data.cuenta.cuentas : []) {
      const k = `${c.brand_id}|${c.platform}`;
      m.set(k, { ...(m.get(k) ?? { k }), c });
    }
    return [...m.values()].filter((x) => !plataforma || x.k.endsWith(`|${plataforma}`)).sort((a, b) => a.k.localeCompare(b.k));
  }, [data, plataforma]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {RANGOS.map((r) => (
          <button key={r} onClick={() => setDias(r)}
            className={cn('px-3 py-2 rounded-lg text-xs border', dias === r ? 'bg-accent/10 text-accent border-accent/50' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-800')}>
            {r} días
          </button>
        ))}
        <span className="basis-full sm:basis-auto sm:ml-auto text-[11px] text-zinc-500">Publicaciones del carril y detectadas; las manuales y externas no tienen lector de métricas.</span>
      </div>

      {error && <Aviso tono="error">No se pudieron leer las estadísticas: {error}</Aviso>}
      {!data && !error && <Cargando />}
      {data && (
        <>
          {data.metricas === 'tabla_inexistente' && <Aviso>Métricas: <b>sin medir</b>. SignalLab todavía no escribe instantáneas.</Aviso>}
          {data.truncado && <Aviso tono="error">La ventana tiene más publicaciones de las que se resumen: acota el rango.</Aviso>}
          {data.cuenta.estado === 'medida' && data.cuenta.truncado && <Aviso tono="error">La cuenta tiene más filas de las que se resumen: acota el rango.</Aviso>}
          {claves.length === 0 && <Aviso>No hay publicaciones ni métricas de cuenta en estos {dias} días.</Aviso>}
          <div className="grid gap-4 xl:grid-cols-2">
            {claves.map(({ k, e, c }) => (
              <Tarjeta key={k} e={e} c={c} nombre={nombre((e ?? c)!.brand_id)} huso={huso((e ?? c)!.brand_id)}
                cuenta={data.cuenta} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Tarjeta({ e, c, nombre, huso, cuenta }: {
  e?: Estadistica; c?: ResumenCuenta; nombre: string; huso: string | null; cuenta: RespEstadisticas['cuenta'];
}) {
  const platform = (e ?? c)!.platform;
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 sm:p-4 space-y-4 min-w-0">
      <header className="flex flex-wrap items-center gap-2">
        <Chip className="text-zinc-100">{nombre}</Chip>
        <Chip>{etiquetaPlataforma(platform)}</Chip>
        {c?.seguidores && (
          <span className="flex items-center gap-1.5 text-sm text-zinc-100" title={`seguidores al ${c.seguidores.fecha}`}>
            <Users className="w-4 h-4 text-accent" /><b className="titulo text-2xl">{numero(c.seguidores.value)}</b><span className="text-[11px] text-zinc-500">{c.seguidores.value === 1 ? 'seguidor' : 'seguidores'}</span>
          </span>
        )}
        <PillAsesorDeCuenta brand_id={(e ?? c)!.brand_id} platform={platform} />
        {e && <span className="ml-auto text-[11px] text-zinc-500">{e.publicaciones} publicadas · {e.medidas} medidas</span>}
      </header>

      {c ? <Cuenta c={c} relectura={cuenta.estado === 'medida' ? cuenta.relectura_dias : 0} />
        : (
          <div className="rounded-xl border border-dashed border-zinc-700 p-3 flex items-start gap-2 text-[11px] text-zinc-500">
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span><b className="text-zinc-300">Cuenta:</b> {cuenta.estado === 'pendiente' ? `pendiente. ${cuenta.motivo}.` : 'sin lecturas de esta cuenta en la ventana.'}</span>
          </div>
        )}

      {e && <Publicaciones e={e} huso={huso} />}
    </section>
  );
}

// ── La cuenta ─────────────────────────────────────────────────────────────────

function Cuenta({ c, relectura }: { c: ResumenCuenta; relectura: number }) {
  const seguidores = c.seguidores?.value ?? null;
  // Lo bloqueado se agrupa por umbral: una meta por número de seguidores, no una por métrica.
  const metas = [...c.bloqueadas.reduce((m, b) => {
    const k = b.min_followers ?? -1;
    return m.set(k, [...(m.get(k) ?? []), b]);
  }, new Map<number, ResumenCuenta['bloqueadas']>())].sort((a, b) => a[0] - b[0]);
  return (
    <div className="space-y-4">
      <h4 className="text-[11px] uppercase tracking-wider text-zinc-400">Cuenta</h4>

      {(c.totales.length > 0 || c.campos.length > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {c.totales.map((t) => (
            <div key={t.metric} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3" title={t.nota ?? undefined}>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">{etiquetaMetrica(t.metric)}</div>
              <div className="titulo text-3xl text-zinc-100">{numero(t.total)}</div>
              <div className="text-[10px] text-zinc-500">{t.dias === 1 ? '1 día medido' : `${t.dias} días medidos`}</div>
            </div>
          ))}
          {c.campos.map((f) => (
            <div key={f.metric} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">{etiquetaMetrica(f.metric)}</div>
              <div className="titulo text-3xl text-zinc-100">{numero(f.value)}</div>
              <div className="text-[10px] text-zinc-500">al {f.fecha}</div>
            </div>
          ))}
        </div>
      )}

      {c.series.map((s) => <Serie key={s.metric} s={s} relectura={relectura} />)}

      {c.desgloses.map((d) => {
        const total = d.valores.reduce((x, v) => x + v.total, 0) || 1;
        return (
          <div key={`${d.metric}-${d.breakdown}`}>
            <h5 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{etiquetaMetrica(d.metric)} por {etiquetaMetrica(d.breakdown)}</h5>
            <div className="space-y-1">
              {d.valores.slice(0, 8).map((v) => (
                <div key={v.valor} className="flex items-center gap-2 text-[11px]">
                  <span className="w-20 sm:w-28 truncate text-zinc-400">{etiquetaMetrica(v.valor.toLowerCase())}</span>
                  <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div className="h-full bg-accent/70" style={{ width: `${(v.total / total) * 100}%` }} />
                  </div>
                  <span className="w-20 text-right text-zinc-300">{numero(v.total)} <span className="text-zinc-600">{Math.round((v.total / total) * 100)}%</span></span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {metas.map(([umbral, bs]) => (
        <div key={umbral} className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] text-amber-200">
            <Lock className="w-3.5 h-3.5" />
            {umbral > 0
              ? <span>Se desbloquea con <b>{numero(umbral)} seguidores</b>{seguidores !== null && <> · hoy {numero(seguidores)} · faltan <b>{numero(Math.max(0, umbral - seguidores))}</b></>}</span>
              : <span>La plataforma todavía no la da</span>}
          </div>
          {umbral > 0 && seguidores !== null && (
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, (seguidores / umbral) * 100)}%` }} />
            </div>
          )}
          <div className="text-[10px] text-zinc-500">{[...new Set(bs.map((b) => etiquetaMetrica(b.metric) + (b.breakdown ? ` (${etiquetaMetrica(b.breakdown)})` : '')))].join(' · ')}</div>
        </div>
      ))}

      {c.sinDatos.length > 0 && (
        <p className="text-[10px] text-zinc-600">Sin datos en la ventana: {c.sinDatos.map((d) => etiquetaMetrica(d.metric) + (d.breakdown ? ` (${etiquetaMetrica(d.breakdown)})` : '')).join(' · ')}</p>
      )}
    </div>
  );
}

function Serie({ s, relectura }: { s: ResumenCuenta['series'][number]; relectura: number }) {
  const conValor = s.puntos.filter((p) => p.value !== null);
  const max = Math.max(1, ...conValor.map((p) => p.value!));
  const total = conValor.reduce((x, p) => x + p.value!, 0);
  const hayProvisional = s.puntos.some((p) => p.provisional);
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <h5 className="text-[10px] uppercase tracking-wider text-zinc-500" title={s.nota ?? undefined}>{etiquetaMetrica(s.metric)} por día</h5>
        <span className="text-xs text-zinc-200 font-semibold">{numero(total)}</span>
        <span className="text-[10px] text-zinc-600">suma de {conValor.length} días</span>
      </div>
      <div className="flex items-end gap-1 h-16">
        {s.puntos.map((p) => (
          <div key={p.fecha} className="flex-1 min-w-[4px] h-full flex items-end"
            title={`${p.fecha}: ${p.value === null ? (p.motivo ?? 'sin datos') : numero(p.value)}${p.provisional ? ' · provisional' : ''}`}>
            {p.value === null
              ? <div className="w-full h-[3px] rounded bg-zinc-800" />
              : <div className={cn('w-full rounded-t', p.provisional ? 'bg-accent/40' : 'bg-accent/80')} style={{ height: `${Math.max(3, (p.value / max) * 100)}%` }} />}
          </div>
        ))}
      </div>
      {hayProvisional && <p className="mt-1 text-[10px] text-zinc-600">Los últimos {relectura} días son provisionales: la plataforma los consolida con retraso y SignalLab los relee.</p>}
    </div>
  );
}

// ── Las publicaciones ─────────────────────────────────────────────────────────

function Publicaciones({ e, huso }: { e: Estadistica; huso: string | null }) {
  const maxFormato = Math.max(1, ...e.porFormato.map((f) => f.publicaciones));
  const maxDia = Math.max(1, ...e.porDia.map((d) => d.publicaciones));
  return (
    <div className="space-y-4 border-t border-zinc-800 pt-4">
      <h4 className="text-[11px] uppercase tracking-wider text-zinc-400">Publicaciones</h4>
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
                <div className="titulo text-3xl text-zinc-100">{numero(m.total)}</div>
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
              <span className="w-20 sm:w-24 truncate text-zinc-400">{etiquetaFormato(f.formato)}</span>
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
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-2">
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

    </div>
  );
}
