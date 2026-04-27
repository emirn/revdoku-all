import { useState, useRef, useEffect, useCallback } from "react";
import type { ZoomMode } from "../ZoomSelect";
import type { IPageInfo, IReport, LabelFontFamily } from "@revdoku/lib";
import { REVDOKU_DEFAULT_LABEL_FONT_FAMILY, HighlightMode, REVDOKU_DEFAULT_HIGHLIGHT_MODE } from "@revdoku/lib";
import { useAutoSave } from "@/hooks/useAutoSave";
import { ApiClient } from "@/lib/api-client";

interface UseViewerZoomParams {
  viewerWidth: number;
  viewerHeight: number;
  documentPagesToDisplayImageDimensions: IPageInfo[];
  currentPageIndex: number;
  currentReport: IReport | null;
  trackSave: <T>(promise: Promise<T>) => Promise<T>;
  setInlineEditorSize: (size: { width: number; height: number } | null) => void;
}

const ZOOM_PRESETS = [0.25, 0.33, 0.50, 0.67, 0.75, 0.80, 0.90, 1.00, 1.10, 1.25, 1.50, 1.75, 2.00, 2.50, 3.00, 4.00, 5.00];
const MIN_FIT_ZOOM = 0.20;

export function useViewerZoom({
  viewerWidth,
  viewerHeight,
  documentPagesToDisplayImageDimensions,
  currentPageIndex,
  currentReport,
  trackSave,
  setInlineEditorSize,
}: UseViewerZoomParams) {
  const [zoomLevel, setZoomLevel] = useState<number>(1.00);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit-width');

  // Per-page label font scale (user-controlled, persisted in Report)
  const [pageFontScales, setPageFontScales] = useState<Record<number, number>>({});
  const pageFontScalesRef = useRef(pageFontScales);
  pageFontScalesRef.current = pageFontScales;
  const labelFontScale = pageFontScales[currentPageIndex] ?? 1.0;
  const fontScaleRef = useRef(labelFontScale);
  fontScaleRef.current = labelFontScale;

  // Label font family (user-controlled, persisted in Report)
  const [fontFamily, setFontFamily] = useState<LabelFontFamily>(REVDOKU_DEFAULT_LABEL_FONT_FAMILY);
  const fontFamilyRef = useRef(fontFamily);
  fontFamilyRef.current = fontFamily;

  // Highlight drawing mode (user-controlled, persisted in Report's pages_layout_json)
  const [highlightMode, setHighlightMode] = useState<HighlightMode>(REVDOKU_DEFAULT_HIGHLIGHT_MODE);
  const highlightModeRef = useRef(highlightMode);
  highlightModeRef.current = highlightMode;

  // Sync pageFontScales, fontFamily, and highlightMode from report when a different report is loaded.
  // Only depends on report ID — NOT on highlight_mode — so editing/saving a checklist snapshot
  // does not override the user's current highlight mode selection.
  useEffect(() => {
    if (currentReport?.page_font_scales && Object.keys(currentReport.page_font_scales).length > 0) {
      const scales: Record<number, number> = {};
      for (const [k, v] of Object.entries(currentReport.page_font_scales)) {
        scales[Number(k)] = v;
      }
      setPageFontScales(scales);
    } else if (currentReport?.label_font_scale != null && currentReport.label_font_scale !== 1.0) {
      setPageFontScales({});
    } else {
      setPageFontScales({});
    }
    setFontFamily(currentReport?.font_family || REVDOKU_DEFAULT_LABEL_FONT_FAMILY);
    setHighlightMode(currentReport?.highlight_mode ?? REVDOKU_DEFAULT_HIGHLIGHT_MODE);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentReport?.id]);

  // Clear persisted inline editor size when fontScale changes
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('revdoku_inline_editor_size');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.fontScale !== labelFontScale) {
          sessionStorage.removeItem('revdoku_inline_editor_size');
          setInlineEditorSize(null);
        }
      }
    } catch { /* ignore */ }
  }, [labelFontScale]);

  // Font scale save via useAutoSave (debounced 1s so rapid A+/A- clicks coalesce)
  const fontScaleSaveFunction = useCallback(async () => {
    if (currentReport?.id) {
      await trackSave(ApiClient.updateReportFontScale(currentReport.id, pageFontScalesRef.current));
    }
  }, [currentReport?.id, trackSave]);

  const { debouncedSave: debouncedSaveFontScale, saveImmediately: saveFontScaleImmediately } =
    useAutoSave(fontScaleSaveFunction, 1000);

  // Font family save via useAutoSave (debounced 1s so rapid changes coalesce)
  const fontFamilySaveFunction = useCallback(async () => {
    if (currentReport?.id) {
      await trackSave(ApiClient.updateReportFontFamily(currentReport.id, fontFamilyRef.current));
    }
  }, [currentReport?.id, trackSave]);

  const { debouncedSave: debouncedSaveFontFamily } =
    useAutoSave(fontFamilySaveFunction, 1000);

  // Highlight mode save via useAutoSave
  const highlightModeSaveFunction = useCallback(async () => {
    if (currentReport?.id) {
      await trackSave(ApiClient.updateReportHighlightMode(currentReport.id, highlightModeRef.current));
    }
  }, [currentReport?.id, trackSave]);

  const { debouncedSave: debouncedSaveHighlightMode } =
    useAutoSave(highlightModeSaveFunction, 500);

  const handleZoomIn = () => {
    setZoomMode('custom');
    setZoomLevel((prev) => {
      const next = ZOOM_PRESETS.find(p => p > prev + 0.001);
      if (next) return next;
      return Math.min(10.0, prev * 1.5);
    });
  };

  const handleZoomOut = () => {
    setZoomMode('custom');
    setZoomLevel((prev) => {
      const next = [...ZOOM_PRESETS].reverse().find(p => p < prev - 0.001);
      if (next) return next;
      return Math.max(0.01, prev / 2);
    });
  };

  const handleFontScaleUp = () => {
    setPageFontScales(prev => {
      const current = prev[currentPageIndex] ?? 1.0;
      return { ...prev, [currentPageIndex]: Math.min(current + 0.25, 3.0) };
    });
    debouncedSaveFontScale();
  };

  const handleFontScaleDown = () => {
    setPageFontScales(prev => {
      const current = prev[currentPageIndex] ?? 1.0;
      return { ...prev, [currentPageIndex]: Math.max(current - 0.25, 0.25) };
    });
    debouncedSaveFontScale();
  };

  const handleFontScaleReset = () => {
    setPageFontScales(prev => {
      return { ...prev, [currentPageIndex]: 1.0 };
    });
    debouncedSaveFontScale();
  };

  const handleFontFamilyChange = (value: LabelFontFamily) => {
    setFontFamily(value);
    debouncedSaveFontFamily();
  };

  const handleHighlightModeChange = (value: HighlightMode) => {
    setHighlightMode(value);
    debouncedSaveHighlightMode();
  };

  const handleZoomSelect = (
    mode: ZoomMode,
    level?: number,
    overhangs?: { left: number; right: number; top: number; bottom: number },
  ) => {
    const oh = overhangs ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const totalH = oh.left + oh.right;
    setZoomMode(mode);
    if (mode === 'custom' && level != null) {
      setZoomLevel(level);
    } else if (mode === 'fit-width') {
      setZoomLevel(totalH <= 0 ? 1.0 : Math.max(MIN_FIT_ZOOM, (viewerWidth - totalH) / viewerWidth));
    } else if (mode === 'fit-page') {
      const pageDims = documentPagesToDisplayImageDimensions[currentPageIndex];
      if (pageDims) {
        const aspectRatio = pageDims.original_height / pageDims.original_width;
        const totalV = oh.top + oh.bottom;

        // Analytical height zoom: overhangs scale with zoom
        // z = viewerHeight / (viewerWidth * aspectRatio + totalV / currentZoom)
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

        setZoomLevel(Math.max(MIN_FIT_ZOOM, Math.min(10.0, heightZoom, widthZoom)));
      } else {
        setZoomLevel(1.0);
      }
    }
  };

  return {
    zoomLevel,
    setZoomLevel,
    zoomMode,
    setZoomMode,
    pageFontScales,
    setPageFontScales,
    labelFontScale,
    fontScaleRef,
    fontFamily,
    highlightMode,
    handleZoomIn,
    handleZoomOut,
    handleFontScaleUp,
    handleFontScaleDown,
    handleFontScaleReset,
    handleFontFamilyChange,
    handleHighlightModeChange,
    handleZoomSelect,
    saveFontScaleImmediately,
  };
}
