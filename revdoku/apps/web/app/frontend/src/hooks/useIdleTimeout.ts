import { useEffect, useRef, useCallback } from 'react';

const DEFAULT_IDLE_TIMEOUT_MS = 13 * 24 * 60 * 60 * 1000; // 13 days (casual mode — 1 day before server's 14-day idle timeout)
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];

/**
 * Redirects to login after idle timeout.
 * @param idleTimeoutSeconds - idle timeout from manifest security config (in seconds).
 *   If provided, uses 1 minute less than server timeout to redirect before server rejects.
 *   Falls back to DEFAULT_IDLE_TIMEOUT_MS for casual accounts.
 */
export function useIdleTimeout(idleTimeoutSeconds?: number) {
  const timeoutMs = idleTimeoutSeconds
    ? Math.max((idleTimeoutSeconds - 60) * 1000, 60_000) // At least 1 minute
    : DEFAULT_IDLE_TIMEOUT_MS;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const redirectToLogin = useCallback(() => {
    window.location.href = '/users/sign_in';
  }, []);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(redirectToLogin, timeoutMs);
  }, [redirectToLogin, timeoutMs]);

  useEffect(() => {
    resetTimer();
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, resetTimer, { passive: true });
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, resetTimer);
      }
    };
  }, [resetTimer]);
}
