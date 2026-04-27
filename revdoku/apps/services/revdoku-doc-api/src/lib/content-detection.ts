/**
 * Content box detection module (server-only).
 *
 * Detects content regions on an image using grid-based color analysis,
 * then splits oversized bounding boxes at internal gaps (empty rows/columns)
 * so each returned box tightly wraps its actual content.
 */

import sharp from 'sharp';
import type { IContentBox } from '@revdoku/lib';
import { EPageContentType } from '../schemas/common-server';

/** Lines thinner than this many grid cells are eroded before flood-fill */
const LINE_THICKNESS_CELLS = 1;

/** Minimum consecutive thin-column rows to classify as a vertical line (not text) */
const MIN_LINE_RUN_CELLS = 10;

/** Content boxes smaller than this in either dimension (original px) are dropped */
const MIN_CONTENT_BOX_PX = 8;

// ---------------------------------------------------------------------------
// Gap-splitting helpers
// ---------------------------------------------------------------------------

interface GridRegion {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/**
 * Given a boolean map keyed by index (start..end inclusive), return the
 * contiguous runs of indices where hasContent is true.
 */
function findContentRuns(
  hasContent: Map<number, boolean>,
  start: number,
  end: number,
): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let runStart: number | null = null;

  for (let i = start; i <= end; i++) {
    if (hasContent.get(i)) {
      if (runStart === null) runStart = i;
    } else {
      if (runStart !== null) {
        runs.push({ start: runStart, end: i - 1 });
        runStart = null;
      }
    }
  }
  if (runStart !== null) {
    runs.push({ start: runStart, end });
  }
  return runs;
}

/**
 * Split a flood-fill region by internal gaps.
 *
 * 1. Find rows that have NO content cells → split vertically
 * 2. For each vertical slice, find columns with no content → split horizontally
 */
function splitRegionByGaps(
  contentGrid: boolean[][],
  region: GridRegion,
): GridRegion[] {
  // --- Vertical split (find empty rows) ---
  const rowHasContent = new Map<number, boolean>();
  for (let row = region.minRow; row <= region.maxRow; row++) {
    let found = false;
    for (let col = region.minCol; col <= region.maxCol; col++) {
      if (contentGrid[row][col]) {
        found = true;
        break;
      }
    }
    rowHasContent.set(row, found);
  }

  const verticalParts = findContentRuns(rowHasContent, region.minRow, region.maxRow);

  // --- For each vertical part, split horizontally ---
  const result: GridRegion[] = [];

  for (const vPart of verticalParts) {
    const colHasContent = new Map<number, boolean>();
    for (let col = region.minCol; col <= region.maxCol; col++) {
      let found = false;
      for (let row = vPart.start; row <= vPart.end; row++) {
        if (contentGrid[row][col]) {
          found = true;
          break;
        }
      }
      colHasContent.set(col, found);
    }

    const horizParts = findContentRuns(colHasContent, region.minCol, region.maxCol);

    for (const hPart of horizParts) {
      result.push({
        minRow: vPart.start,
        maxRow: vPart.end,
        minCol: hPart.start,
        maxCol: hPart.end,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Line erosion
// ---------------------------------------------------------------------------

/**
 * Remove line-like features from the content grid.
 * A cell is "line-like" if its minimum perpendicular thickness
 * (horizontal or vertical run length) is <= lineThickness.
 */
function erodeLineFeatures(
  contentGrid: boolean[][],
  gridRows: number,
  gridCols: number,
  lineThickness: number,
): void {
  // Precompute vertical run lengths
  const vertRun: number[][] = Array.from({ length: gridRows }, () => Array(gridCols).fill(0));
  for (let c = 0; c < gridCols; c++) {
    let runStart = -1;
    for (let r = 0; r <= gridRows; r++) {
      const isContent = r < gridRows && contentGrid[r][c];
      if (isContent && runStart === -1) {
        runStart = r;
      } else if (!isContent && runStart !== -1) {
        const len = r - runStart;
        for (let rr = runStart; rr < r; rr++) vertRun[rr][c] = len;
        runStart = -1;
      }
    }
  }

  // Precompute horizontal run lengths
  const horizRun: number[][] = Array.from({ length: gridRows }, () => Array(gridCols).fill(0));
  for (let r = 0; r < gridRows; r++) {
    let runStart = -1;
    for (let c = 0; c <= gridCols; c++) {
      const isContent = c < gridCols && contentGrid[r][c];
      if (isContent && runStart === -1) {
        runStart = c;
      } else if (!isContent && runStart !== -1) {
        const len = c - runStart;
        for (let cc = runStart; cc < c; cc++) horizRun[r][cc] = len;
        runStart = -1;
      }
    }
  }

  // Pass 1: erase cells where the thinner dimension <= lineThickness
  const eroded: boolean[][] = Array.from(
    { length: gridRows }, () => Array(gridCols).fill(false),
  );
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      if (contentGrid[r][c]) {
        if (Math.min(vertRun[r][c], horizRun[r][c]) <= lineThickness) {
          contentGrid[r][c] = false;
          eroded[r][c] = true;
        }
      }
    }
  }

  // Pass 2: propagation — erase "just-too-thick" cells adjacent to pass-1 eroded cells.
  // Catches line segments that straddle grid cell boundaries and appear 1 cell thicker.
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      if (contentGrid[r][c]) {
        if (Math.min(vertRun[r][c], horizRun[r][c]) <= lineThickness + 1) {
          const adjEroded =
            (r > 0 && eroded[r - 1][c]) ||
            (r < gridRows - 1 && eroded[r + 1][c]) ||
            (c > 0 && eroded[r][c - 1]) ||
            (c < gridCols - 1 && eroded[r][c + 1]);
          if (adjEroded) {
            contentGrid[r][c] = false;
          }
        }
      }
    }
  }

  // Pass 3: column sweep — catch vertical lines that straddle a column boundary
  // (2 cells wide with no pass-1 seeds). Erase long consecutive thin-column runs.
  for (let c = 0; c < gridCols; c++) {
    let runStart = -1;
    for (let r = 0; r <= gridRows; r++) {
      const isThin = r < gridRows && contentGrid[r][c]
        && horizRun[r][c] <= lineThickness + 1;
      if (isThin && runStart === -1) {
        runStart = r;
      } else if (!isThin && runStart !== -1) {
        if (r - runStart >= MIN_LINE_RUN_CELLS) {
          for (let rr = runStart; rr < r; rr++) contentGrid[rr][c] = false;
        }
        runStart = -1;
      }
    }
  }

  // Pass 4: row sweep — catch horizontal lines that straddle a row boundary
  // (2 cells tall with no pass-1 seeds). Erase long consecutive thin-row runs.
  for (let r = 0; r < gridRows; r++) {
    let runStart = -1;
    for (let c = 0; c <= gridCols; c++) {
      const isThin = c < gridCols && contentGrid[r][c]
        && vertRun[r][c] <= lineThickness + 1;
      if (isThin && runStart === -1) {
        runStart = c;
      } else if (!isThin && runStart !== -1) {
        if (c - runStart >= MIN_LINE_RUN_CELLS) {
          for (let cc = runStart; cc < c; cc++) contentGrid[r][cc] = false;
        }
        runStart = -1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ContentDetectionResult {
  contentBoundingBox: IContentBox | null;  // bbox of ALL raw content (before line erosion/filtering)
  contentBoxes: IContentBox[];              // filtered boxes for label placement (same as current)
}

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

/**
 * Detects content regions on an image using grid-based color analysis.
 *
 * Algorithm:
 * 1. Downsize to ~400px max for efficient processing
 * 2. Sample background color at (5,5)
 * 3. Break into grid cells (gridCellSize in original coord space)
 * 4. For each cell: calculate what % of pixels differ from background
 * 5. Mark as "content" only if content % exceeds threshold
 * 6. Compute raw content bounding box (before line erosion) — used for margin cropping
 * 7. Erode line features, flood-fill, split at gaps → filtered content boxes for label placement
 * 8. Return both raw bbox and filtered boxes in original image space
 *
 * @param imageBuffer - PNG image buffer
 * @param options - Detection options
 * @returns ContentDetectionResult with raw bounding box and filtered content boxes
 */
export async function detectContentBoxes(
  imageBuffer: Buffer,
  options?: {
    downsizeMax?: number;            // Default: 800 - max dimension for analysis
    gridCellSize?: number;           // Default: 100 - cell size in original coords
    colorDiffThreshold?: number;     // Default: 30 - RGB diff to count as non-background
    contentThresholdPercent?: number; // Default: 15 - % of pixels that must differ to be "content"
    lineThicknessMaxPx?: number;     // Max line thickness in original image px to erode (converts to cells internally)
  },
): Promise<ContentDetectionResult> {
  const downsizeMax = options?.downsizeMax ?? 800;
  const gridCellSize = options?.gridCellSize ?? 100;
  const colorDiffThreshold = options?.colorDiffThreshold ?? 30;
  const contentThresholdPercent = options?.contentThresholdPercent ?? 15;

  try {
    // Get original image metadata
    const metadata = await sharp(imageBuffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    if (originalWidth === 0 || originalHeight === 0) {
      return { contentBoundingBox: null, contentBoxes: [] };
    }

    // Calculate scaling for efficient processing
    const maxDim = Math.max(originalWidth, originalHeight);
    const scale = maxDim > downsizeMax ? downsizeMax / maxDim : 1;
    const processWidth = Math.round(originalWidth * scale);
    const processHeight = Math.round(originalHeight * scale);

    // Resize for processing
    const { data: rawData, info: rawInfo } = await sharp(imageBuffer)
      .resize(processWidth, processHeight, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = rawInfo.channels;

    // Sample background color from offset position (5,5) to avoid borders
    const sampleX = Math.min(5, processWidth - 1);
    const sampleY = Math.min(5, processHeight - 1);
    const bgOffset = (sampleY * processWidth + sampleX) * channels;
    const bgR = rawData[bgOffset];
    const bgG = rawData[bgOffset + 1];
    const bgB = rawData[bgOffset + 2];

    // Calculate grid dimensions in processed image space
    const cellSizeScaled = Math.round(gridCellSize * scale);
    const MAX_CELL_SIZE = 5; // Cap for reliable gap detection (~2 cells per 10px gap)
    const MIN_CELL_SIZE = 3;
    const cellWidth = Math.max(MIN_CELL_SIZE, Math.min(cellSizeScaled, MAX_CELL_SIZE));
    const cellHeight = Math.max(MIN_CELL_SIZE, Math.min(cellSizeScaled, MAX_CELL_SIZE));
    const gridCols = Math.ceil(processWidth / cellWidth);
    const gridRows = Math.ceil(processHeight / cellHeight);

    // Track which cells have content
    const contentGrid: boolean[][] = Array.from({ length: gridRows }, () =>
      Array(gridCols).fill(false),
    );

    // Analyze each cell
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const startX = col * cellWidth;
        const startY = row * cellHeight;
        const endX = Math.min(startX + cellWidth, processWidth);
        const endY = Math.min(startY + cellHeight, processHeight);
        const cellArea = (endX - startX) * (endY - startY);

        let nonBgPixels = 0;

        // Sample pixels in this cell
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const offset = (y * processWidth + x) * channels;
            const r = rawData[offset];
            const g = rawData[offset + 1];
            const b = rawData[offset + 2];

            // Calculate color difference from background
            const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
            if (diff > colorDiffThreshold) {
              nonBgPixels++;
            }
          }
        }

        // Mark cell as content if above threshold
        const contentPercent = (nonBgPixels / cellArea) * 100;
        contentGrid[row][col] = contentPercent >= contentThresholdPercent;
      }
    }

    // Compute raw content bounding box BEFORE line erosion.
    // This captures the full extent of ANY non-background content (including borders,
    // thin lines, watermarks) — used for margin cropping where we don't want to clip anything.
    let contentBoundingBox: IContentBox | null = null;
    {
      let rawMinRow = gridRows, rawMaxRow = -1;
      let rawMinCol = gridCols, rawMaxCol = -1;
      for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
          if (contentGrid[r][c]) {
            if (r < rawMinRow) rawMinRow = r;
            if (r > rawMaxRow) rawMaxRow = r;
            if (c < rawMinCol) rawMinCol = c;
            if (c > rawMaxCol) rawMaxCol = c;
          }
        }
      }
      if (rawMaxRow >= 0 && rawMaxCol >= 0) {
        const bx1 = Math.max(0, Math.round((rawMinCol * cellWidth) / scale));
        const by1 = Math.max(0, Math.round((rawMinRow * cellHeight) / scale));
        const bx2 = Math.min(originalWidth, Math.round(((rawMaxCol + 1) * cellWidth) / scale));
        const by2 = Math.min(originalHeight, Math.round(((rawMaxRow + 1) * cellHeight) / scale));
        contentBoundingBox = { x1: bx1, y1: by1, x2: bx2, y2: by2 };
      }
    }

    // Remove line-like features (borders, rules, separators) before flood-fill
    // to prevent them from bridging separate content regions or creating
    // thin busy boxes that unnecessarily block annotation placement.
    let lineThicknessCells = LINE_THICKNESS_CELLS;
    if (options?.lineThicknessMaxPx != null && options.lineThicknessMaxPx > 0) {
      lineThicknessCells = Math.max(1, Math.round(options.lineThicknessMaxPx * scale / cellWidth));
    }
    erodeLineFeatures(contentGrid, gridRows, gridCols, lineThicknessCells);

    // Flood-fill to find connected content cell regions, then split at gaps
    const contentBoxes: IContentBox[] = [];
    const visited: boolean[][] = Array.from({ length: gridRows }, () =>
      Array(gridCols).fill(false),
    );

    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        if (contentGrid[row][col] && !visited[row][col]) {
          // Flood fill to find connected region
          let minCol = col, maxCol = col;
          let minRow = row, maxRow = row;

          const stack: [number, number][] = [[row, col]];
          const maxFloodOps = gridRows * gridCols; // each cell visited at most once
          let floodOps = 0;
          while (stack.length > 0) {
            if (++floodOps > maxFloodOps) break;
            const [r, c] = stack.pop()!;
            if (r < 0 || r >= gridRows || c < 0 || c >= gridCols) continue;
            if (visited[r][c] || !contentGrid[r][c]) continue;

            visited[r][c] = true;
            minCol = Math.min(minCol, c);
            maxCol = Math.max(maxCol, c);
            minRow = Math.min(minRow, r);
            maxRow = Math.max(maxRow, r);

            // Add neighbors
            stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
          }

          const floodRegion: GridRegion = { minRow, maxRow, minCol, maxCol };

          // Split the bounding box at internal gaps
          const subRegions = splitRegionByGaps(contentGrid, floodRegion);

          for (const sub of subRegions) {
            // Convert grid coords back to original image coords
            const x1 = Math.round((sub.minCol * cellWidth) / scale);
            const y1 = Math.round((sub.minRow * cellHeight) / scale);
            const x2 = Math.round(((sub.maxCol + 1) * cellWidth) / scale);
            const y2 = Math.round(((sub.maxRow + 1) * cellHeight) / scale);

            const bx1 = Math.max(0, x1);
            const by1 = Math.max(0, y1);
            const bx2 = Math.min(originalWidth, x2);
            const by2 = Math.min(originalHeight, y2);

            // Skip boxes that are too thin (remnants of lines/borders)
            if (bx2 - bx1 >= MIN_CONTENT_BOX_PX && by2 - by1 >= MIN_CONTENT_BOX_PX) {
              contentBoxes.push({ x1: bx1, y1: by1, x2: bx2, y2: by2 });
            }
          }
        }
      }
    }

    return { contentBoundingBox, contentBoxes };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`detectContentBoxes failed: ${msg}`);
  }
}

/**
 * Classify page content type from already-computed content detection results.
 * This is a heuristic classifier — TABLE, CHART, FORM are not detected and will
 * fall into MIXED. AI-based refinement can be added later.
 *
 * NOTE: Does NOT return BLANK. Blank detection is handled separately by
 * compressEmptyImagesInPages() which is the only safe source of blank classification.
 *
 * @param contentBoundingBox - Overall content bounding box (null if no content detected)
 * @param contentBoxes - Individual content regions detected on the page
 * @param pageWidth - Original page width in pixels (before scaling)
 * @param pageHeight - Original page height in pixels (before scaling)
 */
export function classifyPageContentType(
  contentBoundingBox: IContentBox | null,
  contentBoxes: IContentBox[],
  pageWidth: number,
  pageHeight: number,
): EPageContentType {
  if (!contentBoundingBox || contentBoxes.length === 0) {
    return EPageContentType.UNKNOWN;
  }

  const pageArea = pageWidth * pageHeight;
  if (pageArea <= 0) {
    return EPageContentType.UNKNOWN;
  }

  const boxCount = contentBoxes.length;
  const boxAreas = contentBoxes.map(b => (b.x2 - b.x1) * (b.y2 - b.y1));
  const maxBoxArea = Math.max(...boxAreas);
  const maxBoxRatio = maxBoxArea / pageArea;

  // IMAGE: few large boxes covering most of the page (e.g., a photo or full-page graphic)
  if (boxCount <= 2 && maxBoxRatio > 0.6) {
    return EPageContentType.IMAGE;
  }

  // TEXT: many small boxes (paragraphs, headings, lists)
  const smallBoxThreshold = pageArea * 0.15;
  const smallBoxCount = boxAreas.filter(a => a < smallBoxThreshold).length;
  if (boxCount > 4 && smallBoxCount > boxCount * 0.7) {
    return EPageContentType.TEXT;
  }

  return EPageContentType.MIXED;
}
