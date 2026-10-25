import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, ExternalLink, MessageCircle, X } from 'lucide-react';
import { comentarios as leerComentarios, ops, type EnVivo, type Marca, type RespEnVivo } from '../api';
import { aumentosDeComentarios, combinarMetricas, METRICA_COMENTARIOS, type MetricaMedida } from '../pulso';
import { Pills } from './Pills';
import { etiquetaPlataforma } from './components';

/**
 * PULSO DEL TABLERO · una sola lectura en vivo y una sola bandeja para todas las pestañas.
 *
 * · En vivo: el listado de la plataforma cada minuto, sólo con la pestaña del navegador visible
 *   (cada lectura es una llamada a Meta por cuenta; con la pestaña oculta no se gasta cuota).
 * · Comentarios: `/api/comments` cada minuto. Lo que espera respuesta se cuenta por publicación.
 * · Comentario nuevo: el contador en vivo de un post sube, o aparece en la bandeja un comentario
 *   pendiente que esta sesión no había visto. Abre el aviso hasta que el operador lo atiende.
 */

const REFRESCO_MS = 60_000;
const DIA = 86_400_000;
/** Ventana de la bandeja que alimenta el aviso: la misma que abre la pestaña Comentarios. */
const DIAS_BANDEJA = 7;
/** Lo que espera a alguien. Vocabulario de `/api/comments` (#14). */
const ESPERAN = new Set(['sin_responder', 'fallida']);

export interface Nuevo {
  clave: string; brand_id: string; platform: string; scheduled_post_id: string | null;
  permalink: string | null; cuantos: number; en_bandeja: boolean;
}

interface Pulso {
  vivo: RespEnVivo | null; errorVivo: string | null; cargandoVivo: boolean; leidoVivoEn: number | null;
  vivoPorId: Map<string, EnVivo>; recargar: () => void;
  pendientesPorPost: Map<string, number>; pendientes: number;
  nuevos: Nuevo[]; nuevosPorPost: Set<string>;
  atender: (scheduledPostId: string | null) => void; descartar: () => void;
}

const Ctx = createContext<Pulso | null>(null);
export const usePulso = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePulso fuera de <ProveedorPulso>');
  return c;
};

/** Una pestaña visible. Con la pestaña oculta no se lee la plataforma. */
function useVisible(): boolean {
  const [v, setV] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const f = () => setV(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  return v;
}

export function ProveedorPulso({ token, marca, onAtender, children }: {
  token: string; marca: string; onAtender: (scheduledPostId: string | null) => void; children: React.ReactNode;
}) {
  const visible = useVisible();
  const [tick, setTick] = useState(0);
  const [vivo, setVivo] = useState<RespEnVivo | null>(null);
  const [errorVivo, setErrorVivo] = useState<string | null>(null);
  const [cargandoVivo, setCargandoVivo] = useState(false);
  const [leidoVivoEn, setLeidoVivoEn] = useState<number | null>(null);
  const [pendientesPorPost, setPendientesPorPost] = useState<Map<string, number>>(new Map());
  const [nuevos, setNuevos] = useState<Nuevo[]>([]);
  const contadoresPrevios = useRef<Map<string, number> | null>(null);
  const pendientesVistos = useRef<Set<number> | null>(null);

  // Al cambiar de marca, la comparación empieza de cero: lo de otra marca no es «nuevo».
  useEffect(() => { contadoresPrevios.current = null; pendientesVistos.current = null; setNuevos([]); }, [marca]);

  useEffect(() => {
    if (!visible) return;
    setTick((n) => n + 1); // al volver a la pestaña, se lee en el acto
    const t = setInterval(() => setTick((n) => n + 1), REFRESCO_MS);
    return () => clearInterval(t);
  }, [visible]);

  const sumar = useCallback((n: Nuevo) => setNuevos((xs) => {
    const i = xs.findIndex((x) => x.clave === n.clave);
    if (i < 0) return [...xs, n];
    const copia = [...xs];
    copia[i] = { ...copia[i], cuantos: copia[i].cuantos + n.cuantos, en_bandeja: copia[i].en_bandeja || n.en_bandeja };
    return copia;
  }), []);

  useEffect(() => {
    if (tick === 0) return;
    let activo = true;
    setCargandoVivo(true);
    ops<RespEnVivo>(token, 'envivo', { marca: marca || undefined, limite: '50' })
      .then((r) => {
        if (!activo) return;
        setVivo(r); setErrorVivo(null); setLeidoVivoEn(Date.now());
        const lectura = r.publicaciones.flatMap((p) => {
          const c = p.contadores?.find((x) => x.metric === METRICA_COMENTARIOS);
          return c ? [{ platform_post_id: p.platform_post_id, comments: c.value }] : [];
        });
        const porId = new Map(r.publicaciones.map((p) => [p.platform_post_id, p]));
        for (const a of aumentosDeComentarios(contadoresPrevios.current, lectura)) {
          const p = porId.get(a.platform_post_id)!;
          sumar({ clave: p.scheduled_post_id ?? p.platform_post_id, brand_id: p.brand_id, platform: p.platform,
            scheduled_post_id: p.scheduled_post_id, permalink: p.permalink, cuantos: a.ahora - a.antes, en_bandeja: false });
        }
        contadoresPrevios.current = new Map(lectura.map((l) => [l.platform_post_id, l.comments]));
      })
      .catch((e) => activo && setErrorVivo(e instanceof Error ? e.message : String(e)))
      .finally(() => activo && setCargandoVivo(false));
    return () => { activo = false; };
  }, [token, marca, tick, sumar]);

  useEffect(() => {
    if (tick === 0) return;
    let activo = true;
    leerComentarios(token, { marca: marca || undefined, desde: new Date(Date.now() - DIAS_BANDEJA * DIA).toISOString() })
      .then((r) => {
        if (!activo) return;
        const esperan = r.comentarios.filter((c) => !c.from_brand && ESPERAN.has(c.estado));
        const porPost = new Map<string, number>();
        for (const c of esperan) if (c.scheduled_post_id) porPost.set(c.scheduled_post_id, (porPost.get(c.scheduled_post_id) ?? 0) + 1);
        setPendientesPorPost(porPost);
        // Lo pendiente que ya estaba al abrir no es «nuevo»: es trabajo, y lo cuenta `pendientes`.
        if (pendientesVistos.current) {
          for (const c of esperan) {
            if (pendientesVistos.current.has(c.id)) continue;
            sumar({ clave: c.scheduled_post_id ?? c.platform_post_id, brand_id: c.brand_id, platform: c.platform,
              scheduled_post_id: c.scheduled_post_id, permalink: null, cuantos: 0, en_bandeja: true });
          }
        }
        pendientesVistos.current = new Set(esperan.map((c) => c.id));
        // Un aviso que ya llegó a la bandeja deja de pedir «míralo en la plataforma».
        setNuevos((xs) => xs.map((x) => (x.scheduled_post_id && porPost.has(x.scheduled_post_id) ? { ...x, en_bandeja: true } : x)));
      })
      .catch((e) => console.error('[pulso] bandeja de comentarios:', e instanceof Error ? e.message : e));
    return () => { activo = false; };
  }, [token, marca, tick, sumar]);

  const pendientes = useMemo(() => [...pendientesPorPost.values()].reduce((s, n) => s + n, 0), [pendientesPorPost]);

  // El título de la pestaña del navegador lleva la cuenta: se ve aunque el operador esté en otra.
  useEffect(() => {
    const n = nuevos.length;
    document.title = n ? `(${n}) Nuevo comentario · SocialLab` : pendientes ? `(${pendientes}) SocialLab` : 'SocialLab';
  }, [nuevos.length, pendientes]);

  const valor = useMemo<Pulso>(() => ({
    vivo, errorVivo, cargandoVivo, leidoVivoEn,
    vivoPorId: new Map((vivo?.publicaciones ?? []).map((v) => [v.platform_post_id, v])),
    recargar: () => setTick((n) => n + 1),
    pendientesPorPost, pendientes, nuevos,
    nuevosPorPost: new Set(nuevos.flatMap((n) => (n.scheduled_post_id ? [n.scheduled_post_id] : []))),
    atender: (id) => { setNuevos((xs) => xs.filter((x) => x.scheduled_post_id !== id)); onAtender(id); },
    descartar: () => setNuevos([]),
  }), [vivo, errorVivo, cargandoVivo, leidoVivoEn, pendientesPorPost, pendientes, nuevos, onAtender]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/** El aviso: arriba de todas las pestañas, mientras haya un comentario nuevo o algo esperando. */
export function AvisoComentarios({ marcas }: { marcas: Marca[] }) {
  const { nuevos, pendientes, atender, descartar } = usePulso();
  const nombre = (b: string) => marcas.find((m) => m.brand_id === b)?.nombre ?? b;
  if (nuevos.length === 0 && pendientes === 0) return null;
  if (nuevos.length === 0) {
    return (
      <button onClick={() => atender(null)}
        className="w-full flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200 hover:bg-amber-500/10">
        <MessageCircle className="w-4 h-4" /> <b>{pendientes}</b> {pendientes === 1 ? 'comentario espera' : 'comentarios esperan'} respuesta
        <span className="ml-auto underline">Atender</span>
      </button>
    );
  }
  return (
    <div role="alert" className="aviso-nuevo rounded-xl border border-amber-400/60 bg-amber-500/10 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
        <BellRing className="w-4 h-4 campana" />
        {nuevos.length === 1 ? 'Nuevo comentario' : `${nuevos.length} publicaciones con comentarios nuevos`}
        {pendientes > 0 && <span className="text-[11px] font-normal text-amber-300/80">· {pendientes} esperan respuesta en total</span>}
        <button onClick={descartar} title="Descartar el aviso" className="ml-auto p-1 rounded hover:bg-amber-500/20"><X className="w-3.5 h-3.5" /></button>
      </div>
      <ul className="space-y-1">
        {nuevos.slice(0, 5).map((n) => (
          <li key={n.clave} className="flex flex-wrap items-center gap-2 text-xs text-zinc-200">
            <span>{nombre(n.brand_id)} · {etiquetaPlataforma(n.platform)}{n.cuantos > 1 ? ` · ${n.cuantos} nuevos` : ''}</span>
            {!n.en_bandeja && <span className="text-[10px] text-zinc-400">llega a la bandeja con la próxima lectura de SignalLab</span>}
            <span className="ml-auto flex items-center gap-2">
              {!n.en_bandeja && n.permalink && (
                <a href={n.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-accent hover:underline">
                  Ver en la plataforma <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <button onClick={() => atender(n.scheduled_post_id)} className="px-2.5 py-1 rounded-lg bg-amber-400 text-black text-[11px] font-semibold">Atender</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Las pills de una publicación del libro: lo medido por SignalLab más lo leído en vivo, y la pill de
 * comentarios como botón hacia la bandeja de ESE post.
 */
export function PillsDePost({ id, platformPostId, metricas, sinMedir }: {
  id: string; platformPostId: string | null; metricas: MetricaMedida[]; sinMedir?: string;
}) {
  const { vivoPorId, pendientesPorPost, nuevosPorPost, atender } = usePulso();
  const enVivo = platformPostId ? vivoPorId.get(platformPostId)?.contadores : undefined;
  return (
    <Pills metricas={combinarMetricas(metricas, enVivo)} sinMedir={sinMedir}
      comentarios={{ pendientes: pendientesPorPost.get(id) ?? 0, nuevo: nuevosPorPost.has(id), onClick: () => atender(id) }} />
  );
}
