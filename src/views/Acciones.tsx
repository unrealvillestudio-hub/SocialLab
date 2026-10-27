import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Lock, RefreshCw, Send, X } from 'lucide-react';
import { ops, responderComentario, comentarEnPublicacion, ErrorApi, type Marca, type Publicada, type Recomendacion, type RespPublicado, type Tarjeta } from '../api';
import { claveDeCuenta } from '../asesor';
import { usePulso, PillsDePost, type FocoAsesor } from '../ui/Pulso';
import { Aviso, Chip, ChipPlataforma, Miniatura, VistaPrevia, bordeDePlataforma, cn, etiquetaPlataforma, fechaHora, ChevronAsesor } from '../ui/components';
import { Maqueta, maquetaDe } from '../ui/Maqueta';

/**
 * ACCIONES · el asesor (Fase 4; tarjetas de SignalLab, `intel.signal_cards`). Sam, 2026-10-25: «un community
 * manager conducido». Cada tarjeta dice qué pasa, por qué importa (con la cifra y su base) y para qué
 * actuar, y trae el botón de la acción:
 *   · `api`        → se hace aquí (responder el comentario, en público o en privado);
 *   · `api` sin comentario (abrir un debate, mencionar a un aliado) → se publica aquí como comentario de la marca en su
 *                    publicación (2026-10-26, `post_comment_tool`); el texto sigue copiable;
 *   · `app_nativa` → enlace a la publicación, para hacerlo en la app de la plataforma (hoy: fijar un comentario);
 *   · `interna`    → sólo la ve quien tiene alcance total (aprendizaje del estudio).
 * «Seguir» y «Descartar» quedan registrados con quién y cuándo; «resuelta» la pone el sistema.
 *
 * (Sam, 2026-10-26) «Hecho» sobre el consejo de un comentario cierra el comentario: sale de la bandeja y el asesor no lo
 * vuelve a proponer. Cada publicación lleva «Pedir consejo sobre esta publicación» (también desde Publicado) y el color
 * de su plataforma.
 */

const DIA = 86_400_000;
const ESTILO_SEVERIDAD: Record<string, { etiqueta: string; clase: string }> = {
  atencion: { etiqueta: 'atención', clase: 'border-amber-400/60 bg-amber-500/[0.06]' },
  oportunidad: { etiqueta: 'oportunidad', clase: 'border-accent/50 bg-accent/[0.04]' },
  info: { etiqueta: 'info', clase: 'border-zinc-700 bg-zinc-900' },
};
const CHIP_SEVERIDAD: Record<string, string> = {
  atencion: 'bg-amber-500/15 text-amber-300', oportunidad: 'bg-accent/10 text-accent', info: 'bg-zinc-800 text-zinc-300',
};
const ESTADO: Record<string, string> = { nueva: 'nueva', vista: 'vista', seguida: 'seguida', descartada: 'descartada', resuelta: 'resuelta' };
const numero = (n: number | null) => (n == null ? '—' : (Number.isInteger(Number(n)) ? Number(n) : Math.round(Number(n) * 10) / 10).toLocaleString('en-US'));

export default function Acciones({ token, marca, plataforma, marcas, foco, onQuitarFoco }: {
  token: string; marca: string; plataforma: string; marcas: Marca[]; foco: FocoAsesor; onQuitarFoco: () => void;
}) {
  const { tarjetas, tarjetasPorPost, tarjetasPorCuenta, recomendaciones, recosPorPost, recosPorCuenta, pedirConsejo } = usePulso();
  const [pedido, setPedido] = useState<{ ok: boolean; texto: string } | null>(null);
  // Con una sola marca en el alcance, el selector la muestra aunque el filtro diga «todas».
  const marcaDelPedido = marca || (marcas.length === 1 ? marcas[0].brand_id : '');
  const pedir = async () => {
    setPedido(null);
    try { await pedirConsejo(marcaDelPedido); setPedido({ ok: true, texto: 'Pedido en cola: el asesor revisará esta marca y sus consejos aparecerán aquí.' }); }
    catch (e) { setPedido({ ok: false, texto: e instanceof ErrorApi ? e.message : String(e) }); }
  };
  const [posts, setPosts] = useState<Map<string, Publicada>>(new Map());

  // Las publicaciones de las tarjetas, para que la tarjeta viaje con su post (imagen, texto y pills).
  useEffect(() => {
    let vivo = true;
    ops<RespPublicado>(token, 'publicado', { marca: marca || undefined, desde: new Date(Date.now() - 30 * DIA).toISOString() })
      .then((r) => { if (vivo) setPosts(new Map(r.publicaciones.map((p) => [p.id, p]))); })
      .catch((e) => console.error('[acciones] publicaciones:', e instanceof Error ? e.message : e));
    return () => { vivo = false; };
  }, [token, marca]);

  const nombre = (b: string) => marcas.find((m) => m.brand_id === b)?.nombre ?? b;
  const huso = (b: string) => marcas.find((m) => m.brand_id === b)?.huso ?? null;

  // Grupos: uno por publicación y uno por cuenta, con sus tarjetas (SignalLab) y sus recomendaciones (asesor).
  // Orden: el de la tarjeta más urgente (el del endpoint); detrás, los grupos que sólo tienen recomendaciones.
  const grupos = useMemo(() => {
    const pasa = (x: { platform: string | null }) => !plataforma || x.platform === plataforma;
    const out: { clave: string; post?: string; cuenta?: string; tarjetas: Tarjeta[]; recos: Recomendacion[] }[] = [];
    const vistos = new Set<string>();
    const postDe = (id: string, mapa: Map<string, { id: string }[]>) => [...mapa.entries()].find(([, xs]) => xs.some((x) => x.id === id))?.[0];
    const sumar = (post: string | undefined, brand: string, platform: string | null) => {
      const cuenta = claveDeCuenta(brand, platform ?? '');
      const clave = post ? `p:${post}` : `c:${cuenta}`;
      if (vistos.has(clave)) return;
      vistos.add(clave);
      out.push(post
        ? { clave, post, tarjetas: (tarjetasPorPost.get(post) ?? []).filter(pasa), recos: (recosPorPost.get(post) ?? []).filter(pasa) }
        : { clave, cuenta, tarjetas: (tarjetasPorCuenta.get(cuenta) ?? []).filter(pasa), recos: (recosPorCuenta.get(cuenta) ?? []).filter(pasa) });
    };
    for (const t of tarjetas.filter(pasa)) sumar(postDe(t.id, tarjetasPorPost), t.brand_id, t.platform);
    for (const r of recomendaciones.filter(pasa)) sumar(postDe(r.id, recosPorPost), r.brand_id, r.platform);
    if (!foco) return out;
    const k = 'post' in foco ? `p:${foco.post}` : `c:${foco.cuenta}`;
    return [...out.filter((g) => g.clave === k), ...out.filter((g) => g.clave !== k)];
  }, [tarjetas, tarjetasPorPost, tarjetasPorCuenta, recomendaciones, recosPorPost, recosPorCuenta, plataforma, foco]);

  const claveFoco = foco ? ('post' in foco ? `p:${foco.post}` : `c:${foco.cuenta}`) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 min-w-[14rem] text-[11px] text-zinc-500">
          Consejos del asesor: las alertas de SignalLab, con su cifra y contra qué se compara, y las recomendaciones con borrador. Lo más urgente va primero.
        </p>
        <button onClick={pedir} disabled={!marcaDelPedido} title={marcaDelPedido ? 'El asesor revisa esta marca ahora' : 'Elige una marca para pedir consejo'}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-accent/50 text-accent text-xs font-bold disabled:opacity-40">
          <RefreshCw className="w-3.5 h-3.5" /> Pedir consejo ahora
        </button>
      </div>
      {pedido && <Aviso tono={pedido.ok ? 'info' : 'error'}>{pedido.texto}</Aviso>}
      {foco && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs text-zinc-300">
          <ChevronAsesor className="w-3.5 h-3.5 text-accent" /> Abierto desde su publicación: aparece primero.
          <button onClick={onQuitarFoco} className="ml-auto underline text-accent">Quitar</button>
        </div>
      )}
      {/* Abierta desde Publicado sin consejos todavía: la publicación igual se muestra, para pedirlos. */}
      {foco && 'post' in foco && !grupos.some((g) => g.post === foco.post) && (
        <section className="rounded-2xl border border-accent/60 p-3 sm:p-4 space-y-3 bg-zinc-900" style={bordeDePlataforma(posts.get(foco.post)?.platform)}>
          <Publicacion p={posts.get(foco.post)} id={foco.post} nombre={nombre} huso={huso}
            t={{ brand_id: posts.get(foco.post)?.brand_id ?? marcaDelPedido, platform: posts.get(foco.post)?.platform ?? null }} />
          <p className="text-[11px] text-zinc-500">Esta publicación no tiene consejos abiertos.</p>
        </section>
      )}
      {grupos.length === 0 && !(foco && 'post' in foco) && (
        <Aviso>No hay consejos abiertos{plataforma ? ' para esta plataforma' : ''}. Aparecen cuando SignalLab detecta algo que hacer
          (por ejemplo, una pregunta sin responder hace más de 4 h).</Aviso>
      )}
      {grupos.map((g) => (
        <section key={g.clave} className={cn('rounded-2xl border p-3 sm:p-4 space-y-3 bg-zinc-900',
          g.clave === claveFoco ? 'border-accent/60 shadow-[0_0_0_1px_rgba(0,255,209,0.25)]' : 'border-zinc-800')}
          style={bordeDePlataforma((g.tarjetas[0] ?? g.recos[0])?.platform ?? (g.post ? posts.get(g.post)?.platform : null))}>
          {g.post ? <Publicacion p={posts.get(g.post)} id={g.post} nombre={nombre} huso={huso} t={g.tarjetas[0] ?? g.recos[0]} />
            : <Cuenta clave={g.cuenta!} nombre={nombre} />}
          <ul className="space-y-2">
            {g.tarjetas.map((t) => <TarjetaAsesor key={t.id} t={t} token={token} enlace={g.post ? posts.get(g.post)?.enlace ?? null : null} huso={huso(t.brand_id)} />)}
            {g.recos.map((r) => <RecomendacionAsesor key={r.id} r={r} token={token} enlace={g.post ? posts.get(g.post)?.enlace ?? null : null} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** La publicación viaja con sus consejos: miniatura, texto, fecha y sus pills. */
function Publicacion({ p, id, nombre, huso, t }: {
  p?: Publicada; id: string; nombre: (b: string) => string; huso: (b: string) => string | null; t: { brand_id: string; platform: string | null };
}) {
  const img = p ? (p.image_url ?? p.media_urls?.[0] ?? null) : null;
  const { pedirConsejo, pedidoPorPublicacion } = usePulso();
  const [pidiendo, setPidiendo] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const pedido = pedidoPorPublicacion.get(id);
  const pedir = async () => {
    setPidiendo(true); setAviso(null);
    try { await pedirConsejo(t.brand_id, undefined, id); setAviso({ ok: true, texto: 'Consejo pedido: el asesor lo deja aquí en unos minutos.' }); }
    catch (e) { setAviso({ ok: false, texto: e instanceof ErrorApi ? e.message : String(e) }); }
    finally { setPidiendo(false); }
  };
  // La publicación se dibuja como en su plataforma, si su plataforma tiene maqueta (Sam, 2026-10-27).
  const conMaqueta = !!p && !!maquetaDe(p.platform, p.formato);
  const [vista, setVista] = useState<string | null>(null);
  return (
    <div className={cn('flex gap-3', conMaqueta && 'flex-col sm:flex-row')}>
      {conMaqueta && p ? (
        <div className="w-full sm:w-64 shrink-0 rounded-lg border border-zinc-800 overflow-hidden">
          <Maqueta platform={p.platform} formato={p.formato} datos={{
            cuenta: nombre(t.brand_id), imagenes: [...new Set([p.image_url, ...(p.media_urls ?? [])].filter((x): x is string => !!x))],
            texto: p.copy_text, fecha: fechaHora(p.published_at, huso(t.brand_id)), onImagen: setVista,
          }} />
          {vista && <VistaPrevia src={vista} onCerrar={() => setVista(null)} />}
        </div>
      ) : img ? <Miniatura src={img} className="w-16 h-16 rounded-lg object-cover bg-zinc-800" />
        : <div className="w-16 h-16 shrink-0 rounded-lg bg-zinc-800" />}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip className="text-zinc-200">{nombre(t.brand_id)}</Chip>
          <ChipPlataforma platform={t.platform ?? p?.platform ?? ''} />
          {p && <span className="text-[10px] text-zinc-500">{fechaHora(p.published_at, huso(t.brand_id))}</span>}
        </div>
        {p ? (!conMaqueta && <p className="texto-editorial text-xs text-zinc-300 line-clamp-2">{p.copy_text ?? ''}</p>)
          : <p className="text-[10px] text-zinc-600">publicación {id} (fuera de los últimos 30 días)</p>}
        {p && <PillsDePost id={p.id} platformPostId={p.platform_post_id} metricas={p.metricas} />}
        {p && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {pedido === 'pendiente' ? (
              <span className="flex items-center gap-1.5 text-[11px] text-accent"><ChevronAsesor className="w-3.5 h-3.5" /> Consejo pedido: llega en unos minutos.</span>
            ) : (
              <button onClick={pedir} disabled={pidiendo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent/40 text-accent text-[11px] font-bold hover:bg-accent/10 disabled:opacity-40">
                <ChevronAsesor className="w-3.5 h-3.5" /> {pidiendo ? 'Pidiendo…' : 'Pedir consejo sobre esta publicación'}
              </button>
            )}
            {pedido === 'sin_consejo' && <span className="text-[10px] text-zinc-500">La última vez el asesor no dejó consejo nuevo.</span>}
            {aviso && <span className={cn('text-[10px]', aviso.ok ? 'text-zinc-400' : 'text-red-300')}>{aviso.texto}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Cuenta({ clave, nombre }: { clave: string; nombre: (b: string) => string }) {
  const [brand, platform] = clave.split('|');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip className="text-zinc-200">{nombre(brand)}</Chip>
      <ChipPlataforma platform={platform} />
      <span className="text-[11px] text-zinc-400">la cuenta</span>
    </div>
  );
}

function TarjetaAsesor({ t, token, enlace, huso }: { t: Tarjeta; token: string; enlace: string | null; huso: string | null }) {
  const { marcarTarjeta, comentariosPorId, recargarTarjetas } = usePulso();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState<null | 'publica' | 'privada' | 'estado'>(null);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const estilo = ESTILO_SEVERIDAD[t.severity] ?? ESTILO_SEVERIDAD.info;
  const comentario = t.post_comment_id != null ? comentariosPorId.get(t.post_comment_id) : undefined;
  const responde = t.accion.via === 'api' && t.post_comment_id != null;

  const responder = async (privada: boolean) => {
    if (!t.post_comment_id) return;
    setEnviando(privada ? 'privada' : 'publica'); setError(null);
    try {
      await responderComentario(token, t.post_comment_id, texto, privada);
      setTexto(''); setHecho(privada ? 'Respuesta privada enviada.' : 'Respuesta enviada. La tarjeta se cierra sola cuando se verifique.');
      recargarTarjetas();
    } catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); } finally { setEnviando(null); }
  };
  const marcar = async (status: 'seguida' | 'descartada') => {
    setEnviando('estado'); setError(null);
    try { await marcarTarjeta(t.id, status); } catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); } finally { setEnviando(null); }
  };

  return (
    <li className={cn('rounded-xl border p-3 space-y-2', estilo.clase)}>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className={cn('px-1.5 py-0.5 rounded uppercase font-bold', CHIP_SEVERIDAD[t.severity] ?? CHIP_SEVERIDAD.info)}>{estilo.etiqueta}</span>
        <span className="titulo text-base text-zinc-100">{t.accion.label}</span>
        {t.accion.via === 'interna' && <Chip className="bg-zinc-800 text-zinc-400"><Lock className="inline w-2.5 h-2.5 mr-0.5" />interna</Chip>}
        <span className="ml-auto text-zinc-500">{ESTADO[t.status]}{t.status_by ? ` · ${t.status_by}` : ''}{t.status_at ? ` · ${fechaHora(t.status_at, huso)}` : ''}</span>
      </div>
      <dl className="space-y-1 text-xs">
        <div><dt className="inline text-zinc-500">Qué pasa: </dt><dd className="inline text-zinc-100">{t.what_text}</dd></div>
        <div><dt className="inline text-zinc-500">Por qué importa: </dt><dd className="inline text-zinc-300">{t.why_text}</dd></div>
        <div><dt className="inline text-zinc-500">Para qué: </dt><dd className="inline text-accent">{t.objective}</dd></div>
      </dl>
      {t.metric && (
        <div className="text-[10px] text-zinc-500">
          {t.metric.replace(/_/g, ' ')}: <b className="text-zinc-200">{numero(t.value)}</b>
          {t.baseline_value != null && <> · base {numero(t.baseline_value)} ({t.baseline_level ?? 'base'}{t.baseline_size ? `, ${t.baseline_size} piezas` : ''})</>}
        </div>
      )}
      {comentario && (
        <blockquote className="border-l-2 border-amber-400/50 pl-2 text-xs">
          <span className="text-zinc-400">{comentario.author_name ?? 'autor desconocido'}: </span>
          <span className="texto-editorial text-zinc-100">{comentario.text ?? ''}</span>
        </blockquote>
      )}

      {responde && (
        <div className="space-y-2">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Escribe la respuesta de la marca…" className="entrada w-full resize-y" />
          <div className="flex flex-col sm:flex-row gap-2">
            <button onClick={() => responder(false)} disabled={!!enviando || !texto.trim()}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-accent text-black text-xs font-bold disabled:opacity-40">
              <Send className="w-3.5 h-3.5" /> {enviando === 'publica' ? 'Enviando…' : 'Responder en el hilo'}
            </button>
            <button onClick={() => responder(true)} disabled={!!enviando || !texto.trim() || comentario?.privada?.puede === false}
              title={comentario?.privada?.puede === false ? comentario.privada.motivo ?? undefined : 'Mensaje privado a quien comentó'}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-accent/50 text-accent text-xs font-bold disabled:opacity-40">
              <Lock className="w-3.5 h-3.5" /> {enviando === 'privada' ? 'Enviando…' : 'En privado'}
            </button>
          </div>
          {comentario?.privada?.puede === false && comentario.privada.motivo && <p className="text-[10px] text-zinc-500">En privado: {comentario.privada.motivo}.</p>}
        </div>
      )}
      {t.accion.via === 'app_nativa' && enlace && (
        <a href={enlace} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-accent/50 text-accent text-xs font-bold">
          Hacerlo en la plataforma <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}

      <div className="flex gap-2 pt-1">
        {t.status !== 'seguida' && (
          <button onClick={() => marcar('seguida')} disabled={!!enviando} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-zinc-800 text-[11px] text-zinc-200 disabled:opacity-40">
            <Check className="w-3.5 h-3.5" /> Seguir el consejo
          </button>
        )}
        <button onClick={() => marcar('descartada')} disabled={!!enviando} className="flex items-center gap-1 px-3 py-2 rounded-lg text-[11px] text-zinc-500 hover:bg-zinc-800 disabled:opacity-40">
          <X className="w-3.5 h-3.5" /> Descartar
        </button>
      </div>
      {hecho && <p className="text-[11px] text-emerald-300">{hecho}</p>}
      {error && <Aviso tono="error">{error}</Aviso>}
    </li>
  );
}

/**
 * Una RECOMENDACIÓN del asesor: su texto para el operador y, si trae borrador, la caja ya precargada para
 * editar y enviar. Al enviar se guarda lo que de verdad salió (`sent_text`): así SignalLab mide cuánto se
 * edita. Sin comentario al que responder, el borrador se copia y se publica en la app de la plataforma.
 */
function RecomendacionAsesor({ r, token, enlace }: { r: Recomendacion; token: string; enlace: string | null }) {
  const { marcarRecomendacion, comentariosPorId, recargarTarjetas } = usePulso();
  const [texto, setTexto] = useState(r.draft ?? '');
  const [enviando, setEnviando] = useState<null | 'publica' | 'privada' | 'estado'>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [publicado, setPublicado] = useState<string | null>(null);
  const comentario = r.post_comment_id != null ? comentariosPorId.get(r.post_comment_id) : undefined;
  const responde = r.accion.via === 'api' && r.post_comment_id != null;
  // Sin comentario al que responder, una acción `api` sobre una publicación se publica aquí como comentario de la marca.
  const comenta = r.accion.via === 'api' && r.post_comment_id == null && !!r.scheduled_post_id;

  const publicar = async () => {
    if (!r.scheduled_post_id) return;
    setEnviando('publica'); setError(null);
    try {
      const { comentario: c } = await comentarEnPublicacion(token, r.scheduled_post_id, texto, r.id);
      setPublicado(c.verificado ? 'Comentario publicado y verificado en la plataforma.' : `Comentario publicado, sin verificar: ${c.motivo ?? ''}`);
      recargarTarjetas();
    } catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); } finally { setEnviando(null); }
  };

  const responder = async (privada: boolean) => {
    if (!r.post_comment_id) return;
    setEnviando(privada ? 'privada' : 'publica'); setError(null);
    try {
      await responderComentario(token, r.post_comment_id, texto, privada);
      // La respuesta ya salió: registrar la recomendación como seguida, con lo que se envió de verdad.
      await marcarRecomendacion(r.id, 'seguida', texto).catch((e) => console.error('[acciones] marcar seguida:', e));
      recargarTarjetas();
    } catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); } finally { setEnviando(null); }
  };
  const marcar = async (status: 'seguida' | 'descartada') => {
    setEnviando('estado'); setError(null);
    try { await marcarRecomendacion(r.id, status, status === 'seguida' && texto.trim() && texto !== r.draft ? texto : undefined); }
    catch (e) { setError(e instanceof ErrorApi ? e.message : String(e)); } finally { setEnviando(null); }
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 1500); } catch { /* sin portapapeles */ }
  };

  return (
    <li className="rounded-xl border border-accent/40 bg-accent/[0.03] p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="px-1.5 py-0.5 rounded uppercase font-bold bg-accent/10 text-accent"><ChevronAsesor className="inline w-2.5 h-2.5 mr-0.5" />recomendación</span>
        <span className="titulo text-base text-zinc-100">{r.accion.label}</span>
        {r.accion.via === 'interna' && <Chip className="bg-zinc-800 text-zinc-400"><Lock className="inline w-2.5 h-2.5 mr-0.5" />interna</Chip>}
      </div>
      <p className="text-xs text-zinc-100">{r.recommendation}</p>
      <p className="text-[11px]"><span className="text-zinc-500">Para qué: </span><span className="text-accent">{r.objective}</span></p>
      {comentario && (
        <blockquote className="border-l-2 border-amber-400/50 pl-2 text-xs">
          <span className="text-zinc-400">{comentario.author_name ?? 'autor desconocido'}: </span>
          <span className="texto-editorial text-zinc-100">{comentario.text ?? ''}</span>
        </blockquote>
      )}
      {(r.draft || responde || comenta) && (
        <div className="space-y-2">
          {r.draft && <p className="text-[10px] text-zinc-500">Borrador del asesor: revísalo y edítalo antes de enviar.</p>}
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} className="entrada w-full resize-y texto-editorial"
            placeholder={comenta ? 'El comentario de la marca en su publicación (para mencionar, escribe @ y la cuenta)…' : undefined} />
          <div className="flex flex-col sm:flex-row gap-2">
            {responde ? (
              <>
                <button onClick={() => responder(false)} disabled={!!enviando || !texto.trim()}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-accent text-black text-xs font-bold disabled:opacity-40">
                  <Send className="w-3.5 h-3.5" /> {enviando === 'publica' ? 'Enviando…' : 'Responder en el hilo'}
                </button>
                <button onClick={() => responder(true)} disabled={!!enviando || !texto.trim() || comentario?.privada?.puede === false}
                  title={comentario?.privada?.puede === false ? comentario.privada.motivo ?? undefined : 'Mensaje privado a quien comentó'}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-accent/50 text-accent text-xs font-bold disabled:opacity-40">
                  <Lock className="w-3.5 h-3.5" /> {enviando === 'privada' ? 'Enviando…' : 'En privado'}
                </button>
              </>
            ) : comenta ? (
              <>
                <button onClick={publicar} disabled={!!enviando || !texto.trim() || !!publicado}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-accent text-black text-xs font-bold disabled:opacity-40">
                  <Send className="w-3.5 h-3.5" /> {enviando === 'publica' ? 'Publicando…' : 'Publicar en la publicación'}
                </button>
                <button onClick={copiar} disabled={!texto.trim()}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-zinc-800 text-zinc-200 text-xs font-bold disabled:opacity-40">
                  <Copy className="w-3.5 h-3.5" /> {copiado ? 'Copiado' : 'Copiar el texto'}
                </button>
              </>
            ) : (
              <>
                <button onClick={copiar} disabled={!texto.trim()}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-zinc-800 text-zinc-200 text-xs font-bold disabled:opacity-40">
                  <Copy className="w-3.5 h-3.5" /> {copiado ? 'Copiado' : 'Copiar el texto'}
                </button>
                {enlace && (
                  <a href={enlace} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-accent/50 text-accent text-xs font-bold">
                    Publicarlo en la plataforma <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {publicado && <p className="text-[11px] text-emerald-300">{publicado}</p>}
      {!r.draft && !responde && r.accion.via === 'app_nativa' && enlace && (
        <a href={enlace} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-accent/50 text-accent text-xs font-bold">
          Hacerlo en la plataforma <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
      <div className="flex gap-2 pt-1">
        <button onClick={() => marcar('seguida')} disabled={!!enviando} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-zinc-800 text-[11px] text-zinc-200 disabled:opacity-40">
          <Check className="w-3.5 h-3.5" /> Hecho
        </button>
        <button onClick={() => marcar('descartada')} disabled={!!enviando} className="flex items-center gap-1 px-3 py-2 rounded-lg text-[11px] text-zinc-500 hover:bg-zinc-800 disabled:opacity-40">
          <X className="w-3.5 h-3.5" /> Descartar
        </button>
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
    </li>
  );
}
