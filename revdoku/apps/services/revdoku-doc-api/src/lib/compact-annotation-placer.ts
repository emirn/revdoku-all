/**
 * Compact Annotation Placer — per-highlight 4-phase placement (revdoku-doc-api-only)
 *
 * Used for pill-sized badges that are placed close to their highlights.
 * Algorithm: For each highlight, try placement in order:
 *   Phase A: Inside page (all 4 directions with blocker-pushed Y)
 *   Phase B: Right side (scan Y from 0 downward, allow right overflow)
 *   Phase C: Bottom (full page width)
 *   Phase D: Overflow (extend canvas below page bounds)
 *
 * Extracted from initial-labels-placer.ts compact mode path.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Internal rectangle type used by the placer */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A single annotation result from the compact placement algorithm */
export interface AnnotationResult {
  /** Index into the original highlights array */
  hlIdx: number;
  /** Position and size of the annotation box */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Placement tag indicating relative position to highlight */
  tag: string;
  /** Whether this annotation was placed in the margin */
  inMargin: boolean;
}

interface Candidate {
  x: number;
  y: number;
  w: number;
  h: number;
  tag: string;
}

export interface CompactPlacerOptions {
  pageW: number;
  pageH: number;
  annotMinW: number;
  annotMinH: number;
  gap: number;
}

// ─── Arrow-gap constants (mirrored from leader-router.ts) ───────────────────────
const ARROW_RATIO_PL = 0.15;
const ARROW_MIN_PL = 10;
const ARROW_MAX_PL = 24;
const ARROW_GAP_FACTOR = 1.1;
const MIN_GAP_FLOOR = 8;

// ─── Geometry helpers ──────────────────────────────────────────────────────────

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
    a.y < b.y + b.h && a.y + a.h > b.y;
}

function hitsAny(r: Rect, list: Rect[]): boolean {
  for (let i = 0; i < list.length; i++) {
    if (rectsOverlap(r, list[i])) return true;
  }
  return false;
}

function segmentCrossesRect(
  x1: number, y1: number, x2: number, y2: number, rect: Rect
): boolean {
  let tmin = 0, tmax = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const edges: [number, number][] = [
    [-dx, x1 - rect.x],
    [dx, rect.x + rect.w - x1],
    [-dy, y1 - rect.y],
    [dy, rect.y + rect.h - y1],
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

function countCrossings(
  x1: number, y1: number, x2: number, y2: number,
  highlights: Rect[], skipIdx: number
): number {
  let count = 0;
  for (let i = 0; i < highlights.length; i++) {
    if (i === skipIdx) continue;
    if (segmentCrossesRect(x1, y1, x2, y2, highlights[i])) count++;
  }
  return count;
}

function centerDist(a: Rect, b: Rect): number {
  const dx = (a.x + a.w / 2) - (b.x + b.w / 2);
  const dy = (a.y + a.h / 2) - (b.y + b.h / 2);
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Candidate validation ───────────────────────────────────────────────────────

function meetsArrowGap(cand: Rect, hl: Rect): boolean {
  const cx = cand.x + cand.w / 2, cy = cand.y + cand.h / 2;
  const hcx = hl.x + hl.w / 2, hcy = hl.y + hl.h / 2;
  const leaderLen = Math.hypot(cx - hcx, cy - hcy);
  const arrowSz = Math.max(ARROW_MIN_PL, Math.min(ARROW_MAX_PL, leaderLen * ARROW_RATIO_PL));
  const minEdgeGap = Math.max(MIN_GAP_FLOOR, arrowSz * ARROW_GAP_FACTOR);
  const dx = Math.max(0, cand.x - (hl.x + hl.w), hl.x - (cand.x + cand.w));
  const dy = Math.max(0, cand.y - (hl.y + hl.h), hl.y - (cand.y + cand.h));
  return Math.max(dx, dy) >= minEdgeGap;
}

function leaderCrossesHighlight(cand: Rect, hlIdx: number, highlights: Rect[]): boolean {
  const hl = highlights[hlIdx];
  const cx = cand.x + cand.w / 2, cy = cand.y + cand.h / 2;
  const hcx = hl.x + hl.w / 2, hcy = hl.y + hl.h / 2;
  return countCrossings(hcx, hcy, cx, cy, highlights, hlIdx) > 0;
}

function isValidCandidate(
  cand: Candidate, blocked: Rect[], highlights: Rect[],
  hlIdx: number, pageW: number, pageH: number,
  allowOverflow: boolean, allowRightOverflow = false
): boolean {
  const r: Rect = { x: cand.x, y: cand.y, w: cand.w, h: cand.h };
  if (r.x < 0 || r.y < 0) return false;
  if (!allowRightOverflow && r.x + r.w > pageW) return false;
  if (!allowOverflow && r.y + r.h > pageH) return false;
  if (hitsAny(r, blocked)) return false;
  if (!meetsArrowGap(r, highlights[hlIdx])) return false;
  return true;
}

function pickBest(
  candidates: Candidate[], blocked: Rect[], highlights: Rect[],
  hlIdx: number, pageW: number, pageH: number,
  allowOverflow: boolean, allowRightOverflow = false, maxDist = Infinity
): Candidate | null {
  const hl = highlights[hlIdx];
  let best: Candidate | null = null;
  let bestDist = Infinity;

  for (const c of candidates) {
    if (!isValidCandidate(c, blocked, highlights, hlIdx, pageW, pageH, allowOverflow, allowRightOverflow)) continue;
    const r: Rect = { x: c.x, y: c.y, w: c.w, h: c.h };
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

// ─── Phase candidate generators ─────────────────────────────────────────────────

function generateInsideCandidates(
  hl: Rect, pad: number, pageW: number, pageH: number,
  annotW: number, annotH: number, blocked: Rect[]
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

function generateRightCandidates(
  hl: Rect, pad: number, pageW: number, pageH: number,
  annotW: number, annotH: number, blocked: Rect[]
): Candidate[] {
  const candidates: Candidate[] = [];
  const xPositions = [hl.x + hl.w + pad];
  const xMargin = pageW + pad;
  if (xMargin > xPositions[0] + pad) xPositions.push(xMargin);

  for (const x of xPositions) {
    const step = annotH + pad;
    for (let y = 0; y <= pageH; y += step) {
      candidates.push({ x, y, w: annotW, h: annotH, tag: 'right' });
      if (candidates.length >= 80) break;
    }
    candidates.push({ x, y: hl.y, w: annotW, h: annotH, tag: 'right-top' });
    candidates.push({ x, y: hl.y + hl.h / 2 - annotH / 2, w: annotW, h: annotH, tag: 'right' });
    candidates.push({ x, y: hl.y + hl.h - annotH, w: annotW, h: annotH, tag: 'right-bot' });
    for (const b of blocked) {
      if (b.x + b.w <= x || b.x >= x + annotW) continue;
      candidates.push({ x, y: b.y + b.h + pad, w: annotW, h: annotH, tag: 'right' });
      if (b.y - annotH - pad >= 0) candidates.push({ x, y: b.y - annotH - pad, w: annotW, h: annotH, tag: 'right' });
    }
  }
  return candidates;
}

function generateBottomCandidates(
  hl: Rect, pad: number, pageW: number,
  annotW: number, annotH: number, blocked: Rect[]
): Candidate[] {
  const w = Math.min(annotW, pageW);
  const baseY = hl.y + hl.h + pad;

  const candidates: Candidate[] = [
    { x: 0, y: baseY, w, h: annotH, tag: 'bot-left' },
  ];

  for (const b of blocked) {
    if (b.y + b.h > baseY - 1 && b.x < w) {
      const yBelow = b.y + b.h + pad;
      candidates.push({ x: 0, y: yBelow, w, h: annotH, tag: 'bot-left' });
    }
  }

  return candidates;
}

function generateOverflowCandidates(
  pageW: number, pageH: number, pad: number,
  annotW: number, annotH: number, blocked: Rect[]
): Candidate[] {
  const w = Math.min(annotW, pageW);

  let maxBlockedY = pageH;
  for (const b of blocked) {
    const by = b.y + b.h;
    if (by > maxBlockedY) maxBlockedY = by;
  }

  const y = maxBlockedY + pad;
  return [{ x: 0, y, w, h: annotH, tag: 'overflow' }];
}

// ─── Main entry point ──────────────────────────────────────────────────────────

/**
 * Place compact annotations for all highlights using per-highlight 4-phase placement.
 *
 * @param highlights - Array of rectangles to annotate
 * @param busyAreas - Array of rectangles to avoid
 * @param options - Page dimensions and annotation sizing
 * @returns Placement results with annotations array
 */
export function placeCompactAnnotations(
  highlights: Rect[],
  busyAreas: Rect[],
  options: CompactPlacerOptions,
): { annotations: AnnotationResult[] } {
  const { pageW, pageH, annotMinW, annotMinH, gap } = options;

  const annotations: AnnotationResult[] = [];
  const pad = Math.max(gap, Math.ceil(ARROW_MIN_PL * ARROW_GAP_FACTOR));

  const blocked: Rect[] = busyAreas.concat(highlights).map(r => ({
    x: r.x, y: r.y, w: r.w, h: r.h,
  }));

  // Sort highlights by Y (primary), rightmost-first within Y band (secondary)
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

  for (const hlIdx of sortedIndices) {
    const hl = highlights[hlIdx];
    let placed = false;
    const baseH = annotMinH;
    const baseW = annotMinW;

    // Phase A: Inside page
    if (!placed) {
      const candidates = generateInsideCandidates(hl, pad, pageW, pageH, baseW, baseH, blocked);
      const best = pickBest(candidates, blocked, highlights, hlIdx, pageW, pageH, false, false);
      if (best) {
        annotations.push({ hlIdx, x: best.x, y: best.y, w: best.w, h: best.h, tag: best.tag, inMargin: false });
        blocked.push({ x: best.x, y: best.y, w: best.w, h: best.h });
        placed = true;
      }
    }

    // Phase B: Right side
    if (!placed) {
      const candidates = generateRightCandidates(hl, pad, pageW, pageH, baseW, baseH, blocked);
      const best = pickBest(candidates, blocked, highlights, hlIdx, pageW, pageH, false, true);
      if (best) {
        annotations.push({ hlIdx, x: best.x, y: best.y, w: best.w, h: best.h, tag: best.tag, inMargin: false });
        blocked.push({ x: best.x, y: best.y, w: best.w, h: best.h });
        placed = true;
      }
    }

    // Phase C: Bottom
    if (!placed) {
      const candidates = generateBottomCandidates(hl, pad, pageW, baseW, baseH, blocked);
      const best = pickBest(candidates, blocked, highlights, hlIdx, pageW, pageH, false);
      if (best) {
        annotations.push({ hlIdx, x: best.x, y: best.y, w: best.w, h: best.h, tag: best.tag, inMargin: false });
        blocked.push({ x: best.x, y: best.y, w: best.w, h: best.h });
        placed = true;
      }
    }

    // Phase D: Overflow
    if (!placed) {
      const candidates = generateOverflowCandidates(pageW, pageH, pad, baseW, baseH, blocked);
      const best = candidates[0];
      annotations.push({ hlIdx, x: best.x, y: best.y, w: best.w, h: best.h, tag: best.tag, inMargin: false });
      blocked.push({ x: best.x, y: best.y, w: best.w, h: best.h });
    }
  }

  return { annotations };
}
