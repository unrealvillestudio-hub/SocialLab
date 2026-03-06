import React, { useState, useMemo } from 'react';
import { Trash2, Send, Download, RefreshCw, Filter, CheckCircle2, XCircle, Clock, Loader, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { usePostStore } from '../../store/usePostStore';
import { BRANDS, BRAND_LIST, getBrandById } from '../../config/brands';
import { PLATFORMS } from '../../config/platforms';
import { publishPost } from '../../services/socialEngine';
import { PostStatus, ScheduledPost } from '../../core/types';
import { cn } from '../../ui/components';

const STATUS_CONFIG: Record<PostStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  draft:      { label: "Borrador",    color: "text-zinc-400",    bg: "bg-zinc-800",       icon: Clock },
  scheduled:  { label: "Programado",  color: "text-blue-400",    bg: "bg-blue-500/10",    icon: Clock },
  publishing: { label: "Publicando",  color: "text-amber-400",   bg: "bg-amber-500/10",   icon: Loader },
  published:  { label: "Publicado",   color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle2 },
  failed:     { label: "Error",       color: "text-red-400",     bg: "bg-red-500/10",     icon: XCircle },
};

export default function QueueModule() {
  const { posts, updatePost, removePost } = usePostStore();
  const [filterStatus, setFilterStatus] = useState<PostStatus | 'ALL'>('ALL');
  const [filterBrand, setFilterBrand] = useState('ALL');
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() =>
    posts
      .filter(p =>
        (filterStatus === 'ALL' || p.status === filterStatus) &&
        (filterBrand === 'ALL' || p.brandId === filterBrand)
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [posts, filterStatus, filterBrand]
  );

  const counts = useMemo(() => ({
    total:     posts.length,
    scheduled: posts.filter(p => p.status === 'scheduled').length,
    published: posts.filter(p => p.status === 'published').length,
    failed:    posts.filter(p => p.status === 'failed').length,
    draft:     posts.filter(p => p.status === 'draft').length,
  }), [posts]);

  const handlePublish = async (post: ScheduledPost) => {
    setPublishingIds(s => new Set(s).add(post.id));
    updatePost(post.id, { status: 'publishing' });
    const result = await publishPost({ ...post, status: 'publishing' });
    updatePost(post.id, {
      status: result.success ? 'published' : 'failed',
      mockPostId: result.mockPostId,
      publishedAt: result.success ? new Date().toISOString() : undefined,
      errorMsg: result.errorMsg,
    });
    setPublishingIds(s => { const n = new Set(s); n.delete(post.id); return n; });
  };

  const handleRetry = (post: ScheduledPost) => {
    updatePost(post.id, { status: 'scheduled', errorMsg: undefined });
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `sociallab_queue_${Date.now()}.json`; a.click();
  };

  const handleResetFilters = () => {
    setFilterStatus('ALL');
    setFilterBrand('ALL');
  };

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Total',      val: counts.total,     status: 'ALL' as const,      color: 'text-zinc-300' },
          { label: 'Programados',val: counts.scheduled, status: 'scheduled' as const, color: 'text-blue-400' },
          { label: 'Publicados', val: counts.published, status: 'published' as const, color: 'text-emerald-400' },
          { label: 'Borradores', val: counts.draft,     status: 'draft' as const,     color: 'text-zinc-500' },
          { label: 'Errores',    val: counts.failed,    status: 'failed' as const,    color: 'text-red-400' },
        ].map(s => (
          <button
            key={s.label}
            onClick={() => setFilterStatus(s.status)}
            className={cn(
              "bg-zinc-900 border rounded-xl p-3 text-center transition-all",
              filterStatus === s.status
                ? "border-accent/50 bg-zinc-800"
                : "border-zinc-800 hover:border-zinc-700"
            )}
          >
            <p className={cn("text-2xl font-bold font-mono", s.color)}>{s.val}</p>
            <p className="text-[10px] text-zinc-600 uppercase tracking-wide mt-0.5">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Filters + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter size={12} className="text-zinc-600" />
          <select
            value={filterBrand}
            onChange={e => setFilterBrand(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-accent/50"
          >
            <option value="ALL">Todas las marcas</option>
            {BRAND_LIST.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button
            onClick={handleResetFilters}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Reset filters"
          >
            <RotateCcw size={12} />
          </button>
          <span className="text-xs text-zinc-600">{filtered.length} posts</span>
        </div>
        <button
          onClick={exportJSON}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <Download size={12} />
          Exportar JSON
        </button>
      </div>

      {/* Post list */}
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {filtered.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl py-16 flex flex-col items-center gap-2 text-zinc-700">
              <Clock size={32} strokeWidth={1} />
              <p className="text-sm">No hay posts en la queue</p>
            </div>
          ) : (
            filtered.map(post => {
              const brand = getBrandById(post.brandId);
              const platform = PLATFORMS[post.platform];
              const sc = STATUS_CONFIG[post.status];
              const Icon = sc.icon;
              const isPublishingThis = publishingIds.has(post.id);

              return (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-start gap-3 hover:border-zinc-700 transition-colors group"
                >
                  {/* Brand dot */}
                  <div
                    className="w-1 self-stretch rounded-full shrink-0 mt-1"
                    style={{ backgroundColor: brand?.color || '#666' }}
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-zinc-300">{brand?.name}</span>
                      <span className="text-xs text-zinc-600">{platform?.icon} {platform?.label}</span>
                      <span className={cn("flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md", sc.color, sc.bg)}>
                        <Icon size={10} className={post.status === 'publishing' ? 'animate-spin' : ''} />
                        {sc.label}
                      </span>
                      {post.mockPostId && (
                        <span className="text-[9px] font-mono text-zinc-700 bg-zinc-800 px-1.5 py-0.5 rounded">
                          {post.mockPostId}
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-zinc-400 leading-relaxed line-clamp-2">{post.copy}</p>

                    <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                      <span>📅 {new Date(post.scheduledAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      {post.publishedAt && <span>✅ {new Date(post.publishedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span>}
                      {post.errorMsg && <span className="text-red-400">⚠ {post.errorMsg}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {post.status === 'scheduled' && (
                      <button
                        onClick={() => handlePublish(post)}
                        disabled={isPublishingThis}
                        className="p-1.5 rounded-lg hover:bg-accent/20 text-accent transition-colors disabled:opacity-40"
                        title="Publicar ahora"
                      >
                        <Send size={13} />
                      </button>
                    )}
                    {post.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(post)}
                        className="p-1.5 rounded-lg hover:bg-amber-500/20 text-amber-400 transition-colors"
                        title="Reintentar"
                      >
                        <RefreshCw size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => removePost(post.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-500 transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
