import { useState, useEffect } from 'react';
import { Pencil, Loader2, ArrowLeft, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { getLoadedModels, getDefaultChecklistGenerationModelId, setLoadedModels, formatModelOptionLabel, buildPickerOptions } from '@/lib/ai-model-utils';
import { ApiClient } from '@/lib/api-client';
import type { IAIModelOption } from '@/lib/ai-model-utils';
import AiModelInfoCard from '@/components/envelope-page/AiModelInfoCard';

const LS_KEY = 'revdoku_last_checklist_gen_model';

interface AIModelSelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (modelId: string | null) => void; // null = "Manually, no AI"
  onBack?: () => void; // Go back to previous dialog
  isProcessing?: boolean;
  title?: string;
  description?: string;
  showManualOption?: boolean;
  defaultModelId?: string;
  purpose?: 'checklist_generation' | 'inspection';
}

export default function AIModelSelectionDialog({
  isOpen,
  onClose,
  onSelect,
  onBack,
  isProcessing = false,
  title,
  description,
  showManualOption = true,
  defaultModelId,
  purpose = 'checklist_generation',
}: AIModelSelectionDialogProps) {
  const [mode, setMode] = useState<'manual' | 'ai'>('ai');
  const [selected, setSelected] = useState<string>('');
  // Always start empty — the dialog re-fetches via buildPickerOptions on
  // open. Seeding from getLoadedModels() leaks the raw concrete-models
  // cache into the picker (see useEffect below).
  const [models, setModels] = useState<IAIModelOption[]>([]);

  // Fetch models every time the dialog opens. We can't use the cached
  // `_loadedModels` value as a shortcut because that cache stores the
  // raw `res.models` array (used by splash screens for label lookup),
  // not the picker-filtered list — so seeding from it would render
  // every cloud-provider concrete model alongside the aliases.
  useEffect(() => {
    if (!isOpen) return;
    ApiClient.getModels()
      .then(res => {
        const fetched = res.models || [];
        const aliases = res.aliases || [];
        setLoadedModels(fetched, res.default_model_id, res.default_checklist_generation_model_id, res.default_text_extraction_model_id, aliases);
        // Picker shows aliases + Custom-LLM models only; cloud concrete
        // models stay hidden because they're alias targets, not first-
        // class picker rows.
        setModels(buildPickerOptions({ aliases, models: fetched, providers: res.providers }));
      })
      .catch(() => {});
  }, [isOpen]);

  // Determine default selection when dialog opens or models change
  useEffect(() => {
    if (!isOpen || models.length === 0) return;
    const enabledModels = models.filter(m => !m.disabled);

    // Priority: prop > localStorage > API default > first enabled
    const fromProp = defaultModelId;
    let fromLs: string | null = null;
    try { fromLs = localStorage.getItem(LS_KEY); } catch {}
    const fromApi = getDefaultChecklistGenerationModelId();
    const firstEnabled = enabledModels[0]?.id;

    const candidates = [fromProp, fromLs, fromApi, firstEnabled].filter(Boolean);
    const chosen = candidates.find(id => models.some(m => m.id === id && !m.disabled));

    setSelected(chosen || firstEnabled || '');
    setMode('ai'); // Default to AI mode
  }, [isOpen, defaultModelId, models]);
  const isChecklist = purpose === 'checklist_generation';

  const dialogTitle = title || (isChecklist ? 'Create a checklist' : 'Select AI Model');
  const dialogDescription = description || (isChecklist
    ? 'Choose how to create your checklist'
    : 'Choose an AI model');

  const selectedModel = models.find(m => m.id === selected);

  const handleProceed = () => {
    if (mode === 'manual') {
      onSelect(null);
    } else {
      // Persist selection for AI models
      if (selected) {
        try { localStorage.setItem(LS_KEY, selected); } catch {}
        // Fire-and-forget API call
        ApiClient.updateAiPreferences({ default_checklist_generation_model: selected }).catch(() => {});
      }
      onSelect(selected || null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isProcessing && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2">
          {/* Edit manually option */}
          {showManualOption && (
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => setMode('manual')}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                mode === 'manual'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30'
              )}
            >
              <div
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                  mode === 'manual'
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground/40'
                )}
              >
                {mode === 'manual' && (
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                )}
              </div>
              <div className="flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Edit manually</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Create from your text manually, use AI for rules later
                </p>
              </div>
            </button>
          )}

          {/* Generate with AI option */}
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => setMode('ai')}
            className={cn(
              'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
              mode === 'ai'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/30'
            )}
          >
            <div
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                mode === 'ai'
                  ? 'border-primary bg-primary'
                  : 'border-muted-foreground/40'
              )}
            >
              {mode === 'ai' && (
                <div className="h-1.5 w-1.5 rounded-full bg-white" />
              )}
            </div>
            <div className="flex-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium">Generate with AI</span>
              </div>
              <p className="text-xs text-muted-foreground">
                AI will analyze your text and generate structured checklist rules
              </p>
            </div>
          </button>

          {/* Model dropdown + info card when AI mode is selected */}
          {mode === 'ai' && (
            <div className="space-y-2 pt-1 ml-7">
              <label className="text-sm font-medium text-foreground">Select AI to use:</label>
              <Select
                value={selected}
                onValueChange={setSelected}
                disabled={isProcessing}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select AI model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id} disabled={model.disabled}>
                      {formatModelOptionLabel(model)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedModel && (
                <AiModelInfoCard model={selectedModel} />
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            {onBack && (
              <Button
                variant="ghost"
                onClick={onBack}
                disabled={isProcessing}
                className="text-muted-foreground"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleProceed}
            disabled={isProcessing}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Proceed'
            )}
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
