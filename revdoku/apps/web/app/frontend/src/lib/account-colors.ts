/** Selectable account colors. First entry after 'none' should be common, recognizable hues. */
export const ACCOUNT_COLORS = [
  '#1e293b', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b',
  '#f43f5e', '#06b6d4', '#f97316', '#6366f1',
];

export function getAccountColor(prefixId: string, override?: string | null): string | null {
  if (override) return override;
  return null;
}
