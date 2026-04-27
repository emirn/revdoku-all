import { IPageInfo, IDocumentFile, IEnvelopeRevision, getPageFromEnvelopeRevision } from "@revdoku/lib";

/**
 * Model configuration sent per-request from Rails (single source of truth).
 * revdoku-doc-api is stateless — it does NOT maintain its own model registry.
 * api_key_env_var is the NAME of the env var, NOT the actual key value.
 */
export interface IModelConfig {
  id: string;              // e.g. "openai:gpt-4o-mini" (format: {provider}:{model-name})
  provider: string;        // e.g. "openai", "local" — derived from the catalog by Rails
  base_url: string;        // API endpoint URL
  api_key_env_var: string; // NAME of env var holding API key (e.g. "OPENAI_API_KEY")
  temperature: number;     // Temperature setting (0.0 for some models)
  options?: Record<string, any>;  // Provider-specific API params (e.g. max_tokens, max_completion_tokens)
  response_format?: string;          // "json_schema" (default) or "json_object"
  headers?: Record<string, string>;  // Custom HTTP headers (e.g. OpenRouter attribution)
  // Deep-merged into the outgoing request body by applyPredefinedParams.
  // Sourced from `request_params:` in ai_models.yml (provider-level merged
  // with model-level Rails-side). Used for things that belong at request
  // body roots other than `options` — e.g. OpenRouter `provider.data_collection`,
  // `provider.zdr`, vendor-specific routing preferences. doc-api treats this
  // as opaque: deep-merge in, no provider-string branches.
  request_params?: Record<string, unknown>;
  hipaa?: boolean;                    // HIPAA-compliant model
  zdr?: boolean;                      // Zero Data Retention — enforce ZDR with the provider
  grid_mode?: string;                  // default: uses code default (OVERLAY). Overridden by debug grid_mode.
  ai_coord_scale?: number;             // default 0 (pixel coords). If >0, AI returns 0..scale, we convert to pixel.
}

export const SIMPLIFIED_VALUE_PREFIX_FOR_RULES = "rule";
export const SIMPLIFIED_FIELD_NAME_FOR_RULES = "ruleId"
export const ORIGINAL_FIELD_NAME_FOR_EXTERNAL_ID = "id";

export enum EAIImageAnalysisMode {
  AUTO = 'auto', // Only pass grid images to AI
  ENHANCED_1 = 'enhanced-1', // Pass both original and grid images to AI
}

export enum EGridMode {
  NONE = 'none', // No grid — model uses native spatial understanding
  AXIS = 'axis', // Axis labels only (X→, Y↓) — lightweight orientation hint, no grid/rulers
  OVERLAY_GRID_10 = 'overlay_grid_10', // Grid overlay with 10% step (labels + lines every 10%)
  OVERLAY_GRID_5 = 'overlay_grid_5', // Grid overlay with 5% step (labels every 10%, lines every 5%)
  OVERLAY_GRID_2_5 = 'overlay_grid_2_5', // Grid overlay with 2.5% step (labels every 10%, lines every 2.5%)
  RULERS_EXTERNAL = 'rulers-external', // External rulers only, no overlay
  RULERS_EXTERNAL_WITH_SUBTLE_GRID = 'rulers-external-with-subtle-grid', // External rulers + very faint grid
  OVERLAY_WITH_RULERS = 'overlay-with-rulers', // External rulers + visible green grid (no label overlap)
}

export enum EPageContentType {
  TEXT = 'text',         // Predominantly text content (paragraphs, headings, lists)
  IMAGE = 'image',       // Predominantly images, photos, or graphics
  MIXED = 'mixed',       // Significant combination of text and images
  TABLE = 'table',       // Predominantly tabular/structured grid data
  CHART = 'chart',       // Charts, graphs, diagrams, flowcharts
  FORM = 'form',         // Forms with input fields, checkboxes, signatures
  BLANK = 'blank',       // Empty or near-empty page (only set for pages compressed by compressEmptyImagesInPages)
  UNKNOWN = 'unknown',   // Classification not available or failed
}

// define interface for a map of old value to new value
// for example:
export interface IValueReplacementsResult {
    outputArray: any[];
    replacementsMap: Record<string, string>;
}

export interface IRuleSimplified {
    id: string;
    prompt: string;
  }

  /**
   * One reference-file entry on the top-level `ref_files` array of the
   * /report/create request. Rails has already rewritten every `#file` /
   * `file:<id>` marker in the rule prompts and in `checklist.system_prompt`
   * into the canonical `file:<document_file_revision_prefix_id>` token form.
   * The revdoku-doc-api substitutes each token with:
   *
   *   - For text mimes (text/csv, text/plain): the `content` field, inlined
   *     as `[REFERENCE mime=<mime>]\n<content>\n[END OF REFERENCE]`.
   *
   *   - For image mimes (image/*, application/pdf): each entry in
   *     `base64_pages` is attached to the multi-modal AI message as an
   *     image content part, with a text anchor line so the AI correlates
   *     them back to the token that appears in the prompt. The token
   *     itself is replaced with a short anchor like
   *     `[see attached image labeled "<dfrev_prefix_id>-p1"]`.
   *
   * Rails builds this array from the envelope_revision's ReferenceFile
   * pins; revdoku-doc-api never hits the database.
   */
  export interface IReferenceFile {
    /** DocumentFileRevision prefix_id — the canonical token body. */
    document_file_revision_id: string;
    /** Which rule the marker came from, or null for checklist-scoped. */
    rule_id: string | null;
    mime_type: string;
    description?: string | null;
    /** 1-indexed label used in the AI prompt: #file_1, #file_2, etc.
     *  Assigned by Rails in build_revdoku-doc-api_ref_files based on scan order. */
    file_index?: number;
    /** Present for text mimes. UTF-8, already sanitized upstream. */
    content?: string;
    /** Present for image / pdf mimes. One entry per page, base64. */
    base64_pages?: string[];
  }
  
  export interface IChecklistSimplified {
    name: string;
    system_prompt?: string;
    rules: IRuleSimplified[];
  }


export interface IBody { title: string; body: string }
export interface IReply {
  success: boolean;
  elapsed_time?: number;
  pages_processed?: number;
}

// interface for raw checks received from AI-based inspection
// this is used to read response from AI which contains mulitple checks per rule
// and convert them to ICheck format with location per check 
export interface ICheckRawFromAI {
    ruleId: string;
    // one or more locations related to this check
    checks: [
        {
            passed: boolean;
            description: string;
            page: number;
            x1: number;
            y1: number;
            x2: number;
            y2: number;
            type?: string;   // comma-separated change types (e.g. "ch_number", "ch_date,ch_name")
            val_p?: string;  // previous value before change
            val?: string;    // current/extracted value
            ref?: string;    // corresponding value from reference file (shown as "ref:" in labels)
            ref_page?: number; // 0-indexed page number within the reference file where `ref` was found
        }
    ];
}

export interface IEnvelopeRevisionToImageRenderingOptions {
    maxSideSize: number;
    minSideSize: number;
}

/**
 * Debug options for revdoku-doc-api inspection API (dev mode only).
 * These params are accepted by /report/create when NODE_ENV !== 'production'.
 */
export interface IDebugOptions {
  /** Override the grid mode used for AI grounding images */
  grid_mode?: EGridMode;
  /** Return debug images with AI check coordinates overlaid on the grid image */
  overlay_checks_on_grid?: boolean;
  /** Skip AI processing but still generate debug images (dev mode only) */
  skip_ai?: boolean;
  /** Dump all AI images (original + grid) to disk for inspection (dev mode only) */
  dump_images?: boolean;
}

/**
 * Rectangular region on a page containing actual content (non-background).
 * Coordinates are in ORIGINAL image space (before scaling).
 * Used for detecting empty whitespace areas where labels can be placed.
 */
export interface IContentBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface IPageInfoExtended extends IPageInfo {
  pageAsImageWithGrid: string;
  pageAsImage: string;
  gridMode?: EGridMode; // Track which grid mode was used
  content_boxes?: IContentBox[];  // Detected content regions for smart label placement
  content_bounding_box?: IContentBox;  // Raw content bbox in document space (for margin cropping)
  crop_offset_x?: number;  // left-edge crop offset in original page coordinates (0 if no crop)
  crop_offset_y?: number;  // top-edge crop offset in original page coordinates (0 if no crop)
  page_type?: EPageContentType;  // Classified content type of the page (heuristic-based)
}  
  export function getPageAsImageFromDocument(
    document_files: IDocumentFile[],
    doc: IEnvelopeRevision,
    pageIndex: number
  ): string | undefined {
    return (getPageFromEnvelopeRevision(document_files, doc, pageIndex) as IPageInfoExtended)?.pageAsImage;
  }
  
  export function getPageAsImageWithGridFromDocument(
    document_files: IDocumentFile[],
    doc: IEnvelopeRevision,
    pageIndex: number
  ): string | undefined {
    return (getPageFromEnvelopeRevision(document_files, doc, pageIndex) as IPageInfoExtended)?.pageAsImageWithGrid;
  }
  