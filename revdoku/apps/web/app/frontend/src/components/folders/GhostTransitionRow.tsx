import React, { useEffect, useState } from 'react';
import { Clock, ArrowRight } from 'lucide-react';

export interface FolderTransition {
  envelopeId: string;
  title: string;
  fromStatus: 'drafts' | 'reviewing';
  toStatus: 'drafts' | 'reviewing';
  timestamp: number;
}

const STATUS_LABELS: Record<string, string> = {
  'drafts': 'Inbox',
  'reviewing': 'Reviewing',
};

export default function GhostTransitionRow({
  transition,
  onNavigate,
}: {
  transition: FolderTransition;
  onNavigate: (toStatus: string) => void;
}) {
  const [exiting, setExiting] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), 7500);
    const removeTimer = setTimeout(() => setRemoved(true), 8000);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (removed) return null;

  const Icon = Clock;
  const destLabel = STATUS_LABELS[transition.toStatus] || transition.toStatus;

  return (
    <button
      onClick={() => onNavigate(transition.toStatus)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-l-2 border-emerald-400 cursor-pointer hover:bg-muted/50 transition-colors ${exiting ? 'ghost-row-exit' : 'ghost-row'
        }`}
    >
      <Icon className="h-4 w-4 text-emerald-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-muted-foreground truncate block">
          {transition.title || 'Untitled'}
        </span>
        <span className="text-xs text-muted-foreground/70 flex items-center gap-1">
          Moved to {destLabel} <ArrowRight className="h-3 w-3 inline" />
        </span>
      </div>
    </button>
  );
}
