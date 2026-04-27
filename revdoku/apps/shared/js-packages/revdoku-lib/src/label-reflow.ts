/**
 * Shared label resize + reflow functions.
 *
 * Used by both revdoku-doc-api (annotation-placer Step 3) and frontend (EnvelopePage)
 * to ensure labels are sized and compacted consistently at any font scale / zoom.
 */

import {
  estimateWrappedLabelDimensions,
  REVDOKU_MARGIN_LABEL_FONT_SIZE,
  REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
  REVDOKU_MARGIN_LABEL_INNER_PADDING,
  REVDOKU_LAYOUT_LABEL_MAX_LINES,
  REVDOKU_MIN_EFFECTIVE_FONT_SIZE,
} from './highlight-rendering-utils';
import { PlacementSide } from './common-types';

// ── Types ────────────────────────────────────────────────────────────────────

/** Descriptor for a label that can be resized and reflowed */
export interface LabelDescriptor {
  id: string;
  side: PlacementSide;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text content used for height estimation */
  description: string;
}

/** Options for calculateActualSizeForChecks */
export interface SizeOptions {
  /** User font scale multiplier (default 1.0) */
  fontScale?: number;
  /** Base font size in pixels (default REVDOKU_MARGIN_LABEL_FONT_SIZE = 12) */
  fontSize?: number;
  /** Line height ratio (default REVDOKU_MARGIN_LABEL_LINE_HEIGHT = 16/12) */
  lineHeightRatio?: number;
  /** Inner padding in pixels (default REVDOKU_MARGIN_LABEL_INNER_PADDING = 5) */
  innerPadding?: number;
  /** Max lines for text wrapping (default REVDOKU_LAYOUT_LABEL_MAX_LINES) */
  maxLines?: number;
  /** Border compensation in pixels (default 3) */
  borderCompensation?: number;
  /** Width taken by the floated badge circle + margin (default 0).
   *  Subtracted from effective text width to account for CSS float. */
  badgeCompensation?: number;
}

/** Options for adjustPositionsToAvoidCollision */
export interface CollisionOptions {
  /** Gap in pixels between adjacent labels */
  padding: number;
}

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Recalculate width and height for each label at the given font scale.
 *
 * Returns a new array of labels with updated width/height (no mutation).
 */
export function calculateActualSizeForChecks(
  labels: LabelDescriptor[],
  options?: SizeOptions,
): LabelDescriptor[] {
  const fontScale = options?.fontScale ?? 1.0;
  const baseFontSize = options?.fontSize ?? REVDOKU_MARGIN_LABEL_FONT_SIZE;
  const lineHeightRatio = options?.lineHeightRatio ?? REVDOKU_MARGIN_LABEL_LINE_HEIGHT;
  const baseInnerPadding = options?.innerPadding ?? REVDOKU_MARGIN_LABEL_INNER_PADDING;
  const maxLines = options?.maxLines ?? REVDOKU_LAYOUT_LABEL_MAX_LINES;
  const borderCompensation = options?.borderCompensation ?? 3;
  const badgeCompensation = options?.badgeCompensation ?? 0;

  return labels.map(label => {
    // Keep the original width — only font size changes, affecting text wrapping and height.
    // The label box width is set by revdoku-doc-api and should remain constant regardless of font scale.
    const scaledFontSize = Math.max(REVDOKU_MIN_EFFECTIVE_FONT_SIZE, baseFontSize * fontScale);
    const scaledPadding = baseInnerPadding * fontScale;

    // Reduce effective width to account for the floated badge circle
    // that takes horizontal space on the first few lines of text.
    // This produces a conservative (taller) estimate — safe for stacking.
    const effectiveWidth = Math.max(60, label.width - badgeCompensation);

    const est = estimateWrappedLabelDimensions(
      label.description,
      effectiveWidth,
      scaledFontSize,
      lineHeightRatio,
      scaledPadding,
      maxLines,
    );

    return {
      ...label,
      height: est.height + borderCompensation,
    };
  });
}

/**
 * Compact labels to avoid collisions by shifting overlapping labels.
 *
 * Processes each side independently:
 * - Right/left: vertical stacking (sort by Y, compact top-to-bottom)
 * - Top/bottom: horizontal stacking (sort by X, compact left-to-right)
 * - Inside: skipped (no collision adjustment)
 *
 * Returns a new array of labels with adjusted x/y (no mutation).
 */
export function adjustPositionsToAvoidCollision(
  labels: LabelDescriptor[],
  options: CollisionOptions,
): LabelDescriptor[] {
  const { padding } = options;

  // Clone all labels so we don't mutate the input
  const result = labels.map(l => ({ ...l }));

  // Group indices by side
  const groups: Record<string, number[]> = {
    right: [],
    left: [],
    top: [],
    bottom: [],
    inside: [],
  };
  for (let i = 0; i < result.length; i++) {
    const side = result[i].side;
    if (groups[side]) groups[side].push(i);
  }

  // Right and left: resolve vertical overlaps (preserve original positions from revdoku-doc-api)
  for (const side of ['right', 'left'] as const) {
    const indices = groups[side];
    if (indices.length < 2) continue;

    // Sort by Y ascending
    indices.sort((a, b) => result[a].y - result[b].y);

    // Only push labels down when they actually overlap the previous label
    for (let i = 1; i < indices.length; i++) {
      const prevIdx = indices[i - 1];
      const currIdx = indices[i];
      const minY = result[prevIdx].y + result[prevIdx].height + padding;
      if (result[currIdx].y < minY) {
        const shift = minY - result[currIdx].y;
        for (let j = i; j < indices.length; j++) {
          result[indices[j]].y += shift;
        }
      }
    }
  }

  // Top and bottom: resolve horizontal overlaps (preserve original positions)
  for (const side of ['top', 'bottom'] as const) {
    const indices = groups[side];
    if (indices.length < 2) continue;

    // Sort by X ascending
    indices.sort((a, b) => result[a].x - result[b].x);

    // Only push labels right when they actually overlap the previous label
    for (let i = 1; i < indices.length; i++) {
      const prevIdx = indices[i - 1];
      const currIdx = indices[i];
      const minX = result[prevIdx].x + result[prevIdx].width + padding;
      if (result[currIdx].x < minX) {
        const shift = minX - result[currIdx].x;
        for (let j = i; j < indices.length; j++) {
          result[indices[j]].x += shift;
        }
      }
    }
  }

  return result;
}
