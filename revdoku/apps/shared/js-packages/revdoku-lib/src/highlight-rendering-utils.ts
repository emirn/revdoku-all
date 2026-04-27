/**
 * Shared utilities for rendering check highlights across all platforms
 *
 * This module provides pure calculation functions for badge positioning,
 * message display, and other highlight rendering metrics. These functions
 * work identically across:
 * - Client-side React apps (lovable, web frontend) using CSS
 * - Server-side Node.js (revdoku-doc-api) using Canvas API
 *
 * Platform-specific rendering implementations should use these shared
 * calculations to ensure visual consistency.
 */

import { computeInlineLeader, computeMarginLeader, leaderToArrowPath } from './leader-router';
import type { LeaderRect, Leader } from './leader-router';
import { getCharWidthFactor, PlacementSide, CheckType, CheckFilterType } from './common-types';
import type { LabelFontFamily, ICoordinates } from './common-types';

// ============================================
// SECTION 1: CONSTANTS
// ============================================

/**
 * Badge size constraints
 */
export const REVDOKU_BADGE_SIZE_MIN = 22;
export const REVDOKU_BADGE_SIZE_MAX = 32;
export const REVDOKU_BADGE_SIZE_RATIO = 0.16; // Badge size as ratio of highlight dimensions

/**
 * Badge positioning and styling
 */
export const REVDOKU_BADGE_PADDING = 8; // Distance from corner
export const REVDOKU_BADGE_BORDER_WIDTH = 3;
export const REVDOKU_BADGE_BORDER_RADIUS = 4;
export const REVDOKU_BADGE_FONT_SIZE_RATIO = 0.62; // Font size as ratio of badge size

/**
 * Corner radius for highlight rectangles
 */
export const REVDOKU_CORNER_RADIUS_MIN = 4;
export const REVDOKU_CORNER_RADIUS_MAX = 12;
export const REVDOKU_CORNER_RADIUS_RATIO = 0.15; // From REVDOKU_HIGHLIGHT_ROUNDING_PERCENT in common-types

/**
 * Message display settings
 */
export const REVDOKU_MESSAGE_FONT_SIZE_MIN = 12;
export const REVDOKU_MESSAGE_FONT_SIZE_MAX = 17;
export const REVDOKU_MESSAGE_PADDING = 4;
export const REVDOKU_MESSAGE_BACKGROUND_OPACITY = 0.92;

/**
 * Source indicator badge (AI vs Envelope)
 */
export const REVDOKU_SOURCE_BADGE_SIZE = 24;
export const REVDOKU_SOURCE_BADGE_OFFSET = 8;

/**
 * Gap between hint label and highlight box edge (pixels)
 */
export const REVDOKU_HINT_GAP = 6;

/**
 * Maximum width for hint labels (pixels).
 * Prevents labels from spanning the full width of wide highlights (e.g. table rows).
 */
export const REVDOKU_MAX_HINT_LABEL_WIDTH = 400;

/**
 * Free-space placement constants
 */
export const REVDOKU_FREE_SPACE_DISTANCE_WEIGHT = 0.3;  // penalty per pixel of distance to highlight
export const REVDOKU_FREE_SPACE_MIN_WIDTH = 150;         // minimum free rect width to consider
export const REVDOKU_FREE_SPACE_MIN_HEIGHT = 30;         // minimum free rect height to consider

/**
 * Minimum label width to prevent super-tall narrow boxes (pixels)
 */
export const REVDOKU_MIN_HINT_LABEL_WIDTH = 130;

/**
 * Minimum psx used for font sizing — prevents tiny text on wide landscape documents.
 * At psx=0.75: effectiveFontSize = 12 * 0.75 = 9px (readable).
 * User's A-/A+ preference (userFontScale) is applied ON TOP of this, so users can still adjust.
 */
export const REVDOKU_MIN_LABEL_FONT_PSX = 0.75;

/**
 * Maximum psx used for font sizing — prevents enormous text on small images.
 * When a small image (e.g. 300×200) is rendered at viewer width (~1000px),
 * pageScaleX can be 3+ which makes labels 36px+. Capping at 1.5 keeps
 * effectiveFontSize at most 12 * 1.5 = 18px (before user A+/A- scaling).
 */
export const REVDOKU_MAX_LABEL_FONT_PSX = 1.5;

/**
 * Absolute minimum effective font size in pixels for annotation labels.
 * After all scaling (psx * userFontScale), the result is clamped to at least this value.
 * Ensures annotations remain readable even on very wide/large images.
 */
export const REVDOKU_MIN_EFFECTIVE_FONT_SIZE = 14;

/**
 * Maximum label width as fraction of page width
 */
export const REVDOKU_MAX_HINT_LABEL_WIDTH_RATIO = 0.5;

/**
 * Minimum pixel gap between labels in the same group
 */
export const REVDOKU_INTRA_GROUP_SPACING = 3;

/**
 * Arrow separation constants
 */
export const REVDOKU_MIN_ARROW_SEPARATION = 6;           // min px between parallel arrow segments
export const REVDOKU_PARALLEL_THRESHOLD = 0.85;          // dot product threshold for "nearly parallel"
export const REVDOKU_ARROW_EDGE_PADDING = 8;             // don't anchor arrows at extreme corners

// ============================================
// SECTION 1B: SHARED LABEL METRICS
// ============================================

/**
 * Label dimensions computed in document space (100% zoom / 1:1 pixel mapping).
 * Shared between frontend viewer and revdoku-doc-api export for consistency.
 */
export interface LabelMetrics {
  labelWidth: number;    // pixels in document space
  fontSize: number;      // pixels in document space
  lineHeight: number;    // pixels in document space
  padding: number;       // pixels in document space
}

/**
 * Compute label metrics in document space (100% zoom / 1:1 pixel mapping).
 * Shared between frontend viewer and revdoku-doc-api export for consistency.
 *
 * Frontend: uses returned values directly (CSS handles zoom via transform).
 * revdoku-doc-api: multiplies returned values by sizeScale for canvas coordinates.
 *
 * @param boxWidth - Label box width from description_position (document space)
 * @param fontScale - User A+/A- font scale preference (default 1.0)
 */
export function computeLabelMetrics(boxWidth: number, fontScale: number = 1.0): LabelMetrics {
  const fontSize = Math.max(REVDOKU_MIN_EFFECTIVE_FONT_SIZE, REVDOKU_MARGIN_LABEL_FONT_SIZE * fontScale);
  return {
    labelWidth: boxWidth * fontScale,
    fontSize,
    lineHeight: fontSize * REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
    padding: REVDOKU_MARGIN_LABEL_INNER_PADDING * fontScale,
  };
}

// ============================================
// SECTION 2: TYPE DEFINITIONS
// ============================================

/** Possible positions for a hint label relative to its highlight */
export enum LabelRelativePositionRelativeToHighlight {
  TOP = 'top',
  BOTTOM = 'bottom',
  RIGHT = 'right',
  LEFT = 'left',
}

/** Simple axis-aligned bounding box */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Input for the hint placement algorithm */
export interface HintPlacementInput {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
  ruleOrder?: number;
  passed?: boolean;
}

/** Result from the hint placement algorithm */
export interface HintPlacementResult {
  id: string;
  side: PlacementSide;
}

/** A 2D point */
export interface Point {
  x: number;
  y: number;
}

/**
 * Rectangular region on a page containing actual content (non-background).
 * Used for detecting empty whitespace areas where labels can be placed.
 */
export interface IContentBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Metrics for rendering the main rule number badge
 */
export interface BadgeMetrics {
  /** Badge width and height in pixels */
  size: number;
  /** X coordinate for badge center (top-left position) */
  x: number;
  /** Y coordinate for badge center (top-left position) */
  y: number;
  /** Font size for the rule number */
  fontSize: number;
  /** Border radius for rounded corners */
  borderRadius: number;
}

/**
 * Metrics for rendering the check message text
 */
export interface MessageMetrics {
  /** Display text (potentially truncated) */
  text: string;
  /** X coordinate for message text start */
  x: number;
  /** Y coordinate for message text baseline */
  y: number;
  /** Maximum width for the message area */
  width: number;
  /** Height of the message area including padding */
  height: number;
  /** Font size for the message text */
  fontSize: number;
  /** Padding around the message text */
  padding: number;
  /** Opacity for the message background */
  backgroundOpacity: number;
}

/**
 * Metrics for rendering the source indicator badge (AI/Envelope)
 */
export interface SourceBadgeMetrics {
  /** X coordinate for badge center (top-right position) */
  x: number;
  /** Y coordinate for badge center (top-right position) */
  y: number;
  /** Badge diameter in pixels */
  size: number;
}

// ============================================
// SECTION 3: BADGE CALCULATIONS
// ============================================

/**
 * Calculate all metrics needed to render the main rule number badge
 *
 * The badge is positioned at the top-left corner of the highlight with
 * a small offset (REVDOKU_BADGE_PADDING). Size scales with highlight dimensions
 * but is constrained to min/max bounds for readability.
 *
 * @param highlightX - Left edge of highlight rectangle
 * @param highlightY - Top edge of highlight rectangle
 * @param highlightWidth - Width of highlight rectangle
 * @param highlightHeight - Height of highlight rectangle
 * @returns Complete metrics for badge rendering
 */
export function calculateBadgeMetrics(
  highlightX: number,
  highlightY: number,
  highlightWidth: number,
  highlightHeight: number
): BadgeMetrics {
  // Calculate badge size as percentage of highlight, with min/max constraints
  const size = Math.max(
    REVDOKU_BADGE_SIZE_MIN,
    Math.min(REVDOKU_BADGE_SIZE_MAX, Math.min(highlightWidth, highlightHeight) * REVDOKU_BADGE_SIZE_RATIO)
  );

  // Position badge at top-left with offset
  // Note: Position is at badge center, offset from corner by (size/2 - padding)
  const x = highlightX + (size / 2 - REVDOKU_BADGE_PADDING);
  const y = highlightY + (size / 2 - REVDOKU_BADGE_PADDING);

  // Font size scales with badge size
  const fontSize = Math.max(12, size * REVDOKU_BADGE_FONT_SIZE_RATIO);

  return {
    size,
    x,
    y,
    fontSize,
    borderRadius: REVDOKU_BADGE_BORDER_RADIUS
  };
}

// ============================================
// SECTION 4: CORNER RADIUS
// ============================================

/**
 * Calculate corner radius for highlight rectangle borders
 *
 * Corner radius scales with highlight dimensions to maintain visual
 * consistency across different highlight sizes.
 *
 * @param width - Highlight rectangle width
 * @param height - Highlight rectangle height
 * @returns Corner radius in pixels
 */
export function calculateCornerRadius(width: number, height: number): number {
  return Math.min(
    REVDOKU_CORNER_RADIUS_MAX,
    Math.max(REVDOKU_CORNER_RADIUS_MIN, Math.min(width, height) * REVDOKU_CORNER_RADIUS_RATIO)
  );
}

// ============================================
// SECTION 5: MESSAGE DISPLAY
// ============================================

/**
 * Calculate metrics for displaying check message text within highlight
 *
 * Message is positioned at the bottom of the highlight with a semi-transparent
 * background. Text is truncated if it exceeds the available width.
 *
 * @param message - The check message/failure text to display
 * @param highlightX - Left edge of highlight rectangle
 * @param highlightY - Top edge of highlight rectangle
 * @param highlightWidth - Width of highlight rectangle
 * @param highlightHeight - Height of highlight rectangle
 * @param maxChars - Optional maximum characters (auto-calculated if not provided)
 * @param positionOutside - If true, position message BELOW the highlight box (default: false for backward compatibility)
 * @returns Complete metrics for message rendering
 */
export function calculateMessageMetrics(
  message: string,
  highlightX: number,
  highlightY: number,
  highlightWidth: number,
  highlightHeight: number,
  maxChars?: number,
  positionOutside: boolean = false,
  labelRelativePosition?: LabelRelativePositionRelativeToHighlight
): MessageMetrics {
  // Font size scales with highlight height but constrained to readable range
  const fontSize = Math.max(
    REVDOKU_MESSAGE_FONT_SIZE_MIN,
    Math.min(REVDOKU_MESSAGE_FONT_SIZE_MAX, highlightHeight * 0.15)
  );

  // Show full text (no truncation - frontend CSS handles overflow)
  const displayText = message;

  // Calculate message height
  const messageHeight = fontSize + (REVDOKU_MESSAGE_PADDING * 2);

  // Determine effective position
  const effectivePosition = labelRelativePosition || LabelRelativePositionRelativeToHighlight.BOTTOM;

  let messageX: number;
  let messageY: number;
  let messageWidth: number;

  if (!positionOutside && !labelRelativePosition) {
    // Legacy behavior: position at bottom inside the box
    messageX = highlightX + REVDOKU_MESSAGE_PADDING;
    messageY = highlightY + highlightHeight - messageHeight;
    messageWidth = highlightWidth - (REVDOKU_MESSAGE_PADDING * 2);
  } else {
    // Position outside the box based on labelRelativePosition
    const hintDims = estimateHintDimensions(message, highlightWidth, highlightHeight, maxChars);
    switch (effectivePosition) {
      case LabelRelativePositionRelativeToHighlight.TOP:
        messageX = highlightX + REVDOKU_MESSAGE_PADDING;
        messageY = highlightY - REVDOKU_HINT_GAP - messageHeight;
        messageWidth = highlightWidth - (REVDOKU_MESSAGE_PADDING * 2);
        break;
      case LabelRelativePositionRelativeToHighlight.RIGHT:
        messageX = highlightX + highlightWidth + REVDOKU_HINT_GAP;
        messageY = highlightY + (highlightHeight - messageHeight) / 2;
        messageWidth = hintDims.width - (REVDOKU_MESSAGE_PADDING * 2);
        break;
      case LabelRelativePositionRelativeToHighlight.LEFT:
        messageX = highlightX - REVDOKU_HINT_GAP - hintDims.width;
        messageY = highlightY + (highlightHeight - messageHeight) / 2;
        messageWidth = hintDims.width - (REVDOKU_MESSAGE_PADDING * 2);
        break;
      case LabelRelativePositionRelativeToHighlight.BOTTOM:
      default:
        messageX = highlightX + REVDOKU_MESSAGE_PADDING;
        messageY = highlightY + highlightHeight + REVDOKU_HINT_GAP;
        messageWidth = highlightWidth - (REVDOKU_MESSAGE_PADDING * 2);
        break;
    }
  }

  return {
    text: displayText,
    x: messageX + REVDOKU_MESSAGE_PADDING,
    y: messageY + fontSize, // Y is text baseline, not top of box
    width: messageWidth,
    height: messageHeight,
    fontSize,
    padding: REVDOKU_MESSAGE_PADDING,
    backgroundOpacity: REVDOKU_MESSAGE_BACKGROUND_OPACITY
  };
}

// ============================================
// SECTION 6: SOURCE INDICATOR BADGE
// ============================================

/**
 * Calculate position for the source indicator badge (AI vs Envelope)
 *
 * Badge is positioned at the top-right corner of the highlight.
 *
 * @param highlightX - Left edge of highlight rectangle
 * @param highlightY - Top edge of highlight rectangle
 * @param highlightWidth - Width of highlight rectangle
 * @returns Position metrics for source badge
 */
export function calculateSourceBadgePosition(
  highlightX: number,
  highlightY: number,
  highlightWidth: number
): SourceBadgeMetrics {
  return {
    x: highlightX + highlightWidth - REVDOKU_SOURCE_BADGE_OFFSET,
    y: highlightY - REVDOKU_SOURCE_BADGE_OFFSET,
    size: REVDOKU_SOURCE_BADGE_SIZE
  };
}

// ============================================
// SECTION 7: HINT COLLISION AVOIDANCE
// ============================================

/**
 * Estimate the pixel dimensions of a hint label from its text content.
 * Uses MESSAGE_FONT_SIZE constants and ~0.55px per character width.
 * Estimates multi-line wrapped dimensions (no truncation).
 */
export function estimateHintDimensions(
  description: string,
  highlightWidth: number,
  highlightHeight: number,
  maxChars?: number,
  fontFamily?: LabelFontFamily
): { width: number; height: number } {
  const fontSize = Math.max(
    REVDOKU_MESSAGE_FONT_SIZE_MIN,
    Math.min(REVDOKU_MESSAGE_FONT_SIZE_MAX, highlightHeight * 0.15)
  );
  const charWidth = fontSize * getCharWidthFactor(fontFamily);
  const labelPaddingH = 12; // 4px + 8px CSS padding
  const labelPaddingV = 8;  // top + bottom padding
  const availableWidth = Math.min(REVDOKU_MAX_HINT_LABEL_WIDTH, Math.max(highlightWidth, 120));
  const textWidth = availableWidth - labelPaddingH;

  // Word-based line wrapping (matches browser behavior)
  const words = description.split(/\s+/);
  let lineCount = 1;
  let currentLineWidth = 0;
  for (const word of words) {
    const wordWidth = word.length * charWidth;
    if (currentLineWidth + wordWidth > textWidth && currentLineWidth > 0) {
      lineCount++;
      currentLineWidth = wordWidth + charWidth; // word + space
    } else {
      currentLineWidth += (currentLineWidth > 0 ? charWidth : 0) + wordWidth;
    }
  }

  const lineHeight = fontSize * 1.3;
  const height = lineCount * lineHeight + labelPaddingV;
  const width = Math.min(description.length * charWidth + labelPaddingH, availableWidth + labelPaddingH);
  return { width: Math.max(width, 40), height: Math.max(height, fontSize + labelPaddingV) };
}

/**
 * Calculate the bounding box of a hint label at a given position
 * relative to its highlight rectangle.
 */
export function calculateHintBoundingBox(
  highlight: { x: number; y: number; width: number; height: number },
  position: LabelRelativePositionRelativeToHighlight,
  hintWidth: number,
  hintHeight: number
): BoundingBox {
  switch (position) {
    case LabelRelativePositionRelativeToHighlight.TOP: {
      const xOffset = hintWidth < highlight.width ? (highlight.width - hintWidth) / 2 : 0;
      return {
        x: highlight.x + xOffset,
        y: highlight.y - REVDOKU_HINT_GAP - hintHeight,
        width: hintWidth,
        height: hintHeight,
      };
    }
    case LabelRelativePositionRelativeToHighlight.RIGHT:
      return {
        x: highlight.x + highlight.width + REVDOKU_HINT_GAP,
        y: highlight.y + (highlight.height - hintHeight) / 2,
        width: hintWidth,
        height: hintHeight,
      };
    case LabelRelativePositionRelativeToHighlight.LEFT:
      return {
        x: highlight.x - REVDOKU_HINT_GAP - hintWidth,
        y: highlight.y + (highlight.height - hintHeight) / 2,
        width: hintWidth,
        height: hintHeight,
      };
    case LabelRelativePositionRelativeToHighlight.BOTTOM:
    default: {
      const xOffset = hintWidth < highlight.width ? (highlight.width - hintWidth) / 2 : 0;
      return {
        x: highlight.x + xOffset,
        y: highlight.y + highlight.height + REVDOKU_HINT_GAP,
        width: hintWidth,
        height: hintHeight,
      };
    }
  }
}

/** Fraction of box dimension to tolerate as overlap before triggering collision (5%) */
export const REVDOKU_LABEL_OVERLAP_TOLERANCE = 0.05;

/** Check if two BoundingBoxes overlap, allowing tolerance fraction of overlap */
export function boundingBoxesOverlap(a: BoundingBox, b: BoundingBox, tolerance: number = 0): boolean {
  const tx = a.width * tolerance;
  const ty = a.height * tolerance;
  return (a.x + tx) < b.x + b.width && (a.x + a.width - tx) > b.x &&
         (a.y + ty) < b.y + b.height && (a.y + a.height - ty) > b.y;
}

/**
 * Calculate the intersection area of two axis-aligned bounding boxes.
 * Returns 0 if they don't overlap.
 */
export function calculateOverlapArea(a: BoundingBox, b: BoundingBox): number {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlapX * overlapY;
}

/**
 * Calculate how much of a bounding box falls outside the page bounds.
 */
export function calculateOutOfBoundsArea(box: BoundingBox, pageWidth: number, pageHeight: number): number {
  let outArea = 0;
  if (box.x < 0) outArea += Math.abs(box.x) * box.height;
  if (box.y < 0) outArea += Math.abs(box.y) * box.width;
  if (box.x + box.width > pageWidth) outArea += (box.x + box.width - pageWidth) * box.height;
  if (box.y + box.height > pageHeight) outArea += (box.y + box.height - pageHeight) * box.width;
  return outArea;
}

/**
 * Crop a check rectangle to fit only areas that contain actual content.
 * Intersects the check with overlapping content boxes and returns the
 * tightest bounding box. Returns original coords if no content boxes overlap.
 * Upstream size capping in normalizeCheckLocations (80% max) prevents oversized highlights.
 */
export function cropCheckToContentBoxes(
  check: { x1: number; y1: number; x2: number; y2: number },
  contentBoxes: IContentBox[],
  pageWidth: number,
  margin: number = 5,
  minWidth: number = 30,
  minHeight: number = 20,
): { x1: number; y1: number; x2: number; y2: number } {
  // Find all content boxes that overlap with this check
  const overlapping = contentBoxes.filter(cb =>
    cb.x1 < check.x2 && cb.x2 > check.x1 &&
    cb.y1 < check.y2 && cb.y2 > check.y1
  );

  let result = { ...check };

  if (overlapping.length > 0) {
    // Compute union bounding box of the intersections
    let cropX1 = Infinity, cropY1 = Infinity, cropX2 = -Infinity, cropY2 = -Infinity;
    for (const cb of overlapping) {
      cropX1 = Math.min(cropX1, Math.max(cb.x1, check.x1));
      cropY1 = Math.min(cropY1, Math.max(cb.y1, check.y1));
      cropX2 = Math.max(cropX2, Math.min(cb.x2, check.x2));
      cropY2 = Math.max(cropY2, Math.min(cb.y2, check.y2));
    }

    // Add margin
    cropX1 = Math.max(check.x1, cropX1 - margin);
    cropY1 = Math.max(check.y1, cropY1 - margin);
    cropX2 = Math.min(check.x2, cropX2 + margin);
    cropY2 = Math.min(check.y2, cropY2 + margin);

    // Only apply crop if result is large enough
    if (cropX2 - cropX1 >= minWidth && cropY2 - cropY1 >= minHeight) {
      result = { x1: cropX1, y1: cropY1, x2: cropX2, y2: cropY2 };
    }
  }

  return result;
}

/**
 * Snap a check rectangle to fully wrap the content boxes it overlaps.
 * Unlike cropCheckToContentBoxes (which narrows to intersections), this
 * expands to the union of full content boxes, so highlights snap to
 * content boundaries and may be larger than the original.
 * Returns original coords if no content boxes overlap or result is too small.
 */
export function wrapCheckAroundContentBoxes(
  check: { x1: number; y1: number; x2: number; y2: number },
  contentBoxes: IContentBox[],
  pageWidth: number,
  pageHeight: number,
  margin: number = 5,
  minWidth: number = 30,
  minHeight: number = 20,
  maxExpansionFactor: number = 2.0,
): { x1: number; y1: number; x2: number; y2: number } {
  // Find content boxes that overlap the highlight
  const overlapping = contentBoxes.filter(cb =>
    cb.x1 < check.x2 && cb.x2 > check.x1 &&
    cb.y1 < check.y2 && cb.y2 > check.y1
  );

  if (overlapping.length === 0) return { ...check };

  // Union of FULL content boxes (not intersection)
  let wrapX1 = Infinity, wrapY1 = Infinity;
  let wrapX2 = -Infinity, wrapY2 = -Infinity;
  for (const cb of overlapping) {
    wrapX1 = Math.min(wrapX1, cb.x1);
    wrapY1 = Math.min(wrapY1, cb.y1);
    wrapX2 = Math.max(wrapX2, cb.x2);
    wrapY2 = Math.max(wrapY2, cb.y2);
  }

  // Clamp expansion per-axis so neither dimension exceeds original × maxExpansionFactor
  const origW = check.x2 - check.x1;
  const origH = check.y2 - check.y1;
  const maxW = origW * maxExpansionFactor;
  const maxH = origH * maxExpansionFactor;
  const wrapW = wrapX2 - wrapX1;
  const wrapH = wrapY2 - wrapY1;

  if (wrapW > maxW) {
    // Trim symmetrically, anchored to the original highlight center
    const centerX = (check.x1 + check.x2) / 2;
    wrapX1 = Math.max(wrapX1, centerX - maxW / 2);
    wrapX2 = Math.min(wrapX2, centerX + maxW / 2);
  }
  if (wrapH > maxH) {
    const centerY = (check.y1 + check.y2) / 2;
    wrapY1 = Math.max(wrapY1, centerY - maxH / 2);
    wrapY2 = Math.min(wrapY2, centerY + maxH / 2);
  }

  // Add padding
  wrapX1 = Math.max(0, wrapX1 - margin);
  wrapY1 = Math.max(0, wrapY1 - margin);
  wrapX2 = Math.min(pageWidth, wrapX2 + margin);
  wrapY2 = Math.min(pageHeight, wrapY2 + margin);

  // Only apply if result meets minimum size
  if (wrapX2 - wrapX1 >= minWidth && wrapY2 - wrapY1 >= minHeight) {
    return { x1: wrapX1, y1: wrapY1, x2: wrapX2, y2: wrapY2 };
  }

  return { ...check };
}

// ============================================
// SECTION 7B: FREE-SPACE DECOMPOSITION
// ============================================

/** An interval on one axis */
interface Interval {
  start: number;
  end: number;
}

/**
 * Find free (unoccupied) rectangles on the page using Y-band sweep.
 *
 * Algorithm:
 * 1. Collect unique Y coordinates from all occupied rects → defines Y bands
 * 2. For each Y band, compute free X intervals (complement of occupied X intervals)
 * 3. Each (free X interval × Y band) = one free rectangle
 * 4. Filter by minimum size
 */
export function findFreeRectangles(
  occupied: BoundingBox[],
  pageWidth: number,
  pageHeight: number,
  minWidth: number = REVDOKU_FREE_SPACE_MIN_WIDTH,
  minHeight: number = REVDOKU_FREE_SPACE_MIN_HEIGHT
): BoundingBox[] {
  if (occupied.length === 0) {
    // Entire page is free
    return [{ x: 0, y: 0, width: pageWidth, height: pageHeight }];
  }

  // Collect unique Y coordinates
  const yCoords = new Set<number>();
  yCoords.add(0);
  yCoords.add(pageHeight);
  for (const r of occupied) {
    yCoords.add(Math.max(0, r.y));
    yCoords.add(Math.min(pageHeight, r.y + r.height));
  }
  const sortedYs = Array.from(yCoords).sort((a, b) => a - b);

  const freeRects: BoundingBox[] = [];

  // Process each Y band
  for (let i = 0; i < sortedYs.length - 1; i++) {
    const bandTop = sortedYs[i];
    const bandBottom = sortedYs[i + 1];
    const bandHeight = bandBottom - bandTop;
    if (bandHeight < 1) continue;

    // Collect occupied X intervals that overlap this Y band
    const xIntervals: Interval[] = [];
    for (const r of occupied) {
      const rTop = r.y;
      const rBottom = r.y + r.height;
      if (rTop < bandBottom && rBottom > bandTop) {
        xIntervals.push({
          start: Math.max(0, r.x),
          end: Math.min(pageWidth, r.x + r.width),
        });
      }
    }

    // Sort and merge overlapping X intervals
    xIntervals.sort((a, b) => a.start - b.start);
    const merged: Interval[] = [];
    for (const iv of xIntervals) {
      if (merged.length > 0 && iv.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, iv.end);
      } else {
        merged.push({ start: iv.start, end: iv.end });
      }
    }

    // Compute free X intervals (complement)
    let prevEnd = 0;
    for (const iv of merged) {
      if (iv.start > prevEnd) {
        freeRects.push({ x: prevEnd, y: bandTop, width: iv.start - prevEnd, height: bandHeight });
      }
      prevEnd = Math.max(prevEnd, iv.end);
    }
    if (prevEnd < pageWidth) {
      freeRects.push({ x: prevEnd, y: bandTop, width: pageWidth - prevEnd, height: bandHeight });
    }
  }

  // Merge vertically adjacent free rects that share the same X range
  const mergedFree = mergeVerticalFreeRects(freeRects);

  // Filter by minimum dimensions
  return mergedFree.filter(r => r.width >= minWidth && r.height >= minHeight);
}

/**
 * Merge vertically adjacent free rectangles that share the same X range.
 * This consolidates thin Y-band slivers into larger usable rectangles.
 */
function mergeVerticalFreeRects(rects: BoundingBox[]): BoundingBox[] {
  if (rects.length <= 1) return rects;

  // Sort by x, then y
  const sorted = [...rects].sort((a, b) => {
    const dx = a.x - b.x;
    if (Math.abs(dx) > 0.5) return dx;
    const dw = a.width - b.width;
    if (Math.abs(dw) > 0.5) return dw;
    return a.y - b.y;
  });

  const merged: BoundingBox[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    // Adjacent vertically and same X range (within tolerance)
    if (
      Math.abs(next.x - current.x) < 1 &&
      Math.abs(next.width - current.width) < 1 &&
      Math.abs(next.y - (current.y + current.height)) < 1
    ) {
      current.height += next.height;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

/**
 * Position a label within a free rectangle, as close as possible to the target highlight.
 */
function positionLabelInFreeRect(
  freeRect: BoundingBox,
  labelWidth: number,
  labelHeight: number,
  highlight: BoundingBox
): BoundingBox {
  const highlightCenterX = highlight.x + highlight.width / 2;
  const highlightCenterY = highlight.y + highlight.height / 2;

  // Clamp label X to fit within free rect, preferring alignment with highlight center
  const x = clamp(
    highlightCenterX - labelWidth / 2,
    freeRect.x,
    freeRect.x + freeRect.width - labelWidth
  );

  // Clamp label Y to fit within free rect, preferring proximity to highlight center
  const y = clamp(
    highlightCenterY - labelHeight / 2,
    freeRect.y,
    freeRect.y + freeRect.height - labelHeight
  );

  return { x, y, width: labelWidth, height: labelHeight };
}

/**
 * Infer the hint position direction from highlight to label placement.
 */
export function inferLabelRelativePositionRelativeToHighlight(highlight: BoundingBox, label: BoundingBox): LabelRelativePositionRelativeToHighlight {
  const hCenterX = highlight.x + highlight.width / 2;
  const hCenterY = highlight.y + highlight.height / 2;
  const lCenterX = label.x + label.width / 2;
  const lCenterY = label.y + label.height / 2;

  const dx = lCenterX - hCenterX;
  const dy = lCenterY - hCenterY;

  // Determine dominant direction
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? LabelRelativePositionRelativeToHighlight.RIGHT : LabelRelativePositionRelativeToHighlight.LEFT;
  } else {
    return dy > 0 ? LabelRelativePositionRelativeToHighlight.BOTTOM : LabelRelativePositionRelativeToHighlight.TOP;
  }
}

/**
 * Clamp a value between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const CANDIDATE_POSITIONS: LabelRelativePositionRelativeToHighlight[] = [
  LabelRelativePositionRelativeToHighlight.BOTTOM,
  LabelRelativePositionRelativeToHighlight.TOP,
  LabelRelativePositionRelativeToHighlight.RIGHT,
  LabelRelativePositionRelativeToHighlight.LEFT,
];

/**
 * Resolve hint label positions for a set of highlights to minimize overlaps.
 *
 * Greedy algorithm: processes highlights top-to-bottom, left-to-right.
 * For each highlight, scores all 4 candidate positions by summing:
 *   - overlap with all highlight boxes
 *   - overlap with already-placed hint boxes
 *   - 2x penalty for out-of-bounds area
 *
 * Picks the position with the minimum total penalty.
 * Complexity: O(n^2) per page — fine for typical documents (<50 highlights).
 */
export function resolveLabelRelativePositionRelativeToHighlights(
  highlights: HintPlacementInput[],
  pageWidth: number,
  pageHeight: number
): HintPlacementResult[] {
  if (highlights.length === 0) return [];
  if (highlights.length === 1) {
    return [{ id: highlights[0].id, side: PlacementSide.INSIDE }];
  }

  // Build sorted index array (top-to-bottom, left-to-right)
  const indices = highlights.map((_, i) => i);
  indices.sort((a, b) => {
    const ha = highlights[a];
    const hb = highlights[b];
    const dy = ha.y - hb.y;
    return dy !== 0 ? dy : ha.x - hb.x;
  });

  // Precompute highlight bounding boxes (the highlight rectangles themselves)
  const highlightBoxes: BoundingBox[] = highlights.map(h => ({
    x: h.x, y: h.y, width: h.width, height: h.height,
  }));

  // Precompute hint dimensions for each highlight
  const hintDims = highlights.map(h => estimateHintDimensions(h.description, h.width, h.height));

  // Track placed hint bounding boxes
  const placedHints: BoundingBox[] = [];

  // Results stored by original index
  const results: HintPlacementResult[] = new Array(highlights.length);

  for (const idx of indices) {
    const h = highlights[idx];
    const dims = hintDims[idx];

    // Skip highlights with no description — default to bottom
    if (!h.description) {
      results[idx] = { id: h.id, side: PlacementSide.INSIDE };
      continue;
    }

    let bestPosition = LabelRelativePositionRelativeToHighlight.BOTTOM;
    let bestPenalty = Infinity;

    for (const pos of CANDIDATE_POSITIONS) {
      const hintBox = calculateHintBoundingBox(
        { x: h.x, y: h.y, width: h.width, height: h.height },
        pos,
        dims.width,
        dims.height
      );

      // Sum overlap with all highlight rectangles
      let penalty = 0;
      for (const hb of highlightBoxes) {
        penalty += calculateOverlapArea(hintBox, hb);
      }

      // Sum overlap with already-placed hints
      for (const ph of placedHints) {
        penalty += calculateOverlapArea(hintBox, ph);
      }

      // Out-of-bounds penalty (2x weight)
      penalty += 2 * calculateOutOfBoundsArea(hintBox, pageWidth, pageHeight);

      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestPosition = pos;
        if (penalty === 0) break; // Can't do better than zero
      }
    }

    results[idx] = { id: h.id, side: PlacementSide.INSIDE };

    // Record placed hint box for future collision checks
    const placedBox = calculateHintBoundingBox(
      { x: h.x, y: h.y, width: h.width, height: h.height },
      bestPosition,
      dims.width,
      dims.height
    );
    placedHints.push(placedBox);
  }

  return results;
}

/** Extended result from the hint placement algorithm with full placement info */
export interface HintPlacementResultExtended extends HintPlacementResult {
  /** The bounding box of the label */
  labelBox: BoundingBox;
  /** The arrow path from highlight edge to label */
  arrowPath: Point[];
  /** Leader line geometry — preferred over arrowPath when present */
  leader?: Leader;
}

/**
 * Options for the enhanced hint placement algorithm with content box avoidance
 */
export interface HintPlacementOptions {
  /** Areas with content to avoid when placing labels */
  contentBoxes?: IContentBox[];
  /** Right margin width for fallback placement (default: 220) */
  marginWidth?: number;
  /** Penalty weight for overlapping content boxes (default: 1.5) */
  contentOverlapWeight?: number;
  /** Penalty threshold to trigger margin fallback (default: 500) */
  fallbackThreshold?: number;
  /** Skip arrow path computation (default: false). Set true when arrows are derived at render time. */
  skipArrowComputation?: boolean;
  /** User-controlled label font scale multiplier (default: 1.0). Scales label box sizing to match rendered font. */
  labelFontScale?: number;
  /** Font family for label sizing estimation */
  fontFamily?: LabelFontFamily;
}

/**
 * Compute arrow path using smart anchor points.
 * Arrow points FROM label TO highlight (first point = label edge, last point = highlight edge).
 *
 * Instead of always anchoring at edge center, projects the opposing center onto
 * the connecting edge, clamped with padding. This means:
 * - If label is top-left, arrow aims at the left portion of highlight top edge
 * - If label is top-right, arrow aims at the right portion
 * - Arrows naturally diverge instead of converging at center
 */
export function computeShortestArrowPath(
  highlight: { x: number; y: number; width: number; height: number },
  label: { x: number; y: number; width: number; height: number },
  position: LabelRelativePositionRelativeToHighlight
): Point[] {
  const labelCenterX = label.x + label.width / 2;
  const labelCenterY = label.y + label.height / 2;
  const highlightCenterX = highlight.x + highlight.width / 2;
  const highlightCenterY = highlight.y + highlight.height / 2;

  let labelAnchor: Point;
  let highlightAnchor: Point;

  switch (position) {
    case LabelRelativePositionRelativeToHighlight.TOP: {
      // Label bottom edge → Highlight top edge
      const hAnchorX = clamp(labelCenterX, highlight.x + REVDOKU_ARROW_EDGE_PADDING, highlight.x + highlight.width - REVDOKU_ARROW_EDGE_PADDING);
      const lAnchorX = clamp(highlightCenterX, label.x + REVDOKU_ARROW_EDGE_PADDING, label.x + label.width - REVDOKU_ARROW_EDGE_PADDING);
      labelAnchor = { x: lAnchorX, y: label.y + label.height };
      highlightAnchor = { x: hAnchorX, y: highlight.y };
      break;
    }
    case LabelRelativePositionRelativeToHighlight.BOTTOM: {
      // Label top edge → Highlight bottom edge
      const hAnchorX = clamp(labelCenterX, highlight.x + REVDOKU_ARROW_EDGE_PADDING, highlight.x + highlight.width - REVDOKU_ARROW_EDGE_PADDING);
      const lAnchorX = clamp(highlightCenterX, label.x + REVDOKU_ARROW_EDGE_PADDING, label.x + label.width - REVDOKU_ARROW_EDGE_PADDING);
      labelAnchor = { x: lAnchorX, y: label.y };
      highlightAnchor = { x: hAnchorX, y: highlight.y + highlight.height };
      break;
    }
    case LabelRelativePositionRelativeToHighlight.RIGHT: {
      // Label left edge → Highlight right edge
      const hAnchorY = clamp(labelCenterY, highlight.y + REVDOKU_ARROW_EDGE_PADDING, highlight.y + highlight.height - REVDOKU_ARROW_EDGE_PADDING);
      const lAnchorY = clamp(highlightCenterY, label.y + REVDOKU_ARROW_EDGE_PADDING, label.y + label.height - REVDOKU_ARROW_EDGE_PADDING);
      labelAnchor = { x: label.x, y: lAnchorY };
      highlightAnchor = { x: highlight.x + highlight.width, y: hAnchorY };
      break;
    }
    case LabelRelativePositionRelativeToHighlight.LEFT: {
      // Label right edge → Highlight left edge
      const hAnchorY = clamp(labelCenterY, highlight.y + REVDOKU_ARROW_EDGE_PADDING, highlight.y + highlight.height - REVDOKU_ARROW_EDGE_PADDING);
      const lAnchorY = clamp(highlightCenterY, label.y + REVDOKU_ARROW_EDGE_PADDING, label.y + label.height - REVDOKU_ARROW_EDGE_PADDING);
      labelAnchor = { x: label.x + label.width, y: lAnchorY };
      highlightAnchor = { x: highlight.x, y: hAnchorY };
      break;
    }
  }

  return [labelAnchor, highlightAnchor];
}

/**
 * Convert IContentBox to BoundingBox for overlap calculations
 */
function contentBoxToBoundingBox(cb: IContentBox): BoundingBox {
  return {
    x: cb.x1,
    y: cb.y1,
    width: cb.x2 - cb.x1,
    height: cb.y2 - cb.y1,
  };
}

/**
 * Compute the minimum edge-to-edge gap between two axis-aligned bounding boxes.
 * Returns 0 if they overlap.
 */
function computeGapBetweenBoxes(a: BoundingBox, b: BoundingBox): number {
  const gapX = Math.max(0, Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)));
  const gapY = Math.max(0, Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height)));
  // If they overlap on one axis, the gap is only on the other axis
  const overlapX = (a.x + a.width > b.x) && (b.x + b.width > a.x);
  const overlapY = (a.y + a.height > b.y) && (b.y + b.height > a.y);
  if (overlapX && overlapY) return 0; // boxes overlap
  if (overlapX) return gapY;          // aligned horizontally, gap is vertical
  if (overlapY) return gapX;          // aligned vertically, gap is horizontal
  return Math.sqrt(gapX * gapX + gapY * gapY); // diagonal gap
}

/**
 * Compute an L-shaped arrow polyline from label anchor to highlight anchor.
 * The path has a single 90-degree turn at a midpoint.
 *
 * For top/bottom positions: vertical first, then horizontal
 * For left/right positions: horizontal first, then vertical
 */
function computeLShapedArrowPath(
  labelAnchor: Point,
  highlightAnchor: Point,
  position: LabelRelativePositionRelativeToHighlight
): Point[] {
  let turnPoint: Point;

  switch (position) {
    case LabelRelativePositionRelativeToHighlight.TOP:
    case LabelRelativePositionRelativeToHighlight.BOTTOM:
      // Go vertical from label, then horizontal to highlight
      turnPoint = { x: labelAnchor.x, y: highlightAnchor.y };
      break;
    case LabelRelativePositionRelativeToHighlight.LEFT:
    case LabelRelativePositionRelativeToHighlight.RIGHT:
      // Go horizontal from label, then vertical to highlight
      turnPoint = { x: highlightAnchor.x, y: labelAnchor.y };
      break;
  }

  // Skip the turn point if it's nearly coincident with either endpoint
  const dToLabel = Math.abs(turnPoint.x - labelAnchor.x) + Math.abs(turnPoint.y - labelAnchor.y);
  const dToHighlight = Math.abs(turnPoint.x - highlightAnchor.x) + Math.abs(turnPoint.y - highlightAnchor.y);
  if (dToLabel < 3 || dToHighlight < 3) {
    return [labelAnchor, highlightAnchor];
  }

  return [labelAnchor, turnPoint, highlightAnchor];
}

/**
 * Generate candidate label boxes at multiple alignment offsets along highlight edges.
 *
 * Instead of only centering labels on each edge, this slides labels along the
 * highlight edge at multiple offsets (0%, 25%, 50%, 75%, 100% of available range).
 * This dramatically reduces overlaps for wide highlights (e.g. table rows) where
 * all centered labels would compete for the same X position.
 *
 * For top/bottom: slides along X axis (5 positions if range >= 20px, else 1 centered)
 * For left/right: slides along Y axis (3 positions if range >= 10px, else 1 centered)
 * Result: up to 5+5+3+3 = 16 positions per label size (vs 4 centered before).
 */
function generateAdjacentCandidates(
  highlight: BoundingBox,
  labelWidth: number,
  labelHeight: number,
): { position: LabelRelativePositionRelativeToHighlight; box: BoundingBox }[] {
  const candidates: { position: LabelRelativePositionRelativeToHighlight; box: BoundingBox }[] = [];

  // Top and bottom: slide along X axis
  for (const pos of [LabelRelativePositionRelativeToHighlight.TOP, LabelRelativePositionRelativeToHighlight.BOTTOM]) {
    const yVal = pos === LabelRelativePositionRelativeToHighlight.TOP
      ? highlight.y - REVDOKU_HINT_GAP - labelHeight
      : highlight.y + highlight.height + REVDOKU_HINT_GAP;
    const slideRange = Math.max(0, highlight.width - labelWidth);

    if (slideRange < 20) {
      // Label nearly as wide as highlight — just use center
      const xOffset = slideRange / 2;
      candidates.push({
        position: pos,
        box: { x: highlight.x + xOffset, y: yVal, width: labelWidth, height: labelHeight },
      });
    } else {
      // 5 positions: 0%, 25%, 50%, 75%, 100%
      for (const frac of [0, 0.25, 0.5, 0.75, 1.0]) {
        const xOffset = slideRange * frac;
        candidates.push({
          position: pos,
          box: { x: highlight.x + xOffset, y: yVal, width: labelWidth, height: labelHeight },
        });
      }
    }
  }

  // Left and right: slide along Y axis
  for (const pos of [LabelRelativePositionRelativeToHighlight.RIGHT, LabelRelativePositionRelativeToHighlight.LEFT]) {
    const xVal = pos === LabelRelativePositionRelativeToHighlight.RIGHT
      ? highlight.x + highlight.width + REVDOKU_HINT_GAP
      : highlight.x - REVDOKU_HINT_GAP - labelWidth;
    const slideRange = Math.max(0, highlight.height - labelHeight);

    if (slideRange < 10) {
      // Label nearly as tall as highlight — just use center
      const yOffset = slideRange / 2;
      candidates.push({
        position: pos,
        box: { x: xVal, y: highlight.y + yOffset, width: labelWidth, height: labelHeight },
      });
    } else {
      // 3 positions: 0%, 50%, 100%
      for (const frac of [0, 0.5, 1.0]) {
        const yOffset = slideRange * frac;
        candidates.push({
          position: pos,
          box: { x: xVal, y: highlight.y + yOffset, width: labelWidth, height: labelHeight },
        });
      }
    }
  }

  return candidates;
}

/**
 * Extended version of resolveLabelRelativePositionRelativeToHighlights that returns full placement info.
 *
 * Hybrid Label Placement Algorithm:
 * For each group (failed/passed) tries 2 strategies and picks the lowest penalty:
 *   A) Adjacent placement — labels next to highlights + free-space + per-label margin fallback
 *   B) Right-margin — all labels packed top-to-bottom in right margin
 *
 * Strategy A uses a per-label hybrid approach: each label individually tries adjacent
 * placement first, then free-space, and if penalty still exceeds fallbackThreshold,
 * that specific label falls back to the margin while others stay adjacent.
 *
 * Returns:
 * - labelBox: The actual label bounding box
 * - arrowPath: The arrow path (empty if skipArrowComputation)
 * - side: PlacementSide indicating which side the label is on
 *
 * Penalty calculation per label:
 * - Overlap with highlight boxes: 1x weight
 * - Overlap with placed labels (same group): 1x weight
 * - Overlap with content boxes: configurable weight (default 2x)
 * - Out-of-bounds area: 2x weight
 * - Distance from label to highlight: 0.3x per px
 * - Intra-group spacing violation (0 < gap < REVDOKU_INTRA_GROUP_SPACING): penalty
 */
export function resolveLabelRelativePositionRelativeToHighlightsExtended(
  highlights: HintPlacementInput[],
  pageWidth: number,
  pageHeight: number,
  options?: HintPlacementOptions
): HintPlacementResultExtended[] {
  if (highlights.length === 0) return [];

  const marginWidth = options?.marginWidth ?? REVDOKU_ANNOTATION_MARGIN;
  const contentBoxes = options?.contentBoxes || [];
  const skipArrows = options?.skipArrowComputation ?? false;
  const contentOverlapWeight = options?.contentOverlapWeight ?? 1.5;
  const fallbackThreshold = options?.fallbackThreshold ?? 500;
  const optFontFamily = options?.fontFamily;

  // Convert content boxes to BoundingBox for overlap calculations
  const contentBBs: BoundingBox[] = contentBoxes.map(contentBoxToBoundingBox);

  // Separate highlights into failed/passed groups
  const allIndices = highlights.map((_, i) => i);
  const failedIndices = allIndices.filter(i => highlights[i].passed !== true);
  const passedIndices = allIndices.filter(i => highlights[i].passed === true);

  const results: HintPlacementResultExtended[] = new Array(highlights.length);

  // Precompute highlight bounding boxes
  const highlightBBs: BoundingBox[] = highlights.map(h => ({
    x: h.x, y: h.y, width: h.width, height: h.height,
  }));

  // Greedy placement for a group of highlight indices
  const placeGroup = (groupIndices: number[]): void => {
    if (groupIndices.length === 0) return;

    // Sort group top-to-bottom, left-to-right
    const sorted = [...groupIndices].sort((a, b) => {
      const dy = highlights[a].y - highlights[b].y;
      return dy !== 0 ? dy : highlights[a].x - highlights[b].x;
    });

    const placedLabels: BoundingBox[] = [];
    const marginLabels: { origIdx: number; description: string }[] = [];

    for (const origIdx of sorted) {
      const h = highlights[origIdx];
      if (!h.description) {
        results[origIdx] = {
          id: h.id,
          labelBox: { x: h.x, y: h.y + h.height + REVDOKU_HINT_GAP, width: 100, height: 25 },
          arrowPath: [], side: PlacementSide.INSIDE,
        };
        continue;
      }

      const highlightBB = highlightBBs[origIdx];
      const sizeCandidates = generateLabelSizeCandidates(h.description, LABEL_MAX_LINES, pageWidth, optFontFamily);

      let bestBox: BoundingBox | null = null;
      let bestPosition = LabelRelativePositionRelativeToHighlight.BOTTOM;
      let bestPenalty = Infinity;

      // Try each label size candidate
      for (const size of sizeCandidates) {
        // Generate up to 16 adjacent candidate positions
        const candidates = generateAdjacentCandidates(highlightBB, size.width, size.height);

        for (const { position, box } of candidates) {
          let penalty = 0;

          // Overlap with all highlight boxes
          for (const hb of highlightBBs) {
            penalty += calculateOverlapArea(box, hb);
          }

          // Overlap with already-placed labels in this group
          for (const pl of placedLabels) {
            penalty += calculateOverlapArea(box, pl);
          }

          // Overlap with content boxes
          for (const cb of contentBBs) {
            penalty += contentOverlapWeight * calculateOverlapArea(box, cb);
          }

          // Out-of-bounds penalty
          penalty += 2 * calculateOutOfBoundsArea(box, pageWidth, pageHeight);

          // Distance penalty
          const dx = (box.x + box.width / 2) - (highlightBB.x + highlightBB.width / 2);
          const dy = (box.y + box.height / 2) - (highlightBB.y + highlightBB.height / 2);
          penalty += REVDOKU_FREE_SPACE_DISTANCE_WEIGHT * Math.sqrt(dx * dx + dy * dy);

          // Intra-group spacing violation
          for (const pl of placedLabels) {
            const gap = computeGapBetweenBoxes(box, pl);
            if (gap > 0 && gap < REVDOKU_INTRA_GROUP_SPACING) {
              penalty += (REVDOKU_INTRA_GROUP_SPACING - gap) * 50;
            }
          }

          if (penalty < bestPenalty) {
            bestPenalty = penalty;
            bestBox = box;
            bestPosition = position;
            if (penalty === 0) break;
          }
        }
        if (bestPenalty === 0) break;
      }

      // Margin fallback if penalty exceeds threshold
      if (bestPenalty > fallbackThreshold || !bestBox) {
        marginLabels.push({ origIdx, description: h.description });
        continue;
      }

      placedLabels.push(bestBox);

      let arrowPath: Point[] = [];
      let leader: Leader | undefined;
      if (!skipArrows) {
        const hlRect: LeaderRect = { x: highlightBB.x, y: highlightBB.y, w: highlightBB.width, h: highlightBB.height };
        const annotRect: LeaderRect = { x: bestBox.x, y: bestBox.y, w: bestBox.width, h: bestBox.height };
        const allHlRects = highlightBBs.map(bb => ({ x: bb.x, y: bb.y, w: bb.width, h: bb.height }));
        const il = computeInlineLeader(hlRect, annotRect, origIdx, allHlRects);
        if (il) {
          leader = il;
          arrowPath = leaderToArrowPath(il) as Point[];
        } else {
          const gap = computeGapBetweenBoxes(highlightBB, bestBox);
          if (gap > 2 * REVDOKU_HINT_GAP) {
            const straightPath = computeShortestArrowPath(highlightBB, bestBox, bestPosition);
            arrowPath = computeLShapedArrowPath(straightPath[0], straightPath[1], bestPosition);
          } else {
            arrowPath = computeShortestArrowPath(highlightBB, bestBox, bestPosition);
          }
        }
      }

      results[origIdx] = {
        id: h.id,
        labelBox: bestBox, arrowPath, side: PlacementSide.INSIDE, leader,
      };
    }

    // Place margin fallback labels using resolveMarginLabelPositions
    if (marginLabels.length > 0) {
      const marginInputs: HintPlacementInput[] = marginLabels.map(ml => highlights[ml.origIdx]);
      const marginConfig: MarginLabelConfig = {
        rightMarginWidth: marginWidth,
        leftMarginWidth: 0,
        maxLabelWidth: marginWidth - REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING * 2,
        labelVerticalGap: REVDOKU_MARGIN_LABEL_VERTICAL_GAP,
        labelHorizontalPadding: REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING,
        labelFontSize: REVDOKU_MARGIN_LABEL_FONT_SIZE,
        labelLineHeight: REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
        labelInnerPadding: REVDOKU_MARGIN_LABEL_INNER_PADDING,
        maxLines: REVDOKU_MARGIN_LABEL_MAX_LINES,
      };
      const marginPlacements = resolveMarginLabelPositions(marginInputs, pageWidth, pageHeight, marginConfig);

      for (let mi = 0; mi < marginLabels.length; mi++) {
        const origIdx = marginLabels[mi].origIdx;
        const h = highlights[origIdx];
        const mp = marginPlacements[mi];
        if (mp) {
          let marginLeader: Leader | undefined;
          if (!skipArrows) {
            const hlRect: LeaderRect = { x: h.x, y: h.y, w: h.width, h: h.height };
            const annotRect: LeaderRect = { x: mp.labelX, y: mp.labelY, w: mp.labelWidth, h: mp.labelHeight };
            const ml = computeMarginLeader(hlRect, annotRect);
            if (ml) { ml.hlIdx = origIdx; marginLeader = ml; }
          }
          results[origIdx] = {
            id: h.id,
            labelBox: { x: mp.labelX, y: mp.labelY, width: mp.labelWidth, height: mp.labelHeight },
            arrowPath: skipArrows ? [] : (marginLeader ? leaderToArrowPath(marginLeader) as Point[] : mp.arrowPath),
            side: PlacementSide.RIGHT,
            leader: marginLeader,
          };
        } else {
          // Last resort: place in margin manually
          const labelX = pageWidth + REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING;
          results[origIdx] = {
            id: h.id,
            labelBox: { x: labelX, y: h.y, width: marginWidth - REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING * 2, height: 30 },
            arrowPath: [], side: PlacementSide.RIGHT,
          };
        }
      }
    }
  };

  placeGroup(failedIndices);
  placeGroup(passedIndices);

  // Post-processing: separate overlapping arrow segments
  if (!skipArrows) {
    separateOverlappingArrows(results.filter(r => r !== undefined));
  }

  return results;
}

/**
 * Post-process arrow paths to nudge nearly-overlapping segments apart.
 * Two arrows can still run nearly the same path when labels are stacked
 * and their highlights are vertically aligned. This nudges them apart.
 */
function separateOverlappingArrows(placements: HintPlacementResultExtended[]): void {
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const pathA = placements[i].arrowPath;
      const pathB = placements[j].arrowPath;
      if (pathA.length === 0 || pathB.length === 0) continue;

      for (let si = 0; si < pathA.length - 1; si++) {
        for (let sj = 0; sj < pathB.length - 1; sj++) {
          const a0 = pathA[si], a1 = pathA[si + 1];
          const b0 = pathB[sj], b1 = pathB[sj + 1];

          if (areSegmentsNearlyCoincident(a0, a1, b0, b1)) {
            nudgeSegment(pathB, sj, a0, a1);
          }
        }
      }
    }
  }
}

/**
 * Check if two line segments are nearly coincident (parallel and close together).
 */
function areSegmentsNearlyCoincident(
  a0: Point, a1: Point,
  b0: Point, b1: Point
): boolean {
  // Direction vectors
  const dax = a1.x - a0.x;
  const day = a1.y - a0.y;
  const dbx = b1.x - b0.x;
  const dby = b1.y - b0.y;

  const lenA = Math.sqrt(dax * dax + day * day);
  const lenB = Math.sqrt(dbx * dbx + dby * dby);
  if (lenA < 1 || lenB < 1) return false;

  // Normalized dot product (cosine of angle)
  const dot = Math.abs((dax * dbx + day * dby) / (lenA * lenB));
  if (dot < REVDOKU_PARALLEL_THRESHOLD) return false;

  // Perpendicular distance between segment midpoints
  const midAx = (a0.x + a1.x) / 2;
  const midAy = (a0.y + a1.y) / 2;
  const midBx = (b0.x + b1.x) / 2;
  const midBy = (b0.y + b1.y) / 2;

  // Distance between midpoints
  const midDist = Math.sqrt((midAx - midBx) ** 2 + (midAy - midBy) ** 2);
  return midDist < REVDOKU_MIN_ARROW_SEPARATION;
}

/**
 * Nudge a segment's endpoints perpendicular to a reference segment direction.
 */
function nudgeSegment(
  path: Point[],
  segIndex: number,
  refA: Point, refB: Point
): void {
  const dx = refB.x - refA.x;
  const dy = refB.y - refA.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;

  // Perpendicular direction (rotate 90 degrees)
  const perpX = -dy / len;
  const perpY = dx / len;

  const offset = REVDOKU_MIN_ARROW_SEPARATION;
  path[segIndex] = {
    x: path[segIndex].x + perpX * offset,
    y: path[segIndex].y + perpY * offset,
  };
  path[segIndex + 1] = {
    x: path[segIndex + 1].x + perpX * offset,
    y: path[segIndex + 1].y + perpY * offset,
  };
}

// ============================================
// SECTION 8: MARGIN LABEL TYPES & CONSTANTS
// ============================================

/** Result of margin label placement for a single highlight */
export interface MarginLabelPlacement {
  id: string;
  labelX: number;
  labelY: number;
  labelWidth: number;
  labelHeight: number;
  arrowPath: Point[];
  anchorPoint: Point;
  ruleOrder?: number;
}

/** Configuration for the margin label placement algorithm */
export interface MarginLabelConfig {
  rightMarginWidth: number;
  leftMarginWidth: number;
  maxLabelWidth: number;
  labelVerticalGap: number;
  labelHorizontalPadding: number;
  labelFontSize: number;
  labelLineHeight: number;
  labelInnerPadding: number;
  maxLines: number;
  fontFamily?: LabelFontFamily;
}

export const REVDOKU_MARGIN_LABEL_MIN_WIDTH = 100;
export const REVDOKU_MARGIN_LABEL_FONT_SIZE = 14;
export const REVDOKU_MARGIN_LABEL_LINE_HEIGHT = 19 / 14;
export const REVDOKU_MARGIN_LABEL_INNER_PADDING = 5;
export const REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING = 20;
export const REVDOKU_MARGIN_LABEL_VERTICAL_GAP = 8;
export const REVDOKU_MARGIN_LABEL_MAX_LINES = 8;           // export rendering cap
export const REVDOKU_LAYOUT_LABEL_MAX_LINES = 999;          // layout computation — effectively uncapped
export const REVDOKU_MARGIN_LABEL_BORDER_WIDTH = 1.5;
export const REVDOKU_ARROW_LINE_WIDTH = 3;
export const REVDOKU_ARROW_HEAD_SIZE = 26;
export const REVDOKU_ANNOTATION_MARGIN = 300;
/**
 * Exponent for scaling annotation margin width with user font scale.
 * margin = REVDOKU_ANNOTATION_MARGIN * pow(fontScale, REVDOKU_ANNOTATION_MARGIN_SCALE_EXPONENT)
 * Using 1.5 gives wider labels at larger font sizes (more chars per line).
 */
export const REVDOKU_ANNOTATION_MARGIN_SCALE_EXPONENT = 1.5;

// ============================================
// SECTION 9: MARGIN LABEL ALGORITHM
// ============================================

/**
 * Estimate wrapped label dimensions from message text.
 * Uses character-width approximation (fontSize * 0.55) for wrapping.
 */
export function estimateWrappedLabelDimensions(
  message: string,
  maxWidth: number,
  fontSize: number = REVDOKU_MARGIN_LABEL_FONT_SIZE,
  lineHeight: number = REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
  innerPadding: number = REVDOKU_MARGIN_LABEL_INNER_PADDING,
  maxLines: number = REVDOKU_MARGIN_LABEL_MAX_LINES,
  fontFamily?: LabelFontFamily
): { width: number; height: number; lines: string[]; displayText: string } {
  const charWidth = fontSize * getCharWidthFactor(fontFamily);
  const availableTextWidth = maxWidth - innerPadding * 2;
  const charsPerLine = Math.max(1, Math.floor(availableTextWidth / charWidth));

  const words = message.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= charsPerLine) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  // Truncate last line if we hit the limit and there's remaining text
  if (lines.length >= maxLines) {
    const remaining = words.slice(
      lines.join(' ').split(/\s+/).length
    ).join(' ');
    if (remaining) {
      const lastLine = lines[maxLines - 1];
      if (lastLine.length > charsPerLine - 3) {
        lines[maxLines - 1] = lastLine.substring(0, charsPerLine - 3) + '...';
      } else {
        lines[maxLines - 1] = lastLine + '...';
      }
    }
    lines.length = maxLines;
  }

  // Handle long single words that exceed line width
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > charsPerLine) {
      lines[i] = lines[i].substring(0, charsPerLine - 3) + '...';
    }
  }

  const lineCount = Math.max(1, lines.length);
  const textHeight = lineCount * fontSize * lineHeight;
  const height = textHeight + innerPadding * 2;
  const maxLineWidth = Math.max(...lines.map(l => l.length * charWidth));
  const width = Math.min(maxWidth, maxLineWidth + innerPadding * 2);

  return {
    width: Math.max(60, width),
    height,
    lines,
    displayText: lines.join('\n'),
  };
}

/**
 * Generate multiple label size candidates for a message string.
 *
 * Produces candidates in 3 shape categories (tried in preference order):
 * 1. Square-ish (width ~ height)
 * 2. Wide rectangles (wider than tall, up to 50% page width)
 * 3. Tall rectangles (REVDOKU_MIN_HINT_LABEL_WIDTH wide — last resort)
 *
 * Within each category candidates are sorted by area ascending.
 */
const LABEL_FONT_SIZE = REVDOKU_MARGIN_LABEL_FONT_SIZE;
const LABEL_LINE_HEIGHT_RATIO = REVDOKU_MARGIN_LABEL_LINE_HEIGHT;
const LABEL_INNER_PADDING = REVDOKU_MARGIN_LABEL_INNER_PADDING;
const LABEL_MAX_LINES = REVDOKU_MARGIN_LABEL_MAX_LINES;

type LabelShapeCategory = 'square' | 'wide-rect' | 'tall-rect';
interface LabelSizeCandidate { width: number; height: number; category: LabelShapeCategory }

export function generateLabelSizeCandidates(
  message: string,
  maxLines: number = LABEL_MAX_LINES,
  pageWidth?: number,
  fontFamily?: LabelFontFamily,
): { width: number; height: number }[] {
  if (!message || message.trim().length === 0) {
    return [{ width: 70, height: 25 }];
  }

  const effectiveMaxWidth = pageWidth
    ? Math.max(REVDOKU_MIN_HINT_LABEL_WIDTH, pageWidth * REVDOKU_MAX_HINT_LABEL_WIDTH_RATIO)
    : REVDOKU_MAX_HINT_LABEL_WIDTH;
  const effectiveMinWidth = pageWidth && REVDOKU_MIN_HINT_LABEL_WIDTH > pageWidth * REVDOKU_MAX_HINT_LABEL_WIDTH_RATIO
    ? pageWidth * REVDOKU_MAX_HINT_LABEL_WIDTH_RATIO
    : REVDOKU_MIN_HINT_LABEL_WIDTH;

  const seen = new Set<string>();
  const candidates: LabelSizeCandidate[] = [];

  const addCandidate = (maxW: number, cat: LabelShapeCategory) => {
    const dims = estimateWrappedLabelDimensions(
      message, maxW, LABEL_FONT_SIZE, LABEL_LINE_HEIGHT_RATIO, LABEL_INNER_PADDING, maxLines, fontFamily,
    );
    // Clamp width to effective min
    const w = Math.max(dims.width, effectiveMinWidth);
    // Re-estimate height at clamped width if width changed significantly
    const finalDims = Math.abs(w - dims.width) > 5
      ? estimateWrappedLabelDimensions(message, w, LABEL_FONT_SIZE, LABEL_LINE_HEIGHT_RATIO, LABEL_INNER_PADDING, maxLines, fontFamily)
      : dims;
    const key = `${Math.round(finalDims.width)}_${Math.round(finalDims.height)}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ width: finalDims.width, height: finalDims.height, category: cat });
    }
  };

  // Category 1: Square-ish — estimate area then compute side length
  const charWidth = LABEL_FONT_SIZE * getCharWidthFactor(fontFamily);
  const estimatedTextArea = message.length * charWidth * LABEL_FONT_SIZE * LABEL_LINE_HEIGHT_RATIO;
  const paddingOverhead = 1.4; // account for padding
  const side = Math.sqrt(estimatedTextArea * paddingOverhead);
  const squareWidth = clamp(side, effectiveMinWidth, effectiveMaxWidth);
  addCandidate(squareWidth, 'square');

  // Category 2: Wide rectangles — try several widths from max down
  for (const factor of [1.0, 0.75, 0.6]) {
    const w = effectiveMaxWidth * factor;
    if (w >= effectiveMinWidth) {
      addCandidate(w, 'wide-rect');
    }
  }

  // Category 3: Tall rectangles — use minimum width (last resort)
  addCandidate(effectiveMinWidth, 'tall-rect');

  // Sort: square first, then wide-rect, then tall-rect; within each category by area ascending
  const categoryOrder: Record<LabelShapeCategory, number> = { 'square': 0, 'wide-rect': 1, 'tall-rect': 2 };
  candidates.sort((a, b) => {
    const catDiff = categoryOrder[a.category] - categoryOrder[b.category];
    if (catDiff !== 0) return catDiff;
    return (a.width * a.height) - (b.width * b.height);
  });

  return candidates.map(c => ({ width: c.width, height: c.height }));
}

/**
 * Compute the arrow polyline path from a label to a highlight anchor.
 * Arrow points FROM label TO highlight (first point = label edge, last point = highlight anchor).
 * Path: (labelX, labelMidY) → (turnX, labelMidY) → (turnX, anchorY) → anchor
 * Simplified to 2 points if anchor and label are at approximately the same Y.
 */
export function computeArrowPath(
  anchorX: number,
  anchorY: number,
  labelX: number,
  labelY: number,
  labelHeight: number,
  turnX: number
): Point[] {
  const labelMidY = labelY + labelHeight / 2;

  // If anchor and label midpoint are close vertically, use a simpler path
  if (Math.abs(anchorY - labelMidY) < 5) {
    return [
      { x: labelX, y: labelMidY },
      { x: anchorX, y: anchorY },
    ];
  }

  return [
    { x: labelX, y: labelMidY },
    { x: turnX, y: labelMidY },
    { x: turnX, y: anchorY },
    { x: anchorX, y: anchorY },
  ];
}

/**
 * Resolve margin label positions for all highlights on a page.
 *
 * Algorithm:
 * 1. Force RIGHT-margin only placement (no dual-margin distribution)
 * 2. Filter highlights with messages
 * 3. Sort by Y center (top-to-bottom)
 * 4. Place labels in right margin with ideal Y aligned to highlight center
 * 5. Resolve vertical collisions with bidirectional adjustment:
 *    - Try pushing DOWN first
 *    - If DOWN would overflow page bottom, push UP instead
 * 6. Clamp all labels to page bounds (both top AND bottom)
 * 7. Compute arrow paths from highlight edges to labels
 */
export function resolveMarginLabelPositions(
  highlights: HintPlacementInput[],
  pageWidth: number,
  pageHeight: number,
  config: MarginLabelConfig
): MarginLabelPlacement[] {
  if (highlights.length === 0) return [];

  // RIGHT-margin only - ignore left margin width
  const hasRightMargin = config.rightMarginWidth >= REVDOKU_MARGIN_LABEL_MIN_WIDTH;

  // If right margin is not available, return empty — caller should fall back to resolveLabelRelativePositionRelativeToHighlights
  if (!hasRightMargin) return [];

  // Filter highlights that have messages
  const withMessages = highlights
    .map((h, origIdx) => ({ ...h, origIdx }))
    .filter(h => h.description && h.description.trim().length > 0);

  if (withMessages.length === 0) return [];

  // Sort by vertical center (top-to-bottom), then horizontal for ties
  const sorted = [...withMessages].sort((a, b) => {
    const aCenterY = a.y + a.height / 2;
    const bCenterY = b.y + b.height / 2;
    const dy = aCenterY - bCenterY;
    return dy !== 0 ? dy : a.x - b.x;
  });

  const placements: MarginLabelPlacement[] = [];

  // RIGHT-margin only settings
  const marginWidth = config.rightMarginWidth;
  const maxLabelWidth = Math.min(config.maxLabelWidth, marginWidth - config.labelHorizontalPadding * 2);
  const labelX = pageWidth + config.labelHorizontalPadding;
  const turnX = pageWidth + config.labelHorizontalPadding * 0.4;

  // Track the next available Y position for top-to-bottom packing.
  // This guarantees labels never overlap: each starts after the previous one ends.
  let nextAvailableY = config.labelVerticalGap;

  for (const h of sorted) {
    const dims = estimateWrappedLabelDimensions(
      h.description,
      maxLabelWidth,
      config.labelFontSize,
      config.labelLineHeight,
      config.labelInnerPadding,
      config.maxLines,
      config.fontFamily
    );

    // Pure top-to-bottom packing: always pack from top, ignore highlight Y.
    // The arrow connects the label to the distant highlight — which is fine
    // because arrows are computed dynamically via deriveArrowAndPosition().
    let desiredY = nextAvailableY;

    // Advance nextAvailableY past this label
    nextAvailableY = desiredY + dims.height + config.labelVerticalGap;

    // Anchor point: right edge of highlight (always right margin)
    const anchorX = h.x + h.width;
    const anchorY = h.y + h.height / 2;

    const arrowPath = computeArrowPath(
      anchorX, anchorY,
      labelX, desiredY,
      dims.height,
      turnX
    );

    placements.push({
      id: h.id,
      labelX,
      labelY: desiredY,
      labelWidth: dims.width,
      labelHeight: dims.height,
      arrowPath,
      anchorPoint: { x: anchorX, y: anchorY },
      ruleOrder: h.ruleOrder,
    });

  }

  return placements;
}

/**
 * Nudge overlapping label boxes apart by pushing later (lower) labels down.
 * Shared between frontend viewer and revdoku-doc-api export for identical behavior.
 *
 * @param labelPlacements - labels to deconflict (mutated in place)
 * @param pageWidth - page width
 * @param gap - pixel gap to insert between overlapping labels
 * @param getHighlightBB - callback returning the highlight bounding box for a label id, or null
 */
// ============================================
// SECTION 10B: LABEL BADGE (circle next to annotation labels)
// ============================================

/**
 * Scale factor for label badge circle size relative to the label's font size.
 * Makes badges 20% bigger than the text for better visibility.
 */
export const REVDOKU_LABEL_BADGE_FONT_SCALE = 1.2;

/** Spec for the circle badge drawn next to annotation labels */
export interface LabelBadgeSpec {
  radius: number;       // circle radius in pixels
  fontSize: number;     // font size for the number text
}

/**
 * Compute circle badge geometry for a label badge.
 * Uses REVDOKU_LABEL_BADGE_FONT_SCALE to make badges 20% bigger than label text.
 * @param effectiveFontSize - the label's effective font size (already scaled)
 */
export function calculateLabelBadgeSpec(effectiveFontSize: number): LabelBadgeSpec {
  const fontSize = effectiveFontSize * REVDOKU_LABEL_BADGE_FONT_SCALE * 0.85;
  const radius = fontSize * 0.75;
  return { radius, fontSize };
}

/** Maximum fill ratio per side (fraction of page dimension). Labels beyond this are left on their original side. */
export const REVDOKU_SIDE_MAX_FILL: Record<PlacementSide, number> = {
  [PlacementSide.RIGHT]: 1.3,
  [PlacementSide.LEFT]: 1.3,
  [PlacementSide.TOP]: 1.0,
  [PlacementSide.BOTTOM]: 1.0,
  [PlacementSide.INSIDE]: 1.0,
};

/** Priority order for pulling labels into a target side from other sides. */
export const REVDOKU_SIDE_FILL_SOURCES: Record<PlacementSide, PlacementSide[]> = {
  [PlacementSide.RIGHT]: [PlacementSide.LEFT, PlacementSide.BOTTOM, PlacementSide.TOP],
  [PlacementSide.LEFT]: [PlacementSide.BOTTOM, PlacementSide.TOP],
  [PlacementSide.TOP]: [PlacementSide.BOTTOM],
  [PlacementSide.BOTTOM]: [],
  [PlacementSide.INSIDE]: [],
};

export interface RestackLabelsOptions {
  /** Page width in the coordinate space of labelBox (document or display) */
  page_width: number;
  /** Page height in the coordinate space of labelBox */
  page_height: number;
  /** Fixed pixel gap between stacked labels */
  gap: number;
  /** Starting Y for right/left vertical stacking. Default: gap */
  start_y?: number;
  /** Label IDs to skip (e.g., currently being dragged) */
  skip_ids?: Set<string>;
  /** Callback to get passed status for failed-first sorting. If omitted, no failed-first sorting. */
  get_passed?: (id: string) => boolean | undefined;
  /** Callback to get check types for grouping. Required for check type grouping. */
  get_check_types?: (id: string) => Set<CheckType>;
  /** Active check filter. Grouping only applies for ALL and FAILED_AND_CHANGES filters. */
  check_filter?: CheckFilterType;
}

/**
 * Simple label restacking. Classifies labels by side based on coordinates,
 * then stacks them with a fixed gap:
 * - Right/Left: stack vertically (only adjusts Y, never X). Failed checks first.
 * - Top/Bottom: stack horizontally (only adjusts X, never Y).
 *
 * Mutates labelBox in-place. Shared by frontend and revdoku-doc-api.
 */
export function restackLabels(
  labelPlacements: HintPlacementResultExtended[],
  getHighlightCenterY: (id: string) => number | null,
  options: RestackLabelsOptions,
): void {
  const { page_width, page_height, gap, skip_ids, get_passed, get_check_types, check_filter } = options;
  const startY = options.start_y ?? gap;

  // Classify labels by side
  const right: HintPlacementResultExtended[] = [];
  const left: HintPlacementResultExtended[] = [];
  const top: HintPlacementResultExtended[] = [];
  const bottom: HintPlacementResultExtended[] = [];

  for (const lp of labelPlacements) {
    if (skip_ids?.has(lp.id)) continue;
    const b = lp.labelBox;
    if (b.x >= page_width) {
      right.push(lp);
    } else if (b.x + b.width <= 0) {
      left.push(lp);
    } else if (b.y + b.height <= 0) {
      top.push(lp);
    } else if (b.y >= page_height) {
      bottom.push(lp);
    }
    // else: inside label — not restacked
  }

  // Sort helper for vertical stacking: failed first, then by highlight Y, then by current Y
  const verticalSort = (a: HintPlacementResultExtended, b: HintPlacementResultExtended): number => {
    if (get_passed) {
      const passedA = get_passed(a.id) === true ? 1 : 0;
      const passedB = get_passed(b.id) === true ? 1 : 0;
      if (passedA !== passedB) return passedA - passedB;
    }
    const cyA = getHighlightCenterY(a.id) ?? a.labelBox.y;
    const cyB = getHighlightCenterY(b.id) ?? b.labelBox.y;
    if (Math.abs(cyA - cyB) > 2) return cyA - cyB;
    return a.labelBox.y - b.labelBox.y;
  };

  // Stack right-side labels vertically (only adjust Y)
  if (right.length > 0) {
    right.sort(verticalSort);
    let nextY = startY;
    for (const lp of right) {
      lp.labelBox.y = nextY;
      nextY += lp.labelBox.height + gap;
    }
  }

  // Stack left-side labels vertically (only adjust Y)
  if (left.length > 0) {
    left.sort(verticalSort);
    let nextY = startY;
    for (const lp of left) {
      lp.labelBox.y = nextY;
      nextY += lp.labelBox.height + gap;
    }
  }

  // Stack top labels horizontally (only adjust X)
  if (top.length > 0) {
    top.sort((a, b) => a.labelBox.x - b.labelBox.x);
    let nextX = gap;
    for (const lp of top) {
      lp.labelBox.x = nextX;
      nextX += lp.labelBox.width + gap;
    }
  }

  // Stack bottom labels horizontally (only adjust X)
  if (bottom.length > 0) {
    bottom.sort((a, b) => a.labelBox.x - b.labelBox.x);
    let nextX = gap;
    for (const lp of bottom) {
      lp.labelBox.x = nextX;
      nextX += lp.labelBox.width + gap;
    }
  }

  // --- Pass 2: Cross-side redistribution ---
  // Fill preferred sides first (right → left → top → bottom).
  // Move labels from overflow sides to sides with remaining capacity.
  const sideBuckets: Record<string, HintPlacementResultExtended[]> = { right, left, top, bottom };
  const targetOrder: PlacementSide[] = [PlacementSide.RIGHT, PlacementSide.LEFT, PlacementSide.TOP, PlacementSide.BOTTOM];

  const currentFill = (labels: HintPlacementResultExtended[], isVertical: boolean): number => {
    if (labels.length === 0) return 0;
    return labels.reduce((sum, lp) => sum + (isVertical ? lp.labelBox.height : lp.labelBox.width) + gap, 0);
  };

  console.debug(`[restackLabels] pass2: right=${right.length}, left=${left.length}, top=${top.length}, bottom=${bottom.length}, page=${Math.round(page_width)}x${Math.round(page_height)}`);

  for (const targetSide of targetOrder) {
    const sources = REVDOKU_SIDE_FILL_SOURCES[targetSide];
    if (!sources || sources.length === 0) continue;

    const isVertical = targetSide === PlacementSide.RIGHT || targetSide === PlacementSide.LEFT;
    const maxCapacity = (isVertical ? page_height : page_width) * (REVDOKU_SIDE_MAX_FILL[targetSide] ?? 1.0);
    const targetLabels = sideBuckets[targetSide];
    let fill = currentFill(targetLabels, isVertical);
    console.debug(`[restackLabels] ${targetSide}: fill=${Math.round(fill)}, maxCap=${Math.round(maxCapacity)}, remaining=${Math.round(maxCapacity - fill)}, sources=${sources.map((s: PlacementSide) => `${s}(${sideBuckets[s].length})`).join(',')}`);
    if (fill >= maxCapacity) continue;

    // Determine X position for labels moved to this side
    const targetX = targetLabels.length > 0
      ? targetLabels[0].labelBox.x
      : targetSide === PlacementSide.RIGHT ? page_width + gap
      : targetSide === PlacementSide.LEFT ? -gap
      : 0;

    let moved = false;
    for (const sourceSide of sources) {
      const sourceLabels = sideBuckets[sourceSide];
      if (sourceLabels.length === 0) continue;

      // Iterate from bottom to top (last to first) — bottom labels are farthest from highlights
      for (let i = sourceLabels.length - 1; i >= 0; i--) {
        const lp = sourceLabels[i];
        const labelSize = isVertical ? lp.labelBox.height : lp.labelBox.width;
        if (fill + labelSize + gap > maxCapacity) continue; // doesn't fit, try next

        // Move label to target side
        sourceLabels.splice(i, 1);
        targetLabels.push(lp);
        fill += labelSize + gap;
        moved = true;

        // Set X/Y for the target side
        if (targetSide === PlacementSide.RIGHT) {
          lp.labelBox.x = targetX;
        } else if (targetSide === PlacementSide.LEFT) {
          lp.labelBox.x = targetLabels.length > 1 ? targetLabels[0].labelBox.x : -(lp.labelBox.width + gap);
        } else if (targetSide === PlacementSide.TOP) {
          lp.labelBox.y = targetLabels.length > 1 ? targetLabels[0].labelBox.y : -(lp.labelBox.height + gap);
        } else if (targetSide === PlacementSide.BOTTOM) {
          lp.labelBox.y = targetLabels.length > 1 ? targetLabels[0].labelBox.y : page_height + gap;
        }

        if (fill >= maxCapacity) break;
      }
      if (fill >= maxCapacity) break;
    }

    // Re-stack target side after adding moved labels
    if (moved) {
      if (isVertical) {
        targetLabels.sort(verticalSort);
        let nextY = startY;
        for (const lp of targetLabels) {
          lp.labelBox.y = nextY;
          nextY += lp.labelBox.height + gap;
        }
      } else {
        targetLabels.sort((a, b) => a.labelBox.x - b.labelBox.x);
        let nextX = gap;
        for (const lp of targetLabels) {
          lp.labelBox.x = nextX;
          nextX += lp.labelBox.width + gap;
        }
      }
    }
  }

  // Re-stack source sides that had labels removed
  for (const side of ['left', 'top', 'bottom']) {
    const labels = sideBuckets[side];
    if (labels.length === 0) continue;
    const isVertical = side === 'left';
    if (isVertical) {
      labels.sort(verticalSort);
      let nextY = startY;
      for (const lp of labels) {
        lp.labelBox.y = nextY;
        nextY += lp.labelBox.height + gap;
      }
    } else {
      labels.sort((a, b) => a.labelBox.x - b.labelBox.x);
      let nextX = gap;
      for (const lp of labels) {
        lp.labelBox.x = nextX;
        nextX += lp.labelBox.width + gap;
      }
    }
  }

  // --- Pass 3: Group by check type (only for multi-type filters) ---
  if (get_check_types) {
    const shouldGroup = !check_filter ||
      check_filter === CheckFilterType.ALL ||
      check_filter === CheckFilterType.FAILED_AND_CHANGES;
    if (shouldGroup) {
      for (const [side, sideLabels] of Object.entries(sideBuckets)) {
        if (sideLabels.length <= 1) continue;
        const axis = (side === 'right' || side === 'left') ? 'y' : 'x';
        groupLabelsByCheckType(sideLabels, get_check_types, axis, gap);
      }
    }
  }
}

// ============================================
// SECTION 11: AUTO-REPOSITION LABELS ALGORITHM
// ============================================

/** Priority for grouping labels by check type. Higher priority = placed first (top/left). */
export const REVDOKU_CHECK_TYPE_GROUP_PRIORITY: Record<CheckType, number> = {
  [CheckType.FAILED_ONLY]: 11, // failed non-change checks — highest priority
  [CheckType.FAILED]: 10,
  [CheckType.CHANGE]: 9,
  [CheckType.RECHECK]: 8,
  [CheckType.PASSED]: 1,
};

/** Steps in the auto-reposition pipeline */
export enum AutoRepositionStep {
  STEP_CLASSIFY = 'step_classify',
  STEP_SORT_AND_STACK = 'step_sort_and_stack',
  STEP_EXPAND_RIGHT = 'step_expand_right',
  STEP_SNAPSHOT_SIDES = 'step_snapshot_sides',
  STEP_REDISTRIBUTE = 'step_redistribute',
  STEP_EXPAND_POST_REDIST = 'step_expand_post_redist',
  STEP_RESTACK_AND_SHIFT = 'step_restack_and_shift',
  STEP_MAGNET = 'step_magnet',
  STEP_GROUP_BY_CHECK_TYPE = 'step_group_by_check_type',
  STEP_FINAL_RESTACK = 'step_final_restack',
  STEP_SPREAD_CLOSE_TO_HIGHLIGHTS = 'step_spread_close_to_highlights',
  STEP_ENFORCE_OVERFLOW = 'step_enforce_overflow',
}

/** All steps in execution order */
export const REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS: AutoRepositionStep[] = [
  AutoRepositionStep.STEP_CLASSIFY,
  AutoRepositionStep.STEP_SORT_AND_STACK,
  AutoRepositionStep.STEP_EXPAND_RIGHT,
  AutoRepositionStep.STEP_SNAPSHOT_SIDES,
  AutoRepositionStep.STEP_REDISTRIBUTE,
  AutoRepositionStep.STEP_EXPAND_POST_REDIST,
  AutoRepositionStep.STEP_RESTACK_AND_SHIFT,
  AutoRepositionStep.STEP_MAGNET,
  AutoRepositionStep.STEP_GROUP_BY_CHECK_TYPE,
  AutoRepositionStep.STEP_FINAL_RESTACK,
  AutoRepositionStep.STEP_SPREAD_CLOSE_TO_HIGHLIGHTS,
  AutoRepositionStep.STEP_ENFORCE_OVERFLOW,
];

/** Events that trigger label repositioning */
export enum AutoRepositionEvent {
  PAGE_LOAD = 'page_load',
  CHECK_FILTER_CHANGE = 'check_filter_change',
  ZOOM_CHANGE = 'zoom_change',
  FONT_SIZE_CHANGE = 'font_size_change',
}

/** Which steps to run for each event */
export const REVDOKU_LABEL_AUTO_REPOSITION_APPLICATION_BY_EVENT: Record<AutoRepositionEvent, AutoRepositionStep[]> = {
  [AutoRepositionEvent.PAGE_LOAD]: REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS,
  [AutoRepositionEvent.CHECK_FILTER_CHANGE]: REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS,
  [AutoRepositionEvent.ZOOM_CHANGE]: [AutoRepositionStep.STEP_RESTACK_AND_SHIFT],
  [AutoRepositionEvent.FONT_SIZE_CHANGE]: [AutoRepositionStep.STEP_RESTACK_AND_SHIFT],
};

/** Stacking direction per side */
export type SideShiftDirection = 'up' | 'right';

export const REVDOKU_SIDE_SHIFT_DIRECTION: Partial<Record<PlacementSide, SideShiftDirection>> = {
  [PlacementSide.RIGHT]: 'up',
  [PlacementSide.LEFT]: 'up',
  [PlacementSide.BOTTOM]: 'right',
  [PlacementSide.TOP]: 'right',
};

/** Magnet config — whether labels snap to their page edge */
export interface SideMagnetConfig {
  magnet: boolean;
  gap: number;
}

export const REVDOKU_SIDE_TO_MAGNET_TO: Record<PlacementSide, SideMagnetConfig> = {
  [PlacementSide.LEFT]: { magnet: true, gap: REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING },
  [PlacementSide.RIGHT]: { magnet: true, gap: REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING },
  [PlacementSide.BOTTOM]: { magnet: true, gap: REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING },
  [PlacementSide.TOP]: { magnet: true, gap: REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING },
  [PlacementSide.INSIDE]: { magnet: false, gap: -1 },
};

/** Constraint measures for label size constraints */
export type ConstraintMeasure = 'px' | 'viewer_width' | 'viewer_height' | 'page_width' | 'page_height' | 'text_line';

export interface SizeConstraint {
  min: number;
  min_measure: ConstraintMeasure;
  max: number;
  max_measure: ConstraintMeasure;
}

export interface SideSizeConstraints {
  width: SizeConstraint;
  height: SizeConstraint;
}

export const REVDOKU_LABEL_SIZE_CONSTRAINTS: Partial<Record<PlacementSide, SideSizeConstraints>> = {
  [PlacementSide.LEFT]: {
    width: { min: 100, min_measure: 'px', max: 0.9, max_measure: 'viewer_width' },
    height: { min: 1, min_measure: 'text_line', max: 0.90, max_measure: 'viewer_height' },
  },
  [PlacementSide.RIGHT]: {
    width: { min: 100, min_measure: 'px', max: 0.9, max_measure: 'viewer_width' },
    height: { min: 1, min_measure: 'text_line', max: 0.90, max_measure: 'viewer_height' },
  },
  [PlacementSide.TOP]: {
    width: { min: 0.2, min_measure: 'page_width', max: 0.99, max_measure: 'page_width' },
    height: { min: 1, min_measure: 'text_line', max: 0.99, max_measure: 'viewer_height' },
  },
  [PlacementSide.BOTTOM]: {
    width: { min: 0.2, min_measure: 'page_width', max: 0.99, max_measure: 'page_width' },
    height: { min: 1, min_measure: 'text_line', max: 0.99, max_measure: 'viewer_height' },
  },
};

/** Post-redistribution expansion config */
export interface SideExpansionEntry {
  side: PlacementSide;
  opposite_side: PlacementSide;
  use_max_width_if_opposite_side_has_zero_labels: boolean;
}

export const REVDOKU_SIDE_EXPANSION_CONFIG: SideExpansionEntry[] = [
  { side: PlacementSide.RIGHT, opposite_side: PlacementSide.LEFT, use_max_width_if_opposite_side_has_zero_labels: true },
  { side: PlacementSide.LEFT, opposite_side: PlacementSide.RIGHT, use_max_width_if_opposite_side_has_zero_labels: true },
];

/** Context for resolving constraint measures to pixels */
export interface ConstraintContext {
  viewer_width: number;
  viewer_height: number;
  page_width: number;
  page_height: number;
  text_line_height: number;
}

/** Resolve a constraint value+measure to pixels */
export function resolveConstraint(value: number, measure: ConstraintMeasure, ctx: ConstraintContext): number {
  switch (measure) {
    case 'px': return value;
    case 'viewer_width': return value * ctx.viewer_width;
    case 'viewer_height': return value * ctx.viewer_height;
    case 'page_width': return value * ctx.page_width;
    case 'page_height': return value * ctx.page_height;
    case 'text_line': return value * ctx.text_line_height;
  }
}

/** Resolve min/max constraint pair to pixel values */
export function resolveMinMax(constraint: SizeConstraint, ctx: ConstraintContext): [number, number] {
  return [
    resolveConstraint(constraint.min, constraint.min_measure, ctx),
    resolveConstraint(constraint.max, constraint.max_measure, ctx),
  ];
}

/**
 * Update the .side property on each label based on its coordinates relative to the page.
 * Call this after any label movement to keep .side in sync.
 */
export function updateLabelSides(
  labels: HintPlacementResultExtended[],
  page_width: number,
  page_height: number,
): void {
  for (const lp of labels) {
    const b = lp.labelBox;
    if (b.x >= page_width) {
      lp.side = PlacementSide.RIGHT;
    } else if (b.x + b.width > page_width && b.x >= page_width * 0.5) {
      lp.side = PlacementSide.RIGHT;
    } else if (b.x + b.width <= 0 || b.x < 0) {
      lp.side = PlacementSide.LEFT;
    } else if (b.y + b.height <= 0) {
      lp.side = PlacementSide.TOP;
    } else if (b.y >= page_height) {
      lp.side = PlacementSide.BOTTOM;
    } else {
      lp.side = PlacementSide.INSIDE;
    }
  }
}

/** Group labels by their .side property */
function groupLabelsBySide(
  labels: HintPlacementResultExtended[],
  skip_ids?: Set<string>,
): Record<PlacementSide, HintPlacementResultExtended[]> {
  const groups: Record<PlacementSide, HintPlacementResultExtended[]> = {
    [PlacementSide.RIGHT]: [],
    [PlacementSide.LEFT]: [],
    [PlacementSide.TOP]: [],
    [PlacementSide.BOTTOM]: [],
    [PlacementSide.INSIDE]: [],
  };
  for (const lp of labels) {
    if (skip_ids?.has(lp.id)) continue;
    groups[lp.side].push(lp);
  }
  return groups;
}

/** Get the highest group priority for a label based on its check types */
function getLabelGroupPriority(id: string, get_check_types: (id: string) => Set<CheckType>): number {
  const types = get_check_types(id);
  let maxPriority = 0;
  for (const t of types) {
    maxPriority = Math.max(maxPriority, REVDOKU_CHECK_TYPE_GROUP_PRIORITY[t] ?? 0);
  }
  return maxPriority;
}

/** Stable-sort labels by check type group priority (descending), then restack positions on axis */
function groupLabelsByCheckType(
  labels: HintPlacementResultExtended[],
  get_check_types: (id: string) => Set<CheckType>,
  axis: 'y' | 'x',
  gap: number,
): void {
  if (labels.length <= 1) return;
  // Stable sort by priority descending
  labels.sort((a, b) => getLabelGroupPriority(b.id, get_check_types) - getLabelGroupPriority(a.id, get_check_types));
  // Restack positions
  if (axis === 'y') {
    let nextY = labels[0].labelBox.y;
    for (const lp of labels) {
      lp.labelBox.y = nextY;
      nextY += lp.labelBox.height + gap;
    }
  } else {
    let nextX = labels[0].labelBox.x;
    for (const lp of labels) {
      lp.labelBox.x = nextX;
      nextX += lp.labelBox.width + gap;
    }
  }
}

/**
 * Compare two coordinate-bearing items by visual center position.
 * Sort order: center Y ascending (with tolerance), center X ascending, then check_index ascending.
 * Used by both revdoku-doc-api (computeDescriptionPositions) and frontend (makeVerticalSort)
 * to ensure consistent label ordering.
 */
export function compareByVisualPosition(
  a: ICoordinates,
  b: ICoordinates,
  aCheckIndex?: number,
  bCheckIndex?: number,
  yTolerance: number = 2,
): number {
  const aCenterY = (a.y1 + a.y2) / 2;
  const bCenterY = (b.y1 + b.y2) / 2;
  const dy = aCenterY - bCenterY;
  if (Math.abs(dy) > yTolerance) return dy;
  const aCenterX = (a.x1 + a.x2) / 2;
  const bCenterX = (b.x1 + b.x2) / 2;
  const dx = aCenterX - bCenterX;
  if (Math.abs(dx) > 2) return dx;
  return (aCheckIndex ?? 0) - (bCheckIndex ?? 0);
}

/** Sort helper for vertical stacking: issues first (failed, non-change), then changes, then passed, then by highlight center Y, then by check_index */
function makeVerticalSort(
  get_passed?: (id: string) => boolean | undefined,
  get_highlight_center_y?: (id: string) => number | null,
  get_check_types?: (id: string) => Set<CheckType>,
  get_check_index?: (id: string) => number | null,
  get_highlight_rect?: (id: string) => BoundingBox | null,
): (a: HintPlacementResultExtended, b: HintPlacementResultExtended) => number {
  return (a, b) => {
    if (get_passed) {
      const passedA = get_passed(a.id) === true ? 1 : 0;
      const passedB = get_passed(b.id) === true ? 1 : 0;
      if (passedA !== passedB) return passedA - passedB;
      // Both failed: issues (non-change) before changes
      if (passedA === 0 && get_check_types) {
        const aChange = get_check_types(a.id).has(CheckType.CHANGE) ? 1 : 0;
        const bChange = get_check_types(b.id).has(CheckType.CHANGE) ? 1 : 0;
        if (aChange !== bChange) return aChange - bChange;
      }
    }
    // Use shared compareByVisualPosition when full highlight rects are available
    if (get_highlight_rect) {
      const rectA = get_highlight_rect(a.id);
      const rectB = get_highlight_rect(b.id);
      if (rectA && rectB) {
        const coordsA: ICoordinates = { x1: rectA.x, y1: rectA.y, x2: rectA.x + rectA.width, y2: rectA.y + rectA.height };
        const coordsB: ICoordinates = { x1: rectB.x, y1: rectB.y, x2: rectB.x + rectB.width, y2: rectB.y + rectB.height };
        return compareByVisualPosition(coordsA, coordsB, get_check_index?.(a.id) ?? undefined, get_check_index?.(b.id) ?? undefined);
      }
    }
    // Fallback: center_y only
    if (get_highlight_center_y) {
      const cyA = get_highlight_center_y(a.id) ?? a.labelBox.y;
      const cyB = get_highlight_center_y(b.id) ?? b.labelBox.y;
      if (Math.abs(cyA - cyB) > 2) return cyA - cyB;
    }
    if (get_check_index) {
      const idxA = get_check_index(a.id) ?? 0;
      const idxB = get_check_index(b.id) ?? 0;
      if (idxA !== idxB) return idxA - idxB;
    }
    return a.labelBox.y - b.labelBox.y;
  };
}

/**
 * Sort and stack labels at each side. Mutates labels in-place.
 * For "up" direction: stack vertically with gap. For "right": stack horizontally.
 */
export function sortAndStackLabelsAtSides(
  labels: HintPlacementResultExtended[],
  do_sort: boolean,
  options: {
    gap: number;
    skip_ids?: Set<string>;
    get_passed?: (id: string) => boolean | undefined;
    get_highlight_center_y?: (id: string) => number | null;
    get_check_types?: (id: string) => Set<CheckType>;
    get_check_index?: (id: string) => number | null;
    get_highlight_rect?: (id: string) => BoundingBox | null;
  },
): void {
  const groups = groupLabelsBySide(labels, options.skip_ids);
  const verticalSort = makeVerticalSort(options.get_passed, options.get_highlight_center_y, options.get_check_types, options.get_check_index, options.get_highlight_rect);
  const { gap } = options;

  for (const [sideStr, direction] of Object.entries(REVDOKU_SIDE_SHIFT_DIRECTION)) {
    const side = sideStr as PlacementSide;
    const sideLabels = groups[side];
    if (sideLabels.length === 0) continue;

    if (direction === 'up') {
      if (do_sort) sideLabels.sort(verticalSort);
      else sideLabels.sort((a, b) => a.labelBox.y - b.labelBox.y);
      let nextY = 0;
      for (const lp of sideLabels) {
        lp.labelBox.y = nextY;
        nextY += lp.labelBox.height + gap;
      }
    } else {
      // 'right' — stack horizontally (always sort by current X to preserve prior ordering)
      sideLabels.sort((a, b) => a.labelBox.x - b.labelBox.x);
      let nextX = gap;
      for (const lp of sideLabels) {
        lp.labelBox.x = nextX;
        nextX += lp.labelBox.width + gap;
      }
    }
  }
}

/** Options for autoRepositionLabels */
export interface AutoRepositionOptions {
  page_width: number;
  page_height: number;
  gap: number;
  steps: AutoRepositionStep[];
  constraint_ctx: ConstraintContext;
  resize_label: (id: string, targetWidth: number) => { width: number; height: number };
  get_passed?: (id: string) => boolean | undefined;
  get_highlight_center_y?: (id: string) => number | null;
  get_highlight_rect?: (id: string) => BoundingBox | null;
  get_check_types?: (id: string) => Set<CheckType>;
  get_check_index?: (id: string) => number | null;
  check_filter?: CheckFilterType;
  skip_ids?: Set<string>;
}

/** Item for the spread algorithm — any label with a Y position, height, and highlight center Y */
export interface SpreadItem {
  y: number;
  height: number;
  hlCenterY: number;
}

/**
 * Spread labels along Y axis to be as close as possible to their highlights.
 * Two-pass: bottom-to-top (priority to bottom labels), then top-to-bottom (fix overlaps).
 * Mutates items in place (updates .y).
 */
export function spreadLabelsTowardHighlights(
  items: SpreadItem[],
  pageHeight: number,
  gap: number,
): void {
  if (items.length === 0) return;

  // Pass 1: bottom-to-top — bottom labels get priority for ideal position
  items.sort((a, b) => b.hlCenterY - a.hlCenterY);
  let nextMaxBottom = pageHeight;
  for (const item of items) {
    const targetY = item.hlCenterY - item.height / 2;
    let newY = Math.min(targetY, nextMaxBottom - item.height);
    newY = Math.max(newY, gap);
    item.y = newY;
    nextMaxBottom = newY - gap;
  }

  // Pass 2: top-to-bottom — fix any overlaps from Pass 1
  items.sort((a, b) => a.y - b.y);
  let nextMinY = gap;
  for (const item of items) {
    if (item.y < nextMinY) {
      item.y = nextMinY;
    }
    nextMinY = item.y + item.height + gap;
  }
}

/**
 * Main auto-reposition algorithm. Runs the specified steps on the given labels.
 * Mutates labels in-place (updates labelBox and side).
 */
export function autoRepositionLabels(
  labels: HintPlacementResultExtended[],
  options: AutoRepositionOptions,
): void {
  const { page_width, page_height, gap, steps, constraint_ctx, resize_label, get_passed, get_highlight_center_y, get_highlight_rect, get_check_types, get_check_index, check_filter, skip_ids } = options;
  const shouldRun = (step: AutoRepositionStep) => steps.includes(step);

  // --- Step 1: Classify labels into side groups ---
  if (shouldRun(AutoRepositionStep.STEP_CLASSIFY)) {
    updateLabelSides(labels, page_width, page_height);
    console.debug(`[autoReposition] Step 1 classify: ${labels.map(lp => `${lp.id.slice(-6)}→${lp.side}`).join(', ')}`);
  }

  // --- Step 2 (Pass 1): Sort and stack labels at sides ---
  if (shouldRun(AutoRepositionStep.STEP_SORT_AND_STACK)) {
    sortAndStackLabelsAtSides(labels, true, { gap, skip_ids, get_passed, get_highlight_center_y, get_check_types, get_check_index, get_highlight_rect });
  }

  // --- Step 3 (Pass 1.5): Constraint-driven width expansion — RIGHT side only ---
  if (shouldRun(AutoRepositionStep.STEP_EXPAND_RIGHT)) {
    const rightConstraints = REVDOKU_LABEL_SIZE_CONSTRAINTS[PlacementSide.RIGHT];
    if (rightConstraints) {
      const [minW, maxW] = resolveMinMax(rightConstraints.width, constraint_ctx);
      const [, maxH] = resolveMinMax(rightConstraints.height, constraint_ctx);
      const availableSideWidth = (constraint_ctx.viewer_width - page_width) / 2 - gap * 2;
      const baseTargetWidth = Math.max(minW, Math.min(availableSideWidth, maxW));

      const rightLabels = labels.filter(lp => lp.side === PlacementSide.RIGHT && !skip_ids?.has(lp.id));
      let anyResized = false;

      for (const label of rightLabels) {
        let targetWidth = baseTargetWidth;

        // Collision check: limit width if another label is to the right at same Y
        for (const other of labels) {
          if (other.id === label.id) continue;
          const yOverlap = label.labelBox.y < other.labelBox.y + other.labelBox.height &&
            label.labelBox.y + label.labelBox.height > other.labelBox.y;
          if (yOverlap && other.labelBox.x > label.labelBox.x) {
            targetWidth = Math.min(targetWidth, other.labelBox.x - label.labelBox.x - gap);
          }
        }

        if (targetWidth > label.labelBox.width) {
          const { width, height } = resize_label(label.id, targetWidth);
          label.labelBox.width = width;
          label.labelBox.height = Math.min(height, maxH);
          anyResized = true;
        }
      }

      // Re-stack right side after resizing
      if (anyResized) {
        const vertSort = makeVerticalSort(get_passed, get_highlight_center_y, get_check_types, get_check_index, get_highlight_rect);
        rightLabels.sort(vertSort);
        let nextY = 0;
        for (const lp of rightLabels) {
          lp.labelBox.y = nextY;
          nextY += lp.labelBox.height + gap;
        }
      }
    }
  }

  // --- Step 4: Record label IDs per side (snapshot before redistribution) ---
  let labelIdsPerSide: Record<PlacementSide, Set<string>> = {
    [PlacementSide.RIGHT]: new Set(),
    [PlacementSide.LEFT]: new Set(),
    [PlacementSide.TOP]: new Set(),
    [PlacementSide.BOTTOM]: new Set(),
    [PlacementSide.INSIDE]: new Set(),
  };

  if (shouldRun(AutoRepositionStep.STEP_SNAPSHOT_SIDES)) {
    for (const lp of labels) {
      if (!skip_ids?.has(lp.id)) {
        labelIdsPerSide[lp.side].add(lp.id);
      }
    }
  }

  // --- Step 5 (Pass 2): Cross-side redistribution ---
  if (shouldRun(AutoRepositionStep.STEP_REDISTRIBUTE)) {
    const groups = groupLabelsBySide(labels, skip_ids);
    const vertSort = makeVerticalSort(get_passed, get_highlight_center_y, get_check_types, get_check_index, get_highlight_rect);

    const currentFill = (sideLabels: HintPlacementResultExtended[], isVertical: boolean): number => {
      if (sideLabels.length === 0) return 0;
      return sideLabels.reduce((sum, lp) => sum + (isVertical ? lp.labelBox.height : lp.labelBox.width) + gap, 0);
    };

    const targetOrder: PlacementSide[] = [PlacementSide.RIGHT, PlacementSide.LEFT, PlacementSide.TOP, PlacementSide.BOTTOM];

    for (const targetSide of targetOrder) {
      const sources = REVDOKU_SIDE_FILL_SOURCES[targetSide];
      if (!sources || sources.length === 0) continue;

      const isVertical = targetSide === PlacementSide.RIGHT || targetSide === PlacementSide.LEFT;
      const maxCapacity = (isVertical ? page_height : page_width) * (REVDOKU_SIDE_MAX_FILL[targetSide] ?? 1.0);
      const targetLabels = groups[targetSide];
      let fill = currentFill(targetLabels, isVertical);
      if (fill >= maxCapacity) continue;

      let moved = false;
      for (const sourceSide of sources) {
        const sourceLabels = groups[sourceSide];
        if (sourceLabels.length === 0) continue;

        for (let i = sourceLabels.length - 1; i >= 0; i--) {
          const lp = sourceLabels[i];
          const labelSize = isVertical ? lp.labelBox.height : lp.labelBox.width;
          if (fill + labelSize + gap > maxCapacity) continue;

          // Move label to target side
          sourceLabels.splice(i, 1);
          targetLabels.push(lp);
          lp.side = targetSide;
          fill += labelSize + gap;
          moved = true;

          // Update labelIdsPerSide
          labelIdsPerSide[sourceSide].delete(lp.id);
          labelIdsPerSide[targetSide].add(lp.id);

          // Set initial X/Y for target side
          if (targetSide === PlacementSide.RIGHT) {
            lp.labelBox.x = page_width + gap;
          } else if (targetSide === PlacementSide.LEFT) {
            lp.labelBox.x = -(lp.labelBox.width + gap);
          } else if (targetSide === PlacementSide.TOP) {
            lp.labelBox.y = -(lp.labelBox.height + gap);
          } else if (targetSide === PlacementSide.BOTTOM) {
            lp.labelBox.y = page_height + gap;
          }

          if (fill >= maxCapacity) break;
        }
        if (fill >= maxCapacity) break;
      }

      // Re-stack target side after moves
      if (moved) {
        if (isVertical) {
          targetLabels.sort(vertSort);
          let nextY = gap;
          for (const lp of targetLabels) {
            lp.labelBox.y = nextY;
            nextY += lp.labelBox.height + gap;
          }
        } else {
          targetLabels.sort((a, b) => a.labelBox.x - b.labelBox.x);
          let nextX = gap;
          for (const lp of targetLabels) {
            lp.labelBox.x = nextX;
            nextX += lp.labelBox.width + gap;
          }
        }
      }
    }

    // Re-stack source sides that had labels removed
    for (const side of [PlacementSide.LEFT, PlacementSide.TOP, PlacementSide.BOTTOM] as PlacementSide[]) {
      const sideLabels = groups[side];
      if (sideLabels.length === 0) continue;
      const isVertical = side === PlacementSide.LEFT;
      if (isVertical) {
        sideLabels.sort(vertSort);
        let nextY = gap;
        for (const lp of sideLabels) {
          lp.labelBox.y = nextY;
          nextY += lp.labelBox.height + gap;
        }
      } else {
        sideLabels.sort((a, b) => a.labelBox.x - b.labelBox.x);
        let nextX = gap;
        for (const lp of sideLabels) {
          lp.labelBox.x = nextX;
          nextX += lp.labelBox.width + gap;
        }
      }
    }
  }

  // --- Step 5b: Overflow from RIGHT → LEFT ---
  // Only moves labels when RIGHT exceeds its max capacity (unlike REVDOKU_SIDE_FILL_SOURCES
  // which greedily pulls into a target). Moves bottom-most labels first.
  if (shouldRun(AutoRepositionStep.STEP_REDISTRIBUTE)) {
    const groups = groupLabelsBySide(labels, skip_ids);
    const rightLabels = groups[PlacementSide.RIGHT];
    const leftLabels = groups[PlacementSide.LEFT];
    const rightMaxCapacity = page_height * (REVDOKU_SIDE_MAX_FILL[PlacementSide.RIGHT] ?? 1.0);
    const rightFill = rightLabels.reduce((sum, lp) => sum + lp.labelBox.height + gap, 0);
    console.debug(`[autoReposition] Step 5b: RIGHT fill=${Math.round(rightFill)}, maxCap=${Math.round(rightMaxCapacity)}, labels=${rightLabels.length}`);

    if (rightFill > rightMaxCapacity && rightLabels.length > 1) {
      const leftMaxCapacity = page_height * (REVDOKU_SIDE_MAX_FILL[PlacementSide.LEFT] ?? 1.0);
      let leftFill = leftLabels.reduce((sum, lp) => sum + lp.labelBox.height + gap, 0);
      let moved = false;

      // Move bottom-most labels from RIGHT to LEFT until RIGHT fits
      let rf = rightFill;
      for (let i = rightLabels.length - 1; i >= 0 && rf > rightMaxCapacity; i--) {
        const lp = rightLabels[i];
        const sz = lp.labelBox.height + gap;
        if (leftFill + sz > leftMaxCapacity) continue;
        rightLabels.splice(i, 1);
        leftLabels.push(lp);
        lp.side = PlacementSide.LEFT;
        lp.labelBox.x = -(lp.labelBox.width + gap);
        labelIdsPerSide[PlacementSide.RIGHT].delete(lp.id);
        labelIdsPerSide[PlacementSide.LEFT].add(lp.id);
        rf -= sz;
        leftFill += sz;
        moved = true;
      }

      if (moved) {
        const vertSort = makeVerticalSort(get_passed, get_highlight_center_y, get_check_types, get_check_index, get_highlight_rect);
        // Re-stack both sides
        for (const sideLabels of [rightLabels, leftLabels]) {
          sideLabels.sort(vertSort);
          let nextY = gap;
          for (const lp of sideLabels) {
            lp.labelBox.y = nextY;
            nextY += lp.labelBox.height + gap;
          }
        }
      }
    }
  }

  // --- Step 6 (Pass 4): Post-redistribution width expansion — right then left ---
  if (shouldRun(AutoRepositionStep.STEP_EXPAND_POST_REDIST)) {
    for (const expandConfig of REVDOKU_SIDE_EXPANSION_CONFIG) {
      const { side, opposite_side, use_max_width_if_opposite_side_has_zero_labels } = expandConfig;
      const sideConstraints = REVDOKU_LABEL_SIZE_CONSTRAINTS[side];
      if (!sideConstraints) continue;

      const sideLabels = labels.filter(lp => lp.side === side && !skip_ids?.has(lp.id));
      if (sideLabels.length === 0) continue;

      const oppositeLabels = labels.filter(lp => lp.side === opposite_side && !skip_ids?.has(lp.id));

      let only_new_labels = true;
      let maxWidthOverride: number | undefined;

      if (oppositeLabels.length === 0 && use_max_width_if_opposite_side_has_zero_labels) {
        const availSideWidth = (constraint_ctx.viewer_width - page_width) / 2 - gap * 2;
        maxWidthOverride = availSideWidth * 2;
        only_new_labels = false;
      }

      const [minW, maxW] = resolveMinMax(sideConstraints.width, constraint_ctx);
      const [, maxH] = resolveMinMax(sideConstraints.height, constraint_ctx);
      const effectiveMaxW = maxWidthOverride !== undefined ? Math.min(maxWidthOverride, maxW) : maxW;
      const availSideWidth = (constraint_ctx.viewer_width - page_width) / 2 - gap * 2;
      const baseTargetWidth = Math.max(minW, Math.min(availSideWidth, effectiveMaxW));

      const preExistingIds = labelIdsPerSide[side];
      let anyResized = false;

      for (const label of sideLabels) {
        if (only_new_labels && preExistingIds.has(label.id)) continue;

        if (baseTargetWidth > label.labelBox.width) {
          const { width, height } = resize_label(label.id, baseTargetWidth);
          label.labelBox.width = width;
          label.labelBox.height = Math.min(height, maxH);
          anyResized = true;
        }
      }

      // Re-stack after expansion
      if (anyResized) {
        const vertSort = makeVerticalSort(get_passed, get_highlight_center_y, get_check_types, get_check_index, get_highlight_rect);
        sideLabels.sort(vertSort);
        let nextY = gap;
        for (const lp of sideLabels) {
          lp.labelBox.y = nextY;
          nextY += lp.labelBox.height + gap;
        }
      }
    }
  }

  // --- Step 7: Re-stack and shift labels using overhang ---
  if (shouldRun(AutoRepositionStep.STEP_RESTACK_AND_SHIFT)) {
    // Find topMinY from top-side labels
    const topLabels = labels.filter(lp => lp.side === PlacementSide.TOP && !skip_ids?.has(lp.id));
    const topMinY = topLabels.length > 0
      ? Math.min(...topLabels.map(lp => lp.labelBox.y))
      : gap;

    for (const [sideStr, direction] of Object.entries(REVDOKU_SIDE_SHIFT_DIRECTION)) {
      const side = sideStr as PlacementSide;
      const sideLabels = labels.filter(lp => lp.side === side && !skip_ids?.has(lp.id));
      if (sideLabels.length === 0) continue;

      if (direction === 'up') {
        // Shift so first label starts at topMinY, keeping gaps intact
        const vertSort = makeVerticalSort(get_passed, get_highlight_center_y, get_check_types, get_check_index, get_highlight_rect);
        sideLabels.sort(vertSort);
        let nextY = topMinY;
        for (const lp of sideLabels) {
          lp.labelBox.y = nextY;
          nextY += lp.labelBox.height + gap;
        }
      } else {
        // 'right' — stack from page right edge
        sideLabels.sort((a, b) => a.labelBox.x - b.labelBox.x);
        let nextX = page_width;
        for (const lp of sideLabels) {
          lp.labelBox.x = nextX;
          nextX += lp.labelBox.width + gap;
        }
      }
    }
  }

  // --- Step 8: Magnet labels to page edges ---
  if (shouldRun(AutoRepositionStep.STEP_MAGNET)) {
    for (const lp of labels) {
      if (skip_ids?.has(lp.id)) continue;
      const magnetConfig = REVDOKU_SIDE_TO_MAGNET_TO[lp.side];
      if (!magnetConfig.magnet) continue;

      switch (lp.side) {
        case PlacementSide.RIGHT:
          lp.labelBox.x = page_width + magnetConfig.gap;
          break;
        case PlacementSide.LEFT:
          lp.labelBox.x = -(lp.labelBox.width + magnetConfig.gap);
          break;
        case PlacementSide.BOTTOM:
          lp.labelBox.y = page_height + magnetConfig.gap;
          break;
        case PlacementSide.TOP:
          lp.labelBox.y = -(lp.labelBox.height + magnetConfig.gap);
          break;
      }
    }
  }

  // --- Step 9.5: Group by check type (only for multi-type filters) ---
  if (shouldRun(AutoRepositionStep.STEP_GROUP_BY_CHECK_TYPE) && get_check_types) {
    const shouldGroup = !check_filter ||
      check_filter === CheckFilterType.ALL ||
      check_filter === CheckFilterType.FAILED_AND_CHANGES;
    if (shouldGroup) {
      const groups = groupLabelsBySide(labels, skip_ids);
      for (const side of [PlacementSide.RIGHT, PlacementSide.LEFT] as const) {
        if (groups[side].length > 1) {
          groupLabelsByCheckType(groups[side], get_check_types, 'y', gap);
        }
      }
      for (const side of [PlacementSide.TOP, PlacementSide.BOTTOM] as const) {
        if (groups[side].length > 1) {
          groupLabelsByCheckType(groups[side], get_check_types, 'x', gap);
        }
      }
    }
  }

  // --- Step 10 (Pass 3): Final restack (do_sort: false) ---
  if (shouldRun(AutoRepositionStep.STEP_FINAL_RESTACK)) {
    sortAndStackLabelsAtSides(labels, false, { gap, skip_ids });
  }

  // --- Step 11: Spread labels along margins closer to their highlights ---
  // For each side, check the angle between highlight's near corner and label's
  // near corner. If positive (label above highlight), move label down until
  // angle reaches 0° (horizontal). Only apply if angle improves by ≥10°.
  if (shouldRun(AutoRepositionStep.STEP_SPREAD_CLOSE_TO_HIGHLIGHTS) && get_highlight_rect) {
    // Re-classify sides from current positions so we spread each column independently
    updateLabelSides(labels, page_width, page_height);

    // Group labels by vertical column (RIGHT, LEFT, INSIDE treated as RIGHT)
    // LEFT and RIGHT labels are in different columns — they must NOT constrain each other.
    const groups: Record<string, Array<{ lp: HintPlacementResultExtended; item: SpreadItem }>> = {};
    for (const lp of labels) {
      const hl = get_highlight_rect(lp.id);
      if (!hl) continue;
      // Group INSIDE with RIGHT (they're in the same visual column)
      const column = lp.side === PlacementSide.LEFT ? 'left' : 'right';
      if (!groups[column]) groups[column] = [];
      groups[column].push({
        lp,
        item: { y: lp.labelBox.y, height: lp.labelBox.height, hlCenterY: hl.y + hl.height / 2 },
      });
    }

    // Spread each column independently
    const vertSort = makeVerticalSort(get_passed, get_highlight_center_y, get_check_types, get_check_index, get_highlight_rect);
    for (const spreadItems of Object.values(groups)) {
      if (spreadItems.length === 0) continue;
      const items = spreadItems.map(s => s.item);
      spreadLabelsTowardHighlights(items, page_height, gap);
      for (let i = 0; i < spreadItems.length; i++) {
        spreadItems[i].lp.labelBox.y = spreadItems[i].item.y;
      }

      // Re-sort by check_index after spreading to restore correct label order.
      // spreadLabelsTowardHighlights positions labels near their highlights but may
      // swap the order of labels whose highlights are in a similar vertical area.
      // Strategy: collect the spread Y positions, sort labels by check_index,
      // then assign spread positions in order (lowest Y → lowest index).
      const spreadYPositions = spreadItems
        .map(s => s.lp.labelBox.y)
        .sort((a, b) => a - b);
      const columnLabels = spreadItems.map(s => s.lp);
      columnLabels.sort(vertSort);
      for (let i = 0; i < columnLabels.length; i++) {
        columnLabels[i].labelBox.y = spreadYPositions[i];
      }
    }
  }

  // --- Step 12: Enforce overflow — balanced LEFT/RIGHT distribution ---
  if (shouldRun(AutoRepositionStep.STEP_ENFORCE_OVERFLOW)) {
    const groups = groupLabelsBySide(labels, skip_ids);
    const rightLabels = groups[PlacementSide.RIGHT];
    const leftLabels = groups[PlacementSide.LEFT];
    const rightFill = rightLabels.reduce((s, lp) => s + lp.labelBox.height + gap, 0);
    const rightMaxCap = page_height * (REVDOKU_SIDE_MAX_FILL[PlacementSide.RIGHT] ?? 1.0);
    console.debug(`[autoReposition] Step 12: RIGHT fill=${Math.round(rightFill)}, maxCap=${Math.round(rightMaxCap)}, right=${rightLabels.length}, left=${leftLabels.length}, pageH=${Math.round(page_height)}, skip=${skip_ids?.size ?? 0}`);

    if (rightFill > rightMaxCap && rightLabels.length > 1) {
      // Split vertical labels ~evenly between RIGHT and LEFT
      const totalVertLabels = rightLabels.length + leftLabels.length;
      const targetRightCount = Math.ceil(totalVertLabels / 2);
      const excessCount = rightLabels.length - targetRightCount;
      console.debug(`[autoReposition] Step 12: moving ${excessCount} labels from RIGHT to LEFT (target ${targetRightCount} right of ${totalVertLabels} total)`);

      if (excessCount > 0) {
        // Move bottom-most RIGHT labels to LEFT
        rightLabels.sort((a, b) => b.labelBox.y - a.labelBox.y);
        for (let i = 0; i < excessCount && i < rightLabels.length; i++) {
          const lp = rightLabels[i];
          lp.side = PlacementSide.LEFT;
          lp.labelBox.x = -(lp.labelBox.width + gap);
        }

        // Re-stack both sides
        for (const side of [PlacementSide.RIGHT, PlacementSide.LEFT] as const) {
          const sideLabels = labels.filter(lp => lp.side === side && !skip_ids?.has(lp.id));
          sideLabels.sort((a, b) => a.labelBox.y - b.labelBox.y);
          let nextY = gap;
          for (const lp of sideLabels) {
            lp.labelBox.y = nextY;
            nextY += lp.labelBox.height + gap;
          }
        }
      }
    }
  }
}

// ============================================
// SECTION 12: STRAIGHT CONNECTION LINES
// ============================================

/** Determines which border of the label faces the highlight based on side */
export type MainBorderSide = 'left' | 'right' | 'top' | 'bottom';

/** Get the main border side (the side facing the page) for a given label side */
export function getMainBorderForSide(side: PlacementSide): MainBorderSide {
  switch (side) {
    case PlacementSide.RIGHT: return 'left';
    case PlacementSide.LEFT: return 'right';
    case PlacementSide.TOP: return 'bottom';
    case PlacementSide.BOTTOM: return 'top';
    case PlacementSide.INSIDE: return 'left';
  }
}

/**
 * For inside labels, determine which side the highlight rect is relative to the label.
 * Returns the side of the label that faces the highlight.
 */
function getInsideLabelMainBorder(labelBox: BoundingBox, highlightBox: BoundingBox): MainBorderSide {
  const hlCx = highlightBox.x + highlightBox.width / 2;
  const hlCy = highlightBox.y + highlightBox.height / 2;
  const lbCx = labelBox.x + labelBox.width / 2;
  const lbCy = labelBox.y + labelBox.height / 2;

  const dx = hlCx - lbCx;
  const dy = hlCy - lbCy;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'bottom' : 'top';
}

/** Get the midpoint of a specific border of a bounding box */
function getBorderMidpoint(box: BoundingBox, border: MainBorderSide): Point {
  switch (border) {
    case 'left': return { x: box.x, y: box.y + box.height / 2 };
    case 'right': return { x: box.x + box.width, y: box.y + box.height / 2 };
    case 'top': return { x: box.x + box.width / 2, y: box.y };
    case 'bottom': return { x: box.x + box.width / 2, y: box.y + box.height };
  }
}

/**
 * Compute a straight connection line from a label to its highlight.
 * Returns start (label border midpoint) and end (highlight center).
 */
export function computeStraightConnectionLine(
  labelBox: BoundingBox,
  highlightBox: BoundingBox,
  side: PlacementSide,
): { start: Point; end: Point } {
  let mainBorder: MainBorderSide;

  if (side === PlacementSide.INSIDE) {
    mainBorder = getInsideLabelMainBorder(labelBox, highlightBox);
  } else {
    mainBorder = getMainBorderForSide(side);
  }

  const start = getBorderMidpoint(labelBox, mainBorder);

  // Snap end point to nearest highlight edge facing the label, not the center
  const cx = highlightBox.x + highlightBox.width / 2;
  const cy = highlightBox.y + highlightBox.height / 2;
  const edges: Point[] = [
    { x: highlightBox.x, y: cy },                              // left
    { x: highlightBox.x + highlightBox.width, y: cy },          // right
    { x: cx, y: highlightBox.y },                               // top
    { x: cx, y: highlightBox.y + highlightBox.height },         // bottom
  ];
  let end = edges[0];
  let bestDist = Infinity;
  for (const e of edges) {
    const d = (start.x - e.x) ** 2 + (start.y - e.y) ** 2;
    if (d < bestDist) { bestDist = d; end = e; }
  }

  return { start, end };
}

// ---------------------------------------------------------------------------
// Align labels to top — standalone utility
// ---------------------------------------------------------------------------

export interface AlignToTopLabel {
  id: string;
  y: number;
  height: number;
  highlightCenterY: number;
}

/**
 * Reposition labels to stack from the top of the page.
 * Returns a map of label ID → new Y position.
 *
 * Pure function — no DOM, no placement algorithm.
 * Can be used in revdoku-doc-api SVG export and in client-side report JS.
 */
export function alignLabelsToTop(
  labels: AlignToTopLabel[],
  gap: number = REVDOKU_MARGIN_LABEL_VERTICAL_GAP,
  startY: number = 0,
): Map<string, number> {
  const sorted = [...labels].sort((a, b) => a.highlightCenterY - b.highlightCenterY);
  const result = new Map<string, number>();
  let currentY = startY;
  for (const label of sorted) {
    result.set(label.id, currentY);
    currentY += label.height + gap;
  }
  return result;
}
