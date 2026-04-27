/**
 * Leader Router — connection geometry between highlights and annotations.
 *
 * Computes connection geometry (leader lines) between highlights and annotations.
 * Two leader types:
 *   - Inline: straight line with crossing-minimized anchor selection
 *   - Margin: straight dashed line (shortest Euclidean distance)
 *
 * Pure geometry — no canvas dependency. Shared by revdoku-doc-api (canvas rendering)
 * and frontend (optional future use).
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Rectangle type compatible with annotation-placer's AnnotationResult */
export interface LeaderRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Annotation with highlight index and margin flag */
export interface LeaderAnnotation extends LeaderRect {
  hlIdx: number;
  inMargin: boolean;
}

/** Inline leader: straight line from annotation to highlight */
export interface InlineLeader {
  hlIdx: number;
  type: 'inline';
  /** Point on the highlight (arrow target) */
  ax: number;
  ay: number;
  /** Point on the annotation (line origin) */
  bx: number;
  by: number;
}

/** Margin leader: straight dashed line */
export interface MarginLeader {
  hlIdx: number;
  type: 'margin';
  /** Point on the highlight (arrow target) */
  sx: number;
  sy: number;
  /** Bend point (degenerate — equals ex/ey for backward compat) */
  bx: number;
  by: number;
  /** Point on the annotation (line origin) */
  ex: number;
  ey: number;
}

export type Leader = InlineLeader | MarginLeader;

// ─── Geometry helpers ──────────────────────────────────────────────────────────

const MIN_SEG = 10;
const MAX_SEGS = 8;
const HORIZ_PREFERENCE = 3; // penalize Y-offset to prefer horizontal margin leaders
const STAGGER_STEP = 14;
const COINCIDENT_NUDGE = 6;
const PARALLEL_DOT_THRESHOLD = 0.85;
const COINCIDENT_DIST = 6;
const ANCHOR_CLUSTER_DIST = 25;
const ANCHOR_SPREAD_STEP = 26;
const ANCHOR_EDGE_PAD = 4;

/** Max angle (radians) from perpendicular before falling back from edge-center anchoring */
export const REVDOKU_LEADER_CENTER_MAX_ANGLE = 0.70; // ~40 degrees

/** Segment-vs-AABB intersection test (Liang-Barsky) */
function segCrossesRect(
  x1: number, y1: number, x2: number, y2: number, rect: LeaderRect
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

/** Test whether two line segments (p1→p2) and (p3→p4) properly intersect. */
function segmentsIntersect(
  p1x: number, p1y: number, p2x: number, p2y: number,
  p3x: number, p3y: number, p4x: number, p4y: number,
): boolean {
  const d1x = p2x - p1x, d1y = p2y - p1y;
  const d2x = p4x - p3x, d2y = p4y - p3y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return false; // parallel/collinear
  const t = ((p3x - p1x) * d2y - (p3y - p1y) * d2x) / denom;
  const u = ((p3x - p1x) * d1y - (p3y - p1y) * d1x) / denom;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

/** Count crossings of a segment with highlights, skipping skipIdx */
function countCrossings(
  x1: number, y1: number, x2: number, y2: number,
  highlights: LeaderRect[], skipIdx: number
): number {
  let c = 0;
  for (let i = 0; i < highlights.length; i++) {
    if (i === skipIdx) continue;
    if (segCrossesRect(x1, y1, x2, y2, highlights[i])) c++;
  }
  return c;
}

/** Count crossings of a segment with all rects (no skip) */
function countCrossingsAll(
  x1: number, y1: number, x2: number, y2: number,
  rects: LeaderRect[]
): number {
  let c = 0;
  for (const r of rects) {
    if (segCrossesRect(x1, y1, x2, y2, r)) c++;
  }
  return c;
}

/** Generate evenly-spaced sample points along all four edges of a rectangle */
function edgePoints(r: LeaderRect): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  function add(x1: number, y1: number, x2: number, y2: number): void {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < MIN_SEG) {
      pts.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
      return;
    }
    const n = Math.min(MAX_SEGS, Math.max(1, Math.floor(len / MIN_SEG)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
    }
    pts.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 }); // always include midpoint
  }
  add(r.x, r.y, r.x + r.w, r.y);
  add(r.x + r.w, r.y, r.x + r.w, r.y + r.h);
  add(r.x + r.w, r.y + r.h, r.x, r.y + r.h);
  add(r.x, r.y + r.h, r.x, r.y);
  return pts;
}

// ─── Leader computation ────────────────────────────────────────────────────────

/**
 * Compute inline leader between a highlight and an adjacent annotation.
 * Tries axis-aligned candidates first (overlapping edges), then falls back to
 * full edge-point enumeration. Minimizes highlight crossings, then distance.
 */
export function computeInlineLeader(
  hl: LeaderRect, annot: LeaderRect, parentIdx: number, highlights: LeaderRect[],
  obstacles?: LeaderRect[]
): InlineLeader | null {
  const yOS = Math.max(hl.y, annot.y);
  const yOE = Math.min(hl.y + hl.h, annot.y + annot.h);
  const xOS = Math.max(hl.x, annot.x);
  const xOE = Math.min(hl.x + hl.w, annot.x + annot.w);

  const candidates: { ax: number; ay: number; bx: number; by: number }[] = [];

  // Horizontal overlap → vertical leader candidates
  if (yOE - yOS > 2) {
    const yS = yOE - yOS;
    // Center of highlight side first (preferred), then overlap midpoints
    const hlCenterY = hl.y + hl.h / 2;
    const yPts = [hlCenterY, (yOS + yOE) / 2];
    if (yS > 10) { yPts.push(yOS + yS * 0.25, yOS + yS * 0.75); }
    for (const yy of yPts) {
      if (hl.x + hl.w <= annot.x) {
        candidates.push({ ax: hl.x + hl.w, ay: yy, bx: annot.x, by: yy });
      } else if (annot.x + annot.w <= hl.x) {
        candidates.push({ ax: hl.x, ay: yy, bx: annot.x + annot.w, by: yy });
      }
    }
  }

  // Vertical overlap → horizontal leader candidates
  if (xOE - xOS > 2) {
    const xS = xOE - xOS;
    // Center of highlight side first (preferred), then overlap midpoints
    const hlCenterX = hl.x + hl.w / 2;
    const xPts = [hlCenterX, (xOS + xOE) / 2];
    if (xS > 10) { xPts.push(xOS + xS * 0.25, xOS + xS * 0.75); }
    for (const xx of xPts) {
      if (hl.y + hl.h <= annot.y) {
        candidates.push({ ax: xx, ay: hl.y + hl.h, bx: xx, by: annot.y });
      } else if (annot.y + annot.h <= hl.y) {
        candidates.push({ ax: xx, ay: hl.y, bx: xx, by: annot.y + annot.h });
      }
    }
  }

  let best: { ax: number; ay: number; bx: number; by: number } | null = null;
  let bestS = Infinity;

  for (const c of candidates) {
    const cr = countCrossings(c.ax, c.ay, c.bx, c.by, highlights, parentIdx)
             + (obstacles ? countCrossingsAll(c.ax, c.ay, c.bx, c.by, obstacles) : 0);
    const d = (c.ax - c.bx) ** 2 + (c.ay - c.by) ** 2;
    const s = cr * 1e6 + d;
    if (s < bestS) { bestS = s; best = c; }
  }

  // If the best candidate anchors at highlight center but the angle is too steep, re-pick
  if (best && bestS < 1e6) {
    const hlCenterY = hl.y + hl.h / 2;
    const hlCenterX = hl.x + hl.w / 2;
    const usesCenter = best.ay === hlCenterY || best.ax === hlCenterX;
    if (usesCenter) {
      const dy = Math.abs(best.ay - best.by);
      const dx = Math.abs(best.ax - best.bx);
      // For horizontal leader: angleFromPerp = atan2(dy, dx), 0 = perfectly horizontal
      // For vertical leader: angleFromPerp = atan2(dx, dy), 0 = perfectly vertical
      const isHorizontal = dx > dy;
      const angleFromPerp = isHorizontal ? Math.atan2(dy, dx) : Math.atan2(dx, dy);
      if (angleFromPerp > REVDOKU_LEADER_CENTER_MAX_ANGLE) {
        // Re-run with only non-center overlap-midpoint candidates
        const fallbackCandidates = candidates.filter(c => c.ay !== hlCenterY && c.ax !== hlCenterX);
        let fbBest: { ax: number; ay: number; bx: number; by: number } | null = null;
        let fbBestS = Infinity;
        for (const c of fallbackCandidates) {
          const cr = countCrossings(c.ax, c.ay, c.bx, c.by, highlights, parentIdx)
                   + (obstacles ? countCrossingsAll(c.ax, c.ay, c.bx, c.by, obstacles) : 0);
          const d = (c.ax - c.bx) ** 2 + (c.ay - c.by) ** 2;
          const s = cr * 1e6 + d;
          if (s < fbBestS) { fbBestS = s; fbBest = c; }
        }
        if (fbBest && fbBestS < 1e6) {
          best = fbBest;
          bestS = fbBestS;
        }
      }
    }
    return { hlIdx: parentIdx, type: 'inline', ax: best.ax, ay: best.ay, bx: best.bx, by: best.by };
  }

  // Fallback: enumerate all edge-point pairs
  const pA = edgePoints(hl);
  const pB = edgePoints(annot);
  for (const pa of pA) {
    for (const pb of pB) {
      const dd = (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2;
      const ccr = countCrossings(pa.x, pa.y, pb.x, pb.y, highlights, parentIdx)
               + (obstacles ? countCrossingsAll(pa.x, pa.y, pb.x, pb.y, obstacles) : 0);
      const ss = ccr * 1e6 + dd;
      if (ss < bestS) {
        bestS = ss;
        best = { ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y };
      }
    }
  }

  if (!best) return null;
  return { hlIdx: parentIdx, type: 'inline', ax: best.ax, ay: best.ay, bx: best.bx, by: best.by };
}

/**
 * Compute margin leader: straight line from highlight edge to annotation edge.
 *
 * When `columnEdge` is provided, the leader endpoint on the perpendicular axis
 * is forced to that position instead of the annotation's actual edge, ensuring
 * all same-side connectors terminate at the same line for clean visual alignment.
 * For right/left labels: columnEdge overrides the X endpoint.
 * For top/bottom labels: columnEdge overrides the Y endpoint.
 */
export function computeMarginLeader(
  hl: LeaderRect, annot: LeaderRect,
  _obstacles?: LeaderRect[],
  columnEdge?: number
): MarginLeader {
  // Determine which edges to connect based on relative position
  const hlCx = hl.x + hl.w / 2;
  const hlCy = hl.y + hl.h / 2;
  const anCx = annot.x + annot.w / 2;
  const anCy = annot.y + annot.h / 2;

  let sx: number, sy: number, ex: number, ey: number;

  // 2-zone highlight anchor:
  //   Within highlight span → label center (perfectly horizontal/vertical)
  //   Outside highlight span → center of facing side
  //   When label is far above/below, use top/bottom corner if shorter path
  const dx = anCx - hlCx;
  const dy = anCy - hlCy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    // Label is primarily to the right or left — columnEdge overrides X
    if (anCy >= hl.y && anCy <= hl.y + hl.h) {
      sy = anCy;  // within span → horizontal
    } else {
      sy = hlCy;  // outside → center of side
    }

    if (dx >= 0) {
      sx = hl.x + hl.w;
      ex = columnEdge ?? annot.x; ey = anCy;
    } else {
      sx = hl.x;
      ex = columnEdge ?? (annot.x + annot.w); ey = anCy;
    }

    // When label is well above/below, consider top/bottom corner anchor if shorter
    if (anCy < hl.y - hl.h * 0.5) {
      const topDist = Math.hypot((columnEdge ?? annot.x) - (hl.x + hl.w), anCy - hl.y);
      const rightDist = Math.hypot((columnEdge ?? annot.x) - (hl.x + hl.w), anCy - hlCy);
      if (topDist < rightDist * 0.85) {
        sx = hl.x + hl.w - Math.min(hl.w * 0.25, 30);
        sy = hl.y;
      }
    } else if (anCy > hl.y + hl.h + hl.h * 0.5) {
      const bottomDist = Math.hypot((columnEdge ?? annot.x) - (hl.x + hl.w), anCy - (hl.y + hl.h));
      const rightDist = Math.hypot((columnEdge ?? annot.x) - (hl.x + hl.w), anCy - hlCy);
      if (bottomDist < rightDist * 0.85) {
        sx = hl.x + hl.w - Math.min(hl.w * 0.25, 30);
        sy = hl.y + hl.h;
      }
    }
  } else {
    // Label is primarily above or below — columnEdge overrides Y
    if (anCx >= hl.x && anCx <= hl.x + hl.w) {
      sx = anCx;  // within span → vertical
    } else {
      sx = hlCx;  // outside → center of side
    }

    if (dy >= 0) {
      sy = hl.y + hl.h;
      ex = anCx; ey = columnEdge ?? annot.y;
    } else {
      sy = hl.y;
      ex = anCx; ey = columnEdge ?? (annot.y + annot.h);
    }
  }

  return {
    hlIdx: -1, type: 'margin',
    sx, sy,
    bx: ex, by: ey,
    ex, ey,
  };
}

/**
 * Compute all leaders for a set of annotations and their associated highlights.
 * Dispatches to inline or margin computation based on `inMargin` flag.
 */
/**
 * Convert a Leader to a simple {x,y}[] polyline for backward compatibility.
 * - InlineLeader → [{bx,by}, {ax,ay}]  (annotation → highlight)
 * - MarginLeader → [{ex,ey}, {sx,sy}]  (annotation → highlight, straight line)
 */
export function leaderToArrowPath(leader: Leader): { x: number; y: number }[] {
  if (leader.type === 'inline') {
    return [
      { x: leader.bx, y: leader.by },
      { x: leader.ax, y: leader.ay },
    ];
  }
  // margin — straight line
  return [
    { x: leader.ex, y: leader.ey },
    { x: leader.sx, y: leader.sy },
  ];
}

// ─── Shared render-path computation ──────────────────────────────────────────

/** Leader endpoint style: 'circle' = filled dot (Apple-style), 'arrow' = V-arrowhead, 'none' = plain line */
export const REVDOKU_LEADER_ENDPOINT_STYLE: 'circle' | 'arrow' | 'none' = 'circle';
/** Radius of the filled circle dot at the highlight end of a leader */
export const REVDOKU_LEADER_CIRCLE_RADIUS = 3;

/** Pre-computed render path for a leader: polyline + arrowhead geometry */
export interface LeaderRenderPath {
  /** Polyline points from annotation to tip (2 points for both inline and margin) */
  pathPoints: { x: number; y: number }[];
  /** V-arrowhead: [leftArm, tip, rightArm] — empty when using circle endpoint */
  arrowPoints: { x: number; y: number }[];
  /** Filled circle dot at the highlight end (Apple-style endpoint) */
  circlePoint?: { x: number; y: number; radius: number };
  /** Whether to use dashed stroke (margin leaders) */
  dashed: boolean;
}

/**
 * Single source of truth for leader render geometry (path polyline + arrowhead).
 * Used by canvas-rendering-utils (revdoku-doc-api export), HighlightOverlay SVG, and
 * highlight-utils DOM updates.
 */
export function computeLeaderRenderPath(leader: Leader): LeaderRenderPath {
  const ARROW_INSET = 3;
  const ARROW_RATIO = 0.15;
  const ARROW_MIN = 10;
  const ARROW_MAX = 24;
  const ARROW_ANGLE = 0.4;

  if (leader.type === 'inline') {
    const il = leader;
    const len = Math.hypot(il.ax - il.bx, il.ay - il.by);
    const angle = Math.atan2(il.ay - il.by, il.ax - il.bx);

    if (REVDOKU_LEADER_ENDPOINT_STYLE === 'circle') {
      return {
        pathPoints: [
          { x: il.bx, y: il.by },
          { x: il.ax, y: il.ay },
        ],
        arrowPoints: [],
        circlePoint: { x: il.ax, y: il.ay, radius: REVDOKU_LEADER_CIRCLE_RADIUS },
        dashed: false,
      };
    }

    if (REVDOKU_LEADER_ENDPOINT_STYLE === 'none') {
      return {
        pathPoints: [
          { x: il.bx, y: il.by },
          { x: il.ax, y: il.ay },
        ],
        arrowPoints: [],
        dashed: false,
      };
    }

    // 'arrow' — original V-arrowhead
    const inset = Math.min(ARROW_INSET, len * 0.3);
    const tipX = il.ax - inset * Math.cos(angle);
    const tipY = il.ay - inset * Math.sin(angle);
    const sz = Math.max(ARROW_MIN, Math.min(ARROW_MAX, len * ARROW_RATIO));

    return {
      pathPoints: [
        { x: il.bx, y: il.by },
        { x: tipX, y: tipY },
      ],
      arrowPoints: [
        { x: tipX - sz * Math.cos(angle - ARROW_ANGLE), y: tipY - sz * Math.sin(angle - ARROW_ANGLE) },
        { x: tipX, y: tipY },
        { x: tipX - sz * Math.cos(angle + ARROW_ANGLE), y: tipY - sz * Math.sin(angle + ARROW_ANGLE) },
      ],
      dashed: false,
    };
  }

  // Margin leader — straight line (no elbows)
  const ml = leader;
  const len = Math.hypot(ml.sx - ml.ex, ml.sy - ml.ey);
  const angle = Math.atan2(ml.sy - ml.ey, ml.sx - ml.ex);

  if (REVDOKU_LEADER_ENDPOINT_STYLE === 'circle') {
    return {
      pathPoints: [{ x: ml.ex, y: ml.ey }, { x: ml.sx, y: ml.sy }],
      arrowPoints: [],
      circlePoint: { x: ml.sx, y: ml.sy, radius: REVDOKU_LEADER_CIRCLE_RADIUS },
      dashed: true,
    };
  }

  if (REVDOKU_LEADER_ENDPOINT_STYLE === 'none') {
    return {
      pathPoints: [{ x: ml.ex, y: ml.ey }, { x: ml.sx, y: ml.sy }],
      arrowPoints: [],
      dashed: true,
    };
  }

  // 'arrow' — original V-arrowhead
  const inset = Math.min(ARROW_INSET, len * 0.3);
  const tipX = ml.sx - inset * Math.cos(angle);
  const tipY = ml.sy - inset * Math.sin(angle);
  const sz = Math.max(ARROW_MIN, Math.min(ARROW_MAX, len * ARROW_RATIO));

  return {
    pathPoints: [{ x: ml.ex, y: ml.ey }, { x: tipX, y: tipY }],
    arrowPoints: [
      { x: tipX - sz * Math.cos(angle - ARROW_ANGLE), y: tipY - sz * Math.sin(angle - ARROW_ANGLE) },
      { x: tipX, y: tipY },
      { x: tipX - sz * Math.cos(angle + ARROW_ANGLE), y: tipY - sz * Math.sin(angle + ARROW_ANGLE) },
    ],
    dashed: true,
  };
}

export function computeAllLeaders(
  annotations: LeaderAnnotation[], highlights: LeaderRect[]
): Leader[] {
  const leaders: Leader[] = [];
  for (const a of annotations) {
    const hl = highlights[a.hlIdx];
    if (!hl) continue;

    if (a.inMargin) {
      const ml = computeMarginLeader(hl, a);
      if (ml) {
        ml.hlIdx = a.hlIdx;
        leaders.push(ml);
      }
    } else {
      const il = computeInlineLeader(hl, a, a.hlIdx, highlights);
      if (il) leaders.push(il);
    }
  }
  return leaders;
}

// ─── Leader endpoint snapping ────────────────────────────────────────────────

/**
 * Snap the label-side endpoint of a leader render path to the CENTER of the
 * label's border edge (determined by labelRelativePosition).
 *
 * Shared by frontend SVG rendering and revdoku-doc-api canvas export.
 *
 * @param pathPoints - Points from computeLeaderRenderPath (index 0 = label side)
 * @param labelBox  - The label's bounding box {x, y, width, height}
 * @param labelRelativePosition - Which side of the highlight the label is on
 * @returns New array of points with pathPoints[0] adjusted
 */
export function snapLeaderEndpointToLabel(
  pathPoints: { x: number; y: number }[],
  labelBox: { x: number; y: number; width: number; height: number },
  labelRelativePosition: import('./highlight-rendering-utils').LabelRelativePositionRelativeToHighlight,
): { x: number; y: number }[] {
  const adjusted = [...pathPoints];
  const lb = labelBox;
  switch (labelRelativePosition) {
    case 'left': // label is left of highlight → border on right edge, connect at center
      adjusted[0] = { x: lb.x + lb.width, y: lb.y + lb.height / 2 };
      break;
    case 'top': // label is above highlight → border on bottom edge, connect at center
      adjusted[0] = { x: lb.x + lb.width / 2, y: lb.y + lb.height };
      break;
    case 'bottom': // label is below highlight → border on top edge, connect at center
      adjusted[0] = { x: lb.x + lb.width / 2, y: lb.y };
      break;
    default: // 'right' — label is right of highlight → border on left edge, connect at center
      adjusted[0] = { x: lb.x, y: lb.y + lb.height / 2 };
      break;
  }
  return adjusted;
}

// ─── Leader deconfliction ──────────────────────────────────────────────────────

/**
 * Post-process leaders to avoid visual merging and obstacle crossing.
 *
 * Three passes:
 *  1. Reroute leaders that cross other highlights/annotations (with obstacle awareness)
 *  2. Stagger overlapping margin-leader vertical segments
 *  3. Nudge nearly-coincident inline leader segments
 */
export function deconflictLeaders(
  leaders: Leader[],
  hlRects: LeaderRect[],
  annotRects: LeaderRect[]
): Leader[] {
  const result = leaders.map(l => ({ ...l })) as Leader[];
  const allObstacles = [...hlRects, ...annotRects];

  // ── Pass 1: Reroute obstacle-crossing leaders ──
  for (let i = 0; i < result.length; i++) {
    const ownHl = hlRects[i];
    const ownAnnot = annotRects[i];
    // Build obstacles excluding own highlight and annotation
    const otherObstacles = allObstacles.filter((_, idx) =>
      idx !== i && idx !== i + hlRects.length
    );
    if (otherObstacles.length === 0) continue;

    const leader = result[i];
    const path = leaderToArrowPath(leader);
    let crosses = false;
    for (let s = 0; s < path.length - 1; s++) {
      for (const obs of otherObstacles) {
        if (segCrossesRect(path[s].x, path[s].y, path[s + 1].x, path[s + 1].y, obs)) {
          crosses = true;
          break;
        }
      }
      if (crosses) break;
    }

    if (crosses) {
      if (leader.type === 'inline') {
        const rerouted = computeInlineLeader(ownHl, ownAnnot, i, hlRects, otherObstacles);
        if (rerouted) {
          rerouted.hlIdx = leader.hlIdx;
          result[i] = rerouted;
        }
      } else {
        const rerouted = computeMarginLeader(ownHl, ownAnnot, otherObstacles);
        if (rerouted) {
          rerouted.hlIdx = leader.hlIdx;
          result[i] = rerouted;
        }
      }
    }
  }

  // ── Pass 2: Nudge nearly-coincident inline segments ──
  for (let i = 0; i < result.length; i++) {
    if (result[i].type !== 'inline') continue;
    const li = result[i] as InlineLeader;
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].type !== 'inline') continue;
      const lj = result[j] as InlineLeader;

      // Check if segments are nearly coincident
      const dix = li.ax - li.bx, diy = li.ay - li.by;
      const djx = lj.ax - lj.bx, djy = lj.ay - lj.by;
      const lenI = Math.sqrt(dix * dix + diy * diy);
      const lenJ = Math.sqrt(djx * djx + djy * djy);
      if (lenI < 1 || lenJ < 1) continue;

      const dot = Math.abs((dix * djx + diy * djy) / (lenI * lenJ));
      if (dot < PARALLEL_DOT_THRESHOLD) continue;

      const midDist = Math.sqrt(
        ((li.ax + li.bx) / 2 - (lj.ax + lj.bx) / 2) ** 2 +
        ((li.ay + li.by) / 2 - (lj.ay + lj.by) / 2) ** 2
      );
      if (midDist >= COINCIDENT_DIST) continue;

      // Nudge j perpendicular to the segment direction
      const perpX = -diy / lenI;
      const perpY = dix / lenI;
      lj.ax += perpX * COINCIDENT_NUDGE;
      lj.ay += perpY * COINCIDENT_NUDGE;
      lj.bx += perpX * COINCIDENT_NUDGE;
      lj.by += perpY * COINCIDENT_NUDGE;
    }
  }

  // ── Pass 3: Verticalize long diagonal inline leaders ──
  const VERT_DISTANCE_THRESHOLD = 100;
  const VERT_ANGLE_MIN = Math.PI / 6; // 30deg — skip if already near-axis-aligned

  for (let i = 0; i < result.length; i++) {
    if (result[i].type !== 'inline') continue;
    const li = result[i] as InlineLeader;
    const dist = Math.hypot(li.ax - li.bx, li.ay - li.by);
    if (dist < VERT_DISTANCE_THRESHOLD) continue;

    // angle from vertical: 0 = vertical, PI/2 = horizontal
    const angle = Math.abs(Math.atan2(Math.abs(li.ax - li.bx), Math.abs(li.ay - li.by)));
    if (angle < VERT_ANGLE_MIN || angle > Math.PI / 2 - VERT_ANGLE_MIN) continue;

    const hl = hlRects[i];
    const annot = annotRects[i];

    // Compute X overlap between highlight and annotation
    const xOS = Math.max(hl.x, annot.x);
    const xOE = Math.min(hl.x + hl.w, annot.x + annot.w);

    let newAx: number, newBx: number;
    if (xOE - xOS > 2) {
      // X ranges overlap — pure vertical at midpoint
      const vertX = (xOS + xOE) / 2;
      newAx = vertX;
      newBx = vertX;
    } else {
      // No X overlap — use nearest edges (nearly vertical)
      if (annot.x + annot.w < hl.x) {
        newBx = annot.x + annot.w; // right edge of annotation
        newAx = hl.x;              // left edge of highlight
      } else {
        newBx = annot.x;           // left edge of annotation
        newAx = hl.x + hl.w;      // right edge of highlight
      }
    }

    // Y anchors: edges facing each other
    let newAy: number, newBy: number;
    if (annot.y + annot.h <= hl.y) {
      // annotation above highlight
      newBy = annot.y + annot.h; // bottom of annotation
      newAy = hl.y;              // top of highlight
    } else if (hl.y + hl.h <= annot.y) {
      // highlight above annotation
      newBy = annot.y;           // top of annotation
      newAy = hl.y + hl.h;      // bottom of highlight
    } else {
      continue; // overlapping in Y — skip
    }

    li.ax = newAx;
    li.ay = newAy;
    li.bx = newBx;
    li.by = newBy;
  }

  // ── Pass 4: Spread converging highlight-side anchors ──
  // When multiple leaders point to nearly the same spot on overlapping highlights,
  // spread their anchor points along the highlight edge for visual clarity.
  {
    // Extract highlight-side anchor for each leader
    const anchors: { x: number; y: number }[] = result.map(l => {
      if (l.type === 'inline') return { x: l.ax, y: l.ay };
      return { x: l.sx, y: l.sy };
    });

    // Cluster leaders whose highlight anchors are within threshold
    const clustered = new Set<number>();
    const clusters: number[][] = [];

    for (let i = 0; i < anchors.length; i++) {
      if (clustered.has(i)) continue;
      const group = [i];
      clustered.add(i);

      for (let j = i + 1; j < anchors.length; j++) {
        if (clustered.has(j)) continue;
        const dist = Math.hypot(anchors[i].x - anchors[j].x, anchors[i].y - anchors[j].y);
        if (dist <= ANCHOR_CLUSTER_DIST) {
          group.push(j);
          clustered.add(j);
        }
      }

      if (group.length > 1) clusters.push(group);
    }

    for (const group of clusters) {
      // Sort by annotation center Y (top-to-bottom)
      group.sort((a, b) => {
        const aCenter = annotRects[a].y + annotRects[a].h / 2;
        const bCenter = annotRects[b].y + annotRects[b].h / 2;
        return aCenter - bCenter;
      });

      // Compute average anchor position
      let avgX = 0, avgY = 0;
      for (const idx of group) {
        avgX += anchors[idx].x;
        avgY += anchors[idx].y;
      }
      avgX /= group.length;
      avgY /= group.length;

      // Detect which edge the cluster is on using the first leader's highlight
      const hl = hlRects[result[group[0]].hlIdx];
      if (!hl) continue;

      const distRight = Math.abs(avgX - (hl.x + hl.w));
      const distLeft = Math.abs(avgX - hl.x);
      const distTop = Math.abs(avgY - hl.y);
      const distBottom = Math.abs(avgY - (hl.y + hl.h));
      const minEdgeDist = Math.min(distRight, distLeft, distTop, distBottom);

      const totalSpread = (group.length - 1) * ANCHOR_SPREAD_STEP;

      if (minEdgeDist === distRight || minEdgeDist === distLeft) {
        // Vertical edge — spread along Y, keep X on edge
        const edgeX = minEdgeDist === distRight ? hl.x + hl.w : hl.x;
        const minY = hl.y + ANCHOR_EDGE_PAD;
        const maxY = hl.y + hl.h - ANCHOR_EDGE_PAD;
        let startY = avgY - totalSpread / 2;

        // Clamp the spread range within the highlight edge
        if (startY < minY) startY = minY;
        if (startY + totalSpread > maxY) startY = maxY - totalSpread;

        for (let k = 0; k < group.length; k++) {
          const idx = group[k];
          const newY = Math.max(minY, Math.min(maxY, startY + k * ANCHOR_SPREAD_STEP));
          const leader = result[idx];
          if (leader.type === 'inline') {
            leader.ax = edgeX;
            leader.ay = newY;
          } else {
            leader.sx = edgeX;
            leader.sy = newY;
            leader.by = newY; // keep horizontal segment horizontal
          }
        }
      } else {
        // Horizontal edge — spread along X, keep Y on edge
        const edgeY = minEdgeDist === distTop ? hl.y : hl.y + hl.h;
        const minX = hl.x + ANCHOR_EDGE_PAD;
        const maxX = hl.x + hl.w - ANCHOR_EDGE_PAD;
        let startX = avgX - totalSpread / 2;

        // Clamp the spread range within the highlight edge
        if (startX < minX) startX = minX;
        if (startX + totalSpread > maxX) startX = maxX - totalSpread;

        for (let k = 0; k < group.length; k++) {
          const idx = group[k];
          const newX = Math.max(minX, Math.min(maxX, startX + k * ANCHOR_SPREAD_STEP));
          const leader = result[idx];
          if (leader.type === 'inline') {
            leader.ax = newX;
            leader.ay = edgeY;
          } else {
            leader.sx = newX;
            leader.sy = edgeY;
            leader.by = edgeY; // keep horizontal segment horizontal
          }
        }
      }
    }
  }

  // ── Pass 5: Uncross intersecting inline leader segments ──
  for (let i = 0; i < result.length; i++) {
    if (result[i].type !== 'inline') continue;
    const li = result[i] as InlineLeader;
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].type !== 'inline') continue;
      const lj = result[j] as InlineLeader;

      if (!segmentsIntersect(li.bx, li.by, li.ax, li.ay, lj.bx, lj.by, lj.ax, lj.ay)) continue;

      // Try re-anchoring leader j on its highlight to eliminate the crossing
      const hlJ = hlRects[lj.hlIdx];
      if (hlJ) {
        const ptsJ = edgePoints(hlJ);
        let bestCand: { x: number; y: number } | null = null;
        let bestScore = Infinity;

        for (const c of ptsJ) {
          // Check if new segment still crosses leader i
          const crossesI = segmentsIntersect(li.bx, li.by, li.ax, li.ay, lj.bx, lj.by, c.x, c.y);
          // Check if new segment crosses any other inline leader
          let crossesAny = crossesI;
          if (!crossesAny) {
            for (let k = 0; k < result.length; k++) {
              if (k === j || result[k].type !== 'inline') continue;
              const lk = result[k] as InlineLeader;
              if (segmentsIntersect(lk.bx, lk.by, lk.ax, lk.ay, lj.bx, lj.by, c.x, c.y)) {
                crossesAny = true;
                break;
              }
            }
          }
          const dist = (lj.bx - c.x) ** 2 + (lj.by - c.y) ** 2;
          const score = (crossesAny ? 1e6 : 0) + dist;
          if (score < bestScore) {
            bestScore = score;
            bestCand = c;
          }
        }

        if (bestCand && bestScore < 1e6) {
          lj.ax = bestCand.x;
          lj.ay = bestCand.y;
          continue; // fixed — move to next pair
        }
      }

      // If re-anchoring j didn't work, try re-anchoring leader i
      const hlI = hlRects[li.hlIdx];
      if (hlI) {
        const ptsI = edgePoints(hlI);
        let bestCand: { x: number; y: number } | null = null;
        let bestScore = Infinity;

        for (const c of ptsI) {
          const crossesJ = segmentsIntersect(c.x, c.y, li.bx, li.by, lj.bx, lj.by, lj.ax, lj.ay);
          let crossesAny = crossesJ;
          if (!crossesAny) {
            for (let k = 0; k < result.length; k++) {
              if (k === i || result[k].type !== 'inline') continue;
              const lk = result[k] as InlineLeader;
              if (segmentsIntersect(c.x, c.y, li.bx, li.by, lk.bx, lk.by, lk.ax, lk.ay)) {
                crossesAny = true;
                break;
              }
            }
          }
          const dist = (li.bx - c.x) ** 2 + (li.by - c.y) ** 2;
          const score = (crossesAny ? 1e6 : 0) + dist;
          if (score < bestScore) {
            bestScore = score;
            bestCand = c;
          }
        }

        if (bestCand && bestScore < 1e6) {
          li.ax = bestCand.x;
          li.ay = bestCand.y;
        }
      }
    }
  }

  return result;
}
