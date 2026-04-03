/**
 * SocialLabContext.tsx
 * Loads humanize profiles from Supabase on mount.
 * Falls back to hardcoded humanizeConfig.ts automatically.
 */

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  loadSocialLabData,
  SocialLabData,
  FALLBACK_DATA,
} from '../services/socialLabLoader';

interface SocialLabContextValue {
  data: SocialLabData;
  isLoading: boolean;
  source: 'supabase' | 'fallback' | null;
}

const SocialLabContext = createContext<SocialLabContextValue>({
  data: FALLBACK_DATA,
  isLoading: true,
  source: null,
});

export function SocialLabProvider({ children }: { children: ReactNode }) {
  const [data, setData]       = useState<SocialLabData>(FALLBACK_DATA);
  const [isLoading, setLoading] = useState(true);
  const [source, setSource]   = useState<'supabase' | 'fallback' | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadSocialLabData()
      .then(loaded => {
        if (!cancelled) {
          setData(loaded);
          setSource('supabase');
          const count = Object.keys(loaded.humanizeByBrand).length;
          console.info(`[SocialLabContext] Supabase loaded — ${count} humanize profiles`);
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.warn('[SocialLabContext] Supabase failed, using fallback:', err.message);
          setData(FALLBACK_DATA);
          setSource('fallback');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return (
    <SocialLabContext.Provider value={{ data, isLoading, source }}>
      {children}
    </SocialLabContext.Provider>
  );
}

export function useSocialLab(): SocialLabContextValue {
  return useContext(SocialLabContext);
}
