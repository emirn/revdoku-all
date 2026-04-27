import { createCanvas, Image } from 'canvas';
import sharp from 'sharp';
import { IPageInfo, IReport, ICoordinates, REVDOKU_HIGHLIGHT_ROUNDING_PERCENT, REVDOKU_HIGHLIGHT_FILL_ENABLED, ICheck, CheckSource, MessageBoxMode, getFontFamilyCss, LabelFontFamily, HighlightMode, drawHighlightBorder, getHighlightModeConfig, getConnectionLineEndpoint, REVDOKU_DEFAULT_LABEL_TEXT_ALIGNMENT } from '@revdoku/lib';
import { getColorsForCheckResult, getWidth, getHeight, getMinOpacityForImageSize, createColorWithOpacity } from '@revdoku/lib';
import {
  getCheckIconType as getCheckIconTypeShared, getCheckDataTypeLabels,
  REVDOKU_TYPE_BADGE_CHANGES_BORDER, REVDOKU_TYPE_BADGE_CHANGES_BG, REVDOKU_TYPE_BADGE_CHANGES_TEXT,
  REVDOKU_TYPE_BADGE_RECHECK_BORDER, REVDOKU_TYPE_BADGE_RECHECK_BG, REVDOKU_TYPE_BADGE_RECHECK_TEXT,
  REVDOKU_ICON_COLOR_CHANGES, REVDOKU_ICON_COLOR_RECHECK, REVDOKU_TYPE_BADGE_FONT_SCALE,
  REVDOKU_TYPE_BADGE_FONT_WEIGHT, REVDOKU_TYPE_BADGE_HEIGHT_SCALE, REVDOKU_TYPE_BADGE_PADDING_H,
  REVDOKU_TYPE_BADGE_GAP, REVDOKU_TYPE_BADGE_BORDER_RADIUS, REVDOKU_CHECK_ICON_SIZE_SCALE, REVDOKU_CHECK_ICON_GAP,
  REVDOKU_LABEL_BADGE_GAP,
  REVDOKU_VAL_DISPLAY_OPACITY,
  REVDOKU_VAL_DISPLAY_FONT_SCALE,
  formatValDisplay,
} from '@revdoku/lib';
import { REVDOKU_CATCH_CHANGES_RULE_ID } from './checklist-utils';
import { detectContentBoxes } from './content-detection';
import {
  calculateBadgeMetrics,
  calculateCornerRadius,
  calculateMessageMetrics,
  calculateSourceBadgePosition,

  REVDOKU_BADGE_BACKGROUND_COLOR,
  REVDOKU_BADGE_TEXT_COLOR,
  REVDOKU_MESSAGE_BACKGROUND_COLOR_TEMPLATE,
  REVDOKU_ARROW_LINE_WIDTH,
  REVDOKU_ARROW_HEAD_SIZE,
  REVDOKU_LEADER_LINE_WIDTH_V2,
  REVDOKU_LEADER_OPACITY,
  REVDOKU_LEADER_DASH_PATTERN,
  REVDOKU_LEADER_ARROW_MIN,
  REVDOKU_LEADER_ARROW_MAX,
  REVDOKU_LEADER_ARROW_RATIO,
  REVDOKU_LEADER_ARROW_ANGLE,
  REVDOKU_LEADER_ENDPOINT_STYLE,
  REVDOKU_LEADER_CIRCLE_RADIUS,
  REVDOKU_ANNOTATION_MARGIN,
  REVDOKU_ANNOTATION_MARGIN_SCALE_EXPONENT,
  REVDOKU_MARGIN_LABEL_FONT_SIZE,
  REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
  REVDOKU_MARGIN_LABEL_INNER_PADDING,
  REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING,
  REVDOKU_MARGIN_LABEL_VERTICAL_GAP,
  REVDOKU_MARGIN_LABEL_MAX_LINES,
  REVDOKU_LAYOUT_LABEL_MAX_LINES,
  estimateWrappedLabelDimensions,
  computeLabelMetrics,
  calculateLabelBadgeSpec,
  drawLabelBadge,
  drawLabelBorder,
  drawRecheckIcon,
  drawChangesIcon,
} from '@revdoku/lib';
import { PlacementSide, computeStraightConnectionLine, getCheckTypes, CheckFilterType, autoRepositionLabels, REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS, AutoRepositionStep } from '@revdoku/lib';
import type { HintPlacementInput, HintPlacementResultExtended, IContentBox, BoundingBox } from '@revdoku/lib';
import { placeCheckLabels, type PlaceCheckLabelsOptions } from './place-check-labels';
import { placeCompactBadges } from './compact-badge-placer';
import { IPageInfoExtended, EGridMode } from '../schemas/common-server';
import { docToContentPixel, docToGridCanvasPixel } from './coordinate-utils';
import { RENDERED_PAGES_JPEG_QUALITY } from './constants';
import { getGridModeConfig, resolveMargins, drawPageLabelOverlay } from './grid-mode-config';


/** Strip #recheck tag from description for display (icons drawn separately via getCheckIconType).
 *  Appends data.val hint whenever it is present and non-empty. */
function formatCheckDescription(desc: string | undefined | null, _ruleId?: string, data?: { val?: string } | null): string {
  if (!desc) return '';
  let text = desc;
  if (text.startsWith('#recheck '))
    text = text.slice('#recheck '.length);
  if (data?.val)
    text += ` ${formatValDisplay(data.val)}`;
  return text;
}

/** Determine which icon to draw before the label text */
function getCheckIconType(desc: string | undefined | null, ruleId?: string): import('@revdoku/lib').CheckIconType {
  return getCheckIconTypeShared({ description: desc ?? undefined, rule_id: ruleId });
}

// Ruler color constants - optimized for AI vision models
// High contrast colors work best for AI models like GPT-4V and Claude
const RULER_BACKGROUND_COLOR = '#ffffff'; // Pure white for maximum contrast
const RULER_BORDER_COLOR = '#000000'; // Pure black for clear boundaries
const RULER_TEXT_COLOR = '#000000'; // Pure black text on white background
const RULER_TICK_COLOR = '#000000'; // Black tick marks
const RULER_SUBTLE_GRID_COLOR = 'rgba(128, 128, 128, 0.15)'; // Medium gray with low opacity

// Tick size constants - optimized for AI readability
// Standard Letter size at 200 DPI = 1700x2200 pixels
const STANDARD_IMAGE_SIZE = 2000; // Reference size for normalization
const MIN_IMAGE_SIZE_FOR_UPSCALE = 100; // Only upscale if image is smaller than this
const MAJOR_TICK_LENGTH = 10; // Length of major ticks with labels
const MIDDLE_TICK_LENGTH = 7; // Length of middle ticks (e.g., 50 between 0 and 100)
const MINOR_TICK_LENGTH = 4; // Length of minor ticks
const TICK_LINE_WIDTH_MAJOR = 1.0; // Line width for major ticks
const TICK_LINE_WIDTH_MIDDLE = 0.8; // Line width for middle ticks
const TICK_LINE_WIDTH_MINOR = 0.5; // Line width for minor ticks

// Cross-platform font stack - these fonts are available on most systems including Ubuntu
// Monospace fonts provide consistent character width for better coordinate readability
const RULER_FONT_FAMILY = 'monospace, "DejaVu Sans Mono", "Liberation Mono", "Courier New", Courier';

/**
 * Calculate a round step size for grid/ruler spacing
 * Used for both visual grid rendering and content box detection alignment
 * Targets around 10-20 major ticks for consistent granularity
 * @param dimension The dimension (width or height) to calculate step size for
 * @returns A round step size (10, 20, 25, 50, 100, 200, 250, 500, 1000, etc.)
 */
export function calculateRoundStep(dimension: number): number {
  // Target around 10-20 major ticks
  const targetSteps = 15;
  const roughStep = dimension / targetSteps;

  // Round step options in order of preference
  const roundSteps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

  // Find the closest round step
  let bestStep = roundSteps[0];
  for (const step of roundSteps) {
    if (step >= roughStep * 0.8) {
      bestStep = step;
      break;
    }
  }

  return bestStep;
}

interface IGridLayout {
  rulerSize: number;
  rulerFontSize: number;
  badgeMarginLeft: number;
  badgeMarginRight: number;
  badgeMarginTop: number;
  badgeMarginBottom: number;
}

/**
 * Calculates ruler sizes and badge overflow margins for all external-ruler grid modes.
 * Returns zeros for OVERLAY mode (no rulers/margins).
 *
 * Uses pixel dimensions of the input image (not document-space dimensions).
 * This ensures both PNG and PDF inputs produce the same grid layout.
 */
export function calculateGridLayout(
  gridMode: EGridMode,
  imgWidth: number,
  imgHeight: number,
  aiCoordScale: number = 0,
): IGridLayout {
  let rulerSize = 0;
  let rulerFontSize = 14;
  let badgeMarginLeft = 0;
  let badgeMarginRight = 0;
  let badgeMarginTop = 0;
  let badgeMarginBottom = 0;

  if (
    gridMode === EGridMode.RULERS_EXTERNAL ||
    gridMode === EGridMode.RULERS_EXTERNAL_WITH_SUBTLE_GRID ||
    gridMode === EGridMode.OVERLAY_WITH_RULERS
  ) {
    rulerSize = Math.max(40, Math.round(Math.min(imgWidth, imgHeight) * 0.04));
    rulerSize = Math.min(rulerSize, 60);

    const minFontSize = 12;
    const maxFontSize = 20;
    rulerFontSize = Math.min(maxFontSize, Math.max(minFontSize, Math.floor(rulerSize * 0.3)));

    // Ensure rulerSize fits the widest vertical ruler label
    const maxLabelValue = aiCoordScale > 0 ? aiCoordScale : imgHeight;
    const maxLabelChars = maxLabelValue.toString().length;
    const estCharWidth = rulerFontSize * 0.6;
    const LABEL_PADDING = 12;
    const neededWidth = Math.ceil(maxLabelChars * estCharWidth) + LABEL_PADDING;
    rulerSize = Math.max(rulerSize, neededWidth);

    // Corner coordinates: scaled values when aiCoordScale > 0, otherwise pixel coords
    const cornerTLX = 0;
    const cornerTLY = 0;
    const cornerBRX = aiCoordScale > 0 ? aiCoordScale : imgWidth;
    const cornerBRY = aiCoordScale > 0 ? aiCoordScale : imgHeight;

    // Horizontal badge overflow beyond rulerSize
    const BADGE_PAD_X = 4;
    const maxLeftChars = Math.max(
      `${cornerTLX},${cornerTLY}`.length,
      `${cornerTLX},${cornerBRY}`.length
    );
    const maxRightChars = Math.max(
      `${cornerBRX},${cornerTLY}`.length,
      `${cornerBRX},${cornerBRY}`.length
    );
    const leftBadgeWidth = maxLeftChars * estCharWidth + 2 * BADGE_PAD_X;
    const rightBadgeWidth = maxRightChars * estCharWidth + 2 * BADGE_PAD_X;
    badgeMarginLeft = Math.max(0, Math.ceil(leftBadgeWidth - rulerSize));
    badgeMarginRight = Math.max(0, Math.ceil(rightBadgeWidth - rulerSize));

    // Vertical badge overflow beyond rulerSize
    const BADGE_PAD_Y = 2;
    const badgeHeight = rulerFontSize + 2 * BADGE_PAD_Y + 2;
    badgeMarginTop = Math.max(0, Math.ceil(badgeHeight - rulerSize));
    badgeMarginBottom = badgeMarginTop;
  }

  return { rulerSize, rulerFontSize, badgeMarginLeft, badgeMarginRight, badgeMarginTop, badgeMarginBottom };
}

// Margin scanning constants
const UNIFORMITY_THRESHOLD = 25;   // max RGB channel range for a row/col to be "uniform"
const SCAN_PROBES = 15;            // sample points along each row/col
const MAX_SCAN_FRACTION = 0.45;    // never trim more than 45% from any single side

interface PerSideTrim {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * LEGACY: Pixel-based margin scanning. Kept as fallback for when
 * content_bounding_box is not available (old cached pages, edge cases).
 * Replaced by content-box bounding box approach in main code paths.
 *
 * Variance-based uniformity scanning: for each side, scan inward row-by-row
 * (or column-by-column) and stop at the first non-uniform line. A line is
 * "uniform" when all probe pixels are similar TO EACH OTHER (low RGB range),
 * regardless of what the actual color is. This handles mixed backgrounds
 * (e.g. pink page + white canvas extension) where corner-based detection fails.
 */
function scanPerSideMargins(
  rawData: Buffer,
  width: number,
  height: number,
  channels: number
): PerSideTrim {
  if (width < 2 || height < 2) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  const px = (x: number, y: number) => {
    const off = (y * width + x) * channels;
    return { r: rawData[off], g: rawData[off + 1], b: rawData[off + 2] };
  };

  // Check if a row is uniform: sample SCAN_PROBES x-positions, compute RGB range
  const isRowUniform = (row: number): boolean => {
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (let i = 0; i < SCAN_PROBES; i++) {
      const x = Math.floor((i + 0.5) * width / SCAN_PROBES);
      const p = px(x, row);
      if (p.r < minR) minR = p.r; if (p.r > maxR) maxR = p.r;
      if (maxR - minR > UNIFORMITY_THRESHOLD) return false;
      if (p.g < minG) minG = p.g; if (p.g > maxG) maxG = p.g;
      if (maxG - minG > UNIFORMITY_THRESHOLD) return false;
      if (p.b < minB) minB = p.b; if (p.b > maxB) maxB = p.b;
      if (maxB - minB > UNIFORMITY_THRESHOLD) return false;
    }
    return true;
  };

  // Check if a column is uniform: sample SCAN_PROBES y-positions, compute RGB range
  const isColUniform = (col: number): boolean => {
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (let i = 0; i < SCAN_PROBES; i++) {
      const y = Math.floor((i + 0.5) * height / SCAN_PROBES);
      const p = px(col, y);
      if (p.r < minR) minR = p.r; if (p.r > maxR) maxR = p.r;
      if (maxR - minR > UNIFORMITY_THRESHOLD) return false;
      if (p.g < minG) minG = p.g; if (p.g > maxG) maxG = p.g;
      if (maxG - minG > UNIFORMITY_THRESHOLD) return false;
      if (p.b < minB) minB = p.b; if (p.b > maxB) maxB = p.b;
      if (maxB - minB > UNIFORMITY_THRESHOLD) return false;
    }
    return true;
  };

  const maxScanX = Math.floor(width * MAX_SCAN_FRACTION);
  const maxScanY = Math.floor(height * MAX_SCAN_FRACTION);

  // Scan top → bottom
  let trimTop = 0;
  for (let row = 0; row < maxScanY; row++) {
    if (!isRowUniform(row)) break;
    trimTop = row + 1;
  }

  // Scan bottom → top
  let trimBottom = 0;
  for (let row = height - 1; row >= height - maxScanY; row--) {
    if (!isRowUniform(row)) break;
    trimBottom = height - row;
  }

  // Scan left → right
  let trimLeft = 0;
  for (let col = 0; col < maxScanX; col++) {
    if (!isColUniform(col)) break;
    trimLeft = col + 1;
  }

  // Scan right → left
  let trimRight = 0;
  for (let col = width - 1; col >= width - maxScanX; col--) {
    if (!isColUniform(col)) break;
    trimRight = width - col;
  }

  return { left: trimLeft, top: trimTop, right: trimRight, bottom: trimBottom };
}

const VISUAL_GROUNDING_OPTIONS: {
  addGridLines: boolean,
  addBoundingBoxes: Array<{ x: number, y: number, width: number, height: number, label?: string }>,
  borderWidth: number,
  border_color: string,
  text_color: string,
  fontSize: number
} = {
  addGridLines: true,
  addBoundingBoxes: [],
  borderWidth: 2,
  border_color: 'rgba(0, 255, 0, 0.7)',
  text_color: 'rgba(0, 255, 0, 0.7)',
  fontSize: 14
};

/**
 * Adds visual grounding to a PNG image
 * @param pngBuffer The PNG image data as a Buffer
 * @returns A Buffer containing the grounded image
 */

export async function addVisualGroundingToImage(
  pngBuffer: Uint8Array,
  pageNum: number,
  page_dimensions: IPageInfo,
  gridMode: EGridMode = EGridMode.RULERS_EXTERNAL_WITH_SUBTLE_GRID,
  cropOffsets: { x: number; y: number } = { x: 0, y: 0 },
  aiCoordScale: number = 0
): Promise<Uint8Array> {

  // No grid — pure pass-through (no visual modifications to the image).
  if (gridMode === EGridMode.NONE) {
    return pngBuffer;
  }

  // Axis mode — lightweight X/Y orientation indicators + [PN] overlay label (no bottom strip)
  if (gridMode === EGridMode.AXIS) {
    const config = getGridModeConfig(gridMode);
    const img = new Image();
    img.src = Buffer.from(pngBuffer);

    const leftMargin = config.margins.left;
    const topMargin = config.margins.top;
    const rightMargin = config.margins.right || 0;
    const bottomMargin = config.margins.bottom || 0;
    const fontSize = Math.max(14, Math.floor(topMargin * 0.65));

    const canvasW = img.width + leftMargin + rightMargin;
    const canvasH = img.height + topMargin + bottomMargin;
    const canvas = createCanvas(canvasW, canvasH);
    const ctx = canvas.getContext('2d');

    // White background for margin strips
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw the original image offset by margins
    ctx.drawImage(img, leftMargin, topMargin);

    const axisColor = config.axisArrows.color;
    const arrowLen = 8;

    // --- "0" origin label at top-left corner ---
    if (config.axisArrows.originLabel) {
      ctx.fillStyle = axisColor;
      ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
      ctx.fillText('0', leftMargin - ctx.measureText('0').width - 3, topMargin - 6);
    }

    // --- Horizontal axis arrow (short, in margin) ---
    const xArrowY = topMargin - 2;  // 2px into margin, not on content boundary
    const xArrowStartX = leftMargin;
    const xArrowX = leftMargin + Math.floor(img.width * config.axisArrows.xArrowLengthRatio);

    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 2;
    // Short line from origin to arrowhead
    ctx.beginPath();
    ctx.moveTo(xArrowStartX, xArrowY);
    ctx.lineTo(xArrowX, xArrowY);
    ctx.stroke();
    // Arrowhead pointing right
    ctx.beginPath();
    ctx.moveTo(xArrowX, xArrowY);
    ctx.lineTo(xArrowX - arrowLen, xArrowY - arrowLen / 2);
    ctx.lineTo(xArrowX - arrowLen, xArrowY + arrowLen / 2);
    ctx.closePath();
    ctx.fillStyle = axisColor;
    ctx.fill();
    // "X" label above arrowhead
    ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
    ctx.fillText('X', xArrowX + 4, xArrowY - 5);

    // --- Vertical axis arrow (short, in margin) ---
    const yArrowX = leftMargin - 2;  // 2px into margin, not on content boundary
    const yArrowStartY = topMargin;
    const yArrowY = topMargin + Math.floor(img.height * config.axisArrows.yArrowLengthRatio);

    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 2;
    // Short line from origin to arrowhead
    ctx.beginPath();
    ctx.moveTo(yArrowX, yArrowStartY);
    ctx.lineTo(yArrowX, yArrowY);
    ctx.stroke();
    // Arrowhead pointing down
    ctx.beginPath();
    ctx.moveTo(yArrowX, yArrowY);
    ctx.lineTo(yArrowX - arrowLen / 2, yArrowY - arrowLen);
    ctx.lineTo(yArrowX + arrowLen / 2, yArrowY - arrowLen);
    ctx.closePath();
    ctx.fillStyle = axisColor;
    ctx.fill();
    // "Y" label left of arrowhead
    ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
    const yLabelMetrics = ctx.measureText('Y');
    ctx.fillText('Y', yArrowX - yLabelMetrics.width - 3, yArrowY + fontSize + 2);

    // --- [PN] overlay label on content area ---
    drawPageLabelOverlay(ctx, pageNum, config, img.width, img.height, leftMargin, topMargin);

    return new Uint8Array(canvas.toBuffer('image/png'));
  }

  console.debug('addVisualGroundingToImage', `page_dimensions: ${JSON.stringify({ original_width: page_dimensions.original_width, original_height: page_dimensions.original_height, scaling_factor: page_dimensions.scaling_factor })}, gridMode: ${gridMode}, cropOffsets: ${JSON.stringify(cropOffsets)}`);

  const scaling_factor = page_dimensions.scaling_factor;

  // Image pixel dimensions (the cropped rendered image)
  const imgWidth = page_dimensions.width;   // pixels
  const imgHeight = page_dimensions.height; // pixels

  // Corner coordinate values (scaled if aiCoordScale > 0)
  const cornerTopLeftX = aiCoordScale > 0 ? 0 : 0;
  const cornerTopLeftY = aiCoordScale > 0 ? 0 : 0;
  const cornerBottomRightX = aiCoordScale > 0 ? aiCoordScale : imgWidth;
  const cornerBottomRightY = aiCoordScale > 0 ? aiCoordScale : imgHeight;

  console.debug('addVisualGroundingToImage', `scaling_factor:  ${scaling_factor}`);
  console.debug('addVisualGroundingToImage', `imgWidth:  ${imgWidth}`);
  console.debug('addVisualGroundingToImage', `imgHeight:  ${imgHeight}`);

  try {
    // Create an image from the PNG data
    const img = new Image();
    img.src = Buffer.from(pngBuffer);

    // Calculate ruler size and badge margins based on grid mode (using pixel dimensions)
    const { rulerSize, rulerFontSize, badgeMarginLeft, badgeMarginRight, badgeMarginTop, badgeMarginBottom } = calculateGridLayout(gridMode, img.width, img.height, aiCoordScale);

    // Resolve config once for all mode-specific decisions
    const gridConfig = getGridModeConfig(gridMode);

    // Create canvas - expand if using external rulers (+ badge overflow margins)
    const canvasWidth = !gridConfig.rulers.enabled ? img.width : img.width + (2 * rulerSize);
    const canvasHeight = !gridConfig.rulers.enabled ? img.height : img.height + (2 * rulerSize);
    const canvas = createCanvas(canvasWidth + badgeMarginLeft + badgeMarginRight, canvasHeight + badgeMarginTop + badgeMarginBottom);

    // Calculate grid/ruler step sizes.
    // For overlay modes with aiCoordScale, use config-driven labelStep/lineStep percentages.
    // labelStep=10 means labels every 10% of scale → step = scale * 10/100
    // lineStep=5 means lines every 5% of scale → step = scale * 5/100
    const labelScaledStepX = aiCoordScale > 0
      ? Math.round(aiCoordScale * gridConfig.gridOverlay.labelStep / 100)
      : calculateRoundStep(img.width);
    const labelScaledStepY = aiCoordScale > 0
      ? Math.round(aiCoordScale * gridConfig.gridOverlay.labelStep / 100)
      : calculateRoundStep(img.height);
    const lineScaledStepX = aiCoordScale > 0
      ? Math.round(aiCoordScale * gridConfig.gridOverlay.lineStep / 100)
      : labelScaledStepX;
    const lineScaledStepY = aiCoordScale > 0
      ? Math.round(aiCoordScale * gridConfig.gridOverlay.lineStep / 100)
      : labelScaledStepY;

    // For ruler modes, use label step (backward compat)
    const scaledStepX = labelScaledStepX;
    const scaledStepY = labelScaledStepY;
    const PIXELS_STEP_X = aiCoordScale > 0 ? Math.round(scaledStepX / aiCoordScale * img.width) : scaledStepX;
    const PIXELS_STEP_Y = aiCoordScale > 0 ? Math.round(scaledStepY / aiCoordScale * img.height) : scaledStepY;

    // Minor tick intervals (5 or 10 minor ticks per major tick)
    const MINOR_TICKS_PER_MAJOR = PIXELS_STEP_X >= 100 ? 10 : 5;
    const MINOR_STEP_X = PIXELS_STEP_X / MINOR_TICKS_PER_MAJOR;
    const MINOR_STEP_Y = PIXELS_STEP_Y / MINOR_TICKS_PER_MAJOR;

    console.debug('addVisualGroundingToImage', `PIXELS_STEP_X: ${PIXELS_STEP_X}, MINOR_STEP_X: ${MINOR_STEP_X}`);
    console.debug('addVisualGroundingToImage', `PIXELS_STEP_Y: ${PIXELS_STEP_Y}, MINOR_STEP_Y: ${MINOR_STEP_Y}`);

    const ctx = canvas.getContext('2d');

    // Fill badge margins with ruler background and shift origin so logical coords are unchanged
    if (gridConfig.rulers.enabled && (badgeMarginLeft > 0 || badgeMarginRight > 0 || badgeMarginTop > 0 || badgeMarginBottom > 0)) {
      ctx.fillStyle = RULER_BACKGROUND_COLOR;
      ctx.fillRect(0, 0, canvasWidth + badgeMarginLeft + badgeMarginRight, canvasHeight + badgeMarginTop + badgeMarginBottom);
    }
    if (badgeMarginLeft > 0 || badgeMarginTop > 0) {
      ctx.translate(badgeMarginLeft, badgeMarginTop);
    }

    // Calculate tick size scaling factor based on image pixel size
    const imageSizeAvg = (img.width + img.height) / 2;
    let tickScaleFactor = 1.0; // Default: no scaling

    if (imageSizeAvg > STANDARD_IMAGE_SIZE) {
      // Only downscale for large images
      tickScaleFactor = Math.max(0.5, STANDARD_IMAGE_SIZE / imageSizeAvg);
    } else if (imageSizeAvg < MIN_IMAGE_SIZE_FOR_UPSCALE) {
      // Only upscale for very small images
      tickScaleFactor = Math.min(2.0, MIN_IMAGE_SIZE_FOR_UPSCALE / imageSizeAvg);
    }
    // For images between MIN_IMAGE_SIZE_FOR_UPSCALE and STANDARD_IMAGE_SIZE, keep scale at 1.0

    // Scale tick lengths based on image size
    const scaledMajorTickLength = MAJOR_TICK_LENGTH * tickScaleFactor;
    const scaledMiddleTickLength = MIDDLE_TICK_LENGTH * tickScaleFactor;
    const scaledMinorTickLength = MINOR_TICK_LENGTH * tickScaleFactor;

    console.debug('addVisualGroundingToImage', `imageSizeAvg: ${imageSizeAvg}, tickScaleFactor: ${tickScaleFactor}, major: ${scaledMajorTickLength}, middle: ${scaledMiddleTickLength}, minor: ${scaledMinorTickLength}`);

    // Fill background for ruler area if needed
    if (gridConfig.rulers.enabled) {
      ctx.fillStyle = RULER_BACKGROUND_COLOR;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    // Draw the original image (offset if using external rulers)
    const imageOffsetX = gridConfig.rulers.enabled ? rulerSize : 0;
    const imageOffsetY = gridConfig.rulers.enabled ? rulerSize : 0;
    ctx.drawImage(img, imageOffsetX, imageOffsetY);

    // Draw grid/rulers based on mode
    if (VISUAL_GROUNDING_OPTIONS.addGridLines) {
      if (gridConfig.gridOverlay.enabled && !gridConfig.rulers.enabled) {
        // Overlay mode - draw grid directly on image (config-driven steps)
        const overlayConf = gridConfig.gridOverlay;

        // Calculate font size for grid labels — keep small so the label
        // sits close to the grid line and the AI can pinpoint coordinates precisely.
        // (Rulers mode uses 12-20px; OVERLAY uses a lower cap since labels are on content.)
        const MIN_OVERLAY_FONT = 10;
        const MAX_OVERLAY_FONT = 18;
        const gridLabelFontSize = Math.min(MAX_OVERLAY_FONT,
          Math.max(MIN_OVERLAY_FONT, Math.floor(PIXELS_STEP_X * 0.3)));

        // Pixel step for line-level grid (may be finer than label step)
        const LINE_PIXELS_STEP_X = aiCoordScale > 0 ? Math.round(lineScaledStepX / aiCoordScale * img.width) : lineScaledStepX;
        const LINE_PIXELS_STEP_Y = aiCoordScale > 0 ? Math.round(lineScaledStepY / aiCoordScale * img.height) : lineScaledStepY;

        // Draw vertical lines — unified loop at lineStep intervals
        if (aiCoordScale > 0) {
          for (let sv = 0; sv <= aiCoordScale; sv += lineScaledStepX) {
            const px = Math.round(sv / aiCoordScale * img.width);
            const isLabelLine = sv % labelScaledStepX === 0;

            ctx.strokeStyle = isLabelLine ? overlayConf.color : (overlayConf.subdivisionColor || overlayConf.color);
            ctx.lineWidth = isLabelLine ? overlayConf.lineWidth : (overlayConf.subdivisionLineWidth || overlayConf.lineWidth);
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, img.height);
            ctx.stroke();

            if (isLabelLine) {
              ctx.fillStyle = VISUAL_GROUNDING_OPTIONS.text_color;
              ctx.font = `${gridLabelFontSize}px Arial`;
              ctx.fillText(sv.toString(), px + 2, gridLabelFontSize + 2);
            }
          }
        } else {
          for (let px = 0; px <= img.width; px += LINE_PIXELS_STEP_X) {
            const isLabelLine = px % PIXELS_STEP_X === 0;

            ctx.strokeStyle = isLabelLine ? overlayConf.color : (overlayConf.subdivisionColor || overlayConf.color);
            ctx.lineWidth = isLabelLine ? overlayConf.lineWidth : (overlayConf.subdivisionLineWidth || overlayConf.lineWidth);
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, img.height);
            ctx.stroke();

            if (isLabelLine) {
              ctx.fillStyle = VISUAL_GROUNDING_OPTIONS.text_color;
              ctx.font = `${gridLabelFontSize}px Arial`;
              ctx.fillText(px.toString(), px + 2, gridLabelFontSize + 2);
            }
          }
        }

        // Draw horizontal lines — unified loop at lineStep intervals
        if (aiCoordScale > 0) {
          for (let sv = 0; sv <= aiCoordScale; sv += lineScaledStepY) {
            const py = Math.round(sv / aiCoordScale * img.height);
            const isLabelLine = sv % labelScaledStepY === 0;

            ctx.strokeStyle = isLabelLine ? overlayConf.color : (overlayConf.subdivisionColor || overlayConf.color);
            ctx.lineWidth = isLabelLine ? overlayConf.lineWidth : (overlayConf.subdivisionLineWidth || overlayConf.lineWidth);
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(img.width, py);
            ctx.stroke();

            if (isLabelLine) {
              ctx.fillStyle = VISUAL_GROUNDING_OPTIONS.text_color;
              ctx.font = `${gridLabelFontSize}px Arial`;
              ctx.fillText(sv.toString(), 2, py + gridLabelFontSize + 2);
            }
          }
        } else {
          for (let py = 0; py <= img.height; py += LINE_PIXELS_STEP_Y) {
            const isLabelLine = py % PIXELS_STEP_Y === 0;

            ctx.strokeStyle = isLabelLine ? overlayConf.color : (overlayConf.subdivisionColor || overlayConf.color);
            ctx.lineWidth = isLabelLine ? overlayConf.lineWidth : (overlayConf.subdivisionLineWidth || overlayConf.lineWidth);
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(img.width, py);
            ctx.stroke();

            if (isLabelLine) {
              ctx.fillStyle = VISUAL_GROUNDING_OPTIONS.text_color;
              ctx.font = `${gridLabelFontSize}px Arial`;
              ctx.fillText(py.toString(), 2, py + gridLabelFontSize + 2);
            }
          }
        }

      } else if (gridMode === EGridMode.RULERS_EXTERNAL || gridMode === EGridMode.RULERS_EXTERNAL_WITH_SUBTLE_GRID || gridMode === EGridMode.OVERLAY_WITH_RULERS) {
        // External rulers mode - draw rulers outside image bounds

        // Use monospace font for better AI readability
        const font = `${rulerFontSize}px ${RULER_FONT_FAMILY}`;

        // Draw ruler backgrounds on all 4 sides
        ctx.fillStyle = RULER_BACKGROUND_COLOR;
        ctx.fillRect(0, 0, canvasWidth, rulerSize); // Top
        ctx.fillRect(0, 0, rulerSize, canvasHeight); // Left
        ctx.fillRect(0, canvasHeight - rulerSize, canvasWidth, rulerSize); // Bottom
        ctx.fillRect(canvasWidth - rulerSize, 0, rulerSize, canvasHeight); // Right

        // Draw ruler borders
        ctx.strokeStyle = RULER_BORDER_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(rulerSize, rulerSize, img.width, img.height); // Image border

        // Margin around corner dead zones — prevents tick labels from bleeding into badges
        const cornerMargin = 0;
        // Gap between ruler tick end and label text
        const labelTickGap = 4;

        // Draw top ruler (horizontal coordinates — labels show pixel coords)
        ctx.font = font;
        ctx.strokeStyle = RULER_TICK_COLOR;

        // Draw minor ticks first (smaller, no labels) — iterate in pixel space
        for (let px = 0; px <= img.width; px += MINOR_STEP_X) {
          const pixelX = rulerSize + px;
          if (pixelX < rulerSize + cornerMargin || pixelX > canvasWidth - rulerSize - cornerMargin) continue;

          // Skip positions where major ticks will be drawn
          if (px % PIXELS_STEP_X !== 0) {
            const isMiddleTick = (px % (PIXELS_STEP_X / 2) === 0);

            if (isMiddleTick) {
              ctx.lineWidth = TICK_LINE_WIDTH_MIDDLE;
              ctx.beginPath();
              ctx.moveTo(pixelX, rulerSize - scaledMiddleTickLength);
              ctx.lineTo(pixelX, rulerSize);
              ctx.stroke();
            } else {
              ctx.lineWidth = TICK_LINE_WIDTH_MINOR;
              ctx.beginPath();
              ctx.moveTo(pixelX, rulerSize - scaledMinorTickLength);
              ctx.lineTo(pixelX, rulerSize);
              ctx.stroke();
            }
          }
        }

        // Draw major ticks with labels — iterate in scaled space for exact round labels
        ctx.lineWidth = TICK_LINE_WIDTH_MAJOR;
        const topRulerMajorIter = aiCoordScale > 0
          ? Array.from({ length: Math.floor(aiCoordScale / scaledStepX) + 1 }, (_, i) => {
            const sv = i * scaledStepX;
            return { px: Math.round(sv / aiCoordScale * img.width), label: sv.toString() };
          })
          : Array.from({ length: Math.floor(img.width / PIXELS_STEP_X) + 1 }, (_, i) => {
            const px = i * PIXELS_STEP_X;
            return { px, label: px.toString() };
          });
        for (const { px, label } of topRulerMajorIter) {
          const pixelX = rulerSize + px;
          if (pixelX < rulerSize + cornerMargin || pixelX > canvasWidth - rulerSize - cornerMargin) continue;

          ctx.beginPath();
          ctx.moveTo(pixelX, rulerSize - scaledMajorTickLength);
          ctx.lineTo(pixelX, rulerSize);
          ctx.stroke();

          ctx.fillStyle = RULER_TEXT_COLOR;
          const labelWidth = ctx.measureText(label).width;
          ctx.fillText(label, pixelX - labelWidth / 2, rulerSize - 15);
        }

        // Draw left ruler (vertical coordinates)
        // Draw minor ticks first
        for (let py = 0; py <= img.height; py += MINOR_STEP_Y) {
          const pixelY = rulerSize + py;
          if (pixelY < rulerSize + cornerMargin || pixelY > canvasHeight - rulerSize - cornerMargin) continue;

          if (py % PIXELS_STEP_Y !== 0) {
            const isMiddleTick = (py % (PIXELS_STEP_Y / 2) === 0);

            if (isMiddleTick) {
              ctx.lineWidth = TICK_LINE_WIDTH_MIDDLE;
              ctx.beginPath();
              ctx.moveTo(rulerSize - scaledMiddleTickLength, pixelY);
              ctx.lineTo(rulerSize, pixelY);
              ctx.stroke();
            } else {
              ctx.lineWidth = TICK_LINE_WIDTH_MINOR;
              ctx.beginPath();
              ctx.moveTo(rulerSize - scaledMinorTickLength, pixelY);
              ctx.lineTo(rulerSize, pixelY);
              ctx.stroke();
            }
          }
        }

        // Draw major ticks with labels — iterate in scaled space for exact round labels
        ctx.lineWidth = TICK_LINE_WIDTH_MAJOR;
        const leftRulerMajorIter = aiCoordScale > 0
          ? Array.from({ length: Math.floor(aiCoordScale / scaledStepY) + 1 }, (_, i) => {
            const sv = i * scaledStepY;
            return { py: Math.round(sv / aiCoordScale * img.height), label: sv.toString() };
          })
          : Array.from({ length: Math.floor(img.height / PIXELS_STEP_Y) + 1 }, (_, i) => {
            const py = i * PIXELS_STEP_Y;
            return { py, label: py.toString() };
          });
        for (const { py, label } of leftRulerMajorIter) {
          const pixelY = rulerSize + py;
          if (pixelY < rulerSize + cornerMargin || pixelY > canvasHeight - rulerSize - cornerMargin) continue;

          ctx.beginPath();
          ctx.moveTo(rulerSize - scaledMajorTickLength, pixelY);
          ctx.lineTo(rulerSize, pixelY);
          ctx.stroke();

          ctx.fillStyle = RULER_TEXT_COLOR;
          const labelWidth = ctx.measureText(label).width;
          ctx.fillText(label, rulerSize - scaledMajorTickLength - labelTickGap - labelWidth, pixelY + rulerFontSize / 3);
        }

        // Draw bottom ruler (horizontal coordinates - same range as top)
        for (let px = 0; px <= img.width; px += MINOR_STEP_X) {
          const pixelX = rulerSize + px;
          if (pixelX < rulerSize + cornerMargin || pixelX > canvasWidth - rulerSize - cornerMargin) continue;

          if (px % PIXELS_STEP_X !== 0) {
            const isMiddleTick = (px % (PIXELS_STEP_X / 2) === 0);

            if (isMiddleTick) {
              ctx.lineWidth = TICK_LINE_WIDTH_MIDDLE;
              ctx.beginPath();
              ctx.moveTo(pixelX, canvasHeight - rulerSize);
              ctx.lineTo(pixelX, canvasHeight - rulerSize + scaledMiddleTickLength);
              ctx.stroke();
            } else {
              ctx.lineWidth = TICK_LINE_WIDTH_MINOR;
              ctx.beginPath();
              ctx.moveTo(pixelX, canvasHeight - rulerSize);
              ctx.lineTo(pixelX, canvasHeight - rulerSize + scaledMinorTickLength);
              ctx.stroke();
            }
          }
        }

        ctx.lineWidth = TICK_LINE_WIDTH_MAJOR;
        const bottomRulerMajorIter = aiCoordScale > 0
          ? Array.from({ length: Math.floor(aiCoordScale / scaledStepX) + 1 }, (_, i) => {
            const sv = i * scaledStepX;
            return { px: Math.round(sv / aiCoordScale * img.width), label: sv.toString() };
          })
          : Array.from({ length: Math.floor(img.width / PIXELS_STEP_X) + 1 }, (_, i) => {
            const px = i * PIXELS_STEP_X;
            return { px, label: px.toString() };
          });
        for (const { px, label } of bottomRulerMajorIter) {
          const pixelX = rulerSize + px;
          if (pixelX < rulerSize + cornerMargin || pixelX > canvasWidth - rulerSize - cornerMargin) continue;

          ctx.beginPath();
          ctx.moveTo(pixelX, canvasHeight - rulerSize);
          ctx.lineTo(pixelX, canvasHeight - rulerSize + scaledMajorTickLength);
          ctx.stroke();

          ctx.fillStyle = RULER_TEXT_COLOR;
          const labelWidth = ctx.measureText(label).width;
          ctx.fillText(label, pixelX - labelWidth / 2, canvasHeight - rulerSize + 25);
        }

        // Draw right ruler (vertical coordinates - same range as left)
        for (let py = 0; py <= img.height; py += MINOR_STEP_Y) {
          const pixelY = rulerSize + py;
          if (pixelY < rulerSize + cornerMargin || pixelY > canvasHeight - rulerSize - cornerMargin) continue;

          if (py % PIXELS_STEP_Y !== 0) {
            const isMiddleTick = (py % (PIXELS_STEP_Y / 2) === 0);

            if (isMiddleTick) {
              ctx.lineWidth = TICK_LINE_WIDTH_MIDDLE;
              ctx.beginPath();
              ctx.moveTo(canvasWidth - rulerSize, pixelY);
              ctx.lineTo(canvasWidth - rulerSize + scaledMiddleTickLength, pixelY);
              ctx.stroke();
            } else {
              ctx.lineWidth = TICK_LINE_WIDTH_MINOR;
              ctx.beginPath();
              ctx.moveTo(canvasWidth - rulerSize, pixelY);
              ctx.lineTo(canvasWidth - rulerSize + scaledMinorTickLength, pixelY);
              ctx.stroke();
            }
          }
        }

        ctx.lineWidth = TICK_LINE_WIDTH_MAJOR;
        const rightRulerMajorIter = aiCoordScale > 0
          ? Array.from({ length: Math.floor(aiCoordScale / scaledStepY) + 1 }, (_, i) => {
            const sv = i * scaledStepY;
            return { py: Math.round(sv / aiCoordScale * img.height), label: sv.toString() };
          })
          : Array.from({ length: Math.floor(img.height / PIXELS_STEP_Y) + 1 }, (_, i) => {
            const py = i * PIXELS_STEP_Y;
            return { py, label: py.toString() };
          });
        for (const { py, label } of rightRulerMajorIter) {
          const pixelY = rulerSize + py;
          if (pixelY < rulerSize + cornerMargin || pixelY > canvasHeight - rulerSize - cornerMargin) continue;

          ctx.beginPath();
          ctx.moveTo(canvasWidth - rulerSize, pixelY);
          ctx.lineTo(canvasWidth - rulerSize + scaledMajorTickLength, pixelY);
          ctx.stroke();

          ctx.fillStyle = RULER_TEXT_COLOR;
          ctx.fillText(label, canvasWidth - rulerSize + scaledMajorTickLength + labelTickGap, pixelY + rulerFontSize / 3);
        }

        // If subtle grid mode, add very faint grid lines
        if (gridMode === EGridMode.RULERS_EXTERNAL_WITH_SUBTLE_GRID) {
          ctx.strokeStyle = RULER_SUBTLE_GRID_COLOR;
          ctx.lineWidth = 0.5;

          // Vertical lines
          for (let px = PIXELS_STEP_X; px < img.width; px += PIXELS_STEP_X) {
            const canvasPx = rulerSize + px;
            ctx.beginPath();
            ctx.moveTo(canvasPx, rulerSize);
            ctx.lineTo(canvasPx, rulerSize + img.height);
            ctx.stroke();
          }

          // Horizontal lines
          for (let py = PIXELS_STEP_Y; py < img.height; py += PIXELS_STEP_Y) {
            const canvasPy = rulerSize + py;
            ctx.beginPath();
            ctx.moveTo(rulerSize, canvasPy);
            ctx.lineTo(rulerSize + img.width, canvasPy);
            ctx.stroke();
          }
        } else if (gridMode === EGridMode.OVERLAY_WITH_RULERS) {
          // OVERLAY_WITH_RULERS mode - external rulers + visible green grid (like OVERLAY)
          ctx.strokeStyle = VISUAL_GROUNDING_OPTIONS.border_color;
          ctx.lineWidth = 1;

          // Vertical grid lines (green, visible)
          for (let px = PIXELS_STEP_X; px < img.width; px += PIXELS_STEP_X) {
            const canvasPx = rulerSize + px;
            ctx.beginPath();
            ctx.moveTo(canvasPx, rulerSize);
            ctx.lineTo(canvasPx, rulerSize + img.height);
            ctx.stroke();
          }

          // Horizontal grid lines (green, visible)
          for (let py = PIXELS_STEP_Y; py < img.height; py += PIXELS_STEP_Y) {
            const canvasPy = rulerSize + py;
            ctx.beginPath();
            ctx.moveTo(rulerSize, canvasPy);
            ctx.lineTo(rulerSize + img.width, canvasPy);
            ctx.stroke();
          }
        }
      }
    }

    // ── Corner coordinate badges + PAGE N (drawn AFTER rulers to paint on top) ──
    if (gridMode === EGridMode.RULERS_EXTERNAL || gridMode === EGridMode.RULERS_EXTERNAL_WITH_SUBTLE_GRID || gridMode === EGridMode.OVERLAY_WITH_RULERS) {
      ctx.font = `bold ${rulerFontSize}px ${RULER_FONT_FAMILY}`;

      const badgePadX = 4;
      const badgePadY = 2;
      const badgeRadius = 3;

      const drawCornerBadge = (text: string, textX: number, textY: number) => {
        const tw = ctx.measureText(text).width;
        const bx = textX - badgePadX;
        const by = textY - rulerFontSize - badgePadY + 2;
        const bw = tw + badgePadX * 2;
        const bh = rulerFontSize + badgePadY * 2;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(bx, by, bw, bh, badgeRadius);
        } else {
          ctx.rect(bx, by, bw, bh);
        }
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, textX, textY);
      };

      // Top-left badge — right edge at grid border
      const tlText = `${cornerTopLeftX},${cornerTopLeftY}`;
      const tlWidth = ctx.measureText(tlText).width;
      drawCornerBadge(tlText, rulerSize - tlWidth - badgePadX, rulerSize - badgePadY - 2);

      // Top-right badge — left edge at grid border
      const trText = `${cornerBottomRightX},${cornerTopLeftY}`;
      drawCornerBadge(trText, canvasWidth - rulerSize + badgePadX, rulerSize - badgePadY - 2);

      // Bottom-left badge — right edge at grid border
      const blText = `${cornerTopLeftX},${cornerBottomRightY}`;
      const blWidth = ctx.measureText(blText).width;
      drawCornerBadge(blText, rulerSize - blWidth - badgePadX, canvasHeight - rulerSize + rulerFontSize + badgePadY - 2);

      // Bottom-right badge — left edge at grid border
      const brText = `${cornerBottomRightX},${cornerBottomRightY}`;
      drawCornerBadge(brText, canvasWidth - rulerSize + badgePadX, canvasHeight - rulerSize + rulerFontSize + badgePadY - 2);

      // [PN] overlay label on content area (replaces old PAGE N in ruler strips)
      const rulerConfig = getGridModeConfig(gridMode);
      drawPageLabelOverlay(ctx, pageNum, rulerConfig, img.width, img.height, rulerSize, rulerSize);
    }

    // Draw bounding boxes
    if (VISUAL_GROUNDING_OPTIONS.addBoundingBoxes && VISUAL_GROUNDING_OPTIONS.addBoundingBoxes.length > 0) {
      ctx.strokeStyle = VISUAL_GROUNDING_OPTIONS.border_color;
      ctx.lineWidth = VISUAL_GROUNDING_OPTIONS.borderWidth;
      ctx.fillStyle = VISUAL_GROUNDING_OPTIONS.border_color;
      ctx.font = `${VISUAL_GROUNDING_OPTIONS.fontSize}px Arial`;

      for (const box of VISUAL_GROUNDING_OPTIONS.addBoundingBoxes) {
        // Draw the box
        ctx.beginPath();
        ctx.rect(box.x, box.y, box.width, box.height);
        ctx.stroke();

        // Add label if provided
        if (box.label) {
          ctx.fillText(box.label, (box.x * page_dimensions.scaling_factor), (box.y * page_dimensions.scaling_factor) - 5);
        }
      }
    }

    // Add [PN] overlay label for overlay mode (ruler mode labels drawn in post-ruler section)
    if (gridConfig.pageLabel.enabled && !gridConfig.rulers.enabled) {
      drawPageLabelOverlay(ctx, pageNum, gridConfig, img.width, img.height);
    }

    // Return the canvas as a JPEG buffer for smaller payload to AI
    return new Uint8Array(await canvas.toBuffer('image/jpeg', { quality: 0.85 }));

  } catch (error) {
    console.debug('errors', `addVisualGroundingToImage: adding visual grounding to image: ${error}`);
    // Return the original image if there's an error
    return pngBuffer;
  }
}

/**
   * Check if an image has visible content (not all blank/background).
   * Delegates to detectContentBoxes which uses grid-based color analysis:
   * - Samples actual background color from the page (no hardcoded white threshold)
   * - Cuts image into grid cells and checks per-cell deviation from background
   * - Catches sparse pages (signature pages, footers) that uniform pixel sampling misses
   *
   * Uses lenient thresholds — false positives (keeping a truly blank page) are cheap,
   * but false negatives (compressing real content to 1x1) cause AI inspection failures.
   */
export async function checkImageHasContent(imageData: string): Promise<boolean> {
  const imageBuffer = Buffer.from(imageData, 'base64');
  const { contentBoundingBox } = await detectContentBoxes(imageBuffer, {
    gridCellSize: 50,
    contentThresholdPercent: 5,
    colorDiffThreshold: 20,
  });
  return contentBoundingBox !== null;
}

/**
 * Crops white margins from an image buffer while preserving content
 * Uses sharp's trim() to detect content bounds automatically
 * Samples background color from offset position (5,5) to avoid borders
 * @param imageBuffer - PNG image buffer
 * @param padding - Pixels of padding to keep around content (default: 10)
 * @returns Cropped image buffer, or original if no significant margins to crop
 */
export async function cropWhiteMargins(
  imageBuffer: Buffer,
  padding: number = 10,
  contentRect?: { left: number; top: number; right: number; bottom: number }
): Promise<Buffer> {
  try {
    // Get original image metadata
    const metadata = await sharp(imageBuffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    console.log('cropWhiteMargins: starting', { originalWidth, originalHeight, contentRect });

    if (originalWidth === 0 || originalHeight === 0) {
      console.log('cropWhiteMargins: Image has zero dimensions, returning original');
      return imageBuffer;
    }

    const { data: rawData, info: rawInfo } = await sharp(imageBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = rawInfo.channels;

    // Per-side background detection + inward scanning
    const sideTrim = scanPerSideMargins(rawData, rawInfo.width, rawInfo.height, channels);
    console.log('cropWhiteMargins: per-side trim', sideTrim);

    const trimmedWidth = originalWidth - sideTrim.left - sideTrim.right;
    const trimmedHeight = originalHeight - sideTrim.top - sideTrim.bottom;

    // If the trim resulted in very small dimensions, the image might be all-white
    if (trimmedWidth < 10 || trimmedHeight < 10) {
      console.log('cropWhiteMargins: Trimmed image too small, likely all-white page, returning original');
      return imageBuffer;
    }

    // Calculate how much was trimmed
    const widthReduction = originalWidth - trimmedWidth;
    const heightReduction = originalHeight - trimmedHeight;

    // Only crop if significant margin exists (e.g., > 2% of dimension)
    const minReduction = Math.min(originalWidth, originalHeight) * 0.02;

    if (widthReduction < minReduction && heightReduction < minReduction && !contentRect) {
      console.log('cropWhiteMargins: Margins too small to crop', { widthReduction, heightReduction, minReduction });
      return imageBuffer; // Not enough margin to warrant cropping
    }

    // Compute the crop rect from per-side trim amounts
    let cropLeft = sideTrim.left;
    let cropTop = sideTrim.top;
    let cropRight = originalWidth - sideTrim.right;
    let cropBottom = originalHeight - sideTrim.bottom;

    // Expand crop rect to include protected content area (highlights/labels)
    if (contentRect) {
      cropLeft = Math.min(cropLeft, contentRect.left);
      cropTop = Math.min(cropTop, contentRect.top);
      cropRight = Math.max(cropRight, contentRect.right);
      cropBottom = Math.max(cropBottom, contentRect.bottom);
    }

    // Clamp to image bounds
    cropLeft = Math.max(0, cropLeft);
    cropTop = Math.max(0, cropTop);
    cropRight = Math.min(originalWidth, cropRight);
    cropBottom = Math.min(originalHeight, cropBottom);

    const extractWidth = Math.max(1, cropRight - cropLeft);
    const extractHeight = Math.max(1, cropBottom - cropTop);

    // Safety: never crop more than 50% of any dimension
    // (presentation slides in letter-sized PDF pages can have 30%+ white margins)
    const maxCropFraction = 0.50;
    if (extractWidth < originalWidth * (1 - maxCropFraction) || extractHeight < originalHeight * (1 - maxCropFraction)) {
      console.log('cropWhiteMargins: crop too aggressive, skipping', {
        original: `${originalWidth}x${originalHeight}`,
        wouldCropTo: `${extractWidth}x${extractHeight}`,
        maxCropFraction,
      });
      return imageBuffer;
    }

    console.log('cropWhiteMargins: Cropping margins', {
      original: `${originalWidth}x${originalHeight}`,
      trimmed: `${trimmedWidth}x${trimmedHeight}`,
      extract: `${extractWidth}x${extractHeight} at (${cropLeft},${cropTop})`,
      reduction: `${widthReduction}x${heightReduction}`,
      contentRect,
    });

    // Extract the computed crop region and add padding
    const croppedBuffer = await sharp(imageBuffer)
      .extract({ left: Math.round(cropLeft), top: Math.round(cropTop), width: Math.round(extractWidth), height: Math.round(extractHeight) })
      .toBuffer();

    const result = await sharp(croppedBuffer)
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .png()
      .toBuffer();

    console.log('cropWhiteMargins: Result with padding', {
      paddedWidth: Math.round(extractWidth) + padding * 2,
      paddedHeight: Math.round(extractHeight) + padding * 2,
    });

    return result;
  } catch (error) {
    console.error('cropWhiteMargins ERROR:', error);
    return imageBuffer;
  }
}

/**
 * Crops margins from an image buffer and returns the crop offsets.
 * Uses per-side background detection to find margin color independently
 * for each edge, then applies a balanced symmetric crop per axis.
 * @param imageBuffer - Image buffer (PNG or JPEG)
 * @param padding - Pixels of padding to keep around content (default: proportional 1% of smallest dimension, min 10)
 * @returns Object with cropped buffer and pixel offsets, or original if no significant margins
 */
export async function cropWhiteMarginsWithOffsets(
  imageBuffer: Buffer,
  padding?: number
): Promise<{ buffer: Buffer; offsetLeft: number; offsetTop: number }> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    if (originalWidth === 0 || originalHeight === 0) {
      return { buffer: imageBuffer, offsetLeft: 0, offsetTop: 0 };
    }

    // Proportional padding: 1% of smallest dimension, minimum 10px
    const effectivePadding = padding ?? Math.max(10, Math.round(Math.min(originalWidth, originalHeight) * 0.01));

    const { data: rawData, info: rawInfo } = await sharp(imageBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = rawInfo.channels;

    // Per-side background detection + inward scanning
    const sideTrim = scanPerSideMargins(rawData, rawInfo.width, rawInfo.height, channels);

    const trimmedWidth = originalWidth - sideTrim.left - sideTrim.right;
    const trimmedHeight = originalHeight - sideTrim.top - sideTrim.bottom;

    if (trimmedWidth < 10 || trimmedHeight < 10) {
      return { buffer: imageBuffer, offsetLeft: 0, offsetTop: 0 };
    }

    const widthReduction = originalWidth - trimmedWidth;
    const heightReduction = originalHeight - trimmedHeight;
    const minReduction = Math.min(originalWidth, originalHeight) * 0.02;

    if (widthReduction < minReduction && heightReduction < minReduction) {
      return { buffer: imageBuffer, offsetLeft: 0, offsetTop: 0 };
    }

    // Balance crop per axis: use the smaller trim amount on each axis
    const balancedCropX = Math.min(sideTrim.left, sideTrim.right);
    const balancedCropY = Math.min(sideTrim.top, sideTrim.bottom);

    const cropLeft = balancedCropX;
    const cropTop = balancedCropY;
    const extractWidth = originalWidth - balancedCropX * 2;
    const extractHeight = originalHeight - balancedCropY * 2;

    console.log('cropWhiteMarginsWithOffsets: Per-side balanced cropping', {
      original: `${originalWidth}x${originalHeight}`,
      sideTrim,
      balanced: { cropX: balancedCropX, cropY: balancedCropY },
      extract: `${extractWidth}x${extractHeight}`,
      padding: effectivePadding
    });

    // Use sharp.extract() for precise symmetric cropping (avoids non-determinism of running trim twice)
    const croppedBuffer = await sharp(imageBuffer)
      .extract({
        left: cropLeft,
        top: cropTop,
        width: extractWidth,
        height: extractHeight,
      })
      .toBuffer();

    const paddedResult = await sharp(croppedBuffer)
      .extend({
        top: effectivePadding,
        bottom: effectivePadding,
        left: effectivePadding,
        right: effectivePadding,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .jpeg({ quality: RENDERED_PAGES_JPEG_QUALITY })
      .toBuffer();

    return {
      buffer: paddedResult,
      offsetLeft: Math.max(0, cropLeft - effectivePadding),
      offsetTop: Math.max(0, cropTop - effectivePadding),
    };
  } catch (error) {
    console.error('cropWhiteMarginsWithOffsets ERROR:', error);
    return { buffer: imageBuffer, offsetLeft: 0, offsetTop: 0 };
  }
}

// Re-export from dedicated content detection module
export { detectContentBoxes, type ContentDetectionResult } from './content-detection';

/**
 * Draws debug visualization of content boxes and bounding box on a page image.
 * Used by dev-mode image dumps to visually verify content detection.
 *
 * - Content boxes: cyan dashed rectangles
 * - Content bounding box: red solid rectangle (thicker)
 *
 * Coordinates in `contentBoxes` / `contentBoundingBox` are in 72dpi PDF doc space
 * (stored as `round(orig_pixel / scaling_factor_at_detection_time)` by
 * ai-utils.ts:92 and :164). To map them back to image pixels we need the scaling
 * factor that was in effect when `pageAsImage` was rendered — NOT the value
 * currently sitting on `page.scaling_factor`, because ai-utils.ts:208 mutates
 * `scaling_factor` during the post-crop AI-image downscale, while `pageAsImage`
 * still holds the original uncropped undownscaled render.
 *
 * We derive the correct scale from the loaded image itself via
 * `img.width / originalWidth`. That always equals the raw render scaling
 * factor, regardless of what's been done to `page.scaling_factor` since.
 * X and Y are computed independently as a safety net against non-uniform
 * scaling (in practice PDF pages render uniformly so they match).
 */
export async function drawDebugBoxes(
  imageBuffer: Buffer,
  contentBoxes: IContentBox[],
  contentBoundingBox: IContentBox | null,
  originalWidth: number,
  originalHeight: number,
): Promise<Buffer> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (err) => reject(err);
    img.src = imageBuffer;
  });

  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  // Effective scale = rendered image pixels / PDF viewport units.
  // This recovers the raw scaling factor even if page.scaling_factor has been
  // mutated by downstream AI-image downscaling in ai-utils.ts:208.
  const effectiveSfX = originalWidth > 0 ? img.width / originalWidth : 1;
  const effectiveSfY = originalHeight > 0 ? img.height / originalHeight : 1;
  const toPixelX = (docX: number) => docX * effectiveSfX;
  const toPixelY = (docY: number) => docY * effectiveSfY;

  // Draw content boxes (cyan, dashed)
  ctx.strokeStyle = 'rgba(0, 200, 220, 0.8)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  for (const box of contentBoxes) {
    const x = toPixelX(box.x1);
    const y = toPixelY(box.y1);
    const w = toPixelX(box.x2) - x;
    const h = toPixelY(box.y2) - y;
    ctx.strokeRect(x, y, w, h);
  }

  // Draw content bounding box (red, solid, thicker)
  if (contentBoundingBox) {
    ctx.strokeStyle = 'rgba(255, 40, 40, 0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    const x = toPixelX(contentBoundingBox.x1);
    const y = toPixelY(contentBoundingBox.y1);
    const w = toPixelX(contentBoundingBox.x2) - x;
    const h = toPixelY(contentBoundingBox.y2) - y;
    ctx.strokeRect(x, y, w, h);

    // Label
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'rgba(255, 40, 40, 0.9)';
    ctx.fillText('content_bounding_box', x + 4, y - 4 > 12 ? y - 4 : y + 14);
  }

  // Label content boxes count
  ctx.font = '11px sans-serif';
  ctx.fillStyle = 'rgba(0, 200, 220, 0.9)';
  ctx.fillText(`${contentBoxes.length} content_boxes`, 4, img.height - 6);

  return canvas.toBuffer('image/png');
}

/**
 * Creates highlighted images with rule numbers overlaid for HTML reports.
 *
 * ⚠️  DO NOT DELETE — this function is still used for server-side page preview
 * rendering (e.g. envelope view thumbnails, inspection-time overlays). The HTML
 * report export pipeline has moved to SVG-based rendering via
 * createSvgPagesForExport() in svg-export-utils.ts, but this canvas-based
 * version is kept for cases where rasterised PNG output is needed.
 *
 * @param pages Array of base64 images (one per page)
 * @param inspectionReport The inspection report containing check results
 * @param max_width Maximum width for the output images (default: 600px)
 * @param show_hints Whether to show hint text below highlights (default: false)
 * @param crop_margins Whether to crop white margins from images after drawing highlights (default: false)
 * @returns Array of base64 images with highlights and rule numbers
 */
export async function createImagesWithHighlights(
  pages: IPageInfoExtended[],
  inspectionReport: IReport,
  check_filter: 'failed' | 'passed' | 'all' | 'changes' | 'rechecks' | 'failed_only',
  exclude_pages_without_highlights: boolean,
  max_width: number = 800,
  show_hints: boolean = false,
  show_source_badge: boolean = false,
  crop_margins: boolean = false,
  message_box_mode: MessageBoxMode = 'none',
  skip_annotations: boolean = false,
  font_scale_override: number = 1.0,
  font_family_override?: LabelFontFamily,
  highlight_mode_override?: number,
  align_labels_to_top: boolean = false
): Promise<string[]> {
  const highlightedImages: string[] = [];
  const sessionId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.debug('createImagesWithHighlights', `check_filter: ${check_filter}, exclude_pages_without_highlights: ${exclude_pages_without_highlights}, max_width: ${max_width}, crop_margins: ${crop_margins}`);
  console.debug('[image-utils] START', {
    sessionId,
    timestamp: new Date().toISOString(),
    max_width,
    labelFontScale: inspectionReport.label_font_scale,
    pageCount: pages.length,
    firstPageOrigSize: pages[0] ? `${pages[0].original_width}x${pages[0].original_height}` : 'none',
    message_box_mode,
    show_hints,
  });

  try {
    // collect all checks that we need to process based on filter
    const allChecks: ICheck[] = [];
    for (const check of inspectionReport.checks) {
      switch (check_filter) {
        case 'all':
          allChecks.push(check);
          break;
        case 'passed':
          if (check.passed) allChecks.push(check);
          break;
        case 'changes':
          if (check.rule_id === REVDOKU_CATCH_CHANGES_RULE_ID) allChecks.push(check);
          break;
        case 'rechecks':
          if (check.description?.startsWith('#recheck ')) allChecks.push(check);
          break;
        case 'failed_only':
          if (!check.passed && check.rule_id !== REVDOKU_CATCH_CHANGES_RULE_ID) allChecks.push(check);
          break;
        case 'failed':
        default:
          if (!check.passed) allChecks.push(check);
          break;
      }
    }

    console.debug('createImagesWithHighlights', `report.checks.length: ${inspectionReport.checks.length}, allChecks.length: ${allChecks.length}`);

    // process each page
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {

      try {
        let pageImage = null;
        let shouldProcessPage = true;

        if (exclude_pages_without_highlights) {
          // check if page has any highlights?
          shouldProcessPage = allChecks.some(check =>
            check.page === pageIndex
          );
          console.debug('createImagesWithHighlights', `pageIndex: ${pageIndex}, shouldProcessPage: ${shouldProcessPage}`);
          if (!shouldProcessPage) {
            // No highlights on this page, just resize and return
            // so pushing just empty string
            const checkCount = inspectionReport.checks.filter(check => check?.page === pageIndex).length;
            console.debug('createImagesWithHighlights', `pageIndex: ${pageIndex} (checkCount: ${checkCount}) excluded because exclude_pages_without_highlights: ${exclude_pages_without_highlights}, pushing empty string`);
            highlightedImages.push('');
            continue;
          }
        }

        // finally process page that we should process
        try {
          pageImage = new Uint8Array(Buffer.from(pages[pageIndex].pageAsImage, 'base64'));
        } catch (error) {
          console.debug('createImagesWithHighlights', `Error creating highlighted report images: ${error}`);
          // rethrow the error to be handled by the error handler
          throw new Error(`Error creating highlighted report images: ${error}`);
        }

        // if this page should not be processed, it will contain "null". Otherwise base64 data
        if (!pageImage) {
          console.debug('createImagesWithHighlights', `pageIndex: ${pageIndex}, pageImage: ${pageImage}`);
          continue;
        }

        try {
          // Get all highlights for this page
          const pageHighlights = allChecks.filter(check => check.page === pageIndex);

          console.debug('createImagesWithHighlights', `pageIndex: ${pageIndex}, pageHighlights: ${pageHighlights.length} checks`);

          // premature exit if we don't have highlights or annotations are skipped
          if (skip_annotations || pageHighlights.length === 0) {
            // No highlights on this page, just resize and return
            let resizedImage = await resizeImageToMaxWidth(pageImage, max_width);
            // Crop margins if enabled — use content bounding box if available
            if (crop_margins) {
              const noHlPageInfo = pages[pageIndex] as IPageInfoExtended;
              if (noHlPageInfo?.content_bounding_box) {
                const bbox = noHlPageInfo.content_bounding_box;
                const noHlSf = noHlPageInfo.scaling_factor || 1;
                const noHlMeta = await sharp(Buffer.from(resizedImage)).metadata();
                const noHlImgW = noHlMeta.width || 1;
                const noHlImgH = noHlMeta.height || 1;
                // Map bbox from document space to resized image space
                const noHlScale = noHlImgW / noHlPageInfo.original_width;
                const bboxLeft = bbox.x1 * noHlScale;
                const bboxTop = bbox.y1 * noHlScale;
                const bboxRight = bbox.x2 * noHlScale;
                const bboxBottom = bbox.y2 * noHlScale;
                const trimPad = 10;
                const trimX = Math.max(0, Math.floor(bboxLeft) - trimPad);
                const trimY = Math.max(0, Math.floor(bboxTop) - trimPad);
                const trimW = Math.min(noHlImgW, Math.ceil(bboxRight) + trimPad) - trimX;
                const trimH = Math.min(noHlImgH, Math.ceil(bboxBottom) + trimPad) - trimY;
                if (trimW > 0 && trimH > 0 && (trimW < noHlImgW - 2 || trimH < noHlImgH - 2)) {
                  resizedImage = new Uint8Array(await sharp(Buffer.from(resizedImage))
                    .extract({ left: trimX, top: trimY, width: trimW, height: trimH })
                    .png().toBuffer());
                }
              } else {
                // Legacy fallback — pixel scan
                resizedImage = new Uint8Array(await cropWhiteMargins(Buffer.from(resizedImage)));
              }
            }
            // saving resized image as base64
            highlightedImages.push(Buffer.from(resizedImage).toString('base64'));
            continue;
          }

          // Create canvas from page image
          const img = new Image();
          // create a promise to ensure the image is loaded
          await new Promise<void>((resolve, reject) => {
            // we need to use the onload event to ensure the image is loaded
            // otherwise the canvas will be empty
            img.onload = () => resolve();
            img.onerror = (err) => reject(err);
            img.src = Buffer.from(pageImage);
          });

          // Calculate scaling factor for max width
          console.debug('createImagesWithHighlights', `pageIndex: ${pageIndex}, original img dimensions: ${img.width}x${img.height}, max_width: ${max_width}`);
          const scaleFactor = img.width > max_width ? max_width / img.width : 1;
          const newWidth = Math.floor(img.width * scaleFactor);
          const newHeight = Math.floor(img.height * scaleFactor);
          console.debug('createImagesWithHighlights', `pageIndex: ${pageIndex}, scaleFactor: ${scaleFactor}, newWidth: ${newWidth}, newHeight: ${newHeight}`);

          // Apply original rendering scaling factor from page dimensions
          const pageScale = pages[pageIndex]?.scaling_factor || 1;
          const pageInfo = pages[pageIndex] as IPageInfoExtended;

          // Check if checks have pre-computed description_position data
          const allPageChecks = inspectionReport.checks.filter(
            c => c.page === pageIndex &&
              c.x1 != null && c.y1 != null && c.x2 != null && c.y2 != null
          );
          const hasPrecomputed = allPageChecks.some(c => c.description_position);

          // Derive scale from page dimensions (available from source pages)
          const origWidth = pages[pageIndex]?.original_width || 1;
          const origHeight = pages[pageIndex]?.original_height || 1;
          const cropOffX = pageInfo?.crop_offset_x || 0;
          const cropOffY = pageInfo?.crop_offset_y || 0;
          const sf = pageInfo?.scaling_factor || 1;
          const canvasScale = newWidth / img.width;  // uniform scale: cropped image → canvas

          // Crop-aware coordinate mapping: original-doc position → canvas pixel position
          const mapX = (ox: number) => docToContentPixel(ox, cropOffX, sf) * canvasScale;
          const mapY = (oy: number) => docToContentPixel(oy, cropOffY, sf) * canvasScale;
          // Scale factor for sizes (widths/heights in original-doc units)
          const sizeScale = sf * canvasScale;
          // For label fonts/padding: scale with canvas size only (not sf).
          // Labels are overlaid annotations — their size should be proportional to
          // the rendered canvas, not mapped through document coordinate space.
          // sf shrinks fonts on high-res source images (e.g. 1700px JPEG → sf=0.35
          // → effectiveFont=12*0.35*0.67=2.8px). canvasScale alone keeps them readable.
          const fontSizeScale = canvasScale;

          // psx kept for diagnostic logging (matches frontend's full-page-based pageScaleX)
          const psx = newWidth / origWidth;

          // User font scale (A-/A+ control) — per-page with global fallback
          // Clamp to 3.0 to prevent Cairo "too big" canvas/surface errors
          const userFontScale = Math.min(3.0, (inspectionReport.page_font_scales?.[String(pageIndex)] ?? inspectionReport.label_font_scale ?? 1.0) * font_scale_override);
          // Resolve label font family: export override takes priority, then report's saved value
          const labelFontFamily = getFontFamilyCss((font_family_override || inspectionReport.font_family) as LabelFontFamily | undefined, 'canvas');
          console.log('[EXPORT] createImagesWithHighlights', `pageIndex: ${pageIndex}, userFontScale: ${userFontScale}, fontFamily: ${labelFontFamily}, page_font_scales: ${JSON.stringify(inspectionReport.page_font_scales)}, label_font_scale raw: ${inspectionReport.label_font_scale}`);

          // Margin zone width scales with user font preference so labels have room
          // Compact mode: use pill-sized margin since badges don't need 200px
          const isCompactMode = message_box_mode === 'numbers_message_box_only';
          // Compact mode: circle badge dimensions via calculateLabelBadgeSpec
          const compactBadgeFontSize = isCompactMode ? Math.max(14, newHeight * 0.07) * userFontScale : 0;
          const compactBadgeSpec = isCompactMode ? calculateLabelBadgeSpec(compactBadgeFontSize) : null;
          // Scale margin more aggressively than font: base * fontScale^1.5
          // This gives wider labels at larger font sizes (more chars per line)
          // Cap at 40% of page width to avoid overwhelming the document image
          const scaledMargin = Math.round(REVDOKU_ANNOTATION_MARGIN * Math.pow(userFontScale, REVDOKU_ANNOTATION_MARGIN_SCALE_EXPONENT));
          const maxMarginWidth = Math.round(newWidth * 0.4);
          const effectiveMarginWidth = isCompactMode
            ? 0  // No margin needed — badges placed at highlight corners
            : Math.min(scaledMargin, maxMarginWidth);

          // Compact badge dimensions (circle diameter)
          const compactPillW = isCompactMode ? Math.ceil(compactBadgeSpec!.radius * 2) : 0;
          const compactPillH = isCompactMode ? Math.ceil(compactBadgeSpec!.radius * 2) : 0;
          console.debug(`[image-utils] page ${pageIndex} scale`, {
            sessionId,
            origSize: `${origWidth}x${origHeight}`,
            newSize: `${newWidth}x${newHeight}`,
            cropOffset: `${cropOffX},${cropOffY}`,
            sf, canvasScale: canvasScale.toFixed(4),
            sizeScale: sizeScale.toFixed(4),
            psx: psx.toFixed(4),
            userFontScale,
            effectiveMarginWidth,
            REVDOKU_MARGIN_LABEL_FONT_SIZE,
          });

          let labelPlacements: HintPlacementResultExtended[] = [];

          // Safety timeout for label placement + rendering per page
          const pageStartMs = Date.now();
          const PAGE_TIMEOUT_MS = 30_000; // 30 seconds per page max

          if (show_hints && isCompactMode) {
            // Compact mode: place badges at highlight corners, only avoiding badge-badge collisions
            const renderedIds = new Set(pageHighlights.map(c => c.id));
            const checksToPlace = allPageChecks.filter(c => renderedIds.has(c.id));

            const compactHighlights = checksToPlace.map(c => {
              const coords = c as ICoordinates;
              return {
                id: c.id,
                x: mapX(coords.x1),
                y: mapY(coords.y1),
                width: getWidth(coords) * sizeScale,
                height: getHeight(coords) * sizeScale,
              };
            });

            const badgePlacements = placeCompactBadges(
              compactHighlights, compactBadgeSpec!.radius,
              newWidth, newHeight,
            );

            labelPlacements = badgePlacements.map(bp => ({
              id: bp.id,
              side: PlacementSide.INSIDE,
              labelBox: {
                x: bp.cx - compactBadgeSpec!.radius,
                y: bp.cy - compactBadgeSpec!.radius,
                width: compactPillW,
                height: compactPillH,
              },
              arrowPath: [],
              leader: undefined,
              _touchesHighlight: bp.touchesHighlight,
            } as HintPlacementResultExtended));
          } else if (show_hints && hasPrecomputed) {
            // Full mode with precomputed positions
            // Dual-zone scaling: page zone uses crop-aware mapping, margin zone uses fixed offset
            const scaleX_fn = (x: number) => {
              if (x <= origWidth) return mapX(x);
              return newWidth + (x - origWidth);
            };

            // Document-space metrics (shared with frontend), then scale to canvas
            const docMetrics_ = computeLabelMetrics(0, userFontScale);
            const pcFontSize = docMetrics_.fontSize * sizeScale;
            const pcPadding = docMetrics_.padding * sizeScale;
            console.debug(`[image-utils] page ${pageIndex} precomputed fonts`, {
              sessionId,
              psx: psx.toFixed(4),
              sizeScale: sizeScale.toFixed(4),
              pcFontSize: pcFontSize.toFixed(2),
              pcPadding: pcPadding.toFixed(2),
            });

            const renderedIds = new Set(pageHighlights.map(c => c.id));
            labelPlacements = allPageChecks
              .filter(c => renderedIds.has(c.id) && c.description_position)
              .map(c => {
                const coords = c as ICoordinates;
                const scaledHighlight = {
                  x: mapX(coords.x1),
                  y: mapY(coords.y1),
                  width: getWidth(coords) * sizeScale,
                  height: getHeight(coords) * sizeScale,
                };

                // Full mode: scale precomputed label positions
                const mp = c.description_position!;
                const docMetrics = computeLabelMetrics(mp.box.width, userFontScale);
                const labelWidth = docMetrics.labelWidth * sizeScale;
                const scaledLabelBox = {
                  x: scaleX_fn(mp.box.x),
                  y: mapY(mp.box.y),
                  width: labelWidth,
                  height: mp.box.height * sizeScale,
                };

                // Re-estimate box height using unified font metrics
                const reEstimated = estimateWrappedLabelDimensions(
                  formatCheckDescription(c.description, c.rule_id, c.data),
                  scaledLabelBox.width,
                  pcFontSize,
                  REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
                  pcPadding,
                  REVDOKU_LAYOUT_LABEL_MAX_LINES,
                  inspectionReport.font_family as LabelFontFamily | undefined,
                );
                scaledLabelBox.height = reEstimated.height;
                // Coordinate-based detection: label's right edge past page width means
                // it's in the margin (RIGHT side); otherwise INSIDE.
                const isMarginLbl = (mp.box.x + mp.box.width) > origWidth;
                return {
                  id: c.id,
                  side: isMarginLbl ? PlacementSide.RIGHT : PlacementSide.INSIDE,
                  labelBox: scaledLabelBox,
                  arrowPath: [],
                  leader: undefined,
                } as HintPlacementResultExtended;
              });

            // Fallback: compute placements for checks without pre-computed positions
            const checksWithoutPositions = allPageChecks.filter(c => renderedIds.has(c.id) && !c.description_position);
            if (checksWithoutPositions.length > 0) {
              const fallbackInputs: HintPlacementInput[] = checksWithoutPositions.map(check => {
                const coords: ICoordinates = check as ICoordinates;
                return {
                  id: check.id,
                  x: mapX(coords.x1),
                  y: mapY(coords.y1),
                  width: getWidth(coords) * sizeScale,
                  height: getHeight(coords) * sizeScale,
                  description: formatCheckDescription(check.description, check.rule_id, check.data),
                  ruleOrder: check.rule_order ?? 0,
                };
              });
              const contentBoxes: IContentBox[] = (pageInfo?.content_boxes || []).map(cb => ({
                x1: mapX(cb.x1),
                y1: mapY(cb.y1),
                x2: mapX(cb.x2),
                y2: mapY(cb.y2),
              }));
              // Include pre-computed label positions as content boxes so the
              // fallback placer avoids them, preventing mixed-source overlaps.
              const precomputedBoxes: IContentBox[] = labelPlacements.map(lp => ({
                x1: lp.labelBox.x,
                y1: lp.labelBox.y,
                x2: lp.labelBox.x + lp.labelBox.width,
                y2: lp.labelBox.y + lp.labelBox.height,
              }));
              const allContentBoxes = [...contentBoxes, ...precomputedBoxes];
              const fallbackPlacements = placeCheckLabels(fallbackInputs, newWidth, newHeight, {
                contentBoxes: allContentBoxes,
                marginWidth: effectiveMarginWidth,
                labelFontScale: userFontScale * sizeScale,
                compactMode: isCompactMode,
                compactFontScale: userFontScale,
                fontFamily: inspectionReport.font_family as LabelFontFamily | undefined,
              });
              labelPlacements = [...labelPlacements, ...fallbackPlacements];
            }
          } else if (show_hints) {
            // No pre-computed data — full client-side computation (old reports)
            const contentBoxes: IContentBox[] = (pageInfo?.content_boxes || []).map(cb => ({
              x1: mapX(cb.x1),
              y1: mapY(cb.y1),
              x2: mapX(cb.x2),
              y2: mapY(cb.y2),
            }));

            const allHintInputs: HintPlacementInput[] = allPageChecks.map(check => {
              const coords: ICoordinates = check as ICoordinates;
              return {
                id: check.id,
                x: mapX(coords.x1),
                y: mapY(coords.y1),
                width: getWidth(coords) * sizeScale,
                height: getHeight(coords) * sizeScale,
                description: formatCheckDescription(check.description, check.rule_id, check.data),
                ruleOrder: check.rule_order ?? 0,
              };
            });

            const placementOptions: PlaceCheckLabelsOptions = {
              contentBoxes,
              marginWidth: effectiveMarginWidth,
              labelFontScale: userFontScale * sizeScale,
              compactMode: isCompactMode,
              compactFontScale: userFontScale,
              fontFamily: inspectionReport.font_family as LabelFontFamily | undefined,
            };

            const allPlacements = allHintInputs.length > 0
              ? placeCheckLabels(allHintInputs, newWidth, newHeight, placementOptions) : [];

            const renderedIds = new Set(pageHighlights.map(c => c.id));
            labelPlacements = allPlacements.filter(p => renderedIds.has(p.id));
          }

          // Post-process margin labels and leaders — skip for compact mode
          // (compact badges are placed at highlight corners with no margin or leaders)
          if (!isCompactMode) {
            // Post-process margin labels using shared function (same code as frontend).
            // Pre-set widths and heights before calling shared sort + align + stack.
            const scaledGap = REVDOKU_MARGIN_LABEL_VERTICAL_GAP * fontSizeScale;
            const labelX = newWidth + REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING * fontSizeScale;
            const maxLabelWidth = effectiveMarginWidth - REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING * 2 * fontSizeScale;
            {
              const marginLabels = labelPlacements.filter(lp => lp.side !== PlacementSide.INSIDE);
              for (const lp of marginLabels) {
                const check = pageHighlights.find(h => h.id === lp.id);
                const description = formatCheckDescription(check?.description, check?.rule_id, check?.data);
                const estDims = estimateWrappedLabelDimensions(
                  description, maxLabelWidth, computeLabelMetrics(0, userFontScale).fontSize * fontSizeScale,
                  REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
                  computeLabelMetrics(0, userFontScale).padding * fontSizeScale,
                  undefined,
                  inspectionReport.font_family as LabelFontFamily | undefined,
                );
                lp.labelBox.width = maxLabelWidth;
                lp.labelBox.height = estDims.height;
              }
            }
            // Use the same autoRepositionLabels pipeline as the frontend envelope view
            const dm = computeLabelMetrics(0, userFontScale);
            const effectiveFontSizeForRepos = dm.fontSize * fontSizeScale;
            const effectiveLineHeightForRepos = REVDOKU_MARGIN_LABEL_LINE_HEIGHT;
            const effectivePaddingForRepos = dm.padding * fontSizeScale;
            const viewerWidth = newWidth + 2 * effectiveMarginWidth;
            const effectiveRepositionSteps = align_labels_to_top
              ? REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS.filter(s => s !== AutoRepositionStep.STEP_SPREAD_CLOSE_TO_HIGHLIGHTS)
              : REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS;
            autoRepositionLabels(labelPlacements, {
              page_width: newWidth,
              page_height: newHeight,
              gap: scaledGap,
              steps: effectiveRepositionSteps,
              constraint_ctx: {
                viewer_width: viewerWidth,
                viewer_height: newHeight,
                page_width: newWidth,
                page_height: newHeight,
                text_line_height: effectiveLineHeightForRepos,
              },
              resize_label: (id: string, targetWidth: number) => {
                const check = pageHighlights.find(h => h.id === id);
                if (!check) return { width: targetWidth, height: 30 };
                const description = formatCheckDescription(check?.description, check?.rule_id, check?.data);
                return estimateWrappedLabelDimensions(
                  description, targetWidth,
                  effectiveFontSizeForRepos, effectiveLineHeightForRepos,
                  effectivePaddingForRepos, REVDOKU_LAYOUT_LABEL_MAX_LINES,
                  inspectionReport.font_family as LabelFontFamily | undefined,
                );
              },
              get_passed: (id: string) => {
                const check = pageHighlights.find(h => h.id === id);
                if (!check) return undefined;
                return check.passed;
              },
              get_highlight_center_y: (id: string) => {
                const check = pageHighlights.find(h => h.id === id);
                if (!check) return null;
                const coords = check as ICoordinates;
                return mapY(coords.y1) + (getHeight(coords) * sizeScale) / 2;
              },
              get_highlight_rect: (id: string) => {
                const check = pageHighlights.find(h => h.id === id);
                if (!check) return null;
                const coords = check as ICoordinates;
                return {
                  x: mapX(coords.x1),
                  y: mapY(coords.y1),
                  width: getWidth(coords) * sizeScale,
                  height: getHeight(coords) * sizeScale,
                };
              },
              get_check_types: (id: string) => {
                const check = pageHighlights.find(h => h.id === id);
                if (!check) return new Set();
                return getCheckTypes(check);
              },
              check_filter: check_filter as CheckFilterType,
            });
            console.debug(`[image-utils] page ${pageIndex} autoRepositionLabels completed, gap=${scaledGap.toFixed(1)}`);

            // Compute straight connection lines for each label
            for (const lp of labelPlacements) {
              const check = pageHighlights.find(h => h.id === lp.id);
              if (!check) continue;
              const coords = check as ICoordinates;
              const highlightBox = {
                x: mapX(coords.x1), y: mapY(coords.y1),
                width: getWidth(coords) * sizeScale, height: getHeight(coords) * sizeScale,
              };
              const { start, end } = computeStraightConnectionLine(lp.labelBox, highlightBox, lp.side);
              const hmConfig = getHighlightModeConfig(highlight_mode_override);
              const effectiveEnd = getConnectionLineEndpoint(hmConfig.connectionMode, highlightBox, lp.labelBox) ?? end;
              lp.arrowPath = [start, effectiveEnd];
            }
          }

          // Check if label placement exceeded per-page timeout
          if (Date.now() - pageStartMs > PAGE_TIMEOUT_MS) {
            console.warn(`[image-utils] page ${pageIndex} label placement exceeded ${PAGE_TIMEOUT_MS}ms timeout, skipping label rendering`);
            labelPlacements = [];
          }

          // Extend canvas on all 4 sides to accommodate elements that overflow the page image
          let minTop = 0;
          let minLeft = 0;
          let maxBottom = newHeight;
          let maxRight = newWidth;

          // Content protection bounds: track only highlights + labels (NOT full page)
          let contentMinTop = 0;
          let contentMinLeft = 0;
          let contentMaxBottom = 0;
          let contentMaxRight = 0;
          let hasContent = false;

          // Account for highlights extending beyond page bounds
          for (const check of pageHighlights) {
            const coords = check as ICoordinates;
            const hy = mapY(coords.y1);
            const hx = mapX(coords.x1);
            const hw = getWidth(coords) * sizeScale;
            const hh = getHeight(coords) * sizeScale;
            if (hy < minTop) minTop = hy;
            if (hx < minLeft) minLeft = hx;
            if (hy + hh > maxBottom) maxBottom = hy + hh;
            if (hx + hw > maxRight) maxRight = hx + hw;

            // Update content protection bounds
            if (!hasContent) {
              contentMinTop = hy;
              contentMinLeft = hx;
              contentMaxBottom = hy + hh;
              contentMaxRight = hx + hw;
              hasContent = true;
            } else {
              if (hy < contentMinTop) contentMinTop = hy;
              if (hx < contentMinLeft) contentMinLeft = hx;
              if (hy + hh > contentMaxBottom) contentMaxBottom = hy + hh;
              if (hx + hw > contentMaxRight) contentMaxRight = hx + hw;
            }
          }

          // Account for labels and their badges
          for (const lp of labelPlacements) {
            if (message_box_mode === 'numbers_message_box_only') {
              // Compact mode: only a small pill badge is drawn at the label origin.
              // Use pill-sized estimates instead of full labelBox (which is sized for
              // full-mode text labels and creates excess whitespace).
              const compactFontSize = Math.max(14, newHeight * 0.07) * userFontScale;
              const pillEstW = compactFontSize * 2.0;
              const pillEstH = compactFontSize * 1.5;
              const lx = lp.labelBox.x;
              const ly = lp.labelBox.y;
              if (ly < minTop) minTop = ly;
              if (lx < minLeft) minLeft = lx;
              if (ly + pillEstH > maxBottom) maxBottom = ly + pillEstH;
              if (lx + pillEstW > maxRight) maxRight = lx + pillEstW;

              // Update content protection bounds (skip margin — tracked after rendering)
              if (lp.side === PlacementSide.INSIDE) {
                if (!hasContent) {
                  contentMinTop = ly;
                  contentMinLeft = lx;
                  contentMaxBottom = ly + pillEstH;
                  contentMaxRight = lx + pillEstW;
                  hasContent = true;
                } else {
                  if (ly < contentMinTop) contentMinTop = ly;
                  if (lx < contentMinLeft) contentMinLeft = lx;
                  if (ly + pillEstH > contentMaxBottom) contentMaxBottom = ly + pillEstH;
                  if (lx + pillEstW > contentMaxRight) contentMaxRight = lx + pillEstW;
                }
              }
            } else {
              const labelTop = lp.labelBox.y;
              if (labelTop < minTop) minTop = labelTop;
              if (lp.labelBox.x < minLeft) minLeft = lp.labelBox.x;
              const labelBottom = lp.labelBox.y + lp.labelBox.height;
              if (labelBottom > maxBottom) maxBottom = labelBottom;
              const labelRight = lp.labelBox.x + lp.labelBox.width;
              if (labelRight > maxRight) maxRight = labelRight;

              // Update content protection bounds (skip margin — tracked after rendering)
              if (lp.side === PlacementSide.INSIDE) {
                if (!hasContent) {
                  contentMinTop = labelTop;
                  contentMinLeft = lp.labelBox.x;
                  contentMaxBottom = labelBottom;
                  contentMaxRight = labelRight;
                  hasContent = true;
                } else {
                  if (labelTop < contentMinTop) contentMinTop = labelTop;
                  if (lp.labelBox.x < contentMinLeft) contentMinLeft = lp.labelBox.x;
                  if (labelBottom > contentMaxBottom) contentMaxBottom = labelBottom;
                  if (labelRight > contentMaxRight) contentMaxRight = labelRight;
                }
              }
            }
          }

          // Compute offsets and canvas dimensions
          const offsetX = minLeft < 0 ? Math.ceil(-minLeft) + 5 : 0;
          const offsetY = minTop < 0 ? Math.ceil(-minTop) + 5 : 0;
          // Cairo has a max surface size (~32767px per side). Cap to 16384 to stay safe
          // and avoid "invalid value (too big)" errors with large font scales.
          const MAX_CANVAS_DIM = 16384;
          const rawCanvasW = Math.ceil(maxRight) + offsetX + 10;
          // Extra buffer for bottom labels: text measurement at render time can exceed
          // placement estimates, causing bottom-most labels to be clipped.
          const labelHeightBuffer = Math.ceil(REVDOKU_MARGIN_LABEL_FONT_SIZE * userFontScale * REVDOKU_MARGIN_LABEL_LINE_HEIGHT * 3);
          const rawCanvasH = Math.ceil(maxBottom) + offsetY + Math.max(10, labelHeightBuffer);
          const canvasWidth = Math.min(MAX_CANVAS_DIM, rawCanvasW);
          const canvasHeight = Math.min(MAX_CANVAS_DIM, rawCanvasH);
          if (rawCanvasW > MAX_CANVAS_DIM || rawCanvasH > MAX_CANVAS_DIM) {
            console.warn(`[image-utils] page ${pageIndex} canvas capped: raw ${rawCanvasW}x${rawCanvasH} → ${canvasWidth}x${canvasHeight} (fontScale=${userFontScale})`);
          }

          const canvas = createCanvas(canvasWidth, canvasHeight);
          const ctx = canvas.getContext('2d');

          // Fill entire background white if canvas extends beyond page image
          if (canvasHeight > newHeight + offsetY || canvasWidth > newWidth + offsetX || offsetX > 0 || offsetY > 0) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
          }

          // Draw the resized image (shifted by offset)
          ctx.drawImage(img, offsetX, offsetY, newWidth, newHeight);

          // Draw highlights with rule numbers
          for (const check of pageHighlights) {

            const coords: ICoordinates = check as ICoordinates;
            const ruleOrder = check.rule_order;
            const rulePrompt = check.rule_prompt;

            // Scale coordinates: map original document coords to canvas pixels (crop-aware + offset)
            const x = mapX(coords.x1) + offsetX;
            const y = mapY(coords.y1) + offsetY;
            const width = getWidth(coords) * sizeScale;
            const height = getHeight(coords) * sizeScale;


            // Use appropriate opacity based on image size for better visibility
            const minOpacityForImage = getMinOpacityForImageSize(newWidth, newHeight);
            const checkColors = getColorsForCheckResult(check, minOpacityForImage);

            // Draw highlight using shared utility (supports rectangle, dot, underline, bracket modes)
            drawHighlightBorder(ctx, check, x, y, width, height, minOpacityForImage, highlight_mode_override as HighlightMode | undefined);

            // Only draw source badge if enabled (disabled by default for report exports)
            if (show_source_badge) {
              // Calculate source badge position using shared utility
              const isManualCheck = check.source === CheckSource.USER;
              const sourceBadgeMetrics = calculateSourceBadgePosition(x, y, width);
              const iconBadgeX = sourceBadgeMetrics.x;
              const iconBadgeY = sourceBadgeMetrics.y;
              const iconBadgeSize = sourceBadgeMetrics.size;

              // Draw white circle background with colored border
              ctx.save();
              ctx.globalAlpha = 0.85; // Semi-transparent badge

              // Badge background (using shared constant)
              ctx.fillStyle = REVDOKU_BADGE_BACKGROUND_COLOR;
              ctx.beginPath();
              ctx.arc(iconBadgeX, iconBadgeY, iconBadgeSize / 2, 0, 2 * Math.PI);
              ctx.fill();

              // Colored border matching the highlight color
              ctx.strokeStyle = checkColors.border_color;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(iconBadgeX, iconBadgeY, iconBadgeSize / 2, 0, 2 * Math.PI);
              ctx.stroke();

              // Draw the icon inside
              ctx.fillStyle = checkColors.border_color;
              ctx.strokeStyle = checkColors.border_color;
              ctx.lineWidth = 1.5;

              if (isManualCheck) {
                // Draw simple user icon (person silhouette)
                const iconScale = iconBadgeSize / 24;
                ctx.save();
                ctx.translate(iconBadgeX, iconBadgeY);
                ctx.scale(iconScale, iconScale);

                // Head (circle)
                ctx.beginPath();
                ctx.arc(0, -3, 3, 0, 2 * Math.PI);
                ctx.fill();

                // Body (shoulders)
                ctx.beginPath();
                ctx.moveTo(-5, 6);
                ctx.quadraticCurveTo(-5, 2, -3, 2);
                ctx.quadraticCurveTo(-3, 0, 0, 0);
                ctx.quadraticCurveTo(3, 0, 3, 2);
                ctx.quadraticCurveTo(5, 2, 5, 6);
                ctx.closePath();
                ctx.fill();

                ctx.restore();
              } else {
                // Draw sparkles icon (3 stars)
                const iconScale = iconBadgeSize / 24;
                ctx.save();
                ctx.translate(iconBadgeX, iconBadgeY);
                ctx.scale(iconScale, iconScale);

                // Draw 3 sparkles/stars
                const drawSparkle = (cx: number, cy: number, size: number) => {
                  ctx.beginPath();
                  // Draw a 4-pointed star
                  ctx.moveTo(cx, cy - size);
                  ctx.lineTo(cx + size * 0.3, cy - size * 0.3);
                  ctx.lineTo(cx + size, cy);
                  ctx.lineTo(cx + size * 0.3, cy + size * 0.3);
                  ctx.lineTo(cx, cy + size);
                  ctx.lineTo(cx - size * 0.3, cy + size * 0.3);
                  ctx.lineTo(cx - size, cy);
                  ctx.lineTo(cx - size * 0.3, cy - size * 0.3);
                  ctx.closePath();
                  ctx.fill();
                };

                drawSparkle(-3, -3, 3);
                drawSparkle(3, 2, 2.5);
                drawSparkle(-2, 4, 2);

                ctx.restore();
              }

              ctx.restore();
            }

          }

          // Draw annotation labels and arrows (using pre-computed placements with content box avoidance)
          if (show_hints && labelPlacements.length > 0) {
            if (message_box_mode === 'numbers_message_box_only') {
              // NUMBER-ONLY MODE: badges at highlight corners, no leader lines needed
              for (const placement of labelPlacements) {
                const check = pageHighlights.find(c => c.id === placement.id);
                if (!check) continue;
                const minOpacityForImage = getMinOpacityForImageSize(newWidth, newHeight);
                const colors = getColorsForCheckResult(check, minOpacityForImage);

                const labelX = placement.labelBox.x + offsetX;
                const labelY = placement.labelBox.y + offsetY;

                const badgeNumber = check.check_index ?? ((check.rule_order ?? 0) + 1);
                const numberFontSize = Math.max(14, newHeight * 0.07) * userFontScale;
                const badgeSpec = calculateLabelBadgeSpec(numberFontSize);
                const badgeCenterX = labelX + badgeSpec.radius;
                const badgeCenterY = labelY + badgeSpec.radius;

                // No leader lines — badges are at highlight corners
                drawLabelBadge(ctx as any, String(badgeNumber), badgeCenterX, badgeCenterY, badgeSpec, colors.border_color, labelFontFamily);
              }
            } else {
              // FULL MODE: document-space metrics (shared with frontend), then scale to canvas.
              // EXPORT_LABEL_FONT_BOOST compensates for canvas downscaling: the frontend
              // renders labels at document-space size (CSS transform handles zoom), but
              // revdoku-doc-api applies canvasScale to font size, making labels appear smaller.
              const EXPORT_LABEL_FONT_BOOST = 1.5;
              const dm = computeLabelMetrics(0, userFontScale);
              const effectiveFontSize = dm.fontSize * fontSizeScale * EXPORT_LABEL_FONT_BOOST;
              const effectiveLineHeight = dm.lineHeight * fontSizeScale * EXPORT_LABEL_FONT_BOOST;
              const effectivePadding = dm.padding * fontSizeScale * EXPORT_LABEL_FONT_BOOST;
              console.debug(`[image-utils] page ${pageIndex} full-mode fonts`, {
                sessionId,
                psx: psx.toFixed(4),
                effectiveFontSize: effectiveFontSize.toFixed(2),
                effectivePadding: effectivePadding.toFixed(2),
                userFontScale,
              });

              // Separate inline and margin labels for independent rendering.
              // Sort margin labels by Y position so rendering follows the priority
              // order computed by autoRepositionLabels (failed first, then changes, then passed).
              const inlineLabels = labelPlacements.filter(lp => lp.side === PlacementSide.INSIDE);
              const marginLabelsForRender = labelPlacements
                .filter(lp => lp.side !== PlacementSide.INSIDE)
                .sort((a, b) => a.labelBox.y - b.labelBox.y);
              console.debug(`[image-utils] rendering: ${inlineLabels.length} inline, ${marginLabelsForRender.length} margin labels`);

              // Helper: measure text wrapping and draw a label with keynote badge inside
              const measureAndDrawLabel = (
                check: typeof pageHighlights[0],
                labelX: number, labelY: number,
                labelWidth: number,
                bgWidth: number, // width for background fill (tightWidth for inline, full width for margin)
                labelSide: PlacementSide = PlacementSide.RIGHT,
              ) => {
                const minOpacityForImage = getMinOpacityForImageSize(newWidth, newHeight);
                const colors = getColorsForCheckResult(check, minOpacityForImage);
                const isLeftSide = labelSide === PlacementSide.LEFT;

                ctx.save();
                ctx.globalAlpha = 1.0;
                ctx.font = `${effectiveFontSize}px ${labelFontFamily}`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                const labelMaxWidth = labelWidth - effectivePadding * 2;
                const labelMaxLines = REVDOKU_LAYOUT_LABEL_MAX_LINES;

                // Badge dimensions
                const badgeNumber = check.check_index ?? ((check.rule_order ?? 0) + 1);
                const badgeSpec = calculateLabelBadgeSpec(effectiveFontSize);
                const badgeDiameter = badgeSpec.radius * 2;

                // Check icon (recheck ↻ / changes ⇄) — drawn as vector
                const iconType = getCheckIconType(check.description, check.rule_id);
                const iconSize = iconType ? effectiveFontSize * REVDOKU_CHECK_ICON_SIZE_SCALE : 0;
                const iconGap = iconType ? REVDOKU_CHECK_ICON_GAP : 0;

                // Change type badges (e.g. "number", "removed", "date")
                const isRecheck = check.description?.startsWith('#recheck ');
                const typeLabels = getCheckDataTypeLabels(check)
                  .filter(l => isRecheck ? l !== 'recheck' : true);
                const typeBadgeFontSize = effectiveFontSize * REVDOKU_TYPE_BADGE_FONT_SCALE;
                // Measure total width of type badges
                ctx.font = `${REVDOKU_TYPE_BADGE_FONT_WEIGHT} ${typeBadgeFontSize}px ${labelFontFamily}`;
                let typeBadgesTotalWidth = 0;
                const typeBadgeWidths: number[] = [];
                for (const label of typeLabels) {
                  const w = ctx.measureText(label).width + REVDOKU_TYPE_BADGE_PADDING_H * 2 + 2; // +2 for border
                  typeBadgeWidths.push(w);
                  typeBadgesTotalWidth += w + REVDOKU_TYPE_BADGE_GAP;
                }
                ctx.font = `${effectiveFontSize}px ${labelFontFamily}`;

                // First-line indent depends on label side:
                // LEFT:  [icon] [type badges] text... [badge]  (badge on right)
                // RIGHT: [badge] [icon] [type badges] text...  (badge on left)
                const leftIndent = isLeftSide
                  ? iconSize + iconGap + typeBadgesTotalWidth
                  : badgeDiameter + REVDOKU_LABEL_BADGE_GAP + iconSize + iconGap + typeBadgesTotalWidth;
                const rightIndent = isLeftSide ? badgeDiameter + REVDOKU_LABEL_BADGE_GAP : 0;
                const textIndentFirstLine = leftIndent + rightIndent;

                // Wrap lines on right-side labels must also clear the badge
                const wrapLineIndent = isLeftSide ? 0 : badgeDiameter + REVDOKU_LABEL_BADGE_GAP;

                // Measure text wrapping (first line has reduced width due to badge + icon + type badges)
                const words = formatCheckDescription(check.description, check.rule_id, check.data).split(' ');
                let measureLine = '';
                let measureLineCount = 0;
                let maxLinePixelWidth = 0;
                for (let i = 0; i < words.length && measureLineCount < labelMaxLines; i++) {
                  const currentMaxWidth = measureLineCount === 0
                    ? labelMaxWidth - textIndentFirstLine
                    : labelMaxWidth - wrapLineIndent;
                  const testLine = measureLine + (measureLine ? ' ' : '') + words[i];
                  const metrics = ctx.measureText(testLine);
                  if (metrics.width > currentMaxWidth && measureLine) {
                    const measuredWidth = ctx.measureText(measureLine).width;
                    const effectiveWidth = measureLineCount === 0 ? measuredWidth + textIndentFirstLine : measuredWidth + wrapLineIndent;
                    maxLinePixelWidth = Math.max(maxLinePixelWidth, effectiveWidth);
                    measureLine = words[i];
                    measureLineCount++;
                  } else {
                    measureLine = testLine;
                  }
                }
                if (measureLine) {
                  const measuredWidth = ctx.measureText(measureLine).width;
                  const effectiveWidth = measureLineCount === 0 ? measuredWidth + textIndentFirstLine : measuredWidth + wrapLineIndent;
                  maxLinePixelWidth = Math.max(maxLinePixelWidth, effectiveWidth);
                  measureLineCount++;
                }
                const actualBoxHeight = measureLineCount * effectiveLineHeight + effectivePadding * 2;
                const tightHeight = Math.max(20, actualBoxHeight);
                const actualBoxWidth = maxLinePixelWidth + effectivePadding * 2;
                // LEFT labels: always use full labelWidth so badge/border stay consistent
                // with the text wrapping (which uses labelWidth). Shrinking tightWidth
                // shifts the badge left into the text area.
                const tightWidth = isLeftSide
                  ? labelWidth
                  : Math.max(50, Math.min(labelWidth, actualBoxWidth));
                const drawBgWidth = bgWidth > 0 ? bgWidth : tightWidth;

                // For LEFT labels, right-align so the right border aligns with the
                // placement box's right edge (where the leader line connects).
                const bgDrawX = isLeftSide ? labelX + labelWidth - drawBgWidth : labelX;
                const borderDrawX = isLeftSide ? labelX + labelWidth - tightWidth : labelX;

                // Background — fully opaque white
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.roundRect(bgDrawX, labelY, drawBgWidth, tightHeight, 3);
                ctx.fill();

                // Border (full rect or leader-edge only, controlled by REVDOKU_LABEL_DRAW_FULL_RECTANGLE)
                drawLabelBorder(ctx as any, borderDrawX, labelY, tightWidth, tightHeight, colors.border_color, 1.5, labelSide);

                const badgeCenterY = labelY + effectivePadding + effectiveLineHeight / 2;

                // Badge position: LEFT labels → right side, RIGHT labels → left side
                const badgeCenterX = isLeftSide
                  ? borderDrawX + tightWidth - effectivePadding - badgeSpec.radius
                  : borderDrawX + effectivePadding + badgeSpec.radius;
                drawLabelBadge(ctx as any, String(badgeNumber), badgeCenterX, badgeCenterY, badgeSpec, colors.border_color, labelFontFamily);

                // Icon + type badges: positioned on the non-badge side
                // LEFT:  starts from left edge (borderDrawX + padding)
                // RIGHT: starts after badge (badgeCenterX + radius + gap)
                let elemX = isLeftSide
                  ? borderDrawX + effectivePadding
                  : badgeCenterX + badgeSpec.radius + REVDOKU_LABEL_BADGE_GAP;

                // Draw recheck/changes icon (vector-drawn, no font dependency)
                if (iconType) {
                  const iconCenterX = elemX + iconSize / 2;
                  const iconColor = iconType === 'recheck' ? colors.border_color : REVDOKU_ICON_COLOR_CHANGES;
                  const drawIcon = iconType === 'recheck' ? drawRecheckIcon : drawChangesIcon;
                  drawIcon(ctx as any, iconCenterX, badgeCenterY, iconSize, iconColor);
                  elemX += iconSize + iconGap;
                }

                // Draw change type badges (small rounded rectangles: "number", "date", etc.)
                if (typeLabels.length > 0) {
                  const isRecheckStyle = !!isRecheck;
                  const badgeBorderColor = isRecheckStyle ? REVDOKU_TYPE_BADGE_RECHECK_BORDER : REVDOKU_TYPE_BADGE_CHANGES_BORDER;
                  const badgeBgColor = isRecheckStyle ? REVDOKU_TYPE_BADGE_RECHECK_BG : REVDOKU_TYPE_BADGE_CHANGES_BG;
                  const badgeTextColor = isRecheckStyle ? REVDOKU_TYPE_BADGE_RECHECK_TEXT : REVDOKU_TYPE_BADGE_CHANGES_TEXT;
                  const typeBadgeH = typeBadgeFontSize * REVDOKU_TYPE_BADGE_HEIGHT_SCALE;
                  const typeBadgeCenterY = badgeCenterY - typeBadgeH / 2;

                  for (let ti = 0; ti < typeLabels.length; ti++) {
                    const tw = typeBadgeWidths[ti];
                    // Background
                    ctx.fillStyle = badgeBgColor;
                    ctx.beginPath();
                    ctx.roundRect(elemX, typeBadgeCenterY, tw, typeBadgeH, REVDOKU_TYPE_BADGE_BORDER_RADIUS);
                    ctx.fill();
                    // Border
                    ctx.strokeStyle = badgeBorderColor;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.roundRect(elemX, typeBadgeCenterY, tw, typeBadgeH, REVDOKU_TYPE_BADGE_BORDER_RADIUS);
                    ctx.stroke();
                    // Text
                    ctx.fillStyle = badgeTextColor;
                    ctx.font = `${REVDOKU_TYPE_BADGE_FONT_WEIGHT} ${typeBadgeFontSize}px ${labelFontFamily}`;
                    ctx.fillText(typeLabels[ti], elemX + REVDOKU_TYPE_BADGE_PADDING_H + 1, typeBadgeCenterY + (typeBadgeH - typeBadgeFontSize) / 2);
                    elemX += tw + REVDOKU_TYPE_BADGE_GAP;
                  }
                  ctx.font = `${effectiveFontSize}px ${labelFontFamily}`;
                }

                // Text (first line indented to clear badge + icon + type badges)
                const baseAlpha = 1.0;
                ctx.globalAlpha = baseAlpha;
                ctx.fillStyle = colors.hint_text_color || colors.border_color;
                ctx.font = `${effectiveFontSize}px ${labelFontFamily}`;
                const useJustify = REVDOKU_DEFAULT_LABEL_TEXT_ALIGNMENT === 'justify';
                const valFontSize = effectiveFontSize * REVDOKU_VAL_DISPLAY_FONT_SCALE;
                {
                  const textXFirst = borderDrawX + effectivePadding + leftIndent;
                  const textXRest = borderDrawX + effectivePadding + wrapLineIndent;
                  const drawWords = formatCheckDescription(check.description, check.rule_id, check.data).split(' ');
                  // Find where val=... starts so we can draw it with reduced opacity + smaller font
                  const valStartIndex = drawWords.findIndex(w => w.startsWith('val='));
                  let lineWords: string[] = [];
                  let line = '';
                  let y = labelY + effectivePadding;
                  let lineCount = 0;
                  let wordIndex = 0;

                  /** Draw a single completed line, applying reduced opacity + smaller font for val words */
                  const drawLineWithValStyle = (words: string[], lx: number, ly: number, maxW: number, justify: boolean, globalWordOffset: number) => {
                    if (valStartIndex < 0 || globalWordOffset + words.length <= valStartIndex) {
                      // No val words in this line — draw normally
                      if (justify && words.length > 1) {
                        const totalWordW = words.reduce((s, w) => s + ctx.measureText(w).width, 0);
                        const spacePerGap = (maxW - totalWordW) / (words.length - 1);
                        let cx = lx;
                        for (const w of words) { ctx.fillText(w, cx, ly); cx += ctx.measureText(w).width + spacePerGap; }
                      } else {
                        ctx.fillText(words.join(' '), lx, ly);
                      }
                      return;
                    }
                    // Line contains val words — split drawing at the boundary
                    const splitAt = Math.max(0, valStartIndex - globalWordOffset);
                    const normalWords = words.slice(0, splitAt);
                    const valWords = words.slice(splitAt);
                    let cx = lx;
                    // Draw normal words
                    if (normalWords.length > 0) {
                      const normalText = normalWords.join(' ') + ' ';
                      ctx.globalAlpha = baseAlpha;
                      ctx.fillText(normalText, cx, ly);
                      cx += ctx.measureText(normalText).width;
                    }
                    // Draw val words with reduced opacity and smaller font
                    ctx.globalAlpha = REVDOKU_VAL_DISPLAY_OPACITY;
                    ctx.font = `${valFontSize}px ${labelFontFamily}`;
                    ctx.fillText(valWords.join(' '), cx, ly);
                    ctx.font = `${effectiveFontSize}px ${labelFontFamily}`;
                    ctx.globalAlpha = baseAlpha;
                  };

                  let lineStartWordIndex = 0;
                  for (wordIndex = 0; wordIndex < drawWords.length && lineCount < labelMaxLines; wordIndex++) {
                    const currentMaxWidth = lineCount === 0
                      ? labelMaxWidth - textIndentFirstLine
                      : labelMaxWidth - wrapLineIndent;
                    const testLine = line + (line ? ' ' : '') + drawWords[wordIndex];
                    const metrics = ctx.measureText(testLine);
                    if (metrics.width > currentMaxWidth && line) {
                      // Wrapped line
                      const lx = lineCount === 0 ? textXFirst : textXRest;
                      drawLineWithValStyle(lineWords, lx, y, currentMaxWidth, useJustify, lineStartWordIndex);
                      lineStartWordIndex = wordIndex;
                      line = drawWords[wordIndex];
                      lineWords = [drawWords[wordIndex]];
                      y += effectiveLineHeight;
                      lineCount++;
                    } else {
                      line = testLine;
                      lineWords.push(drawWords[wordIndex]);
                    }
                  }
                  // Last line — always left-aligned (standard justify behavior)
                  if (line && lineCount < labelMaxLines) {
                    const wasTruncated = wordIndex < drawWords.length;
                    if (wasTruncated) {
                      const currentMaxWidth = lineCount === 0
                        ? labelMaxWidth - textIndentFirstLine
                        : labelMaxWidth - wrapLineIndent;
                      const charWidth = effectiveFontSize * 0.6;
                      const maxChars = Math.floor(currentMaxWidth / charWidth);
                      line = line.substring(0, Math.max(1, maxChars - 3)) + '...';
                      ctx.fillText(line, lineCount === 0 ? textXFirst : textXRest, y);
                    } else {
                      const lx = lineCount === 0 ? textXFirst : textXRest;
                      drawLineWithValStyle(lineWords, lx, y, labelMaxWidth, false, lineStartWordIndex);
                    }
                  }
                }

                ctx.restore(); // outer save/restore (ensures globalAlpha=1.0 scope)
                return tightHeight;
              };

              // Pre-compute tight (actual) label dimensions for inline labels.
              // The placement algorithm estimates labelBox dimensions from character-width
              // approximation, but measureAndDrawLabel computes tighter bounds from actual
              // text measurement. We need these tight dims for accurate leader snapping.
              const inlineTightDims = new Map<string, { width: number; height: number }>();
              for (const placement of inlineLabels) {
                const check = pageHighlights.find(c => c.id === placement.id);
                if (!check?.description) continue;
                ctx.save();
                ctx.font = `${effectiveFontSize}px ${labelFontFamily}`;
                const labelMaxW = placement.labelBox.width - effectivePadding * 2;
                const badgeSpec = calculateLabelBadgeSpec(effectiveFontSize);
                const icoType = getCheckIconType(check.description, check.rule_id);
                const icoSize = icoType ? effectiveFontSize * REVDOKU_CHECK_ICON_SIZE_SCALE : 0;
                const icoGap = icoType ? REVDOKU_CHECK_ICON_GAP : 0;
                // Account for type badges width
                const inlIsRecheck = check.description?.startsWith('#recheck ');
                const inlTypeLabels = getCheckDataTypeLabels(check).filter(l => inlIsRecheck ? l !== 'recheck' : true);
                const inlTypeBadgeFontSize = effectiveFontSize * REVDOKU_TYPE_BADGE_FONT_SCALE;
                ctx.font = `${REVDOKU_TYPE_BADGE_FONT_WEIGHT} ${inlTypeBadgeFontSize}px ${labelFontFamily}`;
                let inlTypeBadgesW = 0;
                for (const label of inlTypeLabels) {
                  inlTypeBadgesW += ctx.measureText(label).width + REVDOKU_TYPE_BADGE_PADDING_H * 2 + 2 + REVDOKU_TYPE_BADGE_GAP;
                }
                ctx.font = `${effectiveFontSize}px ${labelFontFamily}`;
                // Inline labels always have badge on left (PlacementSide.INSIDE)
                const textIndent = badgeSpec.radius * 2 + REVDOKU_LABEL_BADGE_GAP + icoSize + icoGap + inlTypeBadgesW;
                const inlWrapIndent = badgeSpec.radius * 2 + REVDOKU_LABEL_BADGE_GAP;
                const words = formatCheckDescription(check.description, check.rule_id, check.data).split(' ');
                let line = '';
                let lineCount = 0;
                let maxLineW = 0;
                for (let i = 0; i < words.length && lineCount < REVDOKU_LAYOUT_LABEL_MAX_LINES; i++) {
                  const maxW = lineCount === 0 ? labelMaxW - textIndent : labelMaxW - inlWrapIndent;
                  const test = line + (line ? ' ' : '') + words[i];
                  if (ctx.measureText(test).width > maxW && line) {
                    const mw = ctx.measureText(line).width;
                    maxLineW = Math.max(maxLineW, lineCount === 0 ? mw + textIndent : mw + inlWrapIndent);
                    line = words[i];
                    lineCount++;
                  } else {
                    line = test;
                  }
                }
                if (line) {
                  const mw = ctx.measureText(line).width;
                  maxLineW = Math.max(maxLineW, lineCount === 0 ? mw + textIndent : mw + inlWrapIndent);
                  lineCount++;
                }
                const tH = Math.max(20, lineCount * effectiveLineHeight + effectivePadding * 2);
                const tW = Math.max(50, Math.min(placement.labelBox.width, maxLineW + effectivePadding * 2));
                inlineTightDims.set(placement.id, { width: tW, height: tH });
                ctx.restore();
              }

              // Pass 1: Draw inline leader lines (margin leaders drawn in Pass 3)
              for (const placement of inlineLabels) {
                const check = pageHighlights.find(c => c.id === placement.id);
                if (!check?.description) continue;

                const minOpacityForImage = getMinOpacityForImageSize(newWidth, newHeight);
                const colors = getColorsForCheckResult(check, minOpacityForImage);
                const tight = inlineTightDims.get(placement.id) || { width: placement.labelBox.width, height: placement.labelBox.height };
                const labelBox = { x: placement.labelBox.x + offsetX, y: placement.labelBox.y + offsetY, width: tight.width, height: tight.height };
                const coords = check as unknown as ICoordinates;
                const highlightBox = { x: mapX(coords.x1) + offsetX, y: mapY(coords.y1) + offsetY, width: getWidth(coords) * sizeScale, height: getHeight(coords) * sizeScale };
                const { start, end } = computeStraightConnectionLine(labelBox, highlightBox, placement.side);
                const hmCfg = getHighlightModeConfig(highlight_mode_override);
                const effectiveEnd = getConnectionLineEndpoint(hmCfg.connectionMode, highlightBox, labelBox) ?? end;

                const ldx = effectiveEnd.x - start.x;
                const ldy = effectiveEnd.y - start.y;
                const leaderLen = Math.sqrt(ldx * ldx + ldy * ldy);
                if (leaderLen < 5) continue;

                ctx.save();
                ctx.strokeStyle = colors.border_color;
                ctx.lineWidth = REVDOKU_LEADER_LINE_WIDTH_V2;
                ctx.globalAlpha = REVDOKU_LEADER_OPACITY;
                ctx.setLineDash(REVDOKU_LEADER_DASH_PATTERN);
                ctx.beginPath();
                ctx.moveTo(start.x, start.y);
                ctx.lineTo(effectiveEnd.x, effectiveEnd.y);
                ctx.stroke();
                ctx.setLineDash([]);
                // Endpoint circle at highlight end
                if (REVDOKU_LEADER_ENDPOINT_STYLE === 'circle') {
                  ctx.beginPath();
                  ctx.arc(effectiveEnd.x, effectiveEnd.y, REVDOKU_LEADER_CIRCLE_RADIUS, 0, Math.PI * 2);
                  ctx.fillStyle = colors.border_color;
                  ctx.fill();
                } else if (REVDOKU_LEADER_ENDPOINT_STYLE === 'arrow') {
                  const arrowAngle = Math.atan2(effectiveEnd.y - start.y, effectiveEnd.x - start.x);
                  const arrowSize = Math.max(REVDOKU_LEADER_ARROW_MIN, Math.min(REVDOKU_LEADER_ARROW_MAX, leaderLen * REVDOKU_LEADER_ARROW_RATIO));
                  ctx.lineWidth = Math.max(2, REVDOKU_LEADER_LINE_WIDTH_V2 + 0.5);
                  ctx.beginPath();
                  ctx.moveTo(effectiveEnd.x, effectiveEnd.y);
                  ctx.lineTo(effectiveEnd.x - arrowSize * Math.cos(arrowAngle - REVDOKU_LEADER_ARROW_ANGLE), effectiveEnd.y - arrowSize * Math.sin(arrowAngle - REVDOKU_LEADER_ARROW_ANGLE));
                  ctx.moveTo(effectiveEnd.x, effectiveEnd.y);
                  ctx.lineTo(effectiveEnd.x - arrowSize * Math.cos(arrowAngle + REVDOKU_LEADER_ARROW_ANGLE), effectiveEnd.y - arrowSize * Math.sin(arrowAngle + REVDOKU_LEADER_ARROW_ANGLE));
                  ctx.stroke();
                }
                ctx.restore();
              }

              // Pass 2: Draw inline label backgrounds + text (on top of leaders)
              for (const placement of inlineLabels) {
                const check = pageHighlights.find(c => c.id === placement.id);
                if (!check?.description) continue;
                const labelX = placement.labelBox.x + offsetX;
                const labelY = placement.labelBox.y + offsetY;
                measureAndDrawLabel(check, labelX, labelY, placement.labelBox.width, 0, placement.side);
              }

              // Pass 3: Margin labels — self-contained rendering with exact positioning.
              // Each label: draw leader, then full-width background, then text.
              // Y is computed here using the rendering canvas metrics (single source of truth).
              {
                const marginGap = REVDOKU_MARGIN_LABEL_VERTICAL_GAP * fontSizeScale;
                const marginBgWidth = effectiveMarginWidth - REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING * fontSizeScale;
                // Track Y independently for each side (autoRepositionLabels may distribute to left/right)
                const nextMarginYBySide: Record<string, number> = {
                  [PlacementSide.RIGHT]: offsetY + marginGap,
                  [PlacementSide.LEFT]: offsetY + marginGap,
                };

                // Collect highlight info for all margin labels
                type MarginLabelInfo = {
                  placement: typeof marginLabelsForRender[0];
                  check: typeof pageHighlights[0];
                  colors: ReturnType<typeof getColorsForCheckResult>;
                  hlX: number; hlY: number; hlW: number; hlH: number;
                };
                const marginInfos: MarginLabelInfo[] = [];
                for (const placement of marginLabelsForRender) {
                  const check = pageHighlights.find(c => c.id === placement.id);
                  if (!check?.description) continue;
                  const minOpacityForImage = getMinOpacityForImageSize(newWidth, newHeight);
                  const colors = getColorsForCheckResult(check, minOpacityForImage);
                  const hlCheck = check as unknown as ICoordinates;
                  const hlX = mapX(hlCheck.x1) + offsetX;
                  const hlY = mapY(hlCheck.y1) + offsetY;
                  const hlW = getWidth(hlCheck) * sizeScale;
                  const hlH = getHeight(hlCheck) * sizeScale;
                  marginInfos.push({ placement, check, colors, hlX, hlY, hlW, hlH });
                }

                // Render each margin label: leader → background → text
                for (const info of marginInfos) {
                  const { placement, check, colors } = info;
                  const labelX = placement.labelBox.x + offsetX;
                  const side = placement.side;
                  // Use spread position from autoRepositionLabels Step 11, but ensure no overlap
                  const spreadY = placement.labelBox.y + offsetY;
                  const minY = nextMarginYBySide[side] ?? (offsetY + marginGap);
                  const labelY = Math.max(spreadY, minY);

                  // Pre-measure to get label height for leader endpoint
                  ctx.font = `${effectiveFontSize}px ${labelFontFamily}`;
                  const labelMaxWidth = placement.labelBox.width - effectivePadding * 2;
                  const preBadgeSpec = calculateLabelBadgeSpec(effectiveFontSize);
                  const preIcoType = getCheckIconType(check.description, check.rule_id);
                  const preIcoSize = preIcoType ? effectiveFontSize * REVDOKU_CHECK_ICON_SIZE_SCALE : 0;
                  const preIcoGap = preIcoType ? REVDOKU_CHECK_ICON_GAP : 0;
                  // Account for type badges width in pre-measurement
                  const preIsRecheck = check.description?.startsWith('#recheck ');
                  const preTypeLabels = getCheckDataTypeLabels(check).filter(l => preIsRecheck ? l !== 'recheck' : true);
                  const preTypeBadgeFontSize = effectiveFontSize * REVDOKU_TYPE_BADGE_FONT_SCALE;
                  ctx.font = `${REVDOKU_TYPE_BADGE_FONT_WEIGHT} ${preTypeBadgeFontSize}px ${labelFontFamily}`;
                  let preTypeBadgesW = 0;
                  for (const label of preTypeLabels) {
                    preTypeBadgesW += ctx.measureText(label).width + REVDOKU_TYPE_BADGE_PADDING_H * 2 + 2 + REVDOKU_TYPE_BADGE_GAP;
                  }
                  ctx.font = `${effectiveFontSize}px ${labelFontFamily}`;
                  const preIsLeft = side === PlacementSide.LEFT;
                  const preLeftIndent = preIsLeft
                    ? preIcoSize + preIcoGap + preTypeBadgesW
                    : preBadgeSpec.radius * 2 + REVDOKU_LABEL_BADGE_GAP + preIcoSize + preIcoGap + preTypeBadgesW;
                  const preRightIndent = preIsLeft ? preBadgeSpec.radius * 2 + REVDOKU_LABEL_BADGE_GAP : 0;
                  const preTextIndent = preLeftIndent + preRightIndent;
                  const preWrapIndent = preIsLeft ? 0 : preBadgeSpec.radius * 2 + REVDOKU_LABEL_BADGE_GAP;
                  const preWords = formatCheckDescription(check.description, check.rule_id, check.data).split(' ');
                  let preLine = '';
                  let preLineCount = 0;
                  for (let i = 0; i < preWords.length && preLineCount < REVDOKU_LAYOUT_LABEL_MAX_LINES; i++) {
                    const preCurrentMax = preLineCount === 0 ? labelMaxWidth - preTextIndent : labelMaxWidth - preWrapIndent;
                    const testLine = preLine + (preLine ? ' ' : '') + preWords[i];
                    if (ctx.measureText(testLine).width > preCurrentMax && preLine) {
                      preLine = preWords[i];
                      preLineCount++;
                    } else {
                      preLine = testLine;
                    }
                  }
                  if (preLine) preLineCount++;
                  const preTightHeight = Math.max(20, preLineCount * effectiveLineHeight + effectivePadding * 2);

                  // Straight connection line from label to highlight
                  const marginLabelBox = { x: labelX, y: labelY, width: placement.labelBox.width, height: preTightHeight };
                  const marginHlBox = { x: info.hlX, y: info.hlY, width: info.hlW, height: info.hlH };
                  const { start, end } = computeStraightConnectionLine(marginLabelBox, marginHlBox, placement.side);
                  const marginHmCfg = getHighlightModeConfig(highlight_mode_override);
                  const marginEffectiveEnd = getConnectionLineEndpoint(marginHmCfg.connectionMode, marginHlBox, marginLabelBox) ?? end;

                  const ldx = marginEffectiveEnd.x - start.x;
                  const ldy = marginEffectiveEnd.y - start.y;
                  const leaderLen = Math.sqrt(ldx * ldx + ldy * ldy);
                  if (leaderLen > 5) {
                    ctx.save();
                    ctx.strokeStyle = colors.border_color;
                    ctx.lineWidth = REVDOKU_LEADER_LINE_WIDTH_V2;
                    ctx.globalAlpha = REVDOKU_LEADER_OPACITY;
                    ctx.setLineDash(REVDOKU_LEADER_DASH_PATTERN);
                    ctx.beginPath();
                    ctx.moveTo(start.x, start.y);
                    ctx.lineTo(marginEffectiveEnd.x, marginEffectiveEnd.y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    // Endpoint at highlight end
                    if (REVDOKU_LEADER_ENDPOINT_STYLE === 'circle') {
                      ctx.beginPath();
                      ctx.arc(marginEffectiveEnd.x, marginEffectiveEnd.y, REVDOKU_LEADER_CIRCLE_RADIUS, 0, Math.PI * 2);
                      ctx.fillStyle = colors.border_color;
                      ctx.fill();
                    } else if (REVDOKU_LEADER_ENDPOINT_STYLE === 'arrow') {
                      const arrowAngle = Math.atan2(marginEffectiveEnd.y - start.y, marginEffectiveEnd.x - start.x);
                      const arrowSize = Math.max(REVDOKU_LEADER_ARROW_MIN, Math.min(REVDOKU_LEADER_ARROW_MAX, leaderLen * REVDOKU_LEADER_ARROW_RATIO));
                      ctx.lineWidth = Math.max(2, REVDOKU_LEADER_LINE_WIDTH_V2 + 0.5);
                      ctx.beginPath();
                      ctx.moveTo(marginEffectiveEnd.x, marginEffectiveEnd.y);
                      ctx.lineTo(marginEffectiveEnd.x - arrowSize * Math.cos(arrowAngle - REVDOKU_LEADER_ARROW_ANGLE), marginEffectiveEnd.y - arrowSize * Math.sin(arrowAngle - REVDOKU_LEADER_ARROW_ANGLE));
                      ctx.moveTo(marginEffectiveEnd.x, marginEffectiveEnd.y);
                      ctx.lineTo(marginEffectiveEnd.x - arrowSize * Math.cos(arrowAngle + REVDOKU_LEADER_ARROW_ANGLE), marginEffectiveEnd.y - arrowSize * Math.sin(arrowAngle + REVDOKU_LEADER_ARROW_ANGLE));
                      ctx.stroke();
                    }
                    ctx.restore();
                  }

                  // Draw label (background covers the leader endpoint)
                  const tightH = measureAndDrawLabel(check, labelX, labelY, placement.labelBox.width, marginBgWidth, placement.side);
                  nextMarginYBySide[side] = labelY + tightH + marginGap;
                }

                // Update content protection bounds with actual rendered margin label bottom.
                // nextMarginYBySide tracks lastLabelBottom + marginGap for each side.
                // content* vars are in pre-offset space (offset is added at contentBounds below).
                const maxNextMarginY = Math.max(...Object.values(nextMarginYBySide));
                if (maxNextMarginY > marginGap + offsetY) {
                  const actualMarginBottom = (maxNextMarginY - marginGap) - offsetY;
                  // Use actual margin label area right edge, not full canvas width
                  const marginLabelRight = newWidth + effectiveMarginWidth;
                  // Track LEFT margin labels (negative X in pre-offset space)
                  const leftMargins = marginInfos.filter(i => i.placement.side === PlacementSide.LEFT);
                  const marginLabelLeft = leftMargins.length > 0
                    ? Math.min(...leftMargins.map(i => i.placement.labelBox.x))
                    : 0;
                  if (!hasContent) {
                    contentMinTop = 0;
                    contentMinLeft = marginLabelLeft;
                    contentMaxBottom = actualMarginBottom;
                    contentMaxRight = marginLabelRight;
                    hasContent = true;
                  } else {
                    if (0 < contentMinTop) contentMinTop = 0;  // margin labels start at pre-offset Y=0
                    if (marginLabelLeft < contentMinLeft) contentMinLeft = marginLabelLeft;
                    if (actualMarginBottom > contentMaxBottom) contentMaxBottom = actualMarginBottom;
                    if (marginLabelRight > contentMaxRight) contentMaxRight = marginLabelRight;
                  }
                }
              }
            }
          }

          // save image as base64 string from canvas
          // Convert canvas to base64
          let imageBuffer = await canvas.toBuffer('image/png');

          // Crop margins if enabled
          if (crop_margins) {
            if (hasContent) {
              // Start from content bounding box if available, otherwise use page bounds
              let cropLeft: number, cropTop: number, cropRight: number, cropBottom: number;

              if (pageInfo?.content_bounding_box) {
                // Map content bbox from document space to canvas space
                const bbox = pageInfo.content_bounding_box;
                cropLeft = bbox.x1 * sizeScale + offsetX;
                cropTop = bbox.y1 * sizeScale + offsetY;
                cropRight = bbox.x2 * sizeScale + offsetX;
                cropBottom = bbox.y2 * sizeScale + offsetY;
              } else {
                // Fallback: use page bounds
                cropLeft = offsetX;
                cropTop = offsetY;
                cropRight = offsetX + newWidth;
                cropBottom = offsetY + newHeight;
              }

              // Expand to include highlight + label extents
              cropLeft = Math.min(cropLeft, Math.floor(contentMinLeft + offsetX));
              cropTop = Math.min(cropTop, Math.floor(contentMinTop + offsetY));
              cropRight = Math.max(cropRight, Math.ceil(contentMaxRight + offsetX));
              cropBottom = Math.max(cropBottom, Math.ceil(contentMaxBottom + offsetY));

              const trimPad = 20;
              const trimX = Math.max(0, Math.floor(cropLeft) - trimPad);
              const trimY = Math.max(0, Math.floor(cropTop) - trimPad);
              const trimW = Math.min(canvasWidth, Math.ceil(cropRight) + trimPad) - trimX;
              const trimH = Math.min(canvasHeight, Math.ceil(cropBottom) + trimPad) - trimY;

              if (trimW > 0 && trimH > 0 && (trimW < canvasWidth - 2 || trimH < canvasHeight - 2)) {
                imageBuffer = await sharp(imageBuffer)
                  .extract({
                    left: Math.round(trimX), top: Math.round(trimY),
                    width: Math.round(trimW), height: Math.round(trimH)
                  })
                  .png()
                  .toBuffer();
              }
            } else {
              // No highlights — crop to content bbox if available
              if (pageInfo?.content_bounding_box) {
                const bbox = pageInfo.content_bounding_box;
                const bboxLeft = bbox.x1 * sizeScale + offsetX;
                const bboxTop = bbox.y1 * sizeScale + offsetY;
                const bboxRight = bbox.x2 * sizeScale + offsetX;
                const bboxBottom = bbox.y2 * sizeScale + offsetY;
                const trimPad = 10;
                const trimX = Math.max(0, Math.floor(bboxLeft) - trimPad);
                const trimY = Math.max(0, Math.floor(bboxTop) - trimPad);
                const trimW = Math.min(canvasWidth, Math.ceil(bboxRight) + trimPad) - trimX;
                const trimH = Math.min(canvasHeight, Math.ceil(bboxBottom) + trimPad) - trimY;
                if (trimW > 0 && trimH > 0 && (trimW < canvasWidth - 2 || trimH < canvasHeight - 2)) {
                  imageBuffer = await sharp(imageBuffer)
                    .extract({
                      left: Math.round(trimX), top: Math.round(trimY),
                      width: Math.round(trimW), height: Math.round(trimH)
                    })
                    .png()
                    .toBuffer();
                }
              } else {
                // Legacy fallback — pixel scan
                imageBuffer = await cropWhiteMargins(imageBuffer, 10);
              }
            }
          }

          highlightedImages.push(Buffer.from(imageBuffer).toString('base64'));
        } catch (error) {
          console.debug('createImagesWithHighlights', `Error creating highlighted report images: ${error}`);
          // rethrow the error to be handled by the error handler
          throw new Error(`Error creating highlighted report images: ${error}`);
        }

      }
      catch (error) {
        console.debug('createImagesWithHighlights', `Error processing page ${pageIndex}: ${error}`);
        // rethrow the error to be handled by the error handler
        throw new Error(`Error processing page ${pageIndex}: ${error}`);
      }
    } // for each page

    // return array with images as base64 encoded strings (or empty string if page was skipped)
    return highlightedImages;

  } catch (error) {
    console.debug('errors', `Error creating highlighted report images: ${error}`);
    // Return original images if there's an error
    return highlightedImages;
  }
}

/**
 * Resizes an image to a maximum width while maintaining aspect ratio
 */
async function resizeImageToMaxWidth(inputImage: Uint8Array, maxWidth: number): Promise<Uint8Array> {
  try {
    const img = new Image();
    img.src = Buffer.from(inputImage);

    console.debug('resizeImageToMaxWidth', `original img dimensions: ${img.width}x${img.height}, maxWidth: ${maxWidth}`);

    if (img.width <= maxWidth) {
      console.debug('resizeImageToMaxWidth', 'No resizing needed - image width is already <= maxWidth');
      return inputImage; // No resizing needed
    }

    const scaleFactor = maxWidth / img.width;
    const newWidth = Math.floor(img.width * scaleFactor);
    const newHeight = Math.floor(img.height * scaleFactor);

    console.debug('resizeImageToMaxWidth', `scaleFactor: ${scaleFactor}, newWidth: ${newWidth}, newHeight: ${newHeight}`);

    const canvas = createCanvas(newWidth, newHeight);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, 0, 0, newWidth, newHeight);

    const imageBuffer = await canvas.toBuffer('image/png');
    return new Uint8Array(imageBuffer);

  } catch (error) {
    console.debug('errors', `Error resizing image: ${error}`);
    return inputImage; // Return original if error
  }
}


/**
 * DEBUG: Overlay AI-returned check coordinates on the grid images.
 * Draws each check's bounding box on the grid image so you can visually
 * verify whether AI coordinates align with the expected document positions.
 *
 * Each check is drawn with:
 *  - A colored rectangle (red for failed, green for passed)
 *  - A numbered label showing the check index
 *  - The raw coordinate values printed next to the box
 *
 * Coordinates are drawn in the ORIGINAL coordinate space (as returned by AI),
 * converted to the grid canvas pixel space using scaling_factor + ruler offset.
 *
 * @param sourcePages - The processed page images (with pageAsImageWithGrid)
 * @param checks - The normalized checks (0-based page numbers, original coord space)
 * @returns Array of base64 PNG strings, one per page, with overlaid checks
 */
/**
 * Render a single debug overlay image for a subset of checks on one page.
 * Draws content boxes, check bounding boxes, coordinate labels, description_position
 * labels/arrows, and a legend onto the grid image.
 */
async function renderPageDebugOverlay(
  img: InstanceType<typeof Image>,
  pageInfo: IPageInfoExtended,
  pageChecks: ICheck[],
  rawAICoordsById: Map<string, { x1: number; y1: number; x2: number; y2: number }> | undefined,
  aiCoordScale: number,
  legendLabel: string,
): Promise<string> {
  const scaling_factor = pageInfo.scaling_factor;
  const original_width = pageInfo.original_width;
  const gridMode = pageInfo.gridMode;
  const cropOffX = pageInfo.crop_offset_x || 0;
  const cropOffY = pageInfo.crop_offset_y || 0;

  const { rulerSize, badgeMarginLeft, badgeMarginTop } = calculateGridLayout(gridMode, pageInfo.width, pageInfo.height);

  // AXIS mode: calculateGridLayout returns zeros, but the canvas has config margins
  const axisConfig = getGridModeConfig(gridMode);
  const axisOffX = gridMode === EGridMode.AXIS ? axisConfig.margins.left : 0;
  const axisOffY = gridMode === EGridMode.AXIS ? axisConfig.margins.top : 0;

  const marginExtra = Math.round(REVDOKU_ANNOTATION_MARGIN * scaling_factor);
  const canvasWidth = img.width + marginExtra;
  const canvas = createCanvas(canvasWidth, img.height);
  const ctx = canvas.getContext('2d');

  // Fill margin zone with light gray background
  ctx.fillStyle = 'rgba(245, 245, 245, 1.0)';
  ctx.fillRect(img.width, 0, marginExtra, img.height);

  // Draw the grid image
  ctx.drawImage(img, 0, 0);

  // Draw content boxes (underneath checks)
  const contentBoxes = pageInfo.content_boxes || [];
  for (let i = 0; i < contentBoxes.length; i++) {
    const box = contentBoxes[i];
    const pixelX1 = docToGridCanvasPixel(box.x1, cropOffX, scaling_factor, rulerSize, badgeMarginLeft) + axisOffX;
    const pixelY1 = docToGridCanvasPixel(box.y1, cropOffY, scaling_factor, rulerSize, badgeMarginTop) + axisOffY;
    const pixelX2 = docToGridCanvasPixel(box.x2, cropOffX, scaling_factor, rulerSize, badgeMarginLeft) + axisOffX;
    const pixelY2 = docToGridCanvasPixel(box.y2, cropOffY, scaling_factor, rulerSize, badgeMarginTop) + axisOffY;

    ctx.fillStyle = 'rgba(0, 150, 220, 0.08)';
    ctx.fillRect(pixelX1, pixelY1, pixelX2 - pixelX1, pixelY2 - pixelY1);
    ctx.strokeStyle = 'rgba(0, 150, 220, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(pixelX1, pixelY1, pixelX2 - pixelX1, pixelY2 - pixelY1);
    ctx.setLineDash([]);
  }

  // Draw check bounding boxes and coordinate labels
  for (let i = 0; i < pageChecks.length; i++) {
    const check = pageChecks[i];
    const raw = rawAICoordsById?.get(check.id);
    let pixelX1: number, pixelY1: number, pixelX2: number, pixelY2: number;
    let coordText: string;

    if (raw) {
      if (aiCoordScale > 0) {
        // AI reports normalized coords (0..aiCoordScale).
        // When aiSeesMargins=true: AI sees canvas with margins → scale to full canvas then offset.
        // When aiSeesMargins=false: AI sees content only → scale to content then add margin offset.
        if (axisConfig.aiSeesMargins) {
          const effectiveW = pageInfo.width + axisOffX;
          const effectiveH = pageInfo.height + axisOffY;
          pixelX1 = Math.round(raw.x1 / aiCoordScale * effectiveW);
          pixelY1 = Math.round(raw.y1 / aiCoordScale * effectiveH);
          pixelX2 = Math.round(raw.x2 / aiCoordScale * effectiveW);
          pixelY2 = Math.round(raw.y2 / aiCoordScale * effectiveH);
        } else {
          pixelX1 = Math.round(raw.x1 / aiCoordScale * pageInfo.width) + axisOffX;
          pixelY1 = Math.round(raw.y1 / aiCoordScale * pageInfo.height) + axisOffY;
          pixelX2 = Math.round(raw.x2 / aiCoordScale * pageInfo.width) + axisOffX;
          pixelY2 = Math.round(raw.y2 / aiCoordScale * pageInfo.height) + axisOffY;
        }
        // Show AI coords + document-space coords (what the live viewer uses)
        coordText = `ai:(${raw.x1},${raw.y1})-(${raw.x2},${raw.y2}) doc:(${check.x1},${check.y1})-(${check.x2},${check.y2})`;
      } else {
        pixelX1 = badgeMarginLeft + rulerSize + raw.x1;
        pixelY1 = badgeMarginTop + rulerSize + raw.y1;
        pixelX2 = badgeMarginLeft + rulerSize + raw.x2;
        pixelY2 = badgeMarginTop + rulerSize + raw.y2;
        coordText = `raw:(${raw.x1},${raw.y1})-(${raw.x2},${raw.y2})`;
      }
    } else {
      pixelX1 = docToGridCanvasPixel(check.x1, cropOffX, scaling_factor, rulerSize, badgeMarginLeft) + axisOffX;
      pixelY1 = docToGridCanvasPixel(check.y1, cropOffY, scaling_factor, rulerSize, badgeMarginTop) + axisOffY;
      pixelX2 = docToGridCanvasPixel(check.x2, cropOffX, scaling_factor, rulerSize, badgeMarginLeft) + axisOffX;
      pixelY2 = docToGridCanvasPixel(check.y2, cropOffY, scaling_factor, rulerSize, badgeMarginTop) + axisOffY;
      coordText = `doc:(${check.x1},${check.y1})-(${check.x2},${check.y2})`;
    }

    const w = pixelX2 - pixelX1;
    const h = pixelY2 - pixelY1;
    const color = check.passed ? 'rgba(0, 180, 0, 0.7)' : 'rgba(220, 0, 0, 0.7)';

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(pixelX1, pixelY1, w, h);

    const badgeSize = 20;
    ctx.fillStyle = check.passed ? '#00b400' : '#dc0000';
    ctx.fillRect(pixelX1, pixelY1 - badgeSize - 2, badgeSize, badgeSize);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${i + 1}`, pixelX1 + badgeSize / 2, pixelY1 - badgeSize / 2 - 2);

    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const textMetrics = ctx.measureText(coordText);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(pixelX1, pixelY2 + 2, textMetrics.width + 4, 14);
    ctx.fillStyle = check.passed ? '#006400' : '#8b0000';
    ctx.fillText(coordText, pixelX1 + 2, pixelY2 + 3);
  }

  // Draw description_position labels and arrows (purple/magenta)
  for (let i = 0; i < pageChecks.length; i++) {
    const check = pageChecks[i];
    const mp = check.description_position;
    if (!mp) continue;

    const box = mp.box;
    const lx = badgeMarginLeft + rulerSize + box.x * scaling_factor + axisOffX;
    const ly = badgeMarginTop + rulerSize + box.y * scaling_factor + axisOffY;
    const lw = box.width * scaling_factor;
    const lh = box.height * scaling_factor;

    ctx.strokeStyle = 'rgba(160, 32, 240, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(lx, ly, lw, lh);
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(160, 32, 240, 0.06)';
    ctx.fillRect(lx, ly, lw, lh);

    const isMarginLabel = (mp.box.x + mp.box.width) > original_width;
    ctx.fillStyle = 'rgba(160, 32, 240, 0.85)';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const modeText = isMarginLabel ? 'M' : 'I';
    // Show label index, mode, Y position and height in doc space
    const coordLabel = `${i + 1}${modeText} y:${Math.round(box.y)} h:${Math.round(box.height)}`;
    ctx.fillText(coordLabel, lx + 2, ly + 2);

    // Frontend-equivalent height estimate (cyan outline) for comparison
    const feEst = estimateWrappedLabelDimensions(
      formatCheckDescription(check.description, check.rule_id, check.data), box.width, 12, 16 / 12, 5, REVDOKU_LAYOUT_LABEL_MAX_LINES,
    );
    const feHeight = feEst.height + 3; // +3 for CSS border approx
    const lh_fe = feHeight * scaling_factor;

    ctx.strokeStyle = 'rgba(0, 200, 200, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(lx, ly, lw, lh_fe);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0, 200, 200, 0.8)';
    ctx.font = '7px monospace';
    ctx.fillText(`fe_h:${Math.round(feHeight)}`, lx + 2, ly + lh + 2);

    const highlightBox = {
      x: check.x1, y: check.y1,
      width: check.x2 - check.x1, height: check.y2 - check.y1,
    };
    const labelBoxForArrow = {
      x: mp.box.x, y: mp.box.y,
      width: mp.box.width, height: mp.box.height,
    };
    const debugSide = isMarginLabel ? (mp.box.x >= original_width ? PlacementSide.RIGHT : PlacementSide.LEFT) : PlacementSide.INSIDE;
    const { start, end } = computeStraightConnectionLine(labelBoxForArrow, highlightBox, debugSide);

    const scX = (v: number) => badgeMarginLeft + rulerSize + v * scaling_factor + axisOffX;
    const scY = (v: number) => badgeMarginTop + rulerSize + v * scaling_factor + axisOffY;
    ctx.strokeStyle = 'rgba(160, 32, 240, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(scX(start.x), scY(start.y));
    ctx.lineTo(scX(end.x), scY(end.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }


  const buffer = canvas.toBuffer('image/png');
  return Buffer.from(buffer).toString('base64');
}

export async function overlayChecksOnGridImages(
  sourcePages: IPageInfoExtended[],
  checks: ICheck[],
  rawAICoordsById?: Map<string, { x1: number; y1: number; x2: number; y2: number }>,
  aiCoordScale: number = 0,
): Promise<Array<{ failed: string; passed: string }>> {
  const result: Array<{ failed: string; passed: string }> = [];

  for (let pageIndex = 0; pageIndex < sourcePages.length; pageIndex++) {
    const pageInfo = sourcePages[pageIndex];
    const gridImageBase64 = pageInfo.pageAsImageWithGrid;

    if (!gridImageBase64) {
      result.push({ failed: '', passed: '' });
      continue;
    }

    // Load the grid image once — reused for both renders
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (err) => reject(err);
      img.src = Buffer.from(gridImageBase64, 'base64');
    });

    const pageChecks = checks.filter(c => c.page === pageIndex);
    const failedChecks = pageChecks.filter(c => !c.passed);
    const passedChecks = pageChecks.filter(c => c.passed);

    const failedImg = await renderPageDebugOverlay(img, pageInfo, failedChecks, rawAICoordsById, aiCoordScale, 'FAILED');
    const passedImg = await renderPageDebugOverlay(img, pageInfo, passedChecks, rawAICoordsById, aiCoordScale, 'PASSED');

    result.push({ failed: failedImg, passed: passedImg });
  }

  return result;
}
