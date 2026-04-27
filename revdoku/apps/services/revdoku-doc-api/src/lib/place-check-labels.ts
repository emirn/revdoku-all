/** @internal DO NOT MOVE TO CLIENT — server-only wrapper */
/**
 * Wrapper that adapts HintPlacementInput[] to the shared placeLabels() algorithm
 * for non-compact mode, and to placeCompactAnnotations() for compact mode.
 * Returns HintPlacementResultExtended[].
 */

import { placeCompactAnnotations } from './compact-annotation-placer';
import type { Rect } from './compact-annotation-placer';
import type {
  HintPlacementInput,
  HintPlacementResultExtended,
  HintPlacementOptions,
  BoundingBox,
  Point,
  LabelPlacementInput,
  PlacerRect,
} from '@revdoku/lib';
import {
  PlacementSide,
  placeLabels,
  estimateWrappedLabelDimensions,
  REVDOKU_MIN_HINT_LABEL_WIDTH,
  REVDOKU_HINT_GAP,
  REVDOKU_ANNOTATION_MARGIN,
  computeStraightConnectionLine,
  REVDOKU_LAYOUT_LABEL_MAX_LINES,
} from '@revdoku/lib';

// Label font metrics (match experiment values)
const LABEL_FONT_SIZE = 14;
const LABEL_LINE_HEIGHT_RATIO = 19 / 14;
const LABEL_INNER_PADDING = 5;
const LABEL_MAX_LINES = REVDOKU_LAYOUT_LABEL_MAX_LINES;

/** CSS border on label box (top + bottom) — not included in estimateWrappedLabelDimensions */
const LABEL_CSS_BORDER_TOTAL = 5; // 2.5px * 2



/** Extended options for placeCheckLabels including compact mode */
export interface PlaceCheckLabelsOptions extends HintPlacementOptions {
  /** Enable compact badge placement (pill-sized annotations instead of full message boxes) */
  compactMode?: boolean;
  /** User font scale multiplier for compact pill sizing (default: 1.0) */
  compactFontScale?: number;
}

/**
 * Place check labels using the shared placeLabels() algorithm for non-compact mode,
 * or placeCompactAnnotations() for compact mode.
 *
 * Same inputs/outputs as the previous implementation but delegates to
 * @revdoku/lib placeLabels() to eliminate duplicated code.
 *
 * When `compactMode` is enabled, uses pill-sized annotation dimensions
 * instead of full message box sizes, allowing badges to be placed much
 * closer to their highlights with shorter connection lines.
 */
export function placeCheckLabels(
  highlights: HintPlacementInput[],
  pageWidth: number,
  pageHeight: number,
  options?: PlaceCheckLabelsOptions
): HintPlacementResultExtended[] {
  if (highlights.length === 0) return [];

  const contentBoxes = options?.contentBoxes || [];
  const skipArrows = options?.skipArrowComputation ?? false;
  const fontScale = options?.labelFontScale ?? 1.0;
  const compactMode = options?.compactMode ?? false;
  const compactFontScale = options?.compactFontScale ?? 1.0;
  const optFontFamily = options?.fontFamily;

  // Scale font metrics by user preference
  const scaledFontSize = LABEL_FONT_SIZE * fontScale;
  const scaledPadding = LABEL_INNER_PADDING * fontScale;

  // Compact mode: compute pill dimensions matching the rendering in image-utils.ts
  const pillFontSize = compactMode ? Math.max(14, pageHeight * 0.07) * compactFontScale : 0;
  const compactAnnotMinW = Math.ceil(pillFontSize * 2.5);  // fits 2-digit badge with padding
  const compactAnnotMinH = Math.ceil(pillFontSize * 1.8);  // pill height with gap

  // Convert content boxes to Rect busy areas, clamped to page bounds
  const busyAreas: (PlacerRect & Rect)[] = contentBoxes.map(cb => ({
    x: Math.max(0, cb.x1),
    y: Math.max(0, cb.y1),
    w: Math.min(cb.x2, pageWidth) - Math.max(0, cb.x1),
    h: Math.min(cb.y2, pageHeight) - Math.max(0, cb.y1),
  })).filter(r => r.w > 0 && r.h > 0);

  // Separate highlights into failed/passed groups
  const allIndices = highlights.map((_, i) => i);
  const failedIndices = allIndices.filter(i => highlights[i].passed !== true);
  const passedIndices = allIndices.filter(i => highlights[i].passed === true);

  const results: HintPlacementResultExtended[] = new Array(highlights.length);

  const annotMinH = compactMode ? compactAnnotMinH : scaledFontSize * LABEL_LINE_HEIGHT_RATIO + 2 * scaledPadding;

  const placeGroup = (groupIndices: number[]): void => {
    if (groupIndices.length === 0) return;

    if (compactMode) {
      // Compact mode: use per-highlight 4-phase placement
      const groupHighlights: Rect[] = groupIndices.map(i => ({
        x: highlights[i].x, y: highlights[i].y,
        w: highlights[i].width, h: highlights[i].height,
      }));

      const result = placeCompactAnnotations(groupHighlights, busyAreas, {
        pageW: pageWidth,
        pageH: pageHeight,
        annotMinW: compactAnnotMinW,
        annotMinH: compactAnnotMinH,
        gap: 3,
      });

      for (const ann of result.annotations) {
        const origIdx = groupIndices[ann.hlIdx];
        const h = highlights[origIdx];
        const labelBox: BoundingBox = {
          x: ann.x, y: ann.y, width: ann.w, height: ann.h,
        };
        const side = ann.inMargin ? PlacementSide.RIGHT : PlacementSide.INSIDE;

        let arrowPath: Point[] = [];
        if (!skipArrows) {
          const highlightBox: BoundingBox = { x: h.x, y: h.y, width: h.width, height: h.height };
          const { start, end } = computeStraightConnectionLine(labelBox, highlightBox, side);
          arrowPath = [start, end];
        }

        results[origIdx] = { id: h.id, labelBox, arrowPath, side };
      }
    } else {
      // Non-compact mode: use shared placeLabels() from @revdoku/lib
      const inputs: LabelPlacementInput[] = groupIndices.map((origIdx, i) => ({
        id: highlights[origIdx].id,
        highlight: {
          x: highlights[origIdx].x,
          y: highlights[origIdx].y,
          w: highlights[origIdx].width,
          h: highlights[origIdx].height,
        },
        text: highlights[origIdx].description || '',
        ruleOrder: highlights[origIdx].ruleOrder ?? i,
      }));

      const measureTextHeight = (text: string, width: number): number => {
        if (!text) return annotMinH;
        const est = estimateWrappedLabelDimensions(
          text, width, scaledFontSize, LABEL_LINE_HEIGHT_RATIO, scaledPadding, LABEL_MAX_LINES, optFontFamily,
        ).height;
        // Buffer: one extra line height for font metric variance + CSS border compensation
        const lineH = scaledFontSize * LABEL_LINE_HEIGHT_RATIO;
        return est + lineH + LABEL_CSS_BORDER_TOTAL;
      };

      const result = placeLabels(inputs, {
        pageW: pageWidth,
        pageH: pageHeight,
        gap: REVDOKU_HINT_GAP,
        busyAreas,
        measureTextHeight,
        labelFontSize: scaledFontSize,
        labelPadding: scaledPadding,
        minLabelHeight: annotMinH,
        minLabelWidth: REVDOKU_MIN_HINT_LABEL_WIDTH,
      });

      for (const label of result.labels) {
        const origIdx = groupIndices[label.inputIdx];
        const h = highlights[origIdx];
        const labelBox: BoundingBox = {
          x: label.box.x, y: label.box.y, width: label.box.w, height: label.box.h,
        };
        const side = label.inMargin ? label.side : PlacementSide.INSIDE;

        let arrowPath: Point[] = [];
        if (!skipArrows) {
          const highlightBox: BoundingBox = { x: h.x, y: h.y, width: h.width, height: h.height };
          const { start, end } = computeStraightConnectionLine(labelBox, highlightBox, side);
          arrowPath = [start, end];
        }

        results[origIdx] = { id: h.id, labelBox, arrowPath, side };
      }
    }
  };

  placeGroup(failedIndices);
  placeGroup(passedIndices);

  return results;
}
