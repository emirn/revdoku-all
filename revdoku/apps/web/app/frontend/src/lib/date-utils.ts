/**
 * Reusable date formatting utilities.
 */

/**
 * Format a date as a human-readable string like "March 2, 2025".
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format a date as a short relative time string like "3d ago", "2h ago", "just now".
 * For dates older than 30 days, falls back to formatted date.
 */
export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatDate(dateStr);
}

/**
 * Format created/updated timestamps for display.
 * Returns "Created March 2, 2025 · Updated 3d ago" or similar.
 */
export function formatCreatedUpdated(
  createdAt: string | null | undefined,
  updatedAt: string | null | undefined,
): string {
  const parts: string[] = [];
  if (createdAt) parts.push(`Created ${formatDate(createdAt)}`);
  if (updatedAt) parts.push(`Updated ${timeAgo(updatedAt)}`);
  return parts.join(' · ');
}
