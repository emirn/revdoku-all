/**
 * Detect and fix contradictions between AI check descriptions and passed status.
 * When the AI says "passed: true" but the description clearly indicates a failure,
 * this module corrects the status to prevent false positives.
 */

/** Failure indicator patterns — description matches these AND passed=true → contradiction */
const FAILURE_PATTERNS: RegExp[] = [
  /\bincorrect\b/i,
  /\bwrong\b/i,
  /\berror\b/i,
  /\bmismatch/i,
  /\bdiscrepan/i,
  /\bdoes not match/i,
  /\bdoes not add up/i,
  /\bshould be .{1,40} but/i,
  /\bviolat/i,
  /\bmissing\b/i,
  /\bnot found\b/i,
  /\bnot present\b/i,
  /\bnot included\b/i,
  /\bnot provided\b/i,
  /\bfails\b/i,
  /\binconsisten/i,
];

/** Negation patterns — skip correction if description matches these */
const NEGATION_PATTERNS: RegExp[] = [
  /\bno\s+(errors?|issues?|problems?|discrepan|mismatch)/i,
  /\bnot\s+incorrect\b/i,
  /\bwithout\s+(any\s+)?(errors?|issues?)/i,
  /\bcorrectly\b/i,
  /\ball\s+correct\b/i,
  /\bno\s+missing\b/i,
  /\bnone\s+(are\s+)?missing\b/i,
  /\bnothing\s+(is\s+)?missing\b/i,
  /\bno\s+violations?\b/i,
  /\bno\s+inconsisten/i,
];

/**
 * Check if a description contains failure indicators that aren't negated.
 */
export function hasFailureIndicators(description: string): boolean {
  // First check if any negation pattern matches — if so, it's likely not a real failure
  const hasNegation = NEGATION_PATTERNS.some(p => p.test(description));
  if (hasNegation) return false;

  // Check if any failure pattern matches
  return FAILURE_PATTERNS.some(p => p.test(description));
}

interface AICheckResult {
  passed: boolean;
  description: string;
  [key: string]: any;
}

interface AIRuleResult {
  ruleId: string;
  checks: AICheckResult[];
  [key: string]: any;
}

/**
 * Scan AI results for contradictions where passed=true but description
 * indicates failure. Mutates checks in-place by setting passed=false.
 * Returns the number of corrections made.
 */
export function detectAndFixContradictions(results: AIRuleResult[]): number {
  let corrected = 0;

  for (const rule of results) {
    for (const check of rule.checks) {
      if (check.passed === true && check.description) {
        if (hasFailureIndicators(check.description)) {
          console.warn(
            `contradiction-patterns: Correcting passed→false for rule "${rule.ruleId}": "${check.description.substring(0, 100)}"`
          );
          check.passed = false;
          corrected++;
        }
      }
    }
  }

  if (corrected > 0) {
    console.warn(`contradiction-patterns: Corrected ${corrected} contradiction(s) in AI response`);
  }

  return corrected;
}
