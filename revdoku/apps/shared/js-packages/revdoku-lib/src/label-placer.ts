/**
 * Shared Label Placement Algorithm
 *
 * Platform-independent label placement used by:
 * - revdoku-doc-api (report creation, preliminary placements)
 * - revdoku-doc-api (export rendering)
 * - Frontend (client-side envelope view with filter-based re-placement)
 *
 * Algorithm — Margin-first 4-step placement:
 *
 * Step 1 — Pack ALL labels into the right margin (top to down, up to REVDOKU_SIDE_MAX_FILL[RIGHT] × page height).
 *   Sorted by highlight Y (primary), rightmost-first (secondary).
 *   Labels that don't fit overflow to Step 2.
 *
 * Step 2 — Place overflow labels on other sides:
 *   Inside page (top to down, free space not used by highlights/busy areas)
 *   Top side (right to left)
 *   Left side (top to down)
 *   Bottom side (right to left)
 *
 * Step 3 — Resize all labels to actual text dimensions.
 *   Right-side labels may widen (up to maxRightLabelChars) to reduce height.
 *   Each side is repacked after resize.
 *
 * Step 4 — Move margin labels inside free page space if ≥15% closer to highlight.
 *   Re-compacts margins after moves.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Rectangle type for placement geometry */
export interface PlacerRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

import { PlacementSide } from './common-types';
import { REVDOKU_SIDE_MAX_FILL } from './highlight-rendering-utils';

/** Which side of the page a label is placed on */
export type PlacerSide = PlacementSide;

/** Input for a single label to place */
export interface LabelPlacementInput {
  /** Unique identifier for the label */
  id: string;
  /** The highlight rectangle this label is attached to */
  highlight: PlacerRect;
  /** Text content of the label (used for height measurement) */
  text: string;
  /** Rule order for display (badge number) */
  ruleOrder: number;
}

/** Configuration options for the placement algorithm */
export interface LabelPlacementOptions {
  /** Page width in pixels */
  pageW: number;
  /** Page height in pixels */
  pageH: number;
  /** Gap between elements (default 8) */
  gap?: number;
  /** Maximum height for right margin column (default 125% of pageH) */
  rightMarginMaxHeight?: number;
  /** Areas to avoid (content boxes, etc.) */
  busyAreas?: PlacerRect[];
  /** Function to estimate text height at a given label width */
  measureTextHeight: (text: string, width: number) => number;
  /** Label font size in pixels (default 12) */
  labelFontSize?: number;
  /** Character width factor relative to font size (default 0.55) */
  charWidthFactor?: number;
  /** Label inner padding in pixels (default 5) */
  labelPadding?: number;
  /** Initial label width in characters (default 30) */
  initialLabelChars?: number;
  /** Max label width in characters for right-side labels (default 80) */
  maxRightLabelChars?: number;
  /** Minimum label height in pixels (default 52) */
  minLabelHeight?: number;
  /** Minimum label width in pixels (default 80) */
  minLabelWidth?: number;
}

/** A single placed label */
export interface PlacedLabel {
  /** ID from the input */
  id: string;
  /** Which side the label was placed on */
  side: PlacerSide;
  /** Position and size of the label box */
  box: PlacerRect;
  /** Index into the original inputs array */
  inputIdx: number;
  /** Placement tag (e.g. 'right', 'right-top', 'left', 'top', 'bot-left') */
  tag: string;
  /** Whether the label is in the margin zone (vs inside page) */
  inMargin: boolean;
}

/** Result from the placement algorithm */
export interface LabelPlacementResult {
  /** All placed labels */
  labels: PlacedLabel[];
  /** Uniform X position of the right label column's left edge (for connector alignment) */
  rightColumnX: number;
  /** Uniform X position of the left label column's right edge (for connector alignment) */
  leftColumnX: number;
}

// ─── Internal types ─────────────────────────────────────────────────────────────

interface InternalAnnotation {
  inputIdx: number;
  x: number;
  y: number;
  w: number;
  h: number;
  tag: string;
  inMargin: boolean;
  side: PlacerSide;
}

interface Candidate {
  x: number;
  y: number;
  w: number;
  h: number;
  tag: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Arrow size constants (mirrored from leader-router.ts) */
const ARROW_MIN_PL = 10;
const ARROW_MAX_PL = 24;
const ARROW_RATIO_PL = 0.15;
const ARROW_GAP_FACTOR = 1.1;
const MIN_GAP_FLOOR = 8;

/** Default placement constants */
const DEFAULT_INITIAL_LABEL_CHARS = 30;
const DEFAULT_INITIAL_LABEL_ROWS = 3;
const DEFAULT_MAX_RIGHT_LABEL_CHARS = 80;
const DEFAULT_CHAR_WIDTH_FACTOR = 0.55;
const DEFAULT_MOVE_INSIDE_MIN_IMPROVEMENT = 0.15;

/** Side priority for overflow (Step 2): left → top → bottom */
const SIDE_PRIORITY: PlacerSide[] = [PlacementSide.LEFT, PlacementSide.TOP, PlacementSide.BOTTOM];

// ─── Geometry helpers ───────────────────────────────────────────────────────────

/** Check if two rectangles overlap (AABB intersection test) */
function rectsOverlap(a: PlacerRect, b: PlacerRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
    a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Check if rectangle overlaps any rectangle in a list */
function hitsAny(r: PlacerRect, list: PlacerRect[]): boolean {
  for (let i = 0; i < list.length; i++) {
    if (rectsOverlap(r, list[i])) return true;
  }
  return false;
}

/** Segment-vs-AABB intersection test (Liang-Barsky) */
function segmentCrossesRect(
  x1: number, y1: number, x2: number, y2: number, rect: PlacerRect
): boolean {
  let tmin = 0, tmax = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const edges: [number, number][] = [
    [-dx, x1 - rect.x], [dx, rect.x + rect.w - x1],
    [-dy, y1 - rect.y], [dy, rect.y + rect.h - y1],
  ];
  for (let i = 0; i < edges.length; i++) {
    const p = edges[i][0], q = edges[i][1];
    if (Math.abs(p) < 1e-10) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) { if (t > tmin) tmin = t; }
      else { if (t < tmax) tmax = t; }
      if (tmin > tmax) return false;
    }
  }
  return tmin < tmax - 0.001;
}

/** Count how many highlights a leader line crosses (skipping own highlight) */
function countCrossings(
  x1: number, y1: number, x2: number, y2: number,
  highlights: PlacerRect[], skipIdx: number
): number {
  let count = 0;
  for (let i = 0; i < highlights.length; i++) {
    if (i === skipIdx) continue;
    if (segmentCrossesRect(x1, y1, x2, y2, highlights[i])) count++;
  }
  return count;
}

/** Euclidean distance between centers of two rectangles */
function centerDist(a: PlacerRect, b: PlacerRect): number {
  const dx = (a.x + a.w / 2) - (b.x + b.w / 2);
  const dy = (a.y + a.h / 2) - (b.y + b.h / 2);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Check if a candidate satisfies the minimum arrow edge gap */
function meetsArrowGap(cand: PlacerRect, hl: PlacerRect): boolean {
  const cx = cand.x + cand.w / 2, cy = cand.y + cand.h / 2;
  const hcx = hl.x + hl.w / 2, hcy = hl.y + hl.h / 2;
  const leaderLen = Math.hypot(cx - hcx, cy - hcy);
  const arrowSz = Math.max(ARROW_MIN_PL, Math.min(ARROW_MAX_PL, leaderLen * ARROW_RATIO_PL));
  const minEdgeGap = Math.max(MIN_GAP_FLOOR, arrowSz * ARROW_GAP_FACTOR);
  const dx = Math.max(0, cand.x - (hl.x + hl.w), hl.x - (cand.x + cand.w));
  const dy = Math.max(0, cand.y - (hl.y + hl.h), hl.y - (cand.y + cand.h));
  return Math.max(dx, dy) >= minEdgeGap;
}

/** Leader line from highlight center to candidate center crosses any other highlight */
function leaderCrossesHighlight(cand: PlacerRect, hlIdx: number, highlights: PlacerRect[]): boolean {
  const hl = highlights[hlIdx];
  const cx = cand.x + cand.w / 2, cy = cand.y + cand.h / 2;
  const hcx = hl.x + hl.w / 2, hcy = hl.y + hl.h / 2;
  return countCrossings(hcx, hcy, cx, cy, highlights, hlIdx) > 0;
}

/** Validate a candidate: fits page bounds, no overlap with blocked, meets arrow gap */
function isValidCandidate(
  cand: Candidate, blocked: PlacerRect[], highlights: PlacerRect[],
  hlIdx: number, pageW: number, pageH: number,
  allowOverflow: boolean, allowRightOverflow = false
): boolean {
  const r: PlacerRect = { x: cand.x, y: cand.y, w: cand.w, h: cand.h };
  if (r.x < 0 || r.y < 0) return false;
  if (!allowRightOverflow && r.x + r.w > pageW) return false;
  if (!allowOverflow && r.y + r.h > pageH) return false;
  if (hitsAny(r, blocked)) return false;
  if (!meetsArrowGap(r, highlights[hlIdx])) return false;
  return true;
}

/** Pick the best candidate: filter out highlight-crossing leaders, then pick min distance */
function pickBest(
  candidates: Candidate[], blocked: PlacerRect[], highlights: PlacerRect[],
  hlIdx: number, pageW: number, pageH: number,
  allowOverflow: boolean, allowRightOverflow = false, maxDist = Infinity
): Candidate | null {
  const hl = highlights[hlIdx];
  let best: Candidate | null = null;
  let bestDist = Infinity;

  for (const c of candidates) {
    if (!isValidCandidate(c, blocked, highlights, hlIdx, pageW, pageH, allowOverflow, allowRightOverflow)) continue;
    const r: PlacerRect = { x: c.x, y: c.y, w: c.w, h: c.h };
    const crosses = leaderCrossesHighlight(r, hlIdx, highlights);
    if (crosses && !allowRightOverflow) continue;
    const d = centerDist(hl, r) + (crosses ? 300 : 0);
    if (d > maxDist) continue;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

// ─── Candidate generators ───────────────────────────────────────────────────────

/**
 * Generate inside-page candidates: try to fit annotation entirely within page bounds.
 * Tries all 4 directions (right, bottom, left, top) with blocker-pushed Y positions.
 */
function generateInsideCandidates(
  hl: PlacerRect, pad: number, pageW: number, pageH: number,
  annotW: number, annotH: number, blocked: PlacerRect[]
): Candidate[] {
  const candidates: Candidate[] = [];

  // Right of highlight
  {
    const x = hl.x + hl.w + pad;
    if (x + annotW <= pageW) {
      candidates.push({ x, y: hl.y + hl.h / 2 - annotH / 2, w: annotW, h: annotH, tag: 'right' });
      candidates.push({ x, y: hl.y, w: annotW, h: annotH, tag: 'right-top' });
      candidates.push({ x, y: hl.y + hl.h - annotH, w: annotW, h: annotH, tag: 'right-bot' });
      for (const b of blocked) {
        if (b.x + b.w <= x || b.x >= x + annotW) continue;
        candidates.push({ x, y: b.y + b.h + pad, w: annotW, h: annotH, tag: 'right' });
        if (b.y - annotH - pad >= 0) candidates.push({ x, y: b.y - annotH - pad, w: annotW, h: annotH, tag: 'right' });
      }
    }
  }

  // Bottom of highlight
  {
    const y = hl.y + hl.h + pad;
    if (y + annotH <= pageH) {
      candidates.push({ x: hl.x, y, w: annotW, h: annotH, tag: 'bot-left' });
      const xCenter = hl.x + hl.w / 2 - annotW / 2;
      if (xCenter >= 0 && xCenter + annotW <= pageW) {
        candidates.push({ x: xCenter, y, w: annotW, h: annotH, tag: 'bot-left' });
      }
      for (const b of blocked) {
        if (b.y + b.h <= y || b.y >= y + annotH) continue;
        const yPushed = b.y + b.h + pad;
        if (yPushed + annotH <= pageH) {
          candidates.push({ x: hl.x, y: yPushed, w: annotW, h: annotH, tag: 'bot-left' });
        }
      }
    }
  }

  // Left of highlight
  {
    const x = hl.x - annotW - pad;
    if (x >= 0) {
      candidates.push({ x, y: hl.y + hl.h / 2 - annotH / 2, w: annotW, h: annotH, tag: 'left' });
      candidates.push({ x, y: hl.y, w: annotW, h: annotH, tag: 'left' });
      candidates.push({ x, y: hl.y + hl.h - annotH, w: annotW, h: annotH, tag: 'left' });
      for (const b of blocked) {
        if (b.x + b.w <= x || b.x >= x + annotW) continue;
        candidates.push({ x, y: b.y + b.h + pad, w: annotW, h: annotH, tag: 'left' });
        if (b.y - annotH - pad >= 0) candidates.push({ x, y: b.y - annotH - pad, w: annotW, h: annotH, tag: 'left' });
      }
    }
  }

  // Top of highlight
  {
    const y = hl.y - annotH - pad;
    if (y >= 0) {
      candidates.push({ x: hl.x, y, w: annotW, h: annotH, tag: 'top' });
      const xCenter = hl.x + hl.w / 2 - annotW / 2;
      if (xCenter >= 0 && xCenter + annotW <= pageW) {
        candidates.push({ x: xCenter, y, w: annotW, h: annotH, tag: 'top' });
      }
      for (const b of blocked) {
        if (b.y + b.h <= y || b.y >= y + annotH) continue;
        const yPushed = b.y - annotH - pad;
        if (yPushed >= 0) {
          candidates.push({ x: hl.x, y: yPushed, w: annotW, h: annotH, tag: 'top' });
        }
      }
    }
  }

  return candidates;
}

// ─── Sort helpers ───────────────────────────────────────────────────────────────

/** Sort annotation indices by their highlight position, optimized for a given margin side */
function hlSortForSide(
  side: PlacerSide,
  annotations: InternalAnnotation[],
  highlights: PlacerRect[],
  band: number,
  xBand: number,
): (a: number, b: number) => number {
  if (side === PlacementSide.RIGHT || side === PlacementSide.LEFT) {
    return (a, b) => {
      const hlA = highlights[annotations[a].inputIdx];
      const hlB = highlights[annotations[b].inputIdx];
      const dy = hlA.y - hlB.y;
      if (Math.abs(dy) < band) {
        const xOverlap = Math.min(hlA.x + hlA.w, hlB.x + hlB.w) - Math.max(hlA.x, hlB.x);
        if (xOverlap > 0) return dy;
        const xEdgeDiff = Math.abs((hlB.x + hlB.w) - (hlA.x + hlA.w));
        if (xEdgeDiff < xBand) return dy;
        return side === PlacementSide.RIGHT
          ? (hlB.x + hlB.w) - (hlA.x + hlA.w)  // rightmost first
          : hlA.x - hlB.x;                       // leftmost first
      }
      return dy;
    };
  }
  // top or bottom
  return (a, b) => {
    const hlA = highlights[annotations[a].inputIdx];
    const hlB = highlights[annotations[b].inputIdx];
    const dx = hlA.x - hlB.x;
    if (Math.abs(dx) < band) {
      const yOverlap = Math.min(hlA.y + hlA.h, hlB.y + hlB.h) - Math.max(hlA.y, hlB.y);
      if (yOverlap > 0) return dx;
      const yEdgeDiff = Math.abs((hlB.y + hlB.h) - (hlA.y + hlA.h));
      if (yEdgeDiff < band) return dx;
      return side === PlacementSide.TOP
        ? hlA.y - hlB.y
        : (hlB.y + hlB.h) - (hlA.y + hlA.h);
    }
    return dx;
  };
}

// ─── Busy-area-aware column packing ─────────────────────────────────────────────

/** Advance Y to skip past any overlapping rects in the busy list */
function skipBusyY(y: number, x: number, w: number, h: number, busy: PlacerRect[], pad: number): number {
  let iters = 0;
  while (iters++ < 200) {
    const cand: PlacerRect = { x, y, w, h };
    let advanced = false;
    for (const b of busy) {
      if (rectsOverlap(cand, b)) {
        y = b.y + b.h + pad;
        advanced = true;
        break;
      }
    }
    if (!advanced) break;
  }
  return y;
}

// ─── Main entry point ───────────────────────────────────────────────────────────

/**
 * Place labels for all highlights using the margin-first 4-step algorithm.
 *
 * @param inputs - Array of label inputs to place
 * @param options - Configuration options
 * @returns Placement results with labels array and column X positions
 */
export function placeLabels(
  inputs: LabelPlacementInput[],
  options: LabelPlacementOptions
): LabelPlacementResult {
  const {
    pageW,
    pageH,
    gap: gapOpt = 8,
    rightMarginMaxHeight,
    busyAreas: busyAreasOpt = [],
    measureTextHeight,
    labelFontSize: labelFontSz = 12,
    charWidthFactor = DEFAULT_CHAR_WIDTH_FACTOR,
    labelPadding: labelPad = 5,
    initialLabelChars = DEFAULT_INITIAL_LABEL_CHARS,
    maxRightLabelChars = DEFAULT_MAX_RIGHT_LABEL_CHARS,
    minLabelHeight: annotMinH = 52,
    minLabelWidth: annotMinW = 80,
  } = options;

  const maxRightH = rightMarginMaxHeight ?? pageH * (REVDOKU_SIDE_MAX_FILL[PlacementSide.RIGHT] ?? 1.3);
  const pad = Math.max(gapOpt, Math.ceil(ARROW_MIN_PL * ARROW_GAP_FACTOR));

  // Char-based sizing
  const charW = labelFontSz * charWidthFactor;
  const initLabelW = initialLabelChars * charW + 2 * labelPad;
  const lineH = labelFontSz * (16 / 12); // line height ratio
  const initLabelH = DEFAULT_INITIAL_LABEL_ROWS * lineH + 2 * labelPad;
  const maxRightW = maxRightLabelChars * charW + 2 * labelPad;

  // Build highlight and busy rects
  const highlights: PlacerRect[] = inputs.map(inp => ({ ...inp.highlight }));
  const busyAreas: PlacerRect[] = busyAreasOpt.map(r => ({ ...r }));

  // Build blocked list from busy areas + highlights
  const blocked: PlacerRect[] = busyAreas.concat(highlights).map(r => ({
    x: r.x, y: r.y, w: r.w, h: r.h,
  }));

  // Sort by Y (primary), rightmost-first within Y band (secondary)
  const Y_BAND = annotMinH * 2;
  const X_BAND = annotMinW * 2;
  const sortedIndices = highlights
    .map((_, i) => i)
    .sort((a, b) => {
      const dy = highlights[a].y - highlights[b].y;
      if (Math.abs(dy) < Y_BAND) {
        const xOverlap = Math.min(highlights[a].x + highlights[a].w, highlights[b].x + highlights[b].w)
                        - Math.max(highlights[a].x, highlights[b].x);
        if (xOverlap > 0) return dy;
        const xEdgeDiff = Math.abs((highlights[b].x + highlights[b].w) - (highlights[a].x + highlights[a].w));
        if (xEdgeDiff < X_BAND) return dy;
        return (highlights[b].x + highlights[b].w) - (highlights[a].x + highlights[a].w);
      }
      return dy;
    });

  // Text height wrapper using inputIdx
  const textHeightFn = (inputIdx: number, width: number): number => {
    return measureTextHeight(inputs[inputIdx].text, width);
  };

  const annotations: InternalAnnotation[] = [];

  // ── Step 1: Pack all labels into right margin (uniform size) ──
  let rightNextY = 0;
  const overflowAnnIndices: number[] = [];

  for (const inputIdx of sortedIndices) {
    rightNextY = skipBusyY(rightNextY, pageW + pad, initLabelW, initLabelH, busyAreas, pad);
    if (rightNextY + initLabelH <= maxRightH) {
      annotations.push({
        inputIdx, x: pageW + pad, y: rightNextY,
        w: initLabelW, h: initLabelH,
        tag: 'right', inMargin: true, side: PlacementSide.RIGHT,
      });
      blocked.push({ x: pageW + pad, y: rightNextY, w: initLabelW, h: initLabelH });
      rightNextY += initLabelH + pad;
    } else {
      const annIdx = annotations.length;
      annotations.push({
        inputIdx, x: 0, y: 0,
        w: initLabelW, h: initLabelH,
        tag: 'right', inMargin: true, side: PlacementSide.RIGHT,
      });
      overflowAnnIndices.push(annIdx);
    }
  }

  // ── Step 2: Place overflow labels on other sides ──
  let topNextX = 0;
  let bottomNextX = 0;
  let leftNextY = 0;

  for (const annIdx of overflowAnnIndices) {
    const ann = annotations[annIdx];
    const hl = highlights[ann.inputIdx];
    let placed = false;

    for (const side of SIDE_PRIORITY) {
      if (side === PlacementSide.TOP) {
        const idealX = Math.max(0, hl.x + hl.w / 2 - initLabelW / 2);
        const x = Math.max(topNextX, idealX);
        if (x + initLabelW <= pageW + initLabelW * 0.5) {
          ann.x = x;
          ann.y = -(initLabelH + pad);
          ann.tag = 'top';
          ann.side = PlacementSide.TOP;
          ann.inMargin = true;
          topNextX = x + initLabelW + pad;
          blocked.push({ x: ann.x, y: ann.y, w: ann.w, h: ann.h });
          placed = true;
          break;
        }
      } else if (side === PlacementSide.BOTTOM) {
        const idealX = Math.max(0, hl.x + hl.w / 2 - initLabelW / 2);
        const x = Math.max(bottomNextX, idealX);
        if (x + initLabelW <= pageW + initLabelW * 0.5) {
          ann.x = x;
          ann.y = pageH + pad;
          ann.tag = 'bot-left';
          ann.side = PlacementSide.BOTTOM;
          ann.inMargin = true;
          bottomNextX = x + initLabelW + pad;
          blocked.push({ x: ann.x, y: ann.y, w: ann.w, h: ann.h });
          placed = true;
          break;
        }
      } else if (side === PlacementSide.LEFT) {
        const idealY = Math.max(0, hl.y + hl.h / 2 - initLabelH / 2);
        const y = skipBusyY(Math.max(leftNextY, idealY), -(initLabelW + pad), initLabelW, initLabelH, busyAreas, pad);
        if (y + initLabelH <= pageH + initLabelH * 0.5) {
          ann.x = -(initLabelW + pad);
          ann.y = y;
          ann.tag = 'left';
          ann.side = PlacementSide.LEFT;
          ann.inMargin = true;
          leftNextY = y + initLabelH + pad;
          blocked.push({ x: ann.x, y: ann.y, w: ann.w, h: ann.h });
          placed = true;
          break;
        }
      }
    }

    // Last resort: extend right margin beyond max height
    if (!placed) {
      ann.x = pageW + pad;
      ann.y = rightNextY;
      ann.tag = 'right';
      ann.side = PlacementSide.RIGHT;
      ann.inMargin = true;
      blocked.push({ x: ann.x, y: ann.y, w: ann.w, h: ann.h });
      rightNextY += initLabelH + pad;
    }
  }

  // ── Step 3: Resize labels to actual text dimensions ──
  type MarginSideKey = PlacementSide.RIGHT | PlacementSide.TOP | PlacementSide.BOTTOM | PlacementSide.LEFT;
  const bySide: Record<MarginSideKey, number[]> = {
    [PlacementSide.RIGHT]: [], [PlacementSide.TOP]: [], [PlacementSide.BOTTOM]: [], [PlacementSide.LEFT]: [],
  };
  for (let i = 0; i < annotations.length; i++) {
    const s = (annotations[i].side === PlacementSide.INSIDE ? 'right' : annotations[i].side) as MarginSideKey;
    if (bySide[s]) bySide[s].push(i);
  }

  // Right column: vertical-first — prefer narrow+tall, widen only if column overflows
  {
    const group = bySide[PlacementSide.RIGHT];
    group.sort(hlSortForSide(PlacementSide.RIGHT, annotations, highlights, Y_BAND, X_BAND));

    // Compute total busy area height in right margin zone
    let busyMarginH = 0;
    for (const b of busyAreas) {
      if (b.x >= pageW) busyMarginH += b.h + pad;
    }

    // Column height at a given uniform label width
    const columnHeightAt = (w: number): number => {
      let total = busyMarginH;
      for (const ai of group) {
        total += Math.max(annotMinH, textHeightFn(annotations[ai].inputIdx, w)) + pad;
      }
      return total;
    };

    let colWidth = initLabelW;

    // Binary search for min width that fits in maxRightH
    if (columnHeightAt(colWidth) > maxRightH) {
      let lo = initLabelW, hi = maxRightW;
      for (let iter = 0; iter < 15; iter++) {
        const mid = (lo + hi) / 2;
        if (columnHeightAt(mid) > maxRightH) lo = mid; else hi = mid;
      }
      colWidth = Math.min(Math.ceil(hi), maxRightW);
    }

    // Apply uniform width and actual text heights
    for (const ai of group) {
      annotations[ai].w = colWidth;
      annotations[ai].h = Math.max(annotMinH, textHeightFn(annotations[ai].inputIdx, colWidth));
    }

    // Repack right column top-to-bottom, skipping busy areas
    let nextY = 0;
    for (const ai of group) {
      nextY = skipBusyY(nextY, pageW + pad, annotations[ai].w, annotations[ai].h, busyAreas, pad);
      annotations[ai].y = nextY;
      nextY += annotations[ai].h + pad;
    }

    // Move right-column labels that overflow beyond maxRightH to left column
    for (let i = group.length - 1; i >= 0; i--) {
      const ai = group[i];
      if (annotations[ai].y + annotations[ai].h > maxRightH) {
        bySide[PlacementSide.RIGHT].splice(bySide[PlacementSide.RIGHT].indexOf(ai), 1);
        bySide[PlacementSide.LEFT].push(ai);
        annotations[ai].side = PlacementSide.LEFT;
        annotations[ai].x = -(annotations[ai].w + pad);
        annotations[ai].inMargin = true;
      }
    }
  }

  // Top row: adjust height, repack left-to-right with uniform height
  {
    const group = bySide[PlacementSide.TOP];
    group.sort(hlSortForSide(PlacementSide.TOP, annotations, highlights, Y_BAND, X_BAND));

    for (const ai of group) {
      annotations[ai].h = Math.max(annotMinH, textHeightFn(annotations[ai].inputIdx, annotations[ai].w));
    }

    let maxH = 0;
    for (const ai of group) maxH = Math.max(maxH, annotations[ai].h);

    let nextX = 0;
    for (const ai of group) {
      annotations[ai].x = nextX;
      annotations[ai].y = -(maxH + pad);
      annotations[ai].h = maxH;
      nextX += annotations[ai].w + pad;
    }
  }

  // Bottom row: adjust height, repack left-to-right with uniform height
  {
    const group = bySide[PlacementSide.BOTTOM];
    group.sort(hlSortForSide(PlacementSide.BOTTOM, annotations, highlights, Y_BAND, X_BAND));

    for (const ai of group) {
      annotations[ai].h = Math.max(annotMinH, textHeightFn(annotations[ai].inputIdx, annotations[ai].w));
    }

    let maxH = 0;
    for (const ai of group) maxH = Math.max(maxH, annotations[ai].h);

    let nextX = 0;
    for (const ai of group) {
      annotations[ai].x = nextX;
      annotations[ai].y = pageH + pad;
      annotations[ai].h = maxH;
      nextX += annotations[ai].w + pad;
    }
  }

  // Left column: adjust height, repack top-to-bottom, skipping busy areas
  {
    const group = bySide[PlacementSide.LEFT];
    group.sort(hlSortForSide(PlacementSide.LEFT, annotations, highlights, Y_BAND, X_BAND));

    for (const ai of group) {
      annotations[ai].h = Math.max(annotMinH, textHeightFn(annotations[ai].inputIdx, annotations[ai].w));
    }

    let nextY = 0;
    for (const ai of group) {
      nextY = skipBusyY(nextY, -(annotations[ai].w + pad), annotations[ai].w, annotations[ai].h, busyAreas, pad);
      annotations[ai].x = -(annotations[ai].w + pad);
      annotations[ai].y = nextY;
      nextY += annotations[ai].h + pad;
    }
  }

  // Compute side extents after Step 3
  const sideExtent: Record<MarginSideKey, number> = {
    [PlacementSide.RIGHT]: 0, [PlacementSide.LEFT]: 0, [PlacementSide.TOP]: 0, [PlacementSide.BOTTOM]: 0,
  };
  for (const ai of bySide[PlacementSide.RIGHT]) {
    const bottom = annotations[ai].y + annotations[ai].h + pad;
    if (bottom > sideExtent[PlacementSide.RIGHT]) sideExtent[PlacementSide.RIGHT] = bottom;
  }
  for (const ai of bySide[PlacementSide.LEFT]) {
    const bottom = annotations[ai].y + annotations[ai].h + pad;
    if (bottom > sideExtent[PlacementSide.LEFT]) sideExtent[PlacementSide.LEFT] = bottom;
  }
  for (const ai of bySide[PlacementSide.TOP]) {
    const right = annotations[ai].x + annotations[ai].w + pad;
    if (right > sideExtent[PlacementSide.TOP]) sideExtent[PlacementSide.TOP] = right;
  }
  for (const ai of bySide[PlacementSide.BOTTOM]) {
    const right = annotations[ai].x + annotations[ai].w + pad;
    if (right > sideExtent[PlacementSide.BOTTOM]) sideExtent[PlacementSide.BOTTOM] = right;
  }

  // ── Step 4: Move labels inside free page space if significantly closer ──
  const baseBlocked: PlacerRect[] = busyAreas.concat(highlights).map(r => ({
    x: r.x, y: r.y, w: r.w, h: r.h,
  }));

  const moveOrder: MarginSideKey[] = [PlacementSide.LEFT, PlacementSide.TOP, PlacementSide.RIGHT, PlacementSide.BOTTOM];
  const movedInside = new Set<number>();

  for (const side of moveOrder) {
    // Only move right-column labels inside if the column overflows pageH
    if (side === PlacementSide.RIGHT && sideExtent[PlacementSide.RIGHT] <= pageH) continue;

    for (const ai of bySide[side]) {
      const ann = annotations[ai];
      const hl = highlights[ann.inputIdx];
      const currentDist = centerDist(hl, { x: ann.x, y: ann.y, w: ann.w, h: ann.h });

      // Build blocked list: base + all other annotations (excluding current)
      const checkBlocked: PlacerRect[] = [...baseBlocked];
      for (let j = 0; j < annotations.length; j++) {
        if (j === ai) continue;
        checkBlocked.push({ x: annotations[j].x, y: annotations[j].y, w: annotations[j].w, h: annotations[j].h });
      }

      const candidates = generateInsideCandidates(hl, pad, pageW, pageH, ann.w, ann.h, checkBlocked);
      const maxAcceptDist = currentDist * (1 - DEFAULT_MOVE_INSIDE_MIN_IMPROVEMENT);
      const best = pickBest(candidates, checkBlocked, highlights, ann.inputIdx, pageW, pageH, false, false, maxAcceptDist);

      if (best) {
        ann.x = best.x;
        ann.y = best.y;
        ann.tag = best.tag;
        ann.inMargin = false;
        ann.side = PlacementSide.INSIDE;
        movedInside.add(ai);
      }
    }
  }

  // Re-compact margins to close gaps left by moved labels
  for (const side of [PlacementSide.RIGHT, PlacementSide.LEFT] as MarginSideKey[]) {
    const remaining = bySide[side].filter(ai => !movedInside.has(ai));
    if (remaining.length === 0) continue;
    remaining.sort(hlSortForSide(side, annotations, highlights, Y_BAND, X_BAND));
    let nextY = 0;
    for (const ai of remaining) {
      const x = (side === PlacementSide.RIGHT) ? annotations[ai].x : -(annotations[ai].w + pad);
      nextY = skipBusyY(nextY, x, annotations[ai].w, annotations[ai].h, busyAreas, pad);
      annotations[ai].y = nextY;
      if (side === PlacementSide.LEFT) annotations[ai].x = x;
      nextY += annotations[ai].h + pad;
    }
  }
  for (const side of [PlacementSide.TOP, PlacementSide.BOTTOM] as MarginSideKey[]) {
    const remaining = bySide[side].filter(ai => !movedInside.has(ai));
    if (remaining.length === 0) continue;
    remaining.sort(hlSortForSide(side, annotations, highlights, Y_BAND, X_BAND));
    let nextX = 0;
    for (const ai of remaining) {
      annotations[ai].x = nextX;
      if (side === PlacementSide.TOP) annotations[ai].y = -(annotations[ai].h + pad);
      nextX += annotations[ai].w + pad;
    }
  }

  // Sort by input index for stable output
  annotations.sort((a, b) => a.inputIdx - b.inputIdx);

  // Compute uniform column X positions for connector alignment
  const rightColumnX = pageW + pad;
  // Left column: find the right edge of left-side labels (they're positioned at negative X)
  let leftColumnRightEdge = 0;
  for (const ann of annotations) {
    if (ann.side === PlacementSide.LEFT) {
      const rightEdge = ann.x + ann.w;
      if (leftColumnRightEdge === 0 || rightEdge < leftColumnRightEdge) {
        leftColumnRightEdge = rightEdge;
      }
    }
  }
  // If no left labels, default to -(initLabelW + pad) + initLabelW = -pad
  const leftColumnX = leftColumnRightEdge !== 0 ? leftColumnRightEdge : -pad;

  // Map to output format
  const labels: PlacedLabel[] = annotations.map(ann => ({
    id: inputs[ann.inputIdx].id,
    side: ann.side,
    box: { x: ann.x, y: ann.y, w: ann.w, h: ann.h },
    inputIdx: ann.inputIdx,
    tag: ann.tag,
    inMargin: ann.inMargin,
  }));

  return { labels, rightColumnX, leftColumnX };
}
