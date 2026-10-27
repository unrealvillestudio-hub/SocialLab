import React, { useEffect, useState } from 'react';
import { Check, Pencil, Sparkles, Target, X } from 'lucide-react';
import { decidirObjetivo, objetivos as leerObjetivos, pedirObjetivos, type Marca, type Objetivo, type RespObjetivos, type ResultadoObjetivo } from '../api';
import { Chip, cn, etiquetaPlataforma } from './components';

/**
 * ESTRATEGIA DE LA SEMANA · el banner que encabeza todas las pestañas (Sam, 2026-10-26/27; «en todos los tabs y en color
 * diferenciador… que resalte, eye-catcher»). Va en fucsia: el turquesa es el acento del tablero y el ámbar y el rojo son
 * de lo que pide atención, así que el banner no se confunde con ninguno. El asesor propone objetivos de crecimiento orgánico
 * para la semana de cada marca; el operador los aprueba (tal cual o editados) o los descarta. Los activos se ven con lo
 * que llevan; la semana anterior, con su resultado, qué faltó y cómo corregirlo. Lo logrado y el avance los mide
 * SignalLab: aquí no se calcula nada.
 */

const etiquetaMetrica = (m: string) => m.replace(/_/g, ' ');

/** «24 de 35» / «sin medir de 1.000»: lo que lleva frente a la meta, con el formato numérico del idioma. */
export function textoDeAvance(o: Pick<Objetivo, 'current_value' | 'target_value'>, locale = 'es'): string | null {
  if (o.target_value === null) return null;
  const f = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
  return o.current_value === null ? `sin medir de ${f(Number(o.target_value))}` : `${f(Number(o.current_value))} de ${f(Number(o.target_value))}`;
}
const RESULTADO: Record<ResultadoObjetivo, { texto: string; clase: string }> = {
  logrado: { texto: 'Logrado', clase: 'bg-emerald-500/15 text-emerald-300' },
  parcial: { texto: 'Parcial', clase: 'bg-amber-500/15 text-amber-300' },
  no_logrado: { texto: 'No logrado', clase: 'bg-red-500/15 text-red-300' },
  sin_datos: { texto: 'Sin datos', clase: 'bg-zinc-800 text-zinc-400' },
};
const semanaDe = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Medida({ o }: { o: Objetivo }) {
  if (!o.metric) return <span className="text-[10px] text-zinc-500">sin medida automática</span>;
  return (
    <span className="text-[10px] text-zinc-500">
      {etiquetaMetrica(o.metric)}{o.platform ? ` · ${etiquetaPlataforma(o.platform)}` : ' · todas las plataformas'}
      {o.measure === 'suma' ? ' · total de la semana' : ''}
      {o.baseline_value !== null && o.measure === 'nivel' ? ` · partimos de ${o.baseline_value}` : ''}
    </span>
  );
}

function Avance({ o }: { o: Objetivo }) {
  const texto = textoDeAvance(o);
  if (!texto) return null;
  const pct = o.progress === null ? 0 : Math.max(0, Math.min(1, o.progress)) * 100;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-1.5 flex-1 min-w-16 rounded-full bg-zinc-800 overflow-hidden" aria-hidden>
        <div className="h-full bg-gradient-to-r from-fuchsia-500 to-violet-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-zinc-300 whitespace-nowrap">{texto}</span>
    </div>
  );
}

function Propuesta({ o, token, onCambio }: { o: Objetivo; token: string; onCambio: () => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(o.objective);
  const [meta, setMeta] = useState(o.target_value === null ? '' : String(o.target_value));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hacer = async (accion: 'aprobar' | 'descartar') => {
    setEnviando(true); setError(null);
    try {
      const cambios = editando && accion === 'aprobar'
        ? { objective: texto, ...(o.metric && meta !== '' ? { target_value: Number(meta) } : {}) } : {};
      await decidirObjetivo(token, o.id, accion, cambios);
      onCambio();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setEnviando(false); }
  };
  return (
    <li className="rounded-lg border border-dashed border-fuchsia-400/50 bg-black/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-fuchsia-300"><Sparkles className="w-3 h-3" /> Propuesta del asesor</div>
      {editando ? (
        <div className="space-y-2">
          <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={200} className="entrada w-full" aria-label="Objetivo" />
          {o.metric && (
            <label className="flex items-center gap-2 text-[11px] text-zinc-400">
              Meta <input value={meta} onChange={(e) => setMeta(e.target.value)} inputMode="decimal" className="entrada w-28" aria-label="Meta" />
              <Medida o={o} />
            </label>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-100">{o.objective}</p>
          <div className="flex flex-wrap items-center gap-2">
            {o.target_value !== null && <Chip className="text-zinc-200">meta {o.target_value}</Chip>}
            <Medida o={o} />
          </div>
        </>
      )}
      {o.rationale && <p className="text-[11px] text-zinc-400">{o.rationale}</p>}
      {error && <p className="text-[11px] text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={enviando} onClick={() => hacer('aprobar')}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent/15 text-accent text-xs hover:bg-accent/25 disabled:opacity-50">
          <Check className="w-3.5 h-3.5" /> {editando ? 'Aprobar con cambios' : 'Aprobar'}
        </button>
        {!editando && (
          <button disabled={enviando} onClick={() => setEditando(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700 disabled:opacity-50">
            <Pencil className="w-3.5 h-3.5" /> Editar
          </button>
        )}
        <button disabled={enviando} onClick={() => (editando ? setEditando(false) : hacer('descartar'))}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 text-xs hover:bg-zinc-700 disabled:opacity-50">
          <X className="w-3.5 h-3.5" /> {editando ? 'Cancelar' : 'Descartar'}
        </button>
      </div>
    </li>
  );
}

export function BannerObjetivos({ token, data, nombre, onCambio }: {
  token: string; data: RespObjetivos | null; nombre: (b: string) => string; onCambio: () => void;
}) {
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  if (!data) return null;
  if (!data.disponible) return <p className="text-[11px] text-zinc-500">Estrategia de la semana: {data.motivo}</p>;
  const pedir = async (b: string) => {
    setPidiendo(b); setAviso(null);
    try { await pedirObjetivos(token, b); setAviso('Pedido enviado: el asesor escribe la propuesta en unos minutos.'); onCambio(); }
    catch (e) { setAviso(e instanceof Error ? e.message : String(e)); }
    finally { setPidiendo(null); }
  };

  return (
    <section className="space-y-3">
      {data.semanas.map((s) => {
        const activos = s.objetivos.filter((o) => o.status === 'activa');
        const propuestas = s.objetivos.filter((o) => o.status === 'propuesta');
        const enCamino = data.pedidos.includes(s.brand_id);
        return (
          <div key={s.brand_id} className="rounded-xl border-2 border-fuchsia-500/70 bg-gradient-to-r from-fuchsia-600/25 via-violet-700/20 to-fuchsia-900/10 p-4 space-y-3 shadow-[0_0_24px_-6px_rgba(217,70,239,0.55)]">
            <div className="flex flex-wrap items-center gap-2">
              <Target className="w-5 h-5 text-fuchsia-300" />
              <h3 className="titulo text-lg text-fuchsia-100">Estrategia de la semana</h3>
              <span className="text-[11px] text-fuchsia-200/70">{nombre(s.brand_id)} · semana del {semanaDe(s.semana)}</span>
              {enCamino ? <span className="ml-auto text-[11px] text-fuchsia-200 animate-pulse">Propuesta en camino…</span>
                : (activos.length === 0 || propuestas.length > 0) && (
                  <button onClick={() => pedir(s.brand_id)} disabled={pidiendo === s.brand_id}
                    className="ml-auto text-[11px] px-2.5 py-1 rounded-lg bg-fuchsia-500/20 text-fuchsia-100 border border-fuchsia-400/40 hover:bg-fuchsia-500/30 disabled:opacity-50">
                    {propuestas.length ? 'Pedir otra propuesta' : 'Pedir propuesta'}
                  </button>
                )}
            </div>

            {activos.length > 0 && (
              <ul className="space-y-2">
                {activos.map((o) => (
                  <li key={o.id} className="space-y-1">
                    <p className="flex items-start gap-2 text-base text-zinc-100"><span className="text-fuchsia-400 mt-0.5">●</span>{o.objective}</p>
                    <div className="pl-5 space-y-1"><Avance o={o} /><Medida o={o} /></div>
                  </li>
                ))}
              </ul>
            )}
            {propuestas.length > 0 && (
              <ul className="space-y-2">{propuestas.map((o) => <Propuesta key={o.id} o={o} token={token} onCambio={onCambio} />)}</ul>
            )}
            {activos.length === 0 && propuestas.length === 0 && !enCamino && (
              <p className="text-xs text-fuchsia-100/80">Todavía no hay objetivos para esta semana. El asesor los propone en su próxima ronda (de 8 a 20 h, hora de la marca), o pídelos ahora.</p>
            )}

            {s.revision.length > 0 && (
              <details className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <summary className="cursor-pointer text-xs text-zinc-300">
                  Revisión de la semana pasada · {s.revision.filter((o) => o.outcome === 'logrado').length} de {s.revision.length} logrados
                </summary>
                <ul className="mt-2 space-y-2">
                  {s.revision.map((o) => {
                    const r = RESULTADO[o.outcome ?? 'sin_datos'];
                    return (
                      <li key={o.id} className="space-y-1 text-[11px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', r.clase)}>{r.texto}</span>
                          <span className="text-zinc-200">{o.objective}</span>
                          {textoDeAvance(o) && <span className="text-zinc-500">{textoDeAvance(o)}</span>}
                        </div>
                        {o.review_missing && <p className="text-zinc-400"><b className="text-zinc-300">{o.outcome === 'logrado' ? 'Qué funcionó:' : 'Qué faltó:'}</b> {o.review_missing}</p>}
                        {o.review_correction && <p className="text-zinc-400"><b className="text-zinc-300">Cómo seguimos:</b> {o.review_correction}</p>}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </div>
        );
      })}
      {aviso && <p className="text-[11px] text-zinc-400">{aviso}</p>}
    </section>
  );
}

/** El banner con sus datos: lo lee él mismo, para poder ir encima de cualquier pestaña. Se relee cada minuto. */
export function EstrategiaDeLaSemana({ token, marca, marcas }: { token: string; marca: string; marcas: Marca[] }) {
  const [data, setData] = useState<RespObjetivos | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let vivo = true;
    leerObjetivos(token, { marca: marca || undefined }).then((d) => { if (vivo) setData(d); }).catch(() => { if (vivo) setData(null); });
    return () => { vivo = false; };
  }, [token, marca, tick]);
  const nombre = (b: string) => marcas.find((m) => m.brand_id === b)?.nombre ?? b;
  return <BannerObjetivos token={token} data={data} nombre={nombre} onCambio={() => setTick((n) => n + 1)} />;
}
