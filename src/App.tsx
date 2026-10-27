import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, CalendarDays, Flame, Inbox, LayoutGrid, LogOut, MessageCircle } from 'lucide-react';
import { entrar, ops, plataformasDe, ErrorApi, type Catalogo, type Sesion } from './api';
import { Aviso, Cargando, cn, etiquetaPlataforma, ChevronAsesor, registrarColoresDePlataforma } from './ui/components';
import Publicado from './views/Publicado';
import Calendario from './views/Calendario';
import Estadisticas from './views/Estadisticas';
import Comentarios from './views/Comentarios';
import Mensajes from './views/Mensajes';
import Hoy from './views/Hoy';
import { AvisoComentarios, ProveedorPulso, usePulso, type FocoAsesor } from './ui/Pulso';
import Acciones from './views/Acciones';
import { tramosDeCaja } from './logotipo';

type Pestana = 'hoy' | 'publicado' | 'comentarios' | 'mensajes' | 'acciones' | 'estadisticas' | 'calendario';
/** `corta`: la etiqueta de la barra inferior del teléfono, donde caben siete pestañas. */
const PESTANAS: { id: Pestana; etiqueta: string; corta?: string; icono: React.ElementType }[] = [
  { id: 'hoy', etiqueta: 'Hoy', icono: Flame },
  { id: 'publicado', etiqueta: 'Publicado', icono: LayoutGrid },
  { id: 'comentarios', etiqueta: 'Comentarios', corta: 'Coment.', icono: MessageCircle },
  { id: 'mensajes', etiqueta: 'Mensajes', corta: 'DMs', icono: Inbox },
  { id: 'acciones', etiqueta: 'Acciones', icono: ChevronAsesor },
  { id: 'estadisticas', etiqueta: 'Estadísticas', corta: 'Métricas', icono: BarChart3 },
  { id: 'calendario', etiqueta: 'Calendario', corta: 'Agenda', icono: CalendarDays },
];

/** El logotipo del lab: «>SocialLab» con el bloque de logotipo de la marca (BP v1.6 `logotype.css_complete`, el
 *  mismo de unrealvillestudio.com): chevron cian que parpadea, nombre en chalk, Bebas Neue (Sam, 2026-10-26).
 *  «tablero de operadores» va debajo. Sustituye al lockup del estudio (>UNREALVILLE studio). */
const Logo = () => (
  <div className="flex flex-col min-w-0 leading-none">
    <span className="lt-logotype size-lab" aria-label=">SocialLab">
      <span className="lt-chevron" aria-hidden>&gt;</span>
      <span className="lt-un" aria-hidden>
        {tramosDeCaja('SocialLab').map((t, i) => t.minuscula
          ? <span key={i} className="lt-minuscula">{t.texto}</span>
          : <span key={i}>{t.texto}</span>)}
      </span>
    </span>
    <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">tablero de operadores</span>
  </div>
);

/** Sesión en memoria, igual que el Orchestrator: al refrescar se vuelve a entrar. */
export default function App() {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  if (!sesion) return <Entrada onSesion={setSesion} />;
  return <Tablero sesion={sesion} onSalir={() => setSesion(null)} />;
}

function Entrada({ onSesion }: { onSesion: (s: Sesion) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true); setError(null);
    try { onSesion(await entrar(password)); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setEnviando(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={enviar} className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 sm:p-6">
        <Logo />
        <p className="text-xs text-zinc-500">Entra con la misma contraseña del Orchestrator.</p>
        <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" className="entrada w-full" />
        {error && <Aviso tono="error">{error}</Aviso>}
        <button disabled={enviando || !password} className="w-full py-2 rounded-lg bg-accent text-black font-semibold text-sm disabled:opacity-40">
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

function Tablero({ sesion, onSalir }: { sesion: Sesion; onSalir: () => void }) {
  const [pestana, setPestana] = useState<Pestana>('publicado');
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marca, setMarca] = useState('');
  /** Filtro común a todas las pestañas: '' = todas las plataformas. */
  const [plataforma, setPlataforma] = useState('');
  const plataformas = catalogo ? plataformasDe(catalogo.marcas, marca) : [];
  // Si la marca elegida no tiene la plataforma filtrada, el filtro vuelve a «todas»: nunca una pantalla vacía sin motivo.
  useEffect(() => { if (plataforma && catalogo && !plataformasDe(catalogo.marcas, marca).includes(plataforma)) setPlataforma(''); }, [marca, catalogo]);
  /** La publicación cuya bandeja se abrió desde su pill o desde el aviso; `null` = todas. */
  const [postComentarios, setPostComentarios] = useState<string | null>(null);
  const atender = useCallback((id: string | null) => { setPostComentarios(id); setPestana('comentarios'); }, []);
  /** Lo que se abrió desde una pill del asesor: va primero en Acciones. */
  const [focoAsesor, setFocoAsesor] = useState<FocoAsesor>(null);
  const abrirAsesor = useCallback((foco: FocoAsesor) => { setFocoAsesor(foco); setPestana('acciones'); }, []);
  const irA = (id: Pestana) => { setPestana(id); if (id === 'comentarios') setPostComentarios(null); if (id === 'acciones') setFocoAsesor(null); };

  useEffect(() => {
    ops<Catalogo>(sesion.session_token, 'catalogo')
      // Los colores de plataforma se registran antes de pintar: todas las pestañas los leen.
      .then((c) => { registrarColoresDePlataforma(c.plataformas); setCatalogo(c); })
      .catch((e) => { if (e instanceof ErrorApi && e.status === 401) onSalir(); else setError(e.message); });
  }, [sesion.session_token]);

  return (
    <div className="min-h-screen pb-24 md:pb-0">
      <header className="h-14 border-b border-zinc-800 px-4 sm:px-6 flex items-center justify-between gap-3 sticky top-0 bg-uv-bg/90 backdrop-blur-md z-50">
        <Logo />
        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline text-[11px] text-zinc-400">{sesion.sub} <span className="text-accent/70 uppercase">{sesion.role}</span></span>
          <button onClick={onSalir} title="Salir" aria-label="Salir" className="p-2.5 rounded-full hover:bg-zinc-800"><LogOut className="w-4 h-4 text-zinc-500" /></button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5">
        {error && <Aviso tono="error">{error}</Aviso>}
        {!catalogo && !error && <Cargando />}
        {catalogo && (
          <ProveedorPulso token={sesion.session_token} marca={marca} onAtender={atender} onAsesor={abrirAsesor}>
            <div className="flex flex-wrap items-center gap-3">
              {/* Pestañas arriba desde tablet; en el teléfono van en la barra inferior (abajo, al alcance del pulgar). */}
              <nav className="hidden md:flex items-center gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
                {PESTANAS.map((p) => (
                  <button key={p.id} onClick={() => irA(p.id)}
                    className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all border',
                      pestana === p.id ? 'bg-accent/10 text-accent border-accent/40' : 'border-transparent text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800')}>
                    <p.icono className="w-4 h-4" />{p.etiqueta}{p.id === 'acciones' && <InsigniaAsesor />}
                  </button>
                ))}
              </nav>
              <div className="grid grid-cols-2 gap-2 w-full md:w-auto md:flex">
                <select value={marca} onChange={(e) => setMarca(e.target.value)} className="entrada min-w-0" aria-label="Marca">
                  {catalogo.marcas.length > 1 && <option value="">Todas mis marcas ({catalogo.marcas.length})</option>}
                  {catalogo.marcas.map((m) => <option key={m.brand_id} value={m.brand_id}>{m.nombre}</option>)}
                </select>
                <select value={plataforma} onChange={(e) => setPlataforma(e.target.value)} className="entrada min-w-0" aria-label="Plataforma">
                  <option value="">Plataformas</option>
                  {plataformas.map((p) => <option key={p} value={p}>{etiquetaPlataforma(p)}</option>)}
                </select>
              </div>
            </div>
            <h2 className="md:hidden titulo text-2xl text-zinc-100">{PESTANAS.find((p) => p.id === pestana)?.etiqueta}</h2>
            <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-zinc-800 bg-uv-bg/95 backdrop-blur-md grid grid-cols-7"
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
              {PESTANAS.map((p) => (
                <button key={p.id} onClick={() => irA(p.id)} aria-current={pestana === p.id ? 'page' : undefined}
                  className={cn('relative flex flex-col items-center gap-1 py-2.5 text-[9px] border-t-2 min-w-0',
                    pestana === p.id ? 'text-accent border-accent' : 'text-zinc-500 border-transparent')}>
                  <p.icono className="w-5 h-5" /><span className="truncate max-w-full px-0.5">{p.corta ?? p.etiqueta}</span>
                  {p.id === 'acciones' && <span className="absolute top-1 right-1/4"><InsigniaAsesor /></span>}
                </button>
              ))}
            </nav>
            {catalogo.marcas.length === 0 && <Aviso>No hay marcas con cuenta conectada en tu alcance.</Aviso>}
            <AvisoComentarios marcas={catalogo.marcas} />
            {pestana === 'hoy' && <Hoy token={sesion.session_token} marca={marca} plataforma={plataforma} marcas={catalogo.marcas} irA={irA} />}
            {pestana === 'publicado' && <Publicado token={sesion.session_token} marca={marca} plataforma={plataforma} marcas={catalogo.marcas} />}
            {pestana === 'comentarios' && <Comentarios token={sesion.session_token} marca={marca} plataforma={plataforma} marcas={catalogo.marcas}
              post={postComentarios} onQuitarFiltro={() => setPostComentarios(null)} />}
            {pestana === 'mensajes' && <Mensajes token={sesion.session_token} marca={marca} plataforma={plataforma} marcas={catalogo.marcas} />}
            {pestana === 'acciones' && <Acciones token={sesion.session_token} marca={marca} plataforma={plataforma} marcas={catalogo.marcas}
              foco={focoAsesor} onQuitarFoco={() => setFocoAsesor(null)} />}
            {pestana === 'estadisticas' && <Estadisticas token={sesion.session_token} marca={marca} plataforma={plataforma} marcas={catalogo.marcas} />}
            {pestana === 'calendario' && <Calendario token={sesion.session_token} marca={marca} plataforma={plataforma} marcas={catalogo.marcas} />}
          </ProveedorPulso>
        )}
      </main>
    </div>
  );
}

/** Cuántos consejos del asesor están sin abrir: se ve en la pestaña Acciones desde cualquier pestaña. */
function InsigniaAsesor() {
  const { tarjetasNuevas } = usePulso();
  if (!tarjetasNuevas) return null;
  return <span className="ml-1 inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-amber-400 text-black text-[9px] font-bold">{tarjetasNuevas}</span>;
}
