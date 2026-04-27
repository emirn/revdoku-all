/**
 * Utilities for extracting structured change tags and values from check descriptions.
 * Used as a fallback when the AI model doesn't return structured type/val_p/val fields.
 * Format spec: see prompts/catch-changes-README.md
 */

// --- Pattern definitions for each change type ---

const PATTERN_REMOVED = /\bremoved\b|\bdeleted\b|\bno longer\b/i;
const PATTERN_ADDED = /\badded\b|\bnew\b.*(?:text|section|line|paragraph|reference)/i;
const PATTERN_NUMBER = /\$[\d,.]+|\b\d+\.\d{2}\b|amount|price|rate|cost|fee|total|subtotal|sum/i;
const PATTERN_DATE = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\bdate\b/i;
const PATTERN_DATE_FIELD = /\bdue\s*date\b|\bissue\s*date\b|\bterm\b|\bnet\s*\d+\b/i;
const PATTERN_ID = /\binvoice\s*(?:number|#|no)|policy\s*#|mrn\b|npi\b|cpt\b|gl-\d/i;
const PATTERN_NAME = /\bname\b.*changed|\bpersonnel\b.*changed|changed\s*from\s*['"][A-Z][a-z]+\s+[A-Z]/;
const PATTERN_NOTES = /\bnotes?\b.*(?:updated|changed|text)/i;
const PATTERN_STATUS = /\bstatus\b.*changed|draft.*final|pending.*approved/i;
const PATTERN_REF = /\breference\b|\bsection\b|\breplaces:/i;
const PATTERN_CHANGED_FROM = /changed\s*from/i;
const PATTERN_URL = /\bhttps?:\/\/|\bwww\./i;
const PATTERN_CONTACT = /\bphone\b|\bemail\b|\baddress\b|\b\(\d{3}\)\s*\d{3}/i;
const PATTERN_COLOR = /#[0-9a-f]{6}\b|\bcolor\b.*changed/i;
const PATTERN_SIZE = /\b\d+\s*(?:pt|px|em|rem|cm|mm|in)\b|\bfont\s*size\b|\bdimension/i;
const PATTERN_FORMAT = /\bbold\b|\bitalic\b|\balignment\b|\bunderline\b|\bformatting\b/i;
const PATTERN_IMAGE = /\bimage\b|\blogo\b|\bphoto\b|\bgraphic\b|\bvisual\b/i;
const PATTERN_CURRENCY = /\bcurrency\b|\b(?:usd|eur|gbp|jpy|cad|aud)\b|\b\$.*→.*€/i;
const PATTERN_DURATION = /\b\d+\s*(?:days?|months?|years?|weeks?)\b.*(?:to|→|changed)/i;
const PATTERN_LEGAL = /\bclause\b|\bindemnit|\bliabilit|\bwarrant|\btermination\b/i;
const PATTERN_REDACT = /\bredact|\bmasked\b|\bxxx/i;
const PATTERN_TYPO = /\btypo\b|\bspelling\b|\bcorrect(?:ed|ion)\b/i;

// Ordered list of patterns to check — earlier entries take priority
const CHANGE_TYPE_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'ch_removed', pattern: PATTERN_REMOVED },
  { type: 'ch_added', pattern: PATTERN_ADDED },
  { type: 'ch_number', pattern: PATTERN_NUMBER },
  { type: 'ch_date', pattern: PATTERN_DATE },
  { type: 'ch_date', pattern: PATTERN_DATE_FIELD },
  { type: 'ch_id', pattern: PATTERN_ID },
  { type: 'ch_name', pattern: PATTERN_NAME },
  { type: 'ch_url', pattern: PATTERN_URL },
  { type: 'ch_contact', pattern: PATTERN_CONTACT },
  { type: 'ch_color', pattern: PATTERN_COLOR },
  { type: 'ch_size', pattern: PATTERN_SIZE },
  { type: 'ch_format', pattern: PATTERN_FORMAT },
  { type: 'ch_image', pattern: PATTERN_IMAGE },
  { type: 'ch_currency', pattern: PATTERN_CURRENCY },
  { type: 'ch_duration', pattern: PATTERN_DURATION },
  { type: 'ch_legal', pattern: PATTERN_LEGAL },
  { type: 'ch_redact', pattern: PATTERN_REDACT },
  { type: 'ch_typo', pattern: PATTERN_TYPO },
  { type: 'ch_status', pattern: PATTERN_STATUS },
  { type: 'ch_ref', pattern: PATTERN_REF },
  { type: 'ch_text', pattern: PATTERN_NOTES },
];

// --- Public functions ---

/**
 * Extract change type tags from a check description.
 * Returns comma-separated type string (e.g. "ch_number,ch_date").
 * Falls back to "ch_text" if no specific pattern matches.
 */
export function extractChangesTagsFromCheckDescription(description: string): string {
  const matched = new Set<string>();

  for (const { type, pattern } of CHANGE_TYPE_PATTERNS) {
    if (!matched.has(type) && pattern.test(description)) {
      matched.add(type);
    }
  }

  // Fallback: generic text change if description mentions "changed from" or nothing matched
  if (matched.size === 0 && PATTERN_CHANGED_FROM.test(description)) matched.add('ch_text');
  if (matched.size === 0) matched.add('ch_text');

  return Array.from(matched).join(',');
}

/**
 * Extract previous/current values from common description patterns.
 * Tries patterns in order: quoted, unquoted "changed from...to", parenthetical.
 */
export function extractPrevCurrentFromDescription(description: string): { val_p: string; val: string } | null {
  // 1. Standard format: changed "X" to "Y"
  // See prompts/catch-changes-README.md for format spec
  const changed = description.match(/changed\s+"([^"]+)"\s+to\s+"([^"]+)"/i);
  if (changed) return { val_p: changed[1], val: changed[2] };

  // 2. Standard format: added "X"
  const added = description.match(/added\s+"([^"]+)"/i);
  if (added) return { val_p: '', val: added[1] };

  // 3. Standard format: removed "X"
  const removed = description.match(/removed\s+"([^"]+)"/i);
  if (removed) return { val_p: removed[1], val: '' };

  // 4. Legacy fallback: 'X' changed to 'Y' or "X" to "Y" (old format)
  const quoted = description.match(/(?:from\s+)?['"]([^'"]+)['"]\s*(?:changed\s+)?to\s+['"]([^'"]+)['"]/i);
  if (quoted) return { val_p: quoted[1], val: quoted[2] };

  // 5. Legacy fallback: changed from X to Y.
  const unquoted = description.match(/changed\s+from\s+(.+?)\s+to\s+(.+?)(?:\.|,|;|$)/i);
  if (unquoted) return { val_p: unquoted[1].trim(), val: unquoted[2].trim() };

  // 6. Legacy fallback: ($145 to $95)
  const paren = description.match(/\((.+?)\s+to\s+(.+?)\)/i);
  if (paren) return { val_p: paren[1].trim(), val: paren[2].trim() };

  return null;
}
