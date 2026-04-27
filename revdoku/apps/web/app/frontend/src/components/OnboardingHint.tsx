import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

interface OnboardingHintProps {
  hintKey: string;
  message: string;
  position?: 'top' | 'bottom';
  align?: 'center' | 'start' | 'end';
  pulseTarget?: boolean;
  autoDismissMs?: number;
  disabled?: boolean;
  transient?: boolean;
  onDismiss?: () => void;
  targetRef?: React.RefObject<HTMLElement | null>;  // External target element (skip wrapper)
  children?: React.ReactNode;
}

const STORAGE_PREFIX = 'revdoku_hint_dismissed_';

export default function OnboardingHint({
  hintKey,
  message,
  position = 'bottom',
  align = 'center',
  pulseTarget = true,
  autoDismissMs = 0,
  disabled = false,
  transient = false,
  onDismiss,
  targetRef: externalTargetRef,
  children,
}: OnboardingHintProps) {
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);
  const [bubblePos, setBubblePos] = useState<{ top: number; left: number } | null>(null);
  const dismissed = useRef(false);
  const internalTargetRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Use external ref if provided, otherwise internal
  const effectiveTargetRef = externalTargetRef || internalTargetRef;
  const isExternalMode = !!externalTargetRef;

  const storageKey = `${STORAGE_PREFIX}${hintKey}`;

  // Check localStorage on mount (skip for transient hints)
  const alreadyDismissed = !transient && typeof window !== 'undefined' && localStorage.getItem(storageKey) === '1';

  const dismiss = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    setVisible(false);
    setEntered(false);
    if (!transient) {
      try {
        localStorage.setItem(storageKey, '1');
      } catch {
        // localStorage full or unavailable
      }
    }
    onDismiss?.();
  }, [storageKey, transient, onDismiss]);

  const updatePosition = useCallback(() => {
    const target = effectiveTargetRef.current;
    if (!target || !visible) return;

    const rect = target.getBoundingClientRect();
    const bubble = bubbleRef.current;
    const bubbleHeight = bubble ? bubble.offsetHeight : 0;
    const gap = 16;

    let top: number;
    if (position === 'top') {
      top = rect.top - bubbleHeight - gap;
    } else {
      top = rect.bottom + gap;
    }

    let left: number;
    if (align === 'start') {
      left = rect.left;
    } else if (align === 'end') {
      left = rect.right;
    } else {
      left = rect.left + rect.width / 2;
    }

    setBubblePos({ top, left });
  }, [visible, position, align, effectiveTargetRef]);

  // Reset dismissed ref when disabled transitions to true (so hint can re-show later)
  useEffect(() => {
    if (disabled) {
      dismissed.current = false;
      setVisible(false);
      setEntered(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (alreadyDismissed || disabled) return;

    const showTimer = setTimeout(() => {
      setVisible(true);
      // Trigger entrance animation on next frame
      requestAnimationFrame(() => setEntered(true));
    }, 1000);

    return () => clearTimeout(showTimer);
  }, [alreadyDismissed, disabled]);

  useEffect(() => {
    if (!visible || autoDismissMs <= 0) return;
    const timer = setTimeout(dismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [visible, autoDismissMs, dismiss]);

  // Calculate position when visible or bubble mounts
  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, entered, disabled]);

  // Recalculate on scroll/resize
  useEffect(() => {
    if (!visible) return;

    const handleReposition = () => updatePosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [visible, updatePosition]);

  // Attach click listener to external target for dismissal
  useEffect(() => {
    if (!isExternalMode || !visible) return;
    const target = externalTargetRef?.current;
    if (!target) return;

    const handleClick = () => dismiss();
    target.addEventListener('click', handleClick);
    return () => target.removeEventListener('click', handleClick);
  }, [isExternalMode, visible, externalTargetRef, dismiss]);

  // If disabled or already dismissed, render children only
  if (disabled || alreadyDismissed) {
    return <>{children}</>;
  }

  const alignTransform =
    align === 'end' ? 'translateX(-100%)' :
    align === 'center' ? 'translateX(-50%)' :
    undefined;

  const arrowAlignClass =
    align === 'end' ? 'right-6' :
    align === 'start' ? 'left-6' :
    'left-1/2 -translate-x-1/2';

  const bubble = visible && bubblePos && (
    <div
      ref={bubbleRef}
      style={{
        position: 'fixed',
        top: bubblePos.top,
        left: bubblePos.left,
        transform: alignTransform,
        zIndex: 9999,
        pointerEvents: 'auto',
      }}
      className={`transition-opacity duration-300 ${
        entered ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={(e) => { e.stopPropagation(); dismiss(); }}
    >
      <div className={`relative bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg cursor-pointer whitespace-nowrap ${entered ? 'animate-hint-bounce' : ''}`}>
        {position === 'bottom' && (
          <div className={`absolute -top-1.5 w-3 h-3 bg-indigo-600 rotate-45 ${arrowAlignClass}`} />
        )}
        {message}
        {position === 'top' && (
          <div className={`absolute -bottom-1.5 w-3 h-3 bg-indigo-600 rotate-45 ${arrowAlignClass}`} />
        )}
      </div>
    </div>
  );

  // External target mode: only render the portal bubble (no wrapper)
  if (isExternalMode) {
    return <>{bubble && createPortal(bubble, document.body)}</>;
  }

  // Children mode: wrap with display:contents to be transparent to parent flex layout
  return (
    <div style={{ display: 'contents' }}>
      {/* Target element with optional pulse ring */}
      <div ref={internalTargetRef} className="relative inline-flex" onClick={dismiss}>
        {children}
        {pulseTarget && visible && (
          <div className="absolute inset-0 rounded-lg border-2 border-indigo-400 animate-hint-pulse-ring pointer-events-none" />
        )}
      </div>

      {/* Bubble rendered via portal at document.body */}
      {bubble && createPortal(bubble, document.body)}
    </div>
  );
}
