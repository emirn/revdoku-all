import type { IPageInfo, ICoordinates } from "@revdoku/lib";

interface DebugGridProps {
  pageInfo: IPageInfo;
  scaleCoordinatesToCurrentViewer: (coordinates: ICoordinates, pageIndex: number) => ICoordinates;
  currentPageIndex: number;
}

export default function DebugGrid({
  pageInfo,
  scaleCoordinatesToCurrentViewer,
  currentPageIndex,
}: DebugGridProps) {
  const original_width = pageInfo.original_width;
  const original_height = pageInfo.original_height;

  return (
    <>
      {/* Vertical grid lines */}
      {Array.from({
        length: Math.ceil(original_width / 100),
      }).map((_, i) => {
        const nonScaled: ICoordinates = {
          x1: (i + 1) * 100,
          y1: 0,
          x2: 0,
          y2: 0,
        };
        const scaled = scaleCoordinatesToCurrentViewer(nonScaled, currentPageIndex);
        return (
          <div key={`vertical-${i}`}>
            <div
              className="absolute top-0 h-full border-l border-blue-500 opacity-30"
              style={{ left: `${scaled.x1}px` }}
            />
            <div
              className="absolute top-0 text-xs text-blue-600 bg-white opacity-75 px-1"
              style={{ left: `${scaled.x1}px` }}
            >
              {(i + 1) * 100}
            </div>
          </div>
        );
      })}

      {/* Horizontal grid lines */}
      {Array.from({
        length: Math.ceil(original_height / 100),
      }).map((_, i) => {
        const nonScaled: ICoordinates = {
          x1: 0,
          y1: (i + 1) * 100,
          x2: 0,
          y2: 0,
        };
        const scaled = scaleCoordinatesToCurrentViewer(nonScaled, currentPageIndex);
        return (
          <div key={`horizontal-${i}`}>
            <div
              className="absolute left-0 w-full border-t border-blue-500 opacity-30"
              style={{ top: `${scaled.y1}px` }}
            />
            <div
              className="absolute left-0 text-xs text-blue-600 bg-white opacity-75 px-1"
              style={{ top: `${scaled.y1}px` }}
            >
              {(i + 1) * 100}
            </div>
          </div>
        );
      })}

      {/* Center lines with labels */}
      {(() => {
        const centerX = original_width / 2;
        const centerY = original_height / 2;
        const nonScaled: ICoordinates = {
          x1: centerX,
          y1: centerY,
          x2: 0,
          y2: 0,
        };
        const scaledCenter = scaleCoordinatesToCurrentViewer(nonScaled, currentPageIndex);
        return (
          <>
            <div>
              <div
                className="absolute left-0 w-full border-t border-blue-500 opacity-30"
                style={{ top: `${scaledCenter.y1}px` }}
              />
              <div
                className="absolute left-0 text-xs text-blue-600 bg-white opacity-75 px-1"
                style={{ top: `${scaledCenter.y1}px` }}
              >
                {Math.round(centerY)}
              </div>
            </div>
            <div>
              <div
                className="absolute top-0 h-full border-l border-blue-500 opacity-30"
                style={{ left: `${scaledCenter.x1}px` }}
              />
              <div
                className="absolute top-0 text-xs text-blue-600 bg-white opacity-75 px-1"
                style={{ left: `${scaledCenter.x1}px` }}
              >
                {Math.round(centerX)}
              </div>
            </div>
          </>
        );
      })()}

      {/* Coordinates at corners (using original image dimensions) */}
      <div className="absolute top-0 left-0 text-xs text-blue-600 bg-white opacity-75 px-1 pointer-events-auto">
        (0,0)
      </div>
      <div className="absolute top-0 right-0 text-xs text-blue-600 bg-white opacity-75 px-1 pointer-events-auto">
        ({original_width},0)
      </div>
      <div className="absolute bottom-0 left-0 text-xs text-blue-600 bg-white opacity-75 px-1 pointer-events-auto">
        (0,{original_height})
      </div>
      <div className="absolute bottom-0 right-0 text-xs text-blue-600 bg-white opacity-75 px-1 pointer-events-auto">
        ({original_width},{original_height})
      </div>
    </>
  );
}
