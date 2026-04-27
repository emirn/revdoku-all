import { useState, useEffect, useRef } from "react";
import type {
  IReport,
  IEnvelope,
  IEnvelopeRevision,
  IChecklist,
  ICheck,
  IRule,
  IDocumentFile,
} from "@revdoku/lib";
import {
  ReportJobStatus,
  CheckFilterType,
  createNewEnvelope,
} from "@revdoku/lib";
import type { CheckFilter } from "@/components/envelope-page/CheckNavigator";
import type { InspectionContext } from "@/components/envelope-page/InspectionProgressOverlay";
import type { IAIModelOption } from "@/lib/ai-model-utils";
import { getModelConfig } from "@/lib/ai-model-utils";
import { ApiClient } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { showToast } from "@/lib/toast";
import { setActiveInspection, subscribeInspectionComplete } from "@/lib/inspection-signal";
import { isCatchChangesCheck } from "@/lib/rule-utils";

// --- Polling constants (exponential backoff) ---
const REPORT_POLL_INITIAL_INTERVAL_MS = 5000;   // First poll 5s after initial delay ends
const REPORT_POLL_MAX_INTERVAL_MS = 30000;       // Cap at 30s between polls
const REPORT_POLL_BACKOFF_FACTOR = 1.5;          // 5s -> 7.5s -> 11s -> 17s -> 25s -> 30s...
const ESTIMATED_PROCESSING_TIME_PER_PAGE_MS = 2000;  // Estimated 2 seconds per page
const MAX_INITIAL_POLL_DELAY_MS = 30000;         // Cap initial delay so failures are detected within 30s

// Interface for tracking last inspected state
export interface ILastInspectedState {
  documentRevisionId: string;
  fileRevisionLinks: string; // JSON stringified for deep comparison
  checklistId: string;
  checklistRevisionNumber?: number;
  timestamp: string;
  reportId: string;
}

// Inspection progress persistence in localStorage (for resume after page refresh)
const INSPECTION_PROGRESS_KEY = 'revdoku_inspection_progress';

export function saveInspectionProgress(envelopeId: string, reportId: string, stepIndex: number, startTime: string) {
  try {
    localStorage.setItem(INSPECTION_PROGRESS_KEY, JSON.stringify({ envelopeId, reportId, stepIndex, startTime }));
  } catch { /* ignore quota errors */ }
}

function loadInspectionProgress(envelopeId: string, reportId: string): { stepIndex: number; startTime: string } | null {
  try {
    const raw = localStorage.getItem(INSPECTION_PROGRESS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.envelopeId === envelopeId && data.reportId === reportId) {
      return { stepIndex: data.stepIndex, startTime: data.startTime };
    }
    return null;
  } catch { return null; }
}

function clearInspectionProgress() {
  try { localStorage.removeItem(INSPECTION_PROGRESS_KEY); } catch { /* ignore */ }
}

export interface UseInspectionParams {
  currentEnvelope: IEnvelope | null;
  setCurrentEnvelope: React.Dispatch<React.SetStateAction<IEnvelope | null>>;
  currentEnvelopeRevision: IEnvelopeRevision | null;
  currentReport: IReport | null;
  setCurrentReport: React.Dispatch<React.SetStateAction<IReport | null>>;
  previousReport: IReport | null;
  currentChecklist: IChecklist | null;
  checklists: IChecklist[];
  envelopeId: string | null;
  numPages: number | null;
  checkFilter: CheckFilter;
  setCheckFilter: React.Dispatch<React.SetStateAction<CheckFilter>>;
  getCurrentChecklistIdRef: React.MutableRefObject<() => string | null>;
  showDebug: boolean;
  debugSkipAI: boolean;
  debugForceInspection: boolean;
  debugPages: string;
  debugGridMode: string;
  showOnboardingHints: boolean;
  setShowOnboardingHints: React.Dispatch<React.SetStateAction<boolean>>;
  updateReportInBothStates: (report: IReport) => void;
  trackSave: <T>(promise: Promise<T>) => Promise<T>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setChecklistError: React.Dispatch<React.SetStateAction<string | null>>;
  saveEnvelopeToDatabase: (envelope: IEnvelope, isNew?: boolean) => Promise<void>;
  checklistsLoading: boolean;
  onInspectionStatusChange?: () => void;
  onInspectionStart?: (envelopeId: string, title: string) => void;
  onInspectionEnd?: (envelopeId: string) => void;
}

export function useInspection({
  currentEnvelope,
  setCurrentEnvelope,
  currentEnvelopeRevision,
  currentReport,
  setCurrentReport,
  previousReport,
  currentChecklist,
  checklists,
  envelopeId,
  numPages,
  checkFilter,
  setCheckFilter,
  getCurrentChecklistIdRef,
  showDebug,
  debugSkipAI,
  debugForceInspection,
  debugPages,
  debugGridMode,
  showOnboardingHints,
  setShowOnboardingHints,
  updateReportInBothStates,
  trackSave,
  setError,
  setChecklistError,
  saveEnvelopeToDatabase,
  checklistsLoading,
  onInspectionStatusChange,
  onInspectionStart,
  onInspectionEnd,
}: UseInspectionParams) {
  // Derive isFirstRevision from the current envelope revision
  const isFirstRevision = currentEnvelopeRevision?.revision_number === 0;

  // --- Inspection state ---
  const [isInspecting, setIsInspecting] = useState(false);
  const inspectingRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRejectRef = useRef<((reason?: unknown) => void) | null>(null);
  const inspectionGenRef = useRef(0);
  const [isCancelling, setIsCancelling] = useState(false);
  const [inspectingChecklistName, setInspectingChecklistName] = useState<string | null>(null);
  const [inspectingAiModel, setInspectingAiModel] = useState<IAIModelOption | null>(null);
  const [inspectionStartTime, setInspectionStartTime] = useState<string | null>(null);
  const [selectAIDialogState, setSelectAIDialogState] = useState<{
    title?: string;
    errorMessage?: string;
    submitLabel?: string;
    variant?: 'default' | 'error' | 'cancelled';
  } | null>(null);
  // changesCount = failed checks belonging to the change-detection rule.
  // Subset of failedCount; surfaced separately so the completion splash can
  // render a dedicated "Changes" pill when the checklist has track_changes on.
  const [inspectionSummary, setInspectionSummary] = useState<{ passedCount: number; failedCount: number; changesCount: number } | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [inspectionContext, setInspectionContext] = useState<InspectionContext | null>(null);
  const [resumedStepIndex, setResumedStepIndex] = useState<number | undefined>(undefined);
  const [lastInspectedState, setLastInspectedState] = useState<ILastInspectedState | null>(null);
  const [debugInfoData, setDebugInfoData] = useState<string | null>(null);
  const [revdokuDocApiElapsedMs, setRevdokuDocApiElapsedMs] = useState<number | null>(null);
  const [pendingInspectionAfterArrange, setPendingInspectionAfterArrange] = useState(false);
  const [batchMeta, setBatchMeta] = useState<{ pages_processed?: number; total_pages?: number; total_batches?: number; batch_size?: number } | null>(null);
  // Live "preparing reference files" phase from report.meta. Populated
  // while CreateReportJob is waiting for NormalizeDocumentFileRevisionJob
  // to finish OCR'ing each pinned reference file. Nulled out once the
  // inspection moves into its normal batch processing.
  const [preparationMeta, setPreparationMeta] = useState<{ phase: string; ready: number; total: number } | null>(null);
  // Count of reference files the review dialog knew would be used
  // (pinned #ref[...] slots + ad-hoc refs from "Add note"). Surfaced on
  // the inspection splash immediately, before the CreateReportJob enters
  // phase 0 and starts pushing preparationMeta. Reconciled upward if the
  // server-reported total ends up larger than what the dialog saw.
  const [refFilesTotal, setRefFilesTotal] = useState<number | null>(null);

  // --- Cleanup polling timers on unmount ---
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      if (pollDelayRef.current) { clearTimeout(pollDelayRef.current); pollDelayRef.current = null; }
      setActiveInspection(null);
    };
  }, []);

  // --- Initialize lastInspectedState from existing report on page load ---
  // so checkIfNeedsNewInspection can detect "no changes" without a prior inspection
  useEffect(() => {
    if (lastInspectedState) return;
    if (!currentReport) return;
    if (!currentEnvelopeRevision) return;
    if (currentReport.job_status !== ReportJobStatus.COMPLETED) return;

    const checklistId = currentReport.source_checklist_id || currentReport.checklist_id;
    if (!checklistId) return;

    const resolvedChecklist = checklists.find(c => c.id === checklistId) || currentChecklist;

    setLastInspectedState({
      documentRevisionId: currentEnvelopeRevision.id,
      fileRevisionLinks: JSON.stringify(
        currentEnvelopeRevision.document_file_revision_links?.map(link => ({
          document_file_id: link.document_file_id,
          revision_number: link.revision_number
        })) || []
      ),
      checklistId: checklistId,
      checklistRevisionNumber: resolvedChecklist?.revision_number,
      timestamp: currentReport.updated_at || currentReport.created_at || new Date().toISOString(),
      reportId: currentReport.id
    });
  }, [lastInspectedState, currentReport, currentEnvelopeRevision, checklists, currentChecklist]);

  // --- Auto-resume inspection if report is in progress (PENDING or PROCESSING) ---
  useEffect(() => {
    if (!currentReport) return;

    const isInProgress =
      currentReport.job_status === ReportJobStatus.PENDING ||
      currentReport.job_status === ReportJobStatus.PROCESSING;

    if (isInProgress && !isInspecting) {
      if (import.meta.env.DEV) console.debug(`Report in progress detected (status: ${currentReport.job_status}), showing overlay and starting polling`);

      // Try to restore saved progress from localStorage
      const savedProgress = currentEnvelope?.id
        ? loadInspectionProgress(currentEnvelope.id, currentReport.id)
        : null;

      // Show the overlay
      setIsInspecting(true);
      setActiveInspection(currentEnvelope?.id || null);
      if (currentEnvelope?.id) onInspectionStart?.(currentEnvelope.id, currentEnvelope.title || 'Untitled');
      setInspectingChecklistName(currentReport.checklist?.name || null);
      const resumeModelId = currentReport.checklist?.ai_model || currentReport.ai_model;
      setInspectingAiModel(getModelConfig(resumeModelId) || null);
      setInspectionStartTime(savedProgress?.startTime || currentReport.updated_at || currentReport.created_at || new Date().toISOString());
      setResumedStepIndex(savedProgress?.stepIndex ?? undefined);

      // Restore batch progress from report meta (so batch indicator shows immediately, not after first poll)
      const reportMeta = (currentReport as any).meta;
      if (reportMeta && typeof reportMeta === 'object' && reportMeta.total_pages) {
        setBatchMeta({
          pages_processed: reportMeta.pages_processed,
          total_pages: reportMeta.total_pages,
          total_batches: reportMeta.total_batches,
          batch_size: reportMeta.batch_size,
        });
      }

      // Compute inspection context for overlay subtitle
      const rules = currentReport.checklist?.rules || [];
      const userRules = rules.filter((r: IRule) => r.origin === 'user').length;
      const templateRules = rules.length - userRules;
      const previousFailedCount = previousReport?.checks?.filter((c: ICheck) => !c.passed).length || 0;
      const previousPassedCount = previousReport?.checks?.filter((c: ICheck) => c.passed).length || 0;
      // Determine if this is a reinspection (not the first revision)
      const isReinspection = currentEnvelopeRevision ? currentEnvelopeRevision.revision_number > 1 : false;
      setInspectionContext({
        totalRules: rules.length,
        templateRules,
        userRules,
        previousFailedCount,
        previousPassedCount,
        isReinspection,
        // Track-changes is preserved on the frozen checklist snapshot in
        // inspection_context even though the live Checklist model no
        // longer has the column.
        trackChanges: (currentReport.checklist as any)?.track_changes === true,
      });

      // Start polling for completion
      const resumePolling = async () => {
        try {
          const completedReport = await pollForReportCompletion(currentReport.id);
          const checks = completedReport.checks || [];

          // If cancelled or failed, just update state and stop — don't compute summary
          if (completedReport.job_status === ReportJobStatus.CANCELLED ||
            completedReport.job_status === ReportJobStatus.FAILED) {
            setCurrentReport(completedReport);
            if (completedReport.job_status === ReportJobStatus.FAILED) {
              // Failure with partial progress → treat as "interrupted" (resume-oriented).
              // Failure with zero progress → true failure (retry-oriented).
              const metaPages = Number((completedReport as any).meta?.pages_processed) || 0;
              const totalPages = Number((completedReport as any).page_count) || 0;
              if (metaPages > 0) {
                const remaining = Math.max(0, totalPages - metaPages);
                const remainingText = remaining > 0
                  ? ` You can resume to finish the remaining ${remaining} page${remaining !== 1 ? 's' : ''}.`
                  : '';
                showToast(
                  `Review interrupted after ${metaPages} of ${totalPages} page${totalPages !== 1 ? 's' : ''}.${remainingText}`,
                  'info'
                );
              } else {
                const errorMessage = completedReport.error_message || 'Review failed. Please try again.';
                setInspectionError(errorMessage);
                showToast(errorMessage, 'error');
              }
            }
            if (currentEnvelope) {
              const updatedEnvelope = {
                ...currentEnvelope,
                envelope_revisions: currentEnvelope.envelope_revisions.map((rev, idx) =>
                  idx === currentEnvelope.current_revision_index
                    ? { ...rev, report: completedReport, updated_at: new Date().toISOString() }
                    : rev
                )
              };
              setCurrentEnvelope(updatedEnvelope);
              if (envelopeId) {
                saveEnvelopeToDatabase(updatedEnvelope);
              }
            }
            return;
          }

          if (import.meta.env.DEV) console.debug(`Report auto-resumed and completed with ${checks.length} checks`);

          // Update the report state
          setCurrentReport(completedReport);

          // Update envelope with the completed report
          if (currentEnvelope) {
            const updatedEnvelope = {
              ...currentEnvelope,
              envelope_revisions: currentEnvelope.envelope_revisions.map((rev, idx) =>
                idx === currentEnvelope.current_revision_index
                  ? { ...rev, report: completedReport, updated_at: new Date().toISOString() }
                  : rev
              )
            };
            setCurrentEnvelope(updatedEnvelope);

            // Save updated envelope to database
            if (envelopeId) {
              saveEnvelopeToDatabase(updatedEnvelope);
            }
          }

          // Compute and show inspection summary in overlay
          const passedCount = checks.filter((c: ICheck) => c.passed).length;
          const failedChecks = checks.filter((c: ICheck) => !c.passed);
          const failedCount = failedChecks.length;
          const changesCount = failedChecks.filter(isCatchChangesCheck).length;
          setInspectionSummary({ passedCount, failedCount, changesCount });

          // Auto-switch filter so user sees relevant results immediately
          if (failedCount === 0 && passedCount > 0) {
            setCheckFilter(CheckFilterType.ALL);
          } else if (failedCount > 0 && checkFilter === CheckFilterType.PASSED) {
            setCheckFilter(CheckFilterType.FAILED_AND_CHANGES);
          }

        } catch (error) {
          // Ignore cancellation — handleCancelInspection rejects the poll promise
          // with Error('cancelled') to unblock; this is not a real error.
          if (error instanceof Error && error.message === 'cancelled') return;
          console.error("Error during auto-resume polling:", error);
          const errorMessage = error instanceof Error
            ? error.message
            : "Failed to complete review. Please try again.";
          showToast(errorMessage, 'error');
        } finally {
          setIsInspecting(false);
          setActiveInspection(null);
          clearInspectionProgress();
          onInspectionStatusChange?.();
          if (currentEnvelope?.id) onInspectionEnd?.(currentEnvelope.id);
        }
      };

      resumePolling();
    }
  }, [currentReport?.id, currentReport?.job_status, isInspecting]);

  // --- Check if a new inspection is needed based on what has changed ---
  const checkIfNeedsNewInspection = (
    documentRevision: IEnvelopeRevision | null,
    checklistId: string,
    lastState: ILastInspectedState | null
  ): boolean => {
    // Always need inspection if no last state exists
    if (!lastState || !documentRevision) {
      return true;
    }

    // Check if document revision changed
    if (documentRevision.id !== lastState.documentRevisionId) {
      if (import.meta.env.DEV) console.debug('New inspection needed: document revision changed');
      return true;
    }

    // Check if checklist changed
    if (checklistId !== lastState.checklistId) {
      if (import.meta.env.DEV) console.debug('New inspection needed: checklist changed');
      return true;
    }

    // Check if checklist rules were modified (revision_number changes on any update)
    if (lastState.checklistRevisionNumber !== undefined) {
      const checklist = checklists.find(c => c.id === checklistId) || currentChecklist;
      if (checklist?.revision_number !== undefined && checklist.revision_number !== lastState.checklistRevisionNumber) {
        if (import.meta.env.DEV) console.debug('New inspection needed: checklist rules changed (revision_number mismatch)');
        return true;
      }
    }

    // Check if file revision links changed (order or content)
    const currentFileLinks = JSON.stringify(
      documentRevision.document_file_revision_links?.map(link => ({
        document_file_id: link.document_file_id,
        revision_number: link.revision_number
      })) || []
    );

    if (currentFileLinks !== lastState.fileRevisionLinks) {
      if (import.meta.env.DEV) console.debug('New inspection needed: file revision links changed');
      return true;
    }

    // No meaningful changes detected
    if (import.meta.env.DEV) console.debug('No inspection needed: no meaningful changes detected');
    return false;
  };

  // --- Extract polling logic into a reusable function (exponential backoff) ---
  const pollForReportCompletion = async (reportId: string, initialDelayMs: number = 0): Promise<IReport> => {
    // Clear any previous polling
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    if (pollDelayRef.current) { clearTimeout(pollDelayRef.current); pollDelayRef.current = null; }

    return new Promise((resolve, reject) => {
      pollRejectRef.current = reject;
      let currentInterval = REPORT_POLL_INITIAL_INTERVAL_MS;
      let settled = false; // Guard against double-resolve when signal fires during in-flight poll

      const poll = async () => {
        if (settled) return; // Already resolved/rejected
        try {
          const statusResponse = await ApiClient.getReportStatus(reportId);
          if (settled) return; // Resolved while awaiting response
          if (import.meta.env.DEV) console.debug(`Poll result: job_status = ${statusResponse.job_status}, next in ${Math.round(currentInterval / 1000)}s`);

          if (statusResponse.job_status === ReportJobStatus.COMPLETED) {
            settled = true;
            unsubSignal();
            pollRejectRef.current = null;
            // Attach envelope.user_scripts (may have been copied from checklist
            // by ReportCreationService#copy_checklist_scripts_to_envelope) so
            // handleInspect can refresh currentEnvelope state with them.
            const report = statusResponse.report as IReport & { envelope_user_scripts?: unknown };
            if (statusResponse.envelope_user_scripts) {
              report.envelope_user_scripts = statusResponse.envelope_user_scripts;
            }
            resolve(report);
          } else if (statusResponse.job_status === ReportJobStatus.FAILED ||
            statusResponse.job_status === ReportJobStatus.CANCELLED) {
            settled = true;
            unsubSignal();
            pollRejectRef.current = null;
            const report = statusResponse.report as IReport & { envelope_user_scripts?: unknown };
            if (statusResponse.error_message) {
              report.error_message = statusResponse.error_message;
            }
            if (statusResponse.envelope_user_scripts) {
              report.envelope_user_scripts = statusResponse.envelope_user_scripts;
            }
            resolve(report);
          } else {
            // Extract batch progress meta from reviewing report
            const reportMeta = statusResponse.report?.meta;
            if (reportMeta && typeof reportMeta === 'object' && reportMeta.total_pages) {
              setBatchMeta({
                pages_processed: reportMeta.pages_processed,
                total_pages: reportMeta.total_pages,
                total_batches: reportMeta.total_batches,
                batch_size: reportMeta.batch_size,
              });
            }
            // Phase 0: reference file normalization. CreateReportJob
            // writes { phase: "preparing_references", phase_ready, phase_total }
            // to report.meta while waiting for OCR to complete.
            if (reportMeta && typeof reportMeta === 'object' && reportMeta.phase === 'preparing_references') {
              const phaseTotal = Number(reportMeta.phase_total || 0);
              setPreparationMeta({
                phase: reportMeta.phase,
                ready: Number(reportMeta.phase_ready || 0),
                total: phaseTotal,
              });
              // If the job resolved more refs than the dialog passed, promote
              // the subtitle count so "Using N reference files" matches reality.
              if (phaseTotal > 0) {
                setRefFilesTotal(prev => (prev == null || phaseTotal > prev ? phaseTotal : prev));
              }
            } else if (preparationMeta) {
              setPreparationMeta(null);
            }
            // Schedule next poll with exponential backoff
            currentInterval = Math.min(currentInterval * REPORT_POLL_BACKOFF_FACTOR, REPORT_POLL_MAX_INTERVAL_MS);
            pollDelayRef.current = setTimeout(poll, currentInterval);
          }
        } catch (error) {
          if (settled) return;
          settled = true;
          unsubSignal();
          pollRejectRef.current = null;
          reject(error);
        }
      };

      // Subscribe to ActionCable completion signal — shortcut the backoff wait
      const unsubSignal = subscribeInspectionComplete(() => {
        if (settled) return;
        if (import.meta.env.DEV) console.debug('ActionCable completion signal received, shortcutting poll');
        // Clear pending timer and poll immediately
        if (pollDelayRef.current) { clearTimeout(pollDelayRef.current); pollDelayRef.current = null; }
        poll();
      });

      // Initial delay before first poll (based on estimated page processing time)
      const firstDelay = initialDelayMs > 0 ? initialDelayMs : REPORT_POLL_INITIAL_INTERVAL_MS;
      if (import.meta.env.DEV) console.debug(`Waiting ${firstDelay}ms before first poll...`);
      pollDelayRef.current = setTimeout(poll, firstDelay);
    });
  };

  // --- Main inspection handler ---
  const handleInspect = async (options?: { ai_model?: string; track_changes?: boolean; highlight_mode?: number; force?: boolean; checklist_id?: string; reference_files?: Array<{ rule_id: string | null; document_file_revision_id: string }>; review_note?: string; ad_hoc_ref_files?: Array<{ document_file_revision_id: string; label?: string }>; ref_files_total?: number }) => {
    // Ref-based guard prevents double-click race condition (React state update is async)
    if (inspectingRef.current) return;
    inspectingRef.current = true;
    const myGen = ++inspectionGenRef.current;
    setPendingInspectionAfterArrange(false);

    try {
      if (import.meta.env.DEV) {
        console.debug("handleInspect called", {
          files: currentEnvelopeRevision?.document_file_revision_links?.length || 0,
          isInspecting,
          checklistsLoading,
        });
      }
      if (!currentEnvelopeRevision || !currentEnvelopeRevision.document_file_revision_links || currentEnvelopeRevision.document_file_revision_links.length === 0) return;

      // Use explicit checklist_id override (from "Review with options" dialog) or fall back to ref
      const currentChecklistId: string | null = options?.checklist_id ?? getCurrentChecklistIdRef.current();
      if (import.meta.env.DEV) console.debug(`getCurrentChecklistId: ${currentChecklistId}`);

      if (!currentChecklistId) {
        setChecklistError("Please select a checklist from the dropdown above before reviewing");
        setTimeout(() => setChecklistError(null), 5000);
        return;
      }

      // Detect checklist switch on first revision with existing report
      let isChecklistSwitch = false;
      if (currentReport && isFirstRevision && currentReport.checklist_id) {
        if (currentChecklistId !== currentReport.checklist_id && currentChecklistId !== currentReport.source_checklist_id) {
          const aiCheckCount = currentReport.checks?.filter((c: ICheck) => c.source === 'ai')?.length || 0;
          const userCheckCount = currentReport.checks?.filter((c: ICheck) => c.source === 'user')?.length || 0;
          const userRuleCount = currentReport.checklist?.rules?.filter((r: IRule) => r.origin === 'user')?.length || 0;

          // Only confirm if there are AI checks to remove
          if (aiCheckCount > 0) {
            let msg = `Switching checklists will remove ${aiCheckCount} auto-generated check(s).`;
            const preserved: string[] = [];
            if (userCheckCount > 0) preserved.push(`${userCheckCount} manually created check(s)`);
            if (userRuleCount > 0) preserved.push(`${userRuleCount} user rule(s)`);
            if (preserved.length > 0) msg += `\n\n${preserved.join(' and ')} will be preserved.`;
            msg += "\n\nContinue?";
            if (!window.confirm(msg)) return;
          }
          isChecklistSwitch = true;
        }
      }

      // Check if we actually need a new inspection
      const needsNewInspection = options?.force || (import.meta.env.DEV && debugForceInspection) || isChecklistSwitch ? true : checkIfNeedsNewInspection(
        currentEnvelopeRevision,
        currentChecklistId,
        lastInspectedState
      );

      // If nothing has changed and we have a completed report, just show a message and return
      const reportIsUsable = currentReport && currentReport.job_status === ReportJobStatus.COMPLETED;
      if (!needsNewInspection && reportIsUsable) {
        if (import.meta.env.DEV) console.debug("No changes detected, skipping AI inspection");
        setError(null);
        showToast("No changes detected. Using existing review results.", 'info');
        return;
      }

      // Resolve the checklist name and AI model for the overlay before starting
      const inspectChecklist = checklists.find(c => c.id === currentChecklistId);
      setInspectingChecklistName(inspectChecklist?.name || currentChecklist?.name || null);
      const aiModelOverride = options?.ai_model;
      const inspectModelId = aiModelOverride || inspectChecklist?.ai_model || currentChecklist?.ai_model;
      setInspectingAiModel(getModelConfig(inspectModelId) || null);

      // Compute inspection context for overlay subtitle
      const resolvedChecklist = inspectChecklist || currentChecklist;
      const rules = resolvedChecklist?.rules || [];
      const userRules = rules.filter((r: IRule) => r.origin === 'user').length;
      const templateRules = rules.length - userRules;
      const previousFailedCount = previousReport?.checks?.filter((c: ICheck) => !c.passed).length || 0;
      const previousPassedCount = previousReport?.checks?.filter((c: ICheck) => c.passed).length || 0;
      setInspectionContext({
        totalRules: rules.length,
        templateRules,
        userRules,
        previousFailedCount,
        previousPassedCount,
        isReinspection: !isFirstRevision,
        // Track-changes is per-review only; resolvedChecklist no longer
        // carries it. If the caller didn't supply a value, default off.
        trackChanges: options?.track_changes === true,
      });

      setError(null);
      setInspectionError(null);
      setDebugInfoData(null); // Clear previous debug info before new inspection

      // Show splash before API call so user sees progress during the request
      setIsInspecting(true);
      setActiveInspection(currentEnvelope?.id || null);
      if (currentEnvelope?.id) onInspectionStart?.(currentEnvelope.id, currentEnvelope.title || 'Untitled');
      setResumedStepIndex(undefined);
      const startTime = new Date().toISOString();
      setInspectionStartTime(startTime);
      // Seed the "Using N reference files" subtitle from the dialog's
      // locally-known count so it's visible immediately. Polling later
      // promotes this value if the server resolved more refs than the
      // dialog saw (e.g. auto-picked from library history).
      setRefFilesTotal(options?.ref_files_total && options.ref_files_total > 0 ? options.ref_files_total : null);

      if (import.meta.env.DEV && showDebug && debugSkipAI) {
        console.debug(
          "handleInspect",
          `debugSkipAI is enabled, so we force reset source document`,
        );
      }

      // Call Rails API to create report
      try {
        const previous_report_id = previousReport?.id;

        // Create report through Rails API
        const reportResponse = await ApiClient.createReport({
          envelope_revision_id: currentEnvelopeRevision.id,
          checklist_id: currentChecklistId,
          previous_report_id: previous_report_id,
          checklist_switch: isChecklistSwitch || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          force: options?.force || undefined,
          ...(import.meta.env.DEV ? {
            force: options?.force || debugForceInspection || undefined,
            skip_ai: showDebug && debugSkipAI,
            pages: showDebug && debugPages ? debugPages : undefined,
            debug: showDebug ? {
              grid_mode: debugGridMode || undefined,
              overlay_checks_on_grid: true,
            } : undefined,
          } : {}),
          ai_model: aiModelOverride || undefined,
          track_changes: options?.track_changes,
          highlight_mode: options?.highlight_mode,
          reference_files: options?.reference_files,
          review_note: options?.review_note,
          ad_hoc_ref_files: options?.ad_hoc_ref_files,
        });

        const data = reportResponse;

        if (!data.report) {
          // Handle different types of errors with specific messages
          const errorMessage = "Report creation failed";

          throw new Error(errorMessage);
        }

        // If cancelled while createReport was in flight, bail out
        if (inspectionGenRef.current !== myGen) return;

        // Transform the API response to match our expected structure
        let result: IReport = data.report;

        // Notify envelope list so sidebar spinner updates
        onInspectionStatusChange?.();

        // Save inspection progress to localStorage for resume after page refresh
        if (currentEnvelope?.id) {
          saveInspectionProgress(currentEnvelope.id, result.id, 0, startTime);
        }
        if (data.debug_info) {
          if (import.meta.env.DEV) console.debug('Debug info received:', typeof data.debug_info, data.debug_info.length, 'chars');
          result = { ...result, debug_info: data.debug_info };
          setDebugInfoData(data.debug_info);
        } else if (showDebug) {
          if (import.meta.env.DEV) console.debug('No debug_info in response');
        }
        if (data.revdoku_doc_api_elapsed_ms != null) {
          setRevdokuDocApiElapsedMs(data.revdoku_doc_api_elapsed_ms);
        }
        if (import.meta.env.DEV) console.debug(`Received report ${(result.checks || []).length} checks`);

        // If report is still processing, poll for completion
        if (result.job_status === ReportJobStatus.PENDING || result.job_status === ReportJobStatus.PROCESSING) {
          if (import.meta.env.DEV) console.debug(`Report is ${result.job_status}, polling for completion...`);

          // Calculate initial delay based on estimated processing time per page
          // Use numPages if available, otherwise default to 5 pages as reasonable estimate
          const pageCount = numPages || 5;
          const initialDelay = Math.min(pageCount * ESTIMATED_PROCESSING_TIME_PER_PAGE_MS, MAX_INITIAL_POLL_DELAY_MS);
          if (import.meta.env.DEV) console.debug(`Estimated ${pageCount} pages, waiting ${initialDelay}ms before first poll`);

          // Wait for completion using the extracted polling function
          result = await pollForReportCompletion(result.id, initialDelay);
          if (import.meta.env.DEV) console.debug(`Report completed with ${(result.checks || []).length} checks`);

          // If cancelled, handleCancelInspection already updated state with full data from cancelReport API.
          // Skip the state update below to avoid overwriting with potentially stale polling data.
          if (result.job_status === ReportJobStatus.CANCELLED) {
            return;
          }

          // If failed, update state with the failed report. Branch on partial
          // progress: if some batches completed before the failure, show the
          // resume-oriented "interrupted" messaging instead of the scary
          // "Review failed" overlay/dialog path. True 0-pages failures still
          // go through the retry dialog via the catch block below.
          if (result.job_status === ReportJobStatus.FAILED) {
            setCurrentReport(result);
            const metaPages = Number((result as any).meta?.pages_processed) || 0;
            const failTotalPages = Number((result as any).page_count) || 0;
            if (metaPages > 0) {
              // Partial failure — interrupted UX
              const remaining = Math.max(0, failTotalPages - metaPages);
              const remainingText = remaining > 0
                ? ` You can resume to finish the remaining ${remaining} page${remaining !== 1 ? 's' : ''}.`
                : '';
              showToast(
                `Review interrupted after ${metaPages} of ${failTotalPages} page${failTotalPages !== 1 ? 's' : ''}.${remainingText}`,
                'info'
              );
            } else {
              const errorMessage = result.error_message || 'Review failed. Please try again.';
              setInspectionError(errorMessage);
              showToast(errorMessage, 'error');
            }
            if (currentEnvelope) {
              const envelopeUserScriptsFromReport = (result as IReport & { envelope_user_scripts?: IEnvelope['user_scripts'] }).envelope_user_scripts;
              const updatedEnvelope: IEnvelope = {
                ...currentEnvelope,
                ...(envelopeUserScriptsFromReport && !currentEnvelope.user_scripts?.length
                  ? { user_scripts: envelopeUserScriptsFromReport }
                  : {}),
                envelope_revisions: currentEnvelope.envelope_revisions.map((rev, idx) =>
                  idx === currentEnvelope.current_revision_index
                    ? { ...rev, report: result, updated_at: new Date().toISOString() }
                    : rev
                )
              };
              setCurrentEnvelope(updatedEnvelope);
              if (envelopeId) saveEnvelopeToDatabase(updatedEnvelope);
            }
            return;
          }
        }


        // we should create envelope if not created yet
        if (!currentEnvelope) {
          // creating new envelop
          const document_files: IDocumentFile[] = currentEnvelopeRevision?.document_file_revision_links?.map(link => ({
            id: link.document_file_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            document_file_revisions: []
          })) || [];

          const env = createNewEnvelope({
            title: 'Untitled',
            document_files: document_files,
            report: result,
            comment: 'Initial inspection',
          });
          setCurrentEnvelope(env);
          // Save new envelope to database
          if (!envelopeId) {
            saveEnvelopeToDatabase(env, true);
          }
        }
        else {
          // Update the report state
          setCurrentReport(result);

          // If the backend copied user_scripts from the checklist onto the envelope
          // during this run, the polling response carries the fresh value on
          // `envelope_user_scripts`. Merge it into currentEnvelope so the Scripts
          // badge / editor / post-review execution all see the just-copied data.
          const envelopeUserScriptsFromReport = (result as IReport & { envelope_user_scripts?: IEnvelope['user_scripts'] }).envelope_user_scripts;

          // Update envelope with the new report for saving
          const updatedEnvelope: IEnvelope = {
            ...currentEnvelope,
            ...(envelopeUserScriptsFromReport && !currentEnvelope.user_scripts?.length
              ? { user_scripts: envelopeUserScriptsFromReport }
              : {}),
            envelope_revisions: currentEnvelope.envelope_revisions.map((rev, idx) =>
              idx === currentEnvelope.current_revision_index
                ? { ...rev, report: result, updated_at: new Date().toISOString() }
                : rev
            )
          };

          setCurrentEnvelope(updatedEnvelope);

          // Save updated envelope to database
          if (envelopeId) {
            saveEnvelopeToDatabase(updatedEnvelope);
          }
        }

        // Save the last inspected state for future comparison
        const resolvedChecklist2 = checklists.find(c => c.id === currentChecklistId) || currentChecklist;
        const newLastInspectedState: ILastInspectedState = {
          documentRevisionId: currentEnvelopeRevision.id,
          fileRevisionLinks: JSON.stringify(
            currentEnvelopeRevision.document_file_revision_links?.map(link => ({
              document_file_id: link.document_file_id,
              revision_number: link.revision_number
            })) || []
          ),
          checklistId: currentChecklistId,
          checklistRevisionNumber: resolvedChecklist2?.revision_number,
          timestamp: new Date().toISOString(),
          reportId: result.id
        };
        setLastInspectedState(newLastInspectedState);
        if (import.meta.env.DEV) console.debug('Saved last inspected state:', newLastInspectedState);

        // Compute and show inspection summary in overlay
        const resultChecks = result.checks || [];
        const passedCount = resultChecks.filter((c: ICheck) => c.passed).length;
        const failedChecks = resultChecks.filter((c: ICheck) => !c.passed);
        const failedCount = failedChecks.length;
        const changesCount = failedChecks.filter(isCatchChangesCheck).length;
        setInspectionSummary({ passedCount, failedCount, changesCount });

        // Increment onboarding counter on first completed inspection per envelope
        if (showOnboardingHints && currentEnvelope?.id) {
          try {
            const seenKey = `revdoku_onboarding_seen_${currentEnvelope.id}`;
            if (!localStorage.getItem(seenKey)) {
              localStorage.setItem(seenKey, '1');
              const count = parseInt(localStorage.getItem('revdoku_onboarding_count') || '0', 10);
              const newCount = count + 1;
              localStorage.setItem('revdoku_onboarding_count', String(newCount));
              if (newCount >= 3) setShowOnboardingHints(false);
            }
          } catch { }
        }

        // Auto-switch filter so user sees relevant results immediately
        if (failedCount === 0 && passedCount > 0) {
          setCheckFilter(CheckFilterType.ALL);
        } else if (failedCount > 0 && checkFilter === CheckFilterType.PASSED) {
          setCheckFilter(CheckFilterType.FAILED_AND_CHANGES);
        }

      } catch (error) {
        // If cancelled by user or stale instance, bail out silently
        if (error instanceof Error && error.message === 'cancelled') return;
        if (inspectionGenRef.current !== myGen) return;

        console.error("Error analyzing input:", error);
        // Immediately dismiss splash on error (don't wait for finally's setTimeout)
        setIsInspecting(false);
        setActiveInspection(null);
        clearInspectionProgress();
        if (currentEnvelope?.id) onInspectionEnd?.(currentEnvelope.id);

        const errorMessage = error instanceof Error
          ? error.message
          : "Failed to review input. Please try again.";

        // Show Select AI dialog with error so user can retry or switch model
        const isServiceUnavailable =
          (error instanceof ApiError && (error.statusCode === 503 || error.code === 'REVDOKU_DOC_API_UNAVAILABLE')) ||
          (error instanceof Error && error.message.includes('temporarily unavailable'));

        setSelectAIDialogState({
          title: isServiceUnavailable ? 'AI Service Unavailable' : 'Review Failed - Retry',
          errorMessage: errorMessage,
          submitLabel: 'Try Again',
          variant: 'error',
        });
      } finally {
        // Only cleanup if this is still the active inspection (not superseded by cancel → retry)
        if (inspectionGenRef.current === myGen) {
          // Defer to next macrotask so React commits isInspecting=true first.
          // This lets InspectionProgressOverlay see the true->false transition
          // and trigger its finishing animation -> summary display.
          setTimeout(() => {
            setIsInspecting(false);
            setActiveInspection(null);
            clearInspectionProgress();
            onInspectionStatusChange?.();
            if (currentEnvelope?.id) onInspectionEnd?.(currentEnvelope.id);
          }, 0);
        }
      }
    } finally {
      if (inspectionGenRef.current === myGen) {
        inspectingRef.current = false;
      }
    }
  };

  // --- Cancel inspection handler ---
  const handleCancelInspection = async () => {
    if (!currentReport?.id || isCancelling) return;

    // Stop polling BEFORE calling cancel API to prevent race condition:
    // Without this, pollForReportCompletion's setInterval can fire after cancel completes
    // and overwrite the correct state with incomplete data from the status endpoint.
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    if (pollDelayRef.current) { clearTimeout(pollDelayRef.current); pollDelayRef.current = null; }
    // Invalidate current handleInspect and free the lock so "Try Again" can start immediately
    inspectionGenRef.current++;
    inspectingRef.current = false;
    // Reject hanging poll promise so handleInspect's await unblocks
    if (pollRejectRef.current) { pollRejectRef.current(new Error('cancelled')); pollRejectRef.current = null; }

    setIsCancelling(true);
    try {
      const result = await ApiClient.cancelReport(currentReport.id);

      // Hide overlay immediately
      setIsInspecting(false);
      setActiveInspection(null);
      clearInspectionProgress();
      onInspectionStatusChange?.();
      if (currentEnvelope?.id) onInspectionEnd?.(currentEnvelope.id);

      // Update report in state
      if (result.report) {
        updateReportInBothStates(result.report);
      }

      // If the cancelled review produced ≥1 check, the backend copied the
      // checklist's user_scripts onto the envelope. Surface that into local
      // state so the Scripts badge / editor immediately reflect it.
      if (result.envelope_user_scripts && currentEnvelope && !currentEnvelope.user_scripts?.length) {
        setCurrentEnvelope((prev) =>
          prev ? { ...prev, user_scripts: result.envelope_user_scripts } : prev
        );
      }

      if (result.already_completed) {
        // Report completed while overlay was stuck — show results directly
        const checks = result.report?.checks || [];
        const passedCount = checks.filter((c: ICheck) => c.passed).length;
        const failedChecks = checks.filter((c: ICheck) => !c.passed);
        const failedCount = failedChecks.length;
        const changesCount = failedChecks.filter(isCatchChangesCheck).length;
        setInspectionSummary({ passedCount, failedCount, changesCount });
      } else {
        // Branch on whether the cancelled run made real progress. If at least
        // one page was reviewed, this is an "interrupted" run — the user
        // should see resume-oriented messaging (banner + toast), NOT a
        // "review failed" dialog or credit-refund notice. If zero pages were
        // processed, it's a true cancel-before-any-work case and the retry
        // dialog is still the right UX.
        const pagesProcessed = Number((result as any).pages_processed) || 0;
        const totalPages = Number((result as any).total_pages) || 0;
        const isPartial = Boolean((result as any).partial) || pagesProcessed > 0;

        if (isPartial) {
          // Partial progress. The sticky "Pages X–Y not reviewed. Continue
          // review" toolbar banner in EnvelopePage (driven by page_statuses
          // which the cancel response already populated) is the primary
          // affordance here — we just show a confirmation toast so the user
          // knows their click was received and sees how much was completed.
          // No credit-refund mention: fair billing is internal accounting,
          // not user-facing noise during an interrupted run.
          const remaining = Math.max(0, totalPages - pagesProcessed);
          const pluralTotal = totalPages !== 1 ? 's' : '';
          const remainingText = remaining > 0
            ? ` You can resume to finish the remaining ${remaining} page${remaining !== 1 ? 's' : ''}.`
            : '';
          console.info(`Review interrupted: ${pagesProcessed}/${totalPages} pages reviewed.`);
          showToast(
            `Review interrupted: ${pagesProcessed} of ${totalPages} page${pluralTotal} reviewed.${remainingText}`,
            'info'
          );
        } else {
          // True cancel before any AI work ran. Surface the retry dialog so
          // the user can re-run (possibly with a different AI model). Only
          // mention credits if there was actually something to refund, and
          // keep it as a trailing note rather than the headline message.
          const refundAmount = Number((result as any).refund_amount) || 0;
          const baseMsg = 'Review cancelled before any pages were reviewed.';
          const errorMessage = refundAmount > 0
            ? `${baseMsg} ${refundAmount} credit${refundAmount !== 1 ? 's' : ''} refunded.`
            : baseMsg;
          console.info('Review cancelled (0 pages processed). ' + errorMessage);
          setSelectAIDialogState({
            title: 'Review Cancelled',
            errorMessage,
            submitLabel: 'Try Again',
            variant: 'cancelled',
          });
        }
      }

    } catch (error) {
      // Report reached terminal state — fetch current status and recover
      if (error instanceof ApiError && error.code === 'JOB_NOT_CANCELLABLE') {
        try {
          const statusResponse = await ApiClient.getReportStatus(currentReport.id);
          if (statusResponse.report) {
            updateReportInBothStates(statusResponse.report);
          }
        } catch { /* ignore fetch failure */ }
        setIsInspecting(false);
        clearInspectionProgress();
        return;
      }
      // If already cancelled/failed, treat as success (fallback for non-idempotent servers)
      if (error instanceof Error && error.message.includes('status: cancelled')) {
        setIsInspecting(false);
        showToast("Review was already cancelled.", 'info');
      } else {
        console.error("Failed to cancel review:", error);
        showToast("Failed to cancel review. Please try again.", 'error');
      }
    } finally {
      setIsCancelling(false);
    }
  };

  // --- Overlay dismiss handler ---
  const handleOverlayDismiss = () => {
    setInspectionSummary(null);
    setInspectionError(null);
    setInspectionContext(null);
    setBatchMeta(null);
    setPreparationMeta(null);
    setRefFilesTotal(null);
    clearInspectionProgress();
  };

  // --- Resume inspection handler ---
  // Calls POST /api/v1/reports/:id/resume to continue from the first unreviewed page.
  // The returned report has job_status=PENDING, which the auto-resume useEffect above
  // picks up to show the overlay and start polling.
  const handleResumeInspection = async () => {
    if (!currentReport?.id || isInspecting) return;
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await ApiClient.resumeReport(currentReport.id, { timezone });
      if (result?.report) {
        // Update state so the auto-resume useEffect sees job_status=PENDING and starts polling.
        setCurrentReport(result.report);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resume review';
      console.error('Failed to resume review:', error);
      showToast(message, 'error');
    }
  };

  return {
    // State
    isInspecting,
    isCancelling,
    inspectingChecklistName,
    inspectingAiModel,
    inspectionStartTime,
    inspectionSummary,
    inspectionError,
    inspectionContext,
    resumedStepIndex,
    selectAIDialogState, setSelectAIDialogState,
    debugInfoData,
    revdokuDocApiElapsedMs,
    pendingInspectionAfterArrange, setPendingInspectionAfterArrange,
    lastInspectedState, setLastInspectedState,
    batchMeta,
    preparationMeta,
    refFilesTotal,

    // Handlers
    handleInspect,
    handleCancelInspection,
    handleOverlayDismiss,
    handleResumeInspection,
  };
}
