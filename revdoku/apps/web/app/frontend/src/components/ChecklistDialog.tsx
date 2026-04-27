

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { IChecklist, IRule, IEnvelopeRevision, createNewRule, HighlightMode, REVDOKU_DEFAULT_HIGHLIGHT_MODE, hasValueMarker } from '@revdoku/lib';
import { scanRuleFileMarkers } from '@/lib/rule-file-markers';
import HighlightModeSelect from '@/components/envelope-page/HighlightModeSelect';
import { EnvelopeRuleBadge } from '@/components/ui/EnvelopeRuleBadge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import FilePromptEditor from '@/components/FilePromptEditor';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sparkles, History, ClipboardCheck, Mail, FileText, ChevronDown, GitCompare, Copy, ExternalLink, Code2, Settings as SettingsIcon } from "lucide-react";
import UserScriptEditor from '@/components/envelope-page/UserScriptEditor';
import { cn } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { showToast } from '@/lib/toast';
import AddChecklistDialog from '@/components/AddChecklistDialog';
import AIModelSelectionDialog from '@/components/AIModelSelectionDialog';
import OnboardingHint from '@/components/OnboardingHint';
import { ApiClient } from '@/lib/api-client';
import { setLoadedModels, formatModelOptionLabel, buildPickerOptions } from '@/lib/ai-model-utils';
import { getRevisionInfoForRule } from '@/lib/rule-utils';
import { parseTextToRulePrompts } from '@/lib/checklist-parse-utils';
import type { IAIModelOption } from '@/lib/ai-model-utils';
import AiModelInfoCard from '@/components/envelope-page/AiModelInfoCard';
import type { EditabilityState } from '@/lib/editability-state';
import { formatDate, timeAgo } from '@/lib/date-utils';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';

interface ChecklistDialogProps {
  checklist: IChecklist | null;
  revisions?: any[];
  rules?: IRule[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (checklist: IChecklist) => Promise<void>;
  onSaverules?: (rules: IRule[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRollbackVersion?: (versionId: string) => Promise<void>;
  onViewVersion?: (checklist: IChecklist) => void;
  isEnvelopeContext?: boolean;
  disableRuleDeletion?: boolean;
  ruleKeysWithChecks?: Map<string, number>;
  dialogTitle?: string;
  dialogDescription?: string;
  hideNameAndInstruction?: boolean;
  currentRevisionId?: string; // ID of current envelope revision for rule locking
  envelopeRevisions?: IEnvelopeRevision[]; // Envelope revisions for showing revision info on user rules
  hasReport?: boolean; // Whether the current revision has an existing report (controls model editability)
  editability?: EditabilityState; // Unified editability state from envelope context
  showOnboardingHints?: boolean;
  initialTab?: string; // Tab to open on when dialog opens (default: "checklist")
  /**
   * When set on open, the rule with this id is scrolled into view and briefly
   * outlined. Used when the user jumps here from a check in the report ("Edit
   * in source checklist"). Ignored when the rule no longer exists in the
   * checklist (e.g. was deleted from the template since the snapshot).
   */
  focusRuleId?: string;
  isNewlyCreated?: boolean; // True when checklist was just created/generated
  rulesChangedSinceReview?: boolean; // True when revision_rules differ from what was used in the last inspection
  inspectedUserRules?: Record<string, string>; // Map of rule_id → prompt from last inspection_context (for per-rule diff hints)
  envelopeTitle?: string; // Envelope title for display when no checklist exists (envelope-rules-only mode)
}

// Lock icon for fields that are frozen in a snapshot or locked by a report
// Compact badges summarizing which special macros are present in a
// prompt (rule prompt or checklist system_prompt). Lets the author see
// at a glance that they've added `#file[Upload the original Quote]`
// (which requires a reference file at review time) or `#value` (which
// opts into value extraction). Full inline syntax highlighting is
// avoided because textareas can't render styled spans cheaply.
function MacroBadges({ text }: { text: string | null | undefined }) {
  const fileMarkers = scanRuleFileMarkers(text);
  const hasValue = hasValueMarker(text);
  if (fileMarkers.length === 0 && !hasValue) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {fileMarkers.map((m, idx) => (
        <span
          key={`file-${idx}`}
          className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300"
          title={m.description || 'Requires a reference file at review time'}
        >
          <span className="font-mono">#file</span>
          {m.description && <span className="max-w-[180px] truncate">{m.description}</span>}
        </span>
      ))}
      {hasValue && (
        <span
          className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
          title="Rule opts into value extraction — the AI will save a value per check"
        >
          <span className="font-mono">#value</span>
        </span>
      )}
    </div>
  );
}

function FieldLockIcon({ reason, onReset }: { reason: string; onReset?: () => void }) {
  const title = onReset ? `${reason}\nClick to reset report and unlock.` : reason;
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center text-amber-500 dark:text-amber-400",
        onReset ? "cursor-pointer hover:text-amber-600" : "cursor-default"
      )}
      title={title}
      onClick={onReset ? async () => {
        if (!confirm('Reset the report? AI review results will be cleared. Envelope checks are preserved. You can re-run the review afterward.')) return;
        await onReset();
      } : undefined}
      disabled={!onReset}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    </button>
  );
}

export default function ChecklistDialog({
  checklist,
  revisions = [],
  rules,
  isOpen,
  onClose,
  onSave,
  onSaverules,
  onDelete,
  onRollbackVersion,
  onViewVersion,
  isEnvelopeContext = false,
  disableRuleDeletion = false,
  ruleKeysWithChecks,
  dialogTitle,
  dialogDescription,
  hideNameAndInstruction = false,
  currentRevisionId,
  envelopeRevisions,
  hasReport = false,
  editability,
  showOnboardingHints,
  initialTab,
  focusRuleId,
  isNewlyCreated,
  rulesChangedSinceReview,
  inspectedUserRules,
  envelopeTitle,
}: ChecklistDialogProps) {
  const features = useFeatureFlags();
  const [editingChecklist, setEditingChecklist] = useState<IChecklist | null>(null);
  const [editingRules, setEditingRules] = useState<IRule[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("checklist");
  const [checklistScript, setChecklistScript] = useState<string>('');
  // Template state removed — template is now inside the code as `script_template = \`...\``
  const [checklistScriptId, setChecklistScriptId] = useState<string | undefined>();
  const [checklistScriptName, setChecklistScriptName] = useState<string | undefined>();
  const [versions, setVersions] = useState<any[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const checklistListRef = useRef<HTMLUListElement | null>(null);

  // Track which rule textarea is focused (for showing generate button)
  const [focusedRuleKey, setFocusedRuleKey] = useState<string | null>(null);

  // AI rule generation state
  const [showGenerateRules, setShowGenerateRules] = useState(false);
  const [isGeneratingRules, setIsGeneratingRules] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSourceRuleKey, setGenerateSourceRuleKey] = useState<string | null>(null);
  const [generateInitialText, setGenerateInitialText] = useState('');
  const [generateTarget, setGenerateTarget] = useState<'checklist' | 'envelope'>('checklist');

  // AI model selection state
  const [availableModels, setAvailableModels] = useState<IAIModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // Rules-mode AI model selection dialog state
  const [showRulesModelSelection, setShowRulesModelSelection] = useState(false);
  const [pendingRulesSourceText, setPendingRulesSourceText] = useState('');
  const [includeAgreementInGeneration, setIncludeAgreementInGeneration] = useState(false);

  // Source text collapsible state
  const [showSourceText, setShowSourceText] = useState(false);

  // Track initial rules to identify new ones added during editing session
  const [initialRuleIds, setInitialRuleIds] = useState<Set<string>>(new Set());
  // Track initial envelope rule _localKey -> prompt to detect additions, edits, and deletions
  const [initialEnvelopeRuleMap, setInitialEnvelopeRuleMap] = useState<Map<string, string>>(new Map());

  // Check if there are any envelope rule changes (additions, edits, or deletions)
  const hasEnvelopeRuleChanges = useMemo(() => {
    // New rule added
    if (editingRules.some((r: any) => r._localKey && !initialEnvelopeRuleMap.has(r._localKey))) return true;
    // Rule deleted
    const currentKeys = new Set(editingRules.map((r: any) => r._localKey));
    if ([...initialEnvelopeRuleMap.keys()].some(k => !currentKeys.has(k))) return true;
    // Rule prompt edited
    if (editingRules.some((r: any) => r._localKey && initialEnvelopeRuleMap.has(r._localKey) && r.prompt !== initialEnvelopeRuleMap.get(r._localKey))) return true;
    return false;
  }, [editingRules, initialEnvelopeRuleMap]);

  // Collapsed textarea: show content naturally, capped at ~3 lines of text-sm (20px line-height + 12px padding)
  const COLLAPSED_MAX_HEIGHT = 76;

  // Auto-size textarea ref callback: measures scrollHeight on mount and sets height
  const autoSizeRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    requestAnimationFrame(() => {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, COLLAPSED_MAX_HEIGHT) + 'px';
      el.style.overflow = 'hidden';
    });
  }, []);

  // Auto-size ref for read-only textareas: always show full content (no height cap)
  const readOnlyAutoSizeRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    requestAnimationFrame(() => {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
      el.style.overflow = 'hidden';
    });
  }, []);

  // Compute effective envelope rules: use the rules prop if available, otherwise
  // extract user-origin rules from the checklist (handles first-load hydration gap)
  const effectiveEnvelopeRules = useMemo(() => {
    if (rules && (rules as IRule[]).length > 0) return rules as IRule[];
    if (!isEnvelopeContext || !editingChecklist?.rules) return [];
    return editingChecklist.rules.filter((r: any) => r.origin === 'user');
  }, [rules, isEnvelopeContext, editingChecklist?.rules]);

  // Envelope-rules-only mode: no real checklist exists (null, or stub with no name), only envelope rules
  const hasRealChecklist = !!(checklist?.name || editingChecklist?.name);
  const isEnvelopeRulesOnly = !hasRealChecklist && isEnvelopeContext;

  // Always allow editing - simplified component (back-compat var)
  const showTabs = !!isEnvelopeContext && !isEnvelopeRulesOnly;

  // Helper: Check if this is a snapshot checklist (frozen inspection context)
  const isSnapshotChecklist = editingChecklist?.is_inspection_snapshot === true || editingChecklist?.checklist_type === 'report_snapshot';

  // Helper: Check if a rule is editable
  // - For envelope rules (origin='user'): only current revision's rules are editable
  // - For checklist rules: editable only if not a snapshot
  const isRuleEditable = (rule: any) => {
    if (rule.origin === 'user') {
      // Envelope rules: only editable if from current revision
      return rule.source_envelope_revision_id === currentRevisionId;
    }
    // Checklist rules: editable if not a snapshot
    return !isSnapshotChecklist;
  };

  // Helper: Check if a rule is a "NEW" rule (added in current revision)
  const isCurrentRevisionRule = (rule: any) => {
    return (
      rule.origin === 'user' &&
      rule.source_envelope_revision_id === currentRevisionId
    );
  };

  // Helper: Check if a rule is an envelope rule (user-created)
  const isEnvelopeRule = (rule: any) => rule.origin === 'user';

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (isOpen && checklist) {
      // Normalize rules: ensure stable order and local keys to prevent remounts
      // First, de-duplicate by rule ID
      const seen = new Set<string>();
      const deduped = (checklist.rules || []).filter((r: any) => {
        const key = r.id || r._localKey;
        if (!key) return true; // Keep rules without IDs
        if (seen.has(key)) {
          console.debug(`[ChecklistDialog] Duplicate rule detected and filtered: ${key}`);
          return false;
        }
        seen.add(key);
        return true;
      });

      const normalized = deduped
        .slice()
        .sort((a: any, b: any) => {
          const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
          const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          // tie-breaker: created_at then id to maintain stability
          const ac = a.created_at || '';
          const bc = b.created_at || '';
          if (ac !== bc) return ac.localeCompare(bc);
          return (a.id || '').localeCompare(b.id || '');
        })
        .map((r: any, idx: number) => ({
          ...r,
          order: idx,
          _localKey: r._localKey || uuidv4(),
        }));

      const checklistWithRules: any = {
        ...checklist,
        rules: normalized
      };
      setEditingChecklist(checklistWithRules);
      const scriptEntry = checklist?.user_scripts?.[0];
      setChecklistScript(scriptEntry?.code || '');
      setChecklistScriptId(scriptEntry?.id);
      setChecklistScriptName(scriptEntry?.name);

      // Capture initial rule IDs to identify new rules added during editing
      const ids = new Set(normalized.map((r: any) => r.id || r._localKey));
      setInitialRuleIds(ids);
      // Normalize envelope rules too so drag order stays predictable
      // Use effectiveEnvelopeRules to include user-origin rules from checklist when rules prop is empty
      const envelopeRulesSource = (rules && (rules as IRule[]).length > 0) ? rules as IRule[] :
        (isEnvelopeContext && checklist?.rules ? checklist.rules.filter((r: any) => r.origin === 'user') : []);
      const normalizedEnvelope = (envelopeRulesSource)
        .slice()
        .sort((a: any, b: any) => {
          const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
          const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          const ac = a.created_at || '';
          const bc = b.created_at || '';
          if (ac !== bc) return ac.localeCompare(bc);
          return (a.id || '').localeCompare(b.id || '');
        })
        .map((r: any, idx: number) => ({ ...r, order: idx, _localKey: r._localKey || uuidv4() }));
      setEditingRules(normalizedEnvelope);
      setInitialEnvelopeRuleMap(new Map(normalizedEnvelope.map((r: any) => [r._localKey, r.prompt || ''])));
      setError(null);
      setSuccessMessage(null);
      setActiveTab("checklist");
      setVersions([]);

      // Fallback auto-size: after dialog open animation, resize all textareas
      setTimeout(() => {
        const list = checklistListRef.current;
        if (!list) return;
        list.querySelectorAll('textarea').forEach((ta) => {
          ta.style.height = 'auto';
          // Read-only textareas show full content; editable ones collapse
          ta.style.height = ta.readOnly ? ta.scrollHeight + 'px' : Math.min(ta.scrollHeight, COLLAPSED_MAX_HEIGHT) + 'px';
          ta.style.overflow = 'hidden';
        });
      }, 100);
    } else if (!isOpen) {
      setEditingChecklist(null);
      setEditingRules([]);
      setError(null);
      setSuccessMessage(null);
      setActiveTab("checklist");
      setVersions([]);
      setInitialRuleIds(new Set());
      setInitialEnvelopeRuleMap(new Map());
    }
  }, [isOpen, checklist?.id]);

  // Override active tab when parent requests a specific initial tab
  useEffect(() => {
    if (isOpen && initialTab) {
      if (initialTab === "rules" || initialTab === "prompt" || initialTab === "ai") {
        setActiveTab("checklist"); // prompt/ai merged into the "checklist" tab header
      } else {
        setActiveTab(initialTab);
      }
    }
  }, [isOpen, initialTab]);

  // When parent opens us with a focusRuleId (e.g. the user jumped from a
  // check in the report via "Edit in source checklist"), scroll the matching
  // rule into view and briefly outline it. Retry for ~1s so the rule list
  // has time to render after tab switching / async checklist loads.
  useEffect(() => {
    if (!isOpen || !focusRuleId) return;
    let cancelled = false;
    let attempts = 0;
    let timer: number | null = null;
    const tryFocus = () => {
      if (cancelled) return;
      const listEl = checklistListRef.current;
      const target = listEl?.querySelector<HTMLElement>(`[data-rule-id="${CSS.escape(focusRuleId)}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('ring-2', 'ring-amber-400', 'ring-offset-1', 'rounded-sm');
        window.setTimeout(() => {
          target.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-1', 'rounded-sm');
        }, 2200);
        return;
      }
      attempts++;
      if (attempts < 12) {
        timer = window.setTimeout(tryFocus, 90);
      }
    };
    timer = window.setTimeout(tryFocus, 60);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [isOpen, focusRuleId, activeTab]);

  // Load versions when Versions tab is active
  useEffect(() => {
    const loadVersions = async () => {
      if (!isOpen || !checklist || activeTab !== 'versions') return;
      try {
        setIsLoadingVersions(true);
        const res = await ApiClient.getChecklistVersions(checklist.id);
        setVersions(res.versions || []);
      } catch (e) {
        console.debug('Failed to load versions', e);
      } finally {
        setIsLoadingVersions(false);
      }
    };
    loadVersions();
  }, [isOpen, checklist?.id, activeTab]);

  // Load available AI models when dialog opens
  useEffect(() => {
    const loadModels = async () => {
      if (!isOpen) return;
      try {
        setIsLoadingModels(true);
        const res = await ApiClient.getModelsCached();
        const models = res.models || [];
        const aliases = res.aliases || [];
        // Picker shows aliases + user's Custom-LLM models only — cloud
        // concrete models (GPT-4.1, Gemini 3.1 Flash, etc.) are alias
        // targets and shouldn't surface as their own picker rows.
        setAvailableModels(buildPickerOptions({ aliases, models, providers: res.providers }));
        setLoadedModels(models, res.default_model_id, res.default_checklist_generation_model_id, res.default_text_extraction_model_id, aliases);
      } catch (e) {
        console.debug('Failed to load AI models', e);
        setAvailableModels([]);
      } finally {
        setIsLoadingModels(false);
      }
    };
    loadModels();
  }, [isOpen]);

  // Removed handleEditChecklist since we always start in edit mode

  const handleSaveChecklist = async () => {
    try {
      setIsProcessing(true);
      setError(null);

      // Save the Checklist itself (name, instruction, and checklist rules)
      // Skip for snapshots — snapshots can't be updated via onSave (use onSaverules for envelope rules)
      if (editingChecklist && onSave && !isSnapshotChecklist) {
        const currentTime = new Date().toISOString();
        const normalizedChecklist: any = {
          ...editingChecklist,
          system_prompt: editingChecklist.system_prompt || '', // Include general instruction
          rules: (editingChecklist.rules || [])
            .slice()
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((rule: any, index) => {
              const { _localKey, ...rest } = rule;

              // Remove id for new rules (backend will generate real ID)
              const isNewRule = !initialRuleIds.has(rule._localKey || rule.id);
              if (isNewRule && rest.id) {
                delete rest.id;
              }

              return {
                ...rest,
                _localKey,
                order: index,
                updated_at: currentTime
              } as IRule;
            }),
          updated_at: currentTime,
          user_scripts: checklistScript.trim() ? [{
            id: checklistScriptId || 'script_0',
            name: checklistScriptName || 'Script 1',
            code: checklistScript.trim(),
            created_at: checklist?.user_scripts?.[0]?.created_at || new Date().toISOString(),
          }] : [],
        };
        await onSave(normalizedChecklist);
      }

      // For snapshots with model changes, save just that field
      if (editingChecklist && onSave && isSnapshotChecklist &&
        editability?.isModelEditable && editingChecklist.ai_model !== checklist?.ai_model
      ) {
        await onSave({ ...editingChecklist } as IChecklist);
      }

      // In envelope context, also persist envelope-specific rules if handler provided
      if (isEnvelopeContext && onSaverules) {
        const currentTime = new Date().toISOString();
        const normalizedrules = (editingRules || [])
          .slice()
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map((rule: any, index) => {
            const { _localKey, ...rest } = rule;

            // Remove id for new rules (backend will generate real ID)
            const isNewRule = !initialEnvelopeRuleMap.has(rule._localKey);
            if (isNewRule && rest.id) {
              delete rest.id;
            }

            return {
              ...rest,
              _localKey,
              order: index + (editingChecklist?.rules.length || 0),
              updated_at: currentTime
            } as IRule;
          });
        await onSaverules(normalizedrules);
      }
      showToast('Checklist saved');
      onClose();
    } catch (err) {
      setError('Failed to save checklist. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddChecklistCheck = () => {
    if (!editingChecklist) return;

    const newCheck: any = createNewRule(editingChecklist.id, editingChecklist.rules.length);
    newCheck.prompt = '';
    newCheck.order = editingChecklist.rules.length;
    newCheck._localKey = uuidv4();

    setEditingChecklist({
      ...editingChecklist,
      rules: [...editingChecklist.rules, newCheck]
    });

    // Focus the newly added rule's textarea after render
    setTimeout(() => {
      const list = checklistListRef.current;
      if (!list) return;
      const textareas = list.querySelectorAll('textarea');
      const last = textareas[textareas.length - 1] as HTMLTextAreaElement | undefined;
      if (last) {
        last.focus();
        // Move caret to end, just in case
        const len = last.value.length;
        try { last.setSelectionRange(len, len); } catch { }
        last.scrollIntoView({ block: 'nearest' });
      }
    }, 50);
  };

  const handleAddCustomCheck = () => {
    if (!editingChecklist) return;

    const newCheck: any = createNewRule(editingChecklist.id, editingChecklist.rules.length || 0);
    newCheck.prompt = '';
    newCheck.order = editingRules.length + (editingChecklist.rules.length || 0);
    newCheck._localKey = uuidv4();
    delete newCheck.id;  // prevent id collisions; _localKey is the identity

    setEditingRules([...(editingRules || []), newCheck]);
  };

  const handleUpdateCustomCheck = (index: number, field: keyof IRule, value: any) => {
    const updatedrules = [...editingRules];
    updatedrules[index] = { ...updatedrules[index], [field]: value };
    setEditingRules(updatedrules);
  };

  const handleRollback = async (version: any) => {
    if (onRollbackVersion && version?.id) {
      try {
        setIsProcessing(true);
        await onRollbackVersion(version.id as string);
        setSuccessMessage('Successfully rolled back to this version.');
        setTimeout(() => setSuccessMessage(null), 3000);
      } catch (err) {
        setError('Failed to rollback checklist. Please try again.');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleRollbackTo = async (checklistToRollback: IChecklist) => {
    // Load the selected version into editing mode
    const checklistWithRules = {
      ...checklistToRollback,
      rules: checklistToRollback.rules || []
    };
    setEditingChecklist(checklistWithRules);
    setSuccessMessage(`Loaded revision ${checklistToRollback.name} for editing.`);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleDeleteChecklist = async () => {
    if (!checklist) return;

    if (window.confirm(`Are you sure you want to delete "${checklist.name}"? This action cannot be undone.`)) {
      try {
        setIsProcessing(true);
        await onDelete(checklist.id);
        onClose();
      } catch (err) {
        setError('Failed to delete checklist. Please try again.');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // Returns true on success, false on failure
  const handleGenerateRules = async (sourceText: string, aiModel?: string): Promise<boolean> => {
    if (!editingChecklist || !sourceText.trim()) return false;

    try {
      setIsGeneratingRules(true);
      setGenerateError(null);

      // Include original agreement text if user opted in
      let fullText = sourceText;
      if (includeAgreementInGeneration && editingChecklist.source_text) {
        fullText = `--- ORIGINAL AGREEMENT ---\n${editingChecklist.source_text}\n--- END ORIGINAL AGREEMENT ---\n\n${fullText}`;
      }

      // Build context with existing rules if any
      if (editingChecklist.rules.length > 0) {
        const existingRulesSection = `IMPORTANT: We already have these existing rules in this checklist:\n\n${editingChecklist.rules
          .map((rule, idx) => `${idx + 1}. ${rule.prompt}`)
          .join('\n')
          }\n\nPlease generate ADDITIONAL rules that complement (not duplicate) the above existing rules.\n\n---\n\n`;
        fullText = existingRulesSection + sourceText;
      }

      // Reuse existing checklist generation API — pass the checklist's ai_model or the provided override
      const modelToUse = aiModel || editingChecklist.ai_model;
      const result = await ApiClient.generateChecklist(fullText, modelToUse);

      if (!result.checklist?.rules || result.checklist.rules.length === 0) {
        throw new Error('No rules were generated from the provided text');
      }

      const currentTime = new Date().toISOString();

      if (generateTarget === 'envelope') {
        // Insert generated rules into envelope rules
        let existingEnvRules = editingRules;
        if (generateSourceRuleKey) {
          existingEnvRules = existingEnvRules.filter((r: any) =>
            (r._localKey || r.id) !== generateSourceRuleKey
          );
        }
        const combined = [
          ...existingEnvRules,
          ...result.checklist.rules.map((rule) => ({
            ...rule,
            _localKey: uuidv4()
          }))
        ].map((r, idx) => ({ ...r, order: idx + (editingChecklist?.rules.length || 0), updated_at: currentTime }));
        setEditingRules(combined);
      } else {
        // Insert generated rules into checklist rules
        let existingRules = editingChecklist.rules;
        if (generateSourceRuleKey) {
          existingRules = existingRules.filter((r: any) =>
            (r._localKey || r.id) !== generateSourceRuleKey
          );
        }
        const combined = [
          ...existingRules,
          ...result.checklist.rules.map((rule) => ({
            ...rule,
            _localKey: uuidv4()
          }))
        ].map((r, idx) => ({ ...r, order: idx, updated_at: currentTime }));
        setEditingChecklist({
          ...editingChecklist,
          rules: combined
        });
      }

      showToast(`Added ${result.checklist.rules.length} rule${result.checklist.rules.length === 1 ? '' : 's'} from AI`);
      setShowGenerateRules(false);
      setGenerateSourceRuleKey(null);
      setGenerateInitialText('');
      return true;
    } catch (error) {
      console.error('Error generating rules:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate rules. Please try again.';
      setGenerateError(errorMessage);
      return false;
    } finally {
      setIsGeneratingRules(false);
    }
  };

  // Auto-split multi-line paste into separate rules
  const handleRulePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>, rule: any) => {
    const pastedText = e.clipboardData.getData('text/plain');
    const lines = parseTextToRulePrompts(pastedText);

    // Single-line paste: let the browser handle it normally
    if (lines.length <= 1) return;

    e.preventDefault();

    setEditingChecklist(prev => {
      if (!prev) return prev;

      const textarea = e.currentTarget;
      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;
      const currentPrompt = rule.prompt || '';

      // Splice first line into the current rule at cursor position
      const before = currentPrompt.slice(0, selStart);
      const after = currentPrompt.slice(selEnd);
      const updatedPrompt = (before + lines[0] + after).trim();

      const currentTime = new Date().toISOString();
      const ruleKey = rule._localKey || rule.id;

      // Update current rule with first line
      let newRules = prev.rules.map((r: any) =>
        (r._localKey || r.id) === ruleKey ? { ...r, prompt: updatedPrompt } : r
      );

      // Find index of current rule to insert after it
      const sortedRules = [...newRules].sort((a, b) => (a.order || 0) - (b.order || 0));
      const currentIndex = sortedRules.findIndex((r: any) => (r._localKey || r.id) === ruleKey);

      // Create new rules for remaining lines
      const newEntries = lines.slice(1).map((prompt) => ({
        id: `temp_${uuidv4()}`,
        prompt,
        order: 0,
        _localKey: uuidv4(),
        updated_at: currentTime,
        checks: null,
      }));

      // Insert after current rule
      sortedRules.splice(currentIndex + 1, 0, ...newEntries);

      // Re-order all rules
      const reordered = sortedRules.map((r, idx) => ({
        ...r,
        order: idx,
        updated_at: currentTime,
      }));

      return { ...prev, rules: reordered };
    });
  }, []);

  const handleCopyChecklist = () => {
    const allRules = showTabs
      ? [...(editingChecklist?.rules || [])].filter((r: any) => r.origin !== 'user')
      : [...(editingChecklist?.rules || [])];
    const parts: string[] = [];
    if (editingChecklist?.name) parts.push(editingChecklist.name);
    if (editingChecklist?.system_prompt) parts.push(editingChecklist.system_prompt);
    const ruleLines = [...allRules]
      .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
      .map((r: any) => `- ${r.prompt}`)
      .join('\n');
    if (ruleLines) parts.push(ruleLines);
    if (checklistScript.trim()) parts.push(`<script>\n${checklistScript.trim()}\n</script>`);
    navigator.clipboard.writeText(parts.join('\n\n'));
    showToast('Copied to clipboard', 'success');
  };

  const handleOpenChecklistHtml = () => {
    const allRules = showTabs
      ? [...(editingChecklist?.rules || [])].filter((r: any) => r.origin !== 'user')
      : [...(editingChecklist?.rules || [])];
    const name = editingChecklist?.name || 'Untitled Checklist';
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sortedRules = [...allRules].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
    const scriptsHtml = checklistScript.trim()
      ? `<h2>Script</h2><pre><code>${esc(checklistScript.trim())}</code></pre>`
      : '';
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(name)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.6}
h1{font-size:1.5rem;border-bottom:2px solid #4f46e5;padding-bottom:.5rem}
h2{font-size:1.15rem;margin-top:2rem;border-bottom:1px solid #e5e5e5;padding-bottom:.25rem}
h3{font-size:.95rem;margin-top:1rem;color:#4f46e5}
.prompt{background:#f5f5f5;border-left:3px solid #4f46e5;padding:.75rem 1rem;margin:1rem 0;white-space:pre-wrap}
ol{padding-left:1.5rem}li{margin:.75rem 0}
pre{background:#f5f5f5;border:1px solid #e5e5e5;border-radius:4px;padding:.75rem 1rem;overflow-x:auto;font-size:.85rem;white-space:pre-wrap;word-wrap:break-word}
.meta{color:#666;font-size:.85rem;margin-top:-.5rem}
@media(prefers-color-scheme:dark){body{background:#1a1a1a;color:#e5e5e5}.prompt,pre{background:#2a2a2a;border-color:#333}h2{border-color:#333}}</style>
</head><body>
<h1>${esc(name)}</h1>
<p class="meta">${sortedRules.length} rules</p>
${editingChecklist?.system_prompt ? `<div class="prompt">${esc(editingChecklist.system_prompt)}</div>` : ''}
<ol>${sortedRules.map((r: any) => `<li>${esc(r.prompt || '')}</li>`).join('')}</ol>
${scriptsHtml}
</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const ChecklistEditor = () => {
    // When Envelope Rules tab exists, filter out user-origin rules from the Rules tab (display only)
    const checklistRules = showTabs
      ? [...(editingChecklist?.rules || [])].filter((r: any) => r.origin !== 'user')
      : [...(editingChecklist?.rules || [])];

    return (
      <>
        <div className="space-y-3 mb-3 pb-3 border-b border-border/40">
          {!(isSnapshotChecklist && !editingChecklist?.system_prompt?.trim()) && (
            <div>
              <Label htmlFor="system-prompt" className="text-sm font-medium text-foreground flex items-center gap-2">
                General Instruction
                <span className="text-xs text-muted-foreground font-normal">(required)</span>
                {isSnapshotChecklist && (
                  <FieldLockIcon reason="Read-only in review snapshot" />
                )}
              </Label>
              <div className="mt-2">
                <FilePromptEditor
                  id="system-prompt"
                  value={editingChecklist?.system_prompt || ''}
                  onChange={(v) => setEditingChecklist(prev => prev ? { ...prev, system_prompt: v } : prev)}
                  readOnly={isSnapshotChecklist}
                  placeholder={isSnapshotChecklist ? "" : "Enter general instruction that applies to all rules during AI review..."}
                  minHeightPx={120}
                />
              </div>
            </div>
          )}

          {editingChecklist?.source_text && (
            <div className="border rounded-md">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 rounded-md"
                onClick={() => setShowSourceText(!showSourceText)}
              >
                <span className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  Original Agreement Text
                  <span className="text-xs text-muted-foreground font-normal">
                    ({editingChecklist.source_text.length.toLocaleString()} chars)
                  </span>
                </span>
                <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", showSourceText && "rotate-180")} />
              </button>
              {showSourceText && (
                <div className="px-3 pb-3">
                  <div className="bg-muted/30 rounded p-3 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto font-mono text-xs leading-relaxed">
                    {editingChecklist.source_text}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Track-changes is a per-review runtime flag, not a checklist
              property — it lives on the Review dialog and is offered
              only on envelope revisions 2+. Moved out of ChecklistDialog
              so checklists stay focused on rules + ref files. */}
        </div>

        <div>
          <div className="mb-2 flex justify-between items-center">
            <div className="flex items-center gap-1.5">
              <h4 className="text-sm font-medium text-foreground">Rules ({checklistRules.length})</h4>
            </div>
            {!isSnapshotChecklist && (
              <button
                className="text-indigo-600 hover:underline text-xs font-medium px-1 py-0.5"
                onClick={() => handleAddChecklistCheck()}
              >
                + add rules
              </button>
            )}
          </div>
          <ul ref={checklistListRef} className="pr-1 rounded-lg bg-muted/30 divide-y divide-border/40">
            {checklistRules
              .sort((a, b) => (a.order || 0) - (b.order || 0))
              .map((rule: any, index) => {
                const isNewRule = !initialRuleIds.has(rule.id || rule._localKey);
                const editable = isRuleEditable(rule);
                const isCurrentRevRule = isCurrentRevisionRule(rule);
                return (
                  <li
                    key={rule._localKey || rule.id || index}
                    data-rule-id={rule.id}
                    className={`flex items-start px-2 py-1.5 group hover:bg-accent/50 transition-colors relative ${index % 2 === 0 ? 'bg-transparent' : 'bg-muted/20'
                      } ${isNewRule ? 'border-l-4 border-green-500 bg-green-50/30 dark:bg-green-950/30' : ''} ${!editable && isSnapshotChecklist ? 'opacity-75' : ''
                      } ${isCurrentRevRule && isSnapshotChecklist ? 'border-l-4 border-green-500 bg-green-50/30 dark:bg-green-950/30' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add('border-t-2', 'border-indigo-400');
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.classList.remove('border-t-2', 'border-indigo-400');
                    }}
                    onDrop={(e) => {
                      if (editingChecklist) {
                        e.preventDefault();
                        e.currentTarget.classList.remove('border-t-2', 'border-indigo-400');
                        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                        const toIndex = index;

                        if (fromIndex !== toIndex) {
                          const sortedRules = [...editingChecklist.rules].sort((a, b) => (a.order || 0) - (b.order || 0));
                          const newRules = [...sortedRules];
                          const [movedRule] = newRules.splice(fromIndex, 1);
                          newRules.splice(toIndex, 0, movedRule);

                          const currentTime = new Date().toISOString();
                          const updatedRules = newRules.map((rule, idx) => ({
                            ...rule,
                            order: idx,
                            updated_at: currentTime
                          }));

                          setEditingChecklist({ ...editingChecklist, rules: updatedRules });
                        }
                      }
                    }}
                  >
                    <div className="flex items-center mr-2 mt-1">
                      <span className="text-xs font-medium text-muted-foreground mr-1 select-none">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      {editable ? (
                        <div
                          className="cursor-move text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', index.toString());
                            e.dataTransfer.effectAllowed = 'move';
                            (e.currentTarget.closest('li') as HTMLElement).style.opacity = '0.4';
                          }}
                          onDragEnd={(e) => {
                            (e.currentTarget.closest('li') as HTMLElement).style.opacity = '1';
                            // Clean up any drag indicators
                            document.querySelectorAll('.border-t-2').forEach(el => {
                              el.classList.remove('border-t-2', 'border-indigo-400');
                            });
                          }}
                          title="Drag to reorder"
                        >
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M3 15a1 1 0 110-2h18a1 1 0 110 2H3zm0-6a1 1 0 110-2h18a1 1 0 110 2H3zm0 12a1 1 0 110-2h18a1 1 0 110 2H3z" />
                          </svg>
                        </div>
                      ) : (
                        <div className="text-muted-foreground/40" title="This rule is locked because this checklist is a snapshot created at the time of AI review.">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                      {isSnapshotChecklist && (
                        <EnvelopeRuleBadge
                          rule={rule}
                          envelopeRevisions={envelopeRevisions}
                          currentRevisionId={currentRevisionId}
                          compact={false}
                          className="ml-1"
                        />
                      )}
                      {isCurrentRevRule && isSnapshotChecklist && (() => {
                        const revInfo = getRevisionInfoForRule(rule, envelopeRevisions);
                        const isLatest = envelopeRevisions && envelopeRevisions.length > 0
                          && currentRevisionId === envelopeRevisions[envelopeRevisions.length - 1]?.id;
                        let label = 'NEW';
                        if (revInfo) {
                          const details = [];
                          if (isLatest) details.push('latest');
                          if (revInfo.timeAgo) details.push(revInfo.timeAgo);
                          label += ` - Rev ${revInfo.revisionNumber}`;
                          if (details.length) label += ` (${details.join(', ')})`;
                        }
                        const checkCount = ruleKeysWithChecks?.get(rule.id);
                        if (checkCount) {
                          label += `, ${checkCount} check${checkCount > 1 ? 's' : ''}`;
                        }
                        return (
                          <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded border border-green-200 dark:border-green-700">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                            </svg>
                            {label}
                          </span>
                        );
                      })()}
                      {/* Fallback: Show "Envelope" badge when source_envelope_revision_id is missing */}
                      {isSnapshotChecklist && isEnvelopeRule(rule) && !isCurrentRevRule && !(rule as any).source_envelope_revision_id && (
                        <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-teal-100 dark:bg-teal-900/50 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-700">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                          </svg>
                          Envelope
                        </span>
                      )}
                    </div>

                    <div className="flex-1 relative">
                      <FilePromptEditor
                        value={rule.prompt}
                        onChange={editable ? (newValue) => {
                          setEditingChecklist(prev => {
                            if (!prev) return prev;
                            return {
                              ...prev,
                              rules: prev.rules.map((r: any) =>
                                (r._localKey || r.id) === (rule._localKey || rule.id) ? { ...r, prompt: newValue } : r
                              )
                            };
                          });
                        } : () => {}}
                        readOnly={!editable}
                        placeholder={editable ? "type the rule here or use the \"generate\" at the right.." : ""}
                        className={cn(
                          "border-transparent bg-transparent",
                          editable ? "hover:border-border/60 focus-visible:border-indigo-400 focus-visible:ring-indigo-400 focus-visible:bg-background" : "cursor-not-allowed text-muted-foreground"
                        )}
                        minHeightPx={32}
                        onFocus={editable ? () => setFocusedRuleKey(rule._localKey || rule.id) : undefined}
                        onBlur={editable ? () => {
                          setTimeout(() => setFocusedRuleKey(prev => prev === (rule._localKey || rule.id) ? null : prev), 200);
                        } : undefined}
                        onKeyDown={editable ? (e) => {
                          if (e.key === 'Tab' && !e.shiftKey) {
                            const nextIndex = index + 1;
                            if (nextIndex >= (editingChecklist?.rules.length || 0)) {
                              e.preventDefault();
                              handleAddChecklistCheck();
                            }
                          }
                        } : undefined}
                        onPaste={editable ? (e) => handleRulePaste(e as unknown as React.ClipboardEvent<HTMLTextAreaElement>, rule) : undefined}
                      />
                      {editable && focusedRuleKey === (rule._localKey || rule.id) && (
                        <button
                          type="button"
                          className="absolute bottom-1 right-1 px-1.5 py-0.5 text-[10px] font-medium
                               text-purple-600 bg-purple-50 border border-purple-200
                               dark:text-purple-300 dark:bg-purple-950/60 dark:border-purple-700
                               rounded hover:bg-purple-100 dark:hover:bg-purple-900
                               transition-all duration-200 z-10"
                          title="Generate rules from this text using AI"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setGenerateTarget('checklist');
                            setGenerateSourceRuleKey(rule._localKey || rule.id);
                            setGenerateInitialText(rule.prompt || '');
                            setShowGenerateRules(true);
                          }}
                        >
                          <Sparkles className="w-2.5 h-2.5 inline-block mr-0.5" />generate..
                        </button>
                      )}
                    </div>

                    {editable && (
                      <button
                        type="button"
                        className="ml-1 p-1 text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all duration-200"
                        title="Remove Rule"
                        onClick={() => {
                          if (rule.prompt.trim() && !window.confirm('Delete this rule?')) return;
                          if (editingChecklist) {
                            const newRules = editingChecklist.rules.filter((c: any) => (c._localKey || c.id) !== (rule._localKey || rule.id));
                            const currentTime = new Date().toISOString();
                            const reorderedRules = [...newRules]
                              .sort((a, b) => (a.order || 0) - (b.order || 0))
                              .map((c, idx) => ({
                                ...c,
                                order: idx,
                                updated_at: currentTime
                              }));
                            setEditingChecklist({ ...editingChecklist, rules: reorderedRules });
                          }
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>

        </div>
      </>
    );
  };

  const EnvelopeChecklistEditor = () => {
    // Envelope rules are read-only when viewing a snapshot or when disableRuleDeletion is set
    const isEnvelopeRulesReadOnly = !!disableRuleDeletion;

    return (
      <div>
        <div className="mb-2 flex justify-between items-center">
          <h4 className="text-sm font-medium text-foreground">Envelope Rules ({editingRules.length})</h4>
          {!isEnvelopeRulesReadOnly && (
            <div className="flex gap-2 items-center">
              <button
                className="text-purple-600 hover:underline text-xs font-medium px-1 py-0.5 flex items-center gap-0.5"
                onClick={() => {
                  setGenerateTarget('envelope');
                  setGenerateSourceRuleKey(null);
                  setGenerateInitialText('');
                  setShowGenerateRules(true);
                }}
              >
                <Sparkles className="w-3 h-3" />generate..
              </button>
              <button
                className="px-2 py-1 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 focus:outline-none focus:ring-1 focus:ring-green-500 transition-colors"
                onClick={handleAddCustomCheck}
              >
                + Add Envelope Rule
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground mb-2">
          Envelopes rules are used for current envelope only. They are created manually or when checks added using "Add Issue" in the view.
        </p>

        {rulesChangedSinceReview && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 text-xs text-amber-700 dark:text-amber-300">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            Rules have changed since the last review. Re-run review to apply changes.
          </div>
        )}

        {editingRules.length === 0 && (
          <div className="text-sm text-muted-foreground italic py-6 text-center bg-muted/20 rounded-lg">
            No envelope specific rule yet.
          </div>
        )}

        <ul className="max-h-[50vh] overflow-y-auto pr-1 rounded-lg bg-green-50/20 dark:bg-green-950/20 divide-y divide-green-200/40 dark:divide-green-800/40">
          {editingRules.map((rule: any, index) => (
            <li
              key={rule._localKey || rule.id || index}
              className={`flex flex-col px-2 py-1.5 group hover:bg-green-50/50 dark:hover:bg-green-950/30 transition-colors relative ${index % 2 === 0 ? 'bg-transparent' : 'bg-green-50/30 dark:bg-green-950/20'
                }`}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('border-t-2', 'border-green-400');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('border-t-2', 'border-green-400');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('border-t-2', 'border-green-400');
                const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                const toIndex = index;

                if (fromIndex !== toIndex) {
                  const newRules = [...editingRules];
                  const [movedRule] = newRules.splice(fromIndex, 1);
                  newRules.splice(toIndex, 0, movedRule);

                  const currentTime = new Date().toISOString();
                  const updatedRules = newRules.map((rule, idx) => ({
                    ...rule,
                    order: idx + (editingChecklist?.rules.length || 0),
                    updated_at: currentTime
                  }));

                  setEditingRules(updatedRules);
                }
              }}
            >
              {/* Top row: E01 label + badges */}
              <div className="flex items-center gap-1 flex-wrap mb-0.5">
                <span className="text-xs font-medium text-green-600 dark:text-green-400 select-none">
                  E{String(index + 1).padStart(2, '0')}
                </span>
                {ruleKeysWithChecks?.has(rule.id) && (
                  <span className="text-muted-foreground/40" title="Has inspection results — cannot delete">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </span>
                )}
                {!isEnvelopeRulesReadOnly && (
                  <div
                    className="cursor-move text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', index.toString());
                      e.dataTransfer.effectAllowed = 'move';
                      (e.currentTarget.closest('li') as HTMLElement).style.opacity = '0.4';
                    }}
                    onDragEnd={(e) => {
                      (e.currentTarget.closest('li') as HTMLElement).style.opacity = '1';
                      document.querySelectorAll('.border-t-2').forEach(el => {
                        el.classList.remove('border-t-2', 'border-green-400');
                      });
                    }}
                    title="Drag to reorder"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3 15a1 1 0 110-2h18a1 1 0 110 2H3zm0-6a1 1 0 110-2h18a1 1 0 110 2H3zm0 12a1 1 0 110-2h18a1 1 0 110 2H3z" />
                    </svg>
                  </div>
                )}
                {isSnapshotChecklist && (
                  <EnvelopeRuleBadge
                    rule={rule}
                    envelopeRevisions={envelopeRevisions}
                    currentRevisionId={currentRevisionId}
                    compact={false}
                  />
                )}
                {isCurrentRevisionRule(rule) && isSnapshotChecklist && (() => {
                  const revInfo = getRevisionInfoForRule(rule, envelopeRevisions);
                  let label = 'Added in current revision';
                  if (revInfo) {
                    label = `Added in Rev ${revInfo.revisionNumber}`;
                    if (revInfo.timeAgo) label += ` (${revInfo.timeAgo})`;
                  }
                  const checkCount = ruleKeysWithChecks?.get(rule.id);
                  if (checkCount) {
                    label += ` · ${checkCount} check${checkCount > 1 ? 's' : ''}`;
                  }
                  return (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded border border-green-200 dark:border-green-700">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                      {label}
                    </span>
                  );
                })()}
                {isSnapshotChecklist && isEnvelopeRule(rule) && !isCurrentRevisionRule(rule) && !(rule as any).source_envelope_revision_id && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-teal-100 dark:bg-teal-900/50 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-700">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                    Envelope rule
                  </span>
                )}
                {!isEnvelopeRulesReadOnly && !ruleKeysWithChecks?.has(rule.id) && (
                  <button
                    type="button"
                    className="ml-auto p-0.5 text-muted-foreground/40 hover:text-red-600 transition-colors"
                    title="Remove Rule"
                    onClick={() => {
                      if (rule.prompt.trim() && !window.confirm('Delete this rule?')) return;
                      const newRules = editingRules.filter((c: any) => (c._localKey || c.id) !== (rule._localKey || rule.id));
                      setEditingRules(newRules);
                    }}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Full-width textarea below badges */}
              <div>
                <div className="relative">
                  <textarea
                    ref={isEnvelopeRulesReadOnly ? readOnlyAutoSizeRef : autoSizeRef}
                    rows={1}
                    className={`block w-full rounded border ${isEnvelopeRulesReadOnly ? 'border-transparent bg-transparent cursor-not-allowed text-muted-foreground' : 'border-transparent bg-transparent hover:border-green-300/60 dark:hover:border-green-700/60'} text-foreground focus:border-green-400 focus:ring-1 focus:ring-green-400 focus:bg-background text-sm p-1.5 resize-none transition-all duration-200`}
                    value={rule.prompt}
                    readOnly={isEnvelopeRulesReadOnly}
                    onFocus={isEnvelopeRulesReadOnly ? undefined : (e) => {
                      setFocusedRuleKey(rule._localKey || rule.id);
                      e.currentTarget.style.height = 'auto';
                      e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';
                      e.currentTarget.style.overflow = 'auto';
                    }}
                    onBlur={isEnvelopeRulesReadOnly ? undefined : () => {
                      setTimeout(() => setFocusedRuleKey(null), 200);
                    }}
                    onInput={isEnvelopeRulesReadOnly ? undefined : (e) => {
                      const target = e.currentTarget;
                      target.style.height = 'auto';
                      target.style.height = target.scrollHeight + 'px';
                    }}
                    onChange={isEnvelopeRulesReadOnly ? undefined : (e) => {
                      const actualIndex = editingRules.findIndex((c: any) => (c._localKey || c.id) === (rule._localKey || rule.id));
                      handleUpdateCustomCheck(actualIndex, 'prompt', e.target.value);
                    }}
                    onDragStart={(e) => e.stopPropagation()}
                    placeholder={isEnvelopeRulesReadOnly ? "" : "Enter envelope-specific rule..."}
                  />
                  {!isEnvelopeRulesReadOnly && (
                    <button
                      type="button"
                      className="absolute bottom-1 right-1 px-1.5 py-0.5 text-[10px] font-medium
                               text-purple-600 bg-purple-50 border border-purple-200
                               dark:text-purple-300 dark:bg-purple-950/60 dark:border-purple-700
                               rounded hover:bg-purple-100 dark:hover:bg-purple-900
                               transition-all duration-200 z-10"
                      title="Generate rules from this text using AI"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setGenerateTarget('envelope');
                        setGenerateSourceRuleKey(rule._localKey || rule.id);
                        setGenerateInitialText(rule.prompt || '');
                        setShowGenerateRules(true);
                      }}
                    >
                      <Sparkles className="w-2.5 h-2.5 inline-block mr-0.5" />generate..
                    </button>
                  )}
                  <MacroBadges text={rule.prompt} />
                </div>
                {/* Hint: show previous inspection version of this rule if it differs */}
                {inspectedUserRules && rule.id && inspectedUserRules[rule.id] != null && inspectedUserRules[rule.id] !== rule.prompt?.trim() && (
                  <div className="mt-0.5 px-1.5 py-1 rounded text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-800/50">
                    Last review used: <span className="italic">{inspectedUserRules[rule.id]}</span>
                  </div>
                )}
              </div>

            </li>
          ))}
        </ul>
      </div>
    );
  };

  const EnvelopeChecklistViewer = () => (
    <div>
      <h4 className="text-sm font-medium text-foreground mb-2">Envelope-Specific Rules</h4>
      <p className="text-sm text-muted-foreground mb-4">
        These custom rules are specific to this document and persist across all revisions.
      </p>
      {rules && rules.length > 0 ? (
        <ul className="space-y-2">
          {rules.map((rule, index) => (
            <li key={rule.id} className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-secondary-foreground">{rule.prompt}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No envelope-specific rules have been added yet.</p>
      )}
    </div>
  );


  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-visible max-w-4xl">
        {/* Copy / Open-as-HTML actions — top-right, below the dialog close X */}
        <div className="absolute right-4 top-11 flex items-center gap-1 z-10">
          <button
            onClick={handleCopyChecklist}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Copy checklist as text"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleOpenChecklistHtml}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Open checklist as HTML page"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
        <DialogHeader>
          <div className="flex justify-between items-center w-full">
            <div className="flex-1 min-w-0">
              <DialogTitle className="flex items-center gap-2 w-full">
                {dialogTitle || (
                  isEnvelopeRulesOnly ? (
                    <span className="text-lg font-semibold px-2 py-1 flex items-center gap-2">
                      <Mail className="h-5 w-5 text-green-600 flex-shrink-0" />
                      {envelopeTitle || 'Envelope Rules'}
                    </span>
                  ) : isSnapshotChecklist ? (
                    // Snapshot checklist: name is read-only
                    <span className="text-lg font-semibold px-2 py-1 flex items-center gap-2">
                      <ClipboardCheck className="h-5 w-5 text-indigo-500 flex-shrink-0" />
                      {editingChecklist?.name || checklist?.name || 'Untitled Checklist'}
                      <span className="text-xs font-medium text-indigo-500 dark:text-indigo-400">[snapshot]</span>
                    </span>
                  ) : isEditingName ? (
                    <span className="flex items-center gap-2 w-full">
                      <ClipboardCheck className="h-5 w-5 text-indigo-500 flex-shrink-0" />
                      <input
                        type="text"
                        value={editingChecklist?.name || ''}
                        onChange={(e) => setEditingChecklist(prev => prev ? { ...prev, name: e.target.value } : prev)}
                        onBlur={() => setIsEditingName(false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            setIsEditingName(false);
                          }
                          if (e.key === 'Escape') {
                            setIsEditingName(false);
                            setEditingChecklist(prev => prev ? { ...prev, name: checklist?.name || '' } : prev);
                          }
                        }}
                        className="text-lg font-semibold bg-transparent border-b-2 border-indigo-500 focus:outline-none focus:border-indigo-600 w-full px-2 py-1"
                        autoFocus
                      />
                    </span>
                  ) : (
                    <button
                      onClick={() => setIsEditingName(true)}
                      className="text-left hover:bg-accent rounded px-2 py-1 transition-colors flex items-center gap-2"
                      title="Click to edit checklist name"
                    >
                      <ClipboardCheck className="h-5 w-5 text-indigo-500 flex-shrink-0" />
                      <span className="text-lg font-semibold">{editingChecklist?.name || checklist?.name || 'Untitled Checklist'}</span>
                      <svg
                        className="w-4 h-4 text-muted-foreground/40 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                        />
                      </svg>
                    </button>
                  )
                )}
              </DialogTitle>
              <DialogDescription asChild>
                <span className="space-y-1 block">
                  {checklist && (
                    <span className="flex items-center gap-4 text-xs text-muted-foreground">
                      {checklist.created_at && <span>Created: {formatDate(checklist.created_at)}</span>}
                      {checklist.updated_at && checklist.updated_at !== checklist.created_at && (
                        <>
                          <span>•</span>
                          <span>Updated: {timeAgo(checklist.updated_at)}</span>
                        </>
                      )}
                      {(() => {
                        const count = (Array.isArray(revisions) ? revisions.length : 0) || (versions?.length || 0);
                        return count ? (
                          <>
                            <span>•</span>
                            <span>{count} version{count === 1 ? '' : 's'}</span>
                          </>
                        ) : null;
                      })()}
                    </span>
                  )}
                  {dialogDescription && (
                    <span className="text-sm text-muted-foreground block">{dialogDescription}</span>
                  )}
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Context notice */}
        {(isSnapshotChecklist || isEnvelopeRulesOnly) && isEnvelopeContext && (
          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>
              {isEnvelopeRulesOnly
                ? <>Edit envelope rules below. Use the <strong>Review</strong> button to run a review with a selected checklist.</>
                : <>This is a snapshot (copy) of the original checklist used in the last review &mdash; read-only. You can still modify <strong>envelope rules</strong> under the Envelope Rules tab because they are saved per envelope.</>
              }
            </span>
          </div>
        )}

        {/* Main Content with Tabs */}
        {(() => {
          // Envelope-rules-only mode: skip all tabs, show just envelope rules editor
          if (isEnvelopeRulesOnly) {
            return <EnvelopeChecklistEditor />;
          }

          const showEnvelopeTab = showTabs;
          const showScriptsTab = !isSnapshotChecklist;
          // Fixed tabs: Checklist Rules, Settings (2). Optional: Envelope, Scripts, Versions.
          const tabCount = 2 + (showEnvelopeTab ? 1 : 0) + (showScriptsTab ? 1 : 0) + (features.checklist_versions ? 1 : 0);
          // Static class literals so Tailwind's JIT scanner can pick them up.
          const gridColsClass = tabCount === 2 ? 'grid-cols-2' : tabCount === 3 ? 'grid-cols-3' : tabCount === 4 ? 'grid-cols-4' : 'grid-cols-5';
          const checklistRuleCount = showEnvelopeTab
            ? (editingChecklist?.rules || []).filter((r: any) => r.origin !== 'user').length
            : (editingChecklist?.rules || []).length;

          // Ensure activeTab is valid for the current tab set
          const validTabs = ['checklist', showEnvelopeTab && 'envelope', 'settings', showScriptsTab && 'scripts', features.checklist_versions && 'versions'].filter(Boolean) as string[];
          const effectiveTab = validTabs.includes(activeTab) ? activeTab : 'checklist';

          return (
            <Tabs value={effectiveTab} onValueChange={setActiveTab}>
              <TabsList className={`grid w-full ${gridColsClass}`}>
                <TabsTrigger value="checklist"><ClipboardCheck className="w-4 h-4 mr-1" />Checklist ({checklistRuleCount})</TabsTrigger>
                {showEnvelopeTab && (
                  <TabsTrigger value="envelope"><Mail className="w-4 h-4 mr-1" />Envelope Rules ({effectiveEnvelopeRules.length})</TabsTrigger>
                )}
                <TabsTrigger value="settings"><SettingsIcon className="w-4 h-4 mr-1" />Settings</TabsTrigger>
                {showScriptsTab && (
                  <TabsTrigger value="scripts"><Code2 className="w-4 h-4 mr-1" />Scripts</TabsTrigger>
                )}
                {features.checklist_versions && (
                  <TabsTrigger value="versions"><History className="w-4 h-4 mr-1" />Versions</TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="checklist" className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: 'calc(75vh - 150px)' }}>
                {ChecklistEditor()}
              </TabsContent>

              {showEnvelopeTab && (
                <TabsContent value="envelope" className="space-y-2">
                  {EnvelopeChecklistEditor()}
                </TabsContent>
              )}

              <TabsContent value="settings" className="space-y-4 overflow-y-auto pr-1" style={{ maxHeight: 'calc(75vh - 150px)' }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  {/* AI Model selector */}
                  <div>
                    {(() => {
                      const isModelEditable = editability ? editability.isModelEditable : true;

                      return (
                        <>
                          <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                            Default AI Model
                            {!isModelEditable && (
                              <FieldLockIcon
                                reason={isSnapshotChecklist ? "Frozen in review snapshot" : "Locked after review"}
                              />
                            )}
                          </Label>
                          <Select
                            value={editingChecklist?.ai_model || ''}
                            onValueChange={(v) => setEditingChecklist(prev => prev ? { ...prev, ai_model: v || undefined } : prev)}
                            disabled={!isModelEditable}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue placeholder="Select AI model" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableModels.map(model => (
                                <SelectItem key={model.id} value={model.id} disabled={model.disabled}>
                                  {formatModelOptionLabel(model)}
                                </SelectItem>
                              ))}
                              {editingChecklist?.ai_model && !availableModels.find(m => m.id === editingChecklist.ai_model) && (
                                <SelectItem value={editingChecklist.ai_model}>{editingChecklist.ai_model}</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          {!isModelEditable && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              AI model is locked after review. Click the lock icon to reset.
                            </p>
                          )}
                          {(() => {
                            const selectedModel = availableModels.find(m => m.id === editingChecklist?.ai_model);
                            return selectedModel ? (
                              <div className="mt-3">
                                <AiModelInfoCard model={selectedModel} />
                              </div>
                            ) : null;
                          })()}
                        </>
                      );
                    })()}
                  </div>

                  {/* Highlight Mode selector */}
                  <div>
                    <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                      Default Highlight Mode
                      {isSnapshotChecklist && (
                        <FieldLockIcon reason="Read-only in review snapshot" />
                      )}
                    </Label>
                    <div className="mt-1">
                      <HighlightModeSelect
                        value={editingChecklist?.highlight_mode ?? REVDOKU_DEFAULT_HIGHLIGHT_MODE}
                        onChange={(mode) => setEditingChecklist(prev => prev ? { ...prev, highlight_mode: mode } : prev)}
                        disabled={isSnapshotChecklist}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Can be switched in envelope view</p>
                  </div>
                </div>
              </TabsContent>

              {/* Scripts tab — only for non-snapshot checklists */}
              {showScriptsTab && (
                <TabsContent value="scripts" className="space-y-4 overflow-y-auto pr-1" style={{ maxHeight: 'calc(75vh - 150px)' }}>
                  <p className="text-xs text-muted-foreground">
                    This script auto-copies to the envelope when this checklist is used for inspection (if the envelope has no script yet).
                  </p>
                  <UserScriptEditor
                    code={checklistScript}
                    onCodeChange={setChecklistScript}
                    onTemplateSelect={(id, name) => { setChecklistScriptId(id); setChecklistScriptName(name); }}
                  />
                </TabsContent>
              )}

              {features.checklist_versions && (
                <TabsContent value="versions" className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: 'calc(75vh - 150px)' }}>
                  {isLoadingVersions ? (
                    <div className="text-sm text-muted-foreground">Loading versions...</div>
                  ) : versions && versions.length > 0 ? (
                    <ul className="divide-y divide-border border border-border rounded-md">
                      {versions.map((v: any, idx: number) => {
                        const ts = v.updated_at || v.created_at;
                        const when = ts ? new Date(ts).toLocaleString() : '';
                        const changes = v.changes || {};
                        const changeKeys = Object.keys(changes);
                        const summary = changeKeys.length
                          ? `Changed: ${changeKeys.slice(0, 4).join(', ')}${changeKeys.length > 4 ? '…' : ''}`
                          : 'Updated';
                        return (
                          <li key={v.id || idx} className="p-3 flex items-start justify-between gap-3">
                            <div className="text-sm">
                              <div className="font-medium text-foreground">
                                {v.name || checklist?.name} {v.revision_number ? `(v${v.revision_number})` : ''}
                              </div>
                              <div className="text-muted-foreground flex items-center gap-2">
                                <span>{when}</span>
                                {v.rules && (
                                  <span>• {v.rules.length} rules</span>
                                )}
                                <span>• {summary}</span>
                              </div>
                            </div>
                            {onRollbackVersion && (
                              <div className="shrink-0 pt-1">
                                <button
                                  className="text-indigo-600 hover:underline text-sm"
                                  onClick={() => {
                                    if (window.confirm('Rollback to this version? This will replace current checklist contents.')) {
                                      handleRollback(v);
                                    }
                                  }}
                                  title="Rollback to this version"
                                >
                                  Rollback To This Version
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="text-sm text-muted-foreground">No versions found.</div>
                  )}
                </TabsContent>
              )}
            </Tabs>
          );
        })()}

        {/* Status Messages */}
        {error && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-md">
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}
        {successMessage && (
          <div className="mt-4 p-3 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 rounded-md">
            <p className="text-sm text-green-800 dark:text-green-300">{successMessage}</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-red-300 dark:border-red-700 bg-card p-2 text-red-700 dark:text-red-400 shadow-sm hover:bg-red-50 dark:hover:bg-red-950 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 mr-auto"
            onClick={handleDeleteChecklist}
            title="Delete Checklist"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>

          <Button
            variant="outline"
            onClick={onClose}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          {showOnboardingHints && !isSnapshotChecklist ? (
            <OnboardingHint
              hintKey="guide-save-checklist"
              message="Save your checklist when ready"
              position="top"
              align="end"
            >
              <Button
                onClick={handleSaveChecklist}
                disabled={isProcessing || (isSnapshotChecklist && !hasEnvelopeRuleChanges && !(editability?.isModelEditable && editingChecklist?.ai_model !== checklist?.ai_model))}
                className="bg-indigo-600 hover:bg-indigo-700"
                title={isSnapshotChecklist ? 'Snapshot checklists cannot be edited directly. Switch to a different checklist to make changes.' : undefined}
              >
                {isProcessing ? 'Saving...' : 'Save Changes'}
              </Button>
            </OnboardingHint>
          ) : (
            <Button
              onClick={handleSaveChecklist}
              disabled={isProcessing || (isSnapshotChecklist && !hasEnvelopeRuleChanges && !(editability?.isModelEditable && editingChecklist?.ai_model !== checklist?.ai_model))}
              className="bg-indigo-600 hover:bg-indigo-700"
              title={isSnapshotChecklist ? 'Snapshot checklists cannot be edited directly. Switch to a different checklist to make changes.' : undefined}
            >
              {isProcessing ? 'Saving...' : 'Save Changes'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {/* AI Rule Generation Dialog */}
      <AddChecklistDialog
        isOpen={showGenerateRules}
        onClose={() => {
          setShowGenerateRules(false);
          setGenerateError(null);
          setGenerateSourceRuleKey(null);
          setGenerateInitialText('');
          setGenerateTarget('checklist');
        }}
        onGenerate={handleGenerateRules}
        checklistSourceText={editingChecklist?.source_text}
        onNeedAIModel={(sourceText, includeAgreement) => {
          setPendingRulesSourceText(sourceText);
          setIncludeAgreementInGeneration(!!includeAgreement);
          setGenerateInitialText(sourceText);
          setShowGenerateRules(false);
          setShowRulesModelSelection(true);
        }}
        isProcessing={isGeneratingRules}
        error={generateError}
        mode="rules"
        initialText={generateInitialText}
      />

      {/* AI Model Selection for rules generation */}
      <AIModelSelectionDialog
        isOpen={showRulesModelSelection}
        onClose={() => { setShowRulesModelSelection(false); setGenerateTarget('checklist'); }}
        title="Generate rules"
        description="Choose how to generate rules"
        onSelect={async (modelId) => {
          if (modelId === null) {
            setShowRulesModelSelection(false);
            // "Manually, no AI" — parse freeform text into rules
            const lines = parseTextToRulePrompts(pendingRulesSourceText);
            if (lines.length > 0) {
              const currentTime = new Date().toISOString();
              const newRules = lines.map((prompt) => ({
                id: `temp_${uuidv4()}`,
                prompt,
                order: 0,
                _localKey: uuidv4(),
                updated_at: currentTime,
                checks: null,
              }));

              if (generateTarget === 'envelope') {
                let existingEnvRules = editingRules;
                if (generateSourceRuleKey) {
                  existingEnvRules = existingEnvRules.filter((r: any) =>
                    (r._localKey || r.id) !== generateSourceRuleKey
                  );
                }
                const combined = [...existingEnvRules, ...newRules].map((r, idx) => ({
                  ...r,
                  order: idx + (editingChecklist?.rules.length || 0),
                  updated_at: currentTime,
                }));
                setEditingRules(combined);
              } else if (editingChecklist) {
                let existingRules = editingChecklist.rules;
                if (generateSourceRuleKey) {
                  existingRules = existingRules.filter((r: any) =>
                    (r._localKey || r.id) !== generateSourceRuleKey
                  );
                }
                const combined = [...existingRules, ...newRules].map((r, idx) => ({
                  ...r,
                  order: idx,
                  updated_at: currentTime,
                }));
                setEditingChecklist({ ...editingChecklist, rules: combined });
              }
              showToast(`Added ${lines.length} rule${lines.length === 1 ? '' : 's'} from text`);
            }
            setGenerateSourceRuleKey(null);
            setGenerateInitialText('');
          } else {
            // AI generation — keep dialog open to show "Processing..." spinner
            const success = await handleGenerateRules(pendingRulesSourceText, modelId);
            setShowRulesModelSelection(false);
            if (!success) {
              // Reopen text entry dialog so user sees the error
              setShowGenerateRules(true);
            }
          }
        }}
        onBack={() => {
          setShowRulesModelSelection(false);
          setShowGenerateRules(true);
        }}
        isProcessing={isGeneratingRules}
        purpose="checklist_generation"
        showManualOption={true}
      />
    </Dialog>
  );
}
