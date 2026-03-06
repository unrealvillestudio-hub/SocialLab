import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send, Hash, Image, Video, Plus,
  CheckCircle2, AlertCircle, Clock, ChevronDown, Eye, RotateCcw,
  Sparkles, Wand2, Tags, Repeat2, ChevronRight, Loader2, X
} from 'lucide-react';
import { BRAND_LIST, Brand } from '../../config/brands';
import { PLATFORMS, PLATFORM_LIST } from '../../config/platforms';
import { usePostStore } from '../../store/usePostStore';
import {
  publishPost, validatePost, estimateCharCount,
  generateSocialCopy, enhanceCopy, suggestHashtags, adaptCopyForPlatform,
} from '../../services/socialEngine';
import { ScheduledPost, PlatformId, Platform } from '../../core/types';
import { cn } from '../../ui/components';

// ── ENHANCEMENT DEFINITIONS ───────────────────────────────────────────────

type EnhancementId = 'generate' | 'enhance' | 'hashtags' | 'adapt';

interface Enhancement {
  id: EnhancementId;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}

const ENHANCEMENTS: Enhancement[] = [
  {
    id: 'generate',
    label: 'Generar',
    description: 'Genera copy desde un brief',
    icon: Sparkles,
    color: '#FFAB00',
  },
  {
    id: 'enhance',
    label: 'Mejorar',
    description: 'Reescribe y optimiza el copy actual',
    icon: Wand2,
    color: '#A855F7',
  },
  {
    id: 'hashtags',
    label: 'Hashtags',
    description: 'Sugiere hashtags para el copy actual',
    icon: Tags,
    color: '#22C55E',
  },
  {
    id: 'adapt',
    label: 'Adaptar',
    description: 'Reformatea para otra plataforma',
    icon: Repeat2,
    color: '#3B82F6',
  },
];

// ── LOADING SPINNER ───────────────────────────────────────────────────────

function Spinner({ color }: { color?: string }) {
  return (
    <Loader2
      size={13}
      className="animate-spin shrink-0"
      style={{ color: color || 'currentColor' }}
    />
  );
}

// ── MAIN MODULE ───────────────────────────────────────────────────────────

export default function PostBuilderModule() {
  const { addPost, updatePost } = usePostStore();

  // ── composer state ──────────────────────────────────────────────────────
  const [selectedBrand, setSelectedBrand]     = useState<Brand>(BRAND_LIST[0]);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(PLATFORMS.INSTAGRAM);
  const [copy, setCopy]                       = useState('');
  const [scheduledAt, setScheduledAt]         = useState('');
  const [isPublishing, setIsPublishing]       = useState(false);
  const [lastResult, setLastResult]           = useState<{ ok: boolean; msg: string } | null>(null);
  const [previewOpen, setPreviewOpen]         = useState(false);

  // ── enhancement panel state ─────────────────────────────────────────────
  const [enhancementsOpen, setEnhancementsOpen] = useState(false);
  const [activeEnhancements, setActiveEnhancements] = useState<Set<EnhancementId>>(
    new Set(['generate', 'enhance', 'hashtags', 'adapt'])
  );

  // loading state per enhancement
  const [loadingId, setLoadingId] = useState<EnhancementId | null>(null);

  // generate-specific state
  const [brief, setBrief] = useState('');

  // hashtags result
  const [suggestedHashtags, setSuggestedHashtags] = useState<string[]>([]);

  // adapt-specific state
  const [adaptTarget, setAdaptTarget] = useState<PlatformId>('FACEBOOK');

  const abortRef = useRef<AbortController | null>(null);

  // ── derived ─────────────────────────────────────────────────────────────
  const activePlatforms = useMemo(() => {
    const brandChannels = selectedBrand.channels.map(c => c.toUpperCase()) as PlatformId[];
    return PLATFORM_LIST.filter(p => brandChannels.includes(p.id));
  }, [selectedBrand]);

  const charCount = estimateCharCount(copy, []);
  const charPct   = Math.min((charCount / selectedPlatform.maxChars) * 100, 100);
  const charColor = charPct > 90 ? 'text-red-400' : charPct > 70 ? 'text-amber-400' : 'text-emerald-400';

  const errors = validatePost({ copy, scheduledAt, brandId: selectedBrand.id }, selectedPlatform.maxChars);

  // ── toggle enhancement active ────────────────────────────────────────────
  const toggleEnhancement = (id: EnhancementId) => {
    setActiveEnhancements(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const cancelEnhancement = () => {
    abortRef.current?.abort();
    setLoadingId(null);
  };

  // ── enhancement handlers ─────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!brief.trim()) return;
    abortRef.current = new AbortController();
    setLoadingId('generate');
    try {
      const result = await generateSocialCopy({
        brief,
        brandName: selectedBrand.name,
        brandDescription: selectedBrand.description,
        brandMarket: selectedBrand.market,
        platform: selectedPlatform.id,
        signal: abortRef.current.signal,
      });
      setCopy(result);
      setBrief('');
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error(e);
    } finally {
      setLoadingId(null);
    }
  };

  const handleEnhance = async () => {
    if (!copy.trim()) return;
    abortRef.current = new AbortController();
    setLoadingId('enhance');
    try {
      const result = await enhanceCopy({
        copy,
        brandName: selectedBrand.name,
        brandDescription: selectedBrand.description,
        platform: selectedPlatform.id,
        signal: abortRef.current.signal,
      });
      setCopy(result);
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error(e);
    } finally {
      setLoadingId(null);
    }
  };

  const handleHashtags = async () => {
    if (!copy.trim()) return;
    abortRef.current = new AbortController();
    setLoadingId('hashtags');
    try {
      const tags = await suggestHashtags({
        copy,
        brandName: selectedBrand.name,
        brandMarket: selectedBrand.market,
        platform: selectedPlatform.id,
        signal: abortRef.current.signal,
      });
      setSuggestedHashtags(tags);
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error(e);
    } finally {
      setLoadingId(null);
    }
  };

  const handleAdapt = async () => {
    if (!copy.trim() || adaptTarget === selectedPlatform.id) return;
    abortRef.current = new AbortController();
    setLoadingId('adapt');
    try {
      const result = await adaptCopyForPlatform({
        copy,
        brandName: selectedBrand.name,
        brandDescription: selectedBrand.description,
        sourcePlatform: selectedPlatform.id,
        targetPlatform: adaptTarget,
        signal: abortRef.current.signal,
      });
      setCopy(result);
      // Switch active platform to target
      const targetPlatform = PLATFORMS[adaptTarget];
      if (targetPlatform) setSelectedPlatform(targetPlatform);
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error(e);
    } finally {
      setLoadingId(null);
    }
  };

  const appendHashtags = () => {
    if (!suggestedHashtags.length) return;
    const hashStr = '\n\n' + suggestedHashtags.join(' ');
    setCopy(prev => prev + hashStr);
    setSuggestedHashtags([]);
  };

  // ── publish handlers ─────────────────────────────────────────────────────

  const handleAddToQueue = () => {
    if (errors.length) return;
    const post: ScheduledPost = {
      id: `post_${Date.now()}`,
      brandId: selectedBrand.id,
      platform: selectedPlatform.id,
      copy,
      hashtags: [],
      mediaUrls: [],
      mediaType: null,
      scheduledAt: new Date(scheduledAt).toISOString(),
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    };
    addPost(post);
    setLastResult({ ok: true, msg: `Post encolado · ${selectedBrand.name} · ${selectedPlatform.label}` });
    setCopy(''); setScheduledAt(''); setSuggestedHashtags([]);
    setTimeout(() => setLastResult(null), 4000);
  };

  const handlePublishNow = async () => {
    if (errors.length) return;
    setIsPublishing(true);
    const post: ScheduledPost = {
      id: `post_${Date.now()}`,
      brandId: selectedBrand.id,
      platform: selectedPlatform.id,
      copy,
      hashtags: [],
      mediaUrls: [],
      mediaType: null,
      scheduledAt: new Date().toISOString(),
      status: 'publishing',
      createdAt: new Date().toISOString(),
    };
    addPost(post);
    const result = await publishPost(post);
    updatePost(post.id, {
      status: result.success ? 'published' : 'failed',
      mockPostId: result.mockPostId,
      publishedAt: result.success ? new Date().toISOString() : undefined,
      errorMsg: result.errorMsg,
    });
    setIsPublishing(false);
    setLastResult({
      ok: result.success,
      msg: result.success
        ? `[MOCK] Publicado · ID: ${result.mockPostId}`
        : `[MOCK] Error: ${result.errorMsg}`,
    });
    if (result.success) { setCopy(''); setScheduledAt(''); setSuggestedHashtags([]); }
    setTimeout(() => setLastResult(null), 6000);
  };

  const handleReset = () => {
    setCopy(''); setScheduledAt(''); setBrief('');
    setSuggestedHashtags([]); setLastResult(null);
    setSelectedBrand(BRAND_LIST[0]);
    setSelectedPlatform(PLATFORMS.INSTAGRAM);
    setLoadingId(null);
  };

  return (
    <div className="flex gap-6 h-full">

      {/* ── LEFT: Config ── */}
      <aside className="w-72 shrink-0 space-y-4">

        {/* Brand */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
          <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Marca</label>
          <div className="space-y-1.5">
            {BRAND_LIST.map(b => (
              <button
                key={b.id}
                onClick={() => {
                  setSelectedBrand(b);
                  const brandChannels = b.channels.map(c => c.toUpperCase());
                  if (!brandChannels.includes(selectedPlatform.id)) {
                    const first = PLATFORM_LIST.find(p => brandChannels.includes(p.id));
                    setSelectedPlatform(first || PLATFORMS.INSTAGRAM);
                  }
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all text-left",
                  selectedBrand.id === b.id
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                )}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                <span className="truncate">{b.name}</span>
                <span className="ml-auto text-[9px] text-zinc-600">{b.market}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Platform */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
          <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Plataforma</label>
          <div className="grid grid-cols-3 gap-1.5">
            {activePlatforms.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedPlatform(p)}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-xs transition-all",
                  selectedPlatform.id === p.id
                    ? "bg-zinc-700 text-white ring-1 ring-zinc-600"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                )}
              >
                <span className="text-lg leading-none">{p.icon}</span>
                <span className="text-[9px] font-medium">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* API status */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2">
          <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wide">Mock API activa</p>
            <p className="text-[9px] text-amber-400/50 mt-1 font-mono break-all">{selectedPlatform.apiEndpoint}</p>
          </div>
        </div>
      </aside>

      {/* ── MAIN: Composer ── */}
      <div className="flex-1 space-y-4 min-w-0">

        {/* Brand accent bar */}
        <div
          className="h-1.5 rounded-full"
          style={{ background: `linear-gradient(to right, ${selectedBrand.color}, ${selectedBrand.color}44)` }}
        />

        {/* ── AI ENHANCEMENTS PANEL ── */}
        <div className={cn(
          "border rounded-xl overflow-hidden transition-colors",
          enhancementsOpen ? "border-accent/30 bg-zinc-900" : "border-zinc-800 bg-zinc-900"
        )}>
          {/* Toggle header */}
          <button
            onClick={() => setEnhancementsOpen(v => !v)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/40 transition-colors"
          >
            <Sparkles size={14} className={cn("transition-colors", enhancementsOpen ? "text-accent" : "text-zinc-600")} />
            <span className={cn("text-xs font-bold uppercase tracking-widest transition-colors", enhancementsOpen ? "text-accent" : "text-zinc-500")}>
              AI Enhancements
            </span>
            {/* Active count badge */}
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
              {activeEnhancements.size}/4 activos
            </span>
            {loadingId && (
              <span className="flex items-center gap-1 text-[10px] text-accent ml-1">
                <Spinner color="#FFAB00" />
                Procesando…
              </span>
            )}
            <ChevronDown
              size={14}
              className={cn("ml-auto text-zinc-600 transition-transform", enhancementsOpen && "rotate-180")}
            />
          </button>

          {/* Enhancement functions */}
          <AnimatePresence initial={false}>
            {enhancementsOpen && (
              <motion.div
                initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                className="overflow-hidden"
              >
                <div className="border-t border-zinc-800 p-4 space-y-3">

                  {/* Toggle pills */}
                  <div className="flex gap-2 flex-wrap">
                    {ENHANCEMENTS.map(e => (
                      <button
                        key={e.id}
                        onClick={() => toggleEnhancement(e.id)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-all border",
                          activeEnhancements.has(e.id)
                            ? "border-transparent text-black"
                            : "bg-transparent border-zinc-700 text-zinc-600 hover:border-zinc-500 hover:text-zinc-400"
                        )}
                        style={activeEnhancements.has(e.id)
                          ? { backgroundColor: e.color }
                          : {}}
                      >
                        <e.icon size={10} />
                        {e.label}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-2">

                    {/* 1. GENERATE */}
                    {activeEnhancements.has('generate') && (
                      <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Sparkles size={12} style={{ color: '#FFAB00' }} />
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Generar copy</span>
                        </div>
                        <div className="flex gap-2">
                          <input
                            value={brief}
                            onChange={e => setBrief(e.target.value)}
                            placeholder="Brief: describe el objetivo del post, producto, oferta…"
                            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent/50"
                            onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                          />
                          <button
                            onClick={loadingId === 'generate' ? cancelEnhancement : handleGenerate}
                            disabled={!brief.trim() && loadingId !== 'generate'}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                              loadingId === 'generate'
                                ? "bg-red-500/20 border border-red-500/30 text-red-400"
                                : "bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-40"
                            )}
                          >
                            {loadingId === 'generate' ? <><X size={11} />Cancelar</> : <><Sparkles size={11} />Generar</>}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 2. ENHANCE */}
                    {activeEnhancements.has('enhance') && (
                      <div className="bg-zinc-800/50 rounded-lg p-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <Wand2 size={12} style={{ color: '#A855F7' }} />
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Mejorar copy</span>
                          </div>
                          <p className="text-[10px] text-zinc-600">Reescribe y optimiza para {selectedPlatform.label}</p>
                        </div>
                        <button
                          onClick={loadingId === 'enhance' ? cancelEnhancement : handleEnhance}
                          disabled={!copy.trim() && loadingId !== 'enhance'}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0",
                            loadingId === 'enhance'
                              ? "bg-red-500/20 border border-red-500/30 text-red-400"
                              : "bg-purple-500 hover:bg-purple-400 text-white disabled:opacity-40"
                          )}
                        >
                          {loadingId === 'enhance'
                            ? <><X size={11} />Cancelar</>
                            : <><Wand2 size={11} />Mejorar</>}
                        </button>
                      </div>
                    )}

                    {/* 3. HASHTAGS */}
                    {activeEnhancements.has('hashtags') && (
                      <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-0.5">
                              <Tags size={12} style={{ color: '#22C55E' }} />
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Sugerir hashtags</span>
                            </div>
                            <p className="text-[10px] text-zinc-600">Optimizados para {selectedPlatform.label}</p>
                          </div>
                          <button
                            onClick={loadingId === 'hashtags' ? cancelEnhancement : handleHashtags}
                            disabled={!copy.trim() && loadingId !== 'hashtags'}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0",
                              loadingId === 'hashtags'
                                ? "bg-red-500/20 border border-red-500/30 text-red-400"
                                : "bg-emerald-500 hover:bg-emerald-400 text-black disabled:opacity-40"
                            )}
                          >
                            {loadingId === 'hashtags'
                              ? <><X size={11} />Cancelar</>
                              : <><Tags size={11} />Sugerir</>}
                          </button>
                        </div>
                        {/* Suggested hashtags result */}
                        <AnimatePresence>
                          {suggestedHashtags.length > 0 && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="border border-emerald-500/20 rounded-lg p-2.5 space-y-2">
                                <div className="flex flex-wrap gap-1">
                                  {suggestedHashtags.map((tag, i) => (
                                    <span
                                      key={i}
                                      className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-mono"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={appendHashtags}
                                    className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
                                  >
                                    ↓ Añadir al copy
                                  </button>
                                  <button
                                    onClick={() => setSuggestedHashtags([])}
                                    className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                                  >
                                    Descartar
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {/* 4. ADAPT */}
                    {activeEnhancements.has('adapt') && (
                      <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2 mb-1">
                          <Repeat2 size={12} style={{ color: '#3B82F6' }} />
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Adaptar plataforma</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-zinc-600 shrink-0">
                            {selectedPlatform.icon} {selectedPlatform.label}
                          </span>
                          <ChevronRight size={10} className="text-zinc-600 shrink-0" />
                          <select
                            value={adaptTarget}
                            onChange={e => setAdaptTarget(e.target.value as PlatformId)}
                            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500/50"
                          >
                            {PLATFORM_LIST
                              .filter(p => p.id !== selectedPlatform.id)
                              .map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.icon} {p.label}
                                </option>
                              ))}
                          </select>
                          <button
                            onClick={loadingId === 'adapt' ? cancelEnhancement : handleAdapt}
                            disabled={!copy.trim() && loadingId !== 'adapt'}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0",
                              loadingId === 'adapt'
                                ? "bg-red-500/20 border border-red-500/30 text-red-400"
                                : "bg-blue-500 hover:bg-blue-400 text-white disabled:opacity-40"
                            )}
                          >
                            {loadingId === 'adapt'
                              ? <><X size={11} />Cancelar</>
                              : <><Repeat2 size={11} />Adaptar</>}
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── COPY COMPOSER ── */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-zinc-500">Copy</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                {selectedPlatform.icon} {selectedPlatform.label}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn("text-xs font-mono", charColor)}>
                {charCount} / {selectedPlatform.maxChars.toLocaleString()}
              </span>
              <button
                onClick={() => setPreviewOpen(!previewOpen)}
                className={cn(
                  "flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors",
                  previewOpen ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                )}
              >
                <Eye size={11} />
                Preview
              </button>
            </div>
          </div>

          <textarea
            value={copy}
            onChange={e => setCopy(e.target.value)}
            placeholder={`Escribe el copy para ${selectedPlatform.label}…\n\nO usa AI Enhancements ↑ para generar desde un brief.`}
            className="w-full h-48 bg-transparent px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-700 resize-none outline-none leading-relaxed"
          />

          <div className="px-4 pb-3">
            <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div
                className={cn(
                  "h-full rounded-full transition-colors",
                  charPct > 90 ? "bg-red-500" : charPct > 70 ? "bg-amber-500" : "bg-emerald-500"
                )}
                animate={{ width: `${charPct}%` }}
                transition={{ type: "spring", damping: 20 }}
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <AnimatePresence>
          {previewOpen && copy && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2"
            >
              <p className="text-[10px] uppercase font-bold text-zinc-600">Preview · {selectedPlatform.label}</p>
              <div className="bg-zinc-950 rounded-lg p-3 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {copy}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Media placeholder */}
        <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-4 flex items-center gap-3 text-zinc-600">
          <div className="flex gap-2">
            <Image size={16} />
            <Video size={16} />
          </div>
          <p className="text-xs">Adjuntar media — disponible cuando ImageLab / VideoLab esté conectado</p>
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-600">Próximamente</span>
        </div>

        {/* Schedule + Actions */}
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-zinc-600 flex items-center gap-1">
              <Clock size={10} />
              Fecha y hora
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 outline-none focus:border-accent/50 transition-colors [color-scheme:dark]"
            />
          </div>

          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm font-medium transition-all"
          >
            <RotateCcw size={14} />
            Reset
          </button>

          <button
            onClick={handleAddToQueue}
            disabled={errors.length > 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-all disabled:opacity-40"
          >
            <Plus size={14} />
            Encolar
          </button>

          <button
            onClick={handlePublishNow}
            disabled={errors.length > 0 || isPublishing}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-accent hover:bg-accent/90 text-black text-sm font-bold transition-all disabled:opacity-40"
          >
            {isPublishing
              ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              : <Send size={14} />}
            {isPublishing ? 'Enviando…' : 'Publicar ahora'}
          </button>
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((e, i) => (
              <p key={i} className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle size={11} /> {e}
              </p>
            ))}
          </div>
        )}

        {/* Toast */}
        <AnimatePresence>
          {lastResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium",
                lastResult.ok
                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                  : "bg-red-500/10 border border-red-500/20 text-red-400"
              )}
            >
              {lastResult.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {lastResult.msg}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}