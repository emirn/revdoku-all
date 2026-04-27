import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Inbox, ClipboardCheck, FileX, Star, Clock } from 'lucide-react';
import type { FolderTab } from '@/lib/envelope-grouping';

interface FolderTabBarProps {
  tabs: FolderTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

const FolderTabBar = React.memo(function FolderTabBar({
  tabs,
  activeTab,
  onTabChange
}: FolderTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkOverflow();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkOverflow, { passive: true });
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkOverflow);
      ro.disconnect();
    };
  }, [checkOverflow, tabs]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.6;
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <div className="relative flex items-center">
      {/* Left scroll arrow */}
      {canScrollLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 z-10 h-full px-1 bg-gradient-to-r from-background via-background to-transparent"
          aria-label="Scroll tabs left"
        >
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      {/* Tab strip */}
      <div
        ref={scrollRef}
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide border-b border-border w-full py-1"
      >
        {tabs.map(tab => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                relative whitespace-nowrap px-3.5 py-2 text-sm font-medium transition-all shrink-0
                rounded-t-md border-b-2
                ${isActive
                  ? 'border-indigo-500 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60 dark:hover:bg-muted/30'
                }
              `}
            >
              {tab.id === 'all' ? (
                <Inbox className="h-3.5 w-3.5 mr-1.5 inline" />
              ) : tab.id === 'starred' ? (
                <Star className="h-3.5 w-3.5 mr-1.5 inline" />
              ) : tab.id === 'recent' ? (
                <Clock className="h-3.5 w-3.5 mr-1.5 inline" />
              ) : tab.id === 'drafts' ? (
                <FileX className="h-3.5 w-3.5 mr-1.5 inline" />
              ) : (
                <ClipboardCheck className="h-3.5 w-3.5 mr-1.5 inline" />
              )}
              {tab.label}
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] px-1 py-0.5 rounded-full text-[11px] font-semibold tabular-nums leading-none ${
                isActive
                  ? 'bg-indigo-500/15 text-indigo-600 dark:bg-indigo-400/20 dark:text-indigo-300'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Right scroll arrow */}
      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 z-10 h-full px-1 bg-gradient-to-l from-background via-background to-transparent"
          aria-label="Scroll tabs right"
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
});

export default FolderTabBar;
