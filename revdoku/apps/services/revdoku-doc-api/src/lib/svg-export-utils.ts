/**
 * SVG-based report export renderer.
 *
 * Replaces the canvas-based createImagesWithHighlights() for HTML report exports.
 * Runs the same placement pipeline (placeCheckLabels + autoRepositionLabels +
 * computeStraightConnectionLine) but emits static SVG markup per page instead
 * of rasterised PNGs.
 *
 * Zero client-side JavaScript — the exported HTML contains only final SVG markup.
 */

import sharp from 'sharp';
import {
  IReport,
  ICheck,
  ICoordinates,
  CheckSource,
  MessageBoxMode,
  LabelFontFamily,
  CheckFilterType,
  PlacementSide,
  HighlightMode,
  getColorsForCheckResult,
  getWidth,
  getHeight,
  getMinOpacityForImageSize,
  getFontFamilyCss,
  computeStraightConnectionLine,
  getConnectionLineEndpoint,
  getHighlightModeConfig,
  autoRepositionLabels,
  REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS,
  AutoRepositionStep,
  computeLabelMetrics,
  estimateWrappedLabelDimensions,
  calculateLabelBadgeSpec,
  getCheckTypes,
  getCheckIconType,
  getCheckDataTypeLabels,
  REVDOKU_ANNOTATION_MARGIN,
  REVDOKU_ANNOTATION_MARGIN_SCALE_EXPONENT,
  REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
  REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING,
  REVDOKU_MARGIN_LABEL_VERTICAL_GAP,
  REVDOKU_LAYOUT_LABEL_MAX_LINES,
  formatValDisplay,
  REVDOKU_CHECK_ICON_SIZE_SCALE,
  REVDOKU_CHECK_ICON_GAP,
  REVDOKU_LABEL_BADGE_GAP,
  REVDOKU_TYPE_BADGE_FONT_SCALE,
  REVDOKU_TYPE_BADGE_GAP,
  REVDOKU_ICON_COLOR_CHANGES,
  REVDOKU_ICON_COLOR_RECHECK,
  REVDOKU_CATCH_CHANGES_RULE_ID,
  // Shared SVG drawing primitives (also used by frontend HighlightOverlay)
  svgR as r,
  svgEsc as esc,
  svgHighlight,
  svgSourceBadge,
  svgLeaderLine,
  svgBadge,
  svgRecheckIcon,
  svgChangesIcon,
  svgTypeBadge,
  svgLabelBox,
  svgFormatLabelHtml,
  REVDOKU_LABEL_BORDER_WIDTH,
  REVDOKU_LABEL_BORDER_RADIUS,
} from '@revdoku/lib';
import type { TypeBadgePlacement } from '@revdoku/lib';
import type {
  HintPlacementInput,
  HintPlacementResultExtended,
  IContentBox,
  BoundingBox,
} from '@revdoku/lib';
import { IPageInfoExtended } from '../schemas/common-server';
import { docToContentPixel } from './coordinate-utils';
import { placeCheckLabels, type PlaceCheckLabelsOptions } from './place-check-labels';
import { placeCompactBadges } from './compact-badge-placer';
import { cropWhiteMargins } from './image-utils';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Classify a check for client-side filtering. */
function getCheckFilterType(check: ICheck): string {
  if (check.rule_id === REVDOKU_CATCH_CHANGES_RULE_ID) return 'changes';
  if (check.description?.startsWith('#recheck ')) return 'recheck';
  return check.passed ? 'passed' : 'failed';
}

/** Strip #recheck tag; append val= hint. */
function fmtDesc(desc: string | undefined | null, data?: { val?: string } | null): string {
  if (!desc) return '';
  let text = desc;
  if (text.startsWith('#recheck ')) text = text.slice('#recheck '.length);
  if (data?.val) text += ` ${formatValDisplay(data.val)}`;
  return text;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produces an array of SVG markup strings, one per page.
 * Empty string for pages that were excluded (matches createImagesWithHighlights semantics).
 */
export async function createSvgPagesForExport(
  pages: IPageInfoExtended[],
  inspectionReport: IReport,
  check_filter: string,
  exclude_pages_without_highlights: boolean,
  max_width: number = 800,
  show_hints: boolean = false,
  crop_margins: boolean = false,
  message_box_mode: MessageBoxMode = 'none',
  skip_annotations: boolean = false,
  font_scale_override: number = 1.0,
  font_family_override?: LabelFontFamily,
  highlight_mode_override?: number,
  align_labels_to_top: boolean = false,
  show_source_badge: boolean = false,
): Promise<string[]> {
  const results: string[] = [];

  // Collect filtered checks ---------------------------------------------------
  const checkFilterFn = (check: ICheck): boolean => {
    switch (check_filter) {
      case 'all': return true;
      case 'passed': return !!check.passed;
      case 'changes': return check.rule_id === REVDOKU_CATCH_CHANGES_RULE_ID;
      case 'rechecks': return !!check.description?.startsWith('#recheck ');
      case 'failed_only': return !check.passed && check.rule_id !== REVDOKU_CATCH_CHANGES_RULE_ID;
      default: return !check.passed;
    }
  };
  const allChecks = inspectionReport.checks.filter(checkFilterFn);

  // Per-page loop -------------------------------------------------------------
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pageHighlights = allChecks.filter(c => c.page === pageIndex);

    // Skip pages without highlights when requested
    if (exclude_pages_without_highlights && pageHighlights.length === 0) {
      results.push('');
      continue;
    }

    // Decode page image via sharp ----------------------------------------------
    const pageInfo = pages[pageIndex];
    const rawBuf = Buffer.from(pageInfo.pageAsImage, 'base64');
    const meta = await sharp(rawBuf).metadata();
    const imgW = meta.width || 1;
    const imgH = meta.height || 1;

    // Resize to max_width — chain resize + crop into a single sharp pipeline
    // where possible to avoid intermediate buffer allocations.
    const scaleFactor = imgW > max_width ? max_width / imgW : 1;
    const newWidth = Math.floor(imgW * scaleFactor);
    const newHeight = Math.floor(imgH * scaleFactor);

    const shouldCrop = crop_margins && (skip_annotations || pageHighlights.length === 0);
    const hasBbox = shouldCrop && pageInfo.content_bounding_box;

    // Compute bbox-based extract parameters upfront so we can chain them
    let extractOpts: { left: number; top: number; width: number; height: number } | null = null;
    if (hasBbox) {
      const bbox = pageInfo.content_bounding_box!;
      const bboxScale = newWidth / pageInfo.original_width;
      const pad = 10;
      const trimX = Math.max(0, Math.floor(bbox.x1 * bboxScale) - pad);
      const trimY = Math.max(0, Math.floor(bbox.y1 * bboxScale) - pad);
      const trimW = Math.min(newWidth, Math.ceil(bbox.x2 * bboxScale) + pad) - trimX;
      const trimH = Math.min(newHeight, Math.ceil(bbox.y2 * bboxScale) + pad) - trimY;
      if (trimW > 0 && trimH > 0 && (trimW < newWidth - 2 || trimH < newHeight - 2)) {
        extractOpts = { left: trimX, top: trimY, width: trimW, height: trimH };
      }
    }

    // Build a single sharp pipeline: resize → optional extract → png
    let pipeline = sharp(rawBuf);
    if (scaleFactor < 1) pipeline = pipeline.resize(newWidth, newHeight);
    if (extractOpts) pipeline = pipeline.extract(extractOpts);
    let imageBuffer = await pipeline.png().toBuffer();

    // Fallback: content-aware white margin crop (can't be chained — needs pixel analysis)
    if (shouldCrop && !hasBbox && !extractOpts) {
      imageBuffer = await cropWhiteMargins(imageBuffer);
    }

    const finalMeta = await sharp(imageBuffer).metadata();
    const finalW = finalMeta.width || newWidth;
    const finalH = finalMeta.height || newHeight;
    const imageBase64 = imageBuffer.toString('base64');

    // If no highlights or annotations skipped, emit plain SVG with just the image
    if (skip_annotations || pageHighlights.length === 0) {
      results.push(buildPlainSvg(imageBase64, finalW, finalH));
      continue;
    }

    // ------- Placement pipeline (mirrors image-utils.ts logic) --------

    const sf = pageInfo.scaling_factor || 1;
    const cropOffX = pageInfo.crop_offset_x || 0;
    const cropOffY = pageInfo.crop_offset_y || 0;
    const canvasScale = newWidth / imgW; // uniform scale: source image → resized
    const mapX = (ox: number) => docToContentPixel(ox, cropOffX, sf) * canvasScale;
    const mapY = (oy: number) => docToContentPixel(oy, cropOffY, sf) * canvasScale;
    const sizeScale = sf * canvasScale;
    const fontSizeScale = canvasScale;

    const DEFAULT_FONT_SCALE = 1.0;
    const userFontScale = Math.min(
      3.0,
      (inspectionReport.page_font_scales?.[String(pageIndex)]
        ?? inspectionReport.label_font_scale
        ?? DEFAULT_FONT_SCALE) * font_scale_override,
    );
    const labelFontFamily = getFontFamilyCss(
      (font_family_override || inspectionReport.font_family) as LabelFontFamily | undefined,
      'browser',
    );

    const isCompactMode = message_box_mode === 'numbers_message_box_only';

    // Margin width
    const scaledMargin = Math.round(REVDOKU_ANNOTATION_MARGIN * Math.pow(userFontScale, REVDOKU_ANNOTATION_MARGIN_SCALE_EXPONENT));
    const maxMarginWidth = Math.round(newWidth * 0.4);
    const effectiveMarginWidth = isCompactMode ? 0 : Math.min(scaledMargin, maxMarginWidth);

    // All checks with valid coords on this page
    const allPageChecks = inspectionReport.checks.filter(
      c => c.page === pageIndex && c.x1 != null && c.y1 != null && c.x2 != null && c.y2 != null,
    );

    const renderedIds = new Set(pageHighlights.map(c => c.id));

    // ------- Compute placements --------
    let labelPlacements: HintPlacementResultExtended[] = [];

    if (show_hints && isCompactMode) {
      // Compact mode: badges at highlight corners
      const compactBadgeFontSize = Math.max(14, newHeight * 0.07) * userFontScale;
      const badgeSpec = calculateLabelBadgeSpec(compactBadgeFontSize);
      const checksToPlace = allPageChecks.filter(c => renderedIds.has(c.id));
      const compactHighlights = checksToPlace.map(c => {
        const coords = c as unknown as ICoordinates;
        return {
          id: c.id,
          x: mapX(coords.x1), y: mapY(coords.y1),
          width: getWidth(coords) * sizeScale, height: getHeight(coords) * sizeScale,
        };
      });
      const badgePlacements = placeCompactBadges(
        compactHighlights, badgeSpec.radius, newWidth, newHeight,
      );
      labelPlacements = badgePlacements.map(bp => ({
        id: bp.id,
        side: PlacementSide.INSIDE,
        labelBox: {
          x: bp.cx - badgeSpec.radius,
          y: bp.cy - badgeSpec.radius,
          width: badgeSpec.radius * 2,
          height: badgeSpec.radius * 2,
        },
        arrowPath: [],
      } as HintPlacementResultExtended));
    } else if (show_hints) {
      // Full mode — use placeCheckLabels
      const contentBoxes: IContentBox[] = (pageInfo.content_boxes || []).map(cb => ({
        x1: mapX(cb.x1), y1: mapY(cb.y1), x2: mapX(cb.x2), y2: mapY(cb.y2),
      }));

      const hintInputs: HintPlacementInput[] = allPageChecks
        .filter(c => renderedIds.has(c.id))
        .map(check => {
          const coords = check as unknown as ICoordinates;
          return {
            id: check.id,
            x: mapX(coords.x1), y: mapY(coords.y1),
            width: getWidth(coords) * sizeScale,
            height: getHeight(coords) * sizeScale,
            description: fmtDesc(check.description, check.data),
            ruleOrder: check.rule_order ?? 0,
            passed: check.passed,
          };
        });

      const placementOpts: PlaceCheckLabelsOptions = {
        contentBoxes,
        marginWidth: effectiveMarginWidth,
        labelFontScale: userFontScale * sizeScale,
        fontFamily: inspectionReport.font_family as LabelFontFamily | undefined,
      };

      labelPlacements = hintInputs.length > 0
        ? placeCheckLabels(hintInputs, newWidth, newHeight, placementOpts) : [];

      // Filter to only rendered checks
      labelPlacements = labelPlacements.filter(p => renderedIds.has(p.id));

      // autoRepositionLabels for margin label quality
      const dm = computeLabelMetrics(0, userFontScale);
      const scaledGap = REVDOKU_MARGIN_LABEL_VERTICAL_GAP * fontSizeScale;
      // EXPORT_FONT_BOOST must match between placement and rendering so label
      // height estimates correspond to the actual rendered font size.
      const EXPORT_FONT_BOOST = 1.5;
      const effectiveFontSize = dm.fontSize * fontSizeScale * EXPORT_FONT_BOOST;
      const effectivePadding = dm.padding * fontSizeScale * EXPORT_FONT_BOOST;
      const viewerWidth = newWidth + 2 * effectiveMarginWidth;

      // Pre-set widths and heights for margin labels — account for badge/icon
      // indent so the text-wrapping height estimate matches actual rendering.
      const marginLabels = labelPlacements.filter(lp => lp.side !== PlacementSide.INSIDE);
      // Badge is 2em diameter + 0.25em margin in the HTML rendering
      const badgeIndent = effectiveFontSize * 2.25;
      const maxLabelWidth = effectiveMarginWidth - REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING * 2 * fontSizeScale;
      // Text area is narrower than the full label — badge/icon occupy badgeIndent
      const maxTextWidth = Math.max(10, maxLabelWidth - badgeIndent);
      for (const lp of marginLabels) {
        const check = pageHighlights.find(h => h.id === lp.id);
        const description = fmtDesc(check?.description, check?.data);
        const est = estimateWrappedLabelDimensions(
          description, maxTextWidth, effectiveFontSize,
          REVDOKU_MARGIN_LABEL_LINE_HEIGHT, effectivePadding,
          undefined,
          inspectionReport.font_family as LabelFontFamily | undefined,
        );
        lp.labelBox.width = maxLabelWidth;
        lp.labelBox.height = est.height;
      }

      const effectiveSteps = align_labels_to_top
        ? REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS.filter(s => s !== AutoRepositionStep.STEP_SPREAD_CLOSE_TO_HIGHLIGHTS)
        : REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS;

      autoRepositionLabels(labelPlacements, {
        page_width: newWidth,
        page_height: newHeight,
        gap: scaledGap,
        steps: effectiveSteps,
        constraint_ctx: {
          viewer_width: viewerWidth,
          viewer_height: newHeight,
          page_width: newWidth,
          page_height: newHeight,
          text_line_height: REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
        },
        resize_label: (id: string, targetWidth: number) => {
          const check = pageHighlights.find(h => h.id === id);
          if (!check) return { width: targetWidth, height: 30 };
          const description = fmtDesc(check.description, check.data);
          // Subtract badge indent — rendering uses narrower text area than full label width
          const textWidth = Math.max(10, targetWidth - badgeIndent);
          return estimateWrappedLabelDimensions(
            description, textWidth, effectiveFontSize,
            REVDOKU_MARGIN_LABEL_LINE_HEIGHT, effectivePadding,
            REVDOKU_LAYOUT_LABEL_MAX_LINES,
            inspectionReport.font_family as LabelFontFamily | undefined,
          );
        },
        get_passed: (id: string) => {
          const check = pageHighlights.find(h => h.id === id);
          return check?.passed;
        },
        get_highlight_center_y: (id: string) => {
          const check = pageHighlights.find(h => h.id === id);
          if (!check) return null;
          const coords = check as unknown as ICoordinates;
          return mapY(coords.y1) + (getHeight(coords) * sizeScale) / 2;
        },
        get_highlight_rect: (id: string) => {
          const check = pageHighlights.find(h => h.id === id);
          if (!check) return null;
          const coords = check as unknown as ICoordinates;
          return {
            x: mapX(coords.x1), y: mapY(coords.y1),
            width: getWidth(coords) * sizeScale, height: getHeight(coords) * sizeScale,
          };
        },
        get_check_types: (id: string) => {
          const check = pageHighlights.find(h => h.id === id);
          if (!check) return new Set();
          return getCheckTypes(check);
        },
        check_filter: check_filter as CheckFilterType,
      });

      // Compute leader lines
      for (const lp of labelPlacements) {
        const check = pageHighlights.find(h => h.id === lp.id);
        if (!check) continue;
        const coords = check as unknown as ICoordinates;
        const highlightBox: BoundingBox = {
          x: mapX(coords.x1), y: mapY(coords.y1),
          width: getWidth(coords) * sizeScale, height: getHeight(coords) * sizeScale,
        };
        const { start, end } = computeStraightConnectionLine(lp.labelBox, highlightBox, lp.side);
        const hmConfig = getHighlightModeConfig(highlight_mode_override);
        const effectiveEnd = getConnectionLineEndpoint(hmConfig.connectionMode, highlightBox, lp.labelBox) ?? end;
        lp.arrowPath = [start, effectiveEnd];
      }
    }

    // ------- Compute viewBox (extend for overflow) --------
    let minX = 0, minY = 0;
    let maxX = newWidth, maxY = newHeight;

    for (const check of pageHighlights) {
      const coords = check as unknown as ICoordinates;
      const hx = mapX(coords.x1), hy = mapY(coords.y1);
      const hw = getWidth(coords) * sizeScale, hh = getHeight(coords) * sizeScale;
      if (hx < minX) minX = hx;
      if (hy < minY) minY = hy;
      if (hx + hw > maxX) maxX = hx + hw;
      if (hy + hh > maxY) maxY = hy + hh;
    }
    for (const lp of labelPlacements) {
      const lx = lp.labelBox.x, ly = lp.labelBox.y;
      const lw = lp.labelBox.width, lh = lp.labelBox.height;
      if (lx < minX) minX = lx;
      if (ly < minY) minY = ly;
      if (lx + lw > maxX) maxX = lx + lw;
      if (ly + lh > maxY) maxY = ly + lh;
    }

    const pad = 5;
    const offsetX = minX < 0 ? Math.ceil(-minX) + pad : 0;
    const offsetY = minY < 0 ? Math.ceil(-minY) + pad : 0;
    const svgW = Math.ceil(maxX) + offsetX + pad;
    const svgH = Math.ceil(maxY) + offsetY + pad;

    // ------- Build SVG --------
    const svg: string[] = [];
    svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" style="display:block;width:${svgW}px;max-width:100%;height:auto;">`);

    // White background
    svg.push(`<rect x="0" y="0" width="${svgW}" height="${svgH}" fill="#ffffff"/>`);

    // Page image
    svg.push(`<image href="data:image/png;base64,${imageBase64}" x="${offsetX}" y="${offsetY}" width="${newWidth}" height="${newHeight}"/>`);

    // Per-check rendering: each check wrapped in <g> with data attributes for client-side filtering
    const EXPORT_FONT_BOOST = 1.5;
    const dmForLabels = computeLabelMetrics(0, userFontScale);
    const effectiveFontSize = dmForLabels.fontSize * fontSizeScale * EXPORT_FONT_BOOST;
    const effectivePadding = dmForLabels.padding * fontSizeScale * EXPORT_FONT_BOOST;
    const activeMode = highlight_mode_override ?? HighlightMode.RECTANGLE;
    const hlModeNames = ['rectangle', 'dot', 'underline', 'bracket'];

    for (const check of pageHighlights) {
      const coords = check as unknown as ICoordinates;
      const x = mapX(coords.x1) + offsetX;
      const y = mapY(coords.y1) + offsetY;
      const w = getWidth(coords) * sizeScale;
      const h = getHeight(coords) * sizeScale;
      const minOpacity = getMinOpacityForImageSize(newWidth, newHeight);
      const colors = getColorsForCheckResult(check, minOpacity);
      const filterType = getCheckFilterType(check);

      // Open per-check group with data attributes for client-side filtering + label repositioning
      const highlightCY = r(y + h / 2);
      svg.push(`<g data-check-id="${check.id}" data-check-passed="${!!check.passed}" data-check-filter-type="${filterType}" data-highlight-cy="${highlightCY}">`);

      // Render all 4 highlight modes — only the active one is visible
      for (let mode = 0; mode <= 3; mode++) {
        const isActive = mode === activeMode;
        const display = isActive ? '' : 'display:none;';
        const hlSvg = svgHighlight(x, y, w, h, colors.border_color, undefined, 1, mode);
        // Wrap in a group with class for client-side mode switching
        svg.push(`<g class="revdoku-hl revdoku-hl-${hlModeNames[mode]}" ${isActive ? '' : 'style="display:none"'}>${hlSvg}</g>`);
      }

      // Source badge (if enabled)
      if (show_source_badge) {
        const isManualCheck = check.source === CheckSource.USER;
        svg.push(svgSourceBadge(x, y, w, colors.border_color, isManualCheck));
      }

      // Leader line
      if (show_hints) {
        const lp = labelPlacements.find(p => p.id === check.id);
        if (lp?.arrowPath && lp.arrowPath.length >= 2) {
          const [start, end] = lp.arrowPath;
          const leaderSvg = svgLeaderLine(
            start.x + offsetX, start.y + offsetY,
            end.x + offsetX, end.y + offsetY,
            colors.border_color,
          );
          if (leaderSvg) svg.push(leaderSvg.replace('<line ', '<line class="revdoku-leader" ').replace('<circle ', '<circle class="revdoku-leader" '));
        }
      }

      // Label (badge + text)
      if (show_hints) {
        const lp = labelPlacements.find(p => p.id === check.id);
        if (lp) {
          const badgeNumber = check.check_index ?? ((check.rule_order ?? 0) + 1);
          const labelX = lp.labelBox.x + offsetX;
          const labelY = lp.labelBox.y + offsetY;

          if (isCompactMode) {
            const compactFontSize = Math.max(14, newHeight * 0.07) * userFontScale;
            const spec = calculateLabelBadgeSpec(compactFontSize);
            svg.push(svgBadge(labelX + spec.radius, labelY + spec.radius, spec.radius, spec.fontSize, colors.border_color, badgeNumber, labelFontFamily));
          } else {
            const badgeSpec = calculateLabelBadgeSpec(effectiveFontSize);
            const labelW = lp.labelBox.width;
            const labelH = lp.labelBox.height;
            const rawDesc = check.description ?? '';
            const description = fmtDesc(rawDesc, check.data);
            const isLeftSide = lp.side === PlacementSide.LEFT;

            // Label box background
            svg.push(`<rect class="revdoku-label-bg" data-base-height="${r(labelH)}" data-label-side="${isLeftSide ? 'left' : 'right'}" x="${r(labelX)}" y="${r(labelY)}" width="${r(labelW)}" height="${r(labelH)}" fill="rgba(255,255,255,0.95)"/>`);

            // Single-side border
            const labelBorderWidth = 2.5;
            if (isLeftSide) {
              const bx = labelX + labelW;
              svg.push(`<line class="revdoku-label-border" data-base-height="${r(labelH)}" x1="${r(bx)}" y1="${r(labelY)}" x2="${r(bx)}" y2="${r(labelY + labelH)}" stroke="${colors.border_color}" stroke-width="${labelBorderWidth}"/>`);
            } else {
              svg.push(`<line class="revdoku-label-border" data-base-height="${r(labelH)}" x1="${r(labelX)}" y1="${r(labelY)}" x2="${r(labelX)}" y2="${r(labelY + labelH)}" stroke="${colors.border_color}" stroke-width="${labelBorderWidth}"/>`);
            }

            if (description && message_box_mode === 'full') {
              // Badge as HTML span inside foreignObject — uses em units so it scales with the SVG viewBox.
              // CSS float makes text wrap around the badge (matching envelope view).
              const badgeFloat = isLeftSide ? 'right' : 'left';
              const badgeMarginSide = isLeftSide ? 'margin-left' : 'margin-right';
              // Badge size: 1.6em = slightly larger than one text line height
              const BADGE_EM_SIZE = '2';
              const BADGE_FONT_SCALE = '0.7'; // number font relative to parent font
              const badgeHtml = `<span style="` +
                `display:inline-flex;align-items:center;justify-content:center;` +
                `width:${BADGE_EM_SIZE}em;height:${BADGE_EM_SIZE}em;border-radius:50%;` +
                `background:${colors.border_color};color:#fff;` +
                `font-size:${BADGE_FONT_SCALE}em;font-weight:700;` +
                `float:${badgeFloat};${badgeMarginSide}:0.25em;` +
                `margin-top:0.05em;opacity:0.85;` +
                `line-height:1;flex-shrink:0;` +
                `">${badgeNumber}</span>`;

              const textAlign = isLeftSide ? 'right' : 'justify';
              const htmlContent = svgFormatLabelHtml(description, effectiveFontSize);

              svg.push(
                `<foreignObject class="revdoku-label-text" data-base-height="${r(labelH)}" x="${r(labelX)}" y="${r(labelY)}" width="${r(Math.max(10, labelW))}" height="${r(Math.max(10, labelH))}">` +
                `<div xmlns="http://www.w3.org/1999/xhtml" data-base-font-size="${r(effectiveFontSize)}" style="` +
                `font-family:${esc(labelFontFamily)};font-size:${r(effectiveFontSize)}px;` +
                `color:${colors.hint_text_color || colors.border_color};` +
                `line-height:${REVDOKU_MARGIN_LABEL_LINE_HEIGHT};` +
                `padding:${r(effectivePadding)}px;` +
                `word-break:break-word;overflow:visible;text-align:${textAlign};` +
                `">${badgeHtml}${htmlContent}</div></foreignObject>`,
              );
            }
          }
        }
      }

      svg.push('</g>'); // close per-check group
    }

    svg.push('</svg>');
    results.push(svg.join('\n'));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildPlainSvg(imageBase64: string, w: number, h: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="display:block;width:${w}px;max-width:100%;height:auto;">`,
    `<image href="data:image/png;base64,${imageBase64}" x="0" y="0" width="${w}" height="${h}"/>`,
    `</svg>`,
  ].join('\n');
}
