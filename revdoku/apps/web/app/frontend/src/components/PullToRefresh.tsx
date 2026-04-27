import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

interface Props {
  onRefresh: () => void | Promise<unknown>;
  children: ReactNode;
  /** Pixels the user must pull past to trigger refresh. Default 70. */
  threshold?: number;
  /** Max visual translation of the content. Default 120. */
  maxPull?: number;
  /** Which scrollable element to watch. Defaults to window. */
  scrollContainer?: HTMLElement | null;
  disabled?: boolean;
}

/**
 * Lightweight pull-to-refresh for touch devices.
 *
 * - No-op on desktop / non-touch pointers.
 * - Only engages when the scrollable ancestor is scrolled to the very top.
 * - Shows a circular spinner that rotates in proportion to pull distance;
 *   releases triggering `onRefresh()` when pulled past `threshold`.
 * - Rubber-banded translation tops out at `maxPull`.
 */
export function PullToRefresh({
  onRefresh,
  children,
  threshold = 70,
  maxPull = 120,
  scrollContainer,
  disabled = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const [pull, setPull] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (disabled) return;
    if (typeof window === 'undefined') return;
    // Only activate on primary-touch devices. Avoids conflict with desktop
    // trackpad rubber-banding.
    if (!('ontouchstart' in window)) return;

    const el = containerRef.current;
    if (!el) return;

    const scrollRoot = (): HTMLElement | Window =>
      scrollContainer ?? (document.scrollingElement as HTMLElement) ?? window;

    const getScrollTop = () => {
      const root = scrollRoot();
      return root instanceof Window ? window.scrollY : (root as HTMLElement).scrollTop;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (isRefreshing) return;
      if (getScrollTop() > 0) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0].clientY;
      activeRef.current = false;
      setPull(0);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isRefreshing) return;
      if (startYRef.current == null) return;
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta <= 0) {
        if (activeRef.current) setPull(0);
        activeRef.current = false;
        return;
      }
      // Rubber-band: resistance increases past threshold so user can't pull forever.
      const eased = delta < threshold
        ? delta
        : threshold + (delta - threshold) * 0.4;
      const clamped = Math.min(eased, maxPull);
      setPull(clamped);
      activeRef.current = true;
      if (e.cancelable && delta > 8) e.preventDefault();
    };

    const onTouchEnd = async () => {
      if (isRefreshing) return;
      const wasActive = activeRef.current;
      const finalPull = pull;
      startYRef.current = null;
      activeRef.current = false;

      if (!wasActive || finalPull < threshold) {
        setPull(0);
        return;
      }

      setIsRefreshing(true);
      // Hold the indicator visible at threshold during refresh
      setPull(threshold);
      try {
        await onRefresh();
      } catch {
        /* refresh failures surface via the caller's own toast */
      } finally {
        setIsRefreshing(false);
        setPull(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [disabled, threshold, maxPull, scrollContainer, onRefresh, pull, isRefreshing]);

  const progress = Math.min(pull / threshold, 1);
  const triggered = pull >= threshold;

  return (
    <div ref={containerRef} className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 flex items-center justify-center rounded-full bg-background/90 border border-border shadow-sm transition-opacity"
        style={{
          width: 36,
          height: 36,
          top: Math.max(pull - 40, -40),
          opacity: pull > 0 ? 1 : 0,
        }}
      >
        <RefreshCw
          className={
            'h-4 w-4 ' +
            (isRefreshing ? 'animate-spin text-primary' : triggered ? 'text-primary' : 'text-muted-foreground')
          }
          style={{
            transform: isRefreshing ? undefined : `rotate(${progress * 360}deg)`,
            transition: isRefreshing ? undefined : 'transform 0.05s linear',
          }}
        />
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: pull === 0 ? 'transform 0.25s ease' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
