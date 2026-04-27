/**
 * Blocklist-based filter that detects common prompt injection patterns
 * in user-supplied content. Logs suspicious attempts for security monitoring
 * but does NOT block execution — sanitized input continues through the pipeline.
 */

const SUSPICIOUS_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|rules|prompts)/i,
  /disregard\s+(all\s+)?(previous|above|prior)/i,
  /act\s+as\s+(if|though)?\s*(you\s+are|a|an)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /you\s+are\s+now\s+a/i,
  /output\s+(your|the)\s+(system\s+)?prompt/i,
  /reveal\s+(your|the)\s+(system\s+)?prompt/i,
  /repeat\s+(your|the)\s+(system\s+)?(prompt|instructions)/i,
  /what\s+(are|is)\s+your\s+(system\s+)?(prompt|instructions)/i,
  /forget\s+(all|everything|your)\s+(previous|prior)/i,
  /new\s+instructions?\s*:/i,
  /\[INST\]/i,       // Llama-style injection
  /<<SYS>>/i,        // Llama-style system injection
];

export interface InjectionCheckResult {
  suspicious: boolean;
  matches: string[];
}

/**
 * Checks text for known prompt injection patterns.
 * Returns { suspicious: true, matches: [...] } if patterns are found.
 */
export function checkForInjection(text: string): InjectionCheckResult {
  if (!text) return { suspicious: false, matches: [] };

  const matches = SUSPICIOUS_PATTERNS
    .filter(p => p.test(text))
    .map(p => p.source);

  return { suspicious: matches.length > 0, matches };
}

/**
 * Scans multiple text fields for injection patterns and logs warnings.
 * Returns true if any field is suspicious.
 */
export function scanAndLogInjectionAttempts(
  fields: Record<string, string | undefined>,
  context: string,
): boolean {
  let anySuspicious = false;

  for (const [fieldName, text] of Object.entries(fields)) {
    if (!text) continue;
    const result = checkForInjection(text);
    if (result.suspicious) {
      anySuspicious = true;
      console.warn(
        `[PROMPT_GUARD] Suspicious content detected in ${context}.${fieldName}: ` +
        `matched ${result.matches.length} pattern(s): ${result.matches.join(', ')}`
      );
    }
  }

  return anySuspicious;
}
