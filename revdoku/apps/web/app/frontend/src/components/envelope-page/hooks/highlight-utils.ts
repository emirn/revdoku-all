import {
  computeStraightConnectionLine,
  PlacementSide,
} from "@revdoku/lib";

/**
 * Update SVG connection line DOM directly during drag/resize (no React re-render).
 * Shared by useHighlightDragResize and useLabelDragResize.
 */
export function updateLeaderDOM(
  checkId: string,
  hlRect: { x: number; y: number; width: number; height: number },
  labelRect: { x: number; y: number; width: number; height: number },
  pageWidth: number,
) {
  const lineEl = document.querySelector(`[data-line-id="${checkId}"]`) as SVGLineElement | null;
  if (!lineEl) return;

  // Derive side from label position relative to page
  let side: PlacementSide;
  if (labelRect.x >= pageWidth) side = PlacementSide.RIGHT;
  else if (labelRect.x + labelRect.width <= 0) side = PlacementSide.LEFT;
  else if (labelRect.x < 0) side = PlacementSide.LEFT;
  else side = PlacementSide.INSIDE;

  const { start, end } = computeStraightConnectionLine(labelRect, hlRect, side);
  lineEl.setAttribute('x1', String(start.x));
  lineEl.setAttribute('y1', String(start.y));
  lineEl.setAttribute('x2', String(end.x));
  lineEl.setAttribute('y2', String(end.y));
}
