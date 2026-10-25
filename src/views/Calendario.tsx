import React, { useEffect, useMemo, useState } from 'react';
import { ops, type Marca, type RespCalendario } from '../api';
import { Aviso, Cargando, Chip, cn, etiquetaFormato, etiquetaPlataforma, fechaHora } from '../ui/components';

/**
 * CALENDARIO, sólo lectura. Franjas de `intel.brand_publish_slots` y filas de `scheduled_posts` por
 * día. Se agenda donde ya se agenda (el carril y el Orchestrator), no aquí.
 */
export default function Calendario({ token, marca, marcas }: { token: string; marca: string; marcas: Marca[] }) {
  const [data, setData] = useState<RespCalendario | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setError(null);
    ops<RespCalendario>(token, 'calendario', { marca: marca || undefined })
      .then((r) => vivo && setData(r)).catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [token, marca]);

  const huso = (b: string) => marcas.find((m) => m.brand_id === b)?.huso ?? null;
  const nombre = (b: string) => marcas.find((m) => m.brand_id === b)?.nombre ?? b;

  const dias = useMemo(() => {
    if (!data) return [];
    const items = [
      ...data.franjas.map((f) => ({
        clave: `f-${f.id}`, brand_id: f.brand_id, cuando: f.slot_at, tipo: 'franja' as const,
        canal: f.platform_key, estado: f.status, formato: f.format, piece_id: f.piece_id, detalle: f.failed_reason,
      })),
      ...data.publicaciones.map((p) => ({
        clave: `p-${p.id}`, brand_id: p.brand_id, cuando: p.scheduled_at, tipo: 'publicación' as const,
        canal: etiquetaPlataforma(p.platform), estado: p.status, formato: p.media_type ? etiquetaFormato(p.media_type) : null,
        piece_id: p.piece_id, detalle: null as string | null,
      })),
    ].sort((a, b) => a.cuando.localeCompare(b.cuando));
    const porDia = new Map<string, typeof items>();
    for (const i of items) {
      // El día se cuenta en el huso de la marca: una franja de las 23:30 en su huso es de ese día.
      const h = huso(i.brand_id) ?? undefined;
      const dia = new Date(i.cuando).toLocaleDateString('en-CA', { timeZone: h });
      porDia.set(dia, [...(porDia.get(dia) ?? []), i]);
    }
    return [...porDia.entries()];
  }, [data, marcas]);

  if (error) return <Aviso tono="error">No se pudo leer el calendario: {error}</Aviso>;
  if (!data) return <Cargando />;
  const hoy = new Date().toLocaleDateString('en-CA');
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-zinc-500">
        Del {new Date(data.ventana.desde).toLocaleDateString('es')} al {new Date(data.ventana.hasta).toLocaleDateString('es')}.
        Franjas del carril y publicaciones del registro; sólo lectura.
      </p>
      {dias.length === 0 && <Aviso>No hay franjas ni publicaciones en la ventana.</Aviso>}
      {dias.map(([dia, items]) => (
        <section key={dia} className={cn('rounded-xl border bg-zinc-900/40 p-3', dia === hoy ? 'border-accent/40' : 'border-zinc-800')}>
          <h3 className="titulo text-lg text-zinc-200 mb-2">
            {new Date(`${dia}T12:00:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}
            {dia === hoy && <span className="ml-2 text-accent">hoy</span>}
          </h3>
          <ul className="space-y-1">
            {items.map((i) => (
              <li key={i.clave} className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="basis-full sm:basis-auto sm:w-28 text-zinc-500">{fechaHora(i.cuando, huso(i.brand_id))}</span>
                <Chip className="text-zinc-200">{nombre(i.brand_id)}</Chip>
                <Chip>{i.canal}</Chip>
                <Chip className={i.tipo === 'franja' ? 'bg-sky-500/10 text-sky-300' : ''}>{i.tipo}</Chip>
                <Chip className={cn(i.estado === 'published' && 'bg-emerald-500/10 text-emerald-300',
                  i.estado === 'failed' && 'bg-red-500/10 text-red-300')}>{i.estado}</Chip>
                {i.formato && <Chip>{i.formato}</Chip>}
                {i.piece_id && <span className="font-mono text-zinc-600">{i.piece_id}</span>}
                {i.detalle && <span className="text-red-300">{i.detalle}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
