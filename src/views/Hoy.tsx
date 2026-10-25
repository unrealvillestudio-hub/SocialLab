import React, { useEffect, useState } from 'react';
import { ops, type Marca, type RespAhora } from '../api';
import { Aviso, Cargando, Chip, etiquetaFormato, etiquetaPlataforma, fechaHora } from '../ui/components';
import { Pills } from '../ui/Pills';

/**
 * HOY · «happening now». Ordena por la comparación justa de SignalLab (misma marca, plataforma,
 * formato y edad). Mientras no haya instantáneas dice «sin medir»; mientras no haya comparación,
 * lista sin ordenar y lo dice. Nunca inventa un orden ni un cero.
 */
export default function Hoy({ token, marca, marcas }: { token: string; marca: string; marcas: Marca[] }) {
  const [data, setData] = useState<RespAhora | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  // Se relee cada minuto: las pills celebran cuando SignalLab escribe un valor nuevo.
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let vivo = true;
    ops<RespAhora>(token, 'ahora', { marca: marca || undefined })
      .then((r) => { if (vivo) { setData(r); setError(null); } }).catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [token, marca, tick]);

  const huso = (b: string) => marcas.find((m) => m.brand_id === b)?.huso ?? null;
  const nombre = (b: string) => marcas.find((m) => m.brand_id === b)?.nombre ?? b;

  if (error) return <Aviso tono="error">No se pudo leer «happening now»: {error}</Aviso>;
  if (!data) return <Cargando />;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="text-sm font-semibold text-zinc-200">Happening now · últimas {Math.round(data.minutos / 60)} h</div>
        <div className="mt-1 text-xs text-zinc-400">
          <b className="text-amber-300">{data.estado === 'sin_medir' ? 'Sin medir' : 'Sin ordenar'}</b> — {data.motivo}.
        </div>
      </div>
      {data.publicaciones.length === 0 && <Aviso>No hay publicaciones en la ventana.</Aviso>}
      <ul className="space-y-2">
        {data.publicaciones.map((p) => (
          <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-mono text-zinc-500 w-28">{fechaHora(p.published_at, huso(p.brand_id))}</span>
            <Chip className="text-zinc-200">{nombre(p.brand_id)}</Chip>
            <Chip>{etiquetaPlataforma(p.platform)}</Chip>
            <Chip>{etiquetaFormato(p.formato)}</Chip>
            <span className="flex-1 min-w-[12rem] truncate text-zinc-400">{p.copy_text ?? ''}</span>
            <Pills metricas={p.metricas} />
          </li>
        ))}
      </ul>
    </div>
  );
}
