import type { SidebarEnvelopeInfo } from './useSidebarEnvelopes';

interface SidebarEnvelopeItemProps {
  envelope: SidebarEnvelopeInfo;
  isActive: boolean;
  isFocused: boolean;
  onSelect: (prefixId: string) => void;
}

export function SidebarEnvelopeItem({ envelope, isActive, isFocused, onSelect }: SidebarEnvelopeItemProps) {
  const { totalChecks, passedChecks } = envelope.inspection;
  const hasChecks = totalChecks > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(envelope.prefixId)}
      data-envelope-id={envelope.prefixId}
      className={`
        w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm rounded-md transition-colors
        border-l-2
        ${isActive
          ? 'bg-accent border-primary font-medium'
          : isFocused
            ? 'bg-accent/50 border-transparent'
            : 'hover:bg-accent/50 border-transparent'
        }
      `}
    >
      <span className={`shrink-0 w-2 h-2 rounded-full ${envelope.inspection.dotColor}`} />
      <span className="truncate flex-1 min-w-0">{envelope.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {hasChecks ? `${passedChecks}/${totalChecks}` : ''}
      </span>
    </button>
  );
}
