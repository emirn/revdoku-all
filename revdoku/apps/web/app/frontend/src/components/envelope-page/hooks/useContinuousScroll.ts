import { useRef, useCallback, useEffect, useMemo, useState } from "react";
import type { IPageInfo } from "@revdoku/lib";

/** Gap between pages in continuous scroll mode (px) */
export const PAGE_GAP = 12;

/** Number of pages to render outside the viewport as buffer */
const BUFFER_PAGES = 2;

interface UseContinuousScrollParams {
  numPages: number | null;
  pageScrollContainerRef: React.RefObject<HTMLDivElement | null>;
  setCurrentPageIndex: (index: number) => void;
  documentPagesToDisplayImageDimensions: IPageInfo[];
  zoomLevel: number;
  viewerWidth: number;
  isContinuousScroll: boolean;
}

export function useContinuousScroll({
  numPages,
  pageScrollContainerRef,
  setCurrentPageIndex,
  documentPagesToDisplayImageDimensions,
  zoomLevel,
  viewerWidth,
  isContinuousScroll,
}: UseContinuousScrollParams) {
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [visiblePageRange, setVisiblePageRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const scrollToPageInProgressRef = useRef(false);

  // Compute page heights based on dimensions and zoom
  const pageHeights = useMemo(() => {
    if (!numPages) return [];
    const renderedWidth = viewerWidth * zoomLevel;
    return Array.from({ length: numPages }, (_, i) => {
      const dims = documentPagesToDisplayImageDimensions[i];
      if (dims && dims.original_width && dims.original_height) {
        return (dims.original_height / dims.original_width) * renderedWidth;
      }
      // Fallback: assume letter-size aspect ratio
      return renderedWidth * 1.294;
    });
  }, [numPages, documentPagesToDisplayImageDimensions, zoomLevel, viewerWidth]);

  // Cumulative Y offsets for each page (top of page relative to container start)
  const pageYOffsets = useMemo(() => {
    const offsets: number[] = [];
    let y = 0;
    for (let i = 0; i < pageHeights.length; i++) {
      offsets.push(y);
      y += pageHeights[i] + PAGE_GAP;
    }
    return offsets;
  }, [pageHeights]);

  // Total height of all pages stacked
  const totalHeight = useMemo(() => {
    if (pageHeights.length === 0) return 0;
    return pageYOffsets[pageYOffsets.length - 1] + pageHeights[pageHeights.length - 1];
  }, [pageYOffsets, pageHeights]);

  // Scroll to a specific page
  const scrollToPage = useCallback((pageIndex: number) => {
    const container = pageScrollContainerRef.current;
    if (!container || pageIndex < 0 || pageIndex >= pageYOffsets.length) return;
    scrollToPageInProgressRef.current = true;
    const targetY = pageYOffsets[pageIndex];
    container.scrollTo({ top: targetY, behavior: 'smooth' });
    setCurrentPageIndex(pageIndex);
    // Clear the flag after scroll animation completes
    setTimeout(() => { scrollToPageInProgressRef.current = false; }, 500);
  }, [pageYOffsets, pageScrollContainerRef, setCurrentPageIndex]);

  // Track scroll position to update currentPageIndex and visible range
  useEffect(() => {
    if (!isContinuousScroll) return;
    const container = pageScrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const viewportHeight = container.clientHeight;

      // Find which page is most visible (page whose center is closest to viewport center)
      const viewportCenter = scrollTop + viewportHeight / 2;
      let closestPage = 0;
      let closestDist = Infinity;
      for (let i = 0; i < pageYOffsets.length; i++) {
        const pageCenter = pageYOffsets[i] + pageHeights[i] / 2;
        const dist = Math.abs(pageCenter - viewportCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closestPage = i;
        }
      }

      // Only update currentPageIndex from scroll if not in a programmatic scrollToPage
      if (!scrollToPageInProgressRef.current) {
        setCurrentPageIndex(closestPage);
      }

      // Compute visible range for virtualization
      const viewTop = scrollTop - viewportHeight * BUFFER_PAGES;
      const viewBottom = scrollTop + viewportHeight + viewportHeight * BUFFER_PAGES;
      let start = 0;
      let end = (numPages ?? 1) - 1;
      for (let i = 0; i < pageYOffsets.length; i++) {
        const pageBottom = pageYOffsets[i] + pageHeights[i];
        if (pageBottom < viewTop) start = i + 1;
        if (pageYOffsets[i] > viewBottom) {
          end = i - 1;
          break;
        }
      }
      start = Math.max(0, start);
      end = Math.min((numPages ?? 1) - 1, end);
      setVisiblePageRange(prev => {
        if (prev.start === start && prev.end === end) return prev;
        return { start, end };
      });
    };

    // Initial calculation
    handleScroll();

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isContinuousScroll, pageYOffsets, pageHeights, numPages, pageScrollContainerRef, setCurrentPageIndex]);

  return {
    pageRefs,
    pageHeights,
    pageYOffsets,
    totalHeight,
    visiblePageRange,
    scrollToPage,
  };
}
