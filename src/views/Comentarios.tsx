import React, { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Lock, MessageCircle, RefreshCw, RotateCcw, Send, Users, X } from 'lucide-react';
import {
  comentarios as leerComentarios, responderComentario, cerrarComentario, marcarAllegado, ops, ErrorApi,
  type Comentario, type EstadoComentario, type Marca, type Publicada, type RespComentarios, type RespPublicado, type RespuestaComentario,
  type TipoCierre, type Relacion,
} from '../api';
import { Aviso, Cargando, Chip, ChipPlataforma, Miniatura, bordeDePlataforma, cn, fechaHora, ChevronAsesor } from '../ui/components';
import { usePulso } from '../ui/Pulso';

/**
 * COMENTARIOS · la bandeja de interacción (Fase 3; endpoint `/api/comments`, SocialLab #14).
 *
 * Lo que espera a alguien va primero (el endpoint ya lo ordena). Cada respuesta se asienta antes de
 * salir y se verifica leyéndola desde la plataforma: la tarjeta muestra si quedó enviada, verificada o
 * fallida, y quién la pidió. Una respuesta la escribe y la envía una persona; aquí no hay respuestas
 * automáticas.
 *
 * EL ASESOR EN LA TARJETA (Sam, 2026-10-26): si el asesor dejó una sugerencia para el comentario, se ve
 * aquí y su borrador se puede usar; si no, «Pedir consejo al asesor» se lo pide sobre ESE comentario
 * (el asesor lo atiende aunque tenga más de 72 h). El consejo llega en el siguiente ciclo, cada 15 min.
 *
 * LO ATENDIDO SALE (Sam, 2026-10-26: «tan pronto respondamos la tarjeta se libera hasta que esa misma persona vuelva a
 * comentar»). Por defecto sólo se ve lo pendiente; lo respondido y lo cerrado —«Hecho», «Contestado fuera», «Descartar»—
 * sale en el acto y queda a la vista con «ver atendidos», donde se puede reabrir. Los comentarios van agrupados bajo su
 * publicación, que se muestra una vez, y cada tarjeta lleva el color de su plataforma.
 *
 * DESHACER (Sam, 2026-10-26): un cierre se puede deshacer durante `SEGUNDOS_DESHACER` desde el aviso que aparece abajo,
 * sin ir a «ver atendidos». Una respuesta enviada no se deshace: ya salió a la plataforma.
 *
 * ALLEGADOS (Sam, 2026-10-26): «Allegado» o «Equipo» marca a quien escribió el comentario; sus comentarios dejan de
 * esperar respuesta (estado `allegado`) y el asesor no los considera. Necesita el autor: en Facebook a menudo no llega.
 */

const DIA = 86_400_000;
const SEGUNDOS_DESHACER = 8;
const RANGOS = [3, 7, 30] as const;

const ESTADO: Record<EstadoComentario, { etiqueta: string; clase: string }> = {
  sin_responder: { etiqueta: 'sin responder', clase: 'bg-amber-500/15 text-amber-300' },
  fallida: { etiqueta: 'respuesta fallida', clase: 'bg-red-500/15 text-red-300' },
  en_curso: { etiqueta: 'respuesta en curso', clase: 'bg-sky-500/15 text-sky-300' },
  respondido: { etiqueta: 'respondido', clase: 'bg-emerald-500/15 text-emerald-300' },
  cerrado: { etiqueta: 'atendido', clase: 'bg-zinc-700/60 text-zinc-300' },
  allegado: { etiqueta: 'allegado', clase: 'bg-violet-500/15 text-violet-300' },
  de_la_marca: { etiqueta: 'de la marca', clase: 'bg-zinc-700/60 text-zinc-300' },
};

/** Lo que espera al operador: lo único que la bandeja muestra por defecto. */
const PENDIENTES: ReadonlySet<EstadoComentario> = new Set(['sin_responder', 'fallida']);

const CIERRE: Record<TipoCierre, string> = { hecho: 'hecho', descartado: 'descartado', contestado_fuera: 'contestado fuera de SocialLab' };
const RELACION: Record<Relacion, string> = { allegado: 'cuenta allegada', equipo: 'cuenta del equipo' };

/** Lo que se acaba de hacer en una tarjeta y cómo deshacerlo. */
interface Hecho { etiqueta: string; deshacer: () => Promise<unknown> }

const ESTADO_RESPUESTA: Record<RespuestaComentario['status'], { etiqueta: string; clase: string }> = {
  requested: { etiqueta: 'pedida', clase: 'text-sky-300' },
  sent: { etiqueta: 'enviada, sin verificar', clase: 'text-amber-300' },
  verified: { etiqueta: 'verificada en la plataforma', clase: 'text-emerald-300' },
  failed: { etiqueta: 'fallida', clase: 'text-red-300' },
};

/** Una duración en minutos, en minutos, horas o días. */
function duracion(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}
/** Minutos que lleva esperando. */
const minutosDesde = (desde: string, ahora = Date.now()) => (ahora - Date.parse(desde)) / 60_000;
/** Cuánto lleva esperando: en minutos, horas o días. */
const espera = (desde: string, ahora = Date.now()) => duracion(minutosDesde(desde, ahora));

export default function Comentarios({ token, marca, plataforma = '', marcas, post = null, onQuitarFiltro }: {
  token: string; marca: string; plataforma?: string; marcas: Marca[];
  /** Abierta desde la pill de comentarios de una publicación: sólo los de ese post. */
  post?: string | null; onQuitarFiltro?: () => void;
}) {
  const [dias, setDias] = useState<(typeof RANGOS)[number]>(7);
  const [data, setData] = useState<RespComentarios | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verDeLaMarca, setVerDeLaMarca] = useState(false);
  const [verAtendidos, setVerAtendidos] = useState(false);
  // Lo que se acaba de atender sale en el acto, sin esperar a la relectura.
  const [atendidos, setAtendidos] = useState<Set<number>>(new Set());
  const [tick, setTick] = useState(0);
  const [posts, setPosts] = useState<Map<string, Publicada>>(new Map());

  // Se relee cada minuto: SignalLab trae comentarios nuevos cada 15 min y una respuesta cambia de estado.
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let vivo = true;
    leerComentarios(token, { marca: marca || undefined, desde: new Date(Date.now() - dias * DIA).toISOString() })
      .then((r) => { if (vivo) { setData(r); setError(null); setAtendidos(new Set()); } })
      .catch((e) => vivo && setError(e instanceof ErrorApi ? e.message : String(e)));
    return () => { vivo = false; };
  }, [token, marca, dias, tick]);

  // La publicación comentada, para dar contexto. SignalLab lee comentarios hasta los 7 días del post,
  // así que se piden las publicaciones de la ventana más 7 días. Si falla, la bandeja sigue sin contexto.
  useEffect(() => {
    let vivo = true;
    ops<RespPublicado>(token, 'publicado', { marca: marca || undefined, desde: new Date(Date.now() - (dias + 7) * DIA).toISOString() })
      .then((r) => { if (vivo) setPosts(new Map(r.publicaciones.map((p) => [p.id, p]))); })
      .catch((e) => console.error('[comentarios] contexto de publicaciones:', e instanceof Error ? e.message : e));
    return () => { vivo = false; };
  }, [token, marca, dias]);

  const nombre = (b: string) => marcas.find((m) => m.brand_id === b)?.nombre ?? b;
  const huso = (b: string) => marcas.find((m) => m.brand_id === b)?.huso ?? null;
  const visibles = useMemo(
    () => (data?.comentarios ?? []).filter((c) =>
      (c.estado === 'de_la_marca' ? verDeLaMarca : verAtendidos || (PENDIENTES.has(c.estado) && !atendidos.has(c.id)))
      && (!post || c.scheduled_post_id === post) && (!plataforma || c.platform === plataforma)),
    [data, verDeLaMarca, verAtendidos, atendidos, post, plataforma]);
  // Un grupo por publicación, en el orden del endpoint (lo que más espera, primero): la publicación se ve una vez.
  const grupos = useMemo(() => {
    const m = new Map<string, Comentario[]>();
    for (const c of visibles) {
      const k = c.scheduled_post_id ?? `${c.platform}|${c.platform_post_id}`;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()];
  }, [visibles]);
  const [deshacer, setDeshacer] = useState<{ id: number; autor: string; hecho: Hecho } | null>(null);
  const [errorDeshacer, setErrorDeshacer] = useState<string | null>(null);
  useEffect(() => {
    if (!deshacer) return;
    const t = setTimeout(() => setDeshacer(null), SEGUNDOS_DESHACER * 1000);
    return () => clearTimeout(t);
  }, [deshacer]);
  const atender = (id: number, hecho?: Hecho) => {
    setAtendidos((s) => new Set(s).add(id)); setTick((n) => n + 1);
    if (hecho) {
      const c = data?.comentarios.find((x) => x.id === id);
      setErrorDeshacer(null);
      setDeshacer({ id, autor: c?.author_name ?? 'el comentario', hecho });
    }
  };
  const reabrir = async () => {
    if (!deshacer) return;
    const { id, hecho } = deshacer;
    setDeshacer(null);
    try {
      await hecho.deshacer();
      setAtendidos((s) => { const n = new Set(s); n.delete(id); return n; });
    } catch (e) { setErrorDeshacer(e instanceof ErrorApi ? e.message : String(e)); }
    finally { setTick((n) => n + 1); }
  };
  const delPost = post ? posts.get(post) : undefined;
  // Con un filtro (plataforma o post), los contadores son los de lo filtrado; sin filtro, los del endpoint.
  const filtrado = !!(post || plataforma);
  const enFiltro = (data?.comentarios ?? []).filter((c) => (!post || c.scheduled_post_id === post) && (!plataforma || c.platform === plataforma));
  const pendientes = (filtrado ? enFiltro : data?.comentarios ?? [])
    .filter((c) => (c.estado === 'sin_responder' || c.estado === 'fallida') && !atendidos.has(c.id)).length;
  const total = filtrado ? enFiltro.length : data?.total ?? 0;

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
          ver atendidos (respondidos, cerrados y allegados)
        </label>
        <label className="order-last sm:order-none basis-full sm:basis-auto flex items-center gap-1.5 text-[11px] text-zinc-400 py-1">
          <input type="checkbox" checked={verDeLaMarca} onChange={(e) => setVerDeLaMarca(e.target.checked)} />
          ver también los de la marca
        </label>
        <button onClick={() => setTick((n) => n + 1)} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700">
          <RefreshCw className="w-3.5 h-3.5" /> Actualizar
        </button>
      </div>

      {post && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs text-zinc-300">
          <span className="truncate">Sólo los comentarios de esta publicación{delPost?.copy_text ? `: «${delPost.copy_text.slice(0, 80)}…»` : ''}</span>
          <button onClick={onQuitarFiltro} className="ml-auto shrink-0 underline text-accent">Ver todos</button>
        </div>
      )}
      {error && <Aviso tono="error">No se pudieron leer los comentarios: {error}</Aviso>}
      {!data && !error && <Cargando />}
      {data && (
        <>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 flex items-center gap-3 text-xs text-zinc-400">
            <MessageCircle className="w-4 h-4 text-accent" />
            <span><b className={cn('text-base', pendientes ? 'text-amber-300' : 'text-zinc-100')}>{pendientes}</b> esperan respuesta</span>
            <span className="text-zinc-600">·</span>
            <span>{total} comentarios en {dias} días</span>
          </div>
          {/* TIEMPO DE RESPUESTA (Sam, 2026-10-26): mediana, cuánto se respondió dentro de la meta y qué ya la pasó. */}
          {(data.tiempos ?? []).filter((t) => (!marca || t.brand_id === marca) && (!plataforma || t.platform === plataforma)).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(data.tiempos ?? []).filter((t) => (!marca || t.brand_id === marca) && (!plataforma || t.platform === plataforma)).map((t) => (
                <div key={`${t.brand_id}|${t.platform}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[11px] text-zinc-400"
                  style={bordeDePlataforma(t.platform)}>
                  {!marca && <span className="text-zinc-300">{nombre(t.brand_id)}</span>}
                  <ChipPlataforma platform={t.platform} />
                  <span>responde en <b className="text-zinc-100">{t.mediana_min === null ? '—' : duracion(t.mediana_min)}</b> (mediana, {t.respondidos})</span>
                  {t.meta_min !== null && t.dentro_pct !== null && (
                    <span><b className={cn(t.dentro_pct >= 80 ? 'text-emerald-300' : t.dentro_pct >= 50 ? 'text-amber-300' : 'text-red-300')}>{t.dentro_pct}%</b> dentro de {duracion(t.meta_min)}</span>
                  )}
                  {t.fuera_de_meta > 0 && <span className="text-red-300">{t.fuera_de_meta} ya pasaron la meta</span>}
                </div>
              ))}
            </div>
          )}
          {data.truncado && <Aviso tono="error">Hay más comentarios de los que se muestran: acota el rango.</Aviso>}
          {visibles.length === 0 && <Aviso>{verAtendidos ? 'No hay comentarios en esta ventana.' : 'Nada pendiente: todo lo de esta ventana está atendido.'}</Aviso>}
          <div className="space-y-4">
            {grupos.map(([k, cs]) => (
              <section key={k} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-2.5 sm:p-3 space-y-2.5" style={bordeDePlataforma(cs[0].platform)}>
                <CabeceraPublicacion c={cs[0]} post={cs[0].scheduled_post_id ? posts.get(cs[0].scheduled_post_id) : undefined}
                  nombre={nombre(cs[0].brand_id)} huso={huso(cs[0].brand_id)} />
                <ul className="space-y-2.5">
                  {cs.map((c) => (
                    <TarjetaComentario key={c.id} c={c} token={token} huso={huso(c.brand_id)}
                      onCambio={() => setTick((n) => n + 1)} onAtendido={(k) => atender(c.id, k)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
      {errorDeshacer && <Aviso tono="error">No se pudo deshacer: {errorDeshacer}</Aviso>}
      {deshacer && (
        <div role="status" className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/95 px-4 py-2.5 text-xs text-zinc-200 shadow-2xl">
          <span>{deshacer.autor}: {deshacer.hecho.etiqueta}</span>
          <button onClick={reabrir} className="flex items-center gap-1 font-bold text-accent hover:underline">
            <RotateCcw className="w-3.5 h-3.5" /> Deshacer
          </button>
        </div>
      )}
    </div>
  );
}

/** La publicación comentada, una vez por grupo: miniatura (se abre en grande), marca, plataforma, texto y enlace. */
function CabeceraPublicacion({ c, post, nombre, huso }: { c: Comentario; post?: Publicada; nombre: string; huso: string | null }) {
  const img = post ? post.image_url ?? post.media_urls?.[0] ?? null : null;
  return (
    <div className="flex items-center gap-2.5">
      {img ? <Miniatura src={img} className="w-12 h-12 rounded-lg object-cover bg-zinc-800" />
        : <div className="w-12 h-12 shrink-0 rounded-lg bg-zinc-800" />}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip className="text-zinc-200">{nombre}</Chip>
          <ChipPlataforma platform={c.platform} />
          {post && <span className="text-[10px] text-zinc-500">{fechaHora(post.published_at, huso)}</span>}
        </div>
        {post ? <p className="text-[11px] text-zinc-400 line-clamp-2">{post.copy_text ?? ''}</p>
          : <p className="text-[10px] font-mono text-zinc-600">post {c.platform_post_id}</p>}
      </div>
      {post?.enlace && (
        <a href={post.enlace} target="_blank" rel="noreferrer" title="Ver en la plataforma" className="shrink-0 p-2 rounded-lg text-accent hover:bg-zinc-800">
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

function TarjetaComentario({ c, token, huso, onCambio, onAtendido }: {
  c: Comentario; token: string; huso: string | null; onCambio: () => void;
  /** Atendido: con cómo deshacerlo si se cerró o se marcó allegado; sin nada si se respondió. */
  onAtendido: (hecho?: Hecho) => void;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState<null | 'publica' | 'privada'>(null);
  const [error, setError] = useState<string | null>(null);
  const estado = ESTADO[c.estado];
  // Respuesta privada a quien comentó (SocialLab #20): el endpoint dice si se puede y, si no, por qué.
  const privada = c.privada;
  const puedeResponder = !c.from_brand && c.estado !== 'en_curso';
  const espera_ = c.estado === 'sin_responder' || c.estado === 'fallida';
  const { recoPorComentario, pedidoPorComentario, pedirConsejo, marcarRecomendacion } = usePulso();
  const reco = recoPorComentario.get(c.id);
  const pedido = pedidoPorComentario.get(c.id);
  // La recomendación cuyo borrador se cargó en la caja: al enviar se marca seguida con lo que salió.
  const [deLaReco, setDeLaReco] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [cerrando, setCerrando] = useState<TipoCierre | Relacion | 'reabrir' | 'quitar' | null>(null);

  // Marcar a quien escribió como allegado o del equipo (Sam, 2026-10-26); con `null`, quitar la marca.
  const allegado = async (relation: Relacion | null) => {
    setCerrando(relation ?? 'quitar'); setError(null);
    try {
      await marcarAllegado(token, c.id, relation);
      if (relation) onAtendido({ etiqueta: RELACION[relation], deshacer: () => marcarAllegado(token, c.id, null) });
      else onCambio();
    } catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); }
    finally { setCerrando(null); }
  };

  // Cerrar sin responder (Sam, 2026-10-26): sale de la bandeja y el asesor no lo vuelve a proponer. O reabrir.
  const cerrar = async (kind: TipoCierre | null) => {
    setCerrando(kind ?? 'reabrir'); setError(null);
    try {
      await cerrarComentario(token, c.id, kind);
      if (kind) onAtendido({ etiqueta: CIERRE[kind], deshacer: () => cerrarComentario(token, c.id, null) }); else onCambio();
    } catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); }
    finally { setCerrando(null); }
  };

  const enviar = async (enPrivado: boolean) => {
    setEnviando(enPrivado ? 'privada' : 'publica'); setError(null);
    try {
      await responderComentario(token, c.id, texto, enPrivado);
      if (deLaReco) await marcarRecomendacion(deLaReco, 'seguida', texto).catch((e) => console.error('[comentarios] marcar seguida:', e));
      setTexto(''); setDeLaReco(null);
      // Respondido: la tarjeta se libera hasta que esa persona vuelva a comentar.
      onAtendido();
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : String(e));
      onCambio();
    } finally {
      setEnviando(null);
    }
  };
  // Descartar el consejo cuando no se está de acuerdo (Sam, 2026-10-26): queda `descartada` y sale de la tarjeta;
  // se puede volver a pedir otro.
  const descartar = async () => {
    if (!reco) return;
    setDescartando(true); setError(null);
    try {
      await marcarRecomendacion(reco.id, 'descartada');
      if (deLaReco === reco.id) setDeLaReco(null);
    } catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); }
    finally { setDescartando(false); }
  };
  const pedir = async () => {
    setPidiendo(true); setError(null);
    try { await pedirConsejo(c.brand_id, c.id); }
    catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); }
    finally { setPidiendo(false); }
  };

  return (
    <li className={cn('rounded-xl border p-3 space-y-2', espera_ ? 'border-amber-500/30 bg-amber-500/[0.03]' : 'border-zinc-800 bg-zinc-900/30',
      c.parent_comment_id && 'ml-3 sm:ml-6')} style={bordeDePlataforma(c.platform)}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cn('px-1.5 py-0.5 rounded font-mono uppercase text-[10px]', estado.clase)}>{estado.etiqueta}</span>
        <ChipPlataforma platform={c.platform} />
        {c.parent_comment_id && <Chip>respuesta en un hilo</Chip>}
        <span className="text-zinc-400 font-medium">{c.author_name ?? 'autor desconocido'}</span>
        <span className="text-zinc-600">· {fechaHora(c.commented_at, huso)}</span>
        {espera_ && (() => {
          // Pasada la meta de respuesta (dato de la marca), la espera se ve en rojo.
          const fuera = c.meta_min != null && minutosDesde(c.commented_at) > c.meta_min;
          return <span className={cn('ml-auto', fuera ? 'text-red-300 font-bold' : 'text-amber-300')}
            title={c.meta_min != null ? `Meta de respuesta: ${duracion(c.meta_min)}` : undefined}>
            espera {espera(c.commented_at)}{fuera ? ' · pasó la meta' : ''}
          </span>;
        })()}
      </div>
      <p className="texto-editorial text-sm text-zinc-100 whitespace-pre-line break-words">{c.text ?? ''}</p>
      {c.like_count ? <div className="text-[10px] text-zinc-500">{c.like_count} me gusta</div> : null}

      {c.respuestas.length > 0 && (
        <ul className="space-y-1 border-l-2 border-zinc-800 pl-3">
          {c.respuestas.map((r) => {
            const er = ESTADO_RESPUESTA[r.status];
            return (
              <li key={r.id} className="text-xs">
                {r.kind === 'privada' && <span className="mr-1 text-[10px] text-accent"><Lock className="inline w-2.5 h-2.5" /> privada</span>}
                <span className="text-zinc-300">{r.message ?? ''}</span>
                <div className="text-[10px] text-zinc-500">
                  <span className={er.clase}>{er.etiqueta}</span>
                  {r.requested_by && <> · por {r.requested_by}</>} · {fechaHora(r.requested_at, huso)}
                  {r.error && <span className="text-red-300"> · {r.error}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {puedeResponder && reco && (
        <div className="rounded-lg border border-accent/40 bg-accent/[0.04] p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-accent">
            <ChevronAsesor className="w-3 h-3" /> Sugerencia del asesor
          </div>
          <p className="text-xs text-zinc-100">{reco.recommendation}</p>
          {reco.draft && (
            <p className="texto-editorial text-xs text-zinc-300 border-l-2 border-accent/40 pl-2 whitespace-pre-line">{reco.draft}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {reco.draft && (
              <button onClick={() => { setTexto(reco.draft ?? ''); setDeLaReco(reco.id); }}
                className="px-3 py-1.5 rounded-lg border border-accent/50 text-accent text-[11px] font-bold">
                Usar el borrador
              </button>
            )}
            <button onClick={descartar} disabled={descartando} title="No estoy de acuerdo con este consejo"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-40">
              <X className="w-3.5 h-3.5" /> {descartando ? 'Descartando…' : 'Descartar'}
            </button>
          </div>
        </div>
      )}
      {puedeResponder && !reco && (
        pedido === 'pendiente' ? (
          <p className="flex items-center gap-1.5 text-[11px] text-accent">
            <ChevronAsesor className="w-3.5 h-3.5" /> Consejo pedido: el asesor lo deja aquí en unos minutos.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={pedir} disabled={pidiendo}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-accent/40 text-accent text-[11px] font-bold hover:bg-accent/10 disabled:opacity-40">
              <ChevronAsesor className="w-3.5 h-3.5" /> {pidiendo ? 'Pidiendo…' : pedido === 'con_consejo' ? 'Pedir otro consejo' : 'Pedir consejo al asesor'}
            </button>
            {pedido === 'sin_consejo' && <span className="text-[10px] text-zinc-500">La última vez el asesor no dejó consejo; puedes volver a pedirlo.</span>}
          </div>
        )
      )}
      {puedeResponder && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <textarea value={texto} onChange={(e) => { setTexto(e.target.value); if (!e.target.value.trim()) setDeLaReco(null); }} rows={2} placeholder="Escribe la respuesta de la marca…"
            className="entrada flex-1 resize-y" />
          <button onClick={() => enviar(false)} disabled={!!enviando || !texto.trim()}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-accent text-black text-xs font-bold disabled:opacity-40">
            <Send className="w-3.5 h-3.5" /> {enviando === 'publica' ? 'Enviando…' : 'Responder'}
          </button>
          {privada && (
            <button onClick={() => enviar(true)} disabled={!!enviando || !texto.trim() || !privada.puede}
              title={privada.puede ? `Mensaje privado a quien comentó${privada.hasta ? ` (hasta ${new Date(privada.hasta).toLocaleString('es')})` : ''}` : privada.motivo ?? undefined}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-accent/50 text-accent text-xs font-bold disabled:opacity-40">
              <Lock className="w-3.5 h-3.5" /> {enviando === 'privada' ? 'Enviando…' : 'Responder en privado'}
            </button>
          )}
        </div>
      )}
      {puedeResponder && privada && !privada.puede && privada.motivo && (
        <p className="text-[10px] text-zinc-500">En privado: {privada.motivo}.</p>
      )}
      {c.cierre && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
          <span>Atendido: <b className="text-zinc-300">{CIERRE[c.cierre.kind]}</b> · por {c.cierre.closed_by} · {fechaHora(c.cierre.closed_at, huso)}</span>
          <button onClick={() => cerrar(null)} disabled={!!cerrando}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-40">
            <RotateCcw className="w-3 h-3" /> {cerrando === 'reabrir' ? 'Reabriendo…' : 'Reabrir'}
          </button>
        </div>
      )}
      {c.allegado && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
          <span><Users className="inline w-3 h-3 mr-0.5" /> {c.author_name}: <b className="text-zinc-300">{RELACION[c.allegado]}</b>. Sus comentarios no esperan respuesta.</span>
          <button onClick={() => allegado(null)} disabled={!!cerrando}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-zinc-400 hover:bg-zinc-800 disabled:opacity-40">
            <RotateCcw className="w-3 h-3" /> {cerrando === 'quitar' ? 'Quitando…' : 'Quitar la marca'}
          </button>
        </div>
      )}
      {!c.from_brand && !c.cierre && !c.allegado && c.estado !== 'respondido' && c.estado !== 'en_curso' && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[10px] text-zinc-600 mr-1">Sin responder desde aquí:</span>
          <button onClick={() => cerrar('hecho')} disabled={!!cerrando} title="Ya se hizo (p. ej. se fijó en la app): sale de la bandeja"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40">
            <Check className="w-3.5 h-3.5" /> {cerrando === 'hecho' ? 'Cerrando…' : 'Hecho'}
          </button>
          <button onClick={() => cerrar('contestado_fuera')} disabled={!!cerrando} title="Se contestó por otra vía (la app, un mensaje)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40">
            <MessageCircle className="w-3.5 h-3.5" /> {cerrando === 'contestado_fuera' ? 'Cerrando…' : 'Contestado fuera'}
          </button>
          <button onClick={() => cerrar('descartado')} disabled={!!cerrando} title="No es viable responderlo: sale de la bandeja"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-40">
            <X className="w-3.5 h-3.5" /> {cerrando === 'descartado' ? 'Descartando…' : 'Descartar'}
          </button>
          {c.author_name && (
            <>
              <span className="text-zinc-700">·</span>
              <button onClick={() => allegado('allegado')} disabled={!!cerrando} title={`${c.author_name} es amistad o familia: sus comentarios no esperan respuesta`}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-violet-300 hover:bg-violet-500/10 disabled:opacity-40">
                <Users className="w-3.5 h-3.5" /> {cerrando === 'allegado' ? 'Marcando…' : 'Allegado'}
              </button>
              <button onClick={() => allegado('equipo')} disabled={!!cerrando} title={`${c.author_name} es del equipo: sus comentarios no esperan respuesta`}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-violet-300 hover:bg-violet-500/10 disabled:opacity-40">
                {cerrando === 'equipo' ? 'Marcando…' : 'Equipo'}
              </button>
            </>
          )}
        </div>
      )}
      {c.estado === 'fallida' && (
        <p className="text-[10px] text-zinc-500">Antes de reintentar, mira en la plataforma si la respuesta salió: un reintento puede duplicarla.</p>
      )}
      {error && <Aviso tono="error">{error}</Aviso>}
    </li>
  );
}
