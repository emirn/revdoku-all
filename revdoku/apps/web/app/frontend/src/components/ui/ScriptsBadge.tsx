import { Code2 } from 'lucide-react';
import type { IUserScript } from '@revdoku/lib';

interface ScriptsBadgeProps {
  userScripts?: IUserScript[];
  hasScripts?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function ScriptsBadge({ userScripts, hasScripts, size = 'sm', className = '' }: ScriptsBadgeProps) {
  const hasScript = hasScripts || (userScripts?.length ? !!userScripts[0]?.code?.trim() : false);
  if (!hasScript) return null;

  const sizeClasses = size === 'md'
    ? 'px-1.5 py-0.5'
    : 'px-1 py-0';

  const iconSize = size === 'md' ? 'h-3 w-3' : 'h-2.5 w-2.5';

  return (
    <span
      className={`inline-flex items-center rounded bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800 flex-shrink-0 ${sizeClasses} ${className}`}
      title={userScripts?.[0]?.name || 'Has script'}
    >
      <Code2 className={iconSize} />
    </span>
  );
}
