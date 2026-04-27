import { useRef, useEffect } from "react";

interface UsePanningParams {
  pageScrollContainerRef: React.RefObject<HTMLDivElement | null>;
  isManualSelectionMode: boolean;
  isEditingDisabled: boolean;
}

export function usePanning({
  pageScrollContainerRef,
  isManualSelectionMode,
  isEditingDisabled,
}: UsePanningParams) {
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const handlePanMouseDown = (e: React.MouseEvent) => {
    if (isManualSelectionMode || isEditingDisabled) return;
    e.preventDefault();
    isPanningRef.current = true;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: pageScrollContainerRef.current?.scrollLeft || 0,
      scrollTop: pageScrollContainerRef.current?.scrollTop || 0,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
  };

  const handlePanMouseMove = (e: React.MouseEvent) => {
    if (!isPanningRef.current || !pageScrollContainerRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    pageScrollContainerRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
    pageScrollContainerRef.current.scrollTop = panStartRef.current.scrollTop - dy;
  };

  const handlePanMouseUp = () => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  return {
    handlePanMouseDown,
    handlePanMouseMove,
    handlePanMouseUp,
  };
}
