import { getInputMimeTypeFromBase64Data } from './file-utils';
import {
    IPageInfo,
    isMimeTypeImage, isMimeTypePdf
} from '@revdoku/lib';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import exifr from 'exifr';
import { convertPdfToImages, IPDFToImageResult, getPdfPageCount } from './pdf-utils';
import { IEnvelopeRevision, IDocumentFile, IDocumentFileRevision, EInputFileMimeType } from '@revdoku/lib';
import { compressEmptyImagesInPages, generateImagesWithGrid } from './ai-utils';
import {
    IEnvelopeRevisionToImageRenderingOptions,
    IPageInfoExtended,
    EAIImageAnalysisMode,
    EGridMode
} from '../schemas/common-server';
import { AI_IMAGE_MAX_SIDE_SIZE } from '../schemas/ai-models';
import { RENDERED_PAGES_JPEG_QUALITY, CONVERT_TO_JPEG_BEFORE_SENDING_TO_AI } from './constants';

// Render larger so after margin crop we can downscale to AI_IMAGE_MAX_SIDE_SIZE.
// Always downscaling = best quality (no upscaling artifacts).
const RENDER_MARGIN_FACTOR = 1.5;
const PAGE_IMAGE_MIN_SIDE_SIZE_FOR_PDF = Math.round(600 * RENDER_MARGIN_FACTOR); // ~900px
const PAGE_IMAGE_MAX_SIDE_SIZE_FOR_PDF = Math.round(AI_IMAGE_MAX_SIDE_SIZE * RENDER_MARGIN_FACTOR); // ~1152px
const MIN_FILE_DATA_SIZE = 10; // min 100 bytes to be a valid file (as base64 string)

const DocumentToImageRenderingOptions: IEnvelopeRevisionToImageRenderingOptions = {
    maxSideSize: PAGE_IMAGE_MAX_SIDE_SIZE_FOR_PDF,
    minSideSize: PAGE_IMAGE_MIN_SIDE_SIZE_FOR_PDF
};


const EXIF_SUPPORTED_MIME_TYPES = new Set([
    EInputFileMimeType.JPEG,
    EInputFileMimeType.TIFF,
    EInputFileMimeType.WEBP,
]);

async function buildImageMetadataString(
    imageBuffer: Uint8Array,
    sharpMetadata: sharp.Metadata,
    fileType: EInputFileMimeType,
    fileName: string,
    sizeBytes: number
): Promise<string> {
    const lines: string[] = [
        `Source Document Type: Image`,
        `Image Format: ${sharpMetadata.format || 'unknown'}`,
        `Image Dimensions: ${sharpMetadata.width}x${sharpMetadata.height} pixels`,
        `Image Color Space: ${sharpMetadata.space || 'unknown'}`,
        `Image DPI/Density: ${sharpMetadata.density || 'not available'}`,
        `Image Has Alpha: ${sharpMetadata.hasAlpha || false}`,
        `File Name: ${fileName}`,
        `File Size: ${sizeBytes} bytes`,
    ];

    if (!EXIF_SUPPORTED_MIME_TYPES.has(fileType)) {
        lines.push(`EXIF Data: none`);
        return lines.join('\n');
    }

    try {
        const exifData = await exifr.parse(Buffer.from(imageBuffer), {
            exif: true, iptc: true, xmp: true, gps: true, icc: false, tiff: true,
        });

        if (exifData) {
            if (exifData.Make) lines.push(`Camera Make: ${exifData.Make}`);
            if (exifData.Model) lines.push(`Camera Model: ${exifData.Model}`);
            if (exifData.LensModel) lines.push(`Lens Model: ${exifData.LensModel}`);
            if (exifData.Software) lines.push(`Software: ${exifData.Software}`);
            if (exifData.ProcessingSoftware) lines.push(`Processing Software: ${exifData.ProcessingSoftware}`);
            if (exifData.CreatorTool) lines.push(`Creator Tool: ${exifData.CreatorTool}`);
            if (exifData.DateTimeOriginal) lines.push(`Date Taken: ${exifData.DateTimeOriginal}`);
            if (exifData.CreateDate) lines.push(`Create Date: ${exifData.CreateDate}`);
            if (exifData.ModifyDate) lines.push(`Modify Date: ${exifData.ModifyDate}`);
            if (exifData.Artist) lines.push(`Artist: ${exifData.Artist}`);
            if (exifData.Copyright) lines.push(`Copyright: ${exifData.Copyright}`);
            if (exifData.ImageDescription) lines.push(`Description: ${exifData.ImageDescription}`);
            if (exifData.ExposureTime) lines.push(`Exposure Time: ${exifData.ExposureTime}`);
            if (exifData.FNumber) lines.push(`F-Number: ${exifData.FNumber}`);
            if (exifData.ISO) lines.push(`ISO: ${exifData.ISO}`);
            if (exifData.FocalLength) lines.push(`Focal Length: ${exifData.FocalLength}`);
            if (exifData.latitude !== undefined && exifData.longitude !== undefined) {
                lines.push(`GPS Location: ${exifData.latitude}, ${exifData.longitude}`);
            }
            if (exifData.Orientation) lines.push(`EXIF Orientation: ${exifData.Orientation}`);
        } else {
            console.debug('buildImageMetadataString', `No EXIF metadata found in ${fileName}`);
        }
    } catch (err) {
        console.debug('buildImageMetadataString', `Failed to extract EXIF from ${fileName}: ${err}`);
    }

    return lines.join('\n');
}

function sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '');
}

function saveBase64Image(base64: string, filePath: string) {
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
}

export const enrichAndRenderFilesRelatedToEnvelopeRevision = async (document_files_revisions: IDocumentFileRevision[], forcedUpdate: boolean = false, debugFolder?: string, ai_mode?: EAIImageAnalysisMode, gridModeOverride?: EGridMode, skipGrid: boolean = false, aiCoordScale: number = 0, pageNumberOffset: number = 0, requestedPages?: number[] | null): Promise<IDocumentFileRevision[]> => {

    console.debug('input', `Received ${document_files_revisions.length} file revisions`);

    // grid mode for use with images
    // Use override if provided (debug mode), otherwise default to NONE
    // NONE mode adds [PN] overlay label but no coordinate grid
    const gridMode = gridModeOverride
        ? gridModeOverride
        : EGridMode.NONE;
    console.debug('input', `Using grid mode: ${gridMode}${gridModeOverride ? ' (override)' : ''}`);

    // Validate input files
    if (!document_files_revisions || document_files_revisions.length === 0) {
        throw new Error('No source files revisions were provided in the request');
    }

    console.debug('input', `Validated ${document_files_revisions.length} file revisions`);

    console.debug('input', `Enriching and rendering document with ${document_files_revisions.length} file revisions`);

    // globalPageOffset tracks cumulative page count across files.
    // It serves two purposes:
    //   1. Grid label numbering: generateImagesWithGrid uses it so labels show absolute
    //      page numbers (e.g., [P21] for the first page in batch 2 starting at page 21).
    //   2. requestedPages filtering: maps absolute 1-based page numbers to file-relative numbers.
    //
    // For purpose #2, this MUST start at 0 for correct absolute→file-relative mapping.
    // For purpose #1, we need to add pageNumberOffset.
    //
    // In practice, purpose #2 (requestedPages filtering) only triggers for raw PDFs
    // (first batch, where pageNumberOffset is always 0), so both purposes align.
    // For pre-rendered files (subsequent batches), create.ts already filtered the pages,
    // so purpose #2 doesn't apply. Purpose #1 (grid labels) is what matters.
    //
    // We initialize at 0 for correct filtering and add pageNumberOffset only for grid labels.
    let globalPageOffset = 0;
    for (let i = 0; i < document_files_revisions.length; i++) {
        const fileRev = document_files_revisions[i] as IDocumentFileRevision;

        try {
            // ────────────────────────────────────────────────────────────────
            // UNIFIED FLOW: images (1 page) and PDFs (any page count) go through
            // the same per-page cache-lookup pipeline.
            //
            // 1. Detect mime type from raw data (Rails always sends raw).
            // 2. Determine total page count (1 for images, getPdfPageCount for PDFs).
            // 3. Compute filePageNumbers (file-relative 1-based) for this batch.
            // 4. Split into cached (use as-is) vs missing (render).
            // 5. Render only missing pages.
            // 6. Merge into fileRev.pages in filePageNumbers order.
            // 7. Stash _freshlyRenderedPagesByIndex for create.ts to build the response.
            // ────────────────────────────────────────────────────────────────

            const cachedHash = (fileRev as any).cached_pages_by_index as Record<string, IPageInfoExtended> | undefined;

            if (!fileRev.data || fileRev.data.length < MIN_FILE_DATA_SIZE) {
                throw new Error(`File revision at index ${i} has invalid (small) fileData length`);
            }

            const fileAsBase64String = fileRev.data;
            const fileName = fileRev.name;
            const uint8ArrayWithInputFile = new Uint8Array(Buffer.from(fileAsBase64String, 'base64'));
            console.debug('input', `Processing file #${i + 1} of ${document_files_revisions.length}. Raw size = ${uint8ArrayWithInputFile.length} bytes, cached=${cachedHash ? Object.keys(cachedHash).length : 0}`);

            const fileType: EInputFileMimeType = await getInputMimeTypeFromBase64Data(fileAsBase64String);
            if (fileType === EInputFileMimeType.UNKNOWN) {
                throw new Error(`File type is UNKNOWN for file: ${fileName}, size: ${uint8ArrayWithInputFile.length} bytes`);
            }
            fileRev.mime_type = fileType.toString();

            // Determine total file page count
            let totalFilePages: number;
            if (isMimeTypeImage(fileType)) {
                totalFilePages = 1;
            } else if (isMimeTypePdf(fileType)) {
                totalFilePages = (fileRev as any)._totalFilePageCount || await getPdfPageCount(uint8ArrayWithInputFile);
            } else {
                throw new Error('Unsupported file type');
            }
            (fileRev as any)._totalFilePageCount = totalFilePages;

            // Compute filePageNumbers (file-relative 1-based) for this batch.
            let filePageNumbers: number[];
            if (requestedPages && requestedPages.length > 0) {
                const fileUpperBound = globalPageOffset + totalFilePages;
                filePageNumbers = requestedPages
                    .filter(p => p > globalPageOffset && p <= fileUpperBound)
                    .map(p => p - globalPageOffset);
            } else {
                filePageNumbers = [];
                for (let k = 1; k <= totalFilePages; k++) filePageNumbers.push(k);
            }

            if (filePageNumbers.length === 0) {
                console.debug('input', `File #${i + 1}: no pages in batch, skipping`);
                fileRev.pages = [];
                (fileRev as any)._freshlyRenderedPagesByIndex = {};
                if (!fileRev.metadata || !fileRev.metadata.trim()) {
                    fileRev.metadata = `\nFile #${i + 1} of ${document_files_revisions.length}\nFile Name: ${fileName}\nFile Type: ${fileType.toString()}`;
                }
                globalPageOffset += totalFilePages;
                continue;
            }

            // Build metadata (always runs when we have pages in this batch).
            if (isMimeTypeImage(fileType)) {
                const sharpMeta = await sharp(uint8ArrayWithInputFile).metadata();
                const imageMetadata = await buildImageMetadataString(
                    uint8ArrayWithInputFile, sharpMeta, fileType, fileName, uint8ArrayWithInputFile.length
                );
                fileRev.metadata = `\nFile #${i + 1} of ${document_files_revisions.length}\n${imageMetadata}`;
            } else {
                fileRev.metadata = `\nFile #${i + 1} of ${document_files_revisions.length}\nFile Type: ${fileType.toString()}\nFile Name: ${fileName}\nFile Size: ${uint8ArrayWithInputFile.length} bytes`;
            }

            // Split filePageNumbers into cached vs missing (per-page cache lookup).
            const cachedPagesInOrder: (IPageInfoExtended | null)[] = [];
            const missingPageNumbers: number[] = [];
            for (const pn of filePageNumbers) {
                const fileRel0 = String(pn - 1);
                const hit = cachedHash?.[fileRel0];
                if (hit && hit.pageAsImage) {
                    if (!hit.pageAsImageWithGrid) hit.pageAsImageWithGrid = '';
                    cachedPagesInOrder.push(hit);
                } else {
                    cachedPagesInOrder.push(null);
                    missingPageNumbers.push(pn);
                }
            }

            // Render only the missing pages.
            const freshlyRendered: Record<number, IPageInfoExtended> = {};
            if (missingPageNumbers.length > 0) {
                if (isMimeTypeImage(fileType)) {
                    // Single-image file: render its one page (missingPageNumbers must contain [1]).
                    const image = sharp(uint8ArrayWithInputFile);
                    const metadata = await image.metadata();
                    const original_width: number = metadata.width || 0;
                    const original_height: number = metadata.height || 0;
                    let scaling_factor: number = 1.0;
                    let finalWidth: number = original_width;
                    let finalHeight: number = original_height;
                    if (
                        original_width > DocumentToImageRenderingOptions.maxSideSize ||
                        original_height > DocumentToImageRenderingOptions.maxSideSize
                    ) {
                        scaling_factor = DocumentToImageRenderingOptions.maxSideSize / Math.max(original_width, original_height);
                    } else if (
                        original_width < DocumentToImageRenderingOptions.minSideSize ||
                        original_height < DocumentToImageRenderingOptions.minSideSize
                    ) {
                        scaling_factor = DocumentToImageRenderingOptions.minSideSize / Math.min(original_width, original_height);
                    }
                    if (scaling_factor !== 1.0) {
                        finalWidth = Math.round(original_width * scaling_factor);
                        finalHeight = Math.round(original_height * scaling_factor);
                        image.resize(finalWidth, finalHeight, { fit: 'inside' });
                    }
                    const pageBuffer = CONVERT_TO_JPEG_BEFORE_SENDING_TO_AI
                        ? await image.jpeg({ quality: RENDERED_PAGES_JPEG_QUALITY }).toBuffer()
                        : await image.png().toBuffer();
                    freshlyRendered[0] = {
                        pageAsImage: pageBuffer.toString('base64'),
                        pageAsImageWithGrid: '',
                        width: finalWidth,
                        height: finalHeight,
                        original_width: original_width,
                        original_height: original_height,
                        scaling_factor: scaling_factor,
                        crop_offset_x: 0,
                        crop_offset_y: 0,
                    } as IPageInfoExtended;
                } else {
                    // PDF: render only missing pages.
                    const conversionResult: IPDFToImageResult = await convertPdfToImages(
                        fileName, uint8ArrayWithInputFile, DocumentToImageRenderingOptions, missingPageNumbers
                    );
                    if (!conversionResult.images || conversionResult.images.length === 0) {
                        throw new Error('Failed to convert PDF to images');
                    }
                    for (let k = 0; k < conversionResult.images.length; k++) {
                        const pageDims = conversionResult.page_dimensions[k];
                        const pageBuffer = CONVERT_TO_JPEG_BEFORE_SENDING_TO_AI
                            ? await sharp(Buffer.from(conversionResult.images[k], 'base64')).jpeg({ quality: RENDERED_PAGES_JPEG_QUALITY }).toBuffer()
                            : Buffer.from(conversionResult.images[k], 'base64');
                        const fileRel0 = missingPageNumbers[k] - 1;
                        freshlyRendered[fileRel0] = {
                            width: pageDims.width,
                            height: pageDims.height,
                            original_width: pageDims.original_width,
                            original_height: pageDims.original_height,
                            scaling_factor: pageDims.scaling_factor,
                            pageAsImage: pageBuffer.toString('base64'),
                            pageAsImageWithGrid: '',
                            crop_offset_x: 0,
                            crop_offset_y: 0,
                        };
                    }
                    (fileRev as any)._totalFilePageCount = conversionResult.totalPageCount;
                }
                console.debug('input', `File #${i + 1}: rendered ${Object.keys(freshlyRendered).length} fresh pages, reused ${cachedPagesInOrder.filter(Boolean).length} from cache`);
            } else {
                console.debug('input', `File #${i + 1}: all ${cachedPagesInOrder.length} pages served from cache (0 fresh)`);
            }

            // Merge cached + fresh into fileRev.pages in filePageNumbers order.
            fileRev.pages = cachedPagesInOrder.map((cached, idx) => {
                if (cached) return cached;
                const fileRel0 = filePageNumbers[idx] - 1;
                return freshlyRendered[fileRel0];
            });

            // Snapshot the freshly-rendered pages for the Rails cache upload BEFORE
            // post-processing mutates them. compressEmptyImagesInPages rewrites blank
            // pageInfo objects in place (pageAsImage → 1×1 placeholder, width/height → 1),
            // and since freshlyRendered shares references with fileRev.pages, the cached
            // snapshot would otherwise land in Rails as a 1×1 stub. Shallow-clone each
            // fresh page (with a deep copy of content_bounding_box since it's a nested
            // object) so the cache keeps the real rendered bytes and dimensions.
            const freshlyRenderedForCache: Record<number, IPageInfoExtended> = {};
            for (const [idxStr, p] of Object.entries(freshlyRendered)) {
                freshlyRenderedForCache[Number(idxStr)] = {
                    ...p,
                    content_bounding_box: p.content_bounding_box ? { ...p.content_bounding_box } : undefined,
                } as IPageInfoExtended;
            }
            (fileRev as any)._freshlyRenderedPagesByIndex = freshlyRenderedForCache;
            (fileRev as any)._renderedPageOffset = filePageNumbers[0] - 1;

            // Post-processing: ALWAYS runs regardless of whether pages were pre-rendered or freshly rendered.
            // compressEmptyImagesInPages replaces blank pages with tiny placeholders.
            // generateImagesWithGrid adds grid overlays needed for AI analysis (skipped for export path).
            fileRev.pages = await compressEmptyImagesInPages(fileRev.pages as IPageInfoExtended[]);
            if (!skipGrid) {
                fileRev.pages = await generateImagesWithGrid(fileRev.pages as IPageInfoExtended[], gridMode, globalPageOffset + pageNumberOffset, aiCoordScale);
            } else {
                // No grid — copy raw image so AI code can still read pageAsImageWithGrid
                for (const page of fileRev.pages) {
                    const p = page as IPageInfoExtended;
                    if (!p.pageAsImageWithGrid) {
                        p.pageAsImageWithGrid = p.pageAsImage;
                    }
                }
            }
            // Use total file page count (not rendered count) for offset tracking across files.
            // When rendering a subset (batch mode), rendered count < total file pages.
            globalPageOffset += (fileRev as any)._totalFilePageCount || fileRev.pages.length;

        } catch (error) {
            console.error('Error in enrichAndRenderFilesRelatedToEnvelopeRevision:', error);
            throw error;
        }
    }  // for


    return document_files_revisions;
};
