import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalIcon, RotateCcw } from 'lucide-react';
import { usePostStore } from '../../store/usePostStore';
import { BRANDS, BRAND_LIST, getBrandById } from '../../config/brands';
import { PLATFORMS } from '../../config/platforms';
import { ScheduledPost } from '../../core/types';
import { cn } from '../../ui/components';

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const STATUS_DOT: Record<string, string> = {
  draft:      "opacity-40",
  scheduled:  "opacity-100",
  publishing: "opacity-100 animate-pulse",
  published:  "opacity-70",
  failed:     "opacity-100",
};

export default function CalendarModule() {
  const { posts } = usePostStore();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<ScheduledPost | null>(null);
  const [filterBrand, setFilterBrand] = useState('ALL');

  const monthPosts = useMemo(() =>
    posts.filter(p => {
      const d = new Date(p.scheduledAt);
      return d.getFullYear() === year && d.getMonth() === month
        && (filterBrand === 'ALL' || p.brandId === filterBrand);
    }),
    [posts, year, month, filterBrand]
  );

  // Build calendar grid
  const firstDay = new Date(year, month, 1);
  // Monday-first: convert Sunday(0) to 6, others to day-1
  const startOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const dayNum = i - startOffset + 1;
    return (dayNum >= 1 && dayNum <= daysInMonth) ? dayNum : null;
  });

  const postsByDay = useMemo(() => {
    const map: Record<number, ScheduledPost[]> = {};
    monthPosts.forEach(p => {
      const day = new Date(p.scheduledAt).getDate();
      if (!map[day]) map[day] = [];
      map[day].push(p);
    });
    return map;
  }, [monthPosts]);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const isToday = (day: number) => {
    return day === now.getDate() && month === now.getMonth() && year === now.getFullYear();
  };

  const handleReset = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setFilterBrand('ALL');
  };

  return (
    <div className="flex gap-6">
      {/* Calendar */}
      <div className="flex-1 space-y-4">
        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <h2 className="text-base font-bold text-white min-w-[180px] text-center">
              {MONTHS[month]} {year}
            </h2>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filterBrand}
              onChange={e => setFilterBrand(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-accent/50"
            >
              <option value="ALL">Todas las marcas</option>
              {BRAND_LIST.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <button
              onClick={handleReset}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Reset filters"
            >
              <RotateCcw size={12} />
            </button>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <CalIcon size={12} />
              <span>{monthPosts.length} posts</span>
            </div>
          </div>
        </div>

        {/* Grid header */}
        <div className="grid grid-cols-7 gap-px">
          {DAYS.map(d => (
            <div key={d} className="text-center text-[10px] font-bold text-zinc-600 uppercase tracking-widest py-2">
              {d}
            </div>
          ))}
        </div>

        {/* Grid cells */}
        <div className="grid grid-cols-7 gap-px bg-zinc-800 rounded-xl overflow-hidden">
          {cells.map((day, idx) => {
            const dayPosts = day ? (postsByDay[day] || []) : [];
            return (
              <div
                key={idx}
                className={cn(
                  "bg-zinc-900 min-h-[88px] p-1.5 flex flex-col",
                  !day && "opacity-0 pointer-events-none",
                  day && isToday(day) && "bg-zinc-800/80"
                )}
              >
                {day && (
                  <>
                    <span className={cn(
                      "text-xs font-mono w-5 h-5 flex items-center justify-center rounded-full mb-1",
                      isToday(day) ? "bg-accent text-black font-bold" : "text-zinc-600"
                    )}>
                      {day}
                    </span>
                    <div className="space-y-0.5 flex-1 overflow-hidden">
                      {dayPosts.slice(0, 3).map(p => {
                        const brand = getBrandById(p.brandId);
                        const platform = PLATFORMS[p.platform];
                        return (
                          <button
                            key={p.id}
                            onClick={() => setSelected(p)}
                            className={cn(
                              "w-full text-left px-1.5 py-0.5 rounded text-[9px] truncate flex items-center gap-1 transition-opacity hover:opacity-80",
                              STATUS_DOT[p.status]
                            )}
                            style={{ backgroundColor: `${brand?.color}22`, color: brand?.color }}
                          >
                            <span>{platform?.icon}</span>
                            <span className="truncate">{p.copy.slice(0, 20)}</span>
                          </button>
                        );
                      })}
                      {dayPosts.length > 3 && (
                        <p className="text-[9px] text-zinc-600 px-1">+{dayPosts.length - 3} más</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3">
          {BRAND_LIST.filter(b => monthPosts.some(p => p.brandId === b.id)).map(b => (
            <div key={b.id} className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
              {b.name}
            </div>
          ))}
        </div>
      </div>

      {/* Post detail panel */}
      <div className="w-64 shrink-0">
        {selected ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3 sticky top-4">
            <div className="flex items-start justify-between">
              <p className="text-[10px] uppercase font-bold text-zinc-500">Detalle</p>
              <button onClick={() => setSelected(null)} className="text-zinc-600 hover:text-zinc-400">
                ✕
              </button>
            </div>
            {(() => {
              const brand = getBrandById(selected.brandId);
              const platform = PLATFORMS[selected.platform];
              return (
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: brand?.color }} />
                    <span className="text-xs font-medium text-zinc-300">{brand?.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span>{platform?.icon}</span>
                    <span>{platform?.label}</span>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-950 rounded-lg p-2.5">
                    {selected.copy}
                  </p>
                  <div className="space-y-1 text-[10px] text-zinc-600">
                    <p>📅 {new Date(selected.scheduledAt).toLocaleString('es-ES')}</p>
                    <p>Estado: <span className={cn("font-bold", {
                      scheduled: "text-blue-400", published: "text-emerald-400",
                      failed: "text-red-400", draft: "text-zinc-400", publishing: "text-amber-400"
                    }[selected.status])}>{selected.status}</span></p>
                    {selected.mockPostId && <p className="font-mono">ID: {selected.mockPostId}</p>}
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-6 flex flex-col items-center justify-center gap-2 text-zinc-700">
            <CalIcon size={24} strokeWidth={1} />
            <p className="text-xs text-center">Clic en un post para ver el detalle</p>
          </div>
        )}
      </div>
    </div>
  );
}
