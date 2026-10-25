import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, RefreshCw, Send } from 'lucide-react';
import {
  comentarios as leerComentarios, responderComentario, ops, ErrorApi,
  type Comentario, type EstadoComentario, type Marca, type Publicada, type RespComentarios, type RespPublicado, type RespuestaComentario,
} from '../api';
import { Aviso, Cargando, Chip, cn, etiquetaPlataforma, fechaHora } from '../ui/components';

/**
 * COMENTARIOS · la bandeja de interacción (Fase 3; endpoint `/api/comments`, SocialLab #14).
 *
 * Lo que espera a alguien va primero (el endpoint ya lo ordena). Cada respuesta se asienta antes de
 * salir y se verifica leyéndola desde la plataforma: la tarjeta muestra si quedó enviada, verificada o
 * fallida, y quién la pidió. Una respuesta la escribe y la envía una persona; aquí no hay respuestas
 * automáticas.
 */

const DIA = 86_400_000;
const RANGOS = [3, 7, 30] as const;

const ESTADO: Record<EstadoComentario, { etiqueta: string; clase: string }> = {
  sin_responder: { etiqueta: 'sin responder', clase: 'bg-amber-500/15 text-amber-300' },
  fallida: { etiqueta: 'respuesta fallida', clase: 'bg-red-500/15 text-red-300' },
  en_curso: { etiqueta: 'respuesta en curso', clase: 'bg-sky-500/15 text-sky-300' },
  respondido: { etiqueta: 'respondido', clase: 'bg-emerald-500/15 text-emerald-300' },
  de_la_marca: { etiqueta: 'de la marca', clase: 'bg-zinc-700/60 text-zinc-300' },
};

const ESTADO_RESPUESTA: Record<RespuestaComentario['status'], { etiqueta: string; clase: string }> = {
  requested: { etiqueta: 'pedida', clase: 'text-sky-300' },
  sent: { etiqueta: 'enviada, sin verificar', clase: 'text-amber-300' },
  verified: { etiqueta: 'verificada en la plataforma', clase: 'text-emerald-300' },
  failed: { etiqueta: 'fallida', clase: 'text-red-300' },
};

/** Cuánto lleva esperando: en minutos, horas o días. */
function espera(desde: string, ahora = Date.now()): string {
  const min = Math.max(0, Math.round((ahora - Date.parse(desde)) / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

export default function Comentarios({ token, marca, marcas }: { token: string; marca: string; marcas: Marca[] }) {
  const [dias, setDias] = useState<(typeof RANGOS)[number]>(7);
  const [data, setData] = useState<RespComentarios | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verDeLaMarca, setVerDeLaMarca] = useState(false);
  const [tick, setTick] = useState(0);
  const [posts, setPosts] = useState<Map<string, Publicada>>(new Map());

  // Se relee cada minuto: SignalLab trae comentarios nuevos cada 15 min y una respuesta cambia de estado.
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let vivo = true;
    leerComentarios(token, { marca: marca || undefined, desde: new Date(Date.now() - dias * DIA).toISOString() })
      .then((r) => { if (vivo) { setData(r); setError(null); } })
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
    () => (data?.comentarios ?? []).filter((c) => verDeLaMarca || c.estado !== 'de_la_marca'),
    [data, verDeLaMarca]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {RANGOS.map((r) => (
          <button key={r} onClick={() => setDias(r)}
            className={cn('px-3 py-1.5 rounded-lg text-xs border', dias === r ? 'bg-accent text-black border-accent' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-800')}>
            {r} días
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 ml-2">
          <input type="checkbox" checked={verDeLaMarca} onChange={(e) => setVerDeLaMarca(e.target.checked)} />
          ver también los comentarios de la marca
        </label>
        <button onClick={() => setTick((n) => n + 1)} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700">
          <RefreshCw className="w-3.5 h-3.5" /> Actualizar
        </button>
      </div>

      {error && <Aviso tono="error">No se pudieron leer los comentarios: {error}</Aviso>}
      {!data && !error && <Cargando />}
      {data && (
        <>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 flex items-center gap-3 text-xs text-zinc-400">
            <MessageCircle className="w-4 h-4 text-accent" />
            <span><b className={cn('text-base', data.pendientes ? 'text-amber-300' : 'text-zinc-100')}>{data.pendientes}</b> esperan respuesta</span>
            <span className="text-zinc-600">·</span>
            <span>{data.total} comentarios en {dias} días</span>
          </div>
          {data.truncado && <Aviso tono="error">Hay más comentarios de los que se muestran: acota el rango.</Aviso>}
          {visibles.length === 0 && <Aviso>No hay comentarios en esta ventana.</Aviso>}
          <ul className="space-y-3">
            {visibles.map((c) => (
              <TarjetaComentario key={c.id} c={c} post={c.scheduled_post_id ? posts.get(c.scheduled_post_id) : undefined}
                token={token} nombre={nombre(c.brand_id)} huso={huso(c.brand_id)}
                onCambio={() => setTick((n) => n + 1)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TarjetaComentario({ c, post, token, nombre, huso, onCambio }: {
  c: Comentario; post?: Publicada; token: string; nombre: string; huso: string | null; onCambio: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estado = ESTADO[c.estado];
  const puedeResponder = !c.from_brand && c.estado !== 'en_curso';
  const espera_ = c.estado === 'sin_responder' || c.estado === 'fallida';

  const enviar = async () => {
    setEnviando(true); setError(null);
    try {
      await responderComentario(token, c.id, texto);
      setTexto('');
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : String(e));
    } finally {
      setEnviando(false);
      onCambio();
    }
  };

  return (
    <li className={cn('rounded-xl border p-3 space-y-2', espera_ ? 'border-amber-500/30 bg-amber-500/[0.03]' : 'border-zinc-800 bg-zinc-900/30',
      c.parent_comment_id && 'ml-6')}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cn('px-1.5 py-0.5 rounded font-mono uppercase text-[10px]', estado.clase)}>{estado.etiqueta}</span>
        <Chip className="text-zinc-200">{nombre}</Chip>
        <Chip>{etiquetaPlataforma(c.platform)}</Chip>
        {c.parent_comment_id && <Chip>respuesta en un hilo</Chip>}
        <span className="text-zinc-400 font-medium">{c.author_name ?? 'autor desconocido'}</span>
        <span className="text-zinc-600">· {fechaHora(c.commented_at, huso)}</span>
        {espera_ && <span className="ml-auto font-mono text-amber-300">espera {espera(c.commented_at)}</span>}
      </div>
      <p className="text-sm text-zinc-200 whitespace-pre-line">{c.text ?? ''}</p>
      {post ? (
        <a href={post.enlace ?? undefined} target="_blank" rel="noreferrer"
          className="flex items-center gap-2 rounded-lg bg-zinc-950/50 border border-zinc-800 p-1.5 hover:border-zinc-700">
          {(post.image_url ?? post.media_urls?.[0]) && (
            <img src={(post.image_url ?? post.media_urls?.[0])!} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-10 h-10 rounded object-cover" />
          )}
          <span className="flex-1 min-w-0 text-[11px] text-zinc-400 truncate">{post.copy_text ?? ''}</span>
          <span className="text-[10px] text-zinc-600 shrink-0">{fechaHora(post.published_at, huso)}</span>
        </a>
      ) : (
        <div className="text-[10px] font-mono text-zinc-600">post {c.platform_post_id}</div>
      )}
      {c.like_count ? <div className="text-[10px] text-zinc-500">{c.like_count} me gusta</div> : null}

      {c.respuestas.length > 0 && (
        <ul className="space-y-1 border-l-2 border-zinc-800 pl-3">
          {c.respuestas.map((r) => {
            const er = ESTADO_RESPUESTA[r.status];
            return (
              <li key={r.id} className="text-xs">
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

      {puedeResponder && (
        <div className="flex items-end gap-2">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Escribe la respuesta de la marca…"
            className="entrada flex-1 resize-y" />
          <button onClick={enviar} disabled={enviando || !texto.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-black text-xs font-semibold disabled:opacity-40">
            <Send className="w-3.5 h-3.5" /> {enviando ? 'Enviando…' : 'Responder'}
          </button>
        </div>
      )}
      {c.estado === 'fallida' && (
        <p className="text-[10px] text-zinc-500">Antes de reintentar, mira en la plataforma si la respuesta salió: un reintento puede duplicarla.</p>
      )}
      {error && <Aviso tono="error">{error}</Aviso>}
    </li>
  );
}
