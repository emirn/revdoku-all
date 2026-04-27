import { useState, useEffect, useRef } from 'react';

export type GlobalSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useGlobalSaveIndicator(savedDisplayMs = 2000): GlobalSaveStatus {
  const [status, setStatus] = useState<GlobalSaveStatus>('idle');
  const inFlightRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const onStart = () => {
      inFlightRef.current += 1;
      clearTimer();
      setStatus('saving');
    };

    const onEnd = () => {
      inFlightRef.current = Math.max(0, inFlightRef.current - 1);
      if (inFlightRef.current === 0) {
        setStatus('saved');
        timerRef.current = setTimeout(() => {
          setStatus(prev => prev === 'saved' ? 'idle' : prev);
        }, savedDisplayMs);
      }
    };

    const onError = () => {
      inFlightRef.current = Math.max(0, inFlightRef.current - 1);
      setStatus('error');
      // No auto-dismiss — error stays visible until next save starts
    };

    document.addEventListener('api:save:start', onStart);
    document.addEventListener('api:save:end', onEnd);
    document.addEventListener('api:save:error', onError);

    return () => {
      document.removeEventListener('api:save:start', onStart);
      document.removeEventListener('api:save:end', onEnd);
      document.removeEventListener('api:save:error', onError);
      clearTimer();
    };
  }, [savedDisplayMs]);

  return status;
}
