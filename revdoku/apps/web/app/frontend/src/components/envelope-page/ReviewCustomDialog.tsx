import { useState, useEffect, useMemo, useRef } from 'react';
import { AlertCircle, ClipboardCheck, Info, Search, Sparkles, Paperclip, Loader2, X, Check, Upload } from 'lucide-react';
import { scanChecklistForMarkers, CHECKLIST_SYSTEM_PROMPT_SCOPE } from '@/lib/rule-file-markers';
import type { ScopedPromptMarker } from '@/lib/rule-file-markers';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getLoadedModels, getDefaultModelId, getDefaultTextExtractionModelId, setLoadedModels, formatModelOptionLabel, buildPickerOptions } from '@/lib/ai-model-utils';
import { ApiClient } from '@/lib/api-client';
import { apiRequest, apiJsonResponse } from '@/config/api';
import type { IAIModelOption } from '@/lib/ai-model-utils';
import { HighlightMode, REVDOKU_DEFAULT_HIGHLIGHT_MODE } from '@revdoku/lib';
import HighlightModeSelect from '@/components/envelope-page/HighlightModeSelect';
import type { IChecklist } from '@revdoku/lib';
import { MAX_AD_HOC_REF_FILES, MAX_REVIEW_NOTE_LENGTH } from '@/lib/constants';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { REF_FILE_THEME } from '@/lib/ref-file-theme';
import { SUPPORT_EMAIL } from '@/lib/support';

// A pending reference file the parent needs to resolve before running
// inspection. Either a browser File the user just picked (needs upload +
// normalization) or a previously-uploaded library revision (ready to use
// immediately). Both are handed back to the parent via onReview and
// processed by PrepareReviewDialog before the actual review fires.
interface ReviewCustomDialogProps {
  envelopeId?: string;
  isOpen: boolean;
  onClose: () => void;
  onReview: (options: {
    modelId: string;
    trackChanges: boolean;
    checklistId?: string;
    highlightMode?: number;
    // Already resolved: the dialog uploads each picked file just before
    // calling onReview (no eager upload at pick time). Each entry is a
    // ready-to-pin (rule_id, document_file_revision_id) pair.
    referenceFiles?: Array<{ rule_id: string | null; document_file_revision_id: string; save_to_library?: boolean }>;
    // Per-review user context. Goes to Rails → doc-api → prepended to the
    // AI system prompt inside a <review_context> block for this run only.
    reviewNote?: string;
    // Ad-hoc reference files the user attached even though the checklist
    // didn't request them via #ref[...]. Up to MAX_AD_HOC_REFS entries.
    // Rails builds synthetic #ref markers for each so the existing
    // doc-api token-substitution path handles them with no extra code.
    adHocRefFiles?: Array<{ document_file_revision_id: string; label?: string }>;
    // Locally-known count of ref files that will participate in this
    // review (pinned #ref[...] slots + ad-hoc refs). Surfaced on the
    // inspection splash immediately so users see "Using N reference
    // files" before the job enters its phase-0 preparation window.
    refFilesTotal?: number;
  }) => void;
  currentChecklist: IChecklist | null;
  latestChecklists?: IChecklist[];
  defaultModelId?: string;
  title?: string;
  errorMessage?: string;
  submitLabel?: string;
  variant?: 'default' | 'error' | 'cancelled';
  pageCount?: number | null;
  creditBalance?: number | null;
  onCreateChecklist?: () => void;
  onViewChecklist?: (checklistId: string) => void;
  defaultChecklistId?: string | null;
  isChecklistLocked?: boolean;
  lockedChecklistName?: string;
  lockedChecklistRuleCount?: number;
  previousPassedCount?: number;
  previousFailedCount?: number;
  envelopeRuleCount?: number;
  /** Ref files already pinned to this envelope_revision (or any prior
   *  revision of the same envelope). Used to pre-fill the reference
   *  slots so re-running Review on the same checklist doesn't ask the
   *  user to re-select files they already provided. */
  existingRefFiles?: Array<{
    rule_id: string | null;
    document_file_revision_prefix_id: string;
    filename: string;
  }>;
  /** Pre-existing review_note from the current report's
   *  inspection_context. When non-empty the "Add note" section auto-
   *  expands on open so the user can edit rather than re-type. */
  existingReviewNote?: string | null;
  /** Pre-existing ad-hoc reference files from the current report's
   *  inspection_context. Same pre-fill story as existingReviewNote. */
  existingAdHocRefFiles?: Array<{
    document_file_revision_id: string;
    label?: string;
    filename?: string;
  }>;
  /** True when the envelope has a revision before the current one —
   *  i.e. catch-changes has something to compare against. Gates the
   *  "Mark changes not covered by any rules as failed checks" checkbox;
   *  hidden entirely on first revisions. */
  hasPreviousRevision?: boolean;
  /** Whether catch-changes was on for the current report's last run.
   *  Seeds the checkbox so re-opening the Review dialog preserves the
   *  user's most recent choice. null/undefined → default unchecked. */
  existingTrackChanges?: boolean | null;
}

export default function ReviewCustomDialog({
  isOpen,
  onClose,
  onReview,
  currentChecklist,
  latestChecklists = [],
  defaultModelId,
  title,
  errorMessage,
  submitLabel,
  variant = 'default',
  pageCount,
  creditBalance,
  onCreateChecklist,
  onViewChecklist,
  defaultChecklistId,
  isChecklistLocked,
  lockedChecklistName,
  lockedChecklistRuleCount,
  previousPassedCount,
  previousFailedCount,
  envelopeRuleCount,
  envelopeId,
  existingRefFiles,
  existingReviewNote,
  existingAdHocRefFiles,
  hasPreviousRevision,
  existingTrackChanges,
}: ReviewCustomDialogProps) {
  const features = useFeatureFlags();
  // AI model priority: user override from this dialog → the checklist's
  // own ai_model → Rails default → first enabled model. The picker is
  // shown on every open so users can drop to Basic (20 cr/page) to save
  // credits on simple documents or bump to Premium for tricky layouts.
  // Seeded default checklists pin Standard (40 cr/page) — reliable on
  // multi-file citation and structured output.
  // Always start empty — the picker re-fetches via buildPickerOptions on
  // open. Seeding from getLoadedModels() leaks the raw concrete-models
  // cache (see useEffect below).
  const [models, setModels] = useState<IAIModelOption[]>([]);
  const [modelOverride, setModelOverride] = useState<string>('');
  const [trackChanges, setTrackChanges] = useState(false);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>(REVDOKU_DEFAULT_HIGHLIGHT_MODE);
  const [selectedChecklistId, setSelectedChecklistId] = useState<string>('');
  const [fetchedBalance, setFetchedBalance] = useState<number | null>(null);
  const [checklistShake, setChecklistShake] = useState(false);
  // Reference files the user has attached, keyed by slotKey (= scope_key
  // plus position) so checklists with multiple markers under the same
  // scope — e.g. two `#ref[...]` markers in a single system_prompt —
  // track each slot independently. Two kinds of entries:
  //   - { file, save_in_library } — a browser File the user just picked;
  //     the raw File object is held in memory until Run Review is clicked.
  //     No network call on pick.
  //   - { revision_id } — a previously-uploaded library revision the user
  //     picked from the "Recently used" suggestions. Already ready on
  //     the server, skipped during the prepare-review upload phase.
  type RefFileSlot =
    | { kind: 'file'; file: File; filename: string; save_in_library: boolean }
    | { kind: 'library'; revision_id: string; filename: string };

  // Composite key for a single reference-file slot. Uses `|` (not `:`)
  // as the separator because rule ids can legitimately contain `:`.
  const slotKey = (m: ScopedPromptMarker) => `${m.scope_key}|${m.position}`;

  // Build the initial refFiles state from the envelope_revision's
  // already-pinned files. Pins are matched to markers by (rule_id,
  // position): group pins by rule_id preserving array order as position,
  // then each marker at position `p` claims pin #p within its rule group.
  // This handles multi-marker scopes (e.g., two system-prompt `#ref[...]`
  // markers both with rule_id=null) without the two slots collapsing
  // onto the same pin.
  function buildPrefilledRefFiles(
    checklist: IChecklist | null,
    pins: ReviewCustomDialogProps['existingRefFiles'],
  ): Record<string, RefFileSlot> {
    if (!checklist || !pins || pins.length === 0) return {};
    const markers = scanChecklistForMarkers({
      rules: checklist.rules,
      system_prompt: (checklist as any).system_prompt,
    });
    // Group pins by rule_id preserving array order.
    const pinsByRule = new Map<string | null, typeof pins>();
    for (const p of pins) {
      const bucket = pinsByRule.get(p.rule_id);
      if (bucket) bucket.push(p);
      else pinsByRule.set(p.rule_id, [p]);
    }
    const out: Record<string, RefFileSlot> = {};
    for (const m of markers) {
      const wantRuleId = m.scope_key === CHECKLIST_SYSTEM_PROMPT_SCOPE ? null : m.scope_key;
      const bucket = pinsByRule.get(wantRuleId);
      if (!bucket) continue;
      const hit = bucket[m.position];
      if (hit) {
        out[slotKey(m)] = {
          kind: 'library',
          revision_id: hit.document_file_revision_prefix_id,
          filename: hit.filename,
        };
      }
    }
    return out;
  }
  const [refFiles, setRefFiles] = useState<Record<string, RefFileSlot>>({});
  // "Add note" section — collapsed by default. Holds a single free-text
  // note for the AI plus up to MAX_AD_HOC_REF_FILES attached reference
  // files, both of which travel with this specific review only (stored
  // on the report's inspection_context server-side).
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  // Sparse array of ad-hoc ref slots. Length grows as the user clicks
  // "Attach reference file"; removing a slot splices it out. A null
  // entry means the slot is visible but no file has been picked yet.
  const [adHocRefs, setAdHocRefs] = useState<Array<RefFileSlot | null>>([]);
  const adHocInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  // All library files fetched once on dialog open — used as the combobox
  // dropdown for every ref-file slot. Client-side filtered by query text.
  const [libraryFiles, setLibraryFiles] = useState<Array<{ prefix_id: string; latest_revision: { prefix_id: string; name: string; mime_type: string; byte_size: number; uploaded_at: string } }>>([]);
  const refFilesInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Submission state: while the dialog is uploading the picked files
  // before firing onReview, buttons are disabled and a status message
  // sits above the Run button.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Amber inline banner shown when user clicks Run Review with one or more
  // unfilled reference-file slots. Clicking Run a second time (or the "Run
  // anyway" button) proceeds with the inspection; "Go back" clears the banner.
  const [pendingConfirm, setPendingConfirm] = useState(false);

  // Use prop if provided, otherwise use fetched value
  const effectiveBalance = creditBalance ?? fetchedBalance;

  useEffect(() => {
    if (!isOpen) return;
    // Always re-fetch — the global getLoadedModels() cache stores the raw
    // concrete-models array (used by splash labels), so seeding from it
    // would render every cloud-provider concrete model alongside the
    // aliases. The picker needs buildPickerOptions filtering applied.
    ApiClient.getModels()
      .then(res => {
        const fetched = res.models || [];
        const aliases = res.aliases || [];
        setLoadedModels(fetched, res.default_model_id, res.default_checklist_generation_model_id, res.default_text_extraction_model_id, aliases);
        // Picker shows aliases (smart fallbacks) + the user's own
        // Custom-LLM models. Cloud-provider concrete models (GPT-4.1
        // etc.) are alias targets and don't surface as picker rows.
        setModels(buildPickerOptions({ aliases, models: fetched, providers: res.providers }));
      })
      .catch(() => { });
    // Fetch credit balance when dialog opens
}, [isOpen]);

  // Initialize checklist selection and trackChanges when dialog opens
  useEffect(() => {
    if (!isOpen) return;
    // Prefer explicit default, then source template of current snapshot, then current checklist.
    // IMPORTANT: when initializing to the snapshot, prefix with `__snapshot__`
    // so the <select> value doesn't collide with the template option that
    // has the same underlying checklist prefix_id (because
    // inspection_context.checklist.id stores the template's prefix_id, not
    // the snapshot's row id).
    let initialId = defaultChecklistId || '';
    if (!initialId && currentChecklist) {
      if (currentChecklist.checklist_type === 'report_snapshot') {
        const sourceId = (currentChecklist as any).source_checklist_id;
        const sourceInList = sourceId ? latestChecklists.find(c => c.id === sourceId) : null;
        initialId = sourceInList ? sourceInList.id : `__snapshot__${currentChecklist.id}`;
      } else {
        initialId = currentChecklist.id;
      }
    }
    setSelectedChecklistId(initialId);
    const rawId = initialId.replace('__snapshot__', '');
    const initialChecklist = rawId
      ? (latestChecklists.find(c => c.id === rawId) || (currentChecklist?.id === rawId ? currentChecklist : null))
      : currentChecklist;
    // Track-changes is a per-review runtime flag (no longer a checklist
    // property). Seed from the last report's inspection_context via
    // existingTrackChanges; default off on first-time reviews.
    setTrackChanges(existingTrackChanges === true);
    setHighlightMode(initialChecklist?.highlight_mode ?? REVDOKU_DEFAULT_HIGHLIGHT_MODE);
    // Pre-fill reference slots from whatever the envelope_revision (or
    // any older revision of the same envelope) already had pinned.
    // The user can still swap via the combobox, but we stop asking them
    // to re-upload files they already provided.
    setRefFiles(buildPrefilledRefFiles(initialChecklist, existingRefFiles));
    // Pre-fill review_note + ad-hoc refs from the previous run so
    // re-running doesn't lose the user's context. Auto-expand the
    // "Add note" section when either has content.
    const prefilledNote = (existingReviewNote || '').slice(0, MAX_REVIEW_NOTE_LENGTH);
    setReviewNote(prefilledNote);
    const prefilledAdHoc: Array<RefFileSlot | null> = (existingAdHocRefFiles || [])
      .slice(0, MAX_AD_HOC_REF_FILES)
      .map(r => ({
        kind: 'library' as const,
        revision_id: r.document_file_revision_id,
        filename: r.filename || r.label || r.document_file_revision_id,
      }));
    setAdHocRefs(prefilledAdHoc);
    setNoteExpanded(prefilledNote.length > 0 || prefilledAdHoc.length > 0);
    setModelOverride('');
    setSubmitting(false);
    setSubmitError(null);
    setPendingConfirm(false);
  }, [isOpen]);

  // Derive the active checklist from the selected ID. The snapshot option
  // uses a `__snapshot__` prefix to avoid value collisions with the
  // template that has the same underlying id (snapshot's
  // inspection_context.checklist.id stores the template's prefix_id).
  const isSnapshotSelected = selectedChecklistId.startsWith('__snapshot__');
  const effectiveChecklistId = isSnapshotSelected
    ? selectedChecklistId.replace('__snapshot__', '')
    : selectedChecklistId;
  const activeChecklist = effectiveChecklistId
    ? (isSnapshotSelected
      ? currentChecklist
      : latestChecklists.find(c => c.id === effectiveChecklistId) || currentChecklist || null)
    : null;

  // When checklist selection changes, update trackChanges / highlight
  // mode and clear any previously attached reference files (they
  // belonged to the old checklist's markers). The AI model is always
  // read from the active checklist — no dialog-level state to update.
  const handleChecklistChange = (checklistId: string) => {
    setSelectedChecklistId(checklistId);
    setSubmitError(null);
    setPendingConfirm(false);
    const checklist = latestChecklists.find(c => c.id === checklistId) || (currentChecklist?.id === checklistId ? currentChecklist : null);
    if (checklist) {
      // Track-changes is per-review, not per-checklist — keep the user's
      // current choice when they switch between checklists.
      setHighlightMode(checklist.highlight_mode ?? REVDOKU_DEFAULT_HIGHLIGHT_MODE);
    }
    // Re-seed from existing pins whose rule_id matches a marker in the
    // newly-selected checklist (pins for the OLD checklist are dropped).
    setRefFiles(buildPrefilledRefFiles(checklist, existingRefFiles));
  };

  // Resolve the effective AI model. Priority: user override (retry mode
  // only) → active checklist's ai_model → prop default → Rails default →
  // first enabled model. Both the id and the full option are needed —
  // the id goes to onReview, the option feeds the cost estimate.
  const effectiveModel = useMemo(() => {
    if (models.length === 0) return { id: '', option: undefined as IAIModelOption | undefined };
    const enabled = models.filter(m => !m.disabled);
    const candidates = [modelOverride, activeChecklist?.ai_model, defaultModelId, getDefaultModelId(), enabled[0]?.id].filter(Boolean) as string[];
    const chosen = candidates.find(id => models.some(m => m.id === id && !m.disabled)) || enabled[0]?.id || '';
    return { id: chosen, option: models.find(m => m.id === chosen) };
  }, [modelOverride, activeChecklist?.ai_model, defaultModelId, models]);

  const selected = effectiveModel.id;
  const selectedModel = effectiveModel.option;
  const rules = activeChecklist?.rules || [];
  const userRules = rules.filter((r: { origin?: string }) => r.origin === 'user').length;
  const templateRules = rules.length - userRules;

  // Reference-file markers required by the selected checklist. Recomputed
  // whenever the checklist changes. One slot per marker; v1 has at most
  // one marker per rule or per checklist system_prompt.
  const requiredMarkers: ScopedPromptMarker[] = useMemo(() => {
    if (!activeChecklist) return [];
    return scanChecklistForMarkers({
      rules: activeChecklist.rules,
      system_prompt: activeChecklist.system_prompt,
    });
  }, [activeChecklist]);

  const checklistLabel = (c: IChecklist | null) => {
    if (!c) return '';
    try {
      const ruleCount = c.rules?.length || 0;
      const refCount = scanChecklistForMarkers({ rules: c.rules, system_prompt: (c as any).system_prompt }).length;
      const parts = [`${ruleCount} rules`];
      if (refCount > 0) parts.push(`${refCount} ref file${refCount > 1 ? 's' : ''}`);
      return `${c.name} (${parts.join(', ')})`;
    } catch {
      return `${c.name} (${c.rules?.length || 0} rules)`;
    }
  };

  // Reference slot fill tracking. Ref files are now **optional** — the Run
  // button stays enabled even when slots are empty, but we warn the user
  // before kicking off the review via an inline amber confirm banner. A
  // slot is "filled" when the user has picked a file from disk or the
  // library suggestions list.
  const filledSlotCount = requiredMarkers.filter(m => refFiles[slotKey(m)] != null).length;
  const unfilledSlotCount = requiredMarkers.length - filledSlotCount;

  // Load all library files once when the dialog opens — powers the
  // combobox dropdown for every ref-file slot.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest('/files');
        if (!res.ok) throw new Error();
        const body = await apiJsonResponse(res) as { files: typeof libraryFiles };
        if (!cancelled) setLibraryFiles(body.files || []);
      } catch {
        if (!cancelled) setLibraryFiles([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Pick a file from the user's disk. Held in memory as a raw File until
  // Run Review is clicked — no eager upload. The "Save in Files for
  // reuse" checkbox defaults to off; user toggles before clicking Run.
  // `slot` is the composite `${scope_key}|${position}` key.
  const handleRefFilePick = (slot: string, file: File) => {
    setRefFiles(prev => ({
      ...prev,
      [slot]: { kind: 'file', file, filename: file.name, save_in_library: false },
    }));
    setSubmitError(null);
  };

  // Toggle the "Save to Files Library" flag on a picked file. Has no
  // effect on library-picked entries.
  const handleRefFileSaveToggle = (slot: string, save: boolean) => {
    setRefFiles(prev => {
      const entry = prev[slot];
      if (!entry || entry.kind !== 'file') return prev;
      return { ...prev, [slot]: { ...entry, save_in_library: save } };
    });
  };

  const handleRefFilePickFromLibrary = (slot: string, revisionId: string, filename: string) => {
    setRefFiles(prev => ({
      ...prev,
      [slot]: { kind: 'library', revision_id: revisionId, filename },
    }));
    setSubmitError(null);
  };

  const handleRefFileRemove = (slot: string) => {
    setRefFiles(prev => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    const input = refFilesInputRefs.current[slot];
    if (input) input.value = '';
  };

  // Ad-hoc ref handlers — operate on `adHocRefs`. The "next-slot" ghost
  // combobox (rendered whenever adHocRefs.length < MAX) appends directly
  // on pick; existing filled slots still support pick/remove so an
  // already-picked file can be swapped.
  const handleAdHocAppendFile = (file: File) => {
    setAdHocRefs(prev => (
      prev.length >= MAX_AD_HOC_REF_FILES
        ? prev
        : [...prev, { kind: 'file', file, filename: file.name, save_in_library: false }]
    ));
    setSubmitError(null);
  };
  const handleAdHocAppendLibrary = (revisionId: string, filename: string) => {
    setAdHocRefs(prev => (
      prev.length >= MAX_AD_HOC_REF_FILES
        ? prev
        : [...prev, { kind: 'library', revision_id: revisionId, filename }]
    ));
    setSubmitError(null);
  };
  const handleAdHocPick = (idx: number, file: File) => {
    setAdHocRefs(prev => {
      const next = [...prev];
      next[idx] = { kind: 'file', file, filename: file.name, save_in_library: false };
      return next;
    });
    setSubmitError(null);
  };
  const handleAdHocPickLibrary = (idx: number, revisionId: string, filename: string) => {
    setAdHocRefs(prev => {
      const next = [...prev];
      next[idx] = { kind: 'library', revision_id: revisionId, filename };
      return next;
    });
    setSubmitError(null);
  };
  const handleAdHocRemove = (idx: number) => {
    setAdHocRefs(prev => prev.filter((_, i) => i !== idx));
    const input = adHocInputRefs.current[idx];
    if (input) input.value = '';
  };
  const handleAdHocSaveToggle = (idx: number, save: boolean) => {
    setAdHocRefs(prev => {
      const next = [...prev];
      const entry = next[idx];
      if (entry && entry.kind === 'file') next[idx] = { ...entry, save_in_library: save };
      return next;
    });
  };

  // Starts the review. When there are unfilled reference slots and the
  // user hasn't confirmed yet, this raises the amber "continue anyway?"
  // banner instead of running. On explicit confirm (via "Run anyway") or
  // when every slot is filled, it uploads picked files and fires onReview.
  const runReview = async (confirmed: boolean) => {
    if (!effectiveChecklistId) {
      setChecklistShake(true);
      setTimeout(() => setChecklistShake(false), 600);
      return;
    }
    if (!selected) return;
    if (unfilledSlotCount > 0 && !confirmed) {
      setPendingConfirm(true);
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    // Upload files the user picked from their disk. This just persists raw
    // bytes — OCR / normalization runs as a background job that
    // CreateReportJob's phase-0 waits on. POSTs are sub-second per file.
    // Empty slots are simply skipped (optional-ref behavior).
    const resolved: Array<{ rule_id: string | null; document_file_revision_id: string; save_to_library?: boolean }> = [];
    try {
      for (const m of requiredMarkers) {
        const entry = refFiles[slotKey(m)];
        if (!entry) continue;
        let revisionId: string;
        if (entry.kind === 'library') {
          revisionId = entry.revision_id;
        } else {
          const { latest_revision } = await ApiClient.uploadFile({
            file: entry.file,
            envelope_id: envelopeId,
          });
          revisionId = latest_revision.prefix_id;
        }
        resolved.push({
          rule_id: m.scope_key === CHECKLIST_SYSTEM_PROMPT_SCOPE ? null : m.scope_key,
          document_file_revision_id: revisionId,
          save_to_library: entry.kind === 'file' ? entry.save_in_library : false,
        });
      }
    } catch (err: any) {
      setSubmitting(false);
      setPendingConfirm(false);
      setSubmitError(err?.message || 'File upload failed');
      return;
    }

    // Upload any ad-hoc ref files the user picked from disk (library
    // picks are already server-side revisions). Skip null/empty slots.
    const adHocResolved: Array<{ document_file_revision_id: string; label?: string }> = [];
    try {
      for (const entry of adHocRefs) {
        if (!entry) continue;
        let revisionId: string;
        if (entry.kind === 'library') {
          revisionId = entry.revision_id;
        } else {
          const { latest_revision } = await ApiClient.uploadFile({
            file: entry.file,
            envelope_id: envelopeId,
          });
          revisionId = latest_revision.prefix_id;
        }
        adHocResolved.push({
          document_file_revision_id: revisionId,
          label: entry.filename,
        });
      }
    } catch (err: any) {
      setSubmitting(false);
      setPendingConfirm(false);
      setSubmitError(err?.message || 'Attached reference upload failed');
      return;
    }

    setSubmitting(false);
    setPendingConfirm(false);

    const trimmedNote = reviewNote.trim();
    // Only send review_note / ad_hoc_ref_files keys when the user has
    // interacted with the note section — either has content now or had
    // content that they explicitly cleared. If the section was never
    // expanded, omit the keys so the server preserves any prior values
    // on re-runs.
    const shouldSendNoteKeys = noteExpanded || (existingReviewNote ?? '') !== '' || (existingAdHocRefFiles || []).length > 0;

    // Count includes pinned #ref[...] slots (requiredMarkers, one per rule)
    // plus ad-hoc refs attached via "Add note". Both arrays reflect what
    // the server will ultimately pin, so the splash subtitle matches phase-0
    // data once polling catches up.
    const refFilesTotal = requiredMarkers.length + adHocResolved.length;

    onReview({
      modelId: selected,
      trackChanges,
      checklistId: effectiveChecklistId,
      highlightMode,
      referenceFiles: resolved.length > 0 ? resolved : undefined,
      reviewNote: shouldSendNoteKeys ? trimmedNote : undefined,
      adHocRefFiles: shouldSendNoteKeys ? adHocResolved : undefined,
      refFilesTotal: refFilesTotal > 0 ? refFilesTotal : undefined,
    });
  };

  // Credit estimate — mirrors backend formula in
  // reports_controller.rb#create (`cost_per_page = inspection_cpp +
  // (track_changes ? text_extraction_cpp : 0)`). Drops the old
  // `trackChanges ? 2 : 1` shortcut which consistently understated the
  // real charge. When track-changes is on, doc-api runs a separate
  // text-extraction pass on every page of the current revision using
  // the account's configured text-extraction model (Basic by default);
  // we pull that model's real `credits_per_page` from /ai_models so the
  // number the user sees matches the number they get charged.
  const creditsPerPage = selectedModel?.credits_per_page ?? 10;
  const textExtractionModelId = getDefaultTextExtractionModelId();
  const extractCreditsPerPage = models.find(m => m.id === textExtractionModelId)?.credits_per_page ?? 0;
  const costPerPage = creditsPerPage + (trackChanges ? extractCreditsPerPage : 0);
  // Use actual page count from viewer; fall back to model max_pages when unknown
  const estimatedPages = (pageCount != null && pageCount > 0)
    ? pageCount
    : (selectedModel?.max_pages ?? 1);
  const requiredCredits = estimatedPages * costPerPage;
  const affordablePages = effectiveBalance != null && costPerPage > 0
    ? Math.floor(effectiveBalance / costPerPage)
    : null;
  const cannotAffordAny = affordablePages != null && affordablePages < 1;
  const partialAfford = affordablePages != null && !cannotAffordAny && affordablePages < estimatedPages;

  const isError = variant === 'error';
  const isCancelled = variant === 'cancelled';
  const TitleIcon = isError ? AlertCircle : isCancelled ? Info : Search;
  const titleIconColor = isError ? 'text-red-500' : isCancelled ? 'text-blue-500' : 'text-indigo-500';
  const dialogTitle = title || 'Review Envelope';
  const buttonLabel = submitLabel || 'Run Review';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TitleIcon className={`h-5 w-5 ${titleIconColor}`} />
            {dialogTitle}
          </DialogTitle>
          {!errorMessage && !isError && !isCancelled && (
            <DialogDescription className="sr-only">
              Review envelope options
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4 py-2">
          {errorMessage && (
            <div className={`text-sm rounded-lg border px-3 py-2 ${isError
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300'
              : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
              }`}>
              {errorMessage}
            </div>
          )}
          {errorMessage && isError && errorMessage.startsWith('Provider rejected the API key') && (
            <p className="text-xs text-muted-foreground">
              <a
                href="/account/ai"
                className="underline text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                Open AI settings
              </a>{' '}
              to update or test your provider key.
            </p>
          )}
          {errorMessage && isError && SUPPORT_EMAIL && !errorMessage.startsWith('Provider rejected the API key') && (
            <p className="text-xs text-muted-foreground">
              If this keeps happening,{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Review error')}&body=${encodeURIComponent(`Hi,\n\nI encountered an error while running a review:\n\n"${errorMessage}"\n\nPlease help.\n`)}`}
                className="underline text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                contact support
              </a>
              .
            </p>
          )}

          {/* Checklist selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <ClipboardCheck className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />
                Checklist:
              </label>
              {effectiveChecklistId && onViewChecklist && (
                <button
                  type="button"
                  onClick={() => onViewChecklist(effectiveChecklistId)}
                  className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 underline cursor-pointer"
                >
                  View
                </button>
              )}
            </div>
            {isChecklistLocked ? (
              <div className="w-full py-1.5 px-3 border rounded-lg text-sm bg-muted/30 text-foreground border-border space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium text-indigo-500 flex-shrink-0">[Snapshot]</span>
                  <span className="font-medium">{lockedChecklistName || currentChecklist?.name || 'Checklist'}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {lockedChecklistRuleCount != null && <span>{lockedChecklistRuleCount} rules</span>}
                  {envelopeRuleCount != null && envelopeRuleCount > 0 && <span>+ {envelopeRuleCount} envelope rules</span>}
                  {previousPassedCount != null && <span className="text-green-600">{previousPassedCount} passed</span>}
                  {previousFailedCount != null && previousFailedCount > 0 && <span className="text-red-600">{previousFailedCount} failed</span>}
                </div>
              </div>
            ) : latestChecklists.length > 0 ? (
              <select
                value={selectedChecklistId}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    onCreateChecklist?.();
                    e.target.value = selectedChecklistId;
                    return;
                  }
                  setChecklistShake(false);
                  handleChecklistChange(e.target.value);
                }}
                className={`w-full py-1.5 px-2 border rounded text-sm bg-background text-foreground ${checklistShake ? 'border-red-500 ring-2 ring-red-500/30 animate-shake'
                  : !effectiveChecklistId ? 'border-red-500 ring-2 ring-red-500/30'
                    : 'border-border'
                  }`}
              >
                {!effectiveChecklistId && (
                  <option value="">-- Select checklist --</option>
                )}
                {onCreateChecklist && (
                  <>
                    <option value="__new__">-- Create New Checklist --</option>
                    <option disabled>{'─'.repeat(30)}</option>
                  </>
                )}
                {currentChecklist?.checklist_type === 'report_snapshot' && currentChecklist?.name && (
                  <optgroup label="Current envelope">
                    <option value={`__snapshot__${currentChecklist.id}`}>
                      [Snapshot] {checklistLabel(currentChecklist)}
                    </option>
                  </optgroup>
                )}
                <optgroup label="Your checklists">
                  {latestChecklists.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {checklistLabel(cl)}
                    </option>
                  ))}
                </optgroup>
              </select>
            ) : (
              <div className="text-sm rounded-lg border border-border bg-muted/50 px-3 py-2 flex items-center gap-1.5">
                {activeChecklist ? (
                  <>
                    <span className="font-medium truncate">{activeChecklist.name}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      ({userRules > 0 ? `${templateRules} + ${userRules} manual` : `${rules.length} rules`})
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">No checklists available</span>
                )}
              </div>
            )}
            {/* Collapsed-state "Add note" link — lives inside the checklist
                group's space-y-2 container so it sits right under the
                combobox with tight spacing. Right-aligned to match the
                "View" link on the label row. When clicked, the expanded
                note/ref card renders below the required-refs section. */}
            {!noteExpanded && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setNoteExpanded(true)}
                  disabled={submitting}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  + add instruction or reference
                </button>
              </div>
            )}
          </div>


          {/* Reference files required by the selected checklist (#file markers).
              Section uses the shared ref-file theme (blue) so it reads as
              "informational input needed" and matches the #file chips in the
              rule editor + the ref-file viewer panel. */}
          {requiredMarkers.length > 0 && (
            <div className={`rounded-lg ${REF_FILE_THEME.sectionClass} p-3 space-y-3`}>
              <div className={`text-sm font-semibold flex items-center gap-1.5 ${REF_FILE_THEME.accentTextClass}`}>
                <Paperclip className="h-3.5 w-3.5 flex-shrink-0" />
                Ref files requested by the checklist <span className="font-normal opacity-75">(optional)</span>:
              </div>
              <ol className="space-y-3">
                {requiredMarkers.map((m) => {
                  const slot = slotKey(m);
                  const entry = refFiles[slot];
                  const description = m.marker.description || 'Upload a reference file';
                  return (
                    <li key={slot} className="rounded-lg border border-blue-200 bg-white dark:border-blue-900 dark:bg-gray-900 px-3 py-2.5 space-y-2">
                      <div className="flex flex-col gap-0.5">
                        {/* Description is the main (bold) heading; the
                            scope_label is the small parenthesized
                            attribution suffix so users know where the
                            reference came from ("from checklist main
                            prompt" / "from rule #3"). */}
                        <span className="text-sm font-semibold text-foreground">
                          {description}
                          {' '}
                          <span className="text-[11px] font-normal text-muted-foreground">({m.scope_label})</span>
                        </span>
                        {m.scope_detail && (
                          <span className="text-[11px] text-muted-foreground">{m.scope_detail}</span>
                        )}
                      </div>
                      <div>
                        <RefFileCombobox
                          scopeKey={slot}
                          entry={entry}
                          libraryFiles={libraryFiles}
                          disabled={submitting}
                          inputRef={(el) => { refFilesInputRefs.current[slot] = el; }}
                          onPickFile={(file) => handleRefFilePick(slot, file)}
                          onPickLibrary={(revId, name) => handleRefFilePickFromLibrary(slot, revId, name)}
                          onClear={() => handleRefFileRemove(slot)}
                          onSaveToggle={(save) => handleRefFileSaveToggle(slot, save)}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
              {submitError && (
                <p className="text-xs text-red-600 dark:text-red-400">{submitError}</p>
              )}
            </div>
          )}

          {/* "Add note" expanded card — only rendered once the user opens
              the note via the "+ add note and reference" link inside the
              checklist selector above. No header / Remove button: an
              empty textarea with no attached file is treated as "no
              note entered," so collapsing is a non-concept. Note + files
              travel together to the AI's system prompt for THIS run
              only (stored on the report's encrypted inspection_context,
              appended as a <review_context> block and synthesised
              #ref[...] markers respectively). */}
          {noteExpanded && (
            <div className="rounded-lg border border-border bg-muted/30 dark:bg-gray-900/40 p-3 space-y-2">
              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value.slice(0, MAX_REVIEW_NOTE_LENGTH))}
                placeholder="Optional instructions for this review. You can attach a reference file (e.g agreement, quote etc)."
                rows={2}
                maxLength={MAX_REVIEW_NOTE_LENGTH}
                className="w-full text-sm px-2 py-1.5 border border-border rounded resize-y bg-background text-foreground placeholder:text-muted-foreground/70"
                disabled={submitting}
              />
              <div className="space-y-1.5">
                {adHocRefs.map((entry, idx) => (
                  <RefFileCombobox
                    key={idx}
                    scopeKey={`ad_hoc_${idx}`}
                    entry={entry ?? undefined}
                    libraryFiles={libraryFiles}
                    disabled={submitting}
                    inputRef={(el) => { adHocInputRefs.current[idx] = el; }}
                    onPickFile={(file) => handleAdHocPick(idx, file)}
                    onPickLibrary={(revId, name) => handleAdHocPickLibrary(idx, revId, name)}
                    onClear={() => handleAdHocRemove(idx)}
                    onSaveToggle={(save) => handleAdHocSaveToggle(idx, save)}
                  />
                ))}
                {/* Ghost "next slot" — shown whenever there's room to
                    attach another file. Renders the same Upload / Pick
                    from library links as the required-ref slots so the
                    two entry points are visible immediately under the
                    note without a staged "+ attach" click. */}
                {adHocRefs.length < MAX_AD_HOC_REF_FILES && (
                  <RefFileCombobox
                    key={`ad_hoc_next_${adHocRefs.length}`}
                    scopeKey="ad_hoc_next"
                    entry={undefined}
                    libraryFiles={libraryFiles}
                    disabled={submitting}
                    inputRef={(el) => { adHocInputRefs.current[adHocRefs.length] = el; }}
                    onPickFile={handleAdHocAppendFile}
                    onPickLibrary={handleAdHocAppendLibrary}
                    onClear={() => { }}
                    onSaveToggle={() => { }}
                  />
                )}
              </div>
            </div>
          )}

          {/* AI model selector — always visible. Defaults to the active
              checklist's ai_model (seeded invoice checklists pin Standard
              for reliable multi-file citation); users can override per run
              to save credits with Basic or push quality with Premium, and
              in retry mode to dodge a flaky provider. */}
          {(() => {
            const enabledModels = models.filter(m => !m.disabled);
            return (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5 flex-shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />
                  {isError ? 'Try a different AI:' : 'AI:'}
                </label>
                {enabledModels.length > 0 ? (
                  <select
                    value={selected}
                    onChange={(e) => setModelOverride(e.target.value)}
                    className="flex-1 min-w-0 py-1.5 px-2 border border-border rounded text-sm bg-background text-foreground"
                  >
                    {enabledModels.map(m => (
                      <option key={m.id} value={m.id}>{formatModelOptionLabel(m)}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No AI models available.{' '}
                    <a
                      href="/account/ai"
                      onClick={(e) => { e.preventDefault(); window.location.href = '/account/ai'; }}
                      className="text-indigo-600 dark:text-indigo-400 underline hover:opacity-80"
                    >
                      Configure a provider →
                    </a>
                  </span>
                )}
              </div>
            );
          })()}

          {/* Track-changes checkbox — only meaningful when a previous
              envelope revision exists. On first revisions there's
              nothing to diff against, so we hide the control entirely
              rather than show a disabled checkbox. Per-review flag;
              not a checklist property. Seeded from the prior report's
              inspection_context so re-opening the dialog preserves the
              user's last choice. */}
          {hasPreviousRevision && (
            <label
              className="flex items-start gap-2 cursor-pointer select-none"
              title="Asks the AI to flag material differences between this revision and the previous revision that the checklist rules don't already cover."
            >
              <input
                type="checkbox"
                checked={trackChanges}
                onChange={(e) => setTrackChanges(e.target.checked)}
                disabled={submitting}
                className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50 flex-shrink-0"
              />
              <span className="text-xs text-foreground">
                Mark changes not covered by any rules as failed checks
                <span className="block text-[11px] text-muted-foreground font-normal">
                  Compares this revision to the previous revision and flags
                  material differences the rules don't already address.
                </span>
              </span>
            </label>
          )}

          {/* Confirm-before-run banner — surfaces only when user hits Run
              Review with one or more empty reference-file slots. Amber tint
              (warning, not error) differentiates from the blue ref-files
              section. Clicking "Run anyway" sets a flag the Run handler
              checks; clicking "Go back" dismisses the banner so user can
              upload files and try again. */}
          {pendingConfirm && unfilledSlotCount > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2 space-y-2">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                <strong>{unfilledSlotCount}</strong> reference file{unfilledSlotCount !== 1 ? 's' : ''} not uploaded. The AI won't see that context. Continue anyway?
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPendingConfirm(false)}
                  disabled={submitting}
                  className="h-7 px-2.5 text-xs"
                >
                  Go back
                </Button>
                <Button
                  size="sm"
                  onClick={() => runReview(true)}
                  disabled={submitting}
                  className="h-7 px-2.5 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Run anyway
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => runReview(false)}
            disabled={!selected || cannotAffordAny || submitting || pendingConfirm}
            className="gap-1.5 bg-indigo-600 hover:bg-indigo-700"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {submitting ? 'Uploading…' : buttonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Combobox for picking a reference file ──────────────────────────────

type LibraryFileEntry = { prefix_id: string; latest_revision: { prefix_id: string; name: string; mime_type: string; byte_size: number; uploaded_at: string } };
type RefFileSlotEntry =
  | { kind: 'file'; file: File; filename: string; save_in_library: boolean }
  | { kind: 'library'; revision_id: string; filename: string };

function RefFileCombobox({
  entry,
  libraryFiles,
  disabled,
  inputRef,
  onPickFile,
  onPickLibrary,
  onClear,
  onSaveToggle,
}: {
  scopeKey: string;
  entry: RefFileSlotEntry | undefined;
  libraryFiles: LibraryFileEntry[];
  disabled: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onPickFile: (file: File) => void;
  onPickLibrary: (revisionId: string, filename: string) => void;
  onClear: () => void;
  onSaveToggle: (save: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // Empty-slot UX is a two-step choose-your-path: idle (two buttons:
  // Upload / Pick from library) → library (search combobox). A single
  // combobox that mixed upload + search was confusing first-time users
  // ("why is the app asking me to search a library I never filled?").
  const [mode, setMode] = useState<'idle' | 'library'>('idle');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return libraryFiles
      .filter(f => !q || f.latest_revision.name.toLowerCase().includes(q))
      .slice(0, 15);
  }, [libraryFiles, query]);

  const relativeTime = (iso: string) => {
    try {
      const d = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(d / 60000);
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return `${Math.floor(hrs / 24)}d ago`;
    } catch { return ''; }
  };

  const handleBlur = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  };
  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };

  // Auto-focus + open the dropdown when the user enters library mode so
  // the very first keystroke filters results (no second click required).
  useEffect(() => {
    if (mode === 'library') {
      setOpen(true);
      const id = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [mode]);

  // Hidden file input is mounted once at the component root so the
  // parent's inputRef prop (refFilesInputRefs / adHocInputRefs in the
  // dialog) stays valid across idle ↔ library ↔ selected transitions.
  // The parent calls .click() on it directly in some flows.
  const hiddenFileInput = (
    <input
      ref={(el) => { fileInputRef.current = el; inputRef(el); }}
      type="file"
      className="hidden"
      accept=".csv,.txt,.md,.pdf,.png,.jpg,.jpeg,text/csv,text/plain,text/markdown,application/pdf,image/png,image/jpeg"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) { onPickFile(file); setQuery(''); setMode('idle'); }
        e.target.value = '';
      }}
    />
  );

  if (entry) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
          <span className="font-medium text-foreground truncate">{entry.filename}</span>
          {entry.kind === 'library' && (
            <span className={`text-[10px] px-1 rounded ${REF_FILE_THEME.accentBgClass} ${REF_FILE_THEME.accentTextClass} flex-shrink-0`}>Library</span>
          )}
          <button
            type="button"
            onClick={() => { onClear(); setMode('idle'); }}
            disabled={disabled}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50 flex-shrink-0"
            aria-label="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {hiddenFileInput}
      </div>
    );
  }

  if (mode === 'idle') {
    const linkClass = `flex items-center gap-1 ${REF_FILE_THEME.accentTextStrongClass} hover:underline disabled:opacity-50 disabled:cursor-not-allowed`;
    return (
      <div className="flex items-center gap-3 text-[11px]">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className={linkClass}
        >
          <Upload className="h-3 w-3" />
          Upload from computer
        </button>
        <span className="text-muted-foreground/60" aria-hidden>·</span>
        <button
          type="button"
          onClick={() => setMode('library')}
          disabled={disabled}
          className={linkClass}
        >
          <Paperclip className="h-3 w-3" />
          Pick from library
        </button>
        {hiddenFileInput}
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        ref={searchInputRef}
        type="text"
        placeholder="Search library…"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={e => {
          if (e.key === 'Escape') { setMode('idle'); setQuery(''); setOpen(false); }
        }}
        disabled={disabled}
        className="w-full py-1.5 px-2 pr-7 text-sm border border-border rounded bg-background text-foreground placeholder:text-muted-foreground"
      />
      <button
        type="button"
        onMouseDown={cancelClose}
        onClick={() => { setMode('idle'); setQuery(''); setOpen(false); }}
        disabled={disabled}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"
        aria-label="Cancel library search"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {open && (
        <ul
          className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded border border-border bg-background shadow-lg text-sm"
          onMouseDown={cancelClose}
        >
          {filtered.map(f => (
            <li key={f.prefix_id}>
              <button
                type="button"
                className="w-full text-left px-2.5 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/30 flex items-center gap-2"
                onMouseDown={cancelClose}
                onClick={() => {
                  onPickLibrary(f.latest_revision.prefix_id, f.latest_revision.name);
                  setQuery('');
                  setOpen(false);
                  setMode('idle');
                }}
              >
                <Paperclip className="h-3 w-3 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <span className="truncate flex-1">{f.latest_revision.name}</span>
                <span className="text-[10px] text-muted-foreground flex-shrink-0">{relativeTime(f.latest_revision.uploaded_at)}</span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-muted-foreground">
              {libraryFiles.length === 0
                ? 'Your library is empty — upload a file first.'
                : 'No matching files'}
            </li>
          )}
        </ul>
      )}

      {hiddenFileInput}
    </div>
  );
}

