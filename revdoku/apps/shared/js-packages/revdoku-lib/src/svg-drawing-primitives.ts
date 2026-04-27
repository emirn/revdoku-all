/**
 * Framework-agnostic SVG drawing primitives for check highlights, badges,
 * leader lines, icons, and label boxes.
 *
 * Pure functions: coordinates in → SVG string out.
 * No DOM, no canvas, no React — works in Node and the browser.
 *
 * Consumers:
 *   - revdoku-doc-api/src/lib/svg-export-utils.ts  (report export — server-side)
 *   - apps/web/app/frontend HighlightOverlay.tsx  (envelope view — TODO: adopt)
 *
 * By sharing these primitives both rendering paths produce identical visuals.
 */

import {
  HighlightMode,
  REVDOKU_TYPE_BADGE_CHANGES_BORDER,
  REVDOKU_TYPE_BADGE_CHANGES_BG,
  REVDOKU_TYPE_BADGE_CHANGES_TEXT,
  REVDOKU_TYPE_BADGE_RECHECK_BORDER,
  REVDOKU_TYPE_BADGE_RECHECK_BG,
  REVDOKU_TYPE_BADGE_RECHECK_TEXT,
  REVDOKU_TYPE_BADGE_HEIGHT_SCALE,
  REVDOKU_TYPE_BADGE_PADDING_H,
  REVDOKU_TYPE_BADGE_BORDER_RADIUS,
} from './common-types';
import {
  calculateCornerRadius,
  calculateSourceBadgePosition,
} from './highlight-rendering-utils';
import {
  REVDOKU_VAL_DISPLAY_OPACITY,
  REVDOKU_VAL_DISPLAY_FONT_SCALE,
} from './canvas-rendering-utils';

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Round to 1 decimal for compact SVG output. */
export function svgR(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** XML-escape a string for use inside SVG attributes or text content. */
export function svgEsc(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Highlight shapes
// ---------------------------------------------------------------------------

const HIGHLIGHT_STROKE_WIDTH = 2;

/**
 * Emit SVG markup for a check highlight, respecting the active highlight mode.
 *
 * Modes: RECTANGLE (default), DOT, UNDERLINE, BRACKET.
 */
export function svgHighlight(
  x: number, y: number, w: number, h: number,
  borderColor: string, fillColor: string | undefined, opacity: number,
  highlightMode?: number,
): string {
  const mode = highlightMode ?? HighlightMode.RECTANGLE;
  switch (mode) {
    case HighlightMode.DOT: {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return `<circle cx="${svgR(cx)}" cy="${svgR(cy)}" r="4" fill="${borderColor}" opacity="1"/>`;
    }
    case HighlightMode.UNDERLINE:
      return `<line x1="${svgR(x)}" y1="${svgR(y + h)}" x2="${svgR(x + w)}" y2="${svgR(y + h)}" ` +
        `stroke="${borderColor}" stroke-width="2" opacity="0.6"/>`;
    case HighlightMode.BRACKET: {
      const arm = Math.min(12, Math.min(w, h) * 0.25);
      const sw = 4;
      const op = 0.7;
      return [
        `<polyline points="${svgR(x)},${svgR(y + arm)} ${svgR(x)},${svgR(y)} ${svgR(x + arm)},${svgR(y)}" fill="none" stroke="${borderColor}" stroke-width="${sw}" opacity="${op}"/>`,
        `<polyline points="${svgR(x + w - arm)},${svgR(y)} ${svgR(x + w)},${svgR(y)} ${svgR(x + w)},${svgR(y + arm)}" fill="none" stroke="${borderColor}" stroke-width="${sw}" opacity="${op}"/>`,
        `<polyline points="${svgR(x)},${svgR(y + h - arm)} ${svgR(x)},${svgR(y + h)} ${svgR(x + arm)},${svgR(y + h)}" fill="none" stroke="${borderColor}" stroke-width="${sw}" opacity="${op}"/>`,
        `<polyline points="${svgR(x + w - arm)},${svgR(y + h)} ${svgR(x + w)},${svgR(y + h)} ${svgR(x + w)},${svgR(y + h - arm)}" fill="none" stroke="${borderColor}" stroke-width="${sw}" opacity="${op}"/>`,
      ].join('\n');
    }
    default: {
      const cr = calculateCornerRadius(w, h);
      return `<rect x="${svgR(x)}" y="${svgR(y)}" width="${svgR(w)}" height="${svgR(h)}" ` +
        `fill="${fillColor || 'none'}" stroke="${borderColor}" ` +
        `stroke-width="${HIGHLIGHT_STROKE_WIDTH}" rx="${svgR(cr)}" ry="${svgR(cr)}" ` +
        `opacity="${opacity}"/>`;
    }
  }
}

// ---------------------------------------------------------------------------
// Source badges (AI sparkles / manual person)
// ---------------------------------------------------------------------------

function svgPersonIcon(scale: number): string {
  const s = scale;
  return `<g>` +
    `<circle cx="0" cy="${svgR(-3 * s)}" r="${svgR(3 * s)}" fill="currentColor"/>` +
    `<path d="M${svgR(-5 * s)} ${svgR(6 * s)} Q${svgR(-5 * s)} ${svgR(2 * s)} ${svgR(-3 * s)} ${svgR(2 * s)} ` +
    `Q${svgR(-3 * s)} 0 0 0 Q${svgR(3 * s)} 0 ${svgR(3 * s)} ${svgR(2 * s)} ` +
    `Q${svgR(5 * s)} ${svgR(2 * s)} ${svgR(5 * s)} ${svgR(6 * s)} Z" fill="currentColor"/>` +
    `</g>`;
}

function svgSparklesIcon(scale: number): string {
  const s = scale;
  const sparkle = (cx: number, cy: number, sz: number) => {
    const pts = [
      `${svgR(cx * s)},${svgR((cy - sz) * s)}`,
      `${svgR((cx + sz * 0.3) * s)},${svgR((cy - sz * 0.3) * s)}`,
      `${svgR((cx + sz) * s)},${svgR(cy * s)}`,
      `${svgR((cx + sz * 0.3) * s)},${svgR((cy + sz * 0.3) * s)}`,
      `${svgR(cx * s)},${svgR((cy + sz) * s)}`,
      `${svgR((cx - sz * 0.3) * s)},${svgR((cy + sz * 0.3) * s)}`,
      `${svgR((cx - sz) * s)},${svgR(cy * s)}`,
      `${svgR((cx - sz * 0.3) * s)},${svgR((cy - sz * 0.3) * s)}`,
    ].join(' ');
    return `<polygon points="${pts}" fill="currentColor"/>`;
  };
  return `<g>${sparkle(-3, -3, 3)}${sparkle(3, 2, 2.5)}${sparkle(-2, 4, 2)}</g>`;
}

/**
 * Source badge (person silhouette or sparkles) positioned at top-right of highlight.
 */
export function svgSourceBadge(
  highlightX: number, highlightY: number, highlightW: number,
  borderColor: string, isManual: boolean,
): string {
  const metrics = calculateSourceBadgePosition(highlightX, highlightY, highlightW);
  const cx = metrics.x;
  const cy = metrics.y;
  const rad = metrics.size / 2;
  const iconScale = metrics.size / 24;
  return [
    `<circle cx="${svgR(cx)}" cy="${svgR(cy)}" r="${svgR(rad)}" fill="#ffffff" stroke="${borderColor}" stroke-width="2" opacity="0.85"/>`,
    `<g transform="translate(${svgR(cx)},${svgR(cy)})" color="${borderColor}">`,
    isManual ? svgPersonIcon(iconScale) : svgSparklesIcon(iconScale),
    '</g>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Leader lines
// ---------------------------------------------------------------------------

/** Default leader-line constants (used by revdoku-doc-api SVG export). */
const LEADER_LINE_WIDTH_DEFAULT = 1.5;
const LEADER_OPACITY_DEFAULT = 0.7;
const LEADER_DASH_DEFAULT = '4 2';
const LEADER_CIRCLE_R_DEFAULT = 3;

export interface LeaderLineOptions {
  strokeWidth?: number;
  opacity?: number;
  dashArray?: string;
  circleR?: number;
  /** When true, include the endpoint circle. Default: true. */
  endpointDot?: boolean;
}

/**
 * Dashed leader line with optional endpoint circle connecting a label to its highlight.
 * Returns empty string if the line is too short (< 5 px).
 *
 * Override defaults via `opts` for context-specific styling (e.g. the frontend
 * uses thicker lines to match CSS rendering).
 */
export function svgLeaderLine(
  x1: number, y1: number, x2: number, y2: number,
  color: string,
  opts?: LeaderLineOptions,
): string {
  const dx = x2 - x1, dy = y2 - y1;
  if (Math.sqrt(dx * dx + dy * dy) < 5) return '';
  const sw = opts?.strokeWidth ?? LEADER_LINE_WIDTH_DEFAULT;
  const op = opts?.opacity ?? LEADER_OPACITY_DEFAULT;
  const dash = opts?.dashArray ?? LEADER_DASH_DEFAULT;
  const cr = opts?.circleR ?? LEADER_CIRCLE_R_DEFAULT;
  const showDot = opts?.endpointDot !== false;
  const parts: string[] = [
    `<line x1="${svgR(x1)}" y1="${svgR(y1)}" x2="${svgR(x2)}" y2="${svgR(y2)}" ` +
    `stroke="${color}" stroke-width="${sw}" ` +
    `${dash ? `stroke-dasharray="${dash}" ` : ''}opacity="${op}"/>`,
  ];
  if (showDot) {
    parts.push(
      `<circle cx="${svgR(x2)}" cy="${svgR(y2)}" r="${cr}" ` +
      `fill="${color}" opacity="${op}"/>`,
    );
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Numbered badge circle
// ---------------------------------------------------------------------------

const REVDOKU_BADGE_TEXT_COLOR = '#ffffff';

/**
 * Numbered circle badge (filled circle + white text).
 * Accepts a number or string label (e.g. "New").
 */
export function svgBadge(
  cx: number, cy: number, radius: number, fontSize: number,
  fillColor: string, label: number | string, fontFamily: string,
): string {
  return [
    `<circle cx="${svgR(cx)}" cy="${svgR(cy)}" r="${svgR(radius)}" fill="${fillColor}"/>`,
    `<text x="${svgR(cx)}" y="${svgR(cy)}" text-anchor="middle" dominant-baseline="central" ` +
    `fill="${REVDOKU_BADGE_TEXT_COLOR}" font-size="${svgR(fontSize)}" font-weight="700" ` +
    `font-family="${svgEsc(fontFamily)}">${typeof label === 'string' ? svgEsc(label) : label}</text>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Recheck / Changes icons
// ---------------------------------------------------------------------------

/**
 * Recheck icon (rotate-ccw arrow) centred at (cx, cy).
 */
export function svgRecheckIcon(cx: number, cy: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${svgR(cx - 12 * s)},${svgR(cy - 12 * s)}) scale(${svgR(s)})">` +
    `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M3 3v5h5" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</g>`;
}

/**
 * Changes icon (two horizontal arrows) centred at (cx, cy).
 */
export function svgChangesIcon(cx: number, cy: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${svgR(cx - 12 * s)},${svgR(cy - 12 * s)}) scale(${svgR(s)})">` +
    `<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</g>`;
}

// ---------------------------------------------------------------------------
// Type badges (pills: "number", "removed", "date", etc.)
// ---------------------------------------------------------------------------

export interface TypeBadgePlacement {
  x: number;         // current x cursor (mutated by consumer)
  y: number;         // centre y of badge row
  isLeftSide: boolean;
  fontSize: number;
  fontFamily: string;
}

/**
 * Render a single type-badge pill at the given position.
 * Returns SVG string and the width consumed.
 */
export function svgTypeBadge(
  label: string, placement: TypeBadgePlacement,
  isCatchChanges: boolean, isRecheck: boolean,
): { svg: string; width: number } {
  const { fontSize, fontFamily, isLeftSide } = placement;
  const tbH = fontSize * REVDOKU_TYPE_BADGE_HEIGHT_SCALE;
  const estW = label.length * fontSize * 0.65 + REVDOKU_TYPE_BADGE_PADDING_H * 2 + 2;
  const bgColor = isCatchChanges ? REVDOKU_TYPE_BADGE_CHANGES_BG : (isRecheck ? REVDOKU_TYPE_BADGE_RECHECK_BG : REVDOKU_TYPE_BADGE_CHANGES_BG);
  const bdColor = isCatchChanges ? REVDOKU_TYPE_BADGE_CHANGES_BORDER : (isRecheck ? REVDOKU_TYPE_BADGE_RECHECK_BORDER : REVDOKU_TYPE_BADGE_CHANGES_BORDER);
  const txColor = isCatchChanges ? REVDOKU_TYPE_BADGE_CHANGES_TEXT : (isRecheck ? REVDOKU_TYPE_BADGE_RECHECK_TEXT : REVDOKU_TYPE_BADGE_CHANGES_TEXT);
  const drawX = isLeftSide ? placement.x - estW : placement.x;
  const svg = [
    `<rect x="${svgR(drawX)}" y="${svgR(placement.y)}" width="${svgR(estW)}" height="${svgR(tbH)}" ` +
    `fill="${bgColor}" stroke="${bdColor}" stroke-width="1" rx="${REVDOKU_TYPE_BADGE_BORDER_RADIUS}" ry="${REVDOKU_TYPE_BADGE_BORDER_RADIUS}"/>`,
    `<text x="${svgR(drawX + REVDOKU_TYPE_BADGE_PADDING_H + 1)}" y="${svgR(placement.y + tbH / 2)}" dominant-baseline="central" ` +
    `fill="${txColor}" font-size="${svgR(fontSize)}" font-weight="600" ` +
    `font-family="${svgEsc(fontFamily)}">${svgEsc(label)}</text>`,
  ].join('\n');
  return { svg, width: estW };
}

// ---------------------------------------------------------------------------
// Label box with text (foreignObject-based)
// ---------------------------------------------------------------------------

export const REVDOKU_LABEL_BORDER_WIDTH = 1.5;
export const REVDOKU_LABEL_BORDER_RADIUS = 3;

export interface LabelBoxOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderColor: string;
  textColor: string;
  fontSize: number;
  padding: number;
  fontFamily: string;
  lineHeight: number;
  textAlign?: string;
}

/**
 * Label box: white rounded rect + foreignObject HTML text.
 * The text uses browser-native word wrapping via CSS.
 */
export function svgLabelBox(
  opts: LabelBoxOptions,
  htmlContent: string,
): string {
  const { x, y, width: w, height: h, borderColor, textColor, fontSize, padding, fontFamily, lineHeight, textAlign } = opts;
  const alignStyle = textAlign ? `text-align:${textAlign};` : '';
  return [
    `<rect x="${svgR(x)}" y="${svgR(y)}" width="${svgR(w)}" height="${svgR(h)}" ` +
    `fill="#ffffff" stroke="${borderColor}" stroke-width="${REVDOKU_LABEL_BORDER_WIDTH}" ` +
    `rx="${REVDOKU_LABEL_BORDER_RADIUS}" ry="${REVDOKU_LABEL_BORDER_RADIUS}"/>`,
    `<foreignObject x="${svgR(x)}" y="${svgR(y)}" width="${svgR(Math.max(10, w))}" height="${svgR(Math.max(10, h))}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="` +
    `font-family:${svgEsc(fontFamily)};font-size:${svgR(fontSize)}px;` +
    `color:${textColor};` +
    `line-height:${lineHeight};` +
    `padding:${svgR(padding)}px;` +
    `word-break:break-word;overflow:hidden;${alignStyle}` +
    `">${htmlContent}</div></foreignObject>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Label text formatting (val= styling)
// ---------------------------------------------------------------------------

/**
 * Format check description as HTML with val= styled differently.
 */
export function svgFormatLabelHtml(
  description: string, fontSize: number,
): string {
  const valIdx = description.indexOf(' val=');
  const mainText = valIdx >= 0 ? description.slice(0, valIdx) : description;
  const valText = valIdx >= 0 ? description.slice(valIdx + 1) : '';
  const valFontSize = fontSize * REVDOKU_VAL_DISPLAY_FONT_SCALE;
  let html = svgEsc(mainText);
  if (valText) {
    html += `<span style="font-family:monospace;font-size:${svgR(valFontSize)}px;` +
      `opacity:${REVDOKU_VAL_DISPLAY_OPACITY};margin-left:4px;">${svgEsc(valText)}</span>`;
  }
  return html;
}
