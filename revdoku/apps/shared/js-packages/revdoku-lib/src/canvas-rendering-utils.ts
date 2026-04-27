/**
 * Canvas Rendering Utilities for Server-Side Highlight Drawing
 *
 * This module provides high-level functions for rendering highlights on Canvas
 * for server-side PDF/image exports. These functions ensure consistent styling
 * across revdoku-doc-api exports and frontend displays.
 *
 * Usage:
 *   import { drawHighlightBorder, drawRuleBadge } from '@revdoku/lib';
 *
 *   // Draw a highlight border
 *   drawHighlightBorder(ctx, check, x, y, width, height);
 *
 *   // Draw a rule badge
 *   drawRuleBadge(ctx, check, ruleNumber, x, y, width, height);
 */

import { ICheck, REVDOKU_HIGHLIGHT_FILL_ENABLED, getCharWidthFactor, PlacementSide, HighlightMode, getHighlightModeConfig } from './common-types';
import type { LabelFontFamily } from './common-types';
import {
  getColorsForCheckResult,
  REVDOKU_BADGE_BACKGROUND_COLOR,
  REVDOKU_BADGE_TEXT_COLOR,
  REVDOKU_MESSAGE_BACKGROUND_COLOR_TEMPLATE,
  createColorWithOpacity
} from './common-types';
import {
  calculateBadgeMetrics,
  calculateCornerRadius,
  calculateMessageMetrics,
  calculateSourceBadgePosition,
  REVDOKU_MARGIN_LABEL_INNER_PADDING,
  REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
  REVDOKU_MARGIN_LABEL_MAX_LINES,
  getMainBorderForSide,
} from './highlight-rendering-utils';
import type { LabelBadgeSpec } from './highlight-rendering-utils';
import type { Point, MarginLabelConfig } from './highlight-rendering-utils';
import type { Leader, InlineLeader, MarginLeader } from './leader-router';
import { computeLeaderRenderPath } from './leader-router';

/**
 * Canvas 2D Rendering Context type
 * This type is compatible with both browser Canvas and node-canvas
 */
export interface CanvasRenderingContext2DLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;

  beginPath(): void;
  stroke(): void;
  fill(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise?: boolean): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  roundRect?(x: number, y: number, width: number, height: number, radii?: number | number[]): void;
  measureText?(text: string): { width: number };
  setLineDash?(segments: number[]): void;
  closePath(): void;
  save(): void;
  restore(): void;
}

/**
 * Draw a rounded rectangle path (fallback for older Canvas implementations)
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    // Fallback implementation using basic path commands
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
  }
}

/**
 * Draw a highlight border with rounded corners
 *
 * @param ctx - Canvas rendering context
 * @param check - Check data containing pass/fail status
 * @param x - X coordinate of the highlight
 * @param y - Y coordinate of the highlight
 * @param width - Width of the highlight
 * @param height - Height of the highlight
 * @param minOpacity - Optional minimum opacity for the highlight
 */
export function drawHighlightBorder(
  ctx: CanvasRenderingContext2DLike,
  check: ICheck,
  x: number,
  y: number,
  width: number,
  height: number,
  minOpacity?: number,
  highlightMode?: HighlightMode
): void {
  const checkColors = getColorsForCheckResult(check, minOpacity);
  const hmConfig = getHighlightModeConfig(highlightMode);

  ctx.save();

  if (highlightMode === HighlightMode.DOT) {
    // Dot mode: small filled circle at the center
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    ctx.globalAlpha = hmConfig.opacity;
    ctx.fillStyle = checkColors.border_color;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (highlightMode === HighlightMode.UNDERLINE) {
    // Underline mode: horizontal line at the bottom of the highlight area
    ctx.globalAlpha = hmConfig.opacity;
    ctx.strokeStyle = checkColors.border_color;
    ctx.lineWidth = hmConfig.lineWidth;
    ctx.beginPath();
    ctx.moveTo(x, y + height);
    ctx.lineTo(x + width, y + height);
    ctx.stroke();
  } else if (highlightMode === HighlightMode.BRACKET) {
    // Bracket mode: L-shaped corner markers
    const armLen = Math.min(12, Math.min(width, height) * 0.25);
    ctx.globalAlpha = hmConfig.opacity;
    ctx.strokeStyle = checkColors.border_color;
    ctx.lineWidth = hmConfig.lineWidth;
    // Top-left
    ctx.beginPath(); ctx.moveTo(x, y + armLen); ctx.lineTo(x, y); ctx.lineTo(x + armLen, y); ctx.stroke();
    // Top-right
    ctx.beginPath(); ctx.moveTo(x + width - armLen, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + armLen); ctx.stroke();
    // Bottom-left
    ctx.beginPath(); ctx.moveTo(x, y + height - armLen); ctx.lineTo(x, y + height); ctx.lineTo(x + armLen, y + height); ctx.stroke();
    // Bottom-right
    ctx.beginPath(); ctx.moveTo(x + width - armLen, y + height); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width, y + height - armLen); ctx.stroke();
  } else {
    // Rectangle mode (default): traditional bordered highlight
    const cornerRadius = calculateCornerRadius(width, height);

    if (REVDOKU_HIGHLIGHT_FILL_ENABLED) {
      ctx.fillStyle = checkColors.highlight_color;
      drawRoundedRect(ctx, x, y, width, height, cornerRadius);
      ctx.fill();
    }

    ctx.globalAlpha = hmConfig.opacity;
    ctx.strokeStyle = checkColors.border_color;
    ctx.lineWidth = hmConfig.lineWidth;
    drawRoundedRect(ctx, x, y, width, height, cornerRadius);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draw a numbered badge for a rule
 *
 * @param ctx - Canvas rendering context
 * @param check - Check data containing pass/fail status
 * @param ruleNumber - The rule number to display
 * @param x - X coordinate of the highlight
 * @param y - Y coordinate of the highlight
 * @param width - Width of the highlight
 * @param height - Height of the highlight
 * @param minOpacity - Optional minimum opacity for colors
 */
export function drawRuleBadge(
  ctx: CanvasRenderingContext2DLike,
  check: ICheck,
  ruleNumber: number,
  x: number,
  y: number,
  width: number,
  height: number,
  minOpacity?: number,
  fontFamily?: string
): void {
  const checkColors = getColorsForCheckResult(check, minOpacity);
  const badgeMetrics = calculateBadgeMetrics(x, y, width, height);

  ctx.save();
  ctx.globalAlpha = 0.85; // Semi-transparent badge

  // Draw rounded rectangle badge background
  const rectX = badgeMetrics.x - badgeMetrics.size / 2;
  const rectY = badgeMetrics.y - badgeMetrics.size / 2;

  // Badge background (using shared constant)
  ctx.fillStyle = REVDOKU_BADGE_BACKGROUND_COLOR;
  ctx.beginPath();
  drawRoundedRect(ctx, rectX, rectY, badgeMetrics.size, badgeMetrics.size, badgeMetrics.borderRadius);
  ctx.fill();

  // Badge border
  ctx.strokeStyle = checkColors.border_color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  drawRoundedRect(ctx, rectX, rectY, badgeMetrics.size, badgeMetrics.size, badgeMetrics.borderRadius);
  ctx.stroke();

  // Badge text
  ctx.fillStyle = checkColors.border_color;
  ctx.font = `bold ${badgeMetrics.fontSize}px ${fontFamily || 'Arial'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ruleNumber.toString(), badgeMetrics.x, badgeMetrics.y);

  ctx.restore();
}

/**
 * Draw a source badge (AI or Envelope indicator)
 *
 * @param ctx - Canvas rendering context
 * @param check - Check data containing source information
 * @param x - X coordinate of the highlight
 * @param y - Y coordinate of the highlight
 * @param width - Width of the highlight
 * @param height - Height of the highlight
 * @param minOpacity - Optional minimum opacity for colors
 */
export function drawSourceBadge(
  ctx: CanvasRenderingContext2DLike,
  check: ICheck,
  x: number,
  y: number,
  width: number,
  height: number,
  minOpacity?: number,
  fontFamily?: string
): void {
  const checkColors = getColorsForCheckResult(check, minOpacity);
  const sourceBadgeMetrics = calculateSourceBadgePosition(x, y, width);

  const iconBadgeX = sourceBadgeMetrics.x;
  const iconBadgeY = sourceBadgeMetrics.y;
  const iconBadgeSize = sourceBadgeMetrics.size;

  // Draw circle background with colored border
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

  // Draw simple text indicator (AI or E for Envelope)
  // Note: For more complex icons, implement custom drawing in your application
  const isManual = check.source === 'user';
  const iconText = isManual ? 'E' : 'AI';
  const fontSize = iconBadgeSize * 0.5;

  ctx.fillStyle = checkColors.border_color;
  ctx.font = `bold ${fontSize}px ${fontFamily || 'Arial'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(iconText, iconBadgeX, iconBadgeY);

  ctx.restore();
}

/**
 * Draw a check message with background
 *
 * @param ctx - Canvas rendering context
 * @param check - Check data containing the message
 * @param message - The message text to display
 * @param x - X coordinate of the highlight
 * @param y - Y coordinate of the highlight
 * @param width - Width of the highlight
 * @param height - Height of the highlight
 * @param maxCharacters - Maximum characters to display (default: 50)
 */
export function drawCheckMessage(
  ctx: CanvasRenderingContext2DLike,
  check: ICheck,
  message: string,
  x: number,
  y: number,
  width: number,
  height: number,
  maxCharacters: number = 50,
  fontFamily?: string
): void {
  if (!message) return;

  const messageMetrics = calculateMessageMetrics(
    message,
    x, y, width, height,
    maxCharacters
  );

  ctx.save();

  // Draw semi-transparent background rectangle (using shared constant)
  ctx.fillStyle = createColorWithOpacity(REVDOKU_MESSAGE_BACKGROUND_COLOR_TEMPLATE, messageMetrics.backgroundOpacity);
  ctx.fillRect(
    messageMetrics.x - messageMetrics.padding,
    messageMetrics.y - messageMetrics.fontSize - messageMetrics.padding,
    messageMetrics.width + (messageMetrics.padding * 2),
    messageMetrics.height
  );

  // Draw message text (dark text on light background)
  ctx.fillStyle = REVDOKU_BADGE_TEXT_COLOR;
  ctx.font = `${messageMetrics.fontSize}px ${fontFamily || 'Arial'}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(messageMetrics.text, messageMetrics.x, messageMetrics.y);

  ctx.restore();
}

/**
 * Draw a complete highlight with all components (border, badge, source, message)
 *
 * This is a convenience function that draws all highlight elements in one call.
 *
 * @param ctx - Canvas rendering context
 * @param check - Check data
 * @param ruleNumber - The rule number to display
 * @param x - X coordinate of the highlight
 * @param y - Y coordinate of the highlight
 * @param width - Width of the highlight
 * @param height - Height of the highlight
 * @param minOpacity - Optional minimum opacity for colors
 * @param includeMessage - Whether to include the message (default: true)
 */
export function drawCompleteHighlight(
  ctx: CanvasRenderingContext2DLike,
  check: ICheck,
  ruleNumber: number,
  x: number,
  y: number,
  width: number,
  height: number,
  minOpacity?: number,
  includeMessage: boolean = true,
  highlightMode?: HighlightMode
): void {
  // Draw border (or dot in dot mode)
  drawHighlightBorder(ctx, check, x, y, width, height, minOpacity, highlightMode);

  // Draw rule badge
  drawRuleBadge(ctx, check, ruleNumber, x, y, width, height, minOpacity);

  // Draw source badge
  drawSourceBadge(ctx, check, x, y, width, height, minOpacity);

  // Draw message if requested
  if (includeMessage && check.description) {
    drawCheckMessage(ctx, check, check.description, x, y, width, height);
  }
}

// ============================================
// SECTION: ARROW AND ANNOTATION LABEL DRAWING
// ============================================

/**
 * Draw a polyline from an array of points. Stroke only, no fill.
 */
export function drawArrowPolyline(
  ctx: CanvasRenderingContext2DLike,
  points: Point[],
  color: string,
  lineWidth: number = 1.5
): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a small filled triangle arrowhead at the last point of the path,
 * pointing toward the highlight. Direction inferred from last two points.
 */
export function drawArrowhead(
  ctx: CanvasRenderingContext2DLike,
  points: Point[],
  size: number,
  color: string
): void {
  if (points.length < 2) return;

  const tip = points[points.length - 1];
  const prev = points[points.length - 2];

  // Angle from previous point toward tip
  const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x);

  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(
    tip.x - size * Math.cos(angle - Math.PI / 6),
    tip.y - size * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    tip.x - size * Math.cos(angle + Math.PI / 6),
    tip.y - size * Math.sin(angle + Math.PI / 6)
  );
  ctx.fill();
  ctx.restore();
}

/**
 * Draw wrapped text on canvas. Splits words and draws line by line.
 * Truncates with "..." at maxLines.
 */
export function drawWrappedText(
  ctx: CanvasRenderingContext2DLike,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  lineHeight: number = REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
  maxLines: number = REVDOKU_MARGIN_LABEL_MAX_LINES,
  fontFamily?: string
): void {
  ctx.save();
  ctx.font = `${fontSize}px ${fontFamily || 'Arial'}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const charWidth = fontSize * getCharWidthFactor(fontFamily as LabelFontFamily | undefined);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    const testWidth = ctx.measureText
      ? ctx.measureText(testLine).width
      : testLine.length * charWidth;

    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines) break;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  // Truncate if needed
  if (lines.length >= maxLines) {
    const remaining = words.slice(
      lines.join(' ').split(/\s+/).length
    ).join(' ');
    if (remaining) {
      lines[maxLines - 1] = lines[maxLines - 1].replace(/...$/, '') + '...';
    }
    lines.length = maxLines;
  }

  const lineHeightPx = fontSize * lineHeight;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * lineHeightPx);
  }

  ctx.restore();
}

/** When false, labels show only the leader-connecting edge (Apple-style bracket); true = full rectangle border */
export const REVDOKU_LABEL_DRAW_FULL_RECTANGLE = false;

/**
 * Draw label border — either full rounded rectangle or just the leader-facing edge.
 * Controlled by REVDOKU_LABEL_DRAW_FULL_RECTANGLE constant.
 */
export function drawLabelBorder(
  ctx: CanvasRenderingContext2DLike,
  x: number, y: number,
  width: number, height: number,
  borderColor: string,
  borderWidth: number = 1.5,
  side: PlacementSide = PlacementSide.RIGHT,
): void {
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  if (REVDOKU_LABEL_DRAW_FULL_RECTANGLE) {
    ctx.beginPath();
    drawRoundedRect(ctx, x, y, width, height, 3);
    ctx.stroke();
  } else {
    // Apple-style: draw only the border edge that faces the highlight
    const mainBorder = getMainBorderForSide(side);
    ctx.beginPath();
    switch (mainBorder) {
      case 'right':  // LEFT side label → border on right edge
        ctx.moveTo(x + width, y);
        ctx.lineTo(x + width, y + height);
        break;
      case 'bottom': // TOP side label → border on bottom edge
        ctx.moveTo(x, y + height);
        ctx.lineTo(x + width, y + height);
        break;
      case 'top':    // BOTTOM side label → border on top edge
        ctx.moveTo(x, y);
        ctx.lineTo(x + width, y);
        break;
      default:       // RIGHT/INSIDE side label → border on left edge
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + height);
        break;
    }
    ctx.stroke();
  }
}

/**
 * Draw an annotation label: white filled rect with colored border and wrapped colored text.
 */
export function drawAnnotationLabel(
  ctx: CanvasRenderingContext2DLike,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  borderColor: string,
  config: MarginLabelConfig,
  textColor?: string,
  fontFamily?: string
): void {
  ctx.save();

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  drawRoundedRect(ctx, x, y, width, height, 3);
  ctx.fill();

  // Border (full rect or leader-edge only, controlled by REVDOKU_LABEL_DRAW_FULL_RECTANGLE)
  drawLabelBorder(ctx, x, y, width, height, borderColor);

  // Colored text
  ctx.fillStyle = textColor || borderColor;
  const textX = x + (config.labelInnerPadding ?? REVDOKU_MARGIN_LABEL_INNER_PADDING);
  const textY = y + (config.labelInnerPadding ?? REVDOKU_MARGIN_LABEL_INNER_PADDING);
  const textMaxWidth = width - (config.labelInnerPadding ?? REVDOKU_MARGIN_LABEL_INNER_PADDING) * 2;

  drawWrappedText(
    ctx,
    text,
    textX,
    textY,
    textMaxWidth,
    config.labelFontSize,
    config.labelLineHeight ?? REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
    config.maxLines ?? REVDOKU_MARGIN_LABEL_MAX_LINES,
    fontFamily
  );

  ctx.restore();
}

// ============================================
// SECTION: LEADER LINE DRAWING (v13.5)
// ============================================

/** Minimum arrowhead arm length in px */
export const REVDOKU_LEADER_ARROW_MIN = 10;
/** Maximum arrowhead arm length in px */
export const REVDOKU_LEADER_ARROW_MAX = 24;
/** Arrowhead = 15% of leader length */
export const REVDOKU_LEADER_ARROW_RATIO = 0.15;
/** Arrowhead half-angle in radians (~23 degrees) */
export const REVDOKU_LEADER_ARROW_ANGLE = 0.4;
/** Leader line width */
export const REVDOKU_LEADER_LINE_WIDTH_V2 = 3;
/** Leader line opacity */
export const REVDOKU_LEADER_OPACITY = 0.7;
/** Opacity for val=… display text in labels */
export const REVDOKU_VAL_DISPLAY_OPACITY = 0.75;
/** Font scale for val=… display relative to label font size */
export const REVDOKU_VAL_DISPLAY_FONT_SCALE = 0.82;
/** Format the val display string: "val=<value>" */
export function formatValDisplay(val: string): string {
  return `val=${val}`;
}
/** Dash pattern for margin leaders */
export const REVDOKU_LEADER_DASH_PATTERN = [5, 3];
/** Arrow tip inset: pull back from highlight edge to avoid bleeding inside */
export const REVDOKU_LEADER_ARROW_INSET = 3;

/** Compute arrowhead size from leader length, clamped to [ARROW_MIN, ARROW_MAX] */
function leaderArrowSize(leaderLength: number): number {
  return Math.max(REVDOKU_LEADER_ARROW_MIN, Math.min(REVDOKU_LEADER_ARROW_MAX, leaderLength * REVDOKU_LEADER_ARROW_RATIO));
}

/** Draw an open V-shape arrowhead (stroke, not filled) at a tip pointing in direction `angle` */
function drawLeaderArrowhead(
  ctx: CanvasRenderingContext2DLike,
  tipX: number, tipY: number,
  angle: number, size: number
): void {
  const prevWidth = ctx.lineWidth;
  ctx.lineWidth = Math.max(2, prevWidth + 0.5);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - size * Math.cos(angle - REVDOKU_LEADER_ARROW_ANGLE),
    tipY - size * Math.sin(angle - REVDOKU_LEADER_ARROW_ANGLE)
  );
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - size * Math.cos(angle + REVDOKU_LEADER_ARROW_ANGLE),
    tipY - size * Math.sin(angle + REVDOKU_LEADER_ARROW_ANGLE)
  );
  ctx.stroke();
  ctx.lineWidth = prevWidth;
}

/**
 * Draw a single leader of any type. Uses computeLeaderRenderPath for geometry
 * and rp.dashed to decide solid vs dashed stroke.
 */
export function drawLeader(
  ctx: CanvasRenderingContext2DLike,
  leader: Leader,
  color: string
): void {
  const rp = computeLeaderRenderPath(leader);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = REVDOKU_LEADER_LINE_WIDTH_V2;
  ctx.globalAlpha = REVDOKU_LEADER_OPACITY;

  if (rp.dashed && ctx.setLineDash) ctx.setLineDash(REVDOKU_LEADER_DASH_PATTERN);
  ctx.beginPath();
  ctx.moveTo(rp.pathPoints[0].x, rp.pathPoints[0].y);
  for (let i = 1; i < rp.pathPoints.length; i++) ctx.lineTo(rp.pathPoints[i].x, rp.pathPoints[i].y);
  ctx.stroke();
  if (rp.dashed && ctx.setLineDash) ctx.setLineDash([]);

  // Endpoint: filled circle dot or V-arrowhead
  if (rp.circlePoint) {
    ctx.beginPath();
    ctx.arc(rp.circlePoint.x, rp.circlePoint.y, rp.circlePoint.radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  } else if (rp.arrowPoints.length >= 3) {
    const prevWidth = ctx.lineWidth;
    ctx.lineWidth = Math.max(2, prevWidth + 0.5);
    ctx.beginPath();
    ctx.moveTo(rp.arrowPoints[1].x, rp.arrowPoints[1].y);
    ctx.lineTo(rp.arrowPoints[0].x, rp.arrowPoints[0].y);
    ctx.moveTo(rp.arrowPoints[1].x, rp.arrowPoints[1].y);
    ctx.lineTo(rp.arrowPoints[2].x, rp.arrowPoints[2].y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw an inline leader line (backward-compat wrapper).
 */
export function drawInlineLeader(
  ctx: CanvasRenderingContext2DLike,
  leader: InlineLeader,
  color: string
): void {
  drawLeader(ctx, leader, color);
}

/**
 * Draw a margin leader line (backward-compat wrapper).
 */
export function drawMarginLeader(
  ctx: CanvasRenderingContext2DLike,
  leader: MarginLeader,
  color: string
): void {
  drawLeader(ctx, leader, color);
}

/**
 * Draw all leader lines.
 *
 * @param ctx - Canvas rendering context
 * @param leaders - Array from computeAllLeaders()
 * @param colorFn - Function returning CSS color for each highlight index
 */
export function drawAllLeaders(
  ctx: CanvasRenderingContext2DLike,
  leaders: Leader[],
  colorFn: (hlIdx: number) => string
): void {
  for (const leader of leaders) {
    drawLeader(ctx, leader, colorFn(leader.hlIdx));
  }
}

/**
 * Draw a filled circle badge with white number text (for annotation labels).
 * @param ctx      Canvas context
 * @param text     Badge text (check number)
 * @param centerX  Circle center X
 * @param centerY  Circle center Y
 * @param spec     Badge spec from calculateLabelBadgeSpec()
 * @param bgColor  Fill color (status color: green/red)
 */
export function drawLabelBadge(
  ctx: CanvasRenderingContext2DLike,
  text: string,
  centerX: number,
  centerY: number,
  spec: LabelBadgeSpec,
  bgColor: string,
  fontFamily?: string,
): void {
  ctx.save();

  // Filled circle with status color
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.arc(centerX, centerY, spec.radius, 0, Math.PI * 2);
  ctx.fill();

  // White number text centered
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${spec.fontSize}px ${fontFamily || 'Arial'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, centerX, centerY);

  ctx.restore();
}

/** Icon type for check labels: recheck (↻) or changes (⇄) */
export type CheckIconType = 'recheck' | 'changes' | null;

/**
 * Draw a RefreshCcw-style icon (two opposing circular arrows) representing a re-verification check.
 * Drawn as two ~150° arcs with arrowheads, matching the Lucide RefreshCcw icon.
 * Uses only basic CanvasRenderingContext2DLike methods (no translate/scale).
 */
export function drawRecheckIcon(
  ctx: CanvasRenderingContext2DLike,
  centerX: number,
  centerY: number,
  size: number,
  color: string,
): void {
  ctx.save();

  // Matches RotateCcw SVG (REVDOKU_RECHECK_ICON_SVG_PATHS):
  // <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
  // <path d="M3 3v5h5"/>
  // Drawn in a 24x24 coordinate system scaled to `size`.
  const s = size / 24;
  const ox = centerX - size / 2;
  const oy = centerY - size / 2;
  const lineWidth = Math.max(1.5, 2.5 * s);
  const r = 9 * s; // arc radius

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';

  // Nearly-full circle arc: center (12,12), radius 9
  // SVG "a9 9 0 1 0 9-9" from (3,12) draws counterclockwise almost full circle
  // ending at (12,3). Then a smaller curve to (5.26, 5.74), line to (3,8).
  // We approximate as: arc from ~top going clockwise almost all the way around,
  // leaving a gap at top-left where the arrowhead is.
  ctx.beginPath();
  // Start near top-left (where the arrow gap is) at ~160° and go clockwise
  // almost all the way to ~110° (leaving a visible gap for the arrowhead)
  const gapAngle = Math.PI * 0.28; // size of the gap
  const startAngle = -Math.PI / 2 - gapAngle; // ~-118° (top-left)
  const endAngle = startAngle + Math.PI * 2 - gapAngle * 2; // almost full circle
  ctx.arc(ox + 12 * s, oy + 12 * s, r, startAngle, endAngle);
  ctx.stroke();

  // Curved tail from arc end toward arrowhead point (3, 8)
  // The SVG has a smaller arc (r=9.75) from (12,3) through (5.26,5.74) to (3,8)
  ctx.beginPath();
  const arcEndX = ox + 12 * s + r * Math.cos(startAngle);
  const arcEndY = oy + 12 * s + r * Math.sin(startAngle);
  ctx.moveTo(arcEndX, arcEndY);
  ctx.quadraticCurveTo(ox + 4.5 * s, oy + 4 * s, ox + 3 * s, oy + 8 * s);
  ctx.stroke();

  // L-shaped arrowhead: (3,3) → (3,8) → (8,8)
  ctx.beginPath();
  ctx.moveTo(ox + 3 * s, oy + 3 * s);
  ctx.lineTo(ox + 3 * s, oy + 8 * s);
  ctx.lineTo(ox + 8 * s, oy + 8 * s);
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw a bidirectional arrow icon (⇄) representing cross-revision changes.
 * Drawn as two horizontal arrows pointing in opposite directions.
 * Uses only basic CanvasRenderingContext2DLike methods (no translate/scale).
 */
export function drawChangesIcon(
  ctx: CanvasRenderingContext2DLike,
  centerX: number,
  centerY: number,
  size: number,
  color: string,
): void {
  ctx.save();

  // Matches the SVG arrow-left-right icon (REVDOKU_CHANGES_ICON_SVG_PATHS):
  // Two horizontal arrows — top pointing left, bottom pointing right.
  // Drawn in a 24x24 coordinate system scaled to `size`.
  const s = size / 24;
  const ox = centerX - size / 2;
  const oy = centerY - size / 2;
  const lineWidth = Math.max(1.5, 2.5 * s);

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';

  // Top-left arrowhead: "M8 3 4 7l4 4" → (8,3) → (4,7) → (8,11)
  ctx.beginPath();
  ctx.moveTo(ox + 8 * s, oy + 3 * s);
  ctx.lineTo(ox + 4 * s, oy + 7 * s);
  ctx.lineTo(ox + 8 * s, oy + 11 * s);
  ctx.stroke();

  // Top horizontal line: "M4 7h16" → (4,7) → (20,7)
  ctx.beginPath();
  ctx.moveTo(ox + 4 * s, oy + 7 * s);
  ctx.lineTo(ox + 20 * s, oy + 7 * s);
  ctx.stroke();

  // Bottom-right arrowhead: "m16 21 4-4-4-4" → (16,13) → (20,17) → (16,21)
  ctx.beginPath();
  ctx.moveTo(ox + 16 * s, oy + 13 * s);
  ctx.lineTo(ox + 20 * s, oy + 17 * s);
  ctx.lineTo(ox + 16 * s, oy + 21 * s);
  ctx.stroke();

  // Bottom horizontal line: "M20 17H4" → (20,17) → (4,17)
  ctx.beginPath();
  ctx.moveTo(ox + 20 * s, oy + 17 * s);
  ctx.lineTo(ox + 4 * s, oy + 17 * s);
  ctx.stroke();

  ctx.restore();
}
