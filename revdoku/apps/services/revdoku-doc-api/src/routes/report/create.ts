import { FastifyPluginAsync } from 'fastify';
import { ai } from '../../lib/ai';
import {
  IReport,
  IChecklist,
  IEnvelopeRevision,
  ICheck,
  IPageInfo,
  IDocumentFileRevision,
  IDocumentFile,
  IRule,
  createNewReport,
} from '@revdoku/lib';
import { IReply, EAIImageAnalysisMode, IDebugOptions, IModelConfig, IPageInfoExtended, IReferenceFile } from '../../schemas/common-server';
import { convertPdfToImages, getPdfPageCount } from '../../lib/pdf-utils';
import { getInputMimeTypeFromBase64Data } from '../../lib/file-utils';
import { EInputFileMimeType, isMimeTypePdf, isMimeTypeImage } from '@revdoku/lib';
import { logStep } from '../../lib/logger';
import { withAIRetry, friendlyAIErrorMessage, isTransientAIError, isAuthAIError } from '../../lib/ai-utils';
import { scanAndLogInjectionAttempts } from '../../lib/prompt-guard';
import sharp from 'sharp';
import { generateThumbnail, THUMBNAIL_MAX_WIDTH, THUMBNAIL_WEBP_QUALITY, THUMBNAIL_CROP_MARGINS } from '../../lib/thumbnail';

/**
 * Parse a pages string like "1,3,5-8,10" into a sorted array of 1-indexed page numbers.
 * Returns null if the string is empty/undefined (meaning "all pages").
 */
function parsePages(pagesStr: string | undefined, totalPages: number): number[] | null {
  if (!pagesStr || pagesStr.trim() === '') return null;

  const result = new Set<number>();
  for (const part of pagesStr.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const rangeParts = trimmed.split('-');
    if (rangeParts.length === 2) {
      const start = parseInt(rangeParts[0], 10);
      const end = parseInt(rangeParts[1], 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
        throw new Error(`Invalid page range: "${trimmed}"`);
      }
      for (let p = start; p <= Math.min(end, totalPages); p++) {
        result.add(p);
      }
    } else if (rangeParts.length === 1) {
      const pageNum = parseInt(trimmed, 10);
      if (isNaN(pageNum) || pageNum < 1) {
        throw new Error(`Invalid page number: "${trimmed}"`);
      }
      if (pageNum <= totalPages) {
        result.add(pageNum);
      }
    } else {
      throw new Error(`Invalid page spec: "${trimmed}"`);
    }
  }

  return [...result].sort((a, b) => a - b);
}


interface IReportCreateBody {
  envelope_revision_id: string;
  document_files_revisions: IDocumentFileRevision[];
  checklist?: IChecklist;  // The report's checklist snapshot (contains all rules including user-added ones)
  envelope_checklist?: IChecklist;  // @deprecated - kept for backward compatibility only
  /**
   * Per-review user context entered in the Review dialog. Appended to the
   * system prompt (after checklist.system_prompt, before the core
   * inspection instructions) inside a `<review_context>` block so the
   * AI treats it as this-run-specific context, not as a checklist rule.
   */
  review_note?: string | null;
  previous_report_checks?: ICheck[];
  ai_mode?: EAIImageAnalysisMode; // optional AI analysis mode
  report_id?: string; // optional ID of the current report to update
  model_config: IModelConfig; // Required — model configuration sent by Rails per-request
  /**
   * Cheap vision model used for text-extraction tasks within the same
   * request: (a) `extractPageTexts` for track_changes, (b) any other
   * OCR-ish pass that doesn't need the full inspection model. Falls
   * back to `model_config` when not supplied.
   */
  text_extraction_model_config?: IModelConfig;
  reserved_check_indices?: number[]; // Indices used by preserved user checks (AI must skip these)
  debug?: IDebugOptions; // optional debug options (dev mode only)
  /**
   * Pages to render/inspect. Supports single pages and ranges: "1,3,5-8"
   * Omit or leave empty to process all pages (default behavior).
   */
  pages?: string;
  inspection_date_display?: string; // Pre-formatted date string for AI prompt {{DATE}} (e.g. "2026-March-5, 2:30 PM (America/Los_Angeles)")
  page_font_scales?: Record<number, number>; // Per-page user font scale for label placement
  skip_thumbnail_file_ids?: string[]; // File revision IDs that already have cached thumbnails — skip generation
  previous_page_texts?: Array<{ page: number; text: string }>; // Page texts from previous revision for change tracking
  /**
   * Maximum number of pages the user can afford based on their credit balance.
   * If the document exceeds this, revdoku-doc-api returns 402 before rendering.
   * For continued reviews, this is compared against remaining pages (total - offset).
   */
  max_affordable_pages?: number;
  session_id?: string; // Hashed session ID for AI debug logging
  pageNumberOffset?: number; // Batch processing: 0-based page offset
  batch_context?: Array<{ file_name: string }>; // Batch processing: file names for context
  current_job_checks?: ICheck[]; // Batch processing: checks from prior batches
  current_job_previous_page_texts?: Array<{ page: number; text: string }>; // Batch processing: page texts from prior batches
  /**
   * When true, revdoku-doc-api does NOT build the `rendered_files` array in the response.
   * Rails sets this when its per-file cache already covers every page in the requested
   * batch range — no fresh pages will be rendered, so there's nothing for Rails to merge
   * back into the cache. Saves response payload size and the cache-merge job overhead.
   */
  skip_rendered_files_response?: boolean;
  /**
   * Top-level reference files payload backing the `#file` / `file:<id>`
   * marker feature. Rails has already rewritten every marker in the rule
   * prompts and in `checklist.system_prompt` into the canonical
   * `file:<document_file_revision_prefix_id>` token form. The revdoku-doc-api
   * substitutes each token with either inline text (for text mimes) or
   * an attached image + text anchor (for image / pdf mimes).
   *
   * See IReferenceFile (common-server.ts) and
   * ReportCreationService#build_revdoku_doc_api_ref_files on the Rails
   * side.
   */
  ref_files?: IReferenceFile[];
}

/**
 * Convert an enriched IPageInfoExtended (as stashed by document-utils.ts on fr.pages)
 * into the wire-format IRenderedFilePage that Rails caches. We read the actual image
 * dimensions via sharp metadata so width/height reflect the real rendered pixel size.
 */
async function buildRenderedFilePage(page: IPageInfoExtended): Promise<IRenderedFilePage> {
  let actualWidth = Math.round((page.original_width || 0) * (page.scaling_factor || 1));
  let actualHeight = Math.round((page.original_height || 0) * (page.scaling_factor || 1));
  try {
    const meta = await sharp(Buffer.from(page.pageAsImage, 'base64')).metadata();
    if (meta.width) actualWidth = meta.width;
    if (meta.height) actualHeight = meta.height;
  } catch {
    /* fall through with the scaled estimates */
  }
  const actualSf = (page.original_width || 0) > 0 ? actualWidth / page.original_width : (page.scaling_factor || 1);
  return {
    pageAsImage: page.pageAsImage,
    pageAsThumbnail: '',
    thumbnailWidth: 0,
    thumbnailHeight: 0,
    width: actualWidth,
    height: actualHeight,
    original_width: page.original_width,
    original_height: page.original_height,
    scaling_factor: actualSf,
    crop_offset_x: (page as any).crop_offset_x || 0,
    crop_offset_y: (page as any).crop_offset_y || 0,
    content_bounding_box: page.content_bounding_box,
  };
}

interface IRenderedFilePage {
  pageAsImage: string;
  pageAsThumbnail: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  width: number;
  height: number;
  original_width: number;
  original_height: number;
  scaling_factor: number;
  crop_offset_x: number;
  crop_offset_y: number;
  content_bounding_box?: { x1: number; y1: number; x2: number; y2: number };
}

interface IRenderedFile {
  id: string;
  // Sparse hash keyed by file-relative 0-based page index. Contains ONLY pages that
  // were freshly rendered in this request (cached pages don't round-trip back to Rails
  // since Rails already has them in its per-file cache). Empty/omitted files are
  // dropped from `rendered_files` entirely.
  pages_by_index: Record<string, IRenderedFilePage>;
}

interface IReportCreateSuccess extends IReply {
  success: true;
  report: IReport;
  rendered_files?: IRenderedFile[]; // Rendered page images for Rails caching
  content_bounding_boxes: Record<string, { x1: number; y1: number; x2: number; y2: number }>; // Per-page content bounding boxes (always present, full page when no cropping)
  page_coordinate_spaces: Record<string, { width: number; height: number }>; // Per-page coordinate space dimensions from getPageDocumentDimensions (always present)
  page_types?: Record<string, string>; // Per-page content type classification (text, image, mixed, blank, unknown, etc.)
  page_statuses?: Record<string, number>; // Per-page review status (0=reviewed, 1=blank, 99=cancelled)
  total_page_count?: number; // Actual page count discovered from document files
  file_page_counts?: Record<string, number>; // Per-file total page counts keyed by file prefix_id (document-wide, not batch-scoped)
  debug_images?: Array<{ failed: string; passed: string }>; // base64 grid images with check overlays, split by status (dev only)
}

interface IReportCreateError extends IReply {
  success: false;
  message: string;
}

type IReportCreateReply = IReportCreateSuccess | IReportCreateError;

/* ────────────────────────────────────────────────────────────────
   Route plugin
   ──────────────────────────────────────────────────────────────── */

const reportCreatePlugin: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: IReportCreateBody;
    Reply: IReportCreateReply;
  }>(
    '/create',
    {
      /* Validate content-type before we hit the handler */
      preValidation: async (request, reply) => {
        if (request.headers['content-type'] !== 'application/json') {
          reply.code(415);
          throw new Error('Must be application/json');
        }
      },
    },
    async (request, reply) => {
      const requestStartMs = Date.now();
      const batchLabel = (request.body as IReportCreateBody | undefined)?.pages;
      const run = async () => {
      try {
        /* 1️⃣  Extract and sanity-check body */
        const {
          envelope_revision_id,
          document_files_revisions,
          checklist,
          envelope_checklist,
          previous_report_checks = [],
          ai_mode = EAIImageAnalysisMode.AUTO,
          report_id,
          model_config,
          reserved_check_indices = [],
          debug: rawDebug,
          pages: pagesStr,
          inspection_date_display,
          page_font_scales,
          skip_thumbnail_file_ids = [],
          previous_page_texts,
          max_affordable_pages,
          session_id,
          pageNumberOffset,
          batch_context,
          current_job_checks,
          current_job_previous_page_texts,
          skip_rendered_files_response = false,
          ref_files = [],
          text_extraction_model_config,
          review_note,
        }: IReportCreateBody = request.body;

        const ruleCount = (checklist?.rules?.length || 0) + (envelope_checklist?.rules?.length || 0);
        app.log.info({ envelope_revision_id, fileCount: document_files_revisions.length, ruleCount, model: model_config?.id, provider: model_config?.provider }, 'report/create: request received');


        // Reject debug options in production (defense-in-depth)
        const isProduction = process.env.NODE_ENV === 'production';
        if (isProduction && rawDebug) {
          reply.code(400).send({
            success: false,
            message: 'Debug options are not allowed in production',
            pages_processed: 0
          });
          return;
        }
        const debug = rawDebug;

        // Calculate total page count across all files. Rails always sends raw file data now
        // (cached pages arrive via `cached_pages_by_index`, not `fr.pages`). We detect the mime
        // type here so images count as 1 page without calling getPdfPageCount on non-PDF bytes.
        let pageCount = 0;
        for (const fr of document_files_revisions) {
          if (!fr.data || fr.data.length < 100) continue;
          try {
            const mime = await getInputMimeTypeFromBase64Data(fr.data);
            let filePageCount = 0;
            if (isMimeTypeImage(mime)) {
              filePageCount = 1;
            } else if (isMimeTypePdf(mime)) {
              const pdfBytes = new Uint8Array(Buffer.from(fr.data, 'base64'));
              filePageCount = await getPdfPageCount(pdfBytes);
            } else {
              app.log.warn({ fileId: fr.id, mime }, 'report/create: unknown mime type, counting as 0 pages');
            }
            pageCount += filePageCount;
            (fr as any)._totalFilePageCount = filePageCount;
            app.log.info({ fileId: fr.id, mime, filePageCount }, 'report/create: counted pages from raw file');
          } catch (e: any) {
            app.log.warn({ fileId: fr.id, error: e.message }, 'report/create: failed to count pages for file');
          }
        }

        // Budget enforcement: Rails computes `max_affordable_pages` server-side and already
        // narrows the batch via the `pages` string before calling us, so we only log here
        // if the request would exceed budget — we do NOT mutate fr.pages to enforce.
        if (max_affordable_pages != null && max_affordable_pages >= 0 && pageCount > max_affordable_pages) {
          app.log.info({ pageCount, max_affordable_pages }, 'report/create: request exceeds affordable page budget (Rails should have narrowed the `pages` string)');
        }

        // Parse the `pages` string (e.g. "1-2", "5,7-10") into 1-indexed absolute page numbers.
        // This is the authoritative batch selection: only these pages will be rendered and inspected.
        // Rails sends this via batch-loop call_batch (pages: "1-2" for the first batch of size 2).
        // The filter flows into ai.inspectInput → enrichAndRender → per-page cache lookup +
        // selective rendering. There's no separate fr.pages-based filter step.
        let requestedPages: number[] | null = null;
        try {
          requestedPages = parsePages(pagesStr, pageCount);
        } catch (e: any) {
          reply.code(400).send({
            success: false,
            message: `Invalid pages parameter: ${e.message}`,
            pages_processed: 0
          });
          return;
        }

        if (!envelope_revision_id || envelope_revision_id.trim() === '') {
          reply.code(400).send({
            success: false,
            message: 'Non-empty envelope_revision_id is required!',
            pages_processed: 0
          });
          return;
        }

        if (!model_config || !model_config.id || !model_config.provider) {
          reply.code(400).send({
            success: false,
            message: 'model_config is required (must include id, provider, base_url, api_key_env_var, temperature, options)',
            pages_processed: 0
          });
          return;
        }

        // Scan incoming rule prompts and metadata for injection patterns (log only)
        const allRulePrompts: Record<string, string | undefined> = {};
        for (const rules of [checklist?.rules, envelope_checklist?.rules]) {
          if (rules) {
            for (const r of rules) {
              allRulePrompts[`rule_${r.id}`] = r.prompt;
            }
          }
        }
        if (checklist?.system_prompt) allRulePrompts['checklist_system_prompt'] = checklist.system_prompt;
        if (previous_report_checks) {
          for (const c of previous_report_checks.slice(0, 20)) {
            allRulePrompts[`prev_check_${c.id}`] = c.description;
          }
        }
        scanAndLogInjectionAttempts(allRulePrompts, 'report/create');

        // Validate that at least one checklist has rules, OR track_changes is enabled with previous page texts
        // (the catch-changes change detection rule will be synthesized by createVirtualChecklistForAI)
        const hasChecklistRules = checklist && checklist.rules && checklist.rules.length > 0;
        const hasEnvelopeRules = envelope_checklist && envelope_checklist.rules && envelope_checklist.rules.length > 0;
        const hasCatchAllChangeDetection = checklist?.track_changes === true
          && previous_page_texts && previous_page_texts.length > 0;

        if (!hasChecklistRules && !hasEnvelopeRules && !hasCatchAllChangeDetection) {
          reply.code(400).send({
            success: false,
            message: 'At least one checklist with rules is required for inspection',
            pages_processed: 0
          });
          return;
        }

        /* 2️⃣  Prepare an empty report */
        let result: IReport | null = null;

        /* 3️⃣  run AI inspection */
        const aiStartMs = Date.now();
        app.log.info({ model: model_config?.id, ai_mode }, 'report/create: starting AI inspection');
        try {
          result = await withAIRetry(
            () => ai.inspectInput(
              {
                report_id: report_id,
                envelope_revision_id: envelope_revision_id,
                document_files_revisions: document_files_revisions,
                checklist: checklist,
                envelope_checklist: envelope_checklist,
                previous_report_checks: previous_report_checks,
                ai_mode: ai_mode,
                model_config: model_config,
                reserved_check_indices: reserved_check_indices,
                debug: debug,
                inspection_date_display: inspection_date_display,
                page_font_scales: page_font_scales,
                previous_page_texts: previous_page_texts,
                max_affordable_pages: max_affordable_pages,
                session_id: session_id,
                pageNumberOffset: pageNumberOffset || 0,
                batch_context: batch_context,
                current_job_checks: current_job_checks,
                current_job_previous_page_texts: current_job_previous_page_texts,
                requestedPages: requestedPages,
                ref_files: ref_files,
                text_extraction_model_config: text_extraction_model_config,
                review_note: review_note,
              }
            ) as Promise<IReport>,
            'report/create'
          );
        } catch (aiError: any) {
          const errMsg = friendlyAIErrorMessage(aiError);

          // Log the full stack trace for non-AI-provider errors. Messages
          // like "Cannot read properties of undefined (reading 'width')"
          // are our own bugs — without a stack we can't pinpoint them.
          const isLikelyOurBug = typeof aiError?.message === 'string' &&
            /Cannot read propert|Cannot set propert|is not a function|is not iterable/.test(aiError.message);
          if (isLikelyOurBug) {
            app.log.error({ err: aiError, stack: aiError?.stack, envelope_revision_id, report_id }, 'report/create: internal error during AI inspection');
          }

          /* Map common AI errors to HTTP responses.
             Auth (401/403) MUST come first — OpenAI tags invalid-key errors
             with `error.type === 'invalid_request_error'` AND status 401, so
             without this branch the generic invalid_request_error handler
             below would swallow it as 400 and Rails' sanitiser would then
             collapse the message to a generic "AI processing failed". */
          if (isAuthAIError(aiError)) {
            reply.code(401).send({
              success: false,
              message: errMsg,
              pages_processed: 0
            });
            return;
          }
          if (aiError?.error?.type === 'invalid_request_error') {
            reply.code(400).send({
              success: false,
              message: `AI Model Error: ${errMsg}`,
              pages_processed: 0
            });
            return;
          }
          if (errMsg.includes('Model not found')) {
            reply.code(400).send({
              success: false,
              message: errMsg,
              pages_processed: 0
            });
            return;
          }
          if (errMsg.includes('does not support vision')) {
            reply.code(400).send({
              success: false,
              message: errMsg,
              pages_processed: 0
            });
            return;
          }

          /* Transient upstream failure — return 503 so Rails can distinguish */
          if (isTransientAIError(aiError)) {
            reply.code(503).send({
              success: false,
              message: `AI processing failed: ${errMsg}`,
              pages_processed: 0
            });
            return;
          }

          /* Fallback for any other AI failure */
          reply.code(500).send({
            success: false,
            message: `AI processing failed: ${errMsg}`,
            pages_processed: 0
          });
          return;
        }

        const checkCount = result?.checks?.length || 0;
        const passedCount = result?.checks?.filter(c => c.passed).length || 0;
        const emptyDescCount = result?.checks?.filter(c => !c.description?.trim()).length || 0;
        const contradictionsCorrected = (result as any)?._contradictionsCorrected || 0;
        logStep('report/create: AI inspection complete', aiStartMs, { checkCount, passedCount, failedCount: checkCount - passedCount, emptyDescCount, contradictionsCorrected });

        /* 4️⃣  Extract rendered page data for Rails caching.
           After ai.inspectInput(), document_files_revisions is enriched in-place. The
           subset of pages that were FRESHLY rendered this request is stashed at
           (fr as any)._freshlyRenderedPagesByIndex by document-utils.ts, keyed by
           file-relative 0-based index. Cached pages are NOT included in the response —
           Rails already has them.

           Thumbnails are always sourced from absolute page 0 of each file. If page 0 was
           freshly rendered this batch we generate the thumbnail from it; if page 0 came
           from the cache and Rails already has a cached thumbnail (signaled via
           skip_thumbnail_file_ids) we skip; otherwise (page 0 from cache, no Rails
           thumbnail yet) we synthesize a "thumbnail-only" entry for index "0" so Rails
           can cache the thumbnail without re-receiving the full page image. */
        const skipThumbSet = new Set(skip_thumbnail_file_ids);
        const rendered_files: IRenderedFile[] = [];

        if (!skip_rendered_files_response) {
          for (const fr of document_files_revisions) {
            const fresh = (fr as any)._freshlyRenderedPagesByIndex as Record<number, IPageInfoExtended> | undefined;
            const cachedHash = (fr as any).cached_pages_by_index as Record<string, IPageInfoExtended> | undefined;
            const pages_by_index: Record<string, IRenderedFilePage> = {};

            // a) Freshly rendered pages this batch — include them so Rails caches them.
            if (fresh && Object.keys(fresh).length > 0) {
              for (const idxStr of Object.keys(fresh)) {
                const page = fresh[Number(idxStr)] as IPageInfoExtended;
                if (!page || !page.pageAsImage) continue;
                pages_by_index[idxStr] = await buildRenderedFilePage(page);
              }
            }

            // b) Thumbnail handling — always sourced from absolute page 0 of the file.
            const wantsThumbnail = !skipThumbSet.has(fr.id);
            if (wantsThumbnail) {
              const page0Fresh = fresh?.[0];
              const page0Cached = cachedHash?.["0"];
              const page0 = page0Fresh || page0Cached;
              if (page0 && page0.pageAsImage) {
                let thumb = await generateThumbnail(page0.pageAsImage, THUMBNAIL_MAX_WIDTH, app.log, page0.content_bounding_box, page0.scaling_factor);
                if (!thumb) {
                  app.log.warn({ fileId: fr.id }, 'report/create: thumbnail generation failed, retrying in 200ms');
                  await new Promise(r => setTimeout(r, 200));
                  thumb = await generateThumbnail(page0.pageAsImage, THUMBNAIL_MAX_WIDTH, app.log, page0.content_bounding_box, page0.scaling_factor);
                }
                if (thumb) {
                  if (pages_by_index["0"]) {
                    // page 0 already in pages_by_index (freshly rendered) — attach thumbnail to it
                    pages_by_index["0"].pageAsThumbnail = thumb.data;
                    pages_by_index["0"].thumbnailWidth = thumb.width;
                    pages_by_index["0"].thumbnailHeight = thumb.height;
                  } else {
                    // page 0 came from cache — synthesize a thumbnail-only entry so Rails can
                    // cache the thumbnail without re-receiving the full page image.
                    pages_by_index["0"] = {
                      pageAsImage: '',
                      pageAsThumbnail: thumb.data,
                      thumbnailWidth: thumb.width,
                      thumbnailHeight: thumb.height,
                      width: 0,
                      height: 0,
                      original_width: page0.original_width || 0,
                      original_height: page0.original_height || 0,
                      scaling_factor: page0.scaling_factor || 1,
                      crop_offset_x: 0,
                      crop_offset_y: 0,
                    };
                  }
                }
              }
            }

            if (Object.keys(pages_by_index).length > 0) {
              rendered_files.push({ id: fr.id, pages_by_index });
            }
          }
        }

        /* 5️⃣  Read per-page coordinate metadata from the report (computed in ai.ts on enriched pages) */
        const page_coordinate_spaces = (result as any).page_coordinate_spaces as Record<string, { width: number; height: number }>;
        console.debug("create.ts: page_coordinate_spaces from result:", JSON.stringify(page_coordinate_spaces));

        // Build content_bounding_boxes: default to full coordinate space when no cropping detected.
        // Keys mirror page_coordinate_spaces (already absolute-keyed by ai.ts now), so this loop
        // produces absolute-indexed entries automatically.
        const content_bounding_boxes: Record<string, { x1: number; y1: number; x2: number; y2: number }> = {};
        for (const [idx, cs] of Object.entries(page_coordinate_spaces || {})) {
          // Blank/skipped pages (e.g. compressEmptyImagesInPages) may have no
          // dimensions — skip them rather than crashing the whole batch on
          // `Cannot read properties of undefined (reading 'width')`.
          if (!cs || typeof cs.width !== 'number' || typeof cs.height !== 'number') {
            app.log.warn({ idx, cs }, 'report/create: skipping page_coordinate_spaces entry with missing dimensions');
            continue;
          }
          content_bounding_boxes[idx] = { x1: 0, y1: 0, x2: cs.width, y2: cs.height };
        }
        // Override with actual detected content bounding boxes from enriched pages.
        // globalPageIdx must start at pageNumberOffset so the keys here are absolute document
        // indices (matching page_coordinate_spaces). Without this, every batch overwrites the
        // previous batch's keys 0,1 and the final report only has bboxes for the last batch.
        let globalPageIdx = pageNumberOffset || 0;
        for (const fr of document_files_revisions) {
          for (const p of (fr.pages || [])) {
            const page = p as IPageInfoExtended;
            if (page.content_bounding_box) {
              content_bounding_boxes[String(globalPageIdx)] = page.content_bounding_box;
            }
            globalPageIdx++;
          }
        }

        /* 6️⃣  All good — send the report */
        const page_types = (result as any).page_types as Record<string, string> | undefined;
        const page_statuses = (result as any).page_statuses as Record<string, number> | undefined;

        // pages_processed = real post-render, post-budget-trim, post-requestedPages-filter count
        // total_page_count = real total across all files (from getPdfPageCount for raw PDFs, or pages.length for cached)
        const pagesProcessedActual = document_files_revisions.reduce((n, f) => n + (f.pages?.length || 0), 0);

        // Per-file total page counts (document-wide, not batch-scoped) so Rails
        // can split doc-relative layout/text data back into per-DocumentFileRevision
        // buckets. Cached requests may not hit the getPdfPageCount path above —
        // fall back to the enriched fr.pages array length in that case.
        const file_page_counts: Record<string, number> = {};
        for (const fr of document_files_revisions) {
          const countFromPdf = (fr as any)._totalFilePageCount;
          if (typeof countFromPdf === 'number' && countFromPdf > 0) {
            file_page_counts[fr.id] = countFromPdf;
          } else if (Array.isArray((fr as any).pages)) {
            file_page_counts[fr.id] = (fr as any).pages.length;
          }
        }

        const response: IReportCreateSuccess = {
          success: true,
          report: result,
          rendered_files,
          content_bounding_boxes,
          page_coordinate_spaces,
          page_types,
          pages_processed: pagesProcessedActual,
          ...(page_statuses ? { page_statuses } : {}),
          total_page_count: pageCount,
          file_page_counts,
        };

        // Attach debug images if they were generated
        if (result.debug_info) {
          try {
            const debugInfo = JSON.parse(result.debug_info);
            if (debugInfo.debug_overlay_images) {
              response.debug_images = debugInfo.debug_overlay_images;
            }
          } catch { /* ignore parse errors */ }
        }


        logStep('report/create: sending response', requestStartMs, { checkCount, renderedFiles: rendered_files.length });
        reply.code(200).send(response);
      } catch (err: any) {
        /* 7️⃣  Unhandled exception */
        app.log.error({ err: err?.message, stack: err?.stack }, 'report/create: unhandled error');
        reply.code(500).send({
          success: false,
          message: 'Server error during input analysis',
          pages_processed: 0
        });
      }
      }; // end of run()
      let wrapped: () => Promise<void> = run;
      return wrapped();
    },
  );
};

export default reportCreatePlugin;
