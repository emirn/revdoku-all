import React from 'react';
import type { ITag } from '@revdoku/lib';
import { X } from 'lucide-react';
import { TAG_BG_LIGHT_CLASSES, TAG_TEXT_CLASSES, TAG_BORDER_CLASSES } from '@/lib/tag-colors';

interface TagChipProps {
  tag: ITag;
  size?: 'sm' | 'md';
  onRemove?: () => void;
  onClick?: () => void;
  className?: string;
}

const TagChip = React.memo(function TagChip({ tag, size = 'sm', onRemove, onClick, className = '' }: TagChipProps) {
  const isGray = tag.color === 'gray';
  const bgClass = isGray ? 'bg-gray-100 dark:bg-gray-800' : TAG_BG_LIGHT_CLASSES[tag.color];
  const textClass = isGray ? 'text-gray-600 dark:text-gray-400' : TAG_TEXT_CLASSES[tag.color];
  const borderClass = isGray ? 'border-gray-200 dark:border-gray-700' : TAG_BORDER_CLASSES[tag.color];
  const sizeClasses = size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5';

  // Prefer the server-computed `full_path` (e.g. "Checklists/Vendor Invoice…")
  // so nested tags show their parent context inline. Parents are muted so
  // the leaf stays the visual anchor. Root-level tags fall back to just the
  // name (no separator or prefix).
  const rawPath = tag.full_path || tag.name;
  const parts = rawPath.split('/').filter(Boolean);
  const prettyPath = parts.join(' › ');

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded font-medium border ${bgClass} ${textClass} ${borderClass} ${sizeClasses} ${onClick ? 'cursor-pointer hover:opacity-80' : ''} ${className}`}
      title={prettyPath}
      onClick={onClick ? (e) => { e.stopPropagation(); e.preventDefault(); onClick(); } : undefined}
    >
      {parts.length > 1 ? (
        <span className="inline-flex items-center gap-0.5">
          <span className="opacity-60">{parts.slice(0, -1).join(' › ')}</span>
          <span className="opacity-60">›</span>
          <span>{parts[parts.length - 1]}</span>
        </span>
      ) : (
        <span>{tag.name}</span>
      )}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(); }}
          className="ml-0.5 hover:opacity-70 flex-shrink-0"
          aria-label={`Remove ${tag.name}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
});

export default TagChip;
