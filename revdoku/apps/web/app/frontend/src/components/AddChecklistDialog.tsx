
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiClient } from '@/lib/api-client';
import { isChecklistFormat, parseChecklistText } from '@/lib/checklist-parse-utils';
import { Description } from '@radix-ui/react-dialog';
import { ClipboardCheck } from 'lucide-react';

interface ChecklistTemplateOption {
  // prefix_id (ctpl_…) — ChecklistTemplate grew has_prefix_id when the
  // catalog was exposed to the create-checklist picker. Tracking this as
  // a string in the form state means `<option value>` round-trips without
  // `String()` coercion and a future "load full template on click" path
  // can pass the prefix_id to `/api/v1/checklist_templates/:id` directly.
  id: string;
  name: string;
  system_prompt: string | null;
  rules_count: number;
  rules: Array<{ prompt: string; order?: number; title?: string; origin?: string }>;
  user_scripts?: Array<{ id?: string; name?: string; code: string; created_at?: string }>;
  default_for_new_account?: boolean;
}

export interface CreateFromTemplateData {
  name: string;
  system_prompt: string | null;
  rules: Array<{ prompt: string; order: number }>;
  ai_model?: string;
  user_scripts?: Array<{ id: string; name?: string; code: string }>;
}

interface AddChecklistDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (sourceText: string, aiModel?: string) => Promise<boolean | void>;
  onCreateFromTemplate?: (data: CreateFromTemplateData) => Promise<void>;
  onNeedAIModel?: (sourceText: string, includeAgreement?: boolean) => void; // Signals parent to show AI model dialog
  isProcessing: boolean;
  error: string | null;
  mode: 'checklist' | 'rules';
  initialText?: string;
  checklistSourceText?: string; // Original agreement text from the checklist, for "Include original agreement" option
}

const CREATE_NEW_VALUE = '__create_new__';

export default function AddChecklistDialog({
  isOpen,
  onClose,
  onGenerate,
  onCreateFromTemplate,
  onNeedAIModel,
  isProcessing,
  error,
  mode,
  initialText,
  checklistSourceText,
}: AddChecklistDialogProps) {
  const [sourceText, setSourceText] = useState('');
  const [templates, setTemplates] = useState<ChecklistTemplateOption[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>(CREATE_NEW_VALUE);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [includeSourceText, setIncludeSourceText] = useState(true);

  // Fetch templates when dialog opens (only for checklist mode)
  useEffect(() => {
    if (isOpen && mode === 'checklist') {
      setIsLoadingTemplates(true);
      ApiClient.getChecklistTemplates()
        .then(result => {
          const sorted = (result.templates || []).slice().sort((a, b) =>
            (a.name || '').localeCompare(b.name || '')
          );
          setTemplates(sorted);
        })
        .catch(() => setTemplates([]))
        .finally(() => setIsLoadingTemplates(false));
    }
  }, [isOpen, mode]);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSourceText(initialText || '');
      setSelectedTemplate(CREATE_NEW_VALUE);
      setIncludeSourceText(true);
    }
  }, [isOpen, initialText]);

  const isCreateNew = selectedTemplate === CREATE_NEW_VALUE;
  const selectedTemplateData = templates.find(t => t.id === selectedTemplate);

  const handleCreateEmpty = async () => {
    if (!onCreateFromTemplate) return;
    await onCreateFromTemplate({
      name: 'Untitled',
      system_prompt: null,
      rules: [],
    });
  };

  const handleSubmit = async () => {
    if (!isCreateNew && selectedTemplateData && onCreateFromTemplate) {
      // Create from template — templates carry everything their source
      // `.txt` entry had, including user_scripts. Pass scripts through
      // so "Group by Category and Sum" (and any future scripted
      // template) seeds the account-scoped checklist with its script
      // pre-populated. Order + shape are preserved verbatim so the
      // script-executor sees the same payload as if the user pasted
      // the raw template text.
      await onCreateFromTemplate({
        name: selectedTemplateData.name,
        system_prompt: selectedTemplateData.system_prompt,
        rules: (selectedTemplateData.rules || []).map((r, i) => ({
          prompt: r.prompt,
          order: typeof r.order === 'number' ? r.order : i,
        })),
        user_scripts: (selectedTemplateData.user_scripts || []).map((s, i) => ({
          id: s.id || `script_${i}`,
          name: s.name,
          code: s.code,
        })),
      });
      return;
    }

    // Create new — detect format
    const text = sourceText.trim();

    if (!text) {
      // Empty textarea → create empty checklist
      if (onCreateFromTemplate) {
        await onCreateFromTemplate({
          name: 'New Checklist',
          system_prompt: null,
          rules: [{ prompt: '', order: 0 }],
        });
      }
      return;
    }

    if (isChecklistFormat(text)) {
      // Structured text → direct import (no AI)
      const parsed = parseChecklistText(text);
      if (onCreateFromTemplate) {
        await onCreateFromTemplate({
          name: parsed.name,
          system_prompt: parsed.system_prompt,
          rules: parsed.rules,
          user_scripts: parsed.user_scripts,
        });
      }
      return;
    }

    // Freeform text → needs AI model selection
    const shouldIncludeAgreement = includeSourceText && !!checklistSourceText;
    if (onNeedAIModel) {
      onNeedAIModel(text, shouldIncludeAgreement);
    } else {
      // Fallback: call onGenerate directly (backward compat)
      await onGenerate(text);
    }
  };

  const isChecklist = mode === 'checklist';
  const title = isChecklist ? 'Add Checklist' : 'Add Rules using AI';

  // Button always says "Next" — model selection happens in the next dialog
  const buttonText = 'Next';

  const processingText = isChecklist ? 'Creating...' : 'Generating...';
  const placeholder = `Paste freeform agreement, policy, or other text for checklist generation.
Or select template in the dropdown above.
Or just click Next to create empty checklist.

You'll see checklist editor on the next step.
  `;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-indigo-500 flex-shrink-0" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-4">
          {/* Template picker — only in checklist mode */}
          {isChecklist && (
            <div>
              <label className="text-sm font-medium">Start from</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                disabled={isProcessing || isLoadingTemplates}
              >
                <option value={CREATE_NEW_VALUE}>New checklist</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    Copy of: {t.name} ({t.rules_count} rules)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Include original agreement checkbox — only in rules mode when source text exists */}
          {mode === 'rules' && checklistSourceText && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={includeSourceText}
                onChange={(e) => setIncludeSourceText(e.target.checked)}
                className="rounded border-gray-300"
                disabled={isProcessing}
              />
              <span>Include original agreement</span>
              <span className="text-xs text-muted-foreground">
                ({checklistSourceText.length.toLocaleString()} chars)
              </span>
            </label>
          )}

          {/* Textarea — only when CREATE NEW is selected */}
          {(isCreateNew || !isChecklist) && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Paste text or describe what to check</label>
              <Textarea
                rows={8}
                autoFocus
                className="focus-visible:ring-1 focus-visible:ring-offset-0"
                placeholder={placeholder}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                disabled={isProcessing}
              />
            </div>
          )}

          {/* Template preview when a template is selected */}
          {!isCreateNew && selectedTemplateData && (
            <div>
              <label className="text-sm font-medium">Preview:</label>
              <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 space-y-2 mt-1 max-h-48 overflow-y-auto">
                {selectedTemplateData.system_prompt && (
                  <p className="italic">{selectedTemplateData.system_prompt}</p>
                )}
                <ul className="list-disc list-inside space-y-1">
                  {selectedTemplateData.rules.map((r, i) => (
                    <li key={i}>{r.prompt}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Hint about next-step capabilities — only in checklist mode */}
          {isChecklist && (
            <p className="text-xs text-muted-foreground">
              You can edit everything on next step
            </p>
          )}

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-md p-3">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          {isChecklist && isCreateNew && onCreateFromTemplate && (
            <Button
              type="button"
              variant="outline"
              onClick={handleCreateEmpty}
              disabled={isProcessing}
              className="mr-auto"
            >
              Create Empty
            </Button>
          )}
          <div className="flex gap-2 flex-shrink-0 items-center ml-auto">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isProcessing}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {isProcessing ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {processingText}
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  {buttonText}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
