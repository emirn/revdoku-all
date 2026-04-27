import { joinScriptCodeAndTemplate } from '@revdoku/lib';

/**
 * Parse multi-line text into individual rule prompts.
 * Splits by newline, trims whitespace, strips common list markers
 * (e.g. "- ", "* ", "1. ", "2) "), and filters empty lines.
 */
export function parseTextToRulePrompts(text: string): string[] {
  const LIST_MARKER = /^(?:\d+[.)]\s*|[-*]\s*)/;

  return text
    .split('\n')
    .map(line => line.trim())
    .map(line => line.replace(LIST_MARKER, '').trim())
    .filter(line => line.length > 0);
}

const LIST_MARKER_RE = /^(?:\[[ x]?\]\s*[-–]?\s*|\d+[.)]\s*|[-*]\s+)/i;

// Trim leading/trailing whitespace FIRST so the anchored regex actually
// matches when the source paste has indentation (e.g. " - rule 1" or
// "   * rule"). Previous order (replace → trim) left the bullet intact
// because the ^ anchor was preceded by whitespace.
function stripListMarker(line: string): string {
  return line.trim().replace(LIST_MARKER_RE, '').trim();
}

function splitIntoGroups(lines: string[]): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

function allListItems(lines: string[]): boolean {
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return false;
  return nonEmpty.every(l => LIST_MARKER_RE.test(l.trim()));
}

/**
 * Returns true if the text matches our structured checklist format:
 * title line, blank separator, optional system prompt, blank separator, at least one rule line.
 */
export function isChecklistFormat(text: string): boolean {
  const textWithoutCode = removeScriptSections(text);
  const lines = textWithoutCode.split('\n').map(l => l.trimEnd());
  const groups = splitIntoGroups(lines);

  // Need at least 2 groups (name + rules, or name + prompt + rules)
  if (groups.length < 2) return false;

  // The last group (or second group if only 2) should contain rule lines
  const lastGroup = groups[groups.length - 1];
  if (!allListItems(lastGroup)) return false;

  // First group should be short (the name) — 1-3 lines max
  if (groups[0].length > 3) return false;

  return true;
}

export interface ParsedChecklist {
  name: string;
  system_prompt: string | null;
  rules: Array<{ prompt: string; order: number }>;
  user_scripts?: Array<{ id: string; name?: string; code: string }>;
}

/** Extract a tag section from text. Returns extracted content or null. */
function extractTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const match = text.match(re);
  return match ? match[1].trim() || null : null;
}

/** Remove all known script sections from text, returning clean rules text. */
function removeScriptSections(text: string): string {
  return text
    .replace(/<script>[\s\S]*?<\/script>/gi, '')
    .trim();
}

/**
 * Parse structured checklist text into name, system_prompt, and rules.
 * Script extraction: looks for a single `<script>` tag whose content is the
 * merged code (with optional `script_template` variable at the top).
 */
export function parseChecklistText(text: string): ParsedChecklist {
  // Extract script — single <script> tag with merged code+template
  const scriptContent = extractTag(text, 'script');
  const user_scripts = scriptContent
    ? [{ id: 'script_0', name: 'Script 1', code: scriptContent }]
    : undefined;

  const textWithoutCode = removeScriptSections(text);
  const lines = textWithoutCode.split('\n').map(l => l.trimEnd());
  const groups = splitIntoGroups(lines);

  if (groups.length < 2) {
    // Fallback: treat all lines as rules
    const rules = lines
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map((l, i) => ({ prompt: stripListMarker(l), order: i }))
      .filter(r => r.prompt.length > 0);
    return { name: 'Untitled', system_prompt: null, rules, user_scripts };
  }

  const name = groups[0].join(' ').trim() || 'Untitled';

  if (groups.length === 2) {
    if (allListItems(groups[1])) {
      // name + rules (no system prompt)
      const rules = groups[1]
        .filter(l => l.trim().length > 0)
        .map((l, i) => ({ prompt: stripListMarker(l), order: i }))
        .filter(r => r.prompt.length > 0);
      return { name, system_prompt: null, rules, user_scripts };
    }
    // name + system_prompt (no rules)
    return { name, system_prompt: groups[1].join('\n').trim(), rules: [], user_scripts };
  }

  // 3+ groups: name, system_prompt, rules from remaining groups
  const system_prompt = groups[1].join('\n').trim();
  const ruleLines = groups.slice(2).flat();
  const rules = ruleLines
    .filter(l => l.trim().length > 0)
    .map((l, i) => ({ prompt: stripListMarker(l), order: i }))
    .filter(r => r.prompt.length > 0);

  return { name, system_prompt, rules, user_scripts };
}
