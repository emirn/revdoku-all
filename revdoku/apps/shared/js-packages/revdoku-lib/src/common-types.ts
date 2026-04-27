import { v4 as uuidv4 } from 'uuid';

const CHECK_DESCRIPTION_TO_PROMPT = 'MUST HAVE: opposite of "{{DESCRIPTION}}"';

export const REVDOKU_SMALLEST_BASE64_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=";

// Modern, accessible highlight colors used across the application
export const REVDOKU_BASE_COLOR_FAILED_MANUAL: string = 'rgba(245, 158, 11, ${ALPHA})'; // amber - more professional than yellow
export const REVDOKU_BASE_COLOR_FAILED_AI: string = 'rgba(239, 68, 68, ${ALPHA})'; // modern red with good contrast
export const REVDOKU_BASE_COLOR_PASSED: string = 'rgba(34, 197, 94, ${ALPHA})'; // vibrant green with excellent readability
export const REVDOKU_BASE_COLOR_WARNING: string = 'rgba(251, 146, 60, ${ALPHA})'; // orange for warnings
export const REVDOKU_BASE_COLOR_INFO: string = 'rgba(59, 130, 246, ${ALPHA})'; // blue for informational highlights
export const REVDOKU_BASE_COLOR_TEXT: string = 'rgba(255, 255, 255, ${ALPHA})'; // crisp white
export const REVDOKU_BASE_COLOR_TEXT_DARK: string = 'rgba(17, 24, 39, ${ALPHA})'; // dark text for light backgrounds
export const REVDOKU_BASE_COLOR_BORDER: string = 'rgba(55, 65, 81, ${ALPHA})'; // sophisticated dark border
export const REVDOKU_HIGHLIGHT_OPACITY: number = 0.18; // Semi-transparent fill like Bluebeam/Acrobat
export const REVDOKU_HIGHLIGHT_SELECTED_OPACITY: number = 0.45; // More prominent when selected
export const REVDOKU_HIGHLIGHT_SELECTED_FILL_OPACITY: number = 0.08; // Subtle fill for selection
export const REVDOKU_HIGHLIGHT_ROUNDING_PERCENT: number = 0.15; // Slightly refined rounding
export const REVDOKU_HIGHLIGHT_DASH_PATTERN: number[] = [6, 4]; // Canvas dash pattern for revdoku-doc-api exports
export const REVDOKU_HIGHLIGHT_FILL_ENABLED: boolean = false; // When false, highlights show border only (no background fill)

// Enhanced color variations for different UI states
export const REVDOKU_COLOR_VARIATIONS = {
  HOVER_OPACITY: 0.35,
  FOCUS_OPACITY: 0.5,
  ACTIVE_OPACITY: 0.6,
  DISABLED_OPACITY: 0.1
} as const;

// Manual label colors for HTML reports - coordinated with highlight colors
export const REVDOKU_MANUAL_LABEL_BG: string = '#fef3c7'; // soft amber background
export const REVDOKU_MANUAL_LABEL_TEXT: string = '#d97706'; // rich amber text

// Additional semantic colors for better UX
export const REVDOKU_SEMANTIC_COLORS = {
  SUCCESS: '#10b981', // emerald-500
  ERROR: '#ef4444',   // red-500
  WARNING: '#f59e0b', // amber-500:
  INFO: '#3b82f6',    // blue-500:
  NEUTRAL: '#6b7280'  // gray-500
} as const;

// Solid (fully opaque) colors for hint/annotation label text — readable on white backgrounds
export const REVDOKU_HINT_TEXT_COLOR_FAILED_MANUAL = '#b91c1c'; // red-700
export const REVDOKU_HINT_TEXT_COLOR_FAILED_AI = '#dc2626';     // red-600
export const REVDOKU_HINT_TEXT_COLOR_PASSED = '#15803d';        // green-700
export const REVDOKU_BASE_COLOR_CHANGES: string = 'rgba(217, 119, 6, ${ALPHA})'; // amber-600 for catch-changes/change checks
export const REVDOKU_HINT_TEXT_COLOR_CHANGES = '#b45309'; // amber-700 for change check annotation labels

export const REVDOKU_HIGHLIGHT_BADGE_WIDTH: number = 15;
export const REVDOKU_HIGHLIGHT_BADGE_HEIGHT: number = 15;
export const REVDOKU_HIGHLIGHT_BADGE_MARGIN: number = 2; // Extra margin to ensure badges don't overlap

// Change type badge colors (for "number", "date", "removed" etc. pills in labels)
// Changes (amber) — used when check is a cross-revision change (catch-changes rule)
export const REVDOKU_TYPE_BADGE_CHANGES_BORDER = 'rgba(217,119,6,0.55)';
export const REVDOKU_TYPE_BADGE_CHANGES_BG = 'rgba(217,119,6,0.18)';
export const REVDOKU_TYPE_BADGE_CHANGES_TEXT = '#b45309'; // amber-700
// Recheck (indigo) — used when check is a re-verification of a previously failed check
export const REVDOKU_TYPE_BADGE_RECHECK_BORDER = 'rgba(99,102,241,0.55)';
export const REVDOKU_TYPE_BADGE_RECHECK_BG = 'rgba(99,102,241,0.18)';
export const REVDOKU_TYPE_BADGE_RECHECK_TEXT = '#6366f1'; // indigo-500
// Icon colors for change/recheck icons
export const REVDOKU_ICON_COLOR_CHANGES = '#f59e0b'; // amber-500
export const REVDOKU_ICON_COLOR_RECHECK = '#6366f1'; // indigo-500

// SVG path data for check icons (font-independent, works on all platforms)
// Recheck icon — RotateCcw style (single counterclockwise circular arrow)
export const REVDOKU_RECHECK_ICON_SVG_PATHS = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';
// Changes icon — bidirectional arrows (left-right)
export const REVDOKU_CHANGES_ICON_SVG_PATHS = '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>';

/** Build a complete inline SVG string for use in HTML templates */
export function buildCheckIconSvg(type: 'recheck' | 'changes', size = 12): string {
  const paths = type === 'recheck' ? REVDOKU_RECHECK_ICON_SVG_PATHS : REVDOKU_CHANGES_ICON_SVG_PATHS;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px;">${paths}</svg>`;
}
// Type badge sizing and spacing
export const REVDOKU_TYPE_BADGE_FONT_SCALE = 0.75;       // relative to label font size
export const REVDOKU_TYPE_BADGE_FONT_WEIGHT = 600;        // semibold
export const REVDOKU_TYPE_BADGE_HEIGHT_SCALE = 1.4;       // badge height = fontSize * this
export const REVDOKU_TYPE_BADGE_PADDING_H = 3;            // horizontal padding inside badge (px)
export const REVDOKU_TYPE_BADGE_GAP = 3;                  // gap between adjacent type badges (px)
export const REVDOKU_TYPE_BADGE_BORDER_RADIUS = 3;        // border radius for type badge (px)
// Icon sizing
export const REVDOKU_CHECK_ICON_SIZE_SCALE = 1.1;         // icon size = fontSize * this
export const REVDOKU_CHECK_ICON_GAP = 3;                  // gap after icon before next element (px)
// Number badge gap
export const REVDOKU_LABEL_BADGE_GAP = 4;                 // gap between number badge and next element (px)

// Badge and message background colors for consistent styling across Canvas and CSS rendering
export const REVDOKU_BADGE_BACKGROUND_COLOR: string = '#ffffff'; // White badge background
export const REVDOKU_BADGE_TEXT_COLOR: string = '#000000'; // Black text on badges
export const REVDOKU_MESSAGE_BACKGROUND_COLOR_TEMPLATE: string = 'rgba(255, 255, 255, ${ALPHA})'; // Semi-transparent white for message overlays


export interface IBase {
  id: string;
  created_at?: string;
  updated_at?: string;
}

export interface IUserScript {
  id: string;           // auto-assigned: template slug or "script_0"
  name?: string;        // auto-assigned: template title or "Script 1"
  code: string;         // full script: JS code with optional `script_template` variable at top
  created_at?: string;
}

export interface IUserScriptOutput {
  id: string;           // matches the script id that produced this
  data: Record<string, unknown>;
  template: string;     // mustache template — render with data to get html
  executed_at?: string;
}

/**
 * Convention: the Mustache template is defined inside the script `code` field
 * as a `const script_template = \`...\`;` variable assignment at the top.
 *
 * The regex below is intentionally permissive — it accepts:
 * - `const script_template = \`...\``
 * - `let script_template = \`...\``
 * - `var script_template = \`...\``
 * - `script_template = \`...\`` (bare assignment)
 * - Any whitespace between tokens
 * - Optional trailing semicolon
 * - Single-quoted (`'...'`) and double-quoted (`"..."`) strings in addition to backticks
 *
 * On failure the helpers return empty strings rather than throwing, so callers
 * never crash on malformed scripts — they just get "no template found".
 */
const SCRIPT_TEMPLATE_BACKTICK_RE = /^(?:(?:const|let|var)\s+)?script_template\s*=\s*`([\s\S]*?)`\s*;?\s*$/m;
const SCRIPT_TEMPLATE_QUOTE_RE = /^(?:(?:const|let|var)\s+)?script_template\s*=\s*(['"])([\s\S]*?)\1\s*;?\s*$/m;

function matchScriptTemplate(code: string): { match: RegExpMatchArray; re: RegExp } | null {
  const m1 = code.match(SCRIPT_TEMPLATE_BACKTICK_RE);
  if (m1) return { match: m1, re: SCRIPT_TEMPLATE_BACKTICK_RE };
  const m2 = code.match(SCRIPT_TEMPLATE_QUOTE_RE);
  if (m2) return { match: m2, re: SCRIPT_TEMPLATE_QUOTE_RE };
  return null;
}

/** Extract the Mustache template from a merged script (the `script_template` variable).
 *  Returns '' if no variable is found — never throws. */
export function extractScriptTemplate(code: string | null | undefined): string {
  if (!code) return '';
  try {
    const result = matchScriptTemplate(code);
    if (!result) return '';
    // For backtick regex, capture group 1 is the content.
    // For quote regex, group 1 is the quote char and group 2 is the content.
    const content = result.re === SCRIPT_TEMPLATE_BACKTICK_RE
      ? result.match[1]
      : result.match[2];
    return (content ?? '').trim();
  } catch { return ''; }
}

/** Remove the `script_template = ...` variable assignment, returning only executable JS.
 *  Returns the original code untouched if no variable is found — never throws. */
export function stripScriptTemplate(code: string | null | undefined): string {
  if (!code) return '';
  try {
    const result = matchScriptTemplate(code);
    if (!result) return code.trim();
    return code.replace(result.re, '').trim();
  } catch { return (code ?? '').trim(); }
}

/** Split a merged script into { js, template } for the editor / execution. */
export function splitScriptCodeAndTemplate(code: string | null | undefined): { js: string; template: string } {
  return { js: stripScriptTemplate(code), template: extractScriptTemplate(code) };
}

/** Join JS code and template back into the merged format with `const script_template` at top. */
export function joinScriptCodeAndTemplate(js: string, template: string): string {
  const trimmedJs = js.trim();
  const trimmedTpl = template.trim();
  if (!trimmedTpl) return trimmedJs;
  return `const script_template = \`${trimmedTpl}\`;\n\n${trimmedJs}`;
}

// Tag colors (macOS Finder-style)
export type TagColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

// Label font family options
export type LabelFontFamily = 'sans-serif' | 'serif' | 'monospace';

export const REVDOKU_LABEL_FONT_FAMILIES: readonly { key: LabelFontFamily; label: string; cssBrowser: string; cssCanvas: string }[] = [
  { key: 'sans-serif', label: 'Arial', cssBrowser: 'Arial, "Liberation Sans", Helvetica, sans-serif', cssCanvas: 'Arial' },
  { key: 'serif', label: 'Times New Roman', cssBrowser: '"Times New Roman", "Liberation Serif", Georgia, serif', cssCanvas: 'Liberation Serif' },
  { key: 'monospace', label: 'Courier New', cssBrowser: '"Courier New", "Liberation Mono", Consolas, monospace', cssCanvas: 'Liberation Mono' },
] as const;

export const REVDOKU_DEFAULT_LABEL_FONT_FAMILY: LabelFontFamily = 'sans-serif';

// Label text alignment options
export type LabelTextAlignment = 'left' | 'justify';
export const REVDOKU_DEFAULT_LABEL_TEXT_ALIGNMENT: LabelTextAlignment = 'justify';

export function getCharWidthFactor(fontFamily?: LabelFontFamily): number {
  switch (fontFamily) {
    case 'monospace': return 0.62;
    case 'serif': return 0.55;
    default: return 0.55; // sans-serif / Arial
  }
}

export function getFontFamilyCss(key: LabelFontFamily | undefined, target: 'browser' | 'canvas'): string {
  const entry = REVDOKU_LABEL_FONT_FAMILIES.find(f => f.key === key);
  if (!entry) {
    return target === 'browser' ? REVDOKU_LABEL_FONT_FAMILIES[0].cssBrowser : REVDOKU_LABEL_FONT_FAMILIES[0].cssCanvas;
  }
  return target === 'browser' ? entry.cssBrowser : entry.cssCanvas;
}

export interface ITag extends IBase {
  name: string;              // local segment only
  color: TagColor;
  position: number;
  auto_source?: string;
  parent_id?: string | null; // prefix_id of parent tag, or null for root
  full_path?: string;        // computed server-side for display ("Parent/Child")
}

// Highlight mode controls how highlights are rendered on the document viewer
export enum HighlightMode {
  RECTANGLE = 0,   // Traditional rectangle border around detected area (default, good for documents)
  DOT = 1,         // Small dot at center with connector line (good for photos, Apple-style callouts)
  UNDERLINE = 2,   // Subtle bottom-border line (good for text-heavy documents)
  BRACKET = 3,     // Corner-only L-shaped markers (minimal, professional, Figma-style)
}

// Default highlight mode used when none is set (existing envelopes, new checklists, etc.)
export const REVDOKU_DEFAULT_HIGHLIGHT_MODE: HighlightMode = HighlightMode.RECTANGLE;

// Per-page review status — indicates what happened to each page during inspection.
// Stored in pages_layout_json.page_statuses as Record<string, EPageReviewStatus>.
// Convention: >= 0 means page was handled (OK), < 0 means page needs attention.
export enum EPageReviewStatus {
  REVIEWED = 0,            // Processed by AI successfully
  SKIPPED_AS_BLANK = 1,    // Processed, detected blank — not an error
  FAILED = -1,             // Processing attempted but errored
  NOT_PROCESSED = -2,      // Never reached (job crashed, timeout)
  CANCELLED_BY_USER = -3,  // User cancelled before this page was processed
}

// Connection line mode controls where the leader line terminates on the highlight
export enum ConnectionLineMode {
  BORDER_AUTO = 0,        // Line connects to nearest edge of the highlight box (default)
  CENTER = 1,             // Line connects to center of the highlight box (e.g. the dot)
  BOTTOM_BORDER_AUTO = 2, // Line connects to nearest point on the bottom edge (e.g. the underline)
}

// Icon identifier for highlight mode (maps to Lucide icon names in the frontend)
export type HighlightModeIcon = 'square' | 'circle-dot' | 'underline' | 'scan';

// Full config for each highlight mode: visual style, connection line behavior, and UI metadata
export interface HighlightModeConfig {
  mode: HighlightMode;
  connectionMode: ConnectionLineMode;
  icon: HighlightModeIcon;
  label: string;
  description: string;
  lineWidth: number;          // stroke width for canvas / CSS border-width (default state)
  opacity: number;            // globalAlpha for canvas rendering
  hoverBorderWidth: number;   // border width shown on hover (0 = no hover border, uses mode's own border)
  hoverBorderOpacity: number; // border color opacity on hover (0-1, e.g. 0.2 = subtle)
  connectionEndpointDot: boolean; // draw a small dot where the leader line meets the highlight area
}

export const REVDOKU_HIGHLIGHT_MODES_CONFIG: readonly HighlightModeConfig[] = [
  { mode: HighlightMode.RECTANGLE, connectionMode: ConnectionLineMode.BORDER_AUTO, icon: 'square', label: 'Rectangle', description: 'Best for documents', lineWidth: 2, opacity: 0.8, hoverBorderWidth: 0, hoverBorderOpacity: 0, connectionEndpointDot: true },
  { mode: HighlightMode.DOT, connectionMode: ConnectionLineMode.CENTER, icon: 'circle-dot', label: 'Dot', description: 'Best for photos', lineWidth: 0, opacity: 1.0, hoverBorderWidth: 1, hoverBorderOpacity: 0.15, connectionEndpointDot: false },
  { mode: HighlightMode.UNDERLINE, connectionMode: ConnectionLineMode.BOTTOM_BORDER_AUTO, icon: 'underline', label: 'Underline', description: 'Best for text', lineWidth: 2, opacity: 0.6, hoverBorderWidth: 0, hoverBorderOpacity: 0, connectionEndpointDot: false },
  { mode: HighlightMode.BRACKET, connectionMode: ConnectionLineMode.BORDER_AUTO, icon: 'scan', label: 'Bracket', description: 'Minimal, professional', lineWidth: 4, opacity: 0.7, hoverBorderWidth: 1, hoverBorderOpacity: 0.2, connectionEndpointDot: false },
] as const;

// Backward-compat alias (replaced by REVDOKU_HIGHLIGHT_MODES_CONFIG)
export const REVDOKU_HIGHLIGHT_MODE_OPTIONS = REVDOKU_HIGHLIGHT_MODES_CONFIG;

/** Look up the config for a given highlight mode (falls back to RECTANGLE) */
export function getHighlightModeConfig(mode?: HighlightMode | number | null): HighlightModeConfig {
  return REVDOKU_HIGHLIGHT_MODES_CONFIG.find(c => c.mode === mode) ?? REVDOKU_HIGHLIGHT_MODES_CONFIG[0];
}

/**
 * Compute the connection line endpoint on the highlight box for a given connection mode.
 * Returns the point where the leader line should terminate, or `null` to indicate
 * the default `computeStraightConnectionLine` endpoint should be used (BORDER_AUTO).
 */
export function getConnectionLineEndpoint(
  connectionMode: ConnectionLineMode,
  highlightBox: { x: number; y: number; width: number; height: number },
  labelBox?: { x: number; y: number; width: number; height: number },
): { x: number; y: number } | null {
  switch (connectionMode) {
    case ConnectionLineMode.CENTER:
      return {
        x: highlightBox.x + highlightBox.width / 2,
        y: highlightBox.y + highlightBox.height / 2,
      };

    case ConnectionLineMode.BOTTOM_BORDER_AUTO: {
      // Connect to the nearest point on the bottom edge of the highlight (the underline).
      // Uses label center X to pick the closest point along the bottom edge.
      const bottomY = highlightBox.y + highlightBox.height;
      if (!labelBox) {
        return { x: highlightBox.x + highlightBox.width / 2, y: bottomY };
      }
      const labelCenterX = labelBox.x + labelBox.width / 2;
      const clampedX = Math.max(highlightBox.x, Math.min(highlightBox.x + highlightBox.width, labelCenterX));
      return { x: clampedX, y: bottomY };
    }

    case ConnectionLineMode.BORDER_AUTO:
    default:
      // null → caller should use the default computeStraightConnectionLine endpoint
      return null;
  }
}

// Checklist types
export type ChecklistType = 'template' | 'report_snapshot';

// Rule origin tracking
export type RuleOrigin = 'checklist' | 'user' | 'ai_generated' | 'system';

// Page text extracted by AI during inspection (used for cross-revision change tracking)
export interface IPageText {
  page: number;  // 1-based page number
  text: string;  // Constrained markdown text content of the page
}

// Per-page unified diff between previous and current revision page texts
export interface IPageDiff {
  page: number;
  diff: string;         // Unified diff text
  has_changes: boolean;
}

export interface IChecklist extends IBase {
  name?: string;
  revision_number?: number;
  system_prompt?: string;  // General instruction/persona for AI during inspection
  ai_model?: string;  // AI model identifier (e.g., "openai:gpt-4o-mini", "anthropic:claude-sonnet-4-20250514")
  rules: IRule[];
  checklist_type?: ChecklistType;  // 'template' for user-created, 'report_snapshot' for frozen copies
  source_checklist_id?: string;    // For snapshots, the original template checklist ID
  /**
   * Only present on report_snapshot-typed checklists (i.e. the frozen
   * copy inside a Report#inspection_context). Records whether the
   * catch-changes runtime flag was on when that report ran. Never set
   * on live (template) checklists — catch-changes is a per-review
   * toggle on the Review dialog, not a checklist property.
   */
  track_changes?: boolean;
  source_text?: string;            // Original agreement/policy text used to generate this checklist
  highlight_mode?: HighlightMode;  // Controls highlight rendering style: rectangle (default) or dot (better for photos)
  is_inspection_snapshot?: boolean; // True when this checklist data comes from a frozen inspection_context
  inspected_at?: string;           // ISO8601 timestamp of when the inspection was run
  user_scripts?: IUserScript[];
}

/**
 * A single reference-file page attached to a rule's multi-modal prompt.
 * Text reference content is inlined into `IRule#prompt` directly by Rails
 * at enrichment time and never travels over the wire as a ReferencePage —
 * only image pages come through here, to be injected at the matching
 * `[REFERENCE mime=image/...]<IMAGE_PAGE_N>[END OF REFERENCE]` placeholder
 * positions inside the rule prompt.
 */
export type ReferencePage = {
  type: "image";
  base64: string;
  mime_type: string;
};

export interface IRule extends IBase {
  prompt: string;
  order: number;
  origin?: RuleOrigin;  // Origin of the rule: 'checklist', 'user', or 'ai_generated'
  source_rule_id?: string;  // For snapshot rules, the original rule ID
  created_by_id?: number;  // User ID who created the rule (for user-added rules)
  source_envelope_revision_id?: string;  // ID of envelope revision where this rule was created (for user-added rules)
  checks?: ICheck[] | null
  /**
   * Image reference pages to inject at `[REFERENCE mime=image/...]<IMAGE_PAGE_N>...`
   * placeholder positions inside `prompt`. Populated by Rails from the
   * pinned DocumentFileRevisions for rules carrying `#file` / `file:<id>`
   * markers. Text reference files are already inlined into `prompt`.
   */
  reference_pages?: ReferencePage[];
}

/**
 * Deterministic value-extraction marker for rule prompts.
 *
 * A rule whose `prompt` contains `#value` (case-insensitive, word-bounded)
 * opts into value extraction: revdoku-doc-api injects a strong "SAVE VALUE REQUIRED"
 * directive into the AI prompt for that rule, and the frontend / exported
 * labels show `check.data.val` inline next to the check description.
 *
 * Rules without the marker produce no `val` and the `val=` label chip is
 * hidden even if `data.val` happens to be set (e.g. on legacy records).
 *
 * Free-form format: the rule author describes the desired format in prose
 * near the marker (e.g. `#value — save as 'category,amount' …`). The
 * marker itself is a binary flag; there is no format grammar.
 */
export const REVDOKU_VALUE_MARKER_RE = /#value\b/i;
const VALUE_MARKER_RE_GLOBAL = /#value\b/gi;

/** True when the rule prompt contains a `#value` marker. */
export function hasValueMarker(prompt: string | null | undefined): boolean {
  return typeof prompt === 'string' && REVDOKU_VALUE_MARKER_RE.test(prompt);
}

/** Remove all `#value` markers from a rule prompt and collapse extra whitespace. */
export function stripValueMarker(prompt: string | null | undefined): string {
  if (typeof prompt !== 'string') return '';
  return prompt.replace(VALUE_MARKER_RE_GLOBAL, '').replace(/\s{2,}/g, ' ').trim();
}

export enum ERuleSource {
  CHECKLIST = 'checklist',
  ENVELOPE = 'envelope'
}

export enum ReportJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  RESET = 'reset',
}

export enum CheckSource {
  AI = 'ai',
  USER = 'user'
}

// Report export layout modes
export type ReportLayoutMode = 'compact' | 'detailed' | 'full';

// Message box rendering mode for export annotations
export type MessageBoxMode = 'full' | 'numbers_message_box_only' | 'none';

export enum EnvelopeStatus {
  NEW = 'new',
  WORKING = 'working',
  COMPLETED = 'completed'
}

export interface ITypedRule extends IRule {
  type: ERuleSource
}

export interface ICoordinates {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ICheckForReindex extends ICoordinates {
  id: string;
  passed: boolean;
  page: number;
}

/** Which side of the page a label is placed on */
export enum PlacementSide {
  RIGHT = 'right',
  LEFT = 'left',
  TOP = 'top',
  BOTTOM = 'bottom',
  INSIDE = 'inside',
}

/** Pre-computed position for a check's description label (computed by revdoku-doc-api, persisted in DB).
 * Only `box` is stored; side, arrow path and hint position are derived at render time. */
export interface ICheckDescriptionPosition {
  box: { x: number; y: number; width: number; height: number };
}

/** Structured metadata for a check. `type` is comma-separated values, e.g. "ch_number" or "ch_date,recheck".
 * Change types (ch_* prefix): ch_text, ch_number, ch_date, ch_name, ch_contact, ch_url, ch_id,
 * ch_currency, ch_duration, ch_legal, ch_status, ch_ref, ch_redact, ch_typo, ch_format, ch_size,
 * ch_color, ch_image, ch_added, ch_removed.
 * Non-change types: recheck. */
export interface ICheckData {
  type: string;      // comma-separated, e.g. "ch_number" or "ch_date,recheck"
  val_p?: string;    // value before change (for ch_* types)
  val?: string;      // current/extracted value — change detection (current value) or value extraction (count, amount, measurement)
  ref?: string;      // corresponding value from a reference file (shown as "ref:" in UI labels)
  ref_page?: number; // 0-indexed page number within the referenced file where `ref` was found (UI displays as ref_page + 1)
}

export interface ICheck extends IBase, ICoordinates {
  rule_id: string; // obligatory field to link check to its rule
  passed: boolean;
  description: string;
  page: number;
  source?: CheckSource; // Optional for backward compatibility
  rule_prompt?: string; // optional: derived from checklist rules via rule_id lookup
  rule_order?: number; // deprecated: use check_index instead
  check_index?: number; // 1-based sequential index, reading order (page → y1 → x1)
  description_position?: ICheckDescriptionPosition; // Pre-computed label position from revdoku-doc-api
  created_by_name?: string; // Name of user who created/modified the check (for manual checks)
  data?: ICheckData; // Structured metadata (change type, previous/current values, recheck flag)
}

export interface ICheckFlatten {
  description: string;
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  passed: boolean;
}

export interface ICheckForDisplay extends ICheck {
  colors: IHighlightColors;
}

export interface IHighlightColors {
  highlight_color: string; // color of the highlight rectangle
  highlight_style: string; // style string for the highlight rectangle
  selected_highlight_color: string; // color of the selected highlight rectangle
  selected_highlight_style: string; // style string for the unselected highlight rectangle  
  base_color: string; // color of the base rectangle
  border_color: string; // color of the border rectangle
  text_color: string; // color of the text in the badge
  hint_text_color: string; // solid color for hint/annotation label text
  border_style?: string; // style of the border (solid for manual, dashed for AI)
  border_width?: string; // width of the border (2px for manual, 1px for AI)
}

export interface IReport extends IBase {
  envelope_revision_id: string;
  checklist_id: string;
  checklist_revision_number: number;
  ai_model?: string;  // AI model used for this report (e.g., "openai:gpt-4o-mini")
  checks: ICheck[];
  job_status: ReportJobStatus;
  job_id?: string;
  error_message?: string;
  checklist?: IChecklist;
  source_checklist_id?: string; // prefix_id of the source (template) checklist
  debug_info?: string; // JSON string with debug data (dev mode only, not persisted)
  label_font_scale?: number; // User-controlled font scale for labels (default 1.0, global fallback)
  page_font_scales?: Record<string, number>; // Per-page font scale overrides (page index string → scale)
  font_family?: LabelFontFamily; // Font family for labels (default 'sans-serif')
  highlight_mode?: HighlightMode; // Highlight rendering style: rectangle (default) or dot (better for photos)
  page_texts?: IPageText[]; // AI-extracted page text content (for cross-revision change tracking)
  has_page_texts?: boolean; // Whether page_texts exist (lazy-loaded via separate endpoint)
  page_statuses?: Record<string, EPageReviewStatus>; // Per-page review status (0=reviewed, negative=unreviewed)
  page_count?: number; // Total pages in the envelope revision (copied from envelope_revision for convenience)
  meta?: Record<string, unknown>; // Extensible metadata
  user_scripts_output?: IUserScriptOutput[];
}

export interface IPageInfo {
  width: number;
  height: number;
  original_width: number;
  original_height: number;
  scaling_factor: number;
}

export interface IDocumentFileRevision extends IBase {
  revision_number: number; // revision, starts at zero
  name: string;
  mime_type: string;
  data: string;
  size?: number;
  metadata?: string;
  /**
   * Page dimension information (width, height, scaling factors).
   *
   * NOTE: This field is calculated by consumers (frontend via pdf-lib, revdoku-doc-api via pdf.js)
   * from the raw file data, not provided by the Rails API. The API may send an empty array
   * or omit this field entirely. Each consumer extracts dimensions as needed for their use case:
   * - Frontend: For responsive rendering and coordinate transformations
   * - revdoku-doc-api: For AI context and coordinate normalization
   */
  pages?: IPageInfo[];
}

export interface IDocumentFile extends IBase {
  document_file_revisions: IDocumentFileRevision[];
  // true when the DocumentFile is a reference/ref file (pinned as context
  // for a checklist via the Review dialog's `#ref[...]` slots), false or
  // undefined when it's a primary document being inspected. Rails sets this
  // on upload — see apps/web/app/controllers/api/v1/files_controller.rb.
  reference?: boolean;
}

export interface IDocumentFileRevisionLink extends IBase {
  document_file_id: string;
  revision_number: number;
}

export interface IEnvelopeRevision extends IBase {
  revision_number: number;
  document_file_revision_links: IDocumentFileRevisionLink[] | null;
  report: IReport | null;
  comment?: string;
  revision_rules?: IRule[];
}

// Extended envelope revision for export with additional metadata
export interface IEnvelopeRevisionExport extends IBase {
  revision_number: number;
  comment?: string;
  total_revisions?: number;
}

// Previous revision data for export comparison
export interface IPreviousRevisionExport {
  revision_number: number;
  created_at: string;
  comment?: string;
  report_summary?: {
    total_checks: number;
    passed: number;
    failed: number;
    report_id: string;
    created_at: string;
    failed_checks?: Array<{
      rule_key: string;
      description: string;
      page: number;
      rule_prompt: string;
    }>;
  };
}

// Extended checklist for export with rule counts
export interface IChecklistExport extends IChecklist {
  total_rules?: number;
  checklist_rules_count?: number;
  user_rules_count?: number;
  created_at?: string;
  updated_at?: string;
  revision_number?: number;
}

// Extended document file revision for export with file metadata
export interface IDocumentFileRevisionExport extends IDocumentFileRevision {
  document_file_id?: string;
}

export interface IEnvelopePermissions {
  envelope_view?: boolean;
  envelope_revision_create?: boolean;
  envelope_revision_manage?: boolean;
  report_create?: boolean;
  report_view?: boolean;
  report_check_create?: boolean;
  envelope_meta_edit?: boolean;
  report_export?: boolean;
  envelope_delete?: boolean;
  envelope_archive?: boolean;
}

export type EnvelopeSource = 'web' | 'api' | 'email';

export interface IEnvelope extends IBase {
  title: string;
  document_files: IDocumentFile[];
  current_revision_index: number;
  status: EnvelopeStatus;
  envelope_revisions: IEnvelopeRevision[];
  /** optional compliance percent cached for UI */
  last_compliance_percent?: number;
  /** user permissions for current user */
  permissions?: IEnvelopePermissions;
  /** how the envelope was created */
  source?: EnvelopeSource;
  /** when the envelope was archived (null = active) */
  archived_at?: string;
  /** whether the envelope is starred/pinned */
  starred?: boolean;
  /** color tags assigned to this envelope */
  tags?: ITag[];
  /** encrypted user scripts */
  user_scripts?: IUserScript[];
  /** persisted viewer/share-report preferences */
  view_settings?: {
    check_filter?: 'failed' | 'passed' | 'all' | 'changes' | 'rechecks' | 'failed_only';
    report_check_filter?: 'failed' | 'passed' | 'all' | 'changes' | 'rechecks' | 'failed_only';
    report_layout_mode?: 'compact' | 'detailed' | 'full';
    show_annotations?: boolean;
    view_mode?: 'single_page' | 'continuous_scroll';
    align_labels_to_top?: boolean;
    ref_viewer_x?: number;
    ref_viewer_y?: number;
    ref_viewer_width?: number;
    ref_viewer_height?: number;
  };
  /** persisted report export settings */
  report_settings?: {
    show_checklist_name: boolean;
    show_rules: boolean;
    show_audit_logs: boolean;
    show_title_info: boolean;
    show_compliance_summary: boolean;
    show_compliance_percent?: boolean;
    show_default_footer: boolean;
    show_page_images?: boolean;
    show_check_details?: boolean;
    show_pages_with_checks?: boolean;
    show_pages_without_checks?: boolean;
    show_checklist_info?: boolean;
    show_checklist_general_prompt?: boolean;
    show_checklist_rules_summary?: boolean;
    show_checklist_rules_details?: boolean;
    show_checklist_envelope_rules?: boolean;
    show_timezone?: boolean;
    show_revision_comparison?: boolean;
    show_check_attribution?: boolean;
    show_envelope_datetime?: boolean;
    show_envelope_revisions_info?: boolean;
    show_checklist_ai_model?: boolean;
    show_page_filenames?: boolean;
    show_page_summary_icons?: boolean;
    show_group_header?: boolean;
    show_group_checklist?: boolean;
    show_group_pages?: boolean;
    show_group_footer?: boolean;
    show_checklist_ai_model_info?: boolean;
    last_checklist_id?: string;
  };
  /** summary data from the last report */
  last_report?: {
    checklist_id: string;
    source_checklist_id?: string;
    checklist_name: string;
    ai_model?: string;
    ai_model_display?: string;
    created_at: string;
    total_checks: number;
    passed_checks: number;
    failed_checks: number;
    job_status: ReportJobStatus;
    prefix_id: string;
  };
}

export enum EInputFileMimeType {
  PDF = 'application/pdf',
  PNG = 'image/png',
  TIFF = 'image/tiff',
  GIF = 'image/gif',
  BMP = 'image/bmp',
  JPEG = 'image/jpeg',
  WEBP = 'image/webp',
  UNKNOWN = 'unknown'
}

// import


// Color utility functions for enhanced UX

/**
 * Creates a color with the specified opacity from a base color template
 */
export const createColorWithOpacity = (base_color: string, opacity: number): string => {
  return base_color.replace('${ALPHA}', opacity.toString());
};

/**
 * Generates a complete color palette for a given base color
 */
export const generateColorPalette = (base_color: string) => {
  return {
    base: createColorWithOpacity(base_color, REVDOKU_HIGHLIGHT_OPACITY),
    hover: createColorWithOpacity(base_color, REVDOKU_COLOR_VARIATIONS.HOVER_OPACITY),
    focus: createColorWithOpacity(base_color, REVDOKU_COLOR_VARIATIONS.FOCUS_OPACITY),
    active: createColorWithOpacity(base_color, REVDOKU_COLOR_VARIATIONS.ACTIVE_OPACITY),
    selected: createColorWithOpacity(base_color, REVDOKU_HIGHLIGHT_SELECTED_OPACITY),
    disabled: createColorWithOpacity(base_color, REVDOKU_COLOR_VARIATIONS.DISABLED_OPACITY),
    solid: createColorWithOpacity(base_color, 1.0)
  };
};

/**
 * Creates CSS-ready styles for highlights with consistent theming
 */
export const createHighlightStyles = (
  base_color: string,
  isSelected: boolean = false,
  customOpacity?: number
) => {
  const opacity = customOpacity ?? (isSelected ? REVDOKU_HIGHLIGHT_SELECTED_OPACITY : REVDOKU_HIGHLIGHT_OPACITY);
  const backgroundColor = createColorWithOpacity(base_color, opacity);
  const border_color = createColorWithOpacity(base_color, 0.6);
  const shadowColor = createColorWithOpacity(base_color, 0.3);

  return {
    base: `
      background-color: ${backgroundColor};
      border: 1px solid ${border_color};
      border-radius: ${REVDOKU_HIGHLIGHT_ROUNDING_PERCENT * 100}%;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    `.replace(/\s+/g, ' ').trim(),

    selected: `
      background: linear-gradient(135deg, ${backgroundColor} 0%, ${createColorWithOpacity(base_color, opacity * 0.8)} 100%);
      border: 2px solid ${border_color};
      border-radius: ${REVDOKU_HIGHLIGHT_ROUNDING_PERCENT * 100}%;
      box-shadow: 0 4px 12px ${shadowColor}, 0 2px 4px ${createColorWithOpacity(base_color, 0.2)};
      transform: scale(1.02);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    `.replace(/\s+/g, ' ').trim()
  };
};

/**
 * Calculates the appropriate minimum opacity based on image dimensions
 * to ensure highlights remain visible in small preview images
 */
export const getMinOpacityForImageSize = (imageWidth: number, imageHeight: number): number | undefined => {
  const minDimension = Math.min(imageWidth, imageHeight);

  // For very small images (< 200px), use high opacity
  if (minDimension < 200) {
    return 0.7;
  }

  // For small images (< 400px), use medium-high opacity
  if (minDimension < 400) {
    return 0.5;
  }

  // For medium images (< 600px), use slightly higher opacity
  if (minDimension < 600) {
    return 0.35;
  }

  // For larger images, use default opacity
  return undefined;
};


export function getWidth(coord: ICoordinates): number {
  return Math.abs(coord.x2 - coord.x1);
}

export function getHeight(coord: ICoordinates): number {
  return Math.abs(coord.y2 - coord.y1);
}


export function isMimeTypeImage(mime_type: string): boolean {
  return mime_type.startsWith('image/');
}
export function isMimeTypePdf(mime_type: string): boolean {
  return mime_type === EInputFileMimeType.PDF;
}

export const getColorsForCheckResult = (
  checkResult: ICheck,
  minOpacity?: number
): IHighlightColors => {
  if (!checkResult) {
    throw new Error('Check result is undefined: cant get colors for it');
  }

  // All failed checks use the same red — source is distinguished via icon on hover
  const isManual = checkResult.source === CheckSource.USER;
  let mainColorBase = REVDOKU_BASE_COLOR_FAILED_AI;
  let text_colorBase = REVDOKU_BASE_COLOR_TEXT;

  // Catch-changes change detection checks use muted orange when failed, green when passed
  const isCatchChanges = checkResult.rule_id === REVDOKU_CATCH_CHANGES_RULE_ID;
  if (isCatchChanges && !checkResult.passed) {
    mainColorBase = REVDOKU_BASE_COLOR_CHANGES;
  } else if (checkResult.passed) {
    // Passed checks use green regardless of origin
    mainColorBase = REVDOKU_BASE_COLOR_PASSED;
    text_colorBase = REVDOKU_BASE_COLOR_TEXT; // Always white text on green
  }

  // Apply minimum opacity if provided for better visibility in small images
  const effectiveHighlightOpacity = minOpacity ? Math.max(REVDOKU_HIGHLIGHT_OPACITY, minOpacity) : REVDOKU_HIGHLIGHT_OPACITY;
  const effectiveSelectedOpacity = minOpacity ? Math.max(REVDOKU_HIGHLIGHT_SELECTED_OPACITY, minOpacity) : REVDOKU_HIGHLIGHT_SELECTED_OPACITY;
  const effectiveBorderOpacity = minOpacity ? Math.max(0.6, minOpacity * 1.5) : 0.6; // Border slightly more opaque

  // Generate base colors with appropriate opacity
  const highlight_color = mainColorBase.replace('${ALPHA}', `${effectiveHighlightOpacity}`);
  const selected_highlight_color = mainColorBase.replace('${ALPHA}', `${effectiveSelectedOpacity}`);
  const base_color = mainColorBase.replace('${ALPHA}', `${effectiveHighlightOpacity}`);
  const border_color = mainColorBase.replace('${ALPHA}', `${effectiveBorderOpacity}`);
  const text_color = typeof text_colorBase === 'string' && text_colorBase.includes('${ALPHA}')
    ? text_colorBase.replace('${ALPHA}', '1.0')
    : text_colorBase;

  // Modern highlight styles with subtle gradients and clean borders
  const highlight_style = `
    background: ${highlight_color};
    border: 1px solid ${border_color};
    backdrop-filter: blur(0.5px);
    transition: all 0.2s ease-in-out;
  `.replace(/\s+/g, ' ').trim();

  // Calculate shadow opacity separately to avoid issues with Math.min in replace
  const shadowOpacity = Math.min(effectiveBorderOpacity, 0.4);
  const shadowColor = mainColorBase.replace('${ALPHA}', `${shadowOpacity}`);

  const selected_highlight_style = `
    background: linear-gradient(135deg, ${selected_highlight_color} 0%, ${highlight_color} 100%);
    border: 2px solid ${border_color};
    box-shadow: 0 2px 8px ${shadowColor};
    backdrop-filter: blur(1px);
    transform: scale(1.02);
    transition: all 0.2s ease-in-out;
  `.replace(/\s+/g, ' ').trim();

  // All highlight types use dashed borders; color differentiates type
  const border_style = 'dashed';
  const border_width = '2px';

  // Solid hint text color for margin annotation labels (no transparency)
  const hint_text_color = (isCatchChanges && !checkResult.passed)
    ? REVDOKU_HINT_TEXT_COLOR_CHANGES
    : checkResult.passed
      ? REVDOKU_HINT_TEXT_COLOR_PASSED
      : REVDOKU_HINT_TEXT_COLOR_FAILED_AI;

  return {
    highlight_style,
    selected_highlight_style,
    highlight_color,
    selected_highlight_color,
    base_color,
    border_color,
    text_color,
    hint_text_color,
    border_style,
    border_width
  } as IHighlightColors;
};


export function getDocumentFileRevisionsForEnvelopeRevision(
  document_files: IDocumentFile[],
  doc: IEnvelopeRevision,
): IDocumentFileRevision[] {
  if (!doc?.document_file_revision_links) {
    throw new Error(`getDocumentFileRevisionsForEnvelopeRevision: no document_file_revision_links found in the source document`);
  }
  const result: IDocumentFileRevision[] = [];
  if (!document_files || document_files.length === 0) {
    throw new Error(`getDocumentFileRevisionsForEnvelopeRevision: no files found`);
  }
  for (const link of doc.document_file_revision_links) {
    const file = document_files.find(f => f.id === link.document_file_id);
    // now get the linked revision for this file
    const linkedRevision = file?.document_file_revisions?.find(r => r.revision_number === link.revision_number);
    if (linkedRevision) {
      result.push(linkedRevision);
    } else {
      console.error(`getDocumentFileRevisionsForEnvelopeRevision: linkedRevision not found for file ${link.document_file_id} and revision ${link.revision_number}`);
      throw new Error(`getDocumentFileRevisionsForEnvelopeRevision: linkedRevision not found for file ${link.document_file_id} and revision ${link.revision_number}`);
    }
  }
  return result;
}



export function getPageFromEnvelopeRevision(
  document_files: IDocumentFile[],
  doc: IEnvelopeRevision,
  pageIndex: number
): IPageInfo | undefined {
  const files: IDocumentFileRevision[] = getDocumentFileRevisionsForEnvelopeRevision(document_files, doc);
  let idx = pageIndex;
  for (const file of files) {
    if (!file.pages) continue;
    if (idx < file.pages.length) {
      return file.pages[idx];
    }
    idx -= file.pages.length;
  }
  throw new Error(`getPageFromDocument: pageIndex ${pageIndex} not found in any file, max page index was ${idx}`);
}

export function getPagesForDocument(
  document_files: IDocumentFile[],
  doc: IEnvelopeRevision
): IPageInfo[] {
  // get all file revisions for the source document
  const fileRevisions: IDocumentFileRevision[] = getDocumentFileRevisionsForEnvelopeRevision(document_files, doc);
  // now we need to merge all files into one array of pages
  if (!fileRevisions || fileRevisions.length === 0) {
    return [];
  }
  console.debug(`getPagesForDocument: fileRevisions: ${fileRevisions.length}`);
  return fileRevisions.flatMap(f => f.pages || []);
}

export function createFileRevisionLinksFromVeryLatestFileRevisions(
  document_files: IDocumentFile[]
): IDocumentFileRevisionLink[] {


  const fileLinks: IDocumentFileRevisionLink[] = [];
  for (const file of document_files) {
    fileLinks.push({
      document_file_id: file.id,
      // only the latest revision is used in the file
      revision_number: file.document_file_revisions.length - 1
    } as IDocumentFileRevisionLink);
  }
  return fileLinks;
}
export function getFilesWithOnlyRelatedFileRevisionsForEnvelopeRevision(
  document_files: IDocumentFile[],
  document_file_revision_links: IDocumentFileRevisionLink[]
): IDocumentFile[] {
  // document_files contain all files with all revisions
  // we need to return only files which are listed in the doc.document_file_revision_links 
  // and each file should have only related revision
  const result: IDocumentFile[] = [];
  for (const link of document_file_revision_links) {
    const file = document_files.find(f => f.id === link.document_file_id);
    if (file) {
      // now we need to remain only the revision which is related to the source document
      const relatedRevision = file.document_file_revisions.find(r => r.revision_number === link.revision_number);
      if (relatedRevision) {
        // pushing IDocumentFile with only one revision which is used in the source document
        // so as a result we get array of IDocumentFile where each has only one revision which is used by the source document
        result.push({
          id: file.id,
          document_file_revisions: [relatedRevision],
          created_at: file.created_at,
          updated_at: file.updated_at,
        });
      }
    }
  }
  return result;
}


export function getPageDimensionsFromDocument(
  document_files: IDocumentFile[],
  doc: IEnvelopeRevision,
  pageIndex: number
): IPageInfo | undefined {
  return getPageFromEnvelopeRevision(document_files, doc, pageIndex);
}

export function getDocumentMetaData(
  document_files: IDocumentFile[],
  doc: IEnvelopeRevision,
): string {
  const files: IDocumentFileRevision[] = getDocumentFileRevisionsForEnvelopeRevision(document_files, doc);
  return files.map(f => f.metadata || '').join('\n');
}

export function getPageCountFromDocument(
  document_files: IDocumentFile[],
  doc: IEnvelopeRevision,
): number {
  const files: IDocumentFileRevision[] = getDocumentFileRevisionsForEnvelopeRevision(document_files, doc);
  return files.reduce((cnt, f) => cnt + (f.pages?.length || 0), 0);
}

export function getDateTimeAgoAsHumanString(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();
  const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diff / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diff / (1000 * 60));
  const diffSeconds = Math.floor(diff / 1000);
  if (diffDays > 0) return diffDays + 'd ago';
  if (diffHours > 0) return diffHours + 'h ago';
  if (diffMinutes > 0) return diffMinutes + 'm ago';
  return diffSeconds + 's ago';
}
// 


export function createNewBaseObject(): IBase {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    created_at: now,
    updated_at: now,
  } as IBase;
}

export function createNewCheck(): ICheck {
  return {
    ...createNewBaseObject(),
    rule_order: 0,
    rule_id: '',
    passed: false,
    description: '',
    page: 0,
    x1: -1,
    y1: -1,
    x2: -1,
    y2: -1,
  } as ICheck;
}


export function createNewRule(checklistPrefixId: string, ruleIndex: number): IRule {
  const rule = {
    ...{
      ...createNewBaseObject(),
      prompt: '',
      order: -1, // -1 means is to make sure we set it in the code after adding properly
      checks: null,
    } as IRule,
  } as IRule;

  // If checklist prefix ID and index are provided, generate proper rule ID
  if (checklistPrefixId && typeof ruleIndex === 'number') {
    rule.id = `${checklistPrefixId}_rule_${ruleIndex}`;
  }
  else {
    throw new Error('createNewRule: checklistPrefixId and ruleIndex are required to generate proper rule ID');
  }

  return rule;
}

// Validate and fix rule IDs in a checklist to ensure consistent format
export function validateAndFixChecklistRuleIds(checklist: IChecklist): IChecklist {
  if (!checklist.rules || !Array.isArray(checklist.rules)) {
    return checklist;
  }

  const fixedRules = checklist.rules.map((rule, index) => {
    // Generate proper rule ID if missing or invalid
    if (!rule.id || rule.id.trim() === '') {
      rule.id = `${checklist.id}_rule_${index + 1}`;
    }

    // Validate prompt exists
    if (!rule.prompt || rule.prompt.trim() === '') {
      throw new Error(`Rule at index ${index} has empty prompt`);
    }

    return rule;
  });

  return {
    ...checklist,
    rules: fixedRules
  };
}



export function createNewChecklist(): IChecklist {
  return {
    ...createNewBaseObject(),
    name: 'New Checklist',
    rules: []
  } as IChecklist;
}

/** Convert a single type key to a display label: strips `ch_` prefix if present. */
export function getCheckDataTypeLabel(type: string): string {
  const t = type.trim();
  return t.startsWith('ch_') ? t.slice(3) : t;
}

/** Get display labels for all types in a check's `data.type` (comma-separated). Returns [] if no data. */
export function getCheckDataTypeLabels(check: { data?: ICheckData | null }): string[] {
  if (!check.data?.type) return [];
  return check.data.type.split(',').map(getCheckDataTypeLabel).filter(Boolean);
}

export function createNewReport(): IReport {
  return {
    ...createNewBaseObject(),
    envelope_revision_id: '',
    checklist_id: '',
    checklist_revision_number: -1,
    checks: [],
    job_status: ReportJobStatus.COMPLETED,
    job_id: undefined,
    error_message: undefined,
  } as IReport;
}

// ─── Check Type & Filter Enums ────────────────────────────────────────────────

/** Well-known rule ID for the synthetic change detection rule (only when track_changes is on) */
export const REVDOKU_CATCH_CHANGES_RULE_ID = 'catch-changes';

/** Well-known rule ID for the catch-all fallback bucket — checks whose rule_id can't be
 *  matched to any known rule (e.g. virtual rules created by revdoku-doc-api, orphaned checks). */
export const REVDOKU_CATCH_ALL_RULE_ID = 'catch-all';

/** Runtime-derived check classification. A check can have multiple types. */
export enum CheckType {
  FAILED = 'failed',
  FAILED_ONLY = 'failed_only', // failed AND not a change — highest display priority
  PASSED = 'passed',
  CHANGE = 'change',
  RECHECK = 'recheck',
}

/** UI filter selection for the check dropdown. Values match persisted view_settings strings. */
export enum CheckFilterType {
  ALL = 'all',
  FAILED_AND_CHANGES = 'failed',
  FAILED = 'failed_only',
  PASSED = 'passed',
  CHANGES = 'changes',
  RECHECKS = 'rechecks',
}

/** Labels for each check filter, used in dropdowns and report section headers. */
export const REVDOKU_CHECK_FILTER_LABELS: Record<CheckFilterType, { label: string; failedSection: string; passedSection: string }> = {
  [CheckFilterType.ALL]: { label: 'All', failedSection: 'Issues', passedSection: 'Passed' },
  [CheckFilterType.FAILED_AND_CHANGES]: { label: 'Issues & changes', failedSection: 'Issues', passedSection: 'Passed' },
  [CheckFilterType.FAILED]: { label: 'Issues', failedSection: 'Issues', passedSection: 'Passed' },
  [CheckFilterType.PASSED]: { label: 'Passed', failedSection: 'Issues', passedSection: 'Passed' },
  [CheckFilterType.CHANGES]: { label: 'Changes Only', failedSection: 'Changes', passedSection: 'Passed Changes' },
  [CheckFilterType.RECHECKS]: { label: 'Re-checks Only', failedSection: 'Re-checks', passedSection: 'Passed Re-checks' },
};

/** Derive the set of check types for a check (runtime, not persisted). */
export function getCheckTypes(check: { passed: boolean; rule_id?: string; description?: string }): Set<CheckType> {
  const types = new Set<CheckType>();
  if (check.passed) types.add(CheckType.PASSED);
  if (!check.passed) types.add(CheckType.FAILED);
  if (check.rule_id === REVDOKU_CATCH_CHANGES_RULE_ID) types.add(CheckType.CHANGE);
  if (!check.passed && check.rule_id !== REVDOKU_CATCH_CHANGES_RULE_ID) types.add(CheckType.FAILED_ONLY);
  if (check.description?.startsWith('#recheck ')) types.add(CheckType.RECHECK);
  return types;
}

/** Determine which icon to draw before a check's label text. */
export function getCheckIconType(check: { description?: string; rule_id?: string }): 'recheck' | 'changes' | null {
  if (check.description?.startsWith('#recheck ')) return 'recheck';
  if (check.rule_id === REVDOKU_CATCH_CHANGES_RULE_ID) return 'changes';
  return null;
}

/**
 * Strip markdown code-fence wrappers from a string.
 *
 * LLMs often wrap JSON (or other structured output) in triple-backtick fences:
 *
 *     ```json
 *     { "key": "value" }
 *     ```
 *
 * This function removes the opening ``` line (with optional language tag) and
 * closing ``` line, returning just the inner content. If no fence is detected
 * the string is returned unchanged. Safe to call on already-clean input.
 */
export function stripCodeFence(text: string): string {
  if (!text) return text;
  // Match: optional leading whitespace, ```, optional language tag, newline,
  //        content (captured), newline, optional whitespace, ```, optional trailing whitespace/newline

  // const m = text.match(/^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n\s*```\s*$/);
  // The regex for stripping code fences is too restrictive. It requires a newline (\n) immediately after the opening fence and immediately before the closing fence. Many LLMs produce compact output like json{"key":"val"} which will fail to match this regex. Additionally, using \w* for the language tag is more robust than [a-zA-Z]* as some tags might contain numbers (e.g., cpp11).
  const m = text.match(/^\s*```\w*\s*\n?([\s\S]*?)\n?\s*```\s*$/);
  return m ? m[1] : text;
}

/** Filter checks by a CheckFilterType. */
export function filterChecksByType<T extends { passed: boolean; rule_id?: string; description?: string }>(
  checks: T[],
  filter: CheckFilterType,
): T[] {
  if (filter === CheckFilterType.ALL) return checks;
  return checks.filter(c => {
    const types = getCheckTypes(c);
    switch (filter) {
      case CheckFilterType.FAILED_AND_CHANGES: return types.has(CheckType.FAILED) || types.has(CheckType.CHANGE);
      case CheckFilterType.FAILED: return types.has(CheckType.FAILED) && !types.has(CheckType.CHANGE);
      case CheckFilterType.PASSED: return types.has(CheckType.PASSED);
      case CheckFilterType.CHANGES: return types.has(CheckType.CHANGE);
      case CheckFilterType.RECHECKS: return types.has(CheckType.RECHECK);
    }
  });
}

