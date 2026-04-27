import { Square, CircleDot, Underline, Scan } from 'lucide-react';
import { HighlightMode, REVDOKU_HIGHLIGHT_MODES_CONFIG, REVDOKU_DEFAULT_HIGHLIGHT_MODE } from '@revdoku/lib';
import type { HighlightModeIcon } from '@revdoku/lib';

const ICON_MAP: Record<HighlightModeIcon, React.ComponentType<{ className?: string }>> = {
  'square': Square,
  'circle-dot': CircleDot,
  'underline': Underline,
  'scan': Scan,
};

/** Text symbols for native <option> elements (can't render icons) */
const SYMBOL_MAP: Record<HighlightModeIcon, string> = {
  'square': ' ▢ ',
  'circle-dot': '  •  ',
  'underline': '  ‗  ',
  'scan': '⌜ ⌟',
};

interface HighlightModeSelectProps {
  value?: HighlightMode | number | null;
  onChange: (mode: HighlightMode) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Shared dropdown for selecting highlight drawing mode.
 * Shows symbol + label for each mode from the centralized REVDOKU_HIGHLIGHT_MODES_CONFIG.
 */
export default function HighlightModeSelect({
  value,
  onChange,
  disabled,
  className,
}: HighlightModeSelectProps) {
  const currentValue = value ?? REVDOKU_DEFAULT_HIGHLIGHT_MODE;

  return (
    <select
      value={String(currentValue)}
      onChange={(e) => onChange(Number(e.target.value) as HighlightMode)}
      disabled={disabled}
      className={className || "h-7 px-1 text-xs bg-secondary text-secondary-foreground rounded border-0 hover:bg-accent transition-colors cursor-pointer"}
      title="Highlight drawing mode"
    >
      {REVDOKU_HIGHLIGHT_MODES_CONFIG.map((m) => (
        <option key={m.mode} value={String(m.mode)}>
          {SYMBOL_MAP[m.icon]} {m.label}
        </option>
      ))}
    </select>
  );
}

/** Get the Lucide icon component for a highlight mode */
export function getHighlightModeIcon(icon: HighlightModeIcon) {
  return ICON_MAP[icon];
}
