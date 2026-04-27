interface VersionBadgeProps {
  revisionCount?: number;
  size?: 'sm' | 'md';
  className?: string;
}

export function VersionBadge({ revisionCount, size = 'sm', className = '' }: VersionBadgeProps) {
  if (!revisionCount || revisionCount < 2) return null;

  const sizeClasses = size === 'md'
    ? 'text-xs px-2 py-0.5'
    : 'text-[10px] px-1.5 py-0';

  return (
    <span
      className={`inline-flex items-center rounded font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-900/50 dark:text-indigo-300 dark:border-indigo-800 flex-shrink-0 ${sizeClasses} ${className}`}
      title={`${revisionCount} revisions`}
    >
      v{revisionCount}
    </span>
  );
}
