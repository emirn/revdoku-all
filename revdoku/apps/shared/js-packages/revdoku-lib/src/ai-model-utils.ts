// AI model utilities — pure formatters shared between the Rails frontend and
// the revdoku-doc-api service. No stateful lookup here; that layer lives in
// apps/web/app/frontend/src/lib/ai-model-utils.ts (which re-exports these).

export interface IAIModelOption {
  id: string;
  name: string;
  provider?: string;
  provider_name?: string;
  stars?: number;
  badges?: string[];
  available?: boolean;
  disabled?: boolean;
  disabled_text?: string;
  credits_per_page?: number;
  max_pages?: number;
  hipaa?: boolean;
  description?: string;
  description_checklist?: string;
  targets?: string[];
  resolved_id?: string;
  providers?: Array<{ key: string; name: string; configured: boolean }>;
  // Debug / inspection surfaces — populated only by the Debug panel's
  // "show active config" view, never by the picker. Kept optional on the
  // shared type so surface code can drill into what Rails actually sent
  // downstream to doc-api without casting.
  actual_model_id?: string;
  model_name?: string;
  location?: string;
  dev_only?: boolean;
  grid_mode?: string;
  ai_coord_scale?: number;
  max_tokens?: number;
  temperature?: number;
  response_format?: string;
  revdoku_options?: string;
}

export interface IChecklistRuleAiConfig {
  system_prompt?: string;
  max_tokens?: number;
  temperature?: number;
  response_format?: string;
}

export const starRating = (stars: number | undefined): string =>
  '★'.repeat(stars || 1);

/** Format a model as "Name ★★" or null if model is falsy. */
export const formatModelDisplayLabel = (model: IAIModelOption | undefined | null): string | null => {
  if (!model) return null;
  return `${model.name} ${starRating(model.stars)}`;
};

/** Full option label: "Name ★★ [HIPAA]". Credits-per-page is surfaced in
 *  the hint card on deployments that have a credit system — it's kept out
 *  of the dropdown label itself so self-host installs (which don't charge
 *  credits) don't show a "cr/page" number that has no meaning there. */
export const formatModelOptionLabel = (model: IAIModelOption): string => {
  const hipaa = model.hipaa ? ' [HIPAA]' : '';
  const suffix = model.disabled_text ? ` (${model.disabled_text})` : '';
  return `${model.name} ${starRating(model.stars)}${hipaa}${suffix}`;
};
