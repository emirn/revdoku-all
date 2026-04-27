/**
 * Compact badge placement: places numbered circle badges at highlight corners,
 * avoiding only badge-badge collisions. No margin needed.
 */

export interface CompactHighlight {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompactBadgeResult {
  id: string;
  cx: number; // badge center X
  cy: number; // badge center Y
  touchesHighlight: boolean; // true = skip leader line
}

/**
 * Place badges at highlight corners, only avoiding badge-badge collisions.
 *
 * Algorithm:
 * 1. Sort highlights by Y center (top-to-bottom reading order)
 * 2. For each highlight, try 8 candidate positions (4 corners + 4 edge-adjacent)
 * 3. Pick the first non-colliding candidate; clamp to page bounds
 * 4. Fallback: nudge down from top-right corner until clear
 * 5. Track whether badge overlaps its own highlight
 */
export function placeCompactBadges(
  highlights: CompactHighlight[],
  badgeRadius: number,
  pageWidth: number,
  pageHeight: number,
  options?: { gap?: number },
): CompactBadgeResult[] {
  const gap = options?.gap ?? 2;
  const r = badgeRadius;
  const d = r * 2; // badge diameter

  // Sort by Y center for top-to-bottom reading order
  const sorted = [...highlights].sort((a, b) => {
    const aCenterY = a.y + a.height / 2;
    const bCenterY = b.y + b.height / 2;
    return aCenterY - bCenterY;
  });

  // Track placed badge bounding boxes for collision detection
  const placedBadges: Array<{ x: number; y: number; w: number; h: number }> = [];

  const results: CompactBadgeResult[] = [];

  // Check if a badge at center (cx, cy) collides with any placed badge
  const collidesWithPlaced = (cx: number, cy: number): boolean => {
    const bx = cx - r;
    const by = cy - r;
    for (const pb of placedBadges) {
      if (
        bx < pb.x + pb.w &&
        bx + d > pb.x &&
        by < pb.y + pb.h &&
        by + d > pb.y
      ) {
        return true;
      }
    }
    return false;
  };

  // Check if a badge at center (cx, cy) overlaps a given highlight rect
  const overlapsRect = (
    cx: number,
    cy: number,
    rect: { x: number; y: number; width: number; height: number },
  ): boolean => {
    const bx = cx - r;
    const by = cy - r;
    return (
      bx < rect.x + rect.width &&
      bx + d > rect.x &&
      by < rect.y + rect.height &&
      by + d > rect.y
    );
  };

  // Clamp badge center so the full circle stays within page bounds
  const clamp = (cx: number, cy: number): { cx: number; cy: number } => ({
    cx: Math.max(r, Math.min(pageWidth - r, cx)),
    cy: Math.max(r, Math.min(pageHeight - r, cy)),
  });

  for (const hl of sorted) {
    const hlRight = hl.x + hl.width;
    const hlBottom = hl.y + hl.height;
    const hlCenterY = hl.y + hl.height / 2;

    // 8 candidate positions for the badge center:
    // Corners first (badge overlaps highlight), then edge-adjacent (just outside)
    const candidates: Array<{ cx: number; cy: number }> = [
      // Corner positions (badge center at highlight corner — half overlapping)
      { cx: hlRight, cy: hl.y },          // top-right corner
      { cx: hl.x, cy: hl.y },             // top-left corner
      { cx: hlRight, cy: hlBottom },       // bottom-right corner
      { cx: hl.x, cy: hlBottom },          // bottom-left corner
      // Edge-adjacent positions (badge just outside the edge)
      { cx: hlRight + r + gap, cy: hlCenterY },    // right-center
      { cx: hl.x - r - gap, cy: hlCenterY },       // left-center
      { cx: hlRight, cy: hl.y - r - gap },          // above-right
      { cx: hlRight, cy: hlBottom + r + gap },       // below-right
    ];

    let bestCx = candidates[0].cx;
    let bestCy = candidates[0].cy;
    let placed = false;

    for (const cand of candidates) {
      const c = clamp(cand.cx, cand.cy);
      if (!collidesWithPlaced(c.cx, c.cy)) {
        bestCx = c.cx;
        bestCy = c.cy;
        placed = true;
        break;
      }
    }

    // Fallback: nudge down from top-right corner until clear
    if (!placed) {
      const startC = clamp(hlRight, hl.y);
      bestCx = startC.cx;
      bestCy = startC.cy;
      for (let i = 0; i < 30; i++) {
        bestCy += d + gap;
        if (bestCy + r > pageHeight) break;
        if (!collidesWithPlaced(bestCx, bestCy)) {
          placed = true;
          break;
        }
      }
    }

    // Final clamp
    const final = clamp(bestCx, bestCy);
    bestCx = final.cx;
    bestCy = final.cy;

    // Register this badge so subsequent badges avoid it
    placedBadges.push({ x: bestCx - r, y: bestCy - r, w: d, h: d });

    // Determine if badge touches (overlaps) its own highlight
    const touchesHighlight = overlapsRect(bestCx, bestCy, hl);

    results.push({
      id: hl.id,
      cx: bestCx,
      cy: bestCy,
      touchesHighlight,
    });
  }

  return results;
}
