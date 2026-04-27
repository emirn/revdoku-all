export const RENDERED_PAGES_JPEG_QUALITY = 85;
export const CONVERT_TO_JPEG_BEFORE_SENDING_TO_AI = false;
export const RENDERED_PAGES_PDF_TO_PNG_OUTPUT_DPI = 300;
export const RENDERED_PAGES_PDF_DEFAULT_DPI = 72;

/**
 * Minimum DPI for rendering PDFs to images for AI inspection.
 * PDFs at 72 DPI produce only ~66 effective DPI after scaling (scaling_factor ≈ 0.912 for A4),
 * resulting in blurry content the AI can't accurately position.
 * Rendering at higher DPI then downscaling produces much sharper images.
 */
export const MIN_PDF_RENDER_DPI = 150;

/**
 * When true, the page image embedded in each exported report SVG is trimmed
 * to its content bounding box (white-margin crop) before being base64-encoded.
 * When false, the full resized image is used.
 *
 * Default false. Turn on if you want tighter thumbnails — the SVG viewBox
 * and coordinate math absorb the crop automatically because all overlay
 * coordinates are converted into image-pixel space inside the SVG emitter
 * using the post-crop image dimensions.
 */
export const EXPORT_CROP_PAGE_MARGINS = false;

/**
 * Report export rendering mode.
 *
 * - 'svg'    — Static SVG overlays (vector-crisp, zero JS, smaller files).
 *              Uses createSvgPagesForExport() in svg-export-utils.ts.
 *              Drawing primitives are shared with the frontend via
 *              @revdoku/lib/svg-drawing-primitives.
 *
 * - 'canvas' — Legacy Node-canvas rasterisation (PNG highlights baked into
 *              images). Uses createImagesWithHighlights() in image-utils.ts.
 *              Still needed for server-side page preview rendering and as a
 *              fallback if SVG causes issues in certain PDF viewers.
 *
 * Default: 'svg'. Flip to 'canvas' to restore the legacy behaviour.
 */
export const EXPORT_RENDER_MODE: 'svg' | 'canvas' = 'svg';