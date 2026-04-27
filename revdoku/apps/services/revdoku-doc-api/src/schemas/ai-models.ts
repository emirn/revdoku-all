// AI models ================================================
// NOTE: Rails is the single source of truth for AI model configuration.
// revdoku-doc-api is stateless — model config is sent per-request via IModelConfig.
// This file only contains utility types and functions.

export interface IAIModel {
  id: string;
  name: string;
}

// AI image processing constants for the inspection pipeline
export const AI_IMAGE_MAX_SIDE_SIZE = 768;
/** @deprecated Use per-mode cropMargins in grid-mode-config.ts instead */
export const AI_IMAGE_CROP_MARGINS = true;

