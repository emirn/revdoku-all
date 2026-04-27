// AI model utilities — stateful lookup layer on top of shared formatting functions.
// Pure formatting functions live in @revdoku/lib.

import {
  formatModelDisplayLabel,
  formatModelOptionLabel,
  starRating,
} from '@revdoku/lib';
import type { IAIModelOption } from '@revdoku/lib';

// Re-export shared types and formatters so existing imports keep working
export type { IAIModelOption };
export { starRating, formatModelOptionLabel, formatModelDisplayLabel };

// Models loaded from API — set by components that fetch them
let _loadedModels: IAIModelOption[] = [];
let _loadedAliases: IAIModelOption[] = [];
let _defaultModelId: string | undefined;
let _defaultChecklistGenModelId: string | undefined;
let _defaultTextExtractionModelId: string | undefined;

export const setLoadedModels = (
  models: IAIModelOption[],
  defaultModelId?: string,
  defaultChecklistGenModelId?: string,
  defaultTextExtractionModelId?: string,
  aliases: IAIModelOption[] = [],
) => {
  _loadedModels = models;
  _loadedAliases = aliases;
  if (defaultModelId) _defaultModelId = defaultModelId;
  if (defaultChecklistGenModelId) _defaultChecklistGenModelId = defaultChecklistGenModelId;
  if (defaultTextExtractionModelId) _defaultTextExtractionModelId = defaultTextExtractionModelId;
};

export const getLoadedModels = (): IAIModelOption[] => _loadedModels;

// Region-scoped aliases with in-region fallback. Components surface
// aliases at the top of the model picker above concrete models.
export const getLoadedAliases = (): IAIModelOption[] => _loadedAliases;

export const getDefaultModelId = (): string | undefined => _defaultModelId;

export const getDefaultChecklistGenerationModelId = (): string | undefined => _defaultChecklistGenModelId;

// The account's resolved text-extraction model id (account override →
// ai_models.yml default `<region>:basic`). Used by the Review dialog to
// compute an accurate credit estimate when track-changes is on.
export const getDefaultTextExtractionModelId = (): string | undefined => _defaultTextExtractionModelId;

// Single source of truth for what the model picker (Default tab, Review
// dialog, Checklist dialog, AI selector) should show. Rules:
//
//   - Show every alias (built-in catalog aliases — the friendly fallback
//     entries the picker leads with).
//   - Show user-defined Custom-LLM models (entries on providers flagged
//     `custom: true` — these are the user's own aliases for upstream
//     model ids and have no built-in alias counterpart).
//   - Hide cloud-provider concrete models (GPT-4.1, o4-mini, Gemini 3.1
//     Flash, etc.) — these exist purely as alias targets and shouldn't
//     surface as their own picker rows.
//
// Pass the providers payload from /api/v1/ai_models so we can look up the
// `custom` flag per provider; pass null/undefined to skip the custom-LLM
// pass-through (useful for tests or contexts that don't care).
export interface PickerOptionsInput {
  aliases?: IAIModelOption[];
  models?: IAIModelOption[];
  providers?: Array<{ provider_key: string; custom?: boolean }>;
}

export const buildPickerOptions = (input: PickerOptionsInput): IAIModelOption[] => {
  const aliases = input.aliases || [];
  const models = input.models || [];
  const customProviderKeys = new Set(
    (input.providers || []).filter((p) => p.custom).map((p) => p.provider_key),
  );
  const customModels = models.filter(
    (m) => !!m.provider && customProviderKeys.has(m.provider),
  );
  return [...aliases, ...customModels];
};

export const getModelDisplayName = (modelId: string | undefined): string => {
  if (!modelId) return 'N/A';
  const model = _loadedModels.find(m => m.id === modelId);
  return model?.name || modelId;
};

export const getModelDisplayLabel = (modelId: string | undefined): string | null => {
  if (!modelId) return null;
  const model = _loadedModels.find(m => m.id === modelId);
  return formatModelDisplayLabel(model);
};

export const getModelConfig = (modelId: string | undefined): IAIModelOption | undefined => {
  if (!modelId) return undefined;
  return _loadedModels.find(m => m.id === modelId);
};

export const getSelectedModelDescription = (modelId: string | undefined, models: IAIModelOption[]): string | undefined => {
  if (!modelId) return undefined;
  return models.find(m => m.id === modelId)?.description;
};
