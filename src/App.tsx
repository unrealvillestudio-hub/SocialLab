import React, { useEffect, useState } from 'react';
import { BarChart3, CalendarDays, Flame, LayoutGrid, LogOut } from 'lucide-react';
import { entrar, ops, ErrorApi, type Catalogo, type Sesion } from './api';
import { Aviso, Cargando, cn } from './ui/components';
import Publicado from './views/Publicado';
import Calendario from './views/Calendario';
import Estadisticas from './views/Estadisticas';
import Hoy from './views/Hoy';

type Pestana = 'hoy' | 'publicado' | 'estadisticas' | 'calendario';
const PESTANAS: { id: Pestana; etiqueta: string; icono: React.ElementType }[] = [
  { id: 'hoy', etiqueta: 'Hoy', icono: Flame },
  { id: 'publicado', etiqueta: 'Publicado', icono: LayoutGrid },
  { id: 'estadisticas', etiqueta: 'Estadísticas', icono: BarChart3 },
  { id: 'calendario', etiqueta: 'Calendario', icono: CalendarDays },
];

const Logo = () => (
  <div className="flex items-center gap-2 font-bold tracking-tighter text-lg">
    <div className="w-6 h-6 bg-accent rounded-sm flex items-center justify-center text-black text-[10px] font-black">UV</div>
    <span>SocialLab</span>
    <span className="text-[10px] font-mono font-normal text-zinc-500 tracking-normal">tablero de operadores</span>
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
      <form onSubmit={enviar} className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
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

  useEffect(() => {
    ops<Catalogo>(sesion.session_token, 'catalogo')
      .then(setCatalogo)
      .catch((e) => { if (e instanceof ErrorApi && e.status === 401) onSalir(); else setError(e.message); });
  }, [sesion.session_token]);

  return (
    <div className="min-h-screen">
      <header className="h-14 border-b border-zinc-800 px-4 sm:px-6 flex items-center justify-between sticky top-0 bg-uv-bg/90 backdrop-blur-md z-50">
        <Logo />
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-zinc-400">{sesion.sub} <span className="font-mono text-accent/70 uppercase">{sesion.role}</span></span>
          <button onClick={onSalir} title="Salir" className="p-2 rounded-full hover:bg-zinc-800"><LogOut className="w-4 h-4 text-zinc-500" /></button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {error && <Aviso tono="error">{error}</Aviso>}
        {!catalogo && !error && <Cargando />}
        {catalogo && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
                {PESTANAS.map((p) => (
                  <button key={p.id} onClick={() => setPestana(p.id)}
                    className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                      pestana === p.id ? 'bg-accent text-black' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800')}>
                    <p.icono className="w-4 h-4" />{p.etiqueta}
                  </button>
                ))}
              </div>
              <select value={marca} onChange={(e) => setMarca(e.target.value)} className="entrada">
                {catalogo.marcas.length > 1 && <option value="">Todas mis marcas ({catalogo.marcas.length})</option>}
                {catalogo.marcas.map((m) => <option key={m.brand_id} value={m.brand_id}>{m.nombre}</option>)}
              </select>
            </div>
            {catalogo.marcas.length === 0 && <Aviso>No hay marcas con cuenta conectada en tu alcance.</Aviso>}
            {pestana === 'hoy' && <Hoy token={sesion.session_token} marca={marca} marcas={catalogo.marcas} />}
            {pestana === 'publicado' && <Publicado token={sesion.session_token} marca={marca} marcas={catalogo.marcas} />}
            {pestana === 'estadisticas' && <Estadisticas token={sesion.session_token} marca={marca} marcas={catalogo.marcas} />}
            {pestana === 'calendario' && <Calendario token={sesion.session_token} marca={marca} marcas={catalogo.marcas} />}
          </>
        )}
      </main>
    </div>
  );
}
