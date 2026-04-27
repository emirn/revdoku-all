import type { IPageInfoExtended } from '../schemas/common-server';

/**
 * Coordinate-space utilities for revdoku-doc-api.
 *
 * Coordinate spaces:
 *
 *   Document space:  (cropOffX..cropOffX+contentW, cropOffY..cropOffY+contentH)
 *                    Stored in DB checks, used by frontend for highlight rendering.
 *
 *   Content pixel space:  (0..page.width, 0..page.height)
 *                         Cropped rendered page image pixels.
 *                         Grid labels show these pixel coordinates directly.
 *                         AI reports coordinates in this space.
 *
 *   Grid canvas pixel space:  Adds rulerSize + badgeMargins to content pixels.
 *                             Grid images sent to AI, debug overlay.
 *
 *   Reverse mapping (AI → document):
 *     orig_coord = crop_offset + ai_pixel / scaling_factor
 */

/**
 * Derives full-page document dimensions from page rendering info.
 * Eliminates the repeated `Math.round(cropOffX + width / sf)` pattern.
 *
 * @param page - Extended page info with crop offsets and scaling factor
 * @returns Document-space dimensions: pageWidth/pageHeight (full extent),
 *          contentWidth/contentHeight (visible content), and crop offsets
 */
export function getPageDocumentDimensions(page: IPageInfoExtended): {
  pageWidth: number;
  pageHeight: number;
  contentWidth: number;
  contentHeight: number;
  cropOffX: number;
  cropOffY: number;
} {
  const cropOffX = page.crop_offset_x || 0;
  const cropOffY = page.crop_offset_y || 0;
  const contentWidth = page.width / page.scaling_factor;
  const contentHeight = page.height / page.scaling_factor;
  return {
    pageWidth: Math.round(cropOffX + contentWidth),
    pageHeight: Math.round(cropOffY + contentHeight),
    contentWidth,
    contentHeight,
    cropOffX,
    cropOffY,
  };
}

/**
 * Converts a document-space coordinate to content pixel space.
 * Implements: `(docCoord - cropOffset) * scalingFactor`
 *
 * Document space → Content pixel space
 *
 * @param docCoord - Coordinate in document space
 * @param cropOffset - Crop offset (cropOffX or cropOffY)
 * @param scalingFactor - Page scaling factor (page.scaling_factor)
 */
export function docToContentPixel(
  docCoord: number, cropOffset: number, scalingFactor: number
): number {
  return (docCoord - cropOffset) * scalingFactor;
}

/**
 * Converts a document-space coordinate to grid canvas pixel space.
 * Combines docToContentPixel + ruler/badge margin offset.
 *
 * Document space → Grid canvas pixel space
 *
 * @param docCoord - Coordinate in document space
 * @param cropOffset - Crop offset (cropOffX or cropOffY)
 * @param scalingFactor - Page scaling factor
 * @param rulerSize - Size of the ruler gutter in pixels
 * @param badgeMargin - Badge overflow margin (badgeMarginLeft or badgeMarginTop)
 */
export function docToGridCanvasPixel(
  docCoord: number, cropOffset: number, scalingFactor: number,
  rulerSize: number, badgeMargin: number
): number {
  return badgeMargin + rulerSize + docToContentPixel(docCoord, cropOffset, scalingFactor);
}

/**
 * Converts envelope-space coordinates to the AI model's coordinate space (0..aiCoordScale).
 *
 * Envelope space → Content pixel → AI model coordinates
 *
 * Used when embedding previous check locations in AI prompts, so coordinates
 * are in the same space the AI model outputs. If the AI echoes them back,
 * convertCheckLocationsFromAICoordinatesToEnvelopeCoordinates will correctly convert them back to envelope space.
 *
 * This is the inverse of the reverse mapping in convertCheckLocationsFromAICoordinatesToEnvelopeCoordinates():
 *   convertCheckLocationsFromAICoordinatesToEnvelopeCoordinates: AI_model_coords → pixel → envelope_coords
 *   envelopeCoordsToAIModelCoords: envelope_coords → pixel → AI_model_coords
 *
 * @param coords - Coordinates in envelope space (as stored in DB checks)
 * @param page - Page info with scaling factor, crop offsets, and pixel dimensions
 * @param aiCoordScale - The AI model's coordinate scale (e.g., 1000 for 0-1000 normalized)
 */
export function envelopeCoordsToAIModelCoords(
  coords: { x1: number; y1: number; x2: number; y2: number },
  page: IPageInfoExtended,
  aiCoordScale: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const sf = page.scaling_factor || 1;
  const cropX = page.crop_offset_x || 0;
  const cropY = page.crop_offset_y || 0;
  const w = page.width;
  const h = page.height;

  return {
    x1: Math.round(docToContentPixel(coords.x1, cropX, sf) / w * aiCoordScale),
    y1: Math.round(docToContentPixel(coords.y1, cropY, sf) / h * aiCoordScale),
    x2: Math.round(docToContentPixel(coords.x2, cropX, sf) / w * aiCoordScale),
    y2: Math.round(docToContentPixel(coords.y2, cropY, sf) / h * aiCoordScale),
  };
}

/**
 * @deprecated No longer used. The pixel-coordinate grid system means AI reports
 * coordinates directly in pixel space. The simple reverse formula is:
 *   orig_coord = crop_offset + ai_pixel / scaling_factor
 * Kept for reference only.
 */
export function deMapAIGridCoordinate(
  aiCoord: number, pageRange: number, fullImageDim: number,
  docStartOffset: number, scalingFactor: number, cropOffset: number
): number {
  return (aiCoord / pageRange * fullImageDim - docStartOffset) / scalingFactor + cropOffset;
}
