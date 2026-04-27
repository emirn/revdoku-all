import type { IAIModelOption } from "@/lib/ai-model-utils";
import { starRating } from "@/lib/ai-model-utils";
import { AI_DISCLAIMER } from "@/lib/constants";
import { Info } from "lucide-react";

const providerLabel = (provider: string): string => {
  const labels: Record<string, string> = {
    "google": "Google",
    "google-hipaa": "Google",
    "openrouter": "OpenRouter",
    "openai": "OpenAI",
    "aws-bedrock": "AWS",
    "lm-studio": "Local",
  };
  return labels[provider] || provider.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
};

export default function AiModelInfoCard({ model, showModelName = false, showActualModel = false, showRating = false, showLocation = false, showPricing = true, compact = false }: { model: IAIModelOption; showModelName?: boolean; showActualModel?: boolean; showRating?: boolean; showLocation?: boolean; showPricing?: boolean; compact?: boolean }) {
  const credits = model.credits_per_page ?? 10;

  if (compact) {
    return (
      <div className="text-xs text-muted-foreground text-center">
        <span className="font-medium text-foreground">{model.name}</span>
        {model.stars != null && <span className="text-amber-500 ml-1.5">{starRating(model.stars)}</span>}
        {model.hipaa && (
          <span className="inline-flex items-center px-1 py-0 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ml-1.5">
            HIPAA
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="text-left rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-xs overflow-hidden px-3 py-2">
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {showModelName && (
          <>
            <span className="text-muted-foreground">AI:</span>
            <span className="font-medium text-foreground">{model.name}</span>
          </>
        )}
        {showActualModel && model.actual_model_id && (
          <>
            <span className="text-muted-foreground">Current model:</span>
            <span className="text-muted-foreground">
              {model.model_name && <span className="text-foreground">{model.model_name}</span>}
              {model.model_name && ' '}
              <span className="font-mono">({model.actual_model_id})</span>
            </span>
          </>
        )}
        {showRating && (
          <>
            <span className="text-muted-foreground">Rating:</span>
            <span className="flex items-center gap-1.5 flex-wrap">
              <span className="text-amber-500">{starRating(model.stars)}</span>
              {showPricing && <span className="text-muted-foreground">&middot; {credits} cr/page</span>}
              {/* {showPricing && model.max_pages && (
                <span className="text-muted-foreground">&middot; up to {model.max_pages} pages</span>
              )} */}
              {model.hipaa && (
                <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  HIPAA
                </span>
              )}
            </span>
          </>
        )}
        {showLocation && model.dev_only && (model.provider || model.location) && (
          <>
            <span className="text-muted-foreground">Provider:</span>
            <span className="text-foreground">
              {[model.provider && providerLabel(model.provider), model.location].filter(Boolean).join(', ')}
            </span>
          </>
        )}
        {/* Alias fallback chain — one row per provider the alias will try,
            in resolution order. Each provider shows its name, the upstream
            model id this alias targets at that provider, and a red "not
            configured" tag when the provider has no API key set. */}
        {Array.isArray(model.providers) && model.providers.length > 0 && (() => {
          // Pair each provider with the FIRST target id whose provider
          // segment matches. The id shape is "<region>:<provider>:<model>"
          // (model itself may contain colons, e.g. "openai/o4-mini" on
          // OpenRouter), so we split only on the first two colons.
          const targets = Array.isArray(model.targets) ? model.targets : [];
          const modelIdForProvider = (providerKey: string): string | null => {
            const hit = targets.find((t) => {
              const parts = t.split(':');
              return parts.length >= 3 && parts[1] === providerKey;
            });
            if (!hit) return null;
            const parts = hit.split(':');
            return parts.length >= 3 ? parts.slice(2).join(':') : null;
          };
          return (
            <>
              <span className="text-muted-foreground">Providers:</span>
              <span className="flex items-center gap-1.5 flex-wrap">
                {model.providers!.map((p, idx) => {
                  const mid = modelIdForProvider(p.key);
                  return (
                    <span key={p.key} className="inline-flex items-center gap-1 flex-wrap">
                      <span className={p.configured ? "text-foreground" : "text-muted-foreground/70"}>
                        {p.name}
                      </span>
                      {mid && (
                        <span className="font-mono text-[10px] text-muted-foreground select-all">({mid})</span>
                      )}
                      {!p.configured && (
                        <span className="inline-flex items-center px-1 py-0 rounded text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                          not configured
                        </span>
                      )}
                      {idx < model.providers!.length - 1 && (
                        <span className="text-muted-foreground/60">→</span>
                      )}
                    </span>
                  );
                })}
              </span>
            </>
          );
        })()}
        <span className="text-muted-foreground flex items-center"><Info className="h-3 w-3" /></span>
        <span className="text-muted-foreground">{model.description ? `${model.description} ${AI_DISCLAIMER}` : AI_DISCLAIMER}</span>
      </div>
    </div>
  );
}
