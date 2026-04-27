import { IPageInfo, IEnvelopeRevision, REVDOKU_SMALLEST_BASE64_PNG, IChecklist, IRule, hasValueMarker, stripValueMarker } from "@revdoku/lib";
import { safeStringify } from './logger';
import { checkImageHasContent } from "./image-utils";
import { addVisualGroundingToImage } from "./image-utils";
import sharp from 'sharp';
import {
    IPageInfoExtended,
    IChecklistSimplified,
    IRuleSimplified,
    IReferenceFile,
    IValueReplacementsResult,
    ORIGINAL_FIELD_NAME_FOR_EXTERNAL_ID,
    EGridMode,
    ICheckRawFromAI,
    EPageContentType
} from "../schemas/common-server";
import { mergeRulePromptWithChecks } from "./checklist-utils";
import { sanitizeUserInput } from "./prompt-sanitizer";
import { AI_IMAGE_MAX_SIDE_SIZE } from '../schemas/ai-models';
import { detectContentBoxes, classifyPageContentType } from './content-detection';
import { getGridModeConfig } from './grid-mode-config';
import { calculateRoundStep } from './image-utils';


export async function generateImagesWithGrid(sourcePages: IPageInfoExtended[], gridMode: EGridMode = EGridMode.RULERS_EXTERNAL_WITH_SUBTLE_GRID, pageOffset: number = 0, aiCoordScale: number = 0): Promise<IPageInfoExtended[]> {


    if(!sourcePages) {
        throw new Error(`generateImagesWithGrid: sourcePageInfo is not valid`);
    }

    try {
        console.debug('input', 'Adding visual grounding to images...');

        for (let pageIndex = 0; pageIndex < sourcePages.length; pageIndex++) {
            const pageInfo: IPageInfoExtended = sourcePages[pageIndex];
            if (!pageInfo || pageInfo.width < 2 || pageInfo.height < 2) {
                console.warn(`generateImagesWithGrid: Skipping blank/tiny page (${pageInfo?.width}x${pageInfo?.height}), page index: ${pageIndex + 1}`);
                if (pageInfo) pageInfo.page_type = EPageContentType.BLANK;
                continue;
            }

            // IDEMPOTENT RESET — critical for withAIRetry correctness.
            //
            // Problem: withAIRetry (ai-utils.ts) retries ai.inspectInput on transient
            // AI errors (429, 502, 503, 504). Each retry calls this function on the SAME
            // page objects. This function mutates width, height, scaling_factor, and
            // crop_offset_x/y in-place. Without reset:
            //   - 1st call: scaling_factor *= resizeFactor (e.g., 1.51 → 1.11)
            //   - 2nd call (retry): crop block is SKIPPED (crop_offset_x ≠ 0 from 1st call),
            //     but downscale runs AGAIN: scaling_factor *= resizeFactor (1.11 → 0.67)
            //   - Each retry compounds, causing page_coordinate_spaces to grow exponentially
            //     (590 → 816 → 1348), making all highlight coordinates overflow the page.
            //
            // Fix: save original values on first call, restore them on retries so every
            // invocation starts from the same clean state.
            if ((pageInfo as any)._original_scaling_factor == null) {
                (pageInfo as any)._original_scaling_factor = pageInfo.scaling_factor;
                (pageInfo as any)._original_width = pageInfo.width;
                (pageInfo as any)._original_height = pageInfo.height;
            } else {
                pageInfo.scaling_factor = (pageInfo as any)._original_scaling_factor;
                pageInfo.width = (pageInfo as any)._original_width;
                pageInfo.height = (pageInfo as any)._original_height;
            }
            pageInfo.crop_offset_x = 0;
            pageInfo.crop_offset_y = 0;

            // Step 1: Crop white margins for AI using content-box detection.
            // pageAsImage always stores the original non-cropped image.
            // We detect content boxes, compute a bounding box, and crop to it for grid generation.
            let imageForGrid: Buffer;
            const gridModeConfig = getGridModeConfig(gridMode);
            if (gridModeConfig.cropMargins && !(pageInfo.crop_offset_x) && !(pageInfo.crop_offset_y)) {
                const originalBuffer = Buffer.from(pageInfo.pageAsImage, 'base64');
                const imgMeta = await sharp(originalBuffer).metadata();
                const imgWidth = imgMeta.width || pageInfo.width;
                const imgHeight = imgMeta.height || pageInfo.height;

                // Detect content boxes with high sensitivity for accurate bounding box
                const { contentBoundingBox, contentBoxes } = await detectContentBoxes(originalBuffer, {
                    gridCellSize: 50,              // finer grid for margin accuracy
                    contentThresholdPercent: 5,     // catch light text
                    colorDiffThreshold: 20,        // catch subtle content
                });

                // Store filtered boxes for label placement (used later in ai.ts)
                // Content boxes are detected on the ORIGINAL uncropped image (pixel coords).
                // Convert to document space: doc_coord = pixel / scaling_factor
                // At this point crop_offset is 0 (no cropping has happened yet), so no offset added.
                // After cropping below, content_boxes are re-mapped with the final crop offsets.
                const sf = pageInfo.scaling_factor || 1;
                pageInfo.content_boxes = contentBoxes.map(cb => ({
                    x1: Math.round(cb.x1 / sf),
                    y1: Math.round(cb.y1 / sf),
                    x2: Math.round(cb.x2 / sf),
                    y2: Math.round(cb.y2 / sf),
                }));

                // Classify page content type from detected content boxes
                pageInfo.page_type = classifyPageContentType(
                    contentBoundingBox,
                    contentBoxes,
                    imgWidth,
                    imgHeight,
                );

                // Crop to content bounding box + padding
                if (contentBoundingBox) {
                    const DEFAULT_PADDING = 10;
                    let paddingTop = DEFAULT_PADDING;
                    let paddingRight = DEFAULT_PADDING;
                    let paddingBottom = DEFAULT_PADDING;
                    let paddingLeft = DEFAULT_PADDING;

                    if (gridModeConfig.labelsOnContent) {
                        // OVERLAY_GRID_* draws labels at:
                        //   X-axis: (px+2, fontSize+2) — along the TOP edge
                        //   Y-axis: (2, py+fontSize+2) — along the LEFT edge
                        // Only top and left need extra padding; right/bottom stay at DEFAULT_PADDING
                        // so [P1] label stays close to the right edge.
                        const estimatedW = AI_IMAGE_MAX_SIDE_SIZE; // approximate final width after downscale
                        const scaledStep = aiCoordScale > 0 ? calculateRoundStep(aiCoordScale) : calculateRoundStep(estimatedW);
                        const pixelStep = aiCoordScale > 0
                            ? Math.round(scaledStep / aiCoordScale * estimatedW)
                            : scaledStep;

                        // Font size: same formula as OVERLAY_GRID_* (MIN 10, MAX 18, 0.3 * pixelStep)
                        const fontSize = Math.min(18, Math.max(10, Math.floor(pixelStep * 0.3)));

                        // Top min margin = X-axis label height (font size + small gap)
                        const minMarginTop = fontSize + 4;

                        // Left min margin = Y-axis label text width + small gap
                        // Widest Y-axis label is the max scale value (e.g. "1000")
                        const maxLabelStr = (aiCoordScale > 0 ? aiCoordScale : estimatedW).toString();
                        const estCharWidth = fontSize * 0.65; // approximate char width
                        const minMarginLeft = Math.round(maxLabelStr.length * estCharWidth) + 6;

                        paddingTop = Math.max(DEFAULT_PADDING, minMarginTop);
                        paddingLeft = Math.max(DEFAULT_PADDING, minMarginLeft);

                        // Right padding: ensure [P1] badge isn't clipped at the edge
                        const pageLabelText = `[P${sourcePages.length}]`;
                        const badgeCharWidth = fontSize * 0.65;
                        const estBadgeWidth = Math.round(pageLabelText.length * badgeCharWidth + 6 + 4); // padX*2 + offset
                        paddingRight = Math.max(DEFAULT_PADDING, estBadgeWidth);
                    }

                    const cropX = Math.max(0, contentBoundingBox.x1 - paddingLeft);
                    const cropY = Math.max(0, contentBoundingBox.y1 - paddingTop);
                    const cropW = Math.min(imgWidth, contentBoundingBox.x2 + paddingRight) - cropX;
                    const cropH = Math.min(imgHeight, contentBoundingBox.y2 + paddingBottom) - cropY;

                    if (cropW > 0 && cropH > 0 && (cropW < imgWidth - 2 || cropH < imgHeight - 2)) {
                        imageForGrid = await sharp(originalBuffer)
                            .extract({ left: Math.round(cropX), top: Math.round(cropY),
                                       width: Math.round(cropW), height: Math.round(cropH) })
                            .png().toBuffer();

                        pageInfo.crop_offset_x = Math.round(cropX / sf);
                        pageInfo.crop_offset_y = Math.round(cropY / sf);

                        // Store bbox in document space (for persistence and export cropping)
                        pageInfo.content_bounding_box = {
                            x1: Math.round(contentBoundingBox.x1 / sf),
                            y1: Math.round(contentBoundingBox.y1 / sf),
                            x2: Math.round(contentBoundingBox.x2 / sf),
                            y2: Math.round(contentBoundingBox.y2 / sf),
                        };

                        // Update width/height from cropped image
                        const croppedMeta = await sharp(imageForGrid).metadata();
                        pageInfo.width = croppedMeta.width || pageInfo.width;
                        pageInfo.height = croppedMeta.height || pageInfo.height;

                        // Content boxes are already mapped at lines 59-64 as round(orig_pixel/sf).
                        // No re-mapping needed — this is correct document space:
                        //   (0,0) = top-left of full page, cropOff = start of cropped region.
                        // renderPageDebugOverlay: (doc - cropOff) * sf = orig - cropX = cropped_pixel ✓
                        // drawDebugBoxes: doc * sf = orig_pixel ✓
                    } else {
                        imageForGrid = originalBuffer;
                    }
                } else {
                    imageForGrid = originalBuffer;
                    if (!pageInfo.page_type) pageInfo.page_type = EPageContentType.UNKNOWN;
                }
            } else {
                imageForGrid = Buffer.from(pageInfo.pageAsImage, 'base64');
                if (!pageInfo.page_type) pageInfo.page_type = EPageContentType.UNKNOWN;
            }

            // Step 2: Downscale cropped image to AI_IMAGE_MAX_SIDE_SIZE
            // After crop, the image may be larger than the AI target size (since we render at ~1.5x).
            // Downscale to fit AI_IMAGE_MAX_SIDE_SIZE so AI always gets a consistent image size.
            {
                const dsMetaData = await sharp(imageForGrid).metadata();
                const dsW = dsMetaData.width || pageInfo.width;
                const dsH = dsMetaData.height || pageInfo.height;
                const maxSide = Math.max(dsW, dsH);
                if (maxSide > AI_IMAGE_MAX_SIDE_SIZE) {
                    const resizeFactor = AI_IMAGE_MAX_SIDE_SIZE / maxSide;
                    const newW = Math.round(dsW * resizeFactor);
                    const newH = Math.round(dsH * resizeFactor);
                    imageForGrid = await sharp(imageForGrid).resize(newW, newH).png().toBuffer();
                    pageInfo.width = newW;
                    pageInfo.height = newH;
                    pageInfo.scaling_factor *= resizeFactor;
                }
            }

            // Step 3: Generate grid on the cropped image
            const groundedBuffer = await addVisualGroundingToImage(
                new Uint8Array(imageForGrid),
                pageOffset + pageIndex + 1,
                pageInfo,  // now has updated width/height/crop_offsets
                gridMode,
                { x: pageInfo.crop_offset_x || 0, y: pageInfo.crop_offset_y || 0 },
                aiCoordScale
            );

            pageInfo.pageAsImageWithGrid = Buffer.from(groundedBuffer).toString('base64');
            pageInfo.gridMode = gridMode;
        }

        const processedCount = sourcePages.filter(p => p.width >= 2 && p.height >= 2).length;
        if (processedCount === 0) {
            throw new Error('All pages in the document are blank. Please upload a document with content.');
        }

        console.debug('input', 'generateImagesWithGrid: Visual grounding added successfully');
        return sourcePages;


    } catch (e) {
        throw new Error(`generateImagesWithGrid: Failed to add visual grounding: ${e}`);
    }
}

export async function compressEmptyImagesInPages(sourcePages: IPageInfoExtended[]): Promise<IPageInfoExtended[]> {
    if (!sourcePages?.length) {
        return sourcePages;
    }

    for (let pageIndex = 0; pageIndex < sourcePages.length; pageIndex++) {
        const pageInfo: IPageInfoExtended = sourcePages[pageIndex];
        console.log('input', `compressEmptyImagesInPages: current width / height: ${pageInfo.width} / ${pageInfo.height}`);
        const hasContent = await checkImageHasContent(pageInfo.pageAsImage);
        if (!hasContent) {
            console.log('input', 'compressEmptyImagesInPages: no content, setting to smallest base64 png');
            pageInfo.pageAsImage = REVDOKU_SMALLEST_BASE64_PNG;
            pageInfo.width = 1;
            pageInfo.height = 1;
            pageInfo.original_width = 1;
            pageInfo.original_height = 1;
            pageInfo.scaling_factor = 1.0;
        }
    }

    return sourcePages;
}


  
  /**
   * Substitute `file:<dfrev_prefix_id>` canonical tokens in the given text
   * with the content of the matching reference file from `referenceFiles`.
   *
   * Rails writes these tokens into rule prompts and into the checklist
   * system_prompt during enrichment (see RuleFileResolver#rewrite_with_refs).
   * Each referenced DocumentFileRevision has already been OCR'd by the
   * `/file/normalize` pipeline at upload time, so by the time we get here
   * every reference file has a plain-text `content` field ready to splice in.
   *
   * Images and PDFs are handled identically — they're all text at this
   * point. If a token has no matching reference entry we leave it alone
   * so the AI can still see that something was referenced (and so the
   * prompt-injection guard logs a visible anomaly).
   */
  export function substituteReferenceFileTokens(
    text: string,
    referenceFiles: IReferenceFile[] | undefined
  ): string {
    if (!text || !referenceFiles || referenceFiles.length === 0) return text;

    const byDfrevId = new Map<string, IReferenceFile>();
    for (const rf of referenceFiles) {
      if (rf.document_file_revision_id) byDfrevId.set(rf.document_file_revision_id, rf);
    }

    // Rails rewrites all resolved markers to the canonical
    // `#ref[file:<dfrev>]` or `#ref[file:<dfrev>|<label>]` form before
    // the request reaches revdoku-doc-api. Unresolved tokens (e.g. deferred
    // markers that were never pinned) are left as-is for debugging.
    return text.replace(/#ref\[file:(dfrev_[A-Za-z0-9]+)(?:\|[^\]]*)?\]/g, (_match, dfrevId) => {
      const rf = byDfrevId.get(dfrevId);
      if (!rf) return _match;
      const content = rf.content ?? '';
      const label = rf.file_index ? `#file_${rf.file_index} ` : '';
      const endLabel = rf.file_index ? ` #file_${rf.file_index}` : '';
      // `content` already carries per-page `[REFERENCE #file_N page=N] ... [END OF REFERENCE PAGE]`
      // blocks emitted by Rails (see build_revdoku_doc_api_ref_files). We still wrap the whole thing
      // in an outer REFERENCE envelope so the existing prompt guidance keeps working.
      return `[REFERENCE ${label}mime=${rf.mime_type}]\n${content}\n[END OF REFERENCE${endLabel}]`;
    });
  }

  // Utility function to sanitize checklist data before sending to AI
  // and by including only required fields, not more. When `ref_files`
  // is supplied, `file:<dfrev_prefix_id>` canonical tokens in rule prompts
  // get substituted with their text content (the "final prompt assembly"
  // step of the reference-file feature). The system_prompt gets the same
  // treatment in ai.ts before being added to the system message.
  export function convertChecklistToSimplifiedForAI (
    checklist: IChecklist,
    referenceFiles?: IReferenceFile[],
  ): IChecklistSimplified {

    for(const rule of checklist.rules) {
      if(!rule.id || !rule.prompt) {
        throw new Error(`sanitizeAndSimplifyChecklistForAI: found INVALID rule! id: '${rule.id}', prompt: '${rule.prompt}'`);
      }
    }

    const sanitizedChecklist: IChecklistSimplified = {
      name: checklist.name,
      system_prompt: substituteReferenceFileTokens(checklist.system_prompt || '', referenceFiles),
      rules: checklist.rules.map((rule: IRule) => {
        const mergedPrompt = mergeRulePromptWithChecks({ rule });
        const substituted = substituteReferenceFileTokens(mergedPrompt, referenceFiles);
        return {
          id: rule.id,
          prompt: sanitizeUserInput(substituted),
        } as IRuleSimplified;
      })
    };

    console.debug('sanitizedChecklist', safeStringify(sanitizedChecklist));
    return sanitizedChecklist;
  };
  
  // Utility function to check for unreplaced variables in prompts
  export function checkPromptForUnreplacedVariables (prompt: string): boolean {
    const regex = new RegExp(`{{[^}]+}}`, "g");
    const matches = prompt.match(regex);
    return matches ? matches.length > 0 : false;
  };

export function replaceValuesToSimplified(
        {
            inputList, 
            fieldName,
            newValuePrefix
        }: {
            inputList: any[],
            fieldName: string,
            newValuePrefix: string
        }
) : IValueReplacementsResult {
    
    const valueReplacementMap: Record<string, string> = {};

    let idCounter: number = 0;
    // create the map for replacement first
    for(const item of inputList) {
        const value = item[fieldName];
        if(!value || value.length === 0) {
            throw new Error(`generateShortIdFromLongId: value is not valid! fieldName: ${ORIGINAL_FIELD_NAME_FOR_EXTERNAL_ID}, value: ${value}`);
        }

        // lookup if such value already exists
        if(!valueReplacementMap[value]) {
            // if not, generate new value
            const newValue = `${newValuePrefix}${idCounter}`;
            valueReplacementMap[value] = newValue;
            // do the actual replacement!
            item[fieldName] = newValue;
            idCounter++;
        }        
    }

    if(idCounter === 0) {
        throw new Error(`replaceValuesToSimplified: idCounter is 0! newValuePrefix: ${newValuePrefix}`);
    }
    
    return {
        // update array of items with new field names and new values
        outputArray: inputList,
        // map of original values to new values
        replacementsMap: valueReplacementMap
    } as IValueReplacementsResult;
}

export function renameFieldInItemsInArray({
    inputArray,
    oldFieldName,
    newFieldName
}: {
    inputArray: IRuleSimplified[],
    oldFieldName: string,
    newFieldName: string
}) {
    for(const item of inputArray) {

        if(!item[oldFieldName]) {
            throw new Error(`renameFieldInItemsInArray: item[oldFieldName] is not valid! item: ${JSON.stringify(item, null, 2)}`);
        }

        // copying value from old field name to new field name
        item[newFieldName] = item[oldFieldName];
        // deleting old field name
        delete item[oldFieldName];
    }

    console.debug("renameFieldInItemsInArray: inputArray", safeStringify(inputArray));

    return inputArray;
}


export function restoreValuesFromSimplified(
    {
        inputList,
        fieldName,
        replacementMap
    }: {
        inputList: any[],
        fieldName: string,
        replacementMap: Record<string, string>
    }
): any[] {

    // Create a reverse mapping (newValue -> originalKey)
    const reverseMap: Record<string, string> = {};
    for (const originalKey in replacementMap) {
        const newValue = replacementMap[originalKey];
        reverseMap[newValue] = originalKey;
    }

    // Process each item in the input list
    for (const item of inputList) {
        // Check each property of the item
            const value = item[fieldName];
            // If this value exists in our reverse map, replace it with the original key
            if (reverseMap[value]) {
                item[fieldName] = reverseMap[value];
            }
    }

    //console.debug("restoreValuesAndFieldNamesFromReplacementMap: inputList", JSON.stringify(inputList, null, 2));
    // return updated input list
    return inputList;
}

/**
 * Retries an async AI call on transient HTTP errors (429, 502, 503, 504, 529).
 * The OpenAI SDK already retries 2x internally; this adds revdoku-doc-api-level retries
 * on top, with exponential backoff. Rate-limit (429) errors use longer delays.
 */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504, 529]);
const MAX_AI_RETRIES = 2;

function parseRetryAfterHeader(error: any): number {
  const raw = error?.headers?.['retry-after'];
  if (!raw) return 0;
  const secs = Number(raw);
  // Cap at 60s to avoid waiting forever on bogus values
  return !isNaN(secs) && secs > 0 ? Math.min(secs, 60) : 0;
}

export async function withAIRetry<T>(
  fn: () => Promise<T>,
  label: string = 'AI call',
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.status;
      const isRetryable = typeof status === 'number' && RETRYABLE_STATUSES.has(status);

      if (attempt < MAX_AI_RETRIES && isRetryable) {
        let delayMs: number;
        if (status === 429) {
          const retryAfterSec = parseRetryAfterHeader(error);
          delayMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 10_000 * (attempt + 1); // 10s, 20s
        } else {
          delayMs = 3000 * (attempt + 1); // 3s, 6s for server errors
        }
        console.warn(`${label}: ${status === 429 ? 'rate limited' : 'transient error'} (HTTP ${status}), retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_AI_RETRIES})...`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw error; // not retryable or retries exhausted
    }
  }
}

/**
 * Returns a user-friendly error message for AI failures.
 * Prefixes transient errors with a helpful message; passes others through.
 */
export function friendlyAIErrorMessage(error: any): string {
  const rawMsg = error?.error?.message || error?.message || 'Unknown error';
  const status = error?.status;

  if (status === 429) {
    return `The AI service is rate-limited. Please wait a moment and try again. (${rawMsg})`;
  }
  if (typeof status === 'number' && RETRYABLE_STATUSES.has(status)) {
    return `The AI service is temporarily unavailable. Please try again in a few minutes. (${rawMsg})`;
  }
  if (status === 401 || status === 403) {
    return `Provider rejected the API key (HTTP ${status}). Verify it in Settings → AI. (${rawMsg})`;
  }
  if (status === 400) {
    return `AI request rejected by provider. Please try again or switch to a different AI model. (${rawMsg})`;
  }
  return rawMsg;
}

/**
 * Returns true if the AI error is a transient upstream failure (429/502/503/504/529).
 */
export function isTransientAIError(error: any): boolean {
  const status = error?.status;
  return typeof status === 'number' && RETRYABLE_STATUSES.has(status);
}

/**
 * Returns true if the AI error is an authentication / authorization failure
 * (401/403). Route handlers use this to map these errors to HTTP 401 instead
 * of being absorbed by the generic 400 (`invalid_request_error`) branch.
 */
export function isAuthAIError(error: any): boolean {
  const status = error?.status;
  return status === 401 || status === 403;
}

/**
 * Validates and coerces the raw AI response structure after JSON parse.
 * Ensures results array contains valid entries with required fields.
 * Coerces types where safe (e.g. "true" → true, string numbers → numbers).
 */
export function validateAIResponse(
  reportFromAI: any
): { valid: boolean; results: ICheckRawFromAI[]; errors: string[] } {
  const errors: string[] = [];

  if (!reportFromAI.results || !Array.isArray(reportFromAI.results)) {
    errors.push(`Expected 'results' array but got: ${typeof reportFromAI.results}`);
    return { valid: false, results: [], errors };
  }

  if (reportFromAI.results.length === 0) {
    errors.push('results array is empty');
    return { valid: false, results: [], errors };
  }

  const validResults: ICheckRawFromAI[] = [];

  for (let i = 0; i < reportFromAI.results.length; i++) {
    const result = reportFromAI.results[i];

    if (!result.ruleId || typeof result.ruleId !== 'string') {
      if (result.ruleId !== undefined && result.ruleId !== null) {
        result.ruleId = String(result.ruleId);
        errors.push(`Result ${i}: coerced ruleId to string "${result.ruleId}"`);
      } else {
        errors.push(`Result ${i}: missing 'ruleId'`);
        continue;
      }
    }

    if (!result.checks || !Array.isArray(result.checks) || result.checks.length === 0) {
      errors.push(`Result ${i} (ruleId="${result.ruleId}"): missing or empty 'checks' array`);
      continue;
    }

    const validChecks: Array<ICheckRawFromAI['checks'][0]> = [];

    for (let j = 0; j < result.checks.length; j++) {
      const check = result.checks[j];

      // Coerce 'passed' field
      if (typeof check.passed === 'string') {
        check.passed = check.passed === 'true';
        errors.push(`Result ${i}, check ${j}: coerced 'passed' from string to boolean`);
      }
      if (typeof check.passed !== 'boolean') {
        errors.push(`Result ${i}, check ${j}: 'passed' is not a boolean (got ${typeof check.passed})`);
        check.passed = false; // default to failed
      }

      // Coerce 'description'
      if (check.description === undefined || check.description === null) {
        check.description = '';
        errors.push(`Result ${i}, check ${j}: missing 'description', defaulting to empty`);
      } else if (typeof check.description !== 'string') {
        check.description = String(check.description);
      }

      // Coerce numeric fields
      const numericFields = ['page', 'x1', 'y1', 'x2', 'y2'] as const;
      let numericValid = true;
      for (const field of numericFields) {
        if (typeof check[field] === 'string') {
          const parsed = Number(check[field]);
          if (!isNaN(parsed)) {
            check[field] = parsed;
            errors.push(`Result ${i}, check ${j}: coerced '${field}' from string to number`);
          } else {
            errors.push(`Result ${i}, check ${j}: '${field}' is not a valid number ("${check[field]}")`);
            numericValid = false;
          }
        } else if (typeof check[field] !== 'number') {
          errors.push(`Result ${i}, check ${j}: '${field}' is not a number (got ${typeof check[field]})`);
          numericValid = false;
        }
      }

      if (!numericValid) {
        continue; // skip checks with invalid coordinates
      }

      validChecks.push({
        passed: check.passed,
        description: check.description,
        page: check.page,
        x1: check.x1,
        y1: check.y1,
        x2: check.x2,
        y2: check.y2,
        ...(check.type !== undefined && { type: check.type }),
        ...(check.val_p !== undefined && { val_p: check.val_p }),
        ...(check.val !== undefined && { val: check.val }),
        ...((check as any).ref !== undefined && { ref: (check as any).ref }),
        ...((check as any).ref_page !== undefined && { ref_page: (check as any).ref_page }),
      });
    }

    if (validChecks.length === 0) {
      errors.push(`Result ${i} (ruleId="${result.ruleId}"): all checks were invalid`);
      continue;
    }

    validResults.push({
      ruleId: result.ruleId,
      checks: validChecks as unknown as ICheckRawFromAI['checks'],
    });
  }

  return {
    valid: validResults.length > 0,
    results: validResults,
    errors,
  };
}

/**
 * Recovers ruleIds when the AI ignores the simplified IDs we provided.
 * Uses positional fallback strategies to avoid silently dropping all checks.
 */
export function recoverRuleIds(
  results: ICheckRawFromAI[],
  expectedRuleIds: string[], // sorted simplified IDs: ["rule0", "rule1", ...]
): { results: ICheckRawFromAI[]; strategy: string } {
  if (results.length === 0 || expectedRuleIds.length === 0) {
    return { results, strategy: 'empty' };
  }

  // Count how many results have a valid ruleId
  const matched = results.filter(r => expectedRuleIds.includes(r.ruleId));
  const unmatched = results.filter(r => !expectedRuleIds.includes(r.ruleId));

  if (matched.length === results.length) {
    // All matched — no recovery needed
    return { results, strategy: 'exact' };
  }

  if (matched.length === 0) {
    // NONE matched — AI completely ignored our ruleIds
    if (results.length === expectedRuleIds.length) {
      // Same count → positional mapping
      const recovered = results.map((r, i) => ({ ...r, ruleId: expectedRuleIds[i] }));
      return { results: recovered, strategy: 'positional' };
    }

    if (results.length === 1) {
      // AI collapsed everything into one result → assign to first rule
      const recovered = [{ ...results[0], ruleId: expectedRuleIds[0] }];
      return { results: recovered, strategy: 'collapsed-to-first' };
    }

    // Different count → best-effort: assign cyclically
    const recovered = results.map((r, i) => ({
      ...r,
      ruleId: expectedRuleIds[i % expectedRuleIds.length],
    }));
    return { results: recovered, strategy: 'best-effort' };
  }

  // SOME matched — keep matched, assign unmatched from remaining unused IDs
  const usedIds = new Set(matched.map(r => r.ruleId));
  const unusedIds = expectedRuleIds.filter(id => !usedIds.has(id));

  let unusedIndex = 0;
  const recovered = results.map(r => {
    if (expectedRuleIds.includes(r.ruleId)) {
      return r; // already valid
    }
    // Assign from unused IDs if available, otherwise use modular cycling
    if (unusedIndex < unusedIds.length) {
      return { ...r, ruleId: unusedIds[unusedIndex++] };
    }
    // Fallback: assign to first expected ID (better than dropping)
    return { ...r, ruleId: expectedRuleIds[0] };
  });

  return { results: recovered, strategy: 'partial' };
}

/**
 * Formats a simplified checklist as structured markdown for the AI prompt.
 * More readable than raw JSON, especially for smaller/local models.
 * Includes the checklist's system_prompt as context alongside the rules.
 */
export function formatChecklistAsMarkdown(checklist: IChecklistSimplified): string {
  const lines: string[] = [];

  lines.push(`**${sanitizeUserInput(checklist.name) || 'Checklist'}** (${checklist.rules.length} rules)`);

  if (checklist.system_prompt?.trim()) {
    lines.push('');
    lines.push(sanitizeUserInput(checklist.system_prompt.trim()));
  }

  lines.push('');

  // If any reference file is present anywhere in the checklist (rule prompts
  // OR the checklist-scoped system_prompt), instruct the AI to populate
  // `ref` whenever a check compares against a ref file value. Previously
  // this directive was only emitted per-rule when the rule's own prompt
  // carried the `[REFERENCE #file_N ...]` block — so checklist-wide refs
  // (rule_id NULL) never triggered it and ref stayed empty.
  const hasAnyRefFile =
    /\[REFERENCE\s+#file_\d+/.test(checklist.system_prompt || '') ||
    checklist.rules.some(r => /\[REFERENCE\s+#file_\d+/.test(r.prompt || ''));
  if (hasAnyRefFile) {
    lines.push(`!SAVE_REF_VALUE! (global): when any check compares a document value to a value from a reference file (any \`[REFERENCE #file_N ...]\` block above, whether in the checklist system prompt or a specific rule), set both \`val\` (document's actual value) and \`ref\` (reference file's value) on that check. Use plain strings. Omit both fields when no comparison was performed.`);
    lines.push('');
  }

  for (const rule of checklist.rules) {
    const ruleId = (rule as any).ruleId || rule.id;
    const rawPrompt = rule.prompt;
    // Strip the #value marker from the displayed prompt — the AI never sees
    // the literal hashtag, only the stripped prose plus (when applicable)
    // the !SAVE_VALUE! directive injected on the following line.
    const displayPrompt = hasValueMarker(rawPrompt) ? stripValueMarker(rawPrompt) : rawPrompt;
    lines.push(`- **${ruleId}**: ${displayPrompt}`);
    if (hasValueMarker(rawPrompt)) {
      lines.push(`  !SAVE_VALUE!: populate the \`val\` field of every check for this rule with the extracted value as a plain string. Follow the format described in the rule text above. Do NOT leave \`val\` empty or omit it. If no value can be extracted at a specific location, set \`val\` to an empty string \`""\` but still include the field.`);
    }
    // Per-rule reminder when the rule's own prompt carries the REFERENCE block.
    if (/\[REFERENCE\s+#file_\d+/.test(rawPrompt)) {
      lines.push(`  !SAVE_REF_VALUE!: this rule references a file above. Populate \`ref\` with the reference file's value for each comparison (alongside \`val\` for the document's value).`);
    }
  }

  return lines.join('\n');
}
