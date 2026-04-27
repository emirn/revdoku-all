/**
 * Config-driven grid modes — centralized settings for all grid mode behavior.
 *
 * Each EGridMode has a single IGridModeConfig that drives:
 *  - Canvas expansion (margins)
 *  - Page label rendering
 *  - Axis arrows (AXIS mode)
 *  - Ruler drawing (RULERS_* modes)
 *  - Grid overlay lines
 *  - Coordinate math (what dimensions the AI sees)
 */
import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D } from 'canvas';
import { EGridMode } from '../schemas/common-server';
import { calculateGridLayout } from './image-utils';

// ────────────────────────────── Interfaces ──────────────────────────────

export interface IPageLabelStyle {
  fontSizeRatio: number;   // fontSize = max(minFontSize, floor(contentHeight * ratio))
  minFontSize: number;
  color: string;           // text color
  bgColor: string;         // semi-transparent background
  padX: number;
  padY: number;
  offsetFromEdge: number;  // pixels from content edge
}

export interface IGridModeConfig {
  mode: EGridMode;

  /** Canvas expansion (pixels added around content) */
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  /**
   * Dynamic margin computation (for ruler modes where size depends on image dims).
   * If set, overrides the fixed margins above. Called with (imgWidth, imgHeight, aiCoordScale).
   */
  computeMargins?: (imgWidth: number, imgHeight: number, aiCoordScale?: number) => IGridModeConfig['margins'];

  /** Page label overlay */
  pageLabel: {
    enabled: boolean;
    format: 'bracket';         // [P1], [P2]
    position: 'bottom-right' | 'top-right' | 'top-left' | 'bottom-left';
    style: IPageLabelStyle;
  };

  /** Axis arrows (AXIS mode only) */
  axisArrows: {
    enabled: boolean;
    color: string;
    originLabel: boolean;
    xArrowLengthRatio: number;
    yArrowLengthRatio: number;
  };

  /** Rulers (RULERS_EXTERNAL* and OVERLAY_WITH_RULERS) */
  rulers: {
    enabled: boolean;
    fontFamily: string;
    cornerBadges: boolean;
  };

  /** Grid lines on content */
  gridOverlay: {
    enabled: boolean;
    color: string;
    lineWidth: number;
    /** Labeled lines every N% (e.g., 10 → labels at 0, 100, 200, ..., 1000) */
    labelStep: number;
    /** All grid lines every N% (e.g., 5 → lines at 0, 50, 100, ..., 1000) */
    lineStep: number;
    /** Color for unlabeled subdivision lines (lighter than main) */
    subdivisionColor?: string;
    /** Line width for subdivision lines */
    subdivisionLineWidth?: number;
  };

  /**
   * Whether AI sees expanded canvas (margins included) or content-only dimensions.
   * When true, reported dimensions to AI include margins; coordinate reverse-mapping
   * subtracts margins to get back to content space.
   */
  aiSeesMargins: boolean;

  /** Whether to crop white margins before sending to AI (content focus) */
  cropMargins: boolean;

  /** Whether grid labels are drawn ON the content image (vs in external ruler margins).
   *  When true, margin cropping computes minimum padding to keep label space clear. */
  labelsOnContent: boolean;

  /** How to adjust AI highlights relative to detected content boxes.
   *  'crop' = shrink to intersection, 'wrap' = expand to content boundaries (capped at 2x), 'none' = no adjustment. */
  contentBoxSnapping: 'none' | 'crop' | 'wrap';
}

// ────────────────────────────── Constants ──────────────────────────────

const DEFAULT_LABEL_STYLE: IPageLabelStyle = {
  fontSizeRatio: 0.03,
  minFontSize: 18,
  color: 'rgba(0, 0, 0, 0.85)',
  bgColor: 'rgba(255, 255, 255, 0.75)',
  padX: 8,
  padY: 4,
  offsetFromEdge: 6,
};

/** Overlay-grid page label style: small, greenish, tight to corner */
const OVERLAY_LABEL_STYLE: IPageLabelStyle = {
  fontSizeRatio: 0.02,
  minFontSize: 12,
  color: 'rgba(0, 180, 0, 0.9)',
  bgColor: 'rgba(255, 255, 255, 0.6)',
  padX: 3,
  padY: 2,
  offsetFromEdge: 2,
};

/** Helper: compute ruler-based margins from image dimensions */
function rulerMargins(imgWidth: number, imgHeight: number, aiCoordScale: number = 0): IGridModeConfig['margins'] {
  const layout = calculateGridLayout(EGridMode.RULERS_EXTERNAL, imgWidth, imgHeight, aiCoordScale);
  return {
    top: layout.rulerSize + layout.badgeMarginTop,
    right: layout.rulerSize + layout.badgeMarginRight,
    bottom: layout.rulerSize + layout.badgeMarginBottom,
    left: layout.rulerSize + layout.badgeMarginLeft,
  };
}

// ────────────────────────────── Per-Mode Configs ──────────────────────────────

export const GRID_MODE_CONFIGS: Record<EGridMode, IGridModeConfig> = {
  [EGridMode.NONE]: {
    mode: EGridMode.NONE,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    pageLabel: { enabled: false, format: 'bracket', position: 'bottom-right', style: DEFAULT_LABEL_STYLE },
    axisArrows: { enabled: false, color: '', originLabel: false, xArrowLengthRatio: 0, yArrowLengthRatio: 0 },
    rulers: { enabled: false, fontFamily: '', cornerBadges: false },
    gridOverlay: { enabled: false, color: '', lineWidth: 0, labelStep: 10, lineStep: 10 },
    aiSeesMargins: false,
    cropMargins: true,
    labelsOnContent: false,
    contentBoxSnapping: 'crop',
  },

  [EGridMode.AXIS]: {
    mode: EGridMode.AXIS,
    margins: { top: 25, right: 15, bottom: 15, left: 25 },
    pageLabel: { enabled: false, format: 'bracket', position: 'top-left', style: DEFAULT_LABEL_STYLE },
    axisArrows: { enabled: true, color: '#00AA44', originLabel: true, xArrowLengthRatio: 0.6, yArrowLengthRatio: 0.6 },
    rulers: { enabled: false, fontFamily: '', cornerBadges: false },
    gridOverlay: { enabled: false, color: '', lineWidth: 0, labelStep: 10, lineStep: 10 },
    aiSeesMargins: true,
    cropMargins: true,
    labelsOnContent: false,
    contentBoxSnapping: 'crop',
  },

  [EGridMode.OVERLAY_GRID_10]: {
    mode: EGridMode.OVERLAY_GRID_10,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    pageLabel: { enabled: true, format: 'bracket', position: 'bottom-right', style: OVERLAY_LABEL_STYLE },
    axisArrows: { enabled: false, color: '', originLabel: false, xArrowLengthRatio: 0, yArrowLengthRatio: 0 },
    rulers: { enabled: false, fontFamily: '', cornerBadges: false },
    gridOverlay: { enabled: true, color: 'rgba(0, 255, 0, 0.7)', lineWidth: 1, labelStep: 10, lineStep: 10 },
    aiSeesMargins: false,
    cropMargins: true,
    labelsOnContent: true,
    contentBoxSnapping: 'crop',
  },

  [EGridMode.OVERLAY_GRID_5]: {
    mode: EGridMode.OVERLAY_GRID_5,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    pageLabel: { enabled: true, format: 'bracket', position: 'bottom-right', style: OVERLAY_LABEL_STYLE },
    axisArrows: { enabled: false, color: '', originLabel: false, xArrowLengthRatio: 0, yArrowLengthRatio: 0 },
    rulers: { enabled: false, fontFamily: '', cornerBadges: false },
    gridOverlay: {
      enabled: true, color: 'rgba(0, 255, 0, 0.7)', lineWidth: 1, labelStep: 10, lineStep: 5,
      subdivisionColor: 'rgba(0, 255, 0, 0.35)', subdivisionLineWidth: 0.5,
    },
    aiSeesMargins: false,
    cropMargins: true,
    labelsOnContent: true,
    contentBoxSnapping: 'wrap',
  },

  [EGridMode.OVERLAY_GRID_2_5]: {
    mode: EGridMode.OVERLAY_GRID_2_5,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    pageLabel: { enabled: true, format: 'bracket', position: 'bottom-right', style: OVERLAY_LABEL_STYLE },
    axisArrows: { enabled: false, color: '', originLabel: false, xArrowLengthRatio: 0, yArrowLengthRatio: 0 },
    rulers: { enabled: false, fontFamily: '', cornerBadges: false },
    gridOverlay: {
      enabled: true, color: 'rgba(0, 255, 0, 0.35)', lineWidth: 0.5, labelStep: 10, lineStep: 2.5,
      subdivisionColor: 'rgba(0, 255, 0, 0.15)', subdivisionLineWidth: 0.5,
    },
    aiSeesMargins: false,
    cropMargins: true,
    labelsOnContent: true,
    contentBoxSnapping: 'crop',
  },

  [EGridMode.RULERS_EXTERNAL]: {
    mode: EGridMode.RULERS_EXTERNAL,
    margins: { top: 0, right: 0, bottom: 0, left: 0 }, // overridden by computeMargins
    computeMargins: rulerMargins,
    pageLabel: { enabled: true, format: 'bracket', position: 'bottom-right', style: DEFAULT_LABEL_STYLE },
    axisArrows: { enabled: false, color: '', originLabel: false, xArrowLengthRatio: 0, yArrowLengthRatio: 0 },
    rulers: { enabled: true, fontFamily: 'monospace', cornerBadges: true },
    gridOverlay: { enabled: false, color: '', lineWidth: 0, labelStep: 10, lineStep: 10 },
    aiSeesMargins: false,
    cropMargins: true,
    labelsOnContent: false,
    contentBoxSnapping: 'crop',
  },

  [EGridMode.RULERS_EXTERNAL_WITH_SUBTLE_GRID]: {
    mode: EGridMode.RULERS_EXTERNAL_WITH_SUBTLE_GRID,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    computeMargins: rulerMargins,
    pageLabel: { enabled: true, format: 'bracket', position: 'bottom-right', style: DEFAULT_LABEL_STYLE },
    axisArrows: { enabled: false, color: '', originLabel: false, xArrowLengthRatio: 0, yArrowLengthRatio: 0 },
    rulers: { enabled: true, fontFamily: 'monospace', cornerBadges: true },
    gridOverlay: { enabled: true, color: 'rgba(128, 128, 128, 0.15)', lineWidth: 0.5, labelStep: 10, lineStep: 10 },
    aiSeesMargins: false,
    cropMargins: true,
    labelsOnContent: false,
    contentBoxSnapping: 'crop',
  },

  [EGridMode.OVERLAY_WITH_RULERS]: {
    mode: EGridMode.OVERLAY_WITH_RULERS,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    computeMargins: rulerMargins,
    pageLabel: { enabled: true, format: 'bracket', position: 'bottom-right', style: DEFAULT_LABEL_STYLE },
    axisArrows: { enabled: false, color: '', originLabel: false, xArrowLengthRatio: 0, yArrowLengthRatio: 0 },
    rulers: { enabled: true, fontFamily: 'monospace', cornerBadges: true },
    gridOverlay: { enabled: true, color: 'rgba(0, 255, 0, 0.7)', lineWidth: 1, labelStep: 10, lineStep: 10 },
    aiSeesMargins: false,
    cropMargins: true,
    labelsOnContent: false,
    contentBoxSnapping: 'crop',
  },
};

// ────────────────────────────── Helpers ──────────────────────────────

/** Get the config for a grid mode. */
export function getGridModeConfig(mode: EGridMode): IGridModeConfig {
  return GRID_MODE_CONFIGS[mode] || GRID_MODE_CONFIGS[EGridMode.NONE];
}

/** Resolve effective margins for a mode, accounting for dynamic computation. */
export function resolveMargins(config: IGridModeConfig, imgWidth: number, imgHeight: number, aiCoordScale: number = 0): IGridModeConfig['margins'] {
  return config.computeMargins
    ? config.computeMargins(imgWidth, imgHeight, aiCoordScale)
    : config.margins;
}

/**
 * Draw [PN] page label overlay on a canvas context.
 *
 * @param ctx       Canvas 2D context
 * @param pageNum   1-based page number
 * @param config    Grid mode config (uses pageLabel.style)
 * @param contentW  Content area width (pixels)
 * @param contentH  Content area height (pixels)
 * @param offsetX   X offset where content starts on the canvas (default 0)
 * @param offsetY   Y offset where content starts on the canvas (default 0)
 */
export function drawPageLabelOverlay(
  ctx: CanvasRenderingContext2D,
  pageNum: number,
  config: IGridModeConfig,
  contentW: number,
  contentH: number,
  offsetX: number = 0,
  offsetY: number = 0,
): void {
  if (!config.pageLabel.enabled) return;

  const s = config.pageLabel.style;
  const label = `[P${pageNum}]`;
  const fontSize = Math.max(s.minFontSize, Math.floor(contentH * s.fontSizeRatio));

  ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
  const metrics = ctx.measureText(label);
  const textW = metrics.width;
  const textH = fontSize;

  const boxW = textW + s.padX * 2;
  const boxH = textH + s.padY * 2;
  const pos = config.pageLabel.position;

  let boxX: number;
  let boxY: number;

  // Horizontal position
  if (pos === 'bottom-right' || pos === 'top-right') {
    boxX = offsetX + contentW - boxW - s.offsetFromEdge;
  } else {
    boxX = offsetX + s.offsetFromEdge;
  }

  // Vertical position
  if (pos === 'bottom-right' || pos === 'bottom-left') {
    boxY = offsetY + contentH - boxH - s.offsetFromEdge;
  } else {
    // Top positions: place in margin area above content, clamp to canvas top
    const idealY = offsetY - boxH - s.offsetFromEdge;
    boxY = Math.max(0, idealY);
  }

  // Background
  ctx.fillStyle = s.bgColor;
  ctx.fillRect(boxX, boxY, boxW, boxH);

  // Text
  ctx.fillStyle = s.color;
  ctx.fillText(label, boxX + s.padX, boxY + s.padY + textH * 0.85);
}
