import { useState, useCallback, useEffect, useRef } from 'react';

export type SaveTrackerStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveTrackerState {
  status: SaveTrackerStatus;
  lastSaved?: Date;
  error?: string;
}

/**
 * Aggregates multiple concurrent save operations into a single status.
 *
 * Usage:
 *   const { saveState, trackSave, reportExternalStatus } = useSaveTracker();
 *   await trackSave(ApiClient.updateCheck(id, data));
 */
export function useSaveTracker(savedDisplayMs = 2000) {
  const [saveState, setSaveState] = useState<SaveTrackerState>({ status: 'idle' });
  const inFlightRef = useRef(0);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  };

  const trackSave = useCallback(<T>(promise: Promise<T>): Promise<T> => {
    inFlightRef.current += 1;
    clearTimers();
    setSaveState({ status: 'saving' });

    promise.then(
      () => {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        if (inFlightRef.current === 0) {
          setSaveState({ status: 'saved', lastSaved: new Date() });
          savedTimerRef.current = setTimeout(() => {
            // Only clear if still 'saved' (no new save started)
            setSaveState(prev => prev.status === 'saved' ? { status: 'idle' } : prev);
          }, savedDisplayMs);
        }
      },
      (err) => {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        const msg = err instanceof Error ? err.message : 'Save failed';
        setSaveState({ status: 'error', error: msg });
        // No auto-dismiss — error stays visible until next save starts
      },
    );

    return promise;
  }, [savedDisplayMs]);

  /**
   * Mirror an external status (e.g. from useAutoSave) into the tracker.
   * Only takes effect when no tracked saves are in-flight.
   */
  const reportExternalStatus = useCallback((external: { status: string; lastSaved?: Date; error?: string }) => {
    if (inFlightRef.current > 0) return; // tracked saves take priority

    switch (external.status) {
      case 'saving':
        clearTimers();
        setSaveState({ status: 'saving' });
        break;
      case 'saved':
        setSaveState({ status: 'saved', lastSaved: external.lastSaved ?? new Date() });
        savedTimerRef.current = setTimeout(() => {
          setSaveState(prev => prev.status === 'saved' ? { status: 'idle' } : prev);
        }, savedDisplayMs);
        break;
      case 'error':
        setSaveState({ status: 'error', error: external.error });
        // No auto-dismiss — error stays visible until next save starts
        break;
      // 'idle' and 'pending' — don't overwrite tracker state
    }
  }, [savedDisplayMs]);

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  return { saveState, trackSave, reportExternalStatus };
}
