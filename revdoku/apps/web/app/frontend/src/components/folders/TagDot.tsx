import React from 'react';
import type { TagColor } from '@revdoku/lib';
import { TAG_DOT_CLASSES } from '@/lib/tag-colors';

interface TagDotProps {
  color: TagColor;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  name?: string;
  showLetter?: boolean;
}

const TagDot = React.memo(function TagDot({ color, size = 'sm', className = '', name, showLetter }: TagDotProps) {
  const sizeClass = size === 'lg' ? 'w-5 h-5' : size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5';
  const letter = showLetter && name ? name.charAt(0).toUpperCase() : null;

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full ${sizeClass} ${TAG_DOT_CLASSES[color]} ${letter ? 'text-white font-semibold text-[10px] leading-none' : ''} ${className}`}
      aria-label={name || `${color} tag`}
      title={name}
    >
      {letter}
    </span>
  );
});

export default TagDot;
