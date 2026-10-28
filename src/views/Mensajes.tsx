import React, { useEffect, useMemo, useState } from 'react';
import { Inbox, RotateCcw, Send, Users } from 'lucide-react';
import {
  mensajes as leerMensajes, responderMensaje, marcarAllegadoDM, ErrorApi,
  type EstadoHilo, type HiloDM, type Marca, type RespMensajes, type RespuestaDM, type Relacion,
} from '../api';
import { Aviso, BotonActualizar, Cargando, EstadoDeLectura, ChipIntencion, ChipPlataforma, bordeDePlataforma, cn, fechaHora } from '../ui/components';

/**
 * MENSAJES · la bandeja de mensajes directos (Sam, 2026-10-26; mejora 5; endpoint `/api/mensajes`).
 *
 * Una tarjeta por conversación, con los últimos mensajes como chat (la marca a la derecha). Espera respuesta la que
 * tiene un mensaje de la persona sin uno de la marca después —escrito aquí o en la app de la plataforma—. Lo que espera
 * va primero y, dentro, por intención (queja, compra, pregunta…; el catálogo es el de comentarios). La espera se pone en
 * rojo al pasar la meta de respuesta de la marca.
 *
 * VENTANA DE LA PLATAFORMA: sólo se puede responder dentro de su ventana tras el último mensaje de la persona (dato,
 * `dm_reply_window_minutes`; 24 h hoy). Pasada, el botón se apaga y dice por qué: se responde desde la app.
 *
 * ALLEGADOS: «Allegado» o «Equipo» marca a la persona en la misma lista que la bandeja de comentarios.
 */

const DIA = 86_400_000;
const RANGOS = [7, 30, 90] as const;

const ESTADO: Record<EstadoHilo, { etiqueta: string; clase: string }> = {
  sin_responder: { etiqueta: 'sin responder', clase: 'bg-amber-500/15 text-amber-300' },
  fallida: { etiqueta: 'respuesta fallida', clase: 'bg-red-500/15 text-red-300' },
  en_curso: { etiqueta: 'respuesta en curso', clase: 'bg-sky-500/15 text-sky-300' },
  respondido: { etiqueta: 'respondido', clase: 'bg-emerald-500/15 text-emerald-300' },
  allegado: { etiqueta: 'allegado', clase: 'bg-violet-500/15 text-violet-300' },
};
const PENDIENTES: ReadonlySet<EstadoHilo> = new Set(['sin_responder', 'fallida']);
const RELACION: Record<Relacion, string> = { allegado: 'cuenta allegada', equipo: 'cuenta del equipo' };
const ESTADO_RESPUESTA: Record<RespuestaDM['status'], { etiqueta: string; clase: string }> = {
  requested: { etiqueta: 'pedida', clase: 'text-sky-300' },
  sent: { etiqueta: 'enviada, sin verificar', clase: 'text-amber-300' },
  verified: { etiqueta: 'verificada en la plataforma', clase: 'text-emerald-300' },
  failed: { etiqueta: 'fallida', clase: 'text-red-300' },
};

function duracion(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}
const minutosDesde = (desde: string, ahora = Date.now()) => (ahora - Date.parse(desde)) / 60_000;

export default function Mensajes({ token, marca, plataforma = '', marcas }: {
  token: string; marca: string; plataforma?: string; marcas: Marca[];
}) {
  const [dias, setDias] = useState<(typeof RANGOS)[number]>(30);
  const [data, setData] = useState<RespMensajes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verAtendidos, setVerAtendidos] = useState(false);
  const [atendidos, setAtendidos] = useState<Set<number>>(new Set());
  const [tick, setTick] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [actualizadoEn, setActualizadoEn] = useState<number | null>(null);

  // Se relee cada minuto: SignalLab trae mensajes nuevos cada 15 min y una respuesta cambia de estado.
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    leerMensajes(token, { marca: marca || undefined, desde: new Date(Date.now() - dias * DIA).toISOString() })
      .then((r) => { if (vivo) { setData(r); setError(null); setAtendidos(new Set()); setActualizadoEn(Date.now()); } })
      .catch((e) => vivo && setError(e instanceof ErrorApi ? e.message : String(e)))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [token, marca, dias, tick]);

  const nombre = (b: string) => marcas.find((m) => m.brand_id === b)?.nombre ?? b;
  const huso = (b: string) => marcas.find((m) => m.brand_id === b)?.huso ?? null;
  const enFiltro = useMemo(() => (data?.hilos ?? []).filter((h) => !plataforma || h.platform === plataforma), [data, plataforma]);
  const visibles = enFiltro.filter((h) => verAtendidos || (PENDIENTES.has(h.estado) && !atendidos.has(h.id)));
  const pendientes = enFiltro.filter((h) => PENDIENTES.has(h.estado) && !atendidos.has(h.id)).length;
  const atender = (id: number) => { setAtendidos((s) => new Set(s).add(id)); setTick((n) => n + 1); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {RANGOS.map((r) => (
          <button key={r} onClick={() => setDias(r)}
            className={cn('px-3 py-2 rounded-lg text-xs border', dias === r ? 'bg-accent/10 text-accent border-accent/50' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-800')}>
            {r} días
          </button>
        ))}
        <label className="order-last sm:order-none basis-full sm:basis-auto flex items-center gap-1.5 text-[11px] text-zinc-400 sm:ml-2 py-1">
          <input type="checkbox" checked={verAtendidos} onChange={(e) => setVerAtendidos(e.target.checked)} />
          ver atendidos (respondidos y allegados)
        </label>
        <BotonActualizar cargando={cargando} onClick={() => setTick((n) => n + 1)} />
      </div>
      <EstadoDeLectura actualizadoEn={actualizadoEn} leidoEn={data?.leido_en} />

      {error && <Aviso tono="error">No se pudieron leer los mensajes: {error}</Aviso>}
      {!data && !error && <Cargando />}
      {data && !data.disponible && <Aviso>{data.motivo ?? 'Los mensajes directos todavía no están disponibles.'}</Aviso>}
      {data?.disponible && (
        <>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 flex items-center gap-3 text-xs text-zinc-400">
            <Inbox className="w-4 h-4 text-accent" />
            <span><b className={cn('text-base', pendientes ? 'text-amber-300' : 'text-zinc-100')}>{pendientes}</b> esperan respuesta</span>
            <span className="text-zinc-600">·</span>
            <span>{enFiltro.length} conversaciones en {dias} días</span>
          </div>
          {data.truncado && <Aviso tono="error">Hay más conversaciones de las que se muestran: acota el rango.</Aviso>}
          {visibles.length === 0 && <Aviso>{verAtendidos ? 'No hay conversaciones en esta ventana.' : 'Nada pendiente: todas las conversaciones de esta ventana están atendidas.'}</Aviso>}
          <ul className="space-y-3">
            {visibles.map((h) => (
              <TarjetaHilo key={h.id} h={h} token={token} nombre={nombre(h.brand_id)} huso={huso(h.brand_id)} conMarca={!marca}
                onCambio={() => setTick((n) => n + 1)} onAtendido={() => atender(h.id)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TarjetaHilo({ h, token, nombre, huso, conMarca, onCambio, onAtendido }: {
  h: HiloDM; token: string; nombre: string; huso: string | null; conMarca: boolean; onCambio: () => void; onAtendido: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [marcando, setMarcando] = useState<Relacion | 'quitar' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const estado = ESTADO[h.estado];
  const espera = PENDIENTES.has(h.estado) && h.espera_desde;
  const fuera = espera && h.meta_min != null && minutosDesde(h.espera_desde!) > h.meta_min;
  const persona = h.participant_name ?? 'persona sin nombre';
  const puedeResponder = h.estado !== 'en_curso' && h.estado !== 'allegado';

  const enviar = async () => {
    setEnviando(true); setError(null);
    try { await responderMensaje(token, h.id, texto); setTexto(''); onAtendido(); }
    catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); onCambio(); }
    finally { setEnviando(false); }
  };
  const allegado = async (relation: Relacion | null) => {
    setMarcando(relation ?? 'quitar'); setError(null);
    try { await marcarAllegadoDM(token, h.id, relation); if (relation) onAtendido(); else onCambio(); }
    catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); }
    finally { setMarcando(null); }
  };

  return (
    <li className={cn('rounded-xl border p-3 space-y-2.5', espera ? 'border-amber-500/30 bg-amber-500/[0.03]' : 'border-zinc-800 bg-zinc-900/30')}
      style={bordeDePlataforma(h.platform)}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cn('px-1.5 py-0.5 rounded font-mono uppercase text-[10px]', estado.clase)}>{estado.etiqueta}</span>
        <ChipPlataforma platform={h.platform} />
        {h.intencion && !h.intencion.fallback && <ChipIntencion i={h.intencion} />}
        <span className="text-zinc-200 font-medium">{persona}</span>
        {conMarca && <span className="text-zinc-500">· {nombre}</span>}
        {espera && (
          <span className={cn('ml-auto', fuera ? 'text-red-300 font-bold' : 'text-amber-300')}
            title={h.meta_min != null ? `Meta de respuesta: ${duracion(h.meta_min)}` : undefined}>
            espera {duracion(minutosDesde(h.espera_desde!))}{fuera ? ' · pasó la meta' : ''}
          </span>
        )}
      </div>

      <ol className="space-y-1.5" aria-label={`Conversación con ${persona}`}>
        {h.mensajes.map((m) => (
          <li key={m.id} className={cn('flex', m.from_brand ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[85%] rounded-2xl px-3 py-1.5 text-sm', m.from_brand ? 'bg-accent/15 text-zinc-100 rounded-br-sm' : 'bg-zinc-800 text-zinc-100 rounded-bl-sm')}>
              <p className="texto-editorial whitespace-pre-line break-words">{m.text ?? <span className="italic text-zinc-400">(adjunto sin texto)</span>}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">{m.from_brand ? 'la marca' : persona} · {fechaHora(m.sent_at, huso)}</p>
            </div>
          </li>
        ))}
      </ol>

      {h.respuestas.length > 0 && (
        <ul className="space-y-1 border-l-2 border-zinc-800 pl-3">
          {h.respuestas.slice(0, 3).map((r) => {
            const er = ESTADO_RESPUESTA[r.status];
            return (
              <li key={r.id} className="text-[10px] text-zinc-500">
                Desde SocialLab: <span className="text-zinc-300">{r.message}</span> · <span className={er.clase}>{er.etiqueta}</span>
                {r.requested_by && <> · por {r.requested_by}</>} · {fechaHora(r.requested_at, huso)}
                {r.error && <span className="text-red-300"> · {r.error}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {puedeResponder && h.responder.puede && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
            placeholder={`Responde a ${persona} como la marca…`} className="entrada flex-1 resize-y" />
          <button onClick={enviar} disabled={enviando || !texto.trim()}
            title={h.responder.hasta ? `Se puede responder hasta ${new Date(h.responder.hasta).toLocaleString('es')}` : undefined}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-accent text-black text-xs font-bold disabled:opacity-40">
            <Send className="w-3.5 h-3.5" /> {enviando ? 'Enviando…' : 'Responder'}
          </button>
        </div>
      )}
      {puedeResponder && !h.responder.puede && h.responder.motivo && (
        <p className="text-[11px] text-zinc-400">No se puede responder desde aquí: {h.responder.motivo}.</p>
      )}
      {puedeResponder && h.responder.puede && h.responder.hasta && (
        <p className="text-[10px] text-zinc-500">Se puede responder hasta {fechaHora(h.responder.hasta, huso)}.</p>
      )}

      {h.allegado ? (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
          <span><Users className="inline w-3 h-3 mr-0.5" /> {persona}: <b className="text-zinc-300">{RELACION[h.allegado]}</b>. Sus mensajes no esperan respuesta.</span>
          <button onClick={() => allegado(null)} disabled={!!marcando}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-40">
            <RotateCcw className="w-3 h-3" /> {marcando === 'quitar' ? 'Quitando…' : 'Quitar la marca'}
          </button>
        </div>
      ) : h.participant_name && h.estado !== 'respondido' && h.estado !== 'en_curso' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => allegado('allegado')} disabled={!!marcando} title={`${persona} es amistad o familia: sus mensajes no esperan respuesta`}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-violet-300 hover:bg-violet-500/10 disabled:opacity-40">
            <Users className="w-3.5 h-3.5" /> {marcando === 'allegado' ? 'Marcando…' : 'Allegado'}
          </button>
          <button onClick={() => allegado('equipo')} disabled={!!marcando} title={`${persona} es del equipo: sus mensajes no esperan respuesta`}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-violet-300 hover:bg-violet-500/10 disabled:opacity-40">
            {marcando === 'equipo' ? 'Marcando…' : 'Equipo'}
          </button>
        </div>
      )}
      {h.estado === 'fallida' && (
        <p className="text-[10px] text-zinc-500">Antes de reintentar, mira en la plataforma si el mensaje salió: un reintento puede duplicarlo.</p>
      )}
      {error && <Aviso tono="error">{error}</Aviso>}
    </li>
  );
}
