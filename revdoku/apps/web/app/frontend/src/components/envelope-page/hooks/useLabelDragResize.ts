import { useState, useRef, useEffect } from "react";
import {
  ICoordinates,
  IReport,
  ICheck,
  getWidth,
  getHeight,
} from "@revdoku/lib";
import { PlacementSide } from "@revdoku/lib";
import type { HintPlacementResultExtended, ICheckDescriptionPosition } from "@revdoku/lib";
import { updateLeaderDOM } from "./highlight-utils";
import { ApiClient } from "@/lib/api-client";

interface UseLabelDragResizeParams {
  isEditingDisabled: boolean;
  currentReportRef: React.MutableRefObject<IReport | null>;
  currentPageIndexRef: React.MutableRefObject<number>;
  labelPlacementMapRef: React.MutableRefObject<Map<string, HintPlacementResultExtended>>;
  labelGeometryRef: React.MutableRefObject<{ renderedPageWidth: number; renderedPageHeight: number; labelPlacementMap: Map<string, HintPlacementResultExtended> } | null>;
  labelDragScaleRef: React.MutableRefObject<{ scaleX: number; scaleY: number; renderedPageWidth: number; pageOrigWidth: number }>;
  draggedLabelPositionsRef: React.MutableRefObject<Map<string, { x: number; y: number }>>;
  labelResizeActiveRef: React.MutableRefObject<boolean>;
  scaleCoordinatesToCurrentViewer: (coordinates: ICoordinates, pageIndex: number) => ICoordinates;
  setCurrentReport: React.Dispatch<React.SetStateAction<IReport | null>>;
  updateCheckInReport: (check: ICheck) => void;
  currentReport: IReport | null;
  currentPageIndex: number;
  zoomLevel: number;
}

export function useLabelDragResize({
  isEditingDisabled,
  currentReportRef,
  currentPageIndexRef,
  labelPlacementMapRef,
  labelGeometryRef,
  labelDragScaleRef,
  draggedLabelPositionsRef,
  labelResizeActiveRef,
  scaleCoordinatesToCurrentViewer,
  setCurrentReport,
  updateCheckInReport,
  currentReport,
  currentPageIndex,
  zoomLevel,
}: UseLabelDragResizeParams) {
  const draggedLabelElRef = useRef<HTMLElement | null>(null);
  const [draggingLabelId, setDraggingLabelId] = useState<string | null>(null);
  const dragLabelStartRef = useRef<{ x: number; y: number; startLabelX: number; startLabelY: number } | null>(null);

  // Label resize state (edge + corner resize)
  const [isResizingLabel, setIsResizingLabel] = useState(false);
  const [resizeLabelCheckId, setResizeLabelCheckId] = useState<string | null>(null);
  const [resizeLabelHandle, setResizeLabelHandle] = useState<'e' | 'w' | 'n' | 's' | 'se' | 'sw' | 'ne' | 'nw' | null>(null);
  // Refs mirroring state — used in event handler closures to avoid stale reads
  const isResizingLabelRef = useRef(false);
  const resizeLabelCheckIdRef = useRef<string | null>(null);
  const resizeLabelHandleRef = useRef<'e' | 'w' | 'n' | 's' | 'se' | 'sw' | 'ne' | 'nw' | null>(null);
  const resizeLabelStartXRef = useRef<number>(0);
  const resizeLabelStartYRef = useRef<number>(0);
  const resizeLabelWidthDeltaRef = useRef(0);
  const resizeLabelXDeltaRef = useRef(0);
  const resizeLabelHeightDeltaRef = useRef(0);
  const resizeLabelYDeltaRef = useRef(0);
  const resizeLabelElRef = useRef<HTMLElement | null>(null);

  // Label drag handlers (useEffect for move/up listeners)
  useEffect(() => {
    if (!draggingLabelId) return;

    const labelEl = document.querySelector(`[data-label-id="${draggingLabelId}"]`) as HTMLElement | null;
    draggedLabelElRef.current = labelEl;

    const handleMouseMove = (e: MouseEvent) => {
      const start = dragLabelStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const newPos = {
        x: start.startLabelX + dx,
        y: start.startLabelY + dy,
      };
      draggedLabelPositionsRef.current.set(draggingLabelId, newPos);
      if (draggedLabelElRef.current) {
        draggedLabelElRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      // Update SVG connector to follow dragged label
      const lp = labelPlacementMapRef.current.get(draggingLabelId);
      const geo = labelGeometryRef.current;
      const report = currentReportRef.current;
      const pageIdx = currentPageIndexRef.current;
      if (lp && geo && report) {
        const check = report.checks.find(c => c.id === draggingLabelId);
        if (check) {
          const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, pageIdx);
          const hlRect = { x: sc.x1, y: sc.y1, width: getWidth(sc), height: getHeight(sc) };
          const labelRect = { x: newPos.x, y: newPos.y, width: lp.labelBox.width, height: lp.labelBox.height };
          updateLeaderDOM(draggingLabelId, hlRect, labelRect, geo.renderedPageWidth);
        }
      }
    };

    const handleMouseUp = () => {
      const { scaleX, scaleY, renderedPageWidth: rpw, pageOrigWidth: pow } = labelDragScaleRef.current;
      let newDescriptionPosition: ICheckDescriptionPosition | null = null;
      if (draggingLabelId && scaleX > 0 && scaleY > 0) {
        const displayPos = draggedLabelPositionsRef.current.get(draggingLabelId);
        if (displayPos) {
          const report = currentReportRef.current;
          const check = report?.checks.find(c => c.id === draggingLabelId);
          if (check) {
            const invScaleY = 1 / scaleY;
            const origX = (rpw > 0 && displayPos.x > rpw)
              ? pow + (displayPos.x - rpw)
              : displayPos.x / scaleX;
            const origY = displayPos.y * invScaleY;

            const existingBox = check.description_position?.box;
            const lpBox = labelPlacementMapRef.current.get(draggingLabelId)?.labelBox;
            newDescriptionPosition = {
              box: {
                x: origX,
                y: origY,
                width: existingBox?.width ?? (lpBox ? lpBox.width / scaleX : 200),
                height: existingBox?.height ?? (lpBox ? lpBox.height * invScaleY : 50),
              }
            };

            const checkId = draggingLabelId;
            if (import.meta.env.DEV) console.debug(`[LabelDrag] mouseUp — saving position for ${checkId}`, newDescriptionPosition);
            setCurrentReport(prev => {
              if (!prev) return prev;
              const idx = prev.checks.findIndex(c => c.id === checkId);
              if (idx === -1) return prev;
              const updatedChecks = [...prev.checks];
              updatedChecks[idx] = { ...updatedChecks[idx], description_position: newDescriptionPosition! };
              return { ...prev, checks: updatedChecks };
            });

            ApiClient.updateCheck(draggingLabelId, { description_position: newDescriptionPosition } as Partial<ICheck>).then(result => {
              if (result.check) {
                updateCheckInReport(result.check);
              }
              // Delay deletion until after React processes the re-render from updateCheckInReport,
              // so restacking mechanisms see the drag override and skip this label
              setTimeout(() => {
                draggedLabelPositionsRef.current.delete(checkId);
                if (import.meta.env.DEV) console.debug(`[LabelDrag] dragRef deleted for ${checkId}`);
              }, 0);
            }).catch(e => {
              console.error('Failed to save label position', e);
            });
          }
        }
      }

      if (draggedLabelElRef.current) {
        draggedLabelElRef.current.style.transform = '';
      }
      draggedLabelElRef.current = null;

      setDraggingLabelId(null);
      dragLabelStartRef.current = null;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const start = dragLabelStartRef.current;
      if (!start) return;
      e.preventDefault();
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const newPos = {
        x: start.startLabelX + dx,
        y: start.startLabelY + dy,
      };
      draggedLabelPositionsRef.current.set(draggingLabelId, newPos);
      if (draggedLabelElRef.current) {
        draggedLabelElRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      const lp = labelPlacementMapRef.current.get(draggingLabelId);
      const geo = labelGeometryRef.current;
      const report = currentReportRef.current;
      const pageIdx = currentPageIndexRef.current;
      if (lp && geo && report) {
        const check = report.checks.find(c => c.id === draggingLabelId);
        if (check) {
          const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, pageIdx);
          const hlRect = { x: sc.x1, y: sc.y1, width: getWidth(sc), height: getHeight(sc) };
          const labelRect = { x: newPos.x, y: newPos.y, width: lp.labelBox.width, height: lp.labelBox.height };
          updateLeaderDOM(draggingLabelId, hlRect, labelRect, geo.renderedPageWidth);
        }
      }
    };

    const handleTouchEnd = () => {
      handleMouseUp();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [draggingLabelId]);

  // Clear dragged label positions and label resize state on zoom/page/report changes
  useEffect(() => {
    draggedLabelPositionsRef.current = new Map();
    setIsResizingLabel(false);
    setResizeLabelCheckId(null);
    setResizeLabelHandle(null);
    isResizingLabelRef.current = false;
    resizeLabelCheckIdRef.current = null;
    resizeLabelHandleRef.current = null;
    if (resizeLabelElRef.current) {
      resizeLabelElRef.current.style.transform = '';
      resizeLabelElRef.current.style.width = '';
      delete resizeLabelElRef.current.dataset.origWidth;
      resizeLabelElRef.current = null;
    }
  }, [zoomLevel, currentPageIndex, currentReport?.id]);

  // --- Label resize handlers ---

  const handleLabelResizeMouseMove = (e: MouseEvent) => {
    if (!isResizingLabelRef.current || !resizeLabelHandleRef.current) return;
    const handle = resizeLabelHandleRef.current;
    const dx = e.clientX - resizeLabelStartXRef.current;
    const dy = e.clientY - resizeLabelStartYRef.current;
    let widthD = 0, xD = 0, heightD = 0, yD = 0;
    if (handle === 'e') {
      widthD = dx;
    } else if (handle === 'w') {
      widthD = -dx; xD = dx;
    } else if (handle === 'n') {
      heightD = -dy; yD = dy;
    } else if (handle === 's') {
      heightD = dy;
    } else if (handle === 'se') {
      widthD = dx; heightD = dy;
    } else if (handle === 'sw') {
      widthD = -dx; xD = dx; heightD = dy;
    } else if (handle === 'ne') {
      widthD = dx; heightD = -dy; yD = dy;
    } else if (handle === 'nw') {
      widthD = -dx; xD = dx; heightD = -dy; yD = dy;
    }
    resizeLabelWidthDeltaRef.current = widthD;
    resizeLabelXDeltaRef.current = xD;
    resizeLabelHeightDeltaRef.current = heightD;
    resizeLabelYDeltaRef.current = yD;
    if (resizeLabelElRef.current) {
      resizeLabelElRef.current.style.transform = `translate(${xD}px, ${yD}px)`;
      const origWidth = parseFloat(resizeLabelElRef.current.dataset.origWidth || '0');
      resizeLabelElRef.current.style.width = `${Math.max(50, origWidth + widthD)}px`;
    }
    // Update SVG connector to follow resized label
    const currentCheckId = resizeLabelCheckIdRef.current;
    if (currentCheckId) {
      const lp = labelPlacementMapRef.current.get(currentCheckId);
      const geo = labelGeometryRef.current;
      if (lp && geo && currentReport) {
        const check = currentReport.checks.find(c => c.id === currentCheckId);
        if (check) {
          const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, currentPageIndex);
          const hlRect = { x: sc.x1, y: sc.y1, width: getWidth(sc), height: getHeight(sc) };
          const labelRect = {
            x: lp.labelBox.x + xD,
            y: lp.labelBox.y + yD,
            width: Math.max(50, lp.labelBox.width + widthD),
            height: lp.labelBox.height,
          };
          updateLeaderDOM(currentCheckId, hlRect, labelRect, geo.renderedPageWidth);
        }
      }
    }
  };

  const handleLabelResizeMouseUp = async () => {
    document.removeEventListener("mousemove", handleLabelResizeMouseMove);
    document.removeEventListener("mouseup", handleLabelResizeMouseUp);

    if (!isResizingLabelRef.current || !resizeLabelCheckIdRef.current) return;

    const widthDelta = resizeLabelWidthDeltaRef.current;
    const xDelta = resizeLabelXDeltaRef.current;
    const heightDelta = resizeLabelHeightDeltaRef.current;
    const yDelta = resizeLabelYDeltaRef.current;
    const checkId = resizeLabelCheckIdRef.current;
    const resizeLabelEl = resizeLabelElRef.current;

    const hasDelta = widthDelta !== 0 || xDelta !== 0 || heightDelta !== 0 || yDelta !== 0;

    if (hasDelta) {
      const lp = labelPlacementMapRef.current.get(checkId);
      const scaleX = labelDragScaleRef.current?.scaleX || 1;
      const scaleY = labelDragScaleRef.current?.scaleY || 1;
      const pow = labelDragScaleRef.current?.pageOrigWidth;

      if (scaleX > 0) {
        setCurrentReport(reportState => {
          if (!reportState) return reportState;
          const checkIndex = reportState.checks.findIndex(c => c.id === checkId);
          if (checkIndex === -1) return reportState;
          const check = reportState.checks[checkIndex];
          if (!check?.description_position) return reportState;
          const mp = check.description_position;

          const isMarginLabel = (lp?.side !== undefined && lp.side !== PlacementSide.INSIDE) || (pow !== undefined && mp.box.x > pow);
          const origWidthDelta = isMarginLabel ? widthDelta : widthDelta / scaleX;
          const origXDelta = isMarginLabel ? xDelta : xDelta / scaleX;
          const origHeightDelta = isMarginLabel ? heightDelta : heightDelta / scaleY;
          const origYDelta = isMarginLabel ? yDelta : yDelta / scaleY;

          const newWidth = Math.max(50, mp.box.width + origWidthDelta);
          const newX = mp.box.x + origXDelta;
          const newHeight = Math.max(20, mp.box.height + origHeightDelta);
          const newY = mp.box.y + origYDelta;

          const newDescriptionPosition: ICheckDescriptionPosition = {
            box: { ...mp.box, x: newX, y: newY, width: newWidth, height: newHeight }
          };

          ApiClient.updateCheck(checkId, { description_position: newDescriptionPosition } as Partial<ICheck>).then(result => {
            if (result.check) {
              updateCheckInReport(result.check);
            }
          }).catch(e => {
            console.error('Failed to save label resize', e);
          });

          const updatedChecks = [...reportState.checks];
          updatedChecks[checkIndex] = {
            ...check,
            description_position: newDescriptionPosition,
          };
          return { ...reportState, checks: updatedChecks };
        });
      }
    }

    if (resizeLabelEl) {
      resizeLabelEl.style.transform = '';
      resizeLabelEl.style.width = '';
      delete resizeLabelEl.dataset.origWidth;
    }
    resizeLabelElRef.current = null;

    setIsResizingLabel(false);
    isResizingLabelRef.current = false;
    // Keep labelResizeActiveRef true briefly after resize ends so the
    // fit-width/fit-page zoom useLayoutEffect skips the first post-resize
    // render cycle, preventing the overhang → zoom → label width oscillation.
    requestAnimationFrame(() => {
      labelResizeActiveRef.current = false;
    });
    setTimeout(() => {
      setResizeLabelCheckId(null);
      setResizeLabelHandle(null);
      resizeLabelCheckIdRef.current = null;
      resizeLabelHandleRef.current = null;
      resizeLabelWidthDeltaRef.current = 0;
      resizeLabelXDeltaRef.current = 0;
      resizeLabelHeightDeltaRef.current = 0;
      resizeLabelYDeltaRef.current = 0;
    }, 0);
    document.body.style.userSelect = '';
  };

  const handleLabelResizeMouseDown = (e: React.MouseEvent, checkId: string, handle: 'e' | 'w' | 'n' | 's' | 'se' | 'sw' | 'ne' | 'nw') => {
    if (isEditingDisabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizingLabel(true);
    setResizeLabelCheckId(checkId);
    setResizeLabelHandle(handle);
    // Set refs synchronously so event handlers see the new values immediately
    isResizingLabelRef.current = true;
    labelResizeActiveRef.current = true;
    resizeLabelCheckIdRef.current = checkId;
    resizeLabelHandleRef.current = handle;
    resizeLabelStartXRef.current = e.clientX;
    resizeLabelStartYRef.current = e.clientY;
    resizeLabelWidthDeltaRef.current = 0;
    resizeLabelXDeltaRef.current = 0;
    resizeLabelHeightDeltaRef.current = 0;
    resizeLabelYDeltaRef.current = 0;
    resizeLabelElRef.current = document.querySelector(`[data-label-id="${checkId}"]`) as HTMLElement | null;
    if (resizeLabelElRef.current) {
      resizeLabelElRef.current.dataset.origWidth = String(resizeLabelElRef.current.getBoundingClientRect().width);
    }
    document.body.style.userSelect = 'none';

    document.addEventListener("mousemove", handleLabelResizeMouseMove);
    document.addEventListener("mouseup", handleLabelResizeMouseUp);
  };

  // --- Label resize touch handlers ---

  const handleLabelResizeTouchMove = (e: TouchEvent) => {
    if (!isResizingLabelRef.current || !resizeLabelHandleRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault();
    const handle = resizeLabelHandleRef.current;
    const dx = touch.clientX - resizeLabelStartXRef.current;
    const dy = touch.clientY - resizeLabelStartYRef.current;
    let widthD = 0, xD = 0, heightD = 0, yD = 0;
    if (handle === 'e') {
      widthD = dx;
    } else if (handle === 'w') {
      widthD = -dx; xD = dx;
    } else if (handle === 'n') {
      heightD = -dy; yD = dy;
    } else if (handle === 's') {
      heightD = dy;
    } else if (handle === 'se') {
      widthD = dx; heightD = dy;
    } else if (handle === 'sw') {
      widthD = -dx; xD = dx; heightD = dy;
    } else if (handle === 'ne') {
      widthD = dx; heightD = -dy; yD = dy;
    } else if (handle === 'nw') {
      widthD = -dx; xD = dx; heightD = -dy; yD = dy;
    }
    resizeLabelWidthDeltaRef.current = widthD;
    resizeLabelXDeltaRef.current = xD;
    resizeLabelHeightDeltaRef.current = heightD;
    resizeLabelYDeltaRef.current = yD;
    if (resizeLabelElRef.current) {
      resizeLabelElRef.current.style.transform = `translate(${xD}px, ${yD}px)`;
      const origWidth = parseFloat(resizeLabelElRef.current.dataset.origWidth || '0');
      resizeLabelElRef.current.style.width = `${Math.max(50, origWidth + widthD)}px`;
    }
    const currentCheckId = resizeLabelCheckIdRef.current;
    if (currentCheckId) {
      const lp = labelPlacementMapRef.current.get(currentCheckId);
      const geo = labelGeometryRef.current;
      if (lp && geo && currentReport) {
        const check = currentReport.checks.find(c => c.id === currentCheckId);
        if (check) {
          const sc = scaleCoordinatesToCurrentViewer(check as ICoordinates, currentPageIndex);
          const hlRect = { x: sc.x1, y: sc.y1, width: getWidth(sc), height: getHeight(sc) };
          const labelRect = {
            x: lp.labelBox.x + xD,
            y: lp.labelBox.y + yD,
            width: Math.max(50, lp.labelBox.width + widthD),
            height: lp.labelBox.height,
          };
          updateLeaderDOM(currentCheckId, hlRect, labelRect, geo.renderedPageWidth);
        }
      }
    }
  };

  const handleLabelResizeTouchEnd = () => {
    document.removeEventListener("touchmove", handleLabelResizeTouchMove);
    document.removeEventListener("touchend", handleLabelResizeTouchEnd);
    // Reuse the same save logic as mouse up
    handleLabelResizeMouseUp();
  };

  const handleLabelResizeTouchStart = (e: React.TouchEvent, checkId: string, handle: 'e' | 'w' | 'n' | 's' | 'se' | 'sw' | 'ne' | 'nw') => {
    if (isEditingDisabled) return;
    e.preventDefault();
    e.stopPropagation();
    const touch = e.touches[0];
    if (!touch) return;
    setIsResizingLabel(true);
    setResizeLabelCheckId(checkId);
    setResizeLabelHandle(handle);
    isResizingLabelRef.current = true;
    labelResizeActiveRef.current = true;
    resizeLabelCheckIdRef.current = checkId;
    resizeLabelHandleRef.current = handle;
    resizeLabelStartXRef.current = touch.clientX;
    resizeLabelStartYRef.current = touch.clientY;
    resizeLabelWidthDeltaRef.current = 0;
    resizeLabelXDeltaRef.current = 0;
    resizeLabelHeightDeltaRef.current = 0;
    resizeLabelYDeltaRef.current = 0;
    resizeLabelElRef.current = document.querySelector(`[data-label-id="${checkId}"]`) as HTMLElement | null;
    if (resizeLabelElRef.current) {
      resizeLabelElRef.current.dataset.origWidth = String(resizeLabelElRef.current.getBoundingClientRect().width);
    }
    document.body.style.userSelect = 'none';

    document.addEventListener("touchmove", handleLabelResizeTouchMove, { passive: false });
    document.addEventListener("touchend", handleLabelResizeTouchEnd);
  };

  return {
    draggingLabelId,
    setDraggingLabelId,
    dragLabelStartRef,
    isResizingLabel,
    resizeLabelCheckId,
    resizeLabelHandle,
    handleLabelResizeMouseDown,
    handleLabelResizeTouchStart,
  };
}
