/**
 * JSON schemas for AI response formats used in OpenAI-compatible API calls.
 * Extracted from ai.ts to keep schemas maintainable and separate from logic.
 *
 * Description format spec: see lib/prompts/catch-changes-README.md
 */

/** Schema for checklist generation (extractChecklistInformation) */
export const checklistInfoSchema = {
  name: "checklist_info",
  strict: true,
  schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      system_prompt: { type: "string" },
      highlight_mode: {
        type: "string",
        enum: ["rectangle", "dot", "underline", "bracket"],
        description: "Best highlight style for the document type: rectangle (default, most documents, forms, tables, invoices), dot (photos, images, visual content with objects to mark), bracket (sparse text documents, contracts, letters), underline (text-heavy manuscripts, books, articles)",
      },
      rules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            prompt: { type: "string" },
          },
          additionalProperties: false,
          required: ["prompt"],
        },
      },
    },
    additionalProperties: false,
    required: ["name", "system_prompt", "highlight_mode", "rules"],
  },
} as const;

/** Schema for a regular checklist rule check item — no change-detection fields */
const regularCheckItemSchema = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    description: {
      type: "string",
      minLength: 1,
      maxLength: 300,
      description: "Explain why the rule passed or failed, citing evidence from the document",
    },
    val: {
      type: ["string", "null"],
      description: "Optional (null when not applicable): extracted value (count, amount, measurement) when the rule asks for value extraction",
    },
    ref: {
      type: ["string", "null"],
      description: "MUST be a non-empty string whenever the description cites a #file_N token; otherwise null. VERBATIM substring copied from the reference file text (exactly as it appears — include units/currency/percent signs). Priority: (1) specific matched value ('8%', '280 sq ft'); (2) section header consulted ('Approved Timekeepers and Rate Card'); (3) first ~40 chars of the relevant paragraph. Do NOT put a computed/derived/paraphrased value here. CORRECT: ref='8%' when ref file says '8% of total invoice fees'. CORRECT (set check): ref='Approved Timekeepers and Rate Card'. WRONG: ref='$1,031.00' (computed). WRONG: ref=null when description contains '(#file_1)'.",
    },
    ref_page: {
      type: ["number", "null"],
      description: "MUST be set (not null) whenever `ref` is non-null — 0-indexed page number within the reference file where `ref` appears. Echo the `P` from the [REFERENCE page=P] marker verbatim. Null when `ref` is null.",
    },
    page: { type: "number" },
    x1: { type: "number" },
    y1: { type: "number" },
    x2: { type: "number" },
    y2: { type: "number" },
  },
  // Move val/ref/ref_page into required: OpenAI strict-mode schemas need
  // every declared field in `required`; we get "optional" semantics via
  // the nullable union types above. Models tend to silently skip truly
  // optional fields, which is why earlier runs produced empty ref values.
  required: ["page", "passed", "description", "x1", "y1", "x2", "y2", "val", "ref", "ref_page"],
  additionalProperties: false,
} as const;

/** Schema for a catch-changes change detection check item — includes type, val_p, val */
const catchAllCheckItemSchema = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    description: {
      type: "string",
      minLength: 1,
      maxLength: 300,
      description:
        // see change-detection-README.md for more information
        'Format: <Where> changed "<prev>" to "<curr>"|<Where> added "<val>"|<Where> removed "<val>"',
    },
    page: { type: "number" },
    x1: { type: "number" },
    y1: { type: "number" },
    x2: { type: "number" },
    y2: { type: "number" },
    type: {
      type: ["string", "null"],
      description:
        "Comma-separated change types (or null): ch_text, ch_number, ch_date, ch_name, ch_contact, ch_url, ch_id, ch_currency, ch_duration, ch_legal, ch_status, ch_ref, ch_redact, ch_typo, ch_format, ch_size, ch_color, ch_image, ch_added, ch_removed",
    },
    val_p: { type: ["string", "null"], description: "Cite previous value before change, or null." },
    val: { type: ["string", "null"], description: "Cite current value after change, or extracted value (count, amount, measurement), or null." },
    ref: { type: ["string", "null"], description: "VERBATIM substring copied from the reference file text (incl. units, currency, %). MUST be non-null whenever description cites a #file_N token; null otherwise. See regular check schema for examples." },
    ref_page: { type: ["number", "null"], description: "0-indexed page number within the reference file where `ref` was found — echo the [REFERENCE page=N] marker. MUST be non-null whenever `ref` is non-null; null otherwise." },
  },
  // Same strict-mode pattern as regularCheckItemSchema: all declared fields
  // are required, optionality is expressed via nullable union types.
  required: ["page", "passed", "description", "x1", "y1", "x2", "y2", "type", "val_p", "val", "ref", "ref_page"],
  additionalProperties: false,
} as const;

/** Schema for page text extraction (used when track_changes is enabled) */
export const pageTextSchema = {
  type: "object",
  properties: {
    page: { type: "number" },
    text: { type: "string" },
  },
  required: ["page", "text"],
  additionalProperties: false,
} as const;

/**
 * Build the schema for the dedicated page text extraction AI call.
 * Returns only page_texts — no inspection results.
 */
export function buildPageTextExtractionSchema() {
  return {
    name: "page_text_extraction",
    strict: true,
    schema: {
      type: "object",
      properties: {
        page_texts: {
          type: "array",
          items: pageTextSchema,
        },
      },
      required: ["page_texts"],
      additionalProperties: false,
    },
  };
}

/**
 * Build the inspection results schema properties and required fields.
 * When trackChanges is true, uses the catch-changes schema (superset) so the AI can
 * populate type/val_p/val for change detection checks. Regular checks won't
 * fill those fields because only the catch-changes rule prompt instructs the AI to.
 * When false, uses the regular schema without change-detection fields.
 */
export function buildInspectionResultsSchema(trackChanges?: boolean) {
  const checkSchema = trackChanges ? catchAllCheckItemSchema : regularCheckItemSchema;
  return {
    name: "check_results",
    strict: true,
    schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ruleId: { type: "string" },
              checks: {
                type: "array",
                items: checkSchema,
              },
            },
            required: ["ruleId", "checks"],
            additionalProperties: false,
          },
        },
      },
      required: ["results"],
      additionalProperties: false,
    },
  };
}
