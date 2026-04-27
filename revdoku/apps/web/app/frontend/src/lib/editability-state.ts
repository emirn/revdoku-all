import type { IEnvelopeRevision, IReport, IChecklist } from '@revdoku/lib';

export interface EditabilityInput {
  currentRevision: IEnvelopeRevision | null | undefined;
  currentReport: IReport | null;
  previousReport: IReport | null;
  currentChecklist: IChecklist | null;
  isReadOnlyRevision: boolean;
  isEnvelopeArchived: boolean;
  isInspecting?: boolean;
}

export interface EditabilityState {
  isFirstRevision: boolean;
  isEditingDisabled: boolean;
  isInspecting: boolean;
  hasReport: boolean;
  hasInspectionRun: boolean;
  isReportReset: boolean;
  canResetReport: boolean;
  isChecklistLocked: boolean;
  lockedChecklistId: string | null;
  isSnapshotChecklist: boolean;
  isFilesUnlocked: boolean;
  isModelEditable: boolean;
}

export function getEditabilityState(input: EditabilityInput): EditabilityState {
  const {
    currentRevision,
    currentReport,
    previousReport,
    currentChecklist,
    isReadOnlyRevision,
    isEnvelopeArchived,
    isInspecting: isInspectingInput,
  } = input;

  const isInspecting = !!isInspectingInput;
  const isFirstRevision = currentRevision?.revision_number === 0;
  const isEditingDisabled = isReadOnlyRevision || isEnvelopeArchived || isInspecting;
  const hasReport = !!currentReport;
  // Report was reset = explicit reset status set by the backend
  const isReportReset = hasReport && currentReport?.job_status === 'reset';

  // Inspection has run = report exists AND has been completed (not reset)
  const hasInspectionRun = !!currentReport?.checklist_id && !isReportReset;

  const isChecklistLocked = !isFirstRevision && !isReportReset && (
    previousReport?.checklist_id !== undefined ||
    currentReport?.checklist_id !== undefined
  );

  const lockedChecklistId = isChecklistLocked
    ? (currentReport?.checklist_id || previousReport?.checklist_id || null)
    : null;

  const isSnapshotChecklist = currentChecklist?.checklist_type === 'report_snapshot';

  // Files are fully unlocked only on first revision with no completed inspection
  const isFilesUnlocked = isFirstRevision && !hasInspectionRun;

  // Model is always editable — it only affects the next inspection run
  const isModelEditable = true;

  // Can reset report only on first revision, when a report exists, not already reset, and not read-only
  const canResetReport = isFirstRevision && hasReport && !isReportReset && !isReadOnlyRevision;

  return {
    isFirstRevision,
    isEditingDisabled,
    isInspecting,
    hasReport,
    hasInspectionRun,
    isReportReset,
    canResetReport,
    isChecklistLocked,
    lockedChecklistId,
    isSnapshotChecklist,
    isFilesUnlocked,
    isModelEditable,
  };
}
