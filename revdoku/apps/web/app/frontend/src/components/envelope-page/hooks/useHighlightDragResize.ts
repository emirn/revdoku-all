import { useState, useRef } from "react";
import {
  ICoordinates,
  IReport,
  ICheck,
  getWidth,
  getHeight,
} from "@revdoku/lib";
import type { HintPlacementResultExtended } from "@revdoku/lib";
import { updateLeaderDOM } from "./highlight-utils";
import { ApiClient } from "@/lib/api-client";

interface UseHighlightDragResizeParams {
  isEditingDisabled: boolean;
  currentReportRef: React.MutableRefObject<IReport | null>;
  currentPageIndexRef: React.MutableRefObject<number>;
  labelPlacementMapRef: React.MutableRefObject<Map<string, HintPlacementResultExtended>>;
  labelGeometryRef: React.MutableRefObject<{ renderedPageWidth: number; renderedPageHeight: number; labelPlacementMap: Map<string, HintPlacementResultExtended> } | null>;
  scaleCoordinatesToCurrentViewer: (coordinates: ICoordinates, pageIndex: number) => ICoordinates;
  scaleCoordinatesFromCurrentViewerToPDF: (screenCoordinates: ICoordinates) => ICoordinates;
  setCurrentReport: React.Dispatch<React.SetStateAction<IReport | null>>;
  updateReportInBothStates: (report: IReport) => void;
  updateCheckInReport: (check: ICheck) => void;
  trackSave: <T>(promise: Promise<T>) => Promise<T>;
}

export function useHighlightDragResize({
  isEditingDisabled,
  currentReportRef,
  currentPageIndexRef,
  labelPlacementMapRef,
  labelGeometryRef,
  scaleCoordinatesToCurrentViewer,
  scaleCoordinatesFromCurrentViewerToPDF,
  setCurrentReport,
  updateReportInBothStates,
  updateCheckInReport,
  trackSave,
}: UseHighlightDragResizeParams) {
  // Drag state for moving highlights
  const [isDraggingHighlight, setIsDraggingHighlight] = useState(false);
  const isDraggingHighlightRef = useRef(false);
  const dragHighlightCheckIdRef = useRef<string | null>(null);
  const dragHighlightStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragHighlightOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragHighlightElRef = useRef<HTMLElement | null>(null);
  const wasDraggingHighlightRef = useRef(false);
  // Capture the viewer container element at drag start (for continuous mode with multiple containers)
  const dragViewerContainerRef = useRef<HTMLElement | null>(null);
  const dragStartPageRef = useRef<number>(0);

  // Resize state for resizing highlights
  const [isResizingHighlight, setIsResizingHighlight] = useState(false);
  const isResizingHighlightRef = useRef(false);
  const resizeHighlightCheckIdRef = useRef<string | null>(null);
  const resizeHighlightHandleRef = useRef<"se" | "sw" | "ne" | "nw" | "e" | "w" | "n" | "s" | null>(null);
  const resizeHighlightStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const resizeHighlightOffsetRef = useRef<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 0, height: 0 });
  const resizeHighlightElRef = useRef<HTMLElement | null>(null);

  // --- Drag handlers for moving highlights ---

  const handleHighlightMouseMove = (e: MouseEvent) => {
    if (!isDraggingHighlightRef.current || !dragHighlightCheckIdRef.current || !dragHighlightStartPosRef.current)
      return;

    e.preventDefault();
    e.stopPropagation();

    const viewerContainer = dragViewerContainerRef.current
      ?? document.querySelector('[data-document-viewer="true"]') as HTMLElement;
    if (!viewerContainer) return;

    const rect = viewerContainer.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const newOffset = {
      x: currentX - dragHighlightStartPosRef.current.x,
      y: currentY - dragHighlightStartPosRef.current.y,
    };

    dragHighlightOffsetRef.current = newOffset;
    if (dragHighlightElRef.current) {
      dragHighlightElRef.current.style.transform = `translate(${newOffset.x}px, ${newOffset.y}px)`;
    }
    // Update SVG connector to follow dragged highlight
    const checkId = dragHighlightCheckIdRef.current;
    const lp = labelPlacementMapRef.current.get(checkId);
    const geo = labelGeometryRef.current;
    const report = currentReportRef.current;
    if (lp && geo && report) {
      const check = report.checks.find(c => c.id === checkId);
      if (check) {
        const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, dragStartPageRef.current);
        const hlRect = { x: sc.x1 + newOffset.x, y: sc.y1 + newOffset.y, width: getWidth(sc), height: getHeight(sc) };
        updateLeaderDOM(checkId, hlRect, lp.labelBox, geo.renderedPageWidth);
      }
    }
  };

  const handleHighlightTouchMove = (e: TouchEvent) => {
    if (!isDraggingHighlightRef.current || !dragHighlightCheckIdRef.current || !dragHighlightStartPosRef.current)
      return;

    e.preventDefault();
    e.stopPropagation();

    const touch = e.touches[0];
    if (!touch) return;

    const viewerContainer = document.querySelector(
      '[data-document-viewer="true"]',
    ) as HTMLElement;
    if (!viewerContainer) return;

    const rect = viewerContainer.getBoundingClientRect();
    const currentX = touch.clientX - rect.left;
    const currentY = touch.clientY - rect.top;

    const newOffset = {
      x: currentX - dragHighlightStartPosRef.current.x,
      y: currentY - dragHighlightStartPosRef.current.y,
    };

    dragHighlightOffsetRef.current = newOffset;
    if (dragHighlightElRef.current) {
      dragHighlightElRef.current.style.transform = `translate(${newOffset.x}px, ${newOffset.y}px)`;
    }
    // Update SVG connector to follow dragged highlight (touch)
    const checkId = dragHighlightCheckIdRef.current;
    const lp = labelPlacementMapRef.current.get(checkId);
    const geo = labelGeometryRef.current;
    const report = currentReportRef.current;
    if (lp && geo && report) {
      const check = report.checks.find(c => c.id === checkId);
      if (check) {
        const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, currentPageIndexRef.current);
        const hlRect = { x: sc.x1 + newOffset.x, y: sc.y1 + newOffset.y, width: getWidth(sc), height: getHeight(sc) };
        updateLeaderDOM(checkId, hlRect, lp.labelBox, geo.renderedPageWidth);
      }
    }
  };

  const handleHighlightDocumentMouseUp = async () => {
    if (!isDraggingHighlightRef.current || !dragHighlightCheckIdRef.current) return;

    document.removeEventListener("mousemove", handleHighlightMouseMove);
    document.removeEventListener("mouseup", handleHighlightDocumentMouseUp);

    const checkId = dragHighlightCheckIdRef.current;
    const offset = dragHighlightOffsetRef.current;

    const hadMovement = offset.x !== 0 || offset.y !== 0;
    wasDraggingHighlightRef.current = hadMovement;
    if (hadMovement) {
      setTimeout(() => { wasDraggingHighlightRef.current = false; }, 0);
    }

    const report = currentReportRef.current;
    let newPdfCoords: ICoordinates | null = null;
    if (
      report && hadMovement
    ) {
      const checkIndex = report.checks.findIndex(
        (c) => c.id === checkId,
      );
      if (checkIndex !== -1 && report.checks[checkIndex]) {
        const check = report.checks[checkIndex];

        const originalScreenCoords: ICoordinates =
          scaleCoordinatesToCurrentViewer(check as ICoordinates, currentPageIndexRef.current);

        const newScreenCoords: ICoordinates = {
          x1: originalScreenCoords.x1 + offset.x,
          y1: originalScreenCoords.y1 + offset.y,
          x2: originalScreenCoords.x2 + offset.x,
          y2: originalScreenCoords.y2 + offset.y,
        };

        newPdfCoords = scaleCoordinatesFromCurrentViewerToPDF(newScreenCoords);

        setCurrentReport(prev => {
          if (!prev) return prev;
          const idx = prev.checks.findIndex(c => c.id === checkId);
          if (idx === -1) return prev;
          const updatedChecks = [...prev.checks];
          updatedChecks[idx] = { ...updatedChecks[idx], ...newPdfCoords! };
          return { ...prev, checks: updatedChecks };
        });
      }
    }

    if (dragHighlightElRef.current) {
      dragHighlightElRef.current.style.transform = '';
    }
    dragHighlightElRef.current = null;

    dragHighlightOffsetRef.current = { x: 0, y: 0 };
    isDraggingHighlightRef.current = false;
    dragHighlightCheckIdRef.current = null;
    dragHighlightStartPosRef.current = null;
    setIsDraggingHighlight(false);

    document.body.style.userSelect = "";

    if (newPdfCoords) {
      try {
        const result = await trackSave(ApiClient.updateCheck(checkId, {
          x1: newPdfCoords.x1,
          y1: newPdfCoords.y1,
          x2: newPdfCoords.x2,
          y2: newPdfCoords.y2
        }));

        if (result.report?.report) {
          updateReportInBothStates(result.report.report);
        } else if (result.check) {
          updateCheckInReport(result.check);
        }
      } catch (error) {
        console.error('Failed to update check coordinates:', error);
      }
    }
  };

  const handleHighlightTouchEnd = () => {
    document.removeEventListener("touchmove", handleHighlightTouchMove);
    document.removeEventListener("touchend", handleHighlightTouchEnd);

    if (!isDraggingHighlightRef.current || !dragHighlightCheckIdRef.current) return;

    const checkId = dragHighlightCheckIdRef.current;
    const offset = dragHighlightOffsetRef.current;

    const report = currentReportRef.current;
    let newPdfCoords: ICoordinates | null = null;
    if (report && (offset.x !== 0 || offset.y !== 0)) {
      const checkIndex = report.checks.findIndex((c) => c.id === checkId);
      if (checkIndex !== -1 && report.checks[checkIndex]) {
        const check = report.checks[checkIndex];
        const originalScreenCoords = scaleCoordinatesToCurrentViewer(check as ICoordinates, currentPageIndexRef.current);
        const newScreenCoords = {
          x1: originalScreenCoords.x1 + offset.x,
          y1: originalScreenCoords.y1 + offset.y,
          x2: originalScreenCoords.x2 + offset.x,
          y2: originalScreenCoords.y2 + offset.y,
        };
        newPdfCoords = scaleCoordinatesFromCurrentViewerToPDF(newScreenCoords);

        setCurrentReport(prev => {
          if (!prev) return prev;
          const idx = prev.checks.findIndex(c => c.id === checkId);
          if (idx === -1) return prev;
          const updatedChecks = [...prev.checks];
          updatedChecks[idx] = { ...updatedChecks[idx], ...newPdfCoords! };
          return { ...prev, checks: updatedChecks };
        });
      }
    }

    if (dragHighlightElRef.current) {
      dragHighlightElRef.current.style.transform = '';
    }
    dragHighlightElRef.current = null;

    dragHighlightOffsetRef.current = { x: 0, y: 0 };
    isDraggingHighlightRef.current = false;
    dragHighlightCheckIdRef.current = null;
    dragHighlightStartPosRef.current = null;
    setIsDraggingHighlight(false);
    document.body.style.userSelect = "";

    if (newPdfCoords) {
      trackSave(ApiClient.updateCheck(checkId, {
        x1: newPdfCoords.x1, y1: newPdfCoords.y1, x2: newPdfCoords.x2, y2: newPdfCoords.y2
      })).then(result => {
        if (result.report?.report) updateReportInBothStates(result.report.report);
        else if (result.check) updateCheckInReport(result.check);
      }).catch(error => console.error('Failed to update check coordinates:', error));
    }
  };

  const handleHighlightMouseDown = (
    e: React.MouseEvent,
    id: string,
    _highlightCoords: ICoordinates,
  ) => {
    if (isEditingDisabled || e.button !== 0) return;
    e.stopPropagation();

    // Find the nearest viewer container (handles continuous mode with multiple containers)
    const viewerContainer = (e.target as HTMLElement).closest('[data-document-viewer="true"]') as HTMLElement
      ?? document.querySelector('[data-document-viewer="true"]') as HTMLElement;
    if (!viewerContainer) return;

    // Capture page index from container's data attribute
    const pageAttr = viewerContainer.getAttribute('data-page-index');
    dragStartPageRef.current = pageAttr != null ? parseInt(pageAttr, 10) : currentPageIndexRef.current;
    dragViewerContainerRef.current = viewerContainer;

    const rect = viewerContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    isDraggingHighlightRef.current = true;
    dragHighlightCheckIdRef.current = id;
    dragHighlightStartPosRef.current = { x: mouseX, y: mouseY };
    dragHighlightOffsetRef.current = { x: 0, y: 0 };
    wasDraggingHighlightRef.current = false;

    dragHighlightElRef.current = document.querySelector(`[data-check-id="${id}"]`) as HTMLElement | null;

    document.body.style.userSelect = "none";

    document.addEventListener("mousemove", handleHighlightMouseMove, { passive: false });
    document.addEventListener("mouseup", handleHighlightDocumentMouseUp);

    setIsDraggingHighlight(true);
  };

  const highlightTouchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHighlightTouchStart = (
    e: React.TouchEvent,
    id: string,
    _highlightCoords: ICoordinates,
  ) => {
    if (isEditingDisabled) return;
    e.stopPropagation();
    // Don't preventDefault yet — allow scrolling during long-press delay

    const touch = e.touches[0];
    if (!touch) return;
    const startX = touch.clientX;
    const startY = touch.clientY;

    // Cancel long-press if finger moves (user is scrolling)
    const cancelLongPress = () => {
      if (highlightTouchTimerRef.current) {
        clearTimeout(highlightTouchTimerRef.current);
        highlightTouchTimerRef.current = null;
      }
      document.removeEventListener('touchmove', onMoveCancel);
      document.removeEventListener('touchend', cancelLongPress);
    };
    const onMoveCancel = (ev: TouchEvent) => {
      const t = ev.touches[0];
      if (t && (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10)) {
        cancelLongPress();
      }
    };
    document.addEventListener('touchmove', onMoveCancel, { passive: true });
    document.addEventListener('touchend', cancelLongPress, { once: true });

    highlightTouchTimerRef.current = setTimeout(() => {
      highlightTouchTimerRef.current = null;
      document.removeEventListener('touchmove', onMoveCancel);
      document.removeEventListener('touchend', cancelLongPress);

      // Long-press confirmed — start drag
      const viewerContainer = document.querySelector(
        '[data-document-viewer="true"]',
      ) as HTMLElement;
      if (!viewerContainer) return;

      const rect = viewerContainer.getBoundingClientRect();
      const touchX = startX - rect.left;
      const touchY = startY - rect.top;

      isDraggingHighlightRef.current = true;
      dragHighlightCheckIdRef.current = id;
      dragHighlightStartPosRef.current = { x: touchX, y: touchY };
      dragHighlightOffsetRef.current = { x: 0, y: 0 };
      wasDraggingHighlightRef.current = false;

      dragHighlightElRef.current = document.querySelector(`[data-check-id="${id}"]`) as HTMLElement | null;

      document.body.style.userSelect = "none";

      document.addEventListener("touchmove", handleHighlightTouchMove, { passive: false });
      document.addEventListener("touchend", handleHighlightTouchEnd);

      setIsDraggingHighlight(true);
    }, 300);
  };

  // --- Resize handlers for resizing highlights ---

  const handleResizeMouseMove = (e: MouseEvent) => {
    if (
      !isResizingHighlightRef.current ||
      !resizeHighlightCheckIdRef.current ||
      !resizeHighlightStartPosRef.current ||
      !resizeHighlightHandleRef.current
    )
      return;

    const viewerContainer = document.querySelector(
      '[data-document-viewer="true"]',
    ) as HTMLElement;
    if (!viewerContainer) return;

    const rect = viewerContainer.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const deltaX = currentX - resizeHighlightStartPosRef.current.x;
    const deltaY = currentY - resizeHighlightStartPosRef.current.y;

    let newOffset = { x: 0, y: 0, width: 0, height: 0 };

    switch (resizeHighlightHandleRef.current) {
      case "se":
        newOffset = { x: 0, y: 0, width: deltaX, height: deltaY };
        break;
      case "sw":
        newOffset = { x: deltaX, y: 0, width: -deltaX, height: deltaY };
        break;
      case "ne":
        newOffset = { x: 0, y: deltaY, width: deltaX, height: -deltaY };
        break;
      case "nw":
        newOffset = { x: deltaX, y: deltaY, width: -deltaX, height: -deltaY };
        break;
      case "e":
        newOffset = { x: 0, y: 0, width: deltaX, height: 0 };
        break;
      case "w":
        newOffset = { x: deltaX, y: 0, width: -deltaX, height: 0 };
        break;
      case "n":
        newOffset = { x: 0, y: deltaY, width: 0, height: -deltaY };
        break;
      case "s":
        newOffset = { x: 0, y: 0, width: 0, height: deltaY };
        break;
    }

    resizeHighlightOffsetRef.current = newOffset;
    if (resizeHighlightElRef.current) {
      resizeHighlightElRef.current.style.transform = `translate(${newOffset.x}px, ${newOffset.y}px)`;
      if (newOffset.width !== 0 || newOffset.height !== 0) {
        const currentWidth = parseFloat(resizeHighlightElRef.current.dataset.baseWidth || '0');
        const currentHeight = parseFloat(resizeHighlightElRef.current.dataset.baseHeight || '0');
        if (currentWidth > 0) {
          resizeHighlightElRef.current.style.width = `${Math.max(20, currentWidth + newOffset.width)}px`;
        }
        if (currentHeight > 0) {
          resizeHighlightElRef.current.style.height = `${Math.max(20, currentHeight + newOffset.height)}px`;
        }
      }
    }
  };

  const handleResizeDocumentMouseUp = async () => {
    if (!isResizingHighlightRef.current || !resizeHighlightCheckIdRef.current) return;

    document.removeEventListener("mousemove", handleResizeMouseMove);
    document.removeEventListener("mouseup", handleResizeDocumentMouseUp);

    const checkId = resizeHighlightCheckIdRef.current;
    const offset = resizeHighlightOffsetRef.current;

    wasDraggingHighlightRef.current = true;
    setTimeout(() => { wasDraggingHighlightRef.current = false; }, 0);

    const report = currentReportRef.current;
    let newPdfCoords: ICoordinates | null = null;
    if (
      report &&
      (offset.x !== 0 ||
        offset.y !== 0 ||
        offset.width !== 0 ||
        offset.height !== 0)
    ) {
      const checkIndex = report.checks.findIndex(
        (c) => c.id === checkId,
      );
      if (checkIndex !== -1 && report.checks[checkIndex]) {
        const check = report.checks[checkIndex];

        const originalScreenCoords = scaleCoordinatesToCurrentViewer(
          check as ICoordinates,
          currentPageIndexRef.current,
        );

        const newScreenCoords = {
          x1: originalScreenCoords.x1 + offset.x,
          y1: originalScreenCoords.y1 + offset.y,
          x2: Math.max(
            20,
            originalScreenCoords.x2 + offset.width,
          ),
          y2: Math.max(
            20,
            originalScreenCoords.y2 + offset.height,
          ),
        };

        newPdfCoords = scaleCoordinatesFromCurrentViewerToPDF(newScreenCoords);

        setCurrentReport(prev => {
          if (!prev) return prev;
          const idx = prev.checks.findIndex(c => c.id === checkId);
          if (idx === -1) return prev;
          const updatedChecks = [...prev.checks];
          updatedChecks[idx] = { ...updatedChecks[idx], ...newPdfCoords! };
          return { ...prev, checks: updatedChecks };
        });
      }
    }

    if (resizeHighlightElRef.current) {
      resizeHighlightElRef.current.style.transform = '';
      resizeHighlightElRef.current.style.width = '';
      resizeHighlightElRef.current.style.height = '';
    }
    resizeHighlightElRef.current = null;

    resizeHighlightOffsetRef.current = { x: 0, y: 0, width: 0, height: 0 };
    isResizingHighlightRef.current = false;
    resizeHighlightCheckIdRef.current = null;
    resizeHighlightHandleRef.current = null;
    resizeHighlightStartPosRef.current = null;
    setIsResizingHighlight(false);

    document.body.style.userSelect = "";

    if (newPdfCoords) {
      try {
        const result = await trackSave(ApiClient.updateCheck(checkId, {
          x1: newPdfCoords.x1,
          y1: newPdfCoords.y1,
          x2: newPdfCoords.x2,
          y2: newPdfCoords.y2
        }));

        if (result.report?.report) {
          updateReportInBothStates(result.report.report);
        } else if (result.check) {
          updateCheckInReport(result.check);
        }
      } catch (error) {
        console.error('Failed to update check coordinates:', error);
      }
    }
  };

  const handleResizeMouseDown = (
    e: React.MouseEvent,
    id: string,
    handle: "se" | "sw" | "ne" | "nw" | "e" | "w" | "n" | "s",
  ) => {
    if (isEditingDisabled || e.button !== 0) return;
    e.stopPropagation();

    const viewerContainer = document.querySelector(
      '[data-document-viewer="true"]',
    ) as HTMLElement;
    if (!viewerContainer) return;

    const rect = viewerContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    isResizingHighlightRef.current = true;
    resizeHighlightCheckIdRef.current = id;
    resizeHighlightHandleRef.current = handle;
    resizeHighlightStartPosRef.current = { x: mouseX, y: mouseY };
    resizeHighlightOffsetRef.current = { x: 0, y: 0, width: 0, height: 0 };
    wasDraggingHighlightRef.current = false;

    resizeHighlightElRef.current = document.querySelector(`[data-check-id="${id}"]`) as HTMLElement | null;

    document.body.style.userSelect = "none";

    document.addEventListener("mousemove", handleResizeMouseMove);
    document.addEventListener("mouseup", handleResizeDocumentMouseUp);

    setIsResizingHighlight(true);
  };

  // --- Touch resize handlers for highlights ---

  const handleResizeTouchMove = (e: TouchEvent) => {
    if (
      !isResizingHighlightRef.current ||
      !resizeHighlightCheckIdRef.current ||
      !resizeHighlightStartPosRef.current ||
      !resizeHighlightHandleRef.current
    )
      return;

    e.preventDefault();

    const touch = e.touches[0];
    if (!touch) return;

    const viewerContainer = document.querySelector(
      '[data-document-viewer="true"]',
    ) as HTMLElement;
    if (!viewerContainer) return;

    const rect = viewerContainer.getBoundingClientRect();
    const currentX = touch.clientX - rect.left;
    const currentY = touch.clientY - rect.top;

    const deltaX = currentX - resizeHighlightStartPosRef.current.x;
    const deltaY = currentY - resizeHighlightStartPosRef.current.y;

    let newOffset = { x: 0, y: 0, width: 0, height: 0 };

    switch (resizeHighlightHandleRef.current) {
      case "se":
        newOffset = { x: 0, y: 0, width: deltaX, height: deltaY };
        break;
      case "sw":
        newOffset = { x: deltaX, y: 0, width: -deltaX, height: deltaY };
        break;
      case "ne":
        newOffset = { x: 0, y: deltaY, width: deltaX, height: -deltaY };
        break;
      case "nw":
        newOffset = { x: deltaX, y: deltaY, width: -deltaX, height: -deltaY };
        break;
      case "e":
        newOffset = { x: 0, y: 0, width: deltaX, height: 0 };
        break;
      case "w":
        newOffset = { x: deltaX, y: 0, width: -deltaX, height: 0 };
        break;
      case "n":
        newOffset = { x: 0, y: deltaY, width: 0, height: -deltaY };
        break;
      case "s":
        newOffset = { x: 0, y: 0, width: 0, height: deltaY };
        break;
    }

    resizeHighlightOffsetRef.current = newOffset;
    if (resizeHighlightElRef.current) {
      resizeHighlightElRef.current.style.transform = `translate(${newOffset.x}px, ${newOffset.y}px)`;
      if (newOffset.width !== 0 || newOffset.height !== 0) {
        const currentWidth = parseFloat(resizeHighlightElRef.current.dataset.baseWidth || '0');
        const currentHeight = parseFloat(resizeHighlightElRef.current.dataset.baseHeight || '0');
        if (currentWidth > 0) {
          resizeHighlightElRef.current.style.width = `${Math.max(20, currentWidth + newOffset.width)}px`;
        }
        if (currentHeight > 0) {
          resizeHighlightElRef.current.style.height = `${Math.max(20, currentHeight + newOffset.height)}px`;
        }
      }
    }
  };

  const handleResizeTouchEnd = () => {
    document.removeEventListener("touchmove", handleResizeTouchMove);
    document.removeEventListener("touchend", handleResizeTouchEnd);

    if (!isResizingHighlightRef.current || !resizeHighlightCheckIdRef.current) return;

    const checkId = resizeHighlightCheckIdRef.current;
    const offset = resizeHighlightOffsetRef.current;

    wasDraggingHighlightRef.current = true;
    setTimeout(() => { wasDraggingHighlightRef.current = false; }, 0);

    const report = currentReportRef.current;
    let newPdfCoords: ICoordinates | null = null;
    if (
      report &&
      (offset.x !== 0 || offset.y !== 0 || offset.width !== 0 || offset.height !== 0)
    ) {
      const checkIndex = report.checks.findIndex((c) => c.id === checkId);
      if (checkIndex !== -1 && report.checks[checkIndex]) {
        const check = report.checks[checkIndex];
        const originalScreenCoords = scaleCoordinatesToCurrentViewer(
          check as ICoordinates,
          currentPageIndexRef.current,
        );
        const newScreenCoords = {
          x1: originalScreenCoords.x1 + offset.x,
          y1: originalScreenCoords.y1 + offset.y,
          x2: Math.max(20, originalScreenCoords.x2 + offset.width),
          y2: Math.max(20, originalScreenCoords.y2 + offset.height),
        };
        newPdfCoords = scaleCoordinatesFromCurrentViewerToPDF(newScreenCoords);

        setCurrentReport(prev => {
          if (!prev) return prev;
          const idx = prev.checks.findIndex(c => c.id === checkId);
          if (idx === -1) return prev;
          const updatedChecks = [...prev.checks];
          updatedChecks[idx] = { ...updatedChecks[idx], ...newPdfCoords! };
          return { ...prev, checks: updatedChecks };
        });
      }
    }

    if (resizeHighlightElRef.current) {
      resizeHighlightElRef.current.style.transform = '';
      resizeHighlightElRef.current.style.width = '';
      resizeHighlightElRef.current.style.height = '';
    }
    resizeHighlightElRef.current = null;

    resizeHighlightOffsetRef.current = { x: 0, y: 0, width: 0, height: 0 };
    isResizingHighlightRef.current = false;
    resizeHighlightCheckIdRef.current = null;
    resizeHighlightHandleRef.current = null;
    resizeHighlightStartPosRef.current = null;
    setIsResizingHighlight(false);
    document.body.style.userSelect = "";

    if (newPdfCoords) {
      trackSave(ApiClient.updateCheck(checkId, {
        x1: newPdfCoords.x1, y1: newPdfCoords.y1, x2: newPdfCoords.x2, y2: newPdfCoords.y2
      })).then(result => {
        if (result.report?.report) updateReportInBothStates(result.report.report);
        else if (result.check) updateCheckInReport(result.check);
      }).catch(error => console.error('Failed to update check coordinates:', error));
    }
  };

  const handleResizeTouchStart = (
    e: React.TouchEvent,
    id: string,
    handle: "se" | "sw" | "ne" | "nw" | "e" | "w" | "n" | "s",
  ) => {
    if (isEditingDisabled) return;
    e.stopPropagation();
    e.preventDefault();

    const touch = e.touches[0];
    if (!touch) return;

    const viewerContainer = document.querySelector(
      '[data-document-viewer="true"]',
    ) as HTMLElement;
    if (!viewerContainer) return;

    const rect = viewerContainer.getBoundingClientRect();
    const touchX = touch.clientX - rect.left;
    const touchY = touch.clientY - rect.top;

    isResizingHighlightRef.current = true;
    resizeHighlightCheckIdRef.current = id;
    resizeHighlightHandleRef.current = handle;
    resizeHighlightStartPosRef.current = { x: touchX, y: touchY };
    resizeHighlightOffsetRef.current = { x: 0, y: 0, width: 0, height: 0 };
    wasDraggingHighlightRef.current = false;

    resizeHighlightElRef.current = document.querySelector(`[data-check-id="${id}"]`) as HTMLElement | null;

    document.body.style.userSelect = "none";

    document.addEventListener("touchmove", handleResizeTouchMove, { passive: false });
    document.addEventListener("touchend", handleResizeTouchEnd);

    setIsResizingHighlight(true);
  };

  return {
    isDraggingHighlight,
    isResizingHighlight,
    wasDraggingHighlightRef,
    handleHighlightMouseDown,
    handleHighlightTouchStart,
    handleResizeMouseDown,
    handleResizeTouchStart,
  };
}
