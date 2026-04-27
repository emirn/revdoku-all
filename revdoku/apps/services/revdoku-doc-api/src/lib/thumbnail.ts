import sharp from 'sharp';
import { createCanvas, Image } from 'canvas';

// Shared page-thumbnail generation, used by both /report/create (per-
// batch, first-page thumbnail for envelope list previews) and
// /file/normalize (on upload of reference files / envelope sources so
// the thumbnail exists before a Review has run). Factored out of
// routes/report/create.ts so both pipelines produce identical
// thumbnails with the same fallback behaviour.

export const THUMBNAIL_MAX_WIDTH = 300;
export const THUMBNAIL_WEBP_QUALITY = 85;
/** When true, thumbnails are cropped to the content bounding box (removes white margins). */
export const THUMBNAIL_CROP_MARGINS = false;

/**
 * Generate a thumbnail (~300px wide) from a base64-encoded page image.
 * Tries sharp first (fast, supports WebP), falls back to node-canvas
 * (more compatible). Returns { data, width, height } or null if both
 * methods fail.
 */
export async function generateThumbnail(
  pageAsImageBase64: string,
  maxWidth: number,
  log: { warn: (obj: any, msg: string) => void; info: (obj: any, msg: string) => void },
  contentBoundingBox?: { x1: number; y1: number; x2: number; y2: number },
  scalingFactor?: number
): Promise<{ data: string; width: number; height: number } | null> {
  const pageBuffer = Buffer.from(pageAsImageBase64, 'base64');

  // Try sharp first (fast, produces WebP)
  try {
    let pipeline = sharp(pageBuffer);

    // Crop to content bounding box if available (removes white margins)
    if (THUMBNAIL_CROP_MARGINS && contentBoundingBox && scalingFactor) {
      const pad = 10; // px padding in image space
      const sf = scalingFactor;
      const left = Math.max(0, Math.round(contentBoundingBox.x1 * sf) - pad);
      const top = Math.max(0, Math.round(contentBoundingBox.y1 * sf) - pad);
      const right = Math.round(contentBoundingBox.x2 * sf) + pad;
      const bottom = Math.round(contentBoundingBox.y2 * sf) + pad;
      const meta = await sharp(pageBuffer).metadata();
      const cropWidth = Math.min(right - left, (meta.width || right) - left);
      const cropHeight = Math.min(bottom - top, (meta.height || bottom) - top);
      if (cropWidth > 50 && cropHeight > 50) {
        pipeline = pipeline.extract({ left, top, width: cropWidth, height: cropHeight });
      }
    }

    const thumbBuffer = await pipeline
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality: THUMBNAIL_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      data: thumbBuffer.data.toString('base64'),
      width: thumbBuffer.info.width,
      height: thumbBuffer.info.height,
    };
  } catch (sharpErr: any) {
    log.warn({ err: sharpErr?.message }, 'thumbnail: sharp failed, trying canvas fallback');
  }

  // Fallback: use node-canvas (already loaded in revdoku-doc-api, handles all image formats)
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (err) => reject(err);
      img.src = pageBuffer;
    });

    // Determine crop region (source coordinates)
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (THUMBNAIL_CROP_MARGINS && contentBoundingBox && scalingFactor) {
      const pad = 10;
      const sf = scalingFactor;
      sx = Math.max(0, Math.round(contentBoundingBox.x1 * sf) - pad);
      sy = Math.max(0, Math.round(contentBoundingBox.y1 * sf) - pad);
      const right = Math.min(img.width, Math.round(contentBoundingBox.x2 * sf) + pad);
      const bottom = Math.min(img.height, Math.round(contentBoundingBox.y2 * sf) + pad);
      sw = right - sx;
      sh = bottom - sy;
      if (sw <= 50 || sh <= 50) {
        // Sanity check failed, use full image
        sx = 0; sy = 0; sw = img.width; sh = img.height;
      }
    }

    const scale = Math.min(1, maxWidth / sw);
    const thumbWidth = Math.round(sw * scale);
    const thumbHeight = Math.round(sh * scale);

    const canvas = createCanvas(thumbWidth, thumbHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, thumbWidth, thumbHeight);

    const pngBuffer = canvas.toBuffer('image/png');
    return {
      data: pngBuffer.toString('base64'),
      width: thumbWidth,
      height: thumbHeight,
    };
  } catch (canvasErr: any) {
    log.warn({ err: canvasErr?.message }, 'thumbnail: canvas fallback also failed');
  }

  return null;
}
