import { createContext, useContext, useState, useCallback } from 'react';
import type { IEnvelope } from '@revdoku/lib';

type TitleMap = Map<string, string>;

interface EnvelopeTitleContextValue {
  titleMap: TitleMap;
  updateTitles: (envelopes: IEnvelope[]) => void;
}

const EnvelopeTitleContext = createContext<EnvelopeTitleContextValue>({
  titleMap: new Map(),
  updateTitles: () => {},
});

export function EnvelopeTitleProvider({ children }: { children: React.ReactNode }) {
  const [titleMap, setTitleMap] = useState<TitleMap>(new Map());

  const updateTitles = useCallback((envelopes: IEnvelope[]) => {
    setTitleMap(prev => {
      const next = new Map(prev);
      for (const env of envelopes) {
        if (env.id && env.title) next.set(env.id, env.title);
      }
      return next;
    });
  }, []);

  return (
    <EnvelopeTitleContext.Provider value={{ titleMap, updateTitles }}>
      {children}
    </EnvelopeTitleContext.Provider>
  );
}

/** Read-only hook for consumers that just need to look up titles */
export function useEnvelopeTitles(): TitleMap {
  return useContext(EnvelopeTitleContext).titleMap;
}

/** Hook for producers that populate the title map */
export function useEnvelopeTitleUpdater() {
  return useContext(EnvelopeTitleContext).updateTitles;
}
