import { useState, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import type { ZoomMode } from "../ZoomSelect";
import {
  getColorsForCheckResult,
  IPageInfo,
  ICoordinates,
  IReport,
  ICheck,
  ICheckForDisplay,
  IEnvelopeRevision,
  getWidth,
  getHeight,
  estimateWrappedLabelDimensions,
  REVDOKU_HINT_GAP,
  HintPlacementInput,
  computeLabelMetrics,
  REVDOKU_MARGIN_LABEL_VERTICAL_GAP,
  REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING,
  calculateActualSizeForChecks,
  REVDOKU_MARGIN_LABEL_MIN_WIDTH,
  REVDOKU_LABEL_BADGE_FONT_SCALE,
  PlacementSide,
  autoRepositionLabels,
  computeStraightConnectionLine,
  REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS,
  AutoRepositionStep,
  REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
  REVDOKU_LAYOUT_LABEL_MAX_LINES,
  getCheckTypes,
  CheckFilterType,
} from "@revdoku/lib";
// Vertical padding between page border and labels (top/bottom) — matches horizontal padding for uniform gaps

import type { LabelFontFamily } from "@revdoku/lib";
import type { LabelDescriptor } from "@revdoku/lib";
import type { HintPlacementResultExtended } from "@revdoku/lib";
import type { CheckFilter } from "@/components/envelope-page/CheckNavigator";
import {
  filterChecks as filterChecksUtil,
} from "@/components/envelope-page/envelope-utils";

export interface UseLabelGeometryParams {
  currentReport: IReport | null;
  currentPageIndex: number;
  viewerWidth: number;
  viewerHeight: number;
  zoomLevel: number;
  setZoomLevel: React.Dispatch<React.SetStateAction<number>>;
  zoomMode: ZoomMode;
  documentPagesToDisplayImageDimensions: IPageInfo[];
  checkFilter: CheckFilter;
  pendingNewCheck: ICheckForDisplay | null;
  inlineEditCheckId: string | null;
  labelFontScale: number;
  pageFontScales: Record<number, number>;
  fontFamily: LabelFontFamily;
  showDebug: boolean;
  debugScaleMultiplierX: number;
  debugScaleMultiplierY: number;
  numPages: number | null;
  currentEnvelopeRevision: IEnvelopeRevision | null | undefined;
  pageScrollContainerRef: React.RefObject<HTMLDivElement | null>;
  isContinuousScroll?: boolean;
  visiblePageRange?: { start: number; end: number };
  alignLabelsToTop?: boolean;
}

export type PageLabelGeometry = {
  pageHighlights: ICheckForDisplay[];
  labelPlacements: HintPlacementResultExtended[];
  labelPlacementMap: Map<string, HintPlacementResultExtended>;
  useAdjacentLabels: boolean;
  renderedPageWidth: number;
  renderedPageHeight: number;
  effectiveFontSize: number;
  effectivePadding: number;
  pageScaleX: number;
  hasMarginLabels: boolean;
  overhangTop: number;
  overhangRight: number;
  overhangBottom: number;
  overhangLeft: number;
};

export function useLabelGeometry({
  currentReport,
  currentPageIndex,
  viewerWidth,
  viewerHeight,
  zoomLevel,
  setZoomLevel,
  zoomMode,
  documentPagesToDisplayImageDimensions,
  checkFilter,
  pendingNewCheck,
  inlineEditCheckId,
  labelFontScale,
  pageFontScales,
  fontFamily,
  showDebug,
  debugScaleMultiplierX,
  debugScaleMultiplierY,
  numPages,
  currentEnvelopeRevision,
  pageScrollContainerRef,
  isContinuousScroll = false,
  visiblePageRange,
  alignLabelsToTop = false,
}: UseLabelGeometryParams) {

  const effectiveRepositionSteps = alignLabelsToTop
    ? REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS.filter(s => s !== AutoRepositionStep.STEP_SPREAD_CLOSE_TO_HIGHLIGHTS)
    : REVDOKU_AUTO_REPOSITION_LABEL_ALL_STEPS;

  // --- State/Refs ---
  const [containerWidth, setContainerWidth] = useState(800);
  const draggedLabelPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const labelResizeActiveRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const measuredCanvasWidthRef = useRef<Map<number, number>>(new Map());
  const prevContentWidthRef = useRef<number>(0);
  const prevViewerWidthRef = useRef<number>(0);
  const labelPlacementMapRef = useRef<Map<string, HintPlacementResultExtended>>(new Map());
  const currentReportRef = useRef<IReport | null>(null);
  const currentPageIndexRef = useRef(0);
  const labelGeometryRef = useRef<{ renderedPageWidth: number; renderedPageHeight: number; labelPlacementMap: Map<string, HintPlacementResultExtended> } | null>(null);
  const labelDragScaleRef = useRef<{ scaleX: number; scaleY: number; renderedPageWidth: number; pageOrigWidth: number }>({ scaleX: 1, scaleY: 1, renderedPageWidth: 0, pageOrigWidth: 0 });
  const fitZoomIterRef = useRef(0);
  const fitZoomModeRef = useRef<string | null>(null);

  // --- Track scroll container width for margin labels ---
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- Utility: filter checks ---
  const filterChecks = (checks: ICheck[], filter: CheckFilter): ICheck[] =>
    filterChecksUtil(checks, filter);

  // --- Coordinate scaling ---
  // Coordinate system note:
  // "Document space" coordinates (stored in DB as Check.x1/y1/x2/y2) use a top-left origin
  // matching pdf.js's viewport coordinate system — NOT the raw PDF user-space which has a
  // bottom-left origin. The doc-api's deMapAIGridCoordinate() converts AI output into this
  // top-left document space. This function then scales those coordinates to/from screen pixels.
  //
  // Base coordinate scaling: forward (PDF→viewer) when inverse=false, reverse (viewer→PDF) when inverse=true.
  // Uses uniform scaleX for both axes because react-pdf's <Page width=...> preserves aspect ratio,
  // so scaleY always equals scaleX (renderedWidth / original_width).
  // Parse page_coordinate_spaces from report's pages_layout_json.
  // Always present after inspection — doc-api returns this for every page.
  // null only when no report exists yet (before first inspection).
  const pageCoordinateSpaces = useMemo(() => {
    if (!currentReport) return null;
    const layoutJson = (currentReport as any)?.pages_layout_json;
    if (!layoutJson) return null;
    const parsed = typeof layoutJson === 'string' ? JSON.parse(layoutJson) : layoutJson;
    return parsed.page_coordinate_spaces as Record<string, { width: number; height: number }>;
  }, [(currentReport as any)?.pages_layout_json]);

  const scaleCoordinatesFromPDFToScreen = (
    coordinates: ICoordinates,
    pageIndex: number,
    inverse = false,
  ): ICoordinates => {
    if (!documentPagesToDisplayImageDimensions[pageIndex]) {
      if (import.meta.env.DEV) console.debug(`Page ${pageIndex} not found in documentPagesToDisplayImageDimensions, using original coordinates`);
      return coordinates;
    }

    const actualRenderedWidth = viewerWidth * zoomLevel;
    const pdfjs_w = documentPagesToDisplayImageDimensions[pageIndex].original_width;

    // Use page_coordinate_spaces from the report as the authoritative coordinate space
    // when available. doc-api's reverse mapping produces coordinates in this space
    // (cropOffset + pixel / scalingFactor), and the space may differ from pdfjs_w
    // when doc-api renders at a different resolution than PDF.js viewport scale=1.
    // Fall back to pdfjs_w only when no report coordinate space is available (before first inspection).
    const pcs_w = pageCoordinateSpaces?.[String(pageIndex)]?.width;

    // IMPORTANT: DO NOT CHANGE THIS LINE BELOW 
    // Always use the full PDF page width (from pdf.js viewport at scale=1) as the divisor.
    // The frontend renders the full page via react-pdf, so the scaling denominator must
    // match the full page width. Doc coordinates are in full-page space (reverse mapping
    // adds crop offset), so dividing by the full page width gives correct screen positions.
    // page_coordinate_spaces.width is NOT used here because it represents only the cropped
    // content extent (cropOffX + contentWidth), which excludes right/bottom margins.
    const coord_space_w = pdfjs_w; // this is IMPORTANT NOT TO CHANGE THIS ONE! it maye cause issues with hlgihght coordinates

    const scaleX = coord_space_w > 0 ? actualRenderedWidth / coord_space_w : 1;

    const factor = inverse ? 1 / scaleX : scaleX;
    // Apply debug scale multipliers (default 1.0)
    const effectiveFactorX = inverse ? factor / debugScaleMultiplierX : factor * debugScaleMultiplierX;
    const effectiveFactorY = inverse ? factor / debugScaleMultiplierY : factor * debugScaleMultiplierY;
    let x1 = coordinates.x1 * effectiveFactorX;
    let y1 = coordinates.y1 * effectiveFactorY;
    let x2 = coordinates.x2 * effectiveFactorX;
    let y2 = coordinates.y2 * effectiveFactorY;

    if (inverse) {
      x1 = Math.round(x1);
      y1 = Math.round(y1);
      x2 = Math.round(x2);
      y2 = Math.round(y2);
    }

    if (import.meta.env.DEV && showDebug) {
      const direction = inverse ? 'viewer\u2192PDF' : 'PDF\u2192viewer';
      console.debug(
        `[HIGHLIGHT-DEBUG] scale (${direction}): renderedW=${actualRenderedWidth.toFixed(1)}, ` +
        `coord_space_w=${coord_space_w}, pdfjs_w=${pdfjs_w}, ` +
        `scale=${scaleX.toFixed(6)}, multX=${debugScaleMultiplierX}, multY=${debugScaleMultiplierY}, ` +
        `raw=(${coordinates.x1},${coordinates.y1},${coordinates.x2},${coordinates.y2}) \u2192 ` +
        `result=(${x1.toFixed(1)},${y1.toFixed(1)},${x2.toFixed(1)},${y2.toFixed(1)})`
      );
    }

    return { x1, y1, x2, y2 } as ICoordinates;
  };

  const scaleCoordinatesToCurrentViewer = (
    coordinates: ICoordinates,
    pageIndex: number,
  ): ICoordinates => scaleCoordinatesFromPDFToScreen(coordinates, pageIndex);

  const scaleCoordinatesFromCurrentViewerToPDF = (
    screenCoordinates: ICoordinates,
  ): ICoordinates => scaleCoordinatesFromPDFToScreen(screenCoordinates, currentPageIndex, true);

  // --- Geometric helpers ---

  // Function to check if two rectangles intersect
  const doRectanglesIntersect = (rect1: ICoordinates, rect2: ICoordinates) => {
    return !(
      rect1.x1 + rect1.x2 <= rect2.x1 ||
      rect2.x1 + rect2.x2 <= rect1.x1 ||
      rect1.y1 + rect1.y2 <= rect2.y1 ||
      rect2.y1 + rect2.y2 <= rect1.y1
    );
  };

  // Function to check if a point is inside a rectangle
  const isPointInRectangle = (
    point: { x: number; y: number },
    rect: ICoordinates,
  ) => {
    return (
      point.x >= rect.x1 &&
      point.x <= rect.x2 &&
      point.y >= rect.y1 &&
      point.y <= rect.y2
    );
  };

  // Helper function to validate coordinates
  const hasValidCoordinates = (coords: ICoordinates) => {
    if (!coords) return false;

    if (coords.x1 === undefined || coords.y1 === undefined || coords.x2 === undefined || coords.y2 === undefined) {
      const msg = `Invalid coordinates detected:${JSON.stringify(coords)}`;
      if (import.meta.env.DEV) console.debug(msg);
      return false;
    }

    // Check if coordinates are valid and not covering the entire page
    return (
      coords.x1 != null &&
      coords.y1 != null &&
      coords.x2 != null &&
      coords.y2 != null
    );
  };

  // Get all highlighted areas for the current page with improved filtering
  const getCurrentPageHighlights = (pageIndex: number): ICheckForDisplay[] => {
    const highlights: ICheckForDisplay[] = [];

    // Add automatic highlights from inspection report
    if (currentReport) {
      if (import.meta.env.DEV) {
        console.debug("Current report available, fetching highlights...");
        console.debug("Current report checks:", currentReport.checks?.length || 0);
      }
      // Include global checks with valid coordinates
      highlights.push(
        ...filterChecks(currentReport.checks as ICheck[] || [], checkFilter)
          .filter(
            (check: ICheck) =>
              check &&
              hasValidCoordinates(check as ICoordinates) &&
              check.page === pageIndex,
          )
          .map(
            (check) =>
              ({
                ...check as ICheck,
                colors: getColorsForCheckResult(check),
              }) as ICheckForDisplay,
          ),
      );
    }
    else {
      if (import.meta.env.DEV) console.debug("No current report available to get highlights from.");
    }

    // Include pending new check (not yet saved to API)
    if (pendingNewCheck && pendingNewCheck.page === pageIndex) {
      highlights.push(pendingNewCheck);
    }

    if (import.meta.env.DEV && showDebug) {
      console.debug("Total highlights found:", highlights.length);
      console.debug(
        "Highlights for current page:",
        highlights.filter((highlight) => highlight?.page === pageIndex)
          .length,
      );
      if (highlights.length == 0) {
        console.error("No highlights found for page:", pageIndex);
      }
    }

    return highlights;
  };

  // Function to find all highlights that contain a given point
  const findHighlightsAtPoint = (
    clickPoint: { x: number; y: number },
    pageIndex: number,
  ): ICheckForDisplay[] => {
    const highlights = getCurrentPageHighlights(pageIndex);
    return highlights.filter((highlight) => {
      if (!highlight) return false;
      const scaledCoords: ICoordinates = scaleCoordinatesToCurrentViewer(
        highlight as ICoordinates,
        pageIndex,
      );
      return isPointInRectangle(clickPoint, scaledCoords);
    });
  };

  // --- The big labelGeometry useMemo ---
  const labelGeometry = useMemo(() => {
    const pageHighlights = getCurrentPageHighlights(currentPageIndex);
    // Build hint placement inputs from scaled coordinates (visible checks only)
    const hintInputs: HintPlacementInput[] = pageHighlights.map(h => {
      const sc = scaleCoordinatesToCurrentViewer(h as ICoordinates, currentPageIndex);
      return {
        id: h.id,
        x: sc.x1,
        y: sc.y1,
        width: getWidth(sc),
        height: getHeight(sc),
        description: h.description || '',
        ruleOrder: h.rule_order ?? (h as any).order ?? 0,
      };
    });
    // Get rendered page dimensions
    const pageDims = documentPagesToDisplayImageDimensions[currentPageIndex];
    const renderedPageWidth = viewerWidth * zoomLevel;
    const renderedPageHeight = (pageDims && pageDims.original_width && pageDims.original_height)
      ? (pageDims.original_height / pageDims.original_width) * renderedPageWidth
      : 1000;

    // Build inputs from ALL checks (unfiltered) for globally optimal placement
    const allChecksForPage = (currentReport?.checks as ICheck[] || []).filter(
      (c: ICheck) => c.page === currentPageIndex && hasValidCoordinates(c as ICoordinates)
    );
    // Include pending check in layout computation
    if (pendingNewCheck && pendingNewCheck.page === currentPageIndex) {
      allChecksForPage.push(pendingNewCheck as ICheck);
    }
    const allHintInputs: HintPlacementInput[] = allChecksForPage.map(c => {
      const sc = scaleCoordinatesToCurrentViewer(c as ICoordinates, currentPageIndex);
      return {
        id: c.id,
        x: sc.x1,
        y: sc.y1,
        width: getWidth(sc),
        height: getHeight(sc),
        description: c.description || '',
        ruleOrder: c.rule_order ?? (c as any).order ?? 0,
      };
    });

    // Use adjacent label placement (inside page, next to highlights)
    const useAdjacentLabels = pageHighlights.length > 0;

    // Compute adjacent label placements with collision avoidance and margin fallback
    let labelPlacements: HintPlacementResultExtended[] = [];

    // Try to use pre-computed description_position from server
    // Derive scale from page dimensions (always available client-side)
    const pageOrigWidth = documentPagesToDisplayImageDimensions[currentPageIndex]?.original_width;
    const pageOrigHeight = documentPagesToDisplayImageDimensions[currentPageIndex]?.original_height;
    const hasPageDims = !!(pageOrigWidth && pageOrigHeight);
    // Compute page scale factor (used for label font scaling with zoom)
    const pageScaleX = hasPageDims ? renderedPageWidth / pageOrigWidth! : 1;
    const checksWithPositions = hasPageDims ? allChecksForPage.filter(c => c.description_position) : [];
    const checksWithoutPositions = hasPageDims ? allChecksForPage.filter(c => !c.description_position) : allChecksForPage;

    // Document-space label metrics — zoom-independent (shared with doc-api export)
    const { fontSize: effectiveFontSize, padding: effectivePadding } = computeLabelMetrics(0, labelFontScale);

    // Margin label width: use page-proportional width at high zoom, but expand to fill
    // available viewer space at low zoom so labels remain readable.
    const baseMarginRatio = 0.38;
    const scaledMarginRatio = Math.min(0.5, baseMarginRatio * Math.pow(labelFontScale, 1.5));
    const pageBasedWidth = renderedPageWidth * scaledMarginRatio;
    const availableRightMargin = Math.max(0, containerWidth - renderedPageWidth - REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING * 3);
    const maxMarginLabelWidth = Math.max(pageBasedWidth, Math.min(availableRightMargin, 400));
    if (hasPageDims && checksWithPositions.length > 0 && useAdjacentLabels) {
      const scaleY = renderedPageHeight / pageOrigHeight!;

      const visibleIds = new Set(pageHighlights.map(h => h.id));
      const visibleChecks = checksWithPositions.filter(c => visibleIds.has(c.id));

      const mappedLabels: (LabelDescriptor & { dragOverride: boolean; checkIndex: number; highlightY1: number })[] = visibleChecks.map(c => {
        const mp = c.description_position!;
        const dragOverride = draggedLabelPositionsRef.current.get(c.id);

        return {
          id: c.id,
          side: PlacementSide.RIGHT,
          x: dragOverride ? dragOverride.x : renderedPageWidth + REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING,
          y: dragOverride ? dragOverride.y : mp.box.y * scaleY,
          width: maxMarginLabelWidth,
          height: mp.box.height,
          description: c.description || '',
          dragOverride: !!dragOverride,
          checkIndex: (c as any).check_index ?? ((c as any).rule_order ?? 0) + 1,
          highlightY1: (c as any).y1 ?? 0,
        };
      });

      // Step 2: Recalculate heights for browser text rendering.
      // doc-api uses node-canvas with different font metrics, so stored heights
      // won't match the browser. calculateActualSizeForChecks preserves widths.
      // borderCompensation must match actual CSS: border 2.5px * 2 = 5px + 1px safety
      const borderComp = 6;
      // Badge circle width + margin + CSS border (box-sizing: border-box reduces text area)
      const badgeWidth = effectiveFontSize * REVDOKU_LABEL_BADGE_FONT_SCALE * 1.275
        + Math.max(3, effectiveFontSize * 0.25);
      const cssBorderWidth = 2.5 * 2; // 2.5px border on each side
      const badgeComp = badgeWidth + cssBorderWidth;
      const resized = calculateActualSizeForChecks(
        mappedLabels,
        { fontScale: labelFontScale, borderCompensation: borderComp, badgeCompensation: badgeComp },
      );
      for (let i = 0; i < mappedLabels.length; i++) {
        mappedLabels[i].height = resized[i].height;
      }

      // Convert to HintPlacementResultExtended. All labels start as RIGHT side.
      // autoRepositionLabels will handle redistribution to other sides as needed.
      const precomputed: HintPlacementResultExtended[] = mappedLabels.map(label => {
        const labelBox = { x: label.x, y: label.y, width: label.width, height: label.height };
        return {
          id: label.id,
          side: label.dragOverride ? PlacementSide.INSIDE : PlacementSide.RIGHT,
          labelBox,
          arrowPath: [],
        } as HintPlacementResultExtended;
      });
      labelPlacements = precomputed;

    }

    // Fallback: simple right-side placement for checks without pre-computed positions
    // (manual checks added after report creation)
    if (useAdjacentLabels && checksWithoutPositions.length > 0) {
      const fallbackPlacements: HintPlacementResultExtended[] = checksWithoutPositions
        .filter(c => hasValidCoordinates(c as ICoordinates))
        .map(c => {
          const sc = scaleCoordinatesToCurrentViewer(c as ICoordinates, currentPageIndex);
          const hlX = sc.x1;
          const hlY = sc.y1;
          const hlW = getWidth(sc);
          const hlH = getHeight(sc);
          const msg = c.description || '';
          const dims = estimateWrappedLabelDimensions(msg, computeLabelMetrics(200, labelFontScale).labelWidth, undefined, undefined, undefined, undefined, fontFamily);
          const override = draggedLabelPositionsRef.current.get(c.id);
          const inlineX = hlX + hlW + REVDOKU_HINT_GAP;
          const availableInlineWidth = renderedPageWidth - inlineX;
          const fallbackMaxMarginW = maxMarginLabelWidth;
          // If insufficient inline space, push to margin column
          const pushToMargin = !override && inlineX < renderedPageWidth && availableInlineWidth < REVDOKU_MARGIN_LABEL_MIN_WIDTH;
          const labelBox = override
            ? { x: override.x, y: override.y, width: dims.width, height: dims.height }
            : pushToMargin
              ? { x: renderedPageWidth + REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING, y: 0, width: fallbackMaxMarginW, height: dims.height }
              : { x: inlineX, y: hlY, width: dims.width, height: dims.height };
          const highlightBB = { x: hlX, y: hlY, width: hlW, height: hlH };
          const isMarginLabel = labelBox.x >= renderedPageWidth;
          return {
            id: c.id,
            side: isMarginLabel ? PlacementSide.RIGHT : PlacementSide.INSIDE,
            labelBox,
            arrowPath: [],
            leader: undefined,
          } as HintPlacementResultExtended;
        });
      labelPlacements = [...labelPlacements, ...fallbackPlacements];
    }

    // --- Label repositioning ---
    // Always runs: useMemo rebuilds labelPlacements from description_position each time,
    // so autoRepositionLabels must re-apply sorting, redistribution and constraint-based
    // resizing on every computation. Skip only during active drag (positions managed by drag handler).
    {
      // Pin dragged labels and pre-computed positions for single-group filters.
      // Failed and passed groups have independent positions starting at Y=gap.
      // When viewing "All", unpin so autoRepositionLabels merges both groups.
      // Rare overlaps (e.g. passed change in FAILED_AND_CHANGES filter) are
      // resolved by the DOM restacking in HighlightOverlay.
      const pinnedIds = new Set<string>();
      for (const [id] of draggedLabelPositionsRef.current) {
        pinnedIds.add(id);
      }
      if (checkFilter !== CheckFilterType.ALL && !alignLabelsToTop) {
        for (const c of checksWithPositions) {
          if (c.description_position) pinnedIds.add(c.id);
        }
      }

      if (labelPlacements.length > 0) {
        autoRepositionLabels(labelPlacements, {
          page_width: renderedPageWidth,
          page_height: renderedPageHeight,
          gap: REVDOKU_MARGIN_LABEL_VERTICAL_GAP,
          steps: effectiveRepositionSteps,
          constraint_ctx: {
            viewer_width: viewerWidth,
            viewer_height: viewerHeight,
            page_width: renderedPageWidth,
            page_height: renderedPageHeight,
            text_line_height: effectiveFontSize * REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
          },
          resize_label: (id: string, targetWidth: number) => {
            const check = pageHighlights.find(h => h.id === id);
            if (!check) return { width: targetWidth, height: 30 };
            return estimateWrappedLabelDimensions(
              check.description || '', targetWidth,
              effectiveFontSize, REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
              effectivePadding, REVDOKU_LAYOUT_LABEL_MAX_LINES, fontFamily
            );
          },
          get_passed: (id: string) => {
            const check = pageHighlights.find(h => h.id === id);
            return check?.passed;
          },
          get_highlight_center_y: (id: string) => {
            const check = pageHighlights.find(h => h.id === id);
            if (!check) return null;
            const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, currentPageIndex);
            return (sc.y1 + sc.y2) / 2;
          },
          get_highlight_rect: (id: string) => {
            const check = pageHighlights.find(h => h.id === id);
            if (!check) return null;
            const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, currentPageIndex);
            return { x: sc.x1, y: sc.y1, width: sc.x2 - sc.x1, height: sc.y2 - sc.y1 };
          },
          get_check_types: (id: string) => {
            const check = pageHighlights.find(h => h.id === id);
            if (!check) return new Set();
            return getCheckTypes(check);
          },
          get_check_index: (id: string) => {
            const check = pageHighlights.find(h => h.id === id);
            return (check as any)?.check_index ?? null;
          },
          check_filter: checkFilter as CheckFilterType,
          skip_ids: pinnedIds.size > 0 ? pinnedIds : undefined,
        });
      }
    }

    // Compute straight connection lines
    for (const lp of labelPlacements) {
      const check = pageHighlights.find(h => h.id === lp.id);
      if (!check) continue;
      const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, currentPageIndex);
      const highlightBox = {
        x: sc.x1, y: sc.y1,
        width: getWidth(sc), height: getHeight(sc),
      };
      const { start, end } = computeStraightConnectionLine(lp.labelBox, highlightBox, lp.side);
      lp.arrowPath = [start, end];
    }

    // Build a lookup for label placements by check ID
    const labelPlacementMap = new Map<string, HintPlacementResultExtended>();
    for (const lp of labelPlacements) {
      labelPlacementMap.set(lp.id, lp);
    }

    const hasMarginLabels = labelPlacements.some(lp => lp.side !== PlacementSide.INSIDE);

    // Compute 4-directional overhangs: how far labels extend beyond the page in each direction
    let overhangRight = 0, overhangBottom = 0, overhangLeft = 0, overhangTop = 0;
    for (const lp of labelPlacements) {
      const r = (lp.labelBox.x + lp.labelBox.width) - renderedPageWidth;
      if (r > overhangRight) overhangRight = r;
      const b = (lp.labelBox.y + lp.labelBox.height) - renderedPageHeight;
      if (b > overhangBottom) overhangBottom = b;
      if (lp.labelBox.x < 0 && -lp.labelBox.x > overhangLeft) overhangLeft = -lp.labelBox.x;
      if (lp.labelBox.y < 0 && -lp.labelBox.y > overhangTop) overhangTop = -lp.labelBox.y;
    }
    // Add padding for edit/delete icon buttons that sit outside label boxes
    const OVERHANG_PAD = 32;
    if (overhangRight > 0) overhangRight += OVERHANG_PAD;
    if (overhangLeft > 0) overhangLeft += OVERHANG_PAD;
    if (overhangTop > 0) overhangTop += OVERHANG_PAD;
    if (overhangBottom > 0) overhangBottom += OVERHANG_PAD;
    return {
      pageHighlights,
      labelPlacements,
      labelPlacementMap,
      useAdjacentLabels,
      renderedPageWidth,
      renderedPageHeight,
      effectiveFontSize,
      effectivePadding,
      pageScaleX,
      hasMarginLabels,
      overhangTop,
      overhangRight,
      overhangBottom,
      overhangLeft,
    };
  }, [
    currentReport,
    currentPageIndex,
    zoomLevel,
    viewerWidth,
    checkFilter,
    pageFontScales,
    documentPagesToDisplayImageDimensions,
    pendingNewCheck,
    inlineEditCheckId,
    containerWidth,
    alignLabelsToTop,
  ]);

  // --- Compute per-page geometry for continuous scroll mode ---
  // Reuses the same logic as the single-page labelGeometry useMemo above.
  // For single-page mode, just wraps the existing labelGeometry in a map.
  const computeGeometryForPage = (pageIndex: number): PageLabelGeometry => {
    const pageHighlights = getCurrentPageHighlights(pageIndex);
    const hintInputs: HintPlacementInput[] = pageHighlights.map(h => {
      const sc = scaleCoordinatesToCurrentViewer(h as ICoordinates, pageIndex);
      return {
        id: h.id, x: sc.x1, y: sc.y1,
        width: getWidth(sc), height: getHeight(sc),
        description: h.description || '',
        ruleOrder: h.rule_order ?? (h as any).order ?? 0,
      };
    });
    const pageDims = documentPagesToDisplayImageDimensions[pageIndex];
    const renderedPageWidth = viewerWidth * zoomLevel;
    const renderedPageHeight = (pageDims && pageDims.original_width && pageDims.original_height)
      ? (pageDims.original_height / pageDims.original_width) * renderedPageWidth : 1000;

    const allChecksForPage = (currentReport?.checks as ICheck[] || []).filter(
      (c: ICheck) => c.page === pageIndex && hasValidCoordinates(c as ICoordinates)
    );
    if (pendingNewCheck && pendingNewCheck.page === pageIndex) {
      allChecksForPage.push(pendingNewCheck as ICheck);
    }

    const useAdjacentLabels = pageHighlights.length > 0;
    let labelPlacements: HintPlacementResultExtended[] = [];

    const pageOrigWidth = documentPagesToDisplayImageDimensions[pageIndex]?.original_width;
    const pageOrigHeight = documentPagesToDisplayImageDimensions[pageIndex]?.original_height;
    const hasPageDims = !!(pageOrigWidth && pageOrigHeight);
    const pageScaleX = hasPageDims ? renderedPageWidth / pageOrigWidth! : 1;
    const checksWithPositions = hasPageDims ? allChecksForPage.filter(c => c.description_position) : [];
    const checksWithoutPositions = hasPageDims ? allChecksForPage.filter(c => !c.description_position) : allChecksForPage;

    const { fontSize: effectiveFontSize, padding: effectivePadding } = computeLabelMetrics(0, labelFontScale);
    const baseMarginRatio = 0.38;
    const scaledMarginRatio = Math.min(0.5, baseMarginRatio * Math.pow(labelFontScale, 1.5));
    const pageBasedWidth = renderedPageWidth * scaledMarginRatio;
    const availableRightMargin = Math.max(0, containerWidth - renderedPageWidth - REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING * 3);
    const maxMarginLabelWidth = Math.max(pageBasedWidth, Math.min(availableRightMargin, 400));

    if (hasPageDims && checksWithPositions.length > 0 && useAdjacentLabels) {
      const scaleY = renderedPageHeight / pageOrigHeight!;
      const visibleIds = new Set(pageHighlights.map(h => h.id));
      const visibleChecks = checksWithPositions.filter(c => visibleIds.has(c.id));

      const mappedLabels: (LabelDescriptor & { dragOverride: boolean; checkIndex: number; highlightY1: number })[] = visibleChecks.map(c => {
        const mp = c.description_position!;
        const dragOverride = draggedLabelPositionsRef.current.get(c.id);
        return {
          id: c.id, side: PlacementSide.RIGHT,
          x: dragOverride ? dragOverride.x : renderedPageWidth + REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING,
          y: dragOverride ? dragOverride.y : mp.box.y * scaleY,
          width: maxMarginLabelWidth, height: mp.box.height,
          description: c.description || '',
          dragOverride: !!dragOverride,
          checkIndex: (c as any).check_index ?? ((c as any).rule_order ?? 0) + 1,
          highlightY1: (c as any).y1 ?? 0,
        };
      });

      const borderComp = 6;
      const badgeWidth = effectiveFontSize * REVDOKU_LABEL_BADGE_FONT_SCALE * 1.275 + Math.max(3, effectiveFontSize * 0.25);
      const cssBorderWidth = 2.5 * 2;
      const badgeComp = badgeWidth + cssBorderWidth;
      const resized = calculateActualSizeForChecks(mappedLabels, { fontScale: labelFontScale, borderCompensation: borderComp, badgeCompensation: badgeComp });
      for (let i = 0; i < mappedLabels.length; i++) mappedLabels[i].height = resized[i].height;

      labelPlacements = mappedLabels.map(label => ({
        id: label.id,
        side: label.dragOverride ? PlacementSide.INSIDE : PlacementSide.RIGHT,
        labelBox: { x: label.x, y: label.y, width: label.width, height: label.height },
        arrowPath: [],
      } as HintPlacementResultExtended));
    }

    if (useAdjacentLabels && checksWithoutPositions.length > 0) {
      const fallbackPlacements: HintPlacementResultExtended[] = checksWithoutPositions
        .filter(c => hasValidCoordinates(c as ICoordinates))
        .map(c => {
          const sc = scaleCoordinatesToCurrentViewer(c as ICoordinates, pageIndex);
          const hlX = sc.x1, hlY = sc.y1, hlW = getWidth(sc), hlH = getHeight(sc);
          const dims = estimateWrappedLabelDimensions(c.description || '', computeLabelMetrics(200, labelFontScale).labelWidth, undefined, undefined, undefined, undefined, fontFamily);
          const override = draggedLabelPositionsRef.current.get(c.id);
          const inlineX = hlX + hlW + REVDOKU_HINT_GAP;
          const availableInlineWidth = renderedPageWidth - inlineX;
          const pushToMargin = !override && inlineX < renderedPageWidth && availableInlineWidth < REVDOKU_MARGIN_LABEL_MIN_WIDTH;
          const labelBox = override
            ? { x: override.x, y: override.y, width: dims.width, height: dims.height }
            : pushToMargin
              ? { x: renderedPageWidth + REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING, y: 0, width: maxMarginLabelWidth, height: dims.height }
              : { x: inlineX, y: hlY, width: dims.width, height: dims.height };
          return {
            id: c.id,
            side: labelBox.x >= renderedPageWidth ? PlacementSide.RIGHT : PlacementSide.INSIDE,
            labelBox, arrowPath: [], leader: undefined,
          } as HintPlacementResultExtended;
        });
      labelPlacements = [...labelPlacements, ...fallbackPlacements];
    }

    // Label repositioning — pin pre-computed positions for single-group filters, unpin for "All"
    {
      const pinnedIds = new Set<string>();
      for (const [id] of draggedLabelPositionsRef.current) pinnedIds.add(id);
      if (checkFilter !== CheckFilterType.ALL && !alignLabelsToTop) {
        for (const c of checksWithPositions) { if (c.description_position) pinnedIds.add(c.id); }
      }
      if (labelPlacements.length > 0) {
        autoRepositionLabels(labelPlacements, {
          page_width: renderedPageWidth, page_height: renderedPageHeight,
          gap: REVDOKU_MARGIN_LABEL_VERTICAL_GAP, steps: effectiveRepositionSteps,
          constraint_ctx: {
            viewer_width: viewerWidth, viewer_height: viewerHeight,
            page_width: renderedPageWidth, page_height: renderedPageHeight,
            text_line_height: effectiveFontSize * REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
          },
          resize_label: (id: string, targetWidth: number) => {
            const check = pageHighlights.find(h => h.id === id);
            if (!check) return { width: targetWidth, height: 30 };
            return estimateWrappedLabelDimensions(check.description || '', targetWidth, effectiveFontSize, REVDOKU_MARGIN_LABEL_LINE_HEIGHT, effectivePadding, REVDOKU_LAYOUT_LABEL_MAX_LINES, fontFamily);
          },
          get_passed: (id: string) => pageHighlights.find(h => h.id === id)?.passed,
          get_highlight_center_y: (id: string) => {
            const check = pageHighlights.find(h => h.id === id);
            if (!check) return null;
            const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, pageIndex);
            return (sc.y1 + sc.y2) / 2;
          },
          get_highlight_rect: (id: string) => {
            const check = pageHighlights.find(h => h.id === id);
            if (!check) return null;
            const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, pageIndex);
            return { x: sc.x1, y: sc.y1, width: sc.x2 - sc.x1, height: sc.y2 - sc.y1 };
          },
          get_check_types: (id: string) => {
            const check = pageHighlights.find(h => h.id === id);
            if (!check) return new Set();
            return getCheckTypes(check);
          },
          get_check_index: (id: string) => {
            const check = pageHighlights.find(h => h.id === id);
            return (check as any)?.check_index ?? null;
          },
          check_filter: checkFilter as CheckFilterType,
          skip_ids: pinnedIds.size > 0 ? pinnedIds : undefined,
        });
      }
    }

    // Connection lines
    for (const lp of labelPlacements) {
      const check = pageHighlights.find(h => h.id === lp.id);
      if (!check) continue;
      const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, pageIndex);
      const { start, end } = computeStraightConnectionLine(lp.labelBox, { x: sc.x1, y: sc.y1, width: getWidth(sc), height: getHeight(sc) }, lp.side);
      lp.arrowPath = [start, end];
    }

    const labelPlacementMap = new Map<string, HintPlacementResultExtended>();
    for (const lp of labelPlacements) labelPlacementMap.set(lp.id, lp);
    const hasMarginLabels = labelPlacements.some(lp => lp.side !== PlacementSide.INSIDE);

    let overhangRight = 0, overhangBottom = 0, overhangLeft = 0, overhangTop = 0;
    for (const lp of labelPlacements) {
      const r = (lp.labelBox.x + lp.labelBox.width) - renderedPageWidth;
      if (r > overhangRight) overhangRight = r;
      const b = (lp.labelBox.y + lp.labelBox.height) - renderedPageHeight;
      if (b > overhangBottom) overhangBottom = b;
      if (lp.labelBox.x < 0 && -lp.labelBox.x > overhangLeft) overhangLeft = -lp.labelBox.x;
      if (lp.labelBox.y < 0 && -lp.labelBox.y > overhangTop) overhangTop = -lp.labelBox.y;
    }
    const OVERHANG_PAD = 32;
    if (overhangRight > 0) overhangRight += OVERHANG_PAD;
    if (overhangLeft > 0) overhangLeft += OVERHANG_PAD;
    if (overhangTop > 0) overhangTop += OVERHANG_PAD;
    if (overhangBottom > 0) overhangBottom += OVERHANG_PAD;

    return {
      pageHighlights, labelPlacements, labelPlacementMap, useAdjacentLabels,
      renderedPageWidth, renderedPageHeight, effectiveFontSize, effectivePadding,
      pageScaleX, hasMarginLabels, overhangTop, overhangRight, overhangBottom, overhangLeft,
    };
  };

  // All-page geometries for continuous scroll mode
  const allPageGeometries = useMemo((): Map<number, PageLabelGeometry> => {
    const map = new Map<number, PageLabelGeometry>();
    if (!isContinuousScroll) {
      // Single-page mode — just wrap the existing labelGeometry
      map.set(currentPageIndex, labelGeometry);
      return map;
    }
    // Continuous mode — compute for each visible page
    const start = visiblePageRange?.start ?? 0;
    const end = visiblePageRange?.end ?? (numPages ?? 1) - 1;
    for (let i = start; i <= end; i++) {
      map.set(i, computeGeometryForPage(i));
    }
    return map;
  }, [
    isContinuousScroll, visiblePageRange?.start, visiblePageRange?.end,
    // Same dependencies as the single-page labelGeometry useMemo:
    currentReport, currentPageIndex, zoomLevel, viewerWidth, checkFilter,
    pageFontScales, documentPagesToDisplayImageDimensions, pendingNewCheck,
    inlineEditCheckId, containerWidth, labelGeometry, alignLabelsToTop,
  ]);

  // Compute max overhangs across all visible pages (for horizontal alignment in continuous mode)
  const maxOverhangs = useMemo(() => {
    if (!isContinuousScroll) return { left: labelGeometry.overhangLeft, right: labelGeometry.overhangRight };
    let left = 0, right = 0;
    for (const [, geo] of allPageGeometries) {
      if (geo.overhangLeft > left) left = geo.overhangLeft;
      if (geo.overhangRight > right) right = geo.overhangRight;
    }
    return { left, right };
  }, [isContinuousScroll, allPageGeometries, labelGeometry.overhangLeft, labelGeometry.overhangRight]);

  // Sync refs after geometry recomputation (consumed by drag/resize event handlers)
  currentReportRef.current = currentReport;
  currentPageIndexRef.current = currentPageIndex;
  labelGeometryRef.current = labelGeometry;
  labelPlacementMapRef.current = labelGeometry.labelPlacementMap;
  const hasOverhangs = labelGeometry.overhangLeft > 0
    || labelGeometry.overhangRight > 0
    || labelGeometry.overhangTop > 0
    || labelGeometry.overhangBottom > 0;
  {
    const pageDims = documentPagesToDisplayImageDimensions[currentPageIndex];
    const pageOrigWidth = pageDims?.original_width;
    const pageOrigHeight = pageDims?.original_height;
    if (pageOrigWidth && pageOrigHeight) {
      const scaleY = labelGeometry.renderedPageHeight / pageOrigHeight;
      labelDragScaleRef.current = {
        scaleX: labelGeometry.pageScaleX,
        scaleY,
        renderedPageWidth: labelGeometry.renderedPageWidth,
        pageOrigWidth,
      };
    }
  }

  // Center scroll position when zoom changes (useLayoutEffect to avoid visible scroll jump)
  // In continuous scroll mode, skip re-centering on overhang changes (pages with different
  // label overhangs would constantly shift the viewport as the user scrolls). Only center
  // when the zoom level itself changes.
  const prevZoomForCenterRef = useRef(zoomLevel);
  useLayoutEffect(() => {
    if (!pageScrollContainerRef.current) return;
    // In continuous mode, only center on actual zoom changes, not overhang fluctuations
    if (isContinuousScroll && prevZoomForCenterRef.current === zoomLevel) {
      prevZoomForCenterRef.current = zoomLevel;
      return;
    }
    prevZoomForCenterRef.current = zoomLevel;
    const container = pageScrollContainerRef.current;
    const ohLeft = isContinuousScroll ? maxOverhangs.left : labelGeometry.overhangLeft;
    const ohRight = isContinuousScroll ? maxOverhangs.right : labelGeometry.overhangRight;
    const contentWidth = ohLeft + viewerWidth * zoomLevel + ohRight;
    if (contentWidth <= container.clientWidth) {
      container.scrollLeft = 0; // Fits — let CSS margin:auto center it
    } else {
      container.scrollLeft = (contentWidth - container.clientWidth) / 2; // Center overflow
    }
  }, [zoomLevel, labelGeometry.overhangLeft, labelGeometry.overhangRight, isContinuousScroll, maxOverhangs.left, maxOverhangs.right]);

  // Auto-apply fit-width/fit-page zoom when page or geometry changes
  // useLayoutEffect prevents flicker: intermediate zoom states resolve before browser paints
  // Convergence guard (5-iteration cap) prevents oscillation from overhang feedback loops
  useLayoutEffect(() => {
    // Skip zoom recalculation during/immediately after label resize to prevent
    // the overhang → zoom → label width → overhang oscillation feedback loop
    if (labelResizeActiveRef.current) return;

    // Reset iteration counter when mode or page changes.
    // Round viewer dimensions to nearest 30px to prevent scrollbar-induced resets
    // (scrollbar appearance changes clientWidth/Height by ~17px).
    // In continuous mode, don't include currentPageIndex — page changes during scroll
    // should not reset the zoom convergence.
    const pageKey = isContinuousScroll ? 'continuous' : String(currentPageIndex);
    const modeKey = `${zoomMode}-${pageKey}-${Math.round(viewerWidth / 30) * 30}-${Math.round(viewerHeight / 30) * 30}`;
    if (fitZoomModeRef.current !== modeKey) {
      fitZoomModeRef.current = modeKey;
      fitZoomIterRef.current = 0;
    }
    if (fitZoomIterRef.current >= 5) return;

    // In continuous mode, use max overhangs across all visible pages for stable zoom
    const overhangLeft = isContinuousScroll ? maxOverhangs.left : labelGeometry.overhangLeft;
    const overhangRight = isContinuousScroll ? maxOverhangs.right : labelGeometry.overhangRight;
    const { overhangTop, overhangBottom } = labelGeometry;
    const totalH = overhangLeft + overhangRight;

    if (zoomMode === 'fit-width') {
      // Analytical formula: since margin label widths scale with zoom (via renderedPageWidth),
      // overhangs at target zoom ≈ totalH * (targetZoom / currentZoom).
      // Solving: viewerWidth = viewerWidth * z + totalH * (z / currentZoom)
      //        → z = viewerWidth / (viewerWidth + totalH / currentZoom)
      // This converges in 1 iteration instead of oscillating.
      let targetZoom: number;
      if (totalH <= 0) {
        targetZoom = 1.0;
      } else if (zoomLevel > 0.001) {
        targetZoom = Math.max(0.20, viewerWidth / (viewerWidth + totalH / zoomLevel));
      } else {
        targetZoom = Math.max(0.20, (viewerWidth - totalH) / viewerWidth);
      }
      if (Math.abs(targetZoom - zoomLevel) > 0.001) {
        fitZoomIterRef.current++;
        setZoomLevel(targetZoom);
      }
    } else if (zoomMode === 'fit-page' && !isContinuousScroll) {
      // fit-page is only meaningful in single-page mode; in continuous mode, fit-width is used
      const pageDims = documentPagesToDisplayImageDimensions[currentPageIndex];
      if (pageDims) {
        const aspectRatio = pageDims.original_height / pageDims.original_width;

        // Analytical height zoom: overhangs at target ≈ totalV * (z / currentZoom).
        // Constraint: viewerWidth * z * aspectRatio + totalV * (z / currentZoom) <= viewerHeight
        //   z = viewerHeight / (viewerWidth * aspectRatio + totalV / currentZoom)
        const totalV = overhangTop + overhangBottom;
        let heightZoom: number;
        if (totalV <= 0) {
          heightZoom = viewerHeight / (viewerWidth * aspectRatio);
        } else if (zoomLevel > 0.001) {
          heightZoom = viewerHeight / (viewerWidth * aspectRatio + totalV / zoomLevel);
        } else {
          heightZoom = (viewerHeight - totalV) / (viewerWidth * aspectRatio);
        }

        // Analytical width zoom (same formula as fit-width):
        let widthZoom: number;
        if (totalH <= 0) {
          widthZoom = 10.0;
        } else if (zoomLevel > 0.001) {
          widthZoom = viewerWidth / (viewerWidth + totalH / zoomLevel);
        } else {
          widthZoom = (viewerWidth - totalH) / viewerWidth;
        }

        const targetZoom = Math.max(0.20, Math.min(10.0, heightZoom, widthZoom));
        if (Math.abs(targetZoom - zoomLevel) > 0.001) {
          fitZoomIterRef.current++;
          setZoomLevel(targetZoom);
        }
      } else if (Math.abs(1.0 - zoomLevel) > 0.001) {
        setZoomLevel(1.0);
      }
    }
  }, [currentPageIndex, zoomMode,
    labelGeometry.overhangLeft, labelGeometry.overhangRight,
    labelGeometry.overhangTop, labelGeometry.overhangBottom,
    viewerWidth, viewerHeight, documentPagesToDisplayImageDimensions]);

  // FLIP animation: smooth zoom transitions via CSS transform instead of jarring width snap
  useLayoutEffect(() => {
    const el = sizerRef.current;
    if (!el) return;

    const newWidth = labelGeometry.overhangLeft + viewerWidth * zoomLevel + labelGeometry.overhangRight;
    const prevWidth = prevContentWidthRef.current;
    const viewerResized = viewerWidth !== prevViewerWidthRef.current;

    prevContentWidthRef.current = newWidth;
    prevViewerWidthRef.current = viewerWidth;

    if (prevWidth <= 0 || Math.abs(prevWidth - newWidth) < 1 || viewerResized) return;

    const ratio = prevWidth / newWidth;
    el.style.transition = 'none';
    el.style.transform = `scale(${ratio})`;
    el.style.transformOrigin = 'top left';
    void el.offsetHeight;
    el.style.transition = 'transform 350ms cubic-bezier(0.25, 0.1, 0.25, 1)';
    el.style.transform = 'scale(1)';
  }, [viewerWidth, zoomLevel, labelGeometry.overhangLeft, labelGeometry.overhangRight]);

  // Margin label restacking is handled by the single useLayoutEffect in HighlightOverlay.tsx.
  // It measures actual DOM heights and corrects for browser font rendering differences.
  // No duplicate restacking here — that caused labels to shift due to different height
  // measurement methods (getBoundingClientRect vs offsetHeight).

  // Add an effect to update highlights when zoom changes
  useEffect(() => {
    // This causes a re-render when zoom changes, which will update the highlight positions

    if (currentEnvelopeRevision && currentEnvelopeRevision.document_file_revision_links && currentEnvelopeRevision.document_file_revision_links.length > 0 && numPages && currentPageIndex >= 0) {
      // Force re-calculation of highlights when zoom changes
      const currentHighlights: ICheckForDisplay[] =
        getCurrentPageHighlights(currentPageIndex);
      if (import.meta.env.DEV && showDebug) {
        console.debug(
          `Zoom changed to ${zoomLevel}. Updating ${currentHighlights.length} highlights.`,
        );
      }
    }
  }, [zoomLevel, currentPageIndex, currentEnvelopeRevision]);

  return {
    // Computed geometry
    labelGeometry,
    hasOverhangs,
    allPageGeometries,
    maxOverhangs,
    computeGeometryForPage,

    // Coordinate functions
    scaleCoordinatesToCurrentViewer,
    scaleCoordinatesFromCurrentViewerToPDF,

    // Geometric helpers
    doRectanglesIntersect,
    getCurrentPageHighlights,
    findHighlightsAtPoint,
    hasValidCoordinates,

    // Refs (shared with drag/resize hooks)
    scrollContainerRef,
    contentWrapperRef,
    sizerRef,
    measuredCanvasWidthRef,
    labelPlacementMapRef,
    currentReportRef,
    currentPageIndexRef,
    labelGeometryRef,
    labelDragScaleRef,
    draggedLabelPositionsRef,
    labelResizeActiveRef,

    // State
    containerWidth,
  };
}
