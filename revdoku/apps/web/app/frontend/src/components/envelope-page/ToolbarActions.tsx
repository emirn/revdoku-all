import type { IChecklist, IRule, IEnvelopeRevision, IReport, IEnvelopePermissions } from "@revdoku/lib";
import { ClipboardCheck, Lock, FileDown, Paperclip } from "lucide-react";
import OnboardingHint from "@/components/OnboardingHint";

interface RefFileMeta {
  document_file_revision_prefix_id?: string;
  filename?: string | null;
  description?: string | null;
  rule_id?: string | null;
  mime_type?: string | null;
  already_in_library?: boolean;
}

/**
 * Inline ref fragments to splice into the checklist summary line.
 * Returns [", ref quote.pdf", ", ref rule 3: ledger.csv", ...]
 * as React nodes — each filename is a clickable span (role=button) that
 * dispatches `revdoku:open-ref-file`. Must be spans (not buttons) because
 * this content is rendered inside the outer checklist-summary <button>.
 *
 * rulesOrderIndex maps a rule id → its 1-based order in the checklist so
 * we can label rule-scoped refs as "rule 3:".
 */
function renderRefFilesSummary(
  currentReport: IReport | null,
  rulesOrderIndex: Map<string, number>,
): React.ReactNode[] {
  // `ref_files_meta` is unified server-side: it lists both checklist-pinned
  // `#ref[...]` markers AND ad-hoc refs attached via the Review dialog's
  // "+ add note and reference" section. Ad-hoc entries have rule_id=null,
  // so the "ref " (no rule scope) label below still renders correctly.
  const refs: RefFileMeta[] = (currentReport as any)?.ref_files_meta || [];
  if (!refs.length) return [];
  return refs.map((ref, i) => {
    const dfrevId = ref.document_file_revision_prefix_id || '';
    if (!dfrevId) return null;
    const name = ref.filename || ref.description || dfrevId;
    const scopeLabel = ref.rule_id
      ? `ref rule ${rulesOrderIndex.get(ref.rule_id) ?? '?'}: `
      : 'ref ';
    const openRef = (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('revdoku:open-ref-file', {
        detail: { dfrevId, anchorEl: e.currentTarget as HTMLElement },
      }));
    };
    return (
      <span key={`${dfrevId}-${i}`}>
        {', '}
        <span className="text-muted-foreground">{scopeLabel}</span>
        <span
          role="button"
          tabIndex={0}
          onClick={openRef}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openRef(e); }}
          title={`Open reference file: ${name}`}
          className="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 hover:underline cursor-pointer"
        >
          <Paperclip className="h-3 w-3 flex-shrink-0" />
          {name}
        </span>
      </span>
    );
  });
}
function timeAgo(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface ToolbarActionsProps {
  // Checklist state
  currentChecklist: IChecklist | null;
  currentReport: IReport | null;
  checklists: IChecklist[];
  isSnapshotChecklist: boolean;
  isChecklistLocked: boolean;
  lockedChecklistId: string | null;
  isReportReset: boolean;
  isReadOnlyRevision: boolean;
  isInspecting: boolean;
  // Envelope state
  currentEnvelope: { id?: string; archived_at?: string; permissions?: IEnvelopePermissions } | null;
  currentEnvelopeRevision: IEnvelopeRevision | null;
  previousReport: IReport | null;
  // Handlers
  handleViewChecklist: () => void;
  generateReport: () => void;
  showOnboardingHints?: boolean;
  envelopeId?: string;
  showReviewHint?: boolean;
  onReviewHintDismiss?: () => void;
  onOpenSelectAIDialog?: () => void;
  rulesChangedSinceReview?: boolean;
  envelopeRuleCount?: number;
}

export default function ToolbarActions({
  currentChecklist,
  currentReport,
  checklists,
  isSnapshotChecklist,
  isChecklistLocked,
  lockedChecklistId,
  isReportReset,
  isReadOnlyRevision,
  isInspecting,
  currentEnvelope,
  currentEnvelopeRevision,
  previousReport,
  handleViewChecklist,
  generateReport,
  showOnboardingHints,
  envelopeId,
  showReviewHint,
  onReviewHintDismiss,
  onOpenSelectAIDialog,
  rulesChangedSinceReview,
  envelopeRuleCount,
}: ToolbarActionsProps) {
  // Build rule_id → order (1-based) once per render so inline ref file
  // fragments can display "rule N:" labels without repeated index lookups.
  const rulesOrderIndex = (() => {
    const m = new Map<string, number>();
    (currentChecklist?.rules || []).forEach((r: IRule, i: number) => {
      if (r.id) m.set(r.id, i + 1);
    });
    return m;
  })();
  const refFileSummary = renderRefFilesSummary(currentReport, rulesOrderIndex);
  return (
    <>
      {/* Row 1: Actions — Checklist display | Report + Review */}
      <div className="flex items-center justify-between gap-3 px-2 sm:px-4 py-2 border-b border-border">
        {/* Left: Checklist display (read-only) */}
        <div className="flex items-center space-x-1.5 flex-1 min-w-0">
          <button
            onClick={handleViewChecklist}
            className="flex items-center space-x-1 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 flex-shrink-0"
            title="View checklist"
          >
            <ClipboardCheck className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="hidden sm:inline text-sm mr-0.5">Checklist:</span>
          </button>
          {(() => {
            // Locked checklist — amber lock icon
            if (isChecklistLocked && lockedChecklistId && !isReportReset) {
              const lockedChecklist = currentChecklist || checklists.find(c => c.id === lockedChecklistId);
              const prevIssueCount = previousReport?.checks?.filter(c => !c.passed).length || 0;
              const updatedLabel = timeAgo(currentChecklist?.updated_at);
              return (
                <button onClick={handleViewChecklist} className="text-sm text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 flex items-center gap-1 truncate flex-1 min-w-0 transition-colors" title={`${lockedChecklist?.name || "Checklist"} - Locked for consistency — Click to view checklist`}>
                  <Lock className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{lockedChecklist?.name || "Checklist"}</span>
                  {isSnapshotChecklist && (
                    <span className="text-[10px] font-medium text-indigo-500 dark:text-indigo-400 flex-shrink-0">[Snapshot]</span>
                  )}
                  {currentChecklist?.rules && currentChecklist.rules.length > 0 && (() => {
                    const userCount = currentChecklist.rules.filter((r: IRule) => r.origin === 'user').length;
                    const templateCount = currentChecklist.rules.length - userCount;
                    return (
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        ({userCount > 0 ? `${templateCount} + ${userCount} envelope` : `${currentChecklist.rules.length} rules`}{prevIssueCount > 0 ? `, ${prevIssueCount} prev issues` : ''}{refFileSummary})
                      </span>
                    );
                  })()}
                  {updatedLabel && (
                    <span className="text-xs text-muted-foreground flex-shrink-0">&middot; updated {updatedLabel}</span>
                  )}
                </button>
              );
            }

            // Has a checklist with a name (from report or selected) — display name
            if (currentChecklist && currentChecklist.name) {
              const prevIssueCount = previousReport?.checks?.filter(c => !c.passed).length || 0;
              const updatedLabel2 = timeAgo(currentChecklist.updated_at);
              return (
                <button onClick={handleViewChecklist} className="text-sm text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 flex items-center gap-1.5 truncate flex-1 min-w-0 transition-colors" title={`${currentChecklist.name} — Click to view checklist`}>
                  <span className="truncate">{currentChecklist.name}</span>
                  {isSnapshotChecklist && (
                    <span className="text-[10px] font-medium text-indigo-500 dark:text-indigo-400 flex-shrink-0">[Snapshot]</span>
                  )}
                  {currentChecklist.rules && currentChecklist.rules.length > 0 && (() => {
                    const userCount = currentChecklist.rules.filter((r: IRule) => r.origin === 'user').length;
                    const templateCount = currentChecklist.rules.length - userCount;
                    return (
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        ({userCount > 0 ? `${templateCount} + ${userCount} envelope` : `${currentChecklist.rules.length} rules`}{prevIssueCount > 0 ? `, ${prevIssueCount} prev issues` : ''}{refFileSummary})
                      </span>
                    );
                  })()}
                  {updatedLabel2 && (
                    <span className="text-xs text-muted-foreground flex-shrink-0">&middot; updated {updatedLabel2}</span>
                  )}
                  {rulesChangedSinceReview && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex-shrink-0" title="Envelope rules changed since last review — re-run to apply">
                      rules changed
                    </span>
                  )}
                </button>
              );
            }

            // No checklist yet
            if (envelopeRuleCount && envelopeRuleCount > 0) {
              return (
                <button onClick={handleViewChecklist} className="text-sm text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 underline-offset-2 hover:underline transition-colors">
                  No checklist, {envelopeRuleCount} envelope rule{envelopeRuleCount !== 1 ? 's' : ''}
                </button>
              );
            }
            return (
              <span className="text-sm text-muted-foreground italic">No checklist selected, click the &ldquo;Review&rdquo; button to select</span>
            );
          })()}
        </div>

        {/* Right: Report + Review */}
        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {currentReport && (currentReport.checks?.length ?? 0) > 0 && (
            showOnboardingHints ? (
              <OnboardingHint
                hintKey={`guide-share-${envelopeId}`}
                message="Export your review report"
                position="bottom"
                align="end"
              >
                <button
                  onClick={() => generateReport()}
                  className="py-1 px-3 rounded-md text-sm font-medium bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white hover:from-indigo-600 hover:to-pink-600 transition-all flex items-center gap-1"
                  title="Report"
                >
                  <FileDown className="h-4 w-4" />
                  <span className="hidden sm:inline">Report</span>
                </button>
              </OnboardingHint>
            ) : (
              <button
                onClick={() => generateReport()}
                className="py-1 px-3 rounded-md text-sm font-medium bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white hover:from-indigo-600 hover:to-pink-600 transition-all flex items-center gap-1"
                title="Report"
              >
                <FileDown className="h-4 w-4" />
                <span className="hidden sm:inline">Report</span>
              </button>
            )
          )}

          {(() => {
            const hasFiles = currentEnvelopeRevision?.document_file_revision_links && currentEnvelopeRevision.document_file_revision_links.length > 0;
            const reviewDisabled =
              !currentEnvelopeRevision ||
              !hasFiles ||
              isInspecting ||
              !!isReadOnlyRevision ||
              !!currentEnvelope?.archived_at;

            const reviewButton = (
              <button
                onClick={() => onOpenSelectAIDialog?.()}
                disabled={reviewDisabled}
                className="py-1 px-3 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1 flex-shrink-0"
                title={currentEnvelope?.archived_at ? "Envelope is archived" : "Review document"}
              >
                {isInspecting ? (
                  <>
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
                    <span className="hidden sm:inline">Reviewing</span>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
                      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
                      <line x1="14.2" y1="14.2" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span className="hidden sm:inline">Review</span>
                  </>
                )}
              </button>
            );

            const showPulseRing = !currentReport && hasFiles && !isInspecting && !isReadOnlyRevision && !currentEnvelope?.archived_at;

            // Case 1: Transient hint after file rearrangement
            if (showReviewHint && showPulseRing) {
              return (
                <OnboardingHint
                  hintKey="review-after-arrange"
                  message="Review the updated document"
                  position="bottom"
                  align="end"
                  transient
                  autoDismissMs={8000}
                  onDismiss={onReviewHintDismiss}
                >
                  {reviewButton}
                </OnboardingHint>
              );
            }

            // Case 2: One-time onboarding hint (localStorage-persisted)
            if (showOnboardingHints && showPulseRing) {
              return (
                <OnboardingHint
                  hintKey={`guide-inspect-${envelopeId}`}
                  message="Click to review your document"
                  position="bottom"
                  align="end"
                >
                  {reviewButton}
                </OnboardingHint>
              );
            }

            // Case 3: Pulse ring only (no tooltip)
            if (showPulseRing) {
              return (
                <div className="relative inline-flex">
                  {reviewButton}
                  <div className="absolute inset-0 rounded border-2 border-indigo-400 animate-hint-pulse-ring pointer-events-none" />
                </div>
              );
            }

            // Case 4: Plain button
            return reviewButton;
          })()}
        </div>
      </div>
    </>
  );
}
