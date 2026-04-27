
/** Stringify with automatic truncation of long string values */
export function safeStringify(obj: unknown, maxLen = 200): string {
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'string' && value.length > maxLen) {
      return `<truncated ${value.length} chars>`;
    }
    return value;
  }, 2);
}

/** Debug log with auto-truncation of large values */
export function dlog(label: string, ...args: unknown[]): void {
  const safe = args.map(a =>
    typeof a === 'string' && a.length > 500
      ? a.slice(0, 500) + `... <truncated, total ${a.length} chars>`
      : a
  );
  console.debug(label, ...safe);
}

/** Log a timed step with optional details */
export function logStep(label: string, startMs: number, details?: Record<string, unknown>): void {
  const elapsed = Date.now() - startMs;
  console.log(`[${new Date().toISOString()}] ${label} (${elapsed}ms)`, details ? JSON.stringify(details) : '');
}

