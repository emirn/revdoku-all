import { env } from "process";
import OpenAI from "openai";
import {
  IRule,
  IReport,
  IPageInfo,
  IChecklist,
  IEnvelopeRevision,
  ICheck,
  getPageCountFromDocument,
  IEnvelope,
  IDocumentFileRevision,
  ICheckForReindex,
  createNewReport,
  createNewBaseObject,
  createNewChecklist,
  createNewCheck,
  createNewRule,
  HighlightMode
} from "@revdoku/lib";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { checklistInfoSchema, buildInspectionResultsSchema, buildPageTextExtractionSchema } from "../config/ai-response-schemas";
import {
  getWidth,
  getHeight,
  REVDOKU_HIGHLIGHT_BADGE_WIDTH,
  REVDOKU_HIGHLIGHT_BADGE_HEIGHT,
  REVDOKU_HIGHLIGHT_BADGE_MARGIN,
  cropCheckToContentBoxes,
  ICheckDescriptionPosition,
  REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING,
  REVDOKU_MARGIN_LABEL_VERTICAL_GAP,
  REVDOKU_MARGIN_LABEL_FONT_SIZE,
  REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
  REVDOKU_MARGIN_LABEL_INNER_PADDING,
  REVDOKU_LAYOUT_LABEL_MAX_LINES,
  estimateWrappedLabelDimensions,
  REVDOKU_MIN_HINT_LABEL_WIDTH,
} from "@revdoku/lib";
import { compareByVisualPosition, stripCodeFence } from "@revdoku/lib";
import type { IContentBox } from "@revdoku/lib";
import {
  ICheckRawFromAI,
  IValueReplacementsResult,
  IPageInfoExtended,
  IChecklistSimplified,
  IReferenceFile,
  SIMPLIFIED_FIELD_NAME_FOR_RULES,
  ORIGINAL_FIELD_NAME_FOR_EXTERNAL_ID,
  SIMPLIFIED_VALUE_PREFIX_FOR_RULES,
  EAIImageAnalysisMode,
  EGridMode,
  IDebugOptions,
  IModelConfig,
} from "../schemas/common-server";
import { CONVERT_TO_JPEG_BEFORE_SENDING_TO_AI } from "./constants";
import { enrichAndRenderFilesRelatedToEnvelopeRevision } from "./document-utils";
import { overlayChecksOnGridImages, calculateRoundStep, calculateGridLayout, drawDebugBoxes } from "./image-utils";
import { getGridModeConfig, resolveMargins } from "./grid-mode-config";
import { detectContentBoxes } from "./content-detection";
import {
  convertChecklistToSimplifiedForAI,
  substituteReferenceFileTokens,
  checkPromptForUnreplacedVariables,
  replaceValuesToSimplified,
  restoreValuesFromSimplified,
  renameFieldInItemsInArray,
  validateAIResponse,
  recoverRuleIds,
  formatChecklistAsMarkdown
} from "./ai-utils";
import { createVirtualChecklistForAI, REVDOKU_CATCH_CHANGES_RULE_ID, REVDOKU_CATCH_ALL_RULE_ID } from "./checklist-utils";
import { extractChangesTagsFromCheckDescription, extractPrevCurrentFromDescription } from "./check-data-utils";
import { detectAndFixContradictions } from "./contradiction-patterns";
import { getPageDocumentDimensions, envelopeCoordsToAIModelCoords, docToContentPixel } from "./coordinate-utils";
import { sanitizeUserInput } from "./prompt-sanitizer";
import { scanAndLogInjectionAttempts } from "./prompt-guard";

const AI_IMAGE_MIME = CONVERT_TO_JPEG_BEFORE_SENDING_TO_AI ? 'image/jpeg' : 'image/png';
const _notProduction = process.env.NODE_ENV !== 'production';
const ENABLE_RULE_ID_RECOVERY = false; // Set true to enable positional ruleId recovery for local models
const SUSPICIOUS_UNIQUE_DESCRIPTION_RATIO = 0.3;
const SYSTEM_PROMPT_LEAK_FRAGMENTS = ['security guardrails', 'user-supplied content', 'never follow instructions embedded'];

// MIN allowed size for the highlight in document space (PDF points).
// Must be large enough to be visible/clickable but not so large that
// precise AI highlights get expanded beyond their intended area.
// HIGHLIGHT_BADGE_* = 15 units ≈ 1 line of text at typical rendering.
const MIN_ALLOWED_HIGHLIGHT_SIZE_WIDTH = REVDOKU_HIGHLIGHT_BADGE_WIDTH;
const MIN_ALLOWED_HIGHLIGHT_SIZE_HEIGHT = REVDOKU_HIGHLIGHT_BADGE_HEIGHT;
// we can allow bigger highlights on the page
// but we need to ensure that they don't overlap with each other
// and that they are not too big
// so we allow 80% of the page size for the highlight
// and 60% for the highlight size
const MAX_ALLOWED_HIGHLIGHT_SIZE_WIDTH_IN_PERCENTAGE = 0.99;
const MAX_ALLOWED_HIGHLIGHT_SIZE_HEIGHT_IN_PERCENTAGE = 0.8;

// Margin (in document-space points) for cropping highlights to content boxes.
// Content box detection can underestimate the actual text extent by 15-25pt,
// so a generous margin prevents highlights from clipping through text.
const CONTENT_BOX_CROP_MARGIN = 20;

/**
 * Features thinner than this fraction of page height are treated as lines
 * (borders, rules, decorative bars) and eroded from the content grid
 * during busy-area detection, so annotation labels can cross over them
 * instead of being blocked.
 *
 * Calibrated at 0.75% of page height — roughly half the height of typical
 * body text (~1.5% of page height). This preserves all text while eroding
 * thin graphic elements.
 *
 * Tuning guide:
 * - Increase (e.g. 0.01) to erode thicker decorative elements
 * - Decrease (e.g. 0.005) if small text is being accidentally eroded
 */
const LINE_EROSION_PAGE_HEIGHT_FRACTION = 0.0075;

/**
 * Converts all check coordinates on a checklist's rules from envelope coordinate
 * space (as stored in DB) to the selected AI model's coordinate space.
 *
 * This ensures coordinates embedded in AI prompts match the coordinate system
 * the AI model is expected to output, preventing echo-back coordinate corruption
 * where the AI copies document-space coords from the prompt and they get
 * double-converted by convertCheckLocationsFromAICoordinatesToEnvelopeCoordinates.
 *
 * @param checklist - Merged checklist with rules that may have .checks attached
 * @param sourcePages - Processed page images with final scaling factors
 * @param aiCoordScale - The AI model's coordinate scale (e.g., 1000 for 0-1000 normalized)
 */
function convertCheckCoordinatesFromEnvelopeCoordinatesToAIModelCoordinateSpace(
  checklist: IChecklist,
  sourcePages: IPageInfoExtended[],
  aiCoordScale: number,
  pageNumberOffset: number = 0,
): void {
  if (!checklist.rules) return;
  for (const rule of checklist.rules) {
    if (!rule.checks) continue;
    for (const check of rule.checks) {
      const page = sourcePages[check.page - pageNumberOffset];
      if (!page) continue;
      if (aiCoordScale > 0) {
        const converted = envelopeCoordsToAIModelCoords(check, page, aiCoordScale);
        check.x1 = converted.x1;
        check.y1 = converted.y1;
        check.x2 = converted.x2;
        check.y2 = converted.y2;
      } else {
        // Raw pixel mode (aiCoordScale === 0): convert envelope coords to content pixel coords
        const sf = page.scaling_factor || 1;
        const cropX = page.crop_offset_x || 0;
        const cropY = page.crop_offset_y || 0;
        check.x1 = Math.round(docToContentPixel(check.x1, cropX, sf));
        check.y1 = Math.round(docToContentPixel(check.y1, cropY, sf));
        check.x2 = Math.round(docToContentPixel(check.x2, cropX, sf));
        check.y2 = Math.round(docToContentPixel(check.y2, cropY, sf));
      }
    }
  }
}

/**
 * Build the per-page dimensions JSON string for the {{PAGE_DIMENSIONS}} placeholder.
 */
function buildPageDimensionsString(
  sourcePages: IPageInfoExtended[],
  ai_coord_scale: number = 0,
  pageNumberOffset: number = 0,
): string {
  return sourcePages
    .map((pageInfo, index) => {
      let reportedWidth: number;
      let reportedHeight: number;
      if (ai_coord_scale > 0) {
        reportedWidth = ai_coord_scale;
        reportedHeight = ai_coord_scale;
      } else {
        reportedWidth = pageInfo.width;
        reportedHeight = pageInfo.height;
        const config = getGridModeConfig(pageInfo.gridMode || EGridMode.NONE);
        if (config.aiSeesMargins) {
          const margins = resolveMargins(config, pageInfo.width, pageInfo.height);
          reportedWidth += margins.left + margins.right;
          reportedHeight += margins.top + margins.bottom;
        }
      }
      return JSON.stringify({
        pageNumber: index + 1 + pageNumberOffset,
        pageWidth: reportedWidth,
        pageHeight: reportedHeight,
      });
    })
    .join("\n");
}

const PRIOR_CHECK_DESCRIPTION_MAX_CHARS = 500;
const BATCH_CONTEXT_PROMPT_FILE = "batch-context.md";

const INPUT_INSPECT_SYSTEM_PROMPT_FILE = "input-inspect-system-prompt.md";
// Partial prompt spliced into the baseline system prompt ONLY when the
// inspection has at least one reference file attached. Keeps the baseline
// lean (and cheaper in tokens) for the common no-ref case.
const INPUT_INSPECT_REFERENCE_FILES_PROMPT_FILE = "input-inspect-reference-files.md";
// Partial prompt spliced in ONLY when at least one rule carries the
// `#value` marker (i.e. this is an extraction / enumeration checklist).
// Carries anti-duplication guidance and value-format enforcement so every
// extraction checklist gets these guardrails for free — no need for the
// checklist author to repeat them in each rule prompt.
const INPUT_INSPECT_VALUE_EXTRACTION_PROMPT_FILE = "input-inspect-value-extraction.md";

const INPUT_INSPECT_PROMPT_FILE = "input-inspect-prompt.md";
const INPUT_INSPECT_AUTO_SELECT_PROMPT_FILE =
  "input-inspect-auto-select-prompt.md";
const PAGE_TEXT_EXTRACTION_PROMPT_FILE = "page-text-extraction-prompt.md";
const TEXT_TO_CHECKLIST_PROMPT_FILE = "text-to-checklist-prompt.md";
const TEXT_TO_CHECKLIST_SYSTEM_PROMPT_FILE = "text-to-checklist-system-prompt.md";

/**
 * How many pages we feed into a single `extractPageTexts` AI call.
 * Large reference files (e.g. a 150-page catalog PDF) get chunked into
 * groups of this size and the results are concatenated. Picked to stay
 * well under typical model context + output-token limits for Gemini Lite
 * and friends. Separate from the main inspection batch size
 * (DEFAULT_BATCH_PAGE_SIZE in create_report_job.rb) because this is a
 * simpler one-shot text extraction task.
 */
const TEXT_EXTRACTION_BATCH_PAGES = parseInt(
  env.TEXT_EXTRACTION_BATCH_PAGES || "20", 10
);

const __ai_filename = fileURLToPath(import.meta.url);
const __ai_dirname = path.dirname(__ai_filename);
const PROMPTS_DIR = path.join(__ai_dirname, "prompts");

function getTodayDate(): Date {
  const today: Date = env.FIXED_DATE_TODAY && env.FIXED_DATE_TODAY.length > 0 ? new Date(env.FIXED_DATE_TODAY) : new Date();
  // Reset time to midnight
  today.setHours(0, 0, 0, 0);
  console.debug("getTodayDate:", today.toISOString());
  return today;
}

/**
 * Extract the model name from a structured model ID string.
 * Format: "{provider}:{model-name}" — extract model-name (everything after the colon).
 * Strips any "+subtype" suffixes first.
 * e.g. "openai:gpt-4o-mini" -> "gpt-4o-mini"
 * Legacy 3-segment format also supported: "{geo}:{provider}:{model-name}" -> "model-name"
 */
export function getModelNameForAPI(modelId: string): string {
  const base = modelId.split('+')[0]; // Strip subtypes
  const parts = base.split(':');
  if (parts.length >= 3) return parts.slice(2).join(':');
  if (parts.length === 2) return parts[1];
  return base;
}

/**
 * Create an OpenAI-compatible client from a model config sent by Rails.
 * revdoku-doc-api is stateless — all model configuration comes per-request.
 */
export function createOpenAIClient(modelConfig: IModelConfig): OpenAI {
  // BYOK lookup order: (1) per-request api_key that Rails injected into the
  // model_config from an AccountAiKey row, (2) fall back to the instance
  // ENV var (`api_key_env_var`). Rails only emits `api_key` in the config
  // when it had a non-empty decrypted BYOK value, so the presence check is
  // the sole signal. See apps/web/app/services/ai_model_resolver.rb#resolve.
  const byokKey = (modelConfig as { api_key?: string }).api_key;
  const apiKey = (byokKey && byokKey.trim() !== '')
    ? byokKey
    : process.env[modelConfig.api_key_env_var];

  if (!apiKey || apiKey.trim() === '') {
    // Report the ENV var name (never the key). If Rails passed a BYOK key
    // and it was empty/whitespace we still reach this branch — the shared
    // env fallback is also empty, so the message is accurate.
    // Tag .status = 401 so the route's isAuthAIError branch maps it to
    // HTTP 401 just like a real provider rejection (see ai-utils.ts).
    const err: any = new Error(`Missing required API key: neither account BYOK nor ENV[${modelConfig.api_key_env_var}] is set.`);
    err.status = 401;
    throw err;
  }

  const config: any = {
    apiKey,
    // BYOK may also override the base URL (Azure-OpenAI, custom Bedrock
    // endpoint, local LM Studio). Fall back to the catalog default when
    // Rails didn't inject one.
    baseURL: modelConfig.base_url,
  };

  // Use headers from config — no provider-specific logic
  if (modelConfig.headers && Object.keys(modelConfig.headers).length > 0) {
    config.defaultHeaders = modelConfig.headers;
  }

  return new OpenAI(config);
}

/**
 * Deep-merge a predefined parameters hash (sourced from
 * `model_config.request_params` — itself a Rails-side merge of the
 * provider-level and model-level `request_params:` blocks in ai_models.yml)
 * into the outgoing request body. Replaces the old per-provider
 * `applyZdrParams`: doc-api no longer knows about OpenRouter, OpenAI, or
 * any other provider's body-shape — operators express those differences
 * in YAML and this single helper applies them verbatim.
 *
 * Merge semantics: objects recurse, arrays + scalars from `predefined`
 * replace what's already in `request`. Same shape as Rails' Hash#deep_merge.
 */
export function applyPredefinedParams(
  predefined: Record<string, unknown> | undefined,
  request: Record<string, unknown>
): void {
  if (!predefined) return;
  deepMergeInto(request, predefined);
}

function deepMergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, srcVal] of Object.entries(source)) {
    const tgtVal = target[key];
    if (
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      deepMergeInto(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      target[key] = srcVal;
    }
  }
}

/**
 * Strip markdown code fences from AI response text.
 * Local models (e.g. LM Studio) often wrap JSON in ```json ... ``` blocks.
 */
/**
 * Attempt to repair common JSON issues from LLM responses.
 * Tries JSON.parse first; on failure, applies fixes and retries.
 * Local models (response_format: "none") often produce single-quoted keys,
 * trailing commas, or JS-style comments.
 */
function repairJson(text: string): string {
  // 1. Strip markdown code fences (```json ... ```)
  let cleaned = stripCodeFence(text);

  // 2. Fix broken keys like "y2: 250 → "y2": 250 (missing closing quote).
  //    jsonrepair can't handle this, so we pre-fix it. Only matches at
  //    line-start with indentation — won't corrupt mid-string content.
  cleaned = cleaned.replace(/^(\s*)"(\w+):\s/gm, '$1"$2": ');

  // 3. Fast path: already valid after lightweight cleanup
  try {
    JSON.parse(cleaned);
    if (cleaned !== text) console.warn('repairJson: cleaned AI response (fence/key fix)');
    return cleaned;
  } catch {
    // fall through to jsonrepair
  }

  // 4. Use jsonrepair for everything else: control chars, single quotes,
  //    trailing commas, JS comments, truncated responses, unquoted keys, etc.
  try {
    const { jsonrepair: repair } = require('jsonrepair') as { jsonrepair: (s: string) => string };
    const repaired = repair(cleaned);
    console.warn('repairJson: jsonrepair successfully fixed malformed AI response');
    return repaired;
  } catch (e: any) {
    console.warn(`repairJson: jsonrepair failed (${e.message}), returning best-effort cleaned text`);
    return cleaned;
  }
}

/**
 * One batch of the batched `extractPageTexts` call. Handles a slice of
 * source pages, returns page_texts numbered by ABSOLUTE page index (so
 * the caller can concatenate batches straight into one flat result).
 *
 * Uses the same `PAGE_TEXT_EXTRACTION_PROMPT_FILE` prompt everywhere — no
 * forks between track_changes text extraction and reference-file OCR, so
 * content shape (markdown + color hints etc) is consistent wherever
 * extracted text is consumed.
 */
async function runTextExtractionBatch({
  chunk,
  totalPages,
  pageOffset,
  model_config,
  ai_mode,
}: {
  chunk: IPageInfoExtended[];
  totalPages: number;
  pageOffset: number;
  model_config: IModelConfig;
  ai_mode: EAIImageAnalysisMode;
}): Promise<Array<{ page: number; text: string }>> {
  const pageLabelConfig = chunk[0]?.gridMode
    ? getGridModeConfig(chunk[0].gridMode)
    : null;
  const pageLabelInstruction = pageLabelConfig?.pageLabel?.enabled
    ? `\n- Do NOT include the page identification label (e.g., [P1], [P2]) that appears at the bottom-right of each page image — this is a system marker, not part of the document content`
    : '';
  const prompt = fs
    .readFileSync(path.join(PROMPTS_DIR, PAGE_TEXT_EXTRACTION_PROMPT_FILE), "utf8")
    .replace("{{PAGE_LABEL_INSTRUCTION}}", pageLabelInstruction);

  const imageParts: ChatCompletionContentPart[] = [
    { type: "text", text: prompt },
  ];

  if (ai_mode === EAIImageAnalysisMode.ENHANCED_1) {
    for (let pi = 0; pi < chunk.length; pi++) {
      const absPage = pi + pageOffset + 1;
      imageParts.push(
        { type: "text", text: `--- Original image: Page ${absPage} of ${totalPages} ---` } as ChatCompletionContentPart,
        {
          type: "image_url",
          image_url: {
            url: `data:${AI_IMAGE_MIME};base64,${chunk[pi].pageAsImage}`,
            detail: "high",
          },
        } as ChatCompletionContentPart,
      );
    }
  }

  for (let pi = 0; pi < chunk.length; pi++) {
    const absPage = pi + pageOffset + 1;
    imageParts.push(
      { type: "text", text: `--- Page ${absPage} of ${totalPages} ---` } as ChatCompletionContentPart,
      {
        type: "image_url",
        image_url: {
          url: `data:${AI_IMAGE_MIME};base64,${chunk[pi].pageAsImageWithGrid}`,
          detail: "high",
        },
      } as ChatCompletionContentPart,
    );
  }

  const systemPrompt = "You are a document text extraction assistant. Extract the visible text content from document page images as constrained markdown.";

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: imageParts },
  ];

  const client = createOpenAIClient(model_config);
  const actualModelName = getModelNameForAPI(model_config.id);

  const requestData: any = {
    model: actualModelName,
    messages,
    ...(model_config.options || {}),
  };

  if (model_config.response_format !== 'none') {
    const useJsonSchema = model_config.response_format !== 'json_object';
    requestData.response_format = useJsonSchema
      ? { type: "json_schema" as const, json_schema: buildPageTextExtractionSchema() }
      : { type: "json_object" as const };
  }

  if (model_config.temperature !== null && model_config.temperature > 0.0) {
    requestData.temperature = model_config.temperature;
  }

  applyPredefinedParams(model_config.request_params, requestData as Record<string, unknown>);

  const response = await client.chat.completions.create(requestData);
  const finishReason = response.choices[0]?.finish_reason;
  if (finishReason === 'length') {
    console.warn(`[AI][TextExtraction] WARNING: Response truncated (finish_reason=length). max_tokens may be insufficient for batch size ${chunk.length}.`);
  }

  const messageContent = response.choices[0]?.message?.content;
  if (!messageContent || messageContent.trim() === "") {
    console.warn(`[AI][TextExtraction] Empty response for pages ${pageOffset + 1}-${pageOffset + chunk.length}`);
    return [];
  }

  let parsed: any;
  try {
    parsed = JSON.parse(messageContent);
  } catch (parseError: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[AI][TextExtraction] Failed to parse AI response as JSON: ${parseError.message}`);
      console.error(`[AI][TextExtraction] Raw AI response (${messageContent.length} chars):\n${messageContent}`);
    }
    throw parseError;
  }
  const rawPageTexts: Array<{ page: number; text: string }> = parsed.page_texts || [];

  // Strip system page-label markers if page labels are enabled.
  const stripPageLabels = pageLabelConfig?.pageLabel?.enabled ?? false;
  return rawPageTexts.map((pt) => ({
    ...pt,
    text: stripPageLabels && pt.text
      ? pt.text.replace(new RegExp(`\\[P${pt.page}\\]`, 'g'), '').trim()
      : (pt.text || ''),
  }));
}

export const ai = {
  getChecksFromText: async ({
    source_text,
    system_prompt,
    existing_rules,
    checklist_name,
    model_config
  }: {
    source_text: string;
    system_prompt?: string;
    existing_rules?: IRule[];
    checklist_name?: string;
    model_config: IModelConfig;
  }): Promise<IChecklist> => {
    // model_config is required — provided by Rails
    const client = createOpenAIClient(model_config);
    const actualModelName = getModelNameForAPI(model_config.id);

    // Scan ORIGINALS for injection detection (log only, do not block)
    scanAndLogInjectionAttempts({
      source_text: source_text,
      system_prompt: system_prompt,
      checklist_name: checklist_name,
    }, 'getChecksFromText');

    // THEN sanitize user-supplied inputs before prompt assembly
    const sanitizedSourceText = sanitizeUserInput(source_text.trim());
    const sanitizedSystemPrompt = system_prompt ? sanitizeUserInput(system_prompt) : undefined;
    const sanitizedChecklistName = checklist_name ? sanitizeUserInput(checklist_name) : undefined;

    let prompt = fs
      .readFileSync(
        path.join(PROMPTS_DIR, TEXT_TO_CHECKLIST_PROMPT_FILE),
        "utf8",
      )
      .replace("{{TEXT}}", sanitizedSourceText);

    // Add context if generating additional rules for existing checklist
    let contextPrefix = "";
    if (sanitizedSystemPrompt) {
      contextPrefix += `CHECKLIST CONTEXT:\n<user_system_context>${sanitizedSystemPrompt}</user_system_context>\n\n---\n\n`;
    }
    if (sanitizedChecklistName) {
      contextPrefix += `CHECKLIST NAME: <user_checklist_name>${sanitizedChecklistName}</user_checklist_name>\n\n---\n\n`;
    }
    if (existing_rules && existing_rules.length > 0) {
      const rulesContext = existing_rules.map((r, i) => `${i + 1}. ${sanitizeUserInput(r.prompt)}`).join('\n');
      contextPrefix += `EXISTING RULES (do not duplicate these, generate ADDITIONAL complementary rules):\n${rulesContext}\n\n---\n\n`;
    }

    if (contextPrefix) {
      prompt = contextPrefix + prompt;
    }

    // check if prompt contains unreplaced variables
    if (checkPromptForUnreplacedVariables(prompt)) {
      throw new Error(`Prompt contains unreplaced variables: ${prompt}`);
    }

    const systemPrompt = fs.readFileSync(
      path.join(PROMPTS_DIR, TEXT_TO_CHECKLIST_SYSTEM_PROMPT_FILE),
      "utf8",
    );
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];

    const requestData: any = {
      model: actualModelName,
      messages,
      ...(model_config.options || {}),
    };

    if (model_config.response_format !== 'none') {
      const useJsonSchema = model_config.response_format !== 'json_object';
      requestData.response_format = useJsonSchema
        ? {
          type: "json_schema" as const,
          json_schema: checklistInfoSchema,
        }
        : { type: "json_object" as const };
    }

    // set temperature if defined and supported by the model
    if (model_config.temperature !== null && model_config.temperature > 0.0) {
      requestData.temperature = model_config.temperature;
    }

    applyPredefinedParams(model_config.request_params, requestData as Record<string, unknown>);

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2)}`;

    try {
      const response = await client.chat.completions.create(requestData as any);

      // Log finish_reason for observability
      const finishReason = response.choices[0]?.finish_reason;
      console.log(`[AI][ChecklistExtraction] finish_reason: ${finishReason}`);
      if (finishReason === 'length') {
        console.warn(`[AI][ChecklistExtraction] WARNING: Response truncated (finish_reason=length).`);
      }

      // Check for truncated response
      const messageContent = response.choices[0]?.message?.content;
      if (!messageContent || messageContent.trim() === "") {
        throw new Error(
          `OpenAI returned empty response. Finish reason: ${finishReason}. This might indicate the response was truncated due to token limits or other issues.`,
        );
      }

      // result of the response
      const repairedContent = repairJson(messageContent);
      let result: any;
      try {
        result = JSON.parse(repairedContent);
      } catch (parseError: any) {
        if (process.env.NODE_ENV !== 'production') {
          console.error(`[AI][ChecklistExtraction] Failed to parse AI response as JSON: ${parseError.message}`);
          console.error(`[AI][ChecklistExtraction] Raw AI response (${messageContent.length} chars):\n${messageContent}`);
        }
        throw parseError;
      }

      // Convert the AI response into our Checklist type
      const checklist = createNewChecklist();
      checklist.name = result["name"] || "Unknown Checklist";
      checklist.system_prompt = result["system_prompt"] || "";

      // Map AI-recommended highlight mode string to enum value
      const highlightModeMap: Record<string, HighlightMode> = {
        rectangle: HighlightMode.RECTANGLE,
        dot: HighlightMode.DOT,
        underline: HighlightMode.UNDERLINE,
        bracket: HighlightMode.BRACKET,
      };
      if (result["highlight_mode"] && result["highlight_mode"] in highlightModeMap) {
        checklist.highlight_mode = highlightModeMap[result["highlight_mode"]];
      }

      // Extract checks from specific requirements
      if (result["rules"]) {
        const rules = result["rules"];
        if (Array.isArray(rules)) {
          rules.forEach((val: any, idx: number) => {
            const newRule: IRule = createNewRule(
              checklist.id,
              idx
            );
            newRule.prompt = val.prompt;
            newRule.order = idx;
            checklist.rules.push(newRule);
          });
        } else {
          throw new Error("Invalid input results received from AI");
        }
      }

      return checklist;
    } catch (error: any) {
      console.error(`ERROR: getChecksFromText [model=${model_config.id}, base_url=${model_config.base_url}]`, error?.status, error?.message);
      throw error;
    }
  },

  // flatten checks with multiple locations into multiple checks
  flattenAndConvertCheckRawFromAIToChecklist: ({
    rawChecks,
    checklist,
  }: {
    rawChecks: ICheckRawFromAI[],
    checklist: IChecklist,
  }): ICheck[] => {
    const flattenedChecks: ICheck[] = [];

    let checksWithMultipleLocationsCount: number = 0;
    let checkCount: number = 0;
    for (let i: number = 0; i < rawChecks.length; i++) {
      const rawCheck: ICheckRawFromAI = rawChecks[i];
      // count how much checks with multiple locations we have
      if (rawCheck.checks.length > 1) {
        checksWithMultipleLocationsCount++;
      }
      // now process every check and create new checks for each location
      for (let j: number = 0; j < rawCheck.checks.length; j++) {
        const single_raw_check = rawCheck.checks[j];

        const rule_id = rawCheck.ruleId;

        if (!rule_id) {
          throw new Error(`flattenAndConvertCheckRawFromAIToChecklist: rule_id is not valid! rawCheck: ${JSON.stringify(rawCheck, null, 2)}`);
        }

        // Step 1: Try to match against a known rule in the checklist
        const rule = checklist.rules.find(r => r.id === rule_id);

        let effectiveRuleId: string;
        if (rule) {
          effectiveRuleId = rule_id;
        // Step 2: Accept catch-changes checks (synthetic change detection rule)
        } else if (rule_id === REVDOKU_CATCH_CHANGES_RULE_ID) {
          effectiveRuleId = rule_id;
        // Step 3: Everything else → catch-all bucket (never lose a check)
        } else {
          console.warn(`Rule with id "${rule_id}" not found in checklist — assigning to catch-all rule`);
          effectiveRuleId = REVDOKU_CATCH_ALL_RULE_ID;
        }

        const newCheck: ICheck = createNewCheck();
        newCheck.rule_id = effectiveRuleId;
        newCheck.rule_order = rule?.order ?? rawChecks.length + i;
        newCheck.rule_prompt = rule?.prompt ?? '';
        newCheck.passed = single_raw_check.passed;
        const descText = single_raw_check.description?.trim() || `[${rule?.prompt ?? rule_id}]`;
        newCheck.description = descText;
        newCheck.page = single_raw_check.page;
        newCheck.x1 = single_raw_check.x1;
        newCheck.y1 = single_raw_check.y1;
        newCheck.x2 = single_raw_check.x2;
        newCheck.y2 = single_raw_check.y2;

        // Build structured data from AI response fields
        const dataType = single_raw_check.type?.trim();
        const isRecheck = newCheck.description?.startsWith('#recheck ');
        const isCatchChanges = effectiveRuleId === REVDOKU_CATCH_CHANGES_RULE_ID;
        // Only populate change-type data for catch-changes checks — regular checks don't use badges
        const effectiveType = isCatchChanges ? (dataType || extractChangesTagsFromCheckDescription(newCheck.description || '')) : '';
        if (effectiveType || isRecheck || single_raw_check.val_p || single_raw_check.val) {
          const types: string[] = [];
          if (effectiveType) types.push(effectiveType);
          if (isRecheck && !types.includes('recheck')) types.push('recheck');
          newCheck.data = { type: types.join(',') };
          if (single_raw_check.val_p) newCheck.data.val_p = single_raw_check.val_p;
          if (single_raw_check.val) newCheck.data.val = single_raw_check.val;
          // For catch-changes checks, extract val_p/val from description if AI didn't provide them
          if (isCatchChanges && !newCheck.data.val_p && !newCheck.data.val) {
            const extracted = extractPrevCurrentFromDescription(newCheck.description || '');
            if (extracted) {
              newCheck.data.val_p = extracted.val_p;
              newCheck.data.val = extracted.val;
            }
          }
        }

        // For any check (regular or change-detection), pass through val if AI provided it
        if (single_raw_check.val && !newCheck.data?.val) {
          if (!newCheck.data) newCheck.data = { type: '' };
          newCheck.data.val = single_raw_check.val;
        }
        // Pass through `ref` (reference file value) if AI provided it
        if ((single_raw_check as any).ref) {
          if (!newCheck.data) newCheck.data = { type: '' };
          (newCheck.data as any).ref = (single_raw_check as any).ref;
          // `ref_page` is 0-indexed within the ref file; UI adds +1 for display.
          // Only carry it when it's a number — absent/null should stay absent.
          const rp = (single_raw_check as any).ref_page;
          if (typeof rp === 'number' && Number.isFinite(rp)) {
            (newCheck.data as any).ref_page = rp;
          }
        }

        flattenedChecks.push(newCheck);
        checkCount++;
      }
    }

    // repor how much checks we had with multiple locations
    console.debug(
      "checks with multiple locations checksWithMultipleLocationsCount:",
      `Found ${checksWithMultipleLocationsCount} checks with multiple locations`,
    );

    // finally return the flattened checks
    return flattenedChecks;
  },

  /**
   * Dedicated AI call to extract page text as constrained markdown.
   * Used in two places — both paths share the same prompt and the same
   * `text_extraction_model_config` (a cheap vision model, not the main
   * inspection model):
   *
   *   1. Phase 1 of an inspection when track_changes is enabled, so the
   *      inspection can diff new content against the previous revision.
   *
   *   2. Reference-file normalization at upload time (see the /file/normalize
   *      route) — PDFs and images attached to rules via `#file` markers get
   *      their content OCR'd once and cached on DocumentFileRevision.page_texts.
   *
   * Batched: the AI call is chunked into groups of TEXT_EXTRACTION_BATCH_PAGES
   * pages so large files (hundreds of pages) don't blow past model output
   * limits or context windows. The result is a single flat array keyed by
   * absolute page number.
   */
  extractPageTexts: async ({
    sourcePages,
    model_config,
    ai_mode = EAIImageAnalysisMode.AUTO,
  }: {
    sourcePages: IPageInfoExtended[];
    model_config: IModelConfig;
    ai_mode?: EAIImageAnalysisMode;
  }): Promise<Array<{ page: number; text: string }>> => {
    if (sourcePages.length === 0) return [];

    const batchSize = TEXT_EXTRACTION_BATCH_PAGES;
    const allResults: Array<{ page: number; text: string }> = [];

    for (let start = 0; start < sourcePages.length; start += batchSize) {
      const chunk = sourcePages.slice(start, start + batchSize);
      console.log(`[AI][TextExtraction] Batch ${Math.floor(start / batchSize) + 1}: pages ${start + 1}-${start + chunk.length} of ${sourcePages.length}`);
      const batchResult = await runTextExtractionBatch({
        chunk,
        totalPages: sourcePages.length,
        pageOffset: start,
        model_config,
        ai_mode,
      });
      allResults.push(...batchResult);
    }

    return allResults;
  },

  inspectInput: async ({
    envelope_revision_id,
    document_files_revisions,
    report_id,
    checklist,
    envelope_checklist,
    previous_report_checks = [],
    ai_mode = EAIImageAnalysisMode.AUTO,
    model_config,
    reserved_check_indices = [],
    debug,
    inspection_date_display,
    page_font_scales,
    previous_page_texts,
    max_affordable_pages,
    session_id,
    pageNumberOffset = 0,
    batch_context,
    current_job_checks,
    current_job_previous_page_texts,
    requestedPages,
    ref_files = [],
    text_extraction_model_config,
    review_note,
  }: {
    report_id?: string;
    envelope_revision_id: string;
    document_files_revisions: IDocumentFileRevision[];
    checklist?: IChecklist;
    envelope_checklist?: IChecklist
    previous_report_checks?: ICheck[];
    ai_mode?: EAIImageAnalysisMode;
    model_config: IModelConfig; // Required — provided by Rails per-request
    text_extraction_model_config?: IModelConfig; // Cheap vision model for extractPageTexts + reference-file OCR
    reserved_check_indices?: number[]; // Indices used by preserved user checks (AI must skip these)
    debug?: IDebugOptions;
    inspection_date_display?: string; // Pre-formatted date string for {{DATE}} placeholder
    page_font_scales?: Record<number, number>; // Per-page font scale for label placement
    previous_page_texts?: Array<{ page: number; text: string }>; // Page texts from previous revision for change tracking
    max_affordable_pages?: number; // Credit budget limit — reject if actual page count exceeds this
    session_id?: string; // Hashed session ID for AI debug logging (only when DEBUG_AI=true)
    pageNumberOffset?: number; // Batch processing: 0-based page offset for this batch
    batch_context?: Array<{ file_name: string }>; // Batch processing: file names for context
    current_job_checks?: ICheck[]; // Batch processing: checks from prior batches in this job
    current_job_previous_page_texts?: Array<{ page: number; text: string }>; // Batch processing: page texts from prior batches
    requestedPages?: number[] | null; // Batch processing: specific 1-indexed pages to render/inspect
    ref_files?: IReferenceFile[]; // Top-level reference files backing #file / file:<id> markers. See create.ts.
    review_note?: string | null; // Per-review user context; injected after checklist.system_prompt in a <review_context> block.
  }): Promise<IReport> => {
    // If we have source documents and this page has original image data, use that instead

    try {
      // Resolve grid mode: debug override > model config > code default (NONE)
      const effectiveGridMode = debug?.grid_mode
        || (model_config.grid_mode as EGridMode)
        || undefined; // let enrichAndRender use its internal default (NONE)

      // we render and enrich all files related to the source document
      // by rending .pageAsImage and .pageAsImageWithGrid for them (in IPageInfoExtended interface)
      // Note: even NONE mode goes through generateImagesWithGrid to add PAGE N labels
      const document_files_revisions_enriched = await enrichAndRenderFilesRelatedToEnvelopeRevision(
        document_files_revisions, false, undefined, ai_mode,
        effectiveGridMode || undefined,  // gridModeOverride (NONE adds [PN] overlay only)
        false,  // skipGrid — always run grid pipeline (NONE mode adds page label overlay)
        model_config.ai_coord_scale || 0,  // aiCoordScale for grid label rendering
        pageNumberOffset,      // batch page offset for grid label numbering
        requestedPages         // specific pages to render (null = all)
      );

      // we get all pages from the source document and enforce them to be IPageInfoExtended[]
      // which are enriched PageInfo with .pageAsImage and .pageAsImageWithGrid
      let sourcePages: IPageInfoExtended[] = document_files_revisions_enriched.flatMap(f => f.pages || []) as IPageInfoExtended[];

      if (sourcePages.length === 0) {
        console.error("ERROR: No pages found in the source document, pages.length: ", sourcePages.length);
        throw new Error(`No pages found in the source document, pages.length: ${sourcePages.length}`);
      }

      // Budget: trim to affordable pages after enrichment (safety net — create.ts trims before enrichment too)
      if (max_affordable_pages != null && max_affordable_pages >= 0 && sourcePages.length > max_affordable_pages) {
        console.info(`[AI] Trimming from ${sourcePages.length} to ${max_affordable_pages} affordable pages`);
        sourcePages = sourcePages.slice(0, max_affordable_pages);
      }

      // Detect content boxes for each page (used for smart label placement)
      // This identifies areas with actual content that labels should avoid.
      // Skip detection if content_boxes were already populated by generateImagesWithGrid.
      for (let pageIdx = 0; pageIdx < sourcePages.length; pageIdx++) {
        const page = sourcePages[pageIdx];
        if (page.content_boxes && page.content_boxes.length > 0) {
          console.debug(`detectContentBoxes: page ${pageIdx + 1} using ${page.content_boxes.length} pre-detected content boxes`);
          continue;
        }
        if (page.pageAsImage) {
          const imageBuffer = Buffer.from(page.pageAsImage, 'base64');
          try {
            // Calculate grid cell size using same logic as visual grid
            // Use original dimensions for consistency with the visual grid
            const gridCellSize = calculateRoundStep(
              Math.min(page.original_width, page.original_height)
            );

            const lineThicknessMaxPx = Math.max(4, Math.round(page.height * LINE_EROSION_PAGE_HEIGHT_FRACTION));
            const { contentBoxes: detectedBoxes } = await detectContentBoxes(imageBuffer, {
              gridCellSize,
              contentThresholdPercent: 10,
              lineThicknessMaxPx,
            });

            // Normalize coordinates from scaled space to original space
            // detectContentBoxes runs on pageAsImage (scaled+cropped), but we store in original full-page space
            const scaleFactor = page.scaling_factor || 1;
            const cropOffX = page.crop_offset_x || 0;
            const cropOffY = page.crop_offset_y || 0;
            page.content_boxes = detectedBoxes.map(cb => ({
              x1: Math.round(cb.x1 / scaleFactor) + cropOffX,
              y1: Math.round(cb.y1 / scaleFactor) + cropOffY,
              x2: Math.round(cb.x2 / scaleFactor) + cropOffX,
              y2: Math.round(cb.y2 / scaleFactor) + cropOffY,
            }));

            console.debug(`detectContentBoxes: page ${pageIdx + 1} detected ${page.content_boxes.length} content boxes (gridCellSize: ${gridCellSize})`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            let debugPath = '';
            if (_notProduction) {
              try {
                const dumpDir = path.join(process.cwd(), 'logs', 'failed-pages');
                fs.mkdirSync(dumpDir, { recursive: true });
                const filePath = path.join(dumpDir, `page-${pageIdx + 1}-${Date.now()}.bin`);
                fs.writeFileSync(filePath, imageBuffer);
                debugPath = ` [saved: ${filePath}]`;
              } catch { /* ignore save failure */ }
            }
            throw new Error(`Content detection failed on page ${pageIdx + 1} (${page.width}x${page.height}): ${msg}${debugPath}`);
          }
        }
      }


      // Get document metadata from source file revisions (sanitize user-supplied content)
      const documentMetaData = sanitizeUserInput(
        document_files_revisions_enriched.map(f => f.metadata || '').join('\n')
      );

      if (documentMetaData.length === 0) {
        console.warn("WARNING: No document metadata found, using empty string");
      }

      // Skip AI but still generate debug images if requested (dev mode only!)
      // Double-check production guard for safety - skip_ai should NEVER work in production
      if (debug?.skip_ai && process.env.NODE_ENV !== 'production') {
        console.debug("inspectInput: skip_ai mode - skipping AI, generating debug images only");

        const reportNew: IReport = createNewReport();
        reportNew.id = report_id ? report_id : '';
        reportNew.envelope_revision_id = envelope_revision_id;
        reportNew.checklist_id = checklist?.id || '';
        reportNew.ai_model = model_config.id;
        reportNew.checks = [];

        // Generate debug overlay images if debug mode is enabled
        if (debug) {
          try {
            console.debug("inspectInput: generating debug overlay images (skip_ai mode)...");
            const debugOverlayImages = await overlayChecksOnGridImages(sourcePages, []);
            const debugInfo: Record<string, any> = {};
            debugInfo.debug_overlay_images = debugOverlayImages;
            debugInfo.grid_mode = sourcePages[0]?.gridMode || effectiveGridMode || 'unknown';
            debugInfo.pages_info = sourcePages.map((p, i) => ({
              page_index: i,
              width: p.width,
              height: p.height,
              original_width: p.original_width,
              original_height: p.original_height,
              scaling_factor: p.scaling_factor,
              crop_offset_x: p.crop_offset_x || 0,
              crop_offset_y: p.crop_offset_y || 0,
              content_bounding_box: p.content_bounding_box || null,
              grid_mode: p.gridMode || effectiveGridMode || 'unknown',
              content_boxes_count: p.content_boxes?.length || 0,
              content_boxes: p.content_boxes || [],
            }));
            reportNew.debug_info = JSON.stringify(debugInfo);
            console.debug("inspectInput: debug overlay images generated (skip_ai mode)", debugOverlayImages.length);
          } catch (debugErr) {
            console.error("inspectInput: failed to generate debug overlay images (skip_ai mode)", debugErr);
          }
        }

        return reportNew;
      }


      // Merge checklist rules with manual rules
      const mergedChecklist: IChecklist = createVirtualChecklistForAI({
        checklist: checklist,
        envelope_checklist: envelope_checklist,
        previous_report_checks: previous_report_checks,
        previous_page_texts: previous_page_texts,
      });

      //console.debug("previousReport.checklist", JSON.stringify(previousReport?.checklist, null, 2));

      // Define once — used for schema extension, prompt injection, and page_texts extraction
      const trackChanges = checklist?.track_changes === true;

      if (!mergedChecklist.rules || mergedChecklist.rules?.length === 0) {
        console.error("ERROR: No rules found in the checklist, mergedChecklist.rules.length: ", mergedChecklist.rules.length);
        throw new Error(`No rules found in the checklist, mergedChecklist.rules.length: ${mergedChecklist.rules.length}`);
      }


      const ai_coord_scale = model_config.ai_coord_scale || 0;

      // Convert previous check coordinates from envelope space to AI model coordinate space
      // before prompt assembly, so echoed coordinates round-trip correctly through convertCheckLocationsFromAICoordinatesToEnvelopeCoordinates.
      convertCheckCoordinatesFromEnvelopeCoordinatesToAIModelCoordinateSpace(
        mergedChecklist, sourcePages as IPageInfoExtended[], ai_coord_scale, pageNumberOffset
      );

      let prompt = "";



      // Sanitize checklist data before sending to AI (remove sensitive information)
      // Pass the top-level ref_files array so rule prompts get their
      // `file:<dfrev_prefix_id>` tokens substituted with text content before
      // the markdown formatter sees them.
      const sanitizedChecklist: IChecklistSimplified = convertChecklistToSimplifiedForAI(mergedChecklist, ref_files);


      // generate map for replacing long rule ids with short ones
      // we will need restor it once we get the response from AI
      // generating map for replacing long rule ids
      // we replace field name from "id" with "ruleId"
      // and also replacing values from GUID to short ones like rule-1, rule-2, etc.

      const valueReplacementResult: IValueReplacementsResult = replaceValuesToSimplified({
        inputList: sanitizedChecklist.rules,
        // original is like "id"
        fieldName: ORIGINAL_FIELD_NAME_FOR_EXTERNAL_ID,
        // new field values previs will be "rule" so we have "rule1", "rule2", etc.
        newValuePrefix: SIMPLIFIED_VALUE_PREFIX_FOR_RULES,
      });

      // rename field name from "id" to "ruleId"
      sanitizedChecklist.rules = renameFieldInItemsInArray({
        inputArray: valueReplacementResult.outputArray,
        oldFieldName: ORIGINAL_FIELD_NAME_FOR_EXTERNAL_ID,
        newFieldName: SIMPLIFIED_FIELD_NAME_FOR_RULES // "ruleId"
      });

      // update checklist with new rules
      sanitizedChecklist.rules = valueReplacementResult.outputArray;

      // format checklist as structured markdown for the AI prompt
      const checklistForPrompt = formatChecklistAsMarkdown(sanitizedChecklist);



      prompt = fs
        .readFileSync(path.join(PROMPTS_DIR, INPUT_INSPECT_PROMPT_FILE), "utf8")
        .replace("{{CHECKLIST}}", checklistForPrompt);

      // Build the date string for the prompt: use pre-formatted display from Rails if available,
      // otherwise fall back to server date
      let dateForPrompt: string;
      if (inspection_date_display) {
        dateForPrompt = inspection_date_display;
      } else {
        const dateToday = getTodayDate();
        dateForPrompt = dateToday.getFullYear() +
          "-" +
          dateToday.toLocaleString("default", { month: "long" }) +
          "-" +
          dateToday.getDate();
      }

      // we need to find the checklist that matches the input
      try {
        // NOW REPLACEMENTS FOR ALL CHECKLISTS / SINGLE CHECKLIST
        // global replacements we need for every prompt.
        // Use regex + /g flag (NOT a plain string pattern) because prompt
        // authors legitimately reuse the same token in multiple places
        // (e.g. `{{DOCUMENT_PAGES_COUNT}}` appears in the header AND in
        // the per-page coverage imperative), and `String.replace(string,
        // …)` only swaps the first occurrence — the unreplaced-variable
        // check further down then throws. TS target is es2020 here so we
        // can't use `replaceAll`; regex /g is the portable equivalent.
        prompt = prompt
          .replace(/\{\{CHECKLIST\}\}/g, checklistForPrompt)
          .replace(/\{\{PAGE_DIMENSIONS\}\}/g, buildPageDimensionsString(sourcePages, ai_coord_scale, pageNumberOffset))
          .replace(/\{\{DOCUMENT_INFORMATION\}\}/g, documentMetaData)
          .replace(/\{\{DOCUMENT_PAGES_COUNT\}\}/g, sourcePages.length.toString() || "1")
          .replace(/\{\{DATE\}\}/g, dateForPrompt);

        // Resolve coordinate example placeholders: {{COORD_nnW}} and {{COORD_nnH}}
        // These make the worked example scale-aware so the AI sees coordinates in the correct range
        prompt = prompt.replace(/\{\{COORD_(\d+)(W|H)\}\}/g, (_match, pct, axis) => {
          const percentage = parseInt(pct, 10);
          if (ai_coord_scale > 0) {
            return String(Math.round(ai_coord_scale * percentage / 100));
          }
          const firstPage = sourcePages[0] as IPageInfoExtended | undefined;
          if (!firstPage) return String(percentage);
          const base = axis === 'W' ? firstPage.width : firstPage.height;
          return String(Math.round(base * percentage / 100));
        });

        // Inject previous revision page texts when available (for change tracking)
        if (trackChanges && previous_page_texts && previous_page_texts.length > 0) {
          let prevTextsSection = '\n\n## Previous Revision Page Texts\nThe following text was extracted from the previous revision of this document. Use this to identify what changed.\n';
          for (const pt of previous_page_texts) {
            prevTextsSection += `\n<previous_text page="${pt.page}">\n${pt.text}\n</previous_text>\n`;
          }
          prompt += prevTextsSection;
        }

        // check if prompt contains unreplaced variables
        if (checkPromptForUnreplacedVariables(prompt)) {
          throw new Error(`Prompt contains unreplaced variables. Prompt: ${prompt}`);
        }

        const imageParts: ChatCompletionContentPart[] = [
          { type: "text", text: prompt },
        ];

        const totalPages = sourcePages.length;
        const pageLabelSuffix = pageNumberOffset === 0 ? ` of ${totalPages}` : '';

        // Identify blank pages (compressed to 1x1 by compressEmptyImagesInPages).
        // Sending these to AI providers causes 400 errors.
        const isBlankPage = (page: IPageInfoExtended): boolean =>
          page.width <= 1 && page.height <= 1;

        // Track page review statuses for batch processing
        const page_statuses: Record<string, number> = {};

        // In AUTO mode, only include grid images
        // In ENHANCED_1 mode, include both original and grid images
        if (ai_mode === EAIImageAnalysisMode.ENHANCED_1) {
          // Add original images first with page labels
          for (let pi = 0; pi < sourcePages.length; pi++) {
            const absolutePageIdx = pi + pageNumberOffset;
            if (isBlankPage(sourcePages[pi] as IPageInfoExtended)) {
              page_statuses[String(absolutePageIdx)] = 1; // SKIPPED_AS_BLANK
              continue;
            }
            page_statuses[String(absolutePageIdx)] = 0; // REVIEWED
            imageParts.push(
              { type: "text", text: `--- Original image: Page ${pi + 1 + pageNumberOffset}${pageLabelSuffix} ---` } as ChatCompletionContentPart,
              {
                type: "image_url",
                image_url: {
                  url: `data:${AI_IMAGE_MIME};base64,${sourcePages[pi].pageAsImage}`,
                  detail: "high",
                },
              } as ChatCompletionContentPart,
            );
          }
        }

        // Always add grid images (for both AUTO and ENHANCED_1 modes)
        // Interleave text labels so the AI knows which image = which page.
        // Skip blank pages (1x1 placeholders) — sending them crashes some AI providers.
        for (let pi = 0; pi < sourcePages.length; pi++) {
          const absolutePageIdx = pi + pageNumberOffset;
          if (isBlankPage(sourcePages[pi] as IPageInfoExtended)) {
            page_statuses[String(absolutePageIdx)] = 1; // SKIPPED_AS_BLANK
            console.debug(`inspectInput: skipping blank page ${pi + 1 + pageNumberOffset} from AI prompt`);
            continue;
          }
          page_statuses[String(absolutePageIdx)] = 0; // REVIEWED
          imageParts.push(
            { type: "text", text: `--- Page ${pi + 1 + pageNumberOffset}${pageLabelSuffix} ---` } as ChatCompletionContentPart,
            {
              type: "image_url",
              image_url: {
                url: `data:${AI_IMAGE_MIME};base64,${sourcePages[pi].pageAsImageWithGrid}`,
                detail: "high",
              },
            } as ChatCompletionContentPart,
          );
        }

        console.debug(`AI Mode: ${ai_mode}, Images added to the prompt: ${imageParts.filter(p => p.type === "image_url").length}, total dataurl length: ${imageParts.reduce((acc, part) => acc + (part.type === "image_url" ? (part.image_url?.url?.length || 0) : 0), 0)}`);

        // Load base system prompt from file
        let systemPrompt = fs.readFileSync(
          path.join(PROMPTS_DIR, INPUT_INSPECT_SYSTEM_PROMPT_FILE),
          "utf8",
        );

        // Splice in the reference-files guidance only when the inspection
        // has at least one ref pinned — keeps the baseline prompt lean for
        // the common no-ref case. When no refs: the `{{…}}` marker is
        // replaced with an empty string and adjacent blank lines collapsed
        // so there's no dangling whitespace in the final prompt.
        const hasReferenceFiles = Array.isArray(ref_files) && ref_files.length > 0;
        const referenceFilesGuidance = hasReferenceFiles
          ? fs.readFileSync(
              path.join(PROMPTS_DIR, INPUT_INSPECT_REFERENCE_FILES_PROMPT_FILE),
              "utf8",
            ).trim()
          : "";

        // Splice in extraction/enumeration guidance only when the checklist
        // contains at least one rule with a `#value` marker. Without this
        // gate every checklist would get the anti-rollup / value-format
        // boilerplate and pay the token cost even for a plain invoice
        // review that doesn't extract any values. Scan BOTH the individual
        // rule prompts and the checklist-level system_prompt (marker can
        // appear in either). Case-sensitive on purpose — `#value` is the
        // canonical spelling (see `rule_value_marker.rb`).
        const hasValueExtraction = (
          (Array.isArray(mergedChecklist.rules) &&
            mergedChecklist.rules.some(r => typeof r?.prompt === "string" && r.prompt.includes("#value"))) ||
          (typeof checklist?.system_prompt === "string" && checklist.system_prompt.includes("#value"))
        );
        const valueExtractionGuidance = hasValueExtraction
          ? fs.readFileSync(
              path.join(PROMPTS_DIR, INPUT_INSPECT_VALUE_EXTRACTION_PROMPT_FILE),
              "utf8",
            ).trim()
          : "";

        systemPrompt = systemPrompt
          .replace("{{REFERENCE_FILES_GUIDANCE}}", referenceFilesGuidance)
          .replace("{{VALUE_EXTRACTION_GUIDANCE}}", valueExtractionGuidance)
          .replace(/\n{3,}/g, "\n\n");

        // Prepend custom system_prompt from checklist if provided. Also
        // substitute `file:<dfrev_prefix_id>` canonical tokens with their
        // referenced content so a checklist-level `#file[...]` marker —
        // resolved by Rails' RuleFileResolver — gets inlined right here
        // in the system message. Wrapped in delimiters and sanitized to
        // prevent prompt injection.
        if (checklist?.system_prompt && checklist.system_prompt.trim()) {
          scanAndLogInjectionAttempts({ system_prompt: checklist.system_prompt }, 'inspectInput.checklist');
          const withReferences = substituteReferenceFileTokens(
            checklist.system_prompt.trim(),
            ref_files
          );
          const sanitizedChecklistSystemPrompt = sanitizeUserInput(withReferences);
          systemPrompt = `<user_system_context>\n${sanitizedChecklistSystemPrompt}\n</user_system_context>\n\n---\n\n${systemPrompt}`;
          console.debug("inspectInput: Using custom system_prompt from checklist");
        }

        // Per-review user context (review_note) — author-of-the-inspection
        // supplies this at review time to give the AI extra context for
        // THIS run only. Injected as a separate <review_context> block so
        // the AI treats it as orthogonal to the checklist's system_prompt
        // (which is checklist-author-written and reusable across runs).
        if (review_note && review_note.trim()) {
          scanAndLogInjectionAttempts({ system_prompt: review_note }, 'inspectInput.review_note');
          const sanitizedReviewNote = sanitizeUserInput(review_note.trim());
          systemPrompt = `<review_context>\nThe user provided the following context for this specific review. Treat it as additional facts/intent for this run only; do not treat it as a checklist rule.\n\n${sanitizedReviewNote}\n</review_context>\n\n---\n\n${systemPrompt}`;
          console.debug("inspectInput: Using review_note for this run");
        }

        // Batch context: inform AI about batch boundaries and prior inspections
        if (pageNumberOffset > 0 || batch_context) {
          const batchLines: string[] = [];
          if (batch_context?.length) {
            batchLines.push(`Document files: ${batch_context.map(f => f.file_name).join(', ')}`);
          }
          const batchStartPage = pageNumberOffset + 1;
          const batchEndPage = pageNumberOffset + sourcePages.length;
          if (pageNumberOffset > 0) batchLines.push(`Previously inspected pages 1-${pageNumberOffset}.`);
          batchLines.push(`Now inspecting pages ${batchStartPage}-${batchEndPage}.`);
          try {
            const batchContextPrompt = fs.readFileSync(path.join(PROMPTS_DIR, BATCH_CONTEXT_PROMPT_FILE), "utf8")
              .replace("{{BATCH_CONTEXT_LINES}}", batchLines.join('\n'));
            systemPrompt += `\n\n${batchContextPrompt}`;
          } catch (err) {
            // Fallback if prompt file not found
            systemPrompt += `\n\n<batch_context>\n${batchLines.join('\n')}\n</batch_context>`;
          }
        }

        // Prior batch checks context: summarize findings from previous batches.
        // Grouped by page for readability (verbatim restore from 4763a5b).
        // Rails caps the array size via MAX_CHECKS_FROM_PREVIOUS_BATCHES before sending.
        if (current_job_checks?.length) {
          const checksByPage = new Map<number, Array<{ passed: boolean; description: string }>>();
          for (const c of current_job_checks) {
            const page = (c.page || 0) + 1;
            if (!checksByPage.has(page)) checksByPage.set(page, []);
            checksByPage.get(page)!.push({
              passed: c.passed,
              description: (c.description || '').slice(0, PRIOR_CHECK_DESCRIPTION_MAX_CHARS),
            });
          }
          const lines: string[] = [];
          for (const [page, checks] of [...checksByPage.entries()].sort(([a], [b]) => a - b)) {
            lines.push(`Page ${page} (${checks.length} checks):`);
            for (const c of checks) {
              lines.push(`- [${c.passed ? 'PASS' : 'FAIL'}] ${c.description}`);
            }
          }
          systemPrompt += `\n\n<prior_batch_findings>\nFindings from previously inspected pages (${current_job_checks.length} checks across ${checksByPage.size} pages):\n${lines.join('\n')}\n</prior_batch_findings>`;
        }

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: imageParts },
        ];

        // model_config is required — provided by Rails per-request
        const client = createOpenAIClient(model_config);
        const actualModelName = getModelNameForAPI(model_config.id);

        console.log(`[AI] Calling model="${actualModelName}" at baseURL="${model_config.base_url}" (provider: ${model_config.provider}, response_format: ${model_config.response_format || 'default'})`);

        const requestData: any = {
          model: actualModelName,
          messages: messages,
          ...(model_config.options || {}),
        };

        if (model_config.response_format !== 'none') {
          const useJsonSchema = model_config.response_format !== 'json_object';

          requestData.response_format = useJsonSchema
            ? {
              type: "json_schema" as const,
              json_schema: buildInspectionResultsSchema(trackChanges),
            }
            : { type: "json_object" as const };
        }

        // set temperature if defined and supported by the model
        if (
          model_config.temperature !== null &&
          model_config.temperature > 0.0
        ) {
          requestData.temperature = model_config.temperature;
        }

        applyPredefinedParams(model_config.request_params, requestData as Record<string, unknown>);


        console.log(`[AI] Calling model="${requestData.model}" (provider: ${model_config.provider}, response_format: ${model_config.response_format || 'default'}) session=${session_id || 'none'}`);


        // finally do the request to AI
        let response;
        try {
          response = await client.chat.completions.create(requestData);
        } catch (aiCallError: any) {
          throw aiCallError;
        }

        // Log finish_reason for observability
        const finishReason = response.choices[0]?.finish_reason;
        console.log(`[AI][Inspection] finish_reason: ${finishReason}`);
        if (finishReason === 'length') {
          console.warn(`[AI][Inspection] WARNING: Response truncated (finish_reason=length). max_tokens may be insufficient.`);
        }


        // Check for truncated response
        const messageContent = response.choices[0]?.message?.content;
        if (!messageContent || messageContent.trim() === "") {
          throw new Error(
            `OpenAI returned empty response for input inspection. Finish reason: ${finishReason}. This might indicate the response was truncated due to token limits or the payload was too large.`,
          );
        }

        let reportNew: IReport | null = createNewReport();

        const repairedContent = repairJson(messageContent);
        let reportFromAI: any;
        try {
          reportFromAI = JSON.parse(repairedContent);
        } catch (parseError: any) {
          if (process.env.NODE_ENV !== 'production') {
            console.error(`[AI][Inspection] Failed to parse AI response as JSON: ${parseError.message}`);
            console.error(`[AI][Inspection] Raw AI response (${messageContent.length} chars):\n${messageContent}`);
          }
          throw parseError;
        }

        // Step 1: Validate AI response structure (coerce types where safe)
        const validation = validateAIResponse(reportFromAI);
        if (validation.errors.length > 0) {
          console.warn(`AI response validation warnings: ${validation.errors.join('; ')}`);
        }
        if (!validation.valid) {
          throw new Error(`AI returned invalid response structure: ${validation.errors.join('; ')}`);
        }
        // Use validated/coerced results
        reportFromAI.results = validation.results;

        // Output validation: check for signs of successful prompt injection
        // Flag if all checks pass with suspiciously similar descriptions (bulk-pass attack)
        const allChecksFromAI = reportFromAI.results.flatMap((r: any) => r.checks || []);
        if (allChecksFromAI.length > 2) {
          const allPassed = allChecksFromAI.every((c: any) => c.passed === true);
          if (allPassed) {
            const descriptions = allChecksFromAI.map((c: any) => (c.description || '').toLowerCase().trim());
            const uniqueDescriptions = new Set(descriptions);
            if (uniqueDescriptions.size <= Math.max(1, Math.floor(allChecksFromAI.length * SUSPICIOUS_UNIQUE_DESCRIPTION_RATIO))) {
              console.warn('[PROMPT_GUARD] Suspicious: ALL checks passed with very few unique descriptions — possible prompt injection bypass');
            }
          }
        }
        // Flag if any check description contains system prompt fragments
        for (const result of reportFromAI.results) {
          for (const check of (result as any).checks || []) {
            const desc = (check.description || '').toLowerCase();
            if (SYSTEM_PROMPT_LEAK_FRAGMENTS.some(frag => desc.includes(frag))) {
              console.warn(`[PROMPT_GUARD] Suspicious: check description may contain leaked system prompt fragment: "${check.description?.substring(0, 100)}"`);
            }
            // Cap description length — concise output is required (max ~200 chars target, 300 hard cap)
            if (check.description && check.description.length > 300) {
              check.description = check.description.substring(0, 300) + '...';
            }
          }
        }

        // Detect and fix contradictions where AI says passed=true but description indicates failure
        const contradictionsCorrected = detectAndFixContradictions(reportFromAI.results);
        // Attach to report for upstream logging (ad-hoc property, not part of IReport interface)
        (reportNew as any)._contradictionsCorrected = contradictionsCorrected;


        // POSTPROCESSING THE REPORT
        // NOW enriching the checks with order and severity

        // setting report_id to given as the input
        reportNew.id = report_id ? report_id : '';

        reportNew.envelope_revision_id = envelope_revision_id;

        // Step 2: Verify ruleIds match expected simplified IDs
        const expectedRuleIds = Object.values(valueReplacementResult.replacementsMap);
        const matchedCount = reportFromAI.results.filter(
          (r: ICheckRawFromAI) => expectedRuleIds.includes(r.ruleId)
        ).length;

        let resultsToRestore = reportFromAI.results as ICheckRawFromAI[];

        if (matchedCount < reportFromAI.results.length) {
          const unmatchedIds = reportFromAI.results
            .filter((r: any) => !expectedRuleIds.includes(r.ruleId))
            .map((r: any) => r.ruleId);

          if (ENABLE_RULE_ID_RECOVERY) {
            // Recovery mode: attempt positional/partial recovery
            const recovery = recoverRuleIds(reportFromAI.results, expectedRuleIds);
            console.warn(`ruleId recovery: strategy="${recovery.strategy}", model=${model_config.id}`);
            resultsToRestore = recovery.results;
          } else {
            // Strict mode (default): throw descriptive error for user
            throw new Error(
              `AI model "${model_config.id}" returned invalid rule IDs: [${unmatchedIds.join(', ')}]. ` +
              `Expected: [${expectedRuleIds.join(', ')}]. ` +
              `${matchedCount} of ${reportFromAI.results.length} results had valid IDs. ` +
              `This model may not support structured output. Try a different AI model.`
            );
          }
        }

        // Step 3: Restore simplified IDs back to original long IDs
        const rawChecksWithRestoredIds: ICheckRawFromAI[] = [];
        for (const check of resultsToRestore) {
          const originalId = Object.entries(valueReplacementResult.replacementsMap)
            .find(([_, short]) => short === check.ruleId)?.[0];
          if (!originalId) {
            throw new Error(
              `Failed to restore ruleId "${check.ruleId}". ` +
              `AI model "${model_config.id}" returned incompatible response format. Try a different AI model.`
            );
          }
          rawChecksWithRestoredIds.push({ ...check, ruleId: originalId });
        }

        reportNew.checks = ai.flattenAndConvertCheckRawFromAIToChecklist({
          rawChecks: rawChecksWithRestoredIds,
          checklist: mergedChecklist,
        });

        // restore original rule ids from simplified to long ones
        reportNew.checks = restoreValuesFromSimplified(
          {
            inputList: reportNew.checks,
            fieldName: "rule_id", // "rule_id" is the field with id of rule in ICheck that we should restore values to
            replacementMap: valueReplacementResult.replacementsMap
          }
        );


        // Save raw AI coordinates for debug overlay (before reverse mapping overwrites them)
        const rawAICoordsById = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
        let _saveRawCoords: boolean = !!debug;
        if (_saveRawCoords) {
          for (const check of reportNew.checks) {
            rawAICoordsById.set(check.id, { x1: check.x1, y1: check.y1, x2: check.x2, y2: check.y2 });
          }
        }

        // optimizing check locations (coordinates and pages)
        const allGeneratedChecks = ai.convertCheckLocationsFromAICoordinatesToEnvelopeCoordinates(sourcePages, reportNew.checks, model_config.ai_coord_scale, pageNumberOffset);


        // Compute pre-computed description label positions. Pass pageNumberOffset
        // so batch 2+ checks (whose .page is already an ABSOLUTE document index
        // after convertCheckLocationsFromAICoordinatesToEnvelopeCoordinates at
        // line ~1983) can still index correctly into sourcePages (which only
        // holds this batch's pages at local indices 0..sourcePages.length-1).
        // Without the offset, the per-page guard `pageIndex >= sourcePages.length`
        // short-circuits every non-first-batch check, leaving description_position
        // null and the frontend falling back to an in-page fallback placement.
        const checksWithPositions = ai.computeDescriptionPositions(sourcePages, allGeneratedChecks, page_font_scales, pageNumberOffset);

        // Force all catch-changes checks to failed BEFORE sorting — changes must be
        // reviewed by user. Must happen before sort so they land in the failed group
        // and get sequential indices alongside other failed checks.
        checksWithPositions.forEach(check => {
          if (check.rule_id === REVDOKU_CATCH_CHANGES_RULE_ID) {
            check.passed = false;
          }
        });

        // Sort for check_index assignment: failed first, then passed; within each group,
        // by visual center position (page → center Y → center X) using the shared comparator.
        checksWithPositions.sort((a: ICheck, b: ICheck) => {
          if (a.passed !== b.passed) return a.passed ? 1 : -1;
          if (a.page !== b.page) return a.page - b.page;
          return compareByVisualPosition(a, b);
        });

        // Assign check_index for unique per-check badge numbering.
        // Skip indices reserved by preserved user checks so AI fills unused slots.
        const reservedSet = new Set(reserved_check_indices || []);
        const maxCheckIndex = reservedSet.size + checksWithPositions.length + 1;
        let nextIndex = 1;
        checksWithPositions.forEach((check) => {
          while (reservedSet.has(nextIndex) && nextIndex < maxCheckIndex) nextIndex++;
          check.check_index = nextIndex;
          nextIndex++;
        });

        // populate new report fields
        reportNew.checklist_id = checklist.id;
        reportNew.ai_model = model_config.id;
        reportNew.checks = checksWithPositions;

        // Phase 1: Dedicated text extraction when track_changes is enabled.
        // Uses the separate cheap vision model (text_extraction_model_config)
        // so track_changes doesn't pay the main inspection model's
        // credits-per-page rate. Falls back to the inspection model if
        // Rails didn't supply a dedicated text extraction config.
        if (trackChanges) {
          try {
            console.log(`[AI][Phase1] Starting dedicated text extraction for ${sourcePages.length} page(s)`);
            const extractionModel = text_extraction_model_config || model_config;
            const extractedPageTexts = await ai.extractPageTexts({
              sourcePages,
              model_config: extractionModel,
              ai_mode,
            });
            reportNew.page_texts = extractedPageTexts;
            console.log(`[AI][Phase1] Text extraction complete: ${extractedPageTexts.length} page(s) extracted`);
          } catch (textExtractionError: any) {
            // Text extraction failure should not block the inspection — log and continue
            console.warn(`[AI][Phase1] Text extraction failed (non-fatal): ${textExtractionError.message}`);
          }
        }

        // Include structural debug data when debug mode is enabled.
        let _emitDebugInfo: boolean = !!debug;
        if (_emitDebugInfo) {
          const debugInfo: Record<string, any> = reportNew.debug_info
            ? JSON.parse(reportNew.debug_info) : {};
          debugInfo.pages_info = sourcePages.map((p, i) => ({
            page_index: i,
            width: p.width,
            height: p.height,
            original_width: p.original_width,
            original_height: p.original_height,
            scaling_factor: p.scaling_factor,
            crop_offset_x: (p as IPageInfoExtended).crop_offset_x || 0,
            crop_offset_y: (p as IPageInfoExtended).crop_offset_y || 0,
            content_bounding_box: (p as IPageInfoExtended).content_bounding_box || null,
            grid_mode: (p as IPageInfoExtended).gridMode || effectiveGridMode || 'unknown',
            content_boxes_count: (p as IPageInfoExtended).content_boxes?.length || 0,
            content_boxes: (p as IPageInfoExtended).content_boxes || [],
          }));
          debugInfo.checks_with_positions = checksWithPositions.map(c => ({
            id: c.id,
            page: c.page,
            passed: c.passed,
            description: c.description,
            x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2,
            description_position: c.description_position,
          }));
          reportNew.debug_info = JSON.stringify(debugInfo);
        }

        // Generate debug overlay images if debug mode is enabled
        if (_emitDebugInfo) {
          try {
            console.debug("inspectInput: generating debug overlay images...");
            const debugOverlayImages = await overlayChecksOnGridImages(sourcePages, checksWithPositions, rawAICoordsById, model_config.ai_coord_scale || 0);
            const debugInfo: Record<string, any> = reportNew.debug_info
              ? JSON.parse(reportNew.debug_info) : {};
            debugInfo.debug_overlay_images = debugOverlayImages;
            debugInfo.grid_mode = sourcePages[0]?.gridMode || effectiveGridMode || 'unknown';
            reportNew.debug_info = JSON.stringify(debugInfo);
            console.debug("inspectInput: debug overlay images generated", debugOverlayImages.length);
          } catch (debugErr) {
            console.error("inspectInput: failed to generate debug overlay images", debugErr);
          }
        }

        // output to the console (in the debug mode) information about the checks

        // Compute per-page coordinate space dimensions (always, for every page).
        // This is the single source of truth for the coordinate space that check coordinates live in.
        // Keys MUST be absolute 0-based document page indices (i + pageNumberOffset). Using
        // batch-local indices would make every batch overwrite the previous batch's entries
        // when Rails merges them via merge_batch_page_layout.
        const page_coordinate_spaces: Record<string, { width: number; height: number }> = {};
        const page_types: Record<string, string> = {};
        for (let i = 0; i < sourcePages.length; i++) {
          const absoluteIdx = i + pageNumberOffset;
          const sp = sourcePages[i] as IPageInfoExtended;
          const { pageWidth, pageHeight, cropOffX, cropOffY, contentWidth, contentHeight } = getPageDocumentDimensions(sp);
          console.debug(`inspectInput: page ${absoluteIdx} (local ${i}) dims: width=${sp.width}, height=${sp.height}, sf=${sp.scaling_factor}, cropOffX=${sp.crop_offset_x}, cropOffY=${sp.crop_offset_y}, orig_w=${sp.original_width}, orig_h=${sp.original_height} → pageW=${pageWidth}, pageH=${pageHeight}, contentW=${contentWidth}, contentH=${contentHeight}`);
          page_coordinate_spaces[String(absoluteIdx)] = { width: pageWidth, height: pageHeight };
          page_types[String(absoluteIdx)] = sp.page_type || 'unknown';
        }
        (reportNew as any).page_coordinate_spaces = page_coordinate_spaces;
        (reportNew as any).page_types = page_types;
        (reportNew as any).page_statuses = page_statuses;
        console.debug("inspectInput: page_coordinate_spaces", JSON.stringify(page_coordinate_spaces));
        console.debug("inspectInput: page_types", JSON.stringify(page_types));

        return reportNew;
      } catch (error: any) {
        console.error(`ERROR: inspectInput [model=${model_config.id}, base_url=${model_config.base_url}]`, error?.status, error?.message);
        throw error;
      }
    }
    catch (error: any) {
      console.error(`ERROR: inspectInput [model=${model_config.id}, base_url=${model_config.base_url}]`, error?.status, error?.message);
      throw error;
    }
  },
  // optimizing highlights placements to avoid overlaps by shifting highlights where overlapping
  convertCheckLocationsFromAICoordinatesToEnvelopeCoordinates: (
    sourcePages: IPageInfo[],
    checks: ICheck[],
    ai_coord_scale: number = 0,
    pageNumberOffset: number = 0,
  ): ICheck[] => {
    // first of all we normalize .page numbers to be 0-based
    // AI returns 1-based absolute page labels; subtract offset + 1 to get 0-based index into sourcePages
    for (let i: number = 0; i < checks.length; i++) {
      checks[i].page -= (1 + pageNumberOffset);
    }

    // Remap checks whose target sourcePage is a blank placeholder (1x1) to the nearest
    // non-blank page in the batch. This handles AI hallucinations where the model returns
    // page=N for "not present" rules, where page N happens to be a blank page that was
    // compressed by compressEmptyImagesInPages. Without this remap, coord conversion uses
    // the 1x1 dimensions and produces degenerate coords (0,0,~0,~0) that the min-size
    // enforcement later bumps to (0,0,15,15) — the "all checks in a small area" bug.
    const isBlankSourcePage = (p: IPageInfoExtended | undefined): boolean =>
      !!p && p.width <= 1 && p.height <= 1;
    // Precompute the list of non-blank page indices once so the remap is O(checks).
    const nonBlankIndices: number[] = [];
    for (let i = 0; i < sourcePages.length; i++) {
      if (!isBlankSourcePage(sourcePages[i] as IPageInfoExtended)) nonBlankIndices.push(i);
    }
    if (nonBlankIndices.length > 0) {
      for (const check of checks) {
        if (check.page < 0 || check.page >= sourcePages.length) continue;
        const target = sourcePages[check.page] as IPageInfoExtended;
        if (isBlankSourcePage(target)) {
          // Nearest non-blank by absolute distance from the hallucinated index.
          let bestIdx = nonBlankIndices[0];
          let bestDist = Math.abs(bestIdx - check.page);
          for (const idx of nonBlankIndices) {
            const d = Math.abs(idx - check.page);
            if (d < bestDist) { bestIdx = idx; bestDist = d; }
          }
          console.debug(`convertCheckLocationsFromAICoordinates: remapping check from blank page ${check.page} to nearest non-blank page ${bestIdx}`);
          check.page = bestIdx;
        }
      }
    }

    // If AI returns normalized coordinates (e.g., 0-1000), convert to pixel space first
    if (ai_coord_scale > 0) {
      for (const check of checks) {
        const page = sourcePages[check.page] as IPageInfoExtended;
        if (!page) continue;

        const config = getGridModeConfig(page.gridMode || EGridMode.NONE);
        const margins = resolveMargins(config, page.width, page.height);

        if (config.aiSeesMargins) {
          // AI sees canvas with added margins — convert from normalized space → canvas pixels → content pixels.
          const canvasW = page.width + margins.left + margins.right;
          const canvasH = page.height + margins.top + margins.bottom;
          check.x1 = Math.round(check.x1 / ai_coord_scale * canvasW - margins.left);
          check.y1 = Math.round(check.y1 / ai_coord_scale * canvasH - margins.top);
          check.x2 = Math.round(check.x2 / ai_coord_scale * canvasW - margins.left);
          check.y2 = Math.round(check.y2 / ai_coord_scale * canvasH - margins.top);
        } else {
          // AI coords map directly to content dimensions
          check.x1 = Math.round(check.x1 / ai_coord_scale * page.width);
          check.y1 = Math.round(check.y1 / ai_coord_scale * page.height);
          check.x2 = Math.round(check.x2 / ai_coord_scale * page.width);
          check.y2 = Math.round(check.y2 / ai_coord_scale * page.height);
        }

        // Clamp to non-negative
        check.x1 = Math.max(0, check.x1);
        check.y1 = Math.max(0, check.y1);
        check.x2 = Math.max(0, check.x2);
        check.y2 = Math.max(0, check.y2);

      }
    }

    // Modes where AI sees margins with raw pixel coords (ai_coord_scale == 0): subtract margins directly
    if (ai_coord_scale === 0) {
      for (const check of checks) {
        const page = sourcePages[check.page] as IPageInfoExtended;
        if (!page) continue;
        const config = getGridModeConfig(page.gridMode || EGridMode.NONE);
        if (!config.aiSeesMargins) continue;

        const margins = resolveMargins(config, page.width, page.height);
        check.x1 -= margins.left;
        check.y1 -= margins.top;
        check.x2 -= margins.left;
        check.y2 -= margins.top;

        // Clamp to non-negative (in case AI reported coords near the margin area)
        check.x1 = Math.max(0, check.x1);
        check.y1 = Math.max(0, check.y1);
        check.x2 = Math.max(0, check.x2);
        check.y2 = Math.max(0, check.y2);

      }
    }

    // Coordinate normalization: AI reports coordinates in pixel space of the
    // cropped image. Reverse-map to document space:
    //   orig_coord = crop_offset + ai_pixel / scaling_factor
    for (const check of checks) {
      const page = sourcePages[check.page] as IPageInfoExtended;
      if (!page) continue;

      const sf = page.scaling_factor;
      const cropX = page.crop_offset_x || 0;
      const cropY = page.crop_offset_y || 0;


      check.x1 = Math.round(cropX + check.x1 / sf);
      check.y1 = Math.round(cropY + check.y1 / sf);
      check.x2 = Math.round(cropX + check.x2 / sf);
      check.y2 = Math.round(cropY + check.y2 / sf);

    }

    // now count how many checks we have on each page
    const checksPerPage: number[] = [];
    for (let i: number = 0; i < checks.length; i++) {
      checksPerPage[checks[i].page] =
        (checksPerPage[checks[i].page] || 0) + 1;
    }

    // now calculate max allowed highlight size for each page
    const allowedSizesPerPage = sourcePages.map(
      (pageInfo: IPageInfo) => {
        const { pageWidth, pageHeight } = getPageDocumentDimensions(pageInfo as IPageInfoExtended);
        return {
          width: Math.round(
            pageWidth *
            MAX_ALLOWED_HIGHLIGHT_SIZE_WIDTH_IN_PERCENTAGE,
          ),
          height: Math.round(
            pageHeight *
            MAX_ALLOWED_HIGHLIGHT_SIZE_HEIGHT_IN_PERCENTAGE,
          ),
          xShiftToAvoidOverlap: Math.round(
            Math.max(
              10,
              Math.round(
                pageWidth *
                MAX_ALLOWED_HIGHLIGHT_SIZE_WIDTH_IN_PERCENTAGE,
              ) / 20,
            ),
          ),
          yShiftToAvoidOverlap: Math.round(
            Math.max(
              10,
              Math.round(
                pageHeight *
                MAX_ALLOWED_HIGHLIGHT_SIZE_HEIGHT_IN_PERCENTAGE,
              ) / 20,
            ),
          ),
        };
      },
    );

    // now got through checks and adjust ones that are on this page
    checks.forEach((check: ICheck) => {
      // normalizing coordinates in case they are flipped
      check.x1 = Math.min(
        check.x1,
        check.x2,
      );
      check.y1 = Math.min(
        check.y1,
        check.y2,
      );
      check.x2 = Math.max(
        check.x1,
        check.x2,
      );
      check.y2 = Math.max(
        check.y1,
        check.y2,
      );

      const checksCountOnPage = checksPerPage[check.page];
      const allowedSize = allowedSizesPerPage[check.page];

      // Cap highlight size to max allowed percentage of page (all pages)
      if (getWidth(check) >= allowedSize.width) {
        check.x2 =
          check.x1 + allowedSize.width;
      }
      else if (
        getWidth(check) <
        MIN_ALLOWED_HIGHLIGHT_SIZE_WIDTH
      ) {
        check.x2 =
          check.x1 + MIN_ALLOWED_HIGHLIGHT_SIZE_WIDTH;
      }

      if (getHeight(check) >= allowedSize.height) {
        check.y2 =
          check.y1 + allowedSize.height;
      }
      else if (
        getHeight(check) <
        MIN_ALLOWED_HIGHLIGHT_SIZE_HEIGHT
      ) {
        check.y2 =
          check.y1 + MIN_ALLOWED_HIGHLIGHT_SIZE_HEIGHT;
      }

      // Boundary clamping — all pages
      check.x1 = Math.max(
        0,
        check.x1,
      );
      check.y1 = Math.max(
        0,
        check.y1,
      );
      check.x2 = Math.min(
        check.x1 + allowedSize.width,
        check.x2,
      );
      check.y2 = Math.min(
        check.y1 + allowedSize.height,
        check.y2,
      );

      // Ensure highlight is not too small (enforce minimum dimensions)
      if (getWidth(check) < MIN_ALLOWED_HIGHLIGHT_SIZE_WIDTH) {
        check.x2 = check.x1 + MIN_ALLOWED_HIGHLIGHT_SIZE_WIDTH;
      }
      if (getHeight(check) < MIN_ALLOWED_HIGHLIGHT_SIZE_HEIGHT) {
        check.y2 = check.y1 + MIN_ALLOWED_HIGHLIGHT_SIZE_HEIGHT;
      }
    });

    // Crop highlights to content boxes and cap partial-width highlights.
    for (const check of checks) {
      const page = sourcePages[check.page] as IPageInfoExtended;
      const pageContentBoxes = page?.content_boxes || [];
      const { pageWidth } = getPageDocumentDimensions(page);
      if (pageContentBoxes.length > 0) {
        const cropped = cropCheckToContentBoxes(check, pageContentBoxes, pageWidth, CONTENT_BOX_CROP_MARGIN);
        check.x1 = cropped.x1;
        check.y1 = cropped.y1;
        check.x2 = cropped.x2;
        check.y2 = cropped.y2;
      }
    }

    // Magnet checks from empty areas to nearest content boxes (per page)
    const checksByPageForMagnet = new Map<number, ICheck[]>();
    for (const check of checks) {
      if (!checksByPageForMagnet.has(check.page)) checksByPageForMagnet.set(check.page, []);
      checksByPageForMagnet.get(check.page)!.push(check);
    }
    for (const [pageIdx, pageChecks] of checksByPageForMagnet) {
      const page = sourcePages[pageIdx] as IPageInfoExtended;
      const pageContentBoxes = page?.content_boxes || [];
      const { pageWidth } = getPageDocumentDimensions(page);
      if (pageContentBoxes.length > 0) {
        ai.magnetChecksFromEmptyAreaToNearestContentBox(pageChecks, pageContentBoxes, pageWidth);
      }
    }

    // Restore absolute 0-based page numbers when processing a batch with offset.
    // Earlier in this function we decremented check.page by (1 + pageNumberOffset) so
    // sourcePages[check.page] indexed correctly into the batch's local array. Now that
    // coordinate conversion and layout work are done, bring each check's page back to
    // the absolute 0-based document page so Rails persists the correct page and the
    // next batch's prior_batch_findings displays correct absolute page numbers.
    if (pageNumberOffset > 0) {
      for (const check of checks) {
        check.page += pageNumberOffset;
      }
    }

    // finally return the checks with normalized page numbers and coordinates
    return checks;
  },

  /**
   * Move checks that landed in empty space (no content box overlap) to the
   * nearest content box not already covered by another check in the same
   * pass/fail group.  Mutates checks in-place.
   */
  magnetChecksFromEmptyAreaToNearestContentBox: (
    checks: ICheck[],
    contentBoxes: IContentBox[],
    pageWidth: number,
  ): void => {
    const MAGNET_MAX_H_DIST = 200;
    const MAGNET_MAX_V_DIST = 100;
    const MIN_Y_OVERLAP_PCT = 0.3;

    if (contentBoxes.length === 0 || checks.length === 0) return;

    const failedChecks = checks.filter(c => !c.passed);
    const passedChecks = checks.filter(c => c.passed);
    const movedChecks = new Set<ICheck>();

    for (const check of checks) {
      // Step 1: Skip if already overlaps any content box
      const overlapsContent = contentBoxes.some(cb =>
        cb.x1 < check.x2 && cb.x2 > check.x1 &&
        cb.y1 < check.y2 && cb.y2 > check.y1
      );
      if (overlapsContent) continue;

      // Step 2: Find nearest content box
      const sameGroupChecks = check.passed ? passedChecks : failedChecks;
      let bestCb: IContentBox | null = null;
      let bestDist = Infinity;

      for (const cb of contentBoxes) {
        const checkHeight = check.y2 - check.y1;
        const yOverlap = Math.max(0, Math.min(check.y2, cb.y2) - Math.max(check.y1, cb.y1));
        const yOverlapPct = checkHeight > 0 ? yOverlap / checkHeight : 0;

        let hDist = 0;
        if (cb.x2 <= check.x1) hDist = check.x1 - cb.x2;
        else if (cb.x1 >= check.x2) hDist = cb.x1 - check.x2;

        let vDist = 0;
        if (cb.y2 <= check.y1) vDist = check.y1 - cb.y2;
        else if (cb.y1 >= check.y2) vDist = cb.y1 - check.y2;

        if (yOverlapPct >= MIN_Y_OVERLAP_PCT) {
          if (hDist > MAGNET_MAX_H_DIST) continue;
        } else {
          const xOverlap = Math.max(0, Math.min(check.x2, cb.x2) - Math.max(check.x1, cb.x1));
          if (xOverlap <= 0) continue;
          if (vDist > MAGNET_MAX_V_DIST) continue;
        }

        // Step 3: Target not already covered by same group
        const isCovered = sameGroupChecks.some(other =>
          other !== check &&
          cb.x1 < other.x2 && cb.x2 > other.x1 &&
          cb.y1 < other.y2 && cb.y2 > other.y1
        );
        if (isCovered) continue;

        const totalDist = hDist + vDist * 2.0;
        if (totalDist < bestDist) {
          bestDist = totalDist;
          bestCb = cb;
        }
      }

      // Step 4: Move check to content box
      if (bestCb) {
        movedChecks.add(check);
        check.x1 = bestCb.x1;
        check.y1 = bestCb.y1;
        check.x2 = bestCb.x2;
        check.y2 = bestCb.y2;
      }
    }

    // Step 5: Re-crop only MOVED checks (magnetized ones now overlap content)
    // Non-magnetized checks were already properly cropped — re-cropping them would double-narrow
    for (const check of movedChecks) {
      const cropped = cropCheckToContentBoxes(check, contentBoxes, pageWidth, CONTENT_BOX_CROP_MARGIN);
      check.x1 = cropped.x1;
      check.y1 = cropped.y1;
      check.x2 = cropped.x2;
      check.y2 = cropped.y2;
    }
  },

  /**
   * Compute pre-computed description label positions for all checks.
   * Groups checks by page, normalizes coordinates to a reference width (~612pt, matching
   * PDF point space where the placer's fixed-pixel constants work well), runs placeCheckLabels,
   * then denormalizes label positions back to document space.
   *
   * @param pageNumberOffset 0-based absolute page offset of this batch's first
   *   sourcePage. check.page is already absolute (batch-offset added back in
   *   convertCheckLocationsFromAICoordinatesToEnvelopeCoordinates), so we
   *   subtract the offset here to get a local index into sourcePages.
   */
  computeDescriptionPositions: (
    sourcePages: IPageInfo[],
    checks: ICheck[],
    pageFontScales?: Record<number, number>,
    pageNumberOffset: number = 0,
  ): ICheck[] => {
    // Group checks by page (absolute document-level indices)
    const checksByPage = new Map<number, ICheck[]>();
    for (const check of checks) {
      const page = check.page ?? 0;
      if (!checksByPage.has(page)) checksByPage.set(page, []);
      checksByPage.get(page)!.push(check);
    }

    for (const [pageIndex, pageChecks] of checksByPage) {
      // Translate absolute document page index → local index in this batch's
      // sourcePages array. Skip any check whose page isn't in this batch.
      const localPageIndex = pageIndex - pageNumberOffset;
      if (localPageIndex < 0 || localPageIndex >= sourcePages.length) continue;
      const page = sourcePages[localPageIndex] as IPageInfoExtended;
      const { pageWidth, pageHeight } = getPageDocumentDimensions(page);

      // Sort by visual center position: center Y ascending, center X ascending, check_index ascending
      const sortByVisualLocation = (a: ICheck, b: ICheck) =>
        compareByVisualPosition(a, b);

      const validChecks = [...pageChecks]
        .filter(c => c.x1 != null && c.y1 != null && c.x2 != null && c.y2 != null);

      if (validChecks.length === 0) continue;

      const fontScale = pageFontScales?.[pageIndex] ?? 1.0;
      const REVDOKU_HINT_LABEL_WIDTH = 200;
      const labelWidth = Math.max(REVDOKU_MIN_HINT_LABEL_WIDTH, REVDOKU_HINT_LABEL_WIDTH);
      const labelX = pageWidth + REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING;

      // Compute positions for failed and passed groups independently.
      // Each group starts at Y=gap so labels are correctly positioned when
      // the frontend displays a single group (e.g. "Issues & changes" filter).
      // When the frontend shows "All", autoRepositionLabels merges both groups.
      const failedChecks = validChecks.filter(c => !c.passed).sort(sortByVisualLocation);
      const passedChecks = validChecks.filter(c => c.passed).sort(sortByVisualLocation);

      for (const group of [failedChecks, passedChecks]) {
        let nextY = REVDOKU_MARGIN_LABEL_VERTICAL_GAP;
        for (const check of group) {
          const dims = estimateWrappedLabelDimensions(
            check.description || '',
            labelWidth,
            REVDOKU_MARGIN_LABEL_FONT_SIZE * fontScale,
            REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
            REVDOKU_MARGIN_LABEL_INNER_PADDING * fontScale,
            REVDOKU_LAYOUT_LABEL_MAX_LINES,
          );

          check.description_position = {
            box: {
              x: Math.round(labelX),
              y: Math.round(nextY),
              width: Math.round(dims.width),
              height: Math.round(dims.height),
            },
          } as ICheckDescriptionPosition;

          nextY += dims.height + REVDOKU_MARGIN_LABEL_VERTICAL_GAP;
        }
      }

      if (process.env.NODE_ENV !== 'production') {
        console.debug(JSON.stringify({
          msg: 'computeDescriptionPositions',
          absolutePage: pageIndex,
          localPage: localPageIndex,
          pageNumberOffset,
          pageWidth, pageHeight,
          fontScale,
          checksCount: pageChecks.length,
          positions: pageChecks.map(c => ({
            id: c.id,
            y: c.description_position?.box?.y,
            h: c.description_position?.box?.height,
          })),
        }));
      }
    }

    return checks;
  },
};

/**
 * Sort checks by visual position and assign sequential check_index values,
 * skipping any reserved indices (used by preserved user checks).
 */
export function sortAndAssignCheckIndices(
  checks: ICheckForReindex[],
  reserved_check_indices: number[] = [],
): Array<{ id: string; check_index: number }> {
  const sorted = [...checks].sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? 1 : -1;
    if (a.page !== b.page) return a.page - b.page;
    return compareByVisualPosition(a, b);
  });
  const reservedSet = new Set(reserved_check_indices);
  const maxCheckIndex = reservedSet.size + sorted.length + 1;
  let nextIndex = 1;
  return sorted.map((check) => {
    while (reservedSet.has(nextIndex) && nextIndex < maxCheckIndex) nextIndex++;
    return { id: check.id, check_index: nextIndex++ };
  });
}
