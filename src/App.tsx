import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PenSquare, Calendar, ListChecks, Bell } from 'lucide-react';
import { cn } from './ui/components';
import PostBuilderModule from './modules/postbuilder/PostBuilderModule';
import CalendarModule from './modules/calendar/CalendarModule';
import QueueModule from './modules/queue/QueueModule';
import { SocialLabProvider } from './context/SocialLabContext';
import { usePostStore } from './store/usePostStore';

const BUILD_TAG = 'SL_2.0';

const Logo = () => (
  <div className="flex items-center gap-2 font-bold tracking-tighter text-xl">
    <div className="w-6 h-6 bg-[#FFAB00] rounded-sm flex items-center justify-center text-black text-[10px] font-black">UV</div>
    <span>UNRLVL</span>
  </div>
);

type TabId = 'builder' | 'calendar' | 'queue';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('builder');
  const { posts } = usePostStore();
  const scheduledCount = posts.filter(p => p.status === 'scheduled').length;
  const failedCount    = posts.filter(p => p.status === 'failed').length;

  const tabs: { id: TabId; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: 'builder',  label: 'Post Builder', icon: PenSquare },
    { id: 'calendar', label: 'Calendar',      icon: Calendar,   badge: scheduledCount || undefined },
    { id: 'queue',    label: 'Queue',         icon: ListChecks, badge: failedCount || undefined },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-zinc-200 selection:bg-[#FFAB00]/30">
      {/* Header */}
      <header className="h-14 border-b border-zinc-800 px-6 flex items-center justify-between sticky top-0 bg-[#0A0A0A]/90 backdrop-blur-md z-50">
        <div className="flex items-center gap-6">
          <Logo />
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-[#FFAB00]">UNRLVL — SocialLab</span>
            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-500">{BUILD_TAG}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-amber-400/70 bg-amber-500/5 border border-amber-500/20 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            MOCK PUBLISH ACTIVE
          </div>
          <button className="p-2 hover:bg-zinc-800 rounded-full transition-colors relative">
            <Bell className="w-4 h-4 text-zinc-500" />
            {failedCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-[#0A0A0A]" />
            )}
          </button>
        </div>
      </header>

      {/*
        SocialLabProvider wraps the full content area.
        All three tabs (builder, calendar, queue) share the same loaded data.
      */}
      <SocialLabProvider>
        <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800 w-fit">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all relative',
                  activeTab === tab.id
                    ? 'bg-[#FFAB00] text-black shadow-lg shadow-[#FFAB00]/20'
                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {tab.badge && tab.badge > 0 && (
                  <span className={cn(
                    'w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center',
                    activeTab === tab.id ? 'bg-black/20 text-black' : 'bg-red-500 text-white'
                  )}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="pb-16">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                {activeTab === 'builder'  && <PostBuilderModule />}
                {activeTab === 'calendar' && <CalendarModule />}
                {activeTab === 'queue'    && <QueueModule />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </SocialLabProvider>

      {/* Footer */}
      <footer className="h-8 border-t border-zinc-800/50 px-6 flex items-center justify-between text-[10px] font-mono text-zinc-700 uppercase tracking-widest bg-[#0A0A0A]/50 backdrop-blur-sm fixed bottom-0 left-0 right-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            System Ready
          </div>
          <span>{posts.length} posts en store</span>
        </div>
        <span className="text-[#FFAB00]/30">UNRLVL SocialLab {BUILD_TAG}</span>
      </footer>
    </div>
  );
}
