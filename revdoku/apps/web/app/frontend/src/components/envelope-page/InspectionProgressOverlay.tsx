// Compact inspection progress card.
//
// Renders as a bottom-right pinned, non-modal card while an AI review is
// running on an envelope. Shows the current step, AI model + star rating,
// elapsed time, batch progress, and a cancel button. On completion shows a
// success/failure summary in the same footprint; on error shows a dismiss
// prompt. The document, top nav, and cross-envelope navigation behind the
// card remain fully interactive — mutating actions are blocked separately
// by `isEditingDisabled` (frontend) and `ensure_report_not_processing!`
// (backend) rather than by this visual element.
//
// The filename and default-export name are legacy (`InspectionProgressOverlay`)
// and will be renamed in a follow-up cleanup PR; keeping the identifier
// stable here to minimize diff surface while the behavior changes land.
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { ClipboardCheck, ArrowRight, Minimize2, Maximize2, AlertTriangle, CheckCircle2, GitCompareArrows, Paperclip, Info } from "lucide-react";
import { type IAIModelOption, starRating } from "@/lib/ai-model-utils";
import { AI_DISCLAIMER } from "@/lib/constants";

export interface InspectionContext {
  totalRules: number;
  templateRules: number;
  userRules: number;
  previousFailedCount: number;
  previousPassedCount: number;
  isReinspection: boolean;
  trackChanges: boolean;
}

export interface BatchProgressMeta {
  pages_processed?: number;
  total_pages?: number;
  total_batches?: number;
  batch_size?: number;
}

// Phase-0 progress: how many reference files have finished OCR/normalize.
// Populated by useInspection polling report.meta. When present, the
// overlay shows "Preparing reference files (X/Y)..." instead of the
// normal animated step label.
export interface PreparationProgressMeta {
  phase: string;
  ready: number;
  total: number;
}

interface InspectionProgressOverlayProps {
  isVisible: boolean;
  checklistName: string | null;
  aiModel?: IAIModelOption | null;
  reportSummary: { passedCount: number; failedCount: number; changesCount: number } | null;
  inspectionError?: string | null;
  onDismiss: () => void;
  inspectionContext?: InspectionContext | null;
  reportStartTime?: string | null; // ISO timestamp of when the report was created
  reportId?: string | null; // Report ID for cancellation
  onCancel?: () => void; // Callback when cancel clicked
  initialStepIndex?: number; // Start from this step on resume (e.g. after page refresh)
  onStepChange?: (stepIndex: number) => void; // Callback when step advances
  batchMeta?: BatchProgressMeta | null; // Real-time batch progress from report.meta polling
  preparationMeta?: PreparationProgressMeta | null; // Phase-0 reference file normalization progress
  // Number of reference files the dialog said would be used for this review
  // (pinned #ref[...] slots + ad-hoc refs from "Add note"). Known before the
  // job starts; surfaced as a "Using N reference file(s)" subtitle so users
  // see ref usage immediately rather than only during the phase-0 window.
  refFilesTotal?: number | null;
  // Best-effort total page count for the current revision's document,
  // derived from react-pdf's onDocumentLoadSuccess in the parent viewer.
  // Used only as a pre-polling estimate for the main progress bar —
  // `batchMeta.total_pages` becomes authoritative the moment it arrives.
  totalPagesHint?: number | null;
  pageStatuses?: Record<string, number>; // Per-page status for "Continue review" decision
  isCancelling?: boolean; // True while cancel request is in flight (disables buttons)
  onReviewRemaining?: () => void; // Callback for "Continue review (remaining pages)" action
}

interface Step {
  label: string;
  icon: string;
  delay: number; // seconds after start to transition to this step
}

const STEPS: Step[] = [
  { label: "Checklist", icon: "checklist", delay: 0 },
  { label: "Preparing documents...", icon: "\u{1F4C4}", delay: 3 },
  { label: "Analyzing pages...", icon: "\u{1F50D}", delay: 8 },
  { label: "Reviewing checks...", icon: "\u{1F4DD}", delay: 15 },
  { label: "Finalizing report...", icon: "\u2705", delay: 25 },
];

const STEPS_WITH_TEXT_EXTRACTION: Step[] = [
  { label: "Checklist", icon: "checklist", delay: 0 },
  { label: "Preparing documents...", icon: "\u{1F4C4}", delay: 3 },
  { label: "Extracting page text (for non-rules changes detection)...", icon: "\u{1F4DD}", delay: 6 },
  { label: "Analyzing pages...", icon: "\u{1F50D}", delay: 14 },
  { label: "Reviewing checks...", icon: "\u{1F4DD}", delay: 22 },
  { label: "Finalizing report...", icon: "\u2705", delay: 32 },
];

function buildChecklistSubtitle(ctx: InspectionContext): string {
  const parts: string[] = [];
  parts.push(`${ctx.templateRules} rules`);
  if (ctx.userRules > 0) {
    parts[0] += ` + ${ctx.userRules} envelope`;
  }
  if (ctx.isReinspection && ctx.previousFailedCount > 0) {
    parts.push(`re-checking ${ctx.previousFailedCount} prior issue${ctx.previousFailedCount !== 1 ? 's' : ''}`);
  }
  if (ctx.isReinspection && ctx.previousPassedCount > 0) {
    parts.push(`verifying ${ctx.previousPassedCount} prior pass${ctx.previousPassedCount !== 1 ? 'es' : ''}`);
  }
  if (ctx.trackChanges) {
    parts.push('changes detection (2x credits)');
  }
  return parts.join(', ');
}

function formatElapsedTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// Unified progress for the main splash bar. Four cascading sources, all
// mapped onto one 0-100 bar:
//   1. `preparationMeta`  — authoritative during phase-0 ref-file normalize
//                            (0-8% of the bar).
//   2. `batchMeta`        — authoritative once the job starts reporting
//                            per-page progress (8-92%).
//   3. totalPagesHint     — client-side estimate for the window between
//                            job-start and first batchMeta poll (8-92%,
//                            capped at 95% of the analyze band).
//   4. Time-based steps   — original fallback; capped at 90% so the bar
//                            only reaches 100% when we have authoritative
//                            completion data (finishing === true).
// Monotonic wrapping (never rewind) is applied at the call site via a
// useRef, so switching between sources never makes the bar jump back.
function computeOverallProgress({
  finishing,
  elapsedSeconds,
  currentStepIndex,
  steps,
  preparationMeta,
  batchMeta,
  totalPagesHint,
  aiMaxPages,
}: {
  finishing: boolean;
  elapsedSeconds: number;
  currentStepIndex: number;
  steps: Step[];
  preparationMeta: PreparationProgressMeta | null | undefined;
  batchMeta: BatchProgressMeta | null | undefined;
  totalPagesHint: number | null | undefined;
  aiMaxPages: number | null | undefined;
}): number {
  if (finishing) return 100;

  if (preparationMeta && preparationMeta.total > 0 && preparationMeta.ready < preparationMeta.total) {
    return (preparationMeta.ready / preparationMeta.total) * 8;
  }

  const totalPages = batchMeta?.total_pages ?? 0;
  if (totalPages > 0) {
    const pageFraction = Math.min(1, (batchMeta!.pages_processed || 0) / totalPages);
    return 8 + pageFraction * 84;
  }

  if (totalPagesHint && totalPagesHint > 0) {
    // Per-page wall-clock varies by model tier; models that batch >=10 pages
    // are the faster ones in practice.
    const perPageSec = aiMaxPages && aiMaxPages >= 10 ? 4 : 8;
    const analyzeStart = steps[2]?.delay ?? 8;
    const analyzeElapsed = Math.max(0, elapsedSeconds - analyzeStart);
    const fraction = Math.min(0.95, analyzeElapsed / (totalPagesHint * perPageSec));
    return 8 + fraction * 84;
  }

  const clamped = Math.min(currentStepIndex, steps.length - 1);
  const stepBase = (clamped / steps.length) * 90;
  const nextBase = ((clamped + 1) / steps.length) * 90;
  const stepStart = steps[clamped].delay;
  const stepEnd = steps[clamped + 1]?.delay ?? stepStart + 10;
  const f = Math.min(1, Math.max(0, (elapsedSeconds - stepStart) / (stepEnd - stepStart)));
  return stepBase + f * (nextBase - stepBase);
}

export default function InspectionProgressOverlay({
  isVisible,
  checklistName,
  aiModel,
  reportSummary,
  inspectionError,
  onDismiss,
  inspectionContext,
  reportStartTime,
  reportId,
  onCancel,
  initialStepIndex,
  onStepChange,
  batchMeta,
  preparationMeta,
  refFilesTotal,
  totalPagesHint,
  pageStatuses: _pageStatuses,
  isCancelling = false,
  onReviewRemaining: _onReviewRemaining,
}: InspectionProgressOverlayProps) {
  const steps = inspectionContext?.trackChanges ? STEPS_WITH_TEXT_EXTRACTION : STEPS;
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Starts centered (prominent). "Run in background" sends it to the
  // bottom-right corner. User can click expand to bring it back.
  const [minimized, setMinimized] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevVisibleRef = useRef(false);
  // Rewind guard for the main progress bar. computeOverallProgress can
  // legitimately return a smaller number when the data source flips
  // (time-based → first batchMeta poll); we clamp to the max we've ever
  // shown so the bar never visibly jumps backward.
  const maxProgressRef = useRef(0);

  // Main visibility effect: start timers or trigger finishing phase
  useLayoutEffect(() => {
    if (isVisible) {
      setFinishing(false);
      setShowSummary(false);
      setMinimized(false);
      maxProgressRef.current = 0;

      const startStep = Math.min(
        initialStepIndex && initialStepIndex > 0 ? initialStepIndex : 0,
        steps.length - 1
      );
      setCurrentStepIndex(startStep);

      // Set up timers only for steps beyond the starting step
      const timers = steps.slice(1).map((step, i) => {
        const targetIndex = i + 1;
        if (targetIndex <= startStep) return null; // Already past this step
        // Calculate delay relative to the start step's delay
        const relativeDelay = (step.delay - (steps[startStep]?.delay || 0)) * 1000;
        return setTimeout(() => setCurrentStepIndex(targetIndex), Math.max(0, relativeDelay));
      }).filter((t): t is ReturnType<typeof setTimeout> => t !== null);
      timersRef.current = timers;

      return () => timers.forEach(clearTimeout);
    } else if (prevVisibleRef.current) {
      // Transition from visible -> hidden: enter finishing phase
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      if (reportSummary) {
        // Summary data already available (e.g. ActionCable shortcut) — skip animation
        setCurrentStepIndex(steps.length - 1);
        setShowSummary(true);
      } else {
        setFinishing(true);
      }
    }
  }, [isVisible]);

  // Track previous isVisible value
  useLayoutEffect(() => {
    prevVisibleRef.current = isVisible;
  }, [isVisible]);

  // Notify parent when step changes
  useEffect(() => {
    if (isVisible && onStepChange) {
      onStepChange(currentStepIndex);
    }
  }, [currentStepIndex]);

  // Timer: calculate elapsed time and update every second
  useEffect(() => {
    if (!isVisible || showSummary) return;

    // Calculate initial elapsed seconds from reportStartTime
    const calculateElapsed = () => {
      if (reportStartTime) {
        const startTime = new Date(reportStartTime).getTime();
        const now = Date.now();
        return Math.floor((now - startTime) / 1000);
      }
      return 0;
    };

    // Set initial elapsed time
    setElapsedSeconds(calculateElapsed());

    // Update every second
    const interval = setInterval(() => {
      setElapsedSeconds(calculateElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [isVisible, showSummary, reportStartTime]);

  // Rapid step advancement during finishing phase
  useEffect(() => {
    if (!finishing) return;

    const interval = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev >= steps.length - 1) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 200);

    return () => clearInterval(interval);
  }, [finishing]);

  // Once all steps completed during finishing, show summary or hide
  useEffect(() => {
    if (finishing && currentStepIndex >= steps.length - 1) {
      const timeout = setTimeout(() => {
        if (reportSummary) {
          setShowSummary(true);
          setFinishing(false);
        } else {
          setFinishing(false);
          setCurrentStepIndex(0);
        }
      }, 600);
      return () => clearTimeout(timeout);
    }
  }, [finishing, currentStepIndex, reportSummary]);

  // Reset when reportSummary is cleared (dismissed from parent)
  useEffect(() => {
    if (!reportSummary) {
      setShowSummary(false);
    }
  }, [reportSummary]);

  if (!isVisible && !finishing && !showSummary && !inspectionError) return null;

  const hasFailures = reportSummary && reportSummary.failedCount > 0;
  const totalChecks = reportSummary ? reportSummary.passedCount + reportSummary.failedCount : 0;
  const compliancePct = totalChecks > 0 ? Math.round((reportSummary!.passedCount / totalChecks) * 100) : 0;

  // Unified progress: prefer authoritative server signals (preparationMeta →
  // batchMeta) when present, fall back to a client-side estimate using the
  // currently-rendered document's page count + the AI model's max batch size,
  // and finally to the original pure time-based animation. Clamped monotonic
  // so flipping sources never visually rewinds the bar.
  const rawProgressPct = computeOverallProgress({
    finishing,
    elapsedSeconds,
    currentStepIndex,
    steps,
    preparationMeta,
    batchMeta,
    totalPagesHint,
    aiMaxPages: aiModel?.max_pages ?? null,
  });
  const progressPct = Math.max(maxProgressRef.current, rawProgressPct);
  maxProgressRef.current = progressPct;

  // Resolve the step being displayed right now (single line instead of the
  // old 5-row vertical list). While finishing we freeze on the last step.
  const clampedStepIndex = Math.min(
    finishing ? steps.length - 1 : currentStepIndex,
    steps.length - 1,
  );
  const currentStepLabel = (() => {
    // Phase 0: reference file normalization runs before the main
    // inspection loop. When the job is in this phase, CreateReportJob
    // writes preparationMeta into report.meta and useInspection surfaces
    // it here. Takes precedence over the normal animated steps.
    if (preparationMeta && preparationMeta.total > 0 && preparationMeta.ready < preparationMeta.total) {
      return `Preparing reference files (${preparationMeta.ready}/${preparationMeta.total})…`;
    }
    const step = steps[clampedStepIndex];
    if (!step) return "";
    if (clampedStepIndex === 0 && checklistName) return checklistName;
    return step.label;
  })();
  const checklistSubtitle =
    clampedStepIndex === 0 && inspectionContext ? buildChecklistSubtitle(inspectionContext) : null;

  // Authoritative ref-file count to surface. preparationMeta (server-side,
  // pushed once the job enters phase 0) wins because it reflects what the
  // job actually resolved; the dialog-supplied refFilesTotal fills the gap
  // before polling catches up.
  const effectiveRefFilesTotal: number =
    preparationMeta && preparationMeta.total > 0
      ? preparationMeta.total
      : (refFilesTotal && refFilesTotal > 0 ? refFilesTotal : 0);
  const refFilesSubtitle: string | null =
    // Suppress once the explicit "Preparing reference files (X/Y)…" label
    // takes over — no need to say the same thing twice.
    effectiveRefFilesTotal > 0 && !(preparationMeta && preparationMeta.total > 0 && preparationMeta.ready < preparationMeta.total)
      ? `Using ${effectiveRefFilesTotal} reference file${effectiveRefFilesTotal === 1 ? '' : 's'}`
      : null;

  // Completion summary renders as a centered modal with a dimmed backdrop —
  // the legacy full-screen splash feel, but scoped. Clicking the backdrop or
  // the "Explore Results" button dismisses it and the document behind
  // becomes interactive again.
  if (showSummary && reportSummary && !inspectionError) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto"
          onClick={onDismiss}
        />
        <div className="relative pointer-events-auto w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6">
          <SummaryView
            passedCount={reportSummary.passedCount}
            failedCount={reportSummary.failedCount}
            changesCount={reportSummary.changesCount}
            compliancePct={compliancePct}
            hasFailures={!!hasFailures}
            onDismiss={onDismiss}
            checklistName={checklistName}
            aiModel={aiModel}
            trackChanges={inspectionContext?.trackChanges}
          />
        </div>
      </div>
    );
  }

  // Two positions, one component:
  // - Centered (default on start): full-screen flex container with subtle
  //   backdrop, card in the middle, "Run in background" button below.
  // - Bottom-right corner (minimized): pinned card with expand button.
  // Position/size swap is instant — animating between very different
  // anchor points produced a visible skew/scale morph that read as a
  // glitch. Per-element transitions (colors, opacity, progress bar
  // width) stay below where they're useful.
  return (
    <div
      className={`fixed z-40 ${
        minimized
          ? 'bottom-4 right-4 w-96 max-w-[calc(100vw-2rem)] max-sm:left-0 max-sm:right-0 max-sm:bottom-0 max-sm:max-w-none'
          : 'inset-0 flex items-center justify-center p-4'
      }`}
    >
      {!minimized && (
        <div className="absolute inset-0 bg-black/10 backdrop-blur-[2px] pointer-events-auto" onClick={() => setMinimized(true)} />
      )}
      <div className={`relative pointer-events-auto bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm rounded-xl shadow-xl border-2 border-indigo-200 dark:border-indigo-800 p-5 ${
        minimized ? 'w-full max-sm:rounded-none' : 'w-96 max-w-[calc(100vw-2rem)]'
      }`}>
        {inspectionError ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground">Review failed</h3>
                <p className="text-xs text-muted-foreground mt-0.5 break-words">{inspectionError}</p>
              </div>
            </div>
            <button
              onClick={onDismiss}
              className="w-full py-1.5 px-3 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Dismiss
            </button>
          </div>
        ) : (
          <div className={minimized ? "space-y-2" : "space-y-3"}>
            {/* Title + elapsed timer row */}
            <div className="flex justify-between items-center gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin flex-shrink-0" />
                <span className="text-sm font-medium text-foreground truncate">Review in progress</span>
              </div>
              <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400 flex-shrink-0">
                {formatElapsedTime(elapsedSeconds)}
              </span>
            </div>

            {/* AI model info is surfaced only inline under the
                "Analyzing pages…" step (see StepList subtitleLines) so the
                header stays focused on run-progress state. Previously the
                model name + stars rendered twice (here AND in the step
                list) which felt redundant when expanded. */}

            {minimized ? (
              <>
                {/* Compact one-liner step label — used only when the card is
                    pinned to the bottom-right corner. */}
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                  <span className="text-xs text-muted-foreground truncate">{currentStepLabel}</span>
                </div>
                {checklistSubtitle && (
                  <div className="text-[11px] text-muted-foreground pl-5 -mt-1">{checklistSubtitle}</div>
                )}
                {refFilesSubtitle && (
                  <div className="text-[11px] text-muted-foreground pl-5 -mt-1 flex items-center gap-1">
                    <Paperclip className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{refFilesSubtitle}</span>
                  </div>
                )}
              </>
            ) : (
              <StepList
                steps={steps}
                currentStepIndex={clampedStepIndex}
                finishing={finishing}
                checklistName={checklistName}
                checklistSubtitle={checklistSubtitle}
                refFilesSubtitle={refFilesSubtitle}
                preparationOverrideLabel={
                  preparationMeta && preparationMeta.total > 0 && preparationMeta.ready < preparationMeta.total
                    ? `Preparing reference files (${preparationMeta.ready}/${preparationMeta.total})…`
                    : null
                }
                aiModel={aiModel}
              />
            )}

            {/* Progress bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-1000 ease-linear"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {/* Batch diagnostic — DEV only. Production users see a single
                unified bar; engineers keep the page/batch breakdown as a
                one-line monospace tag so we can still eyeball what the
                backend is actually doing. Tree-shaken from the prod
                bundle via `import.meta.env.DEV`. */}
            {import.meta.env.DEV && batchMeta && (batchMeta.total_pages ?? 0) > 0 && (
              <div className="text-[10px] font-mono text-muted-foreground/80 flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
                <span className="rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1 font-semibold">DEV</span>
                <span>
                  Pages {Math.min((batchMeta.pages_processed || 0) + 1, batchMeta.total_pages!)}–{Math.min((batchMeta.pages_processed || 0) + (batchMeta.batch_size || 0), batchMeta.total_pages!)} / {batchMeta.total_pages}
                </span>
                {(batchMeta.total_batches ?? 0) > 1 && (
                  <span>· Batch {Math.ceil(((batchMeta.pages_processed || 0) / (batchMeta.batch_size || 1)) + 1)}/{batchMeta.total_batches}</span>
                )}
              </div>
            )}

            {/* Cancel button — hidden while entering the finishing phase so
                the user can't cancel a job that's already wrapping up. */}
            {/* Action buttons row */}
            {!finishing && (
              <div className="flex gap-2 pt-1">
                {!minimized ? (
                  <button
                    onClick={() => setMinimized(true)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 transition-colors"
                  >
                    <Minimize2 className="w-3 h-3" />
                    Run in background
                  </button>
                ) : (
                  <button
                    onClick={() => setMinimized(false)}
                    className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted border border-border transition-colors"
                    title="Expand"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                )}
                {onCancel && (
                  <button
                    onClick={onCancel}
                    disabled={isCancelling}
                    aria-busy={isCancelling}
                    className={`${minimized ? 'flex-1' : ''} inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors border focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 ${
                      isCancelling
                        ? 'text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 cursor-wait'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {isCancelling ? (
                      <>
                        <div className="w-3 h-3 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
                        {minimized ? 'Cancelling…' : 'Cancelling — stops after current batch…'}
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Cancel
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Vertical list of inspection phases shown on the full-size splash card.
// Each step gets a status icon (completed check / spinning current / muted
// pending dot) and, for steps 0 and "Analyzing pages…", one or two subtitle
// lines (rule counts, ref-file usage, AI model + stars). Minimized card
// uses a single-line label instead and does NOT render this component.
function StepList({
  steps,
  currentStepIndex,
  finishing,
  checklistName,
  checklistSubtitle,
  refFilesSubtitle,
  preparationOverrideLabel,
  aiModel,
}: {
  steps: Step[];
  currentStepIndex: number;
  finishing: boolean;
  checklistName: string | null;
  checklistSubtitle: string | null;
  refFilesSubtitle: string | null;
  // When non-null, overrides the step-0 label with the phase-0 progress
  // message (e.g. "Preparing reference files (2/3)…"). Leaves subtitles in
  // place so the user still sees rule counts below.
  preparationOverrideLabel: string | null;
  aiModel?: IAIModelOption | null;
}) {
  const allDone = finishing && currentStepIndex >= steps.length - 1;

  return (
    <div className="space-y-2">
      {steps.map((step, index) => {
        const isCompleted = allDone || index < currentStepIndex;
        const isCurrent = !allDone && index === currentStepIndex;
        const isPending = !allDone && index > currentStepIndex;
        const isChecklistStep = index === 0;

        let displayLabel = step.label;
        if (isChecklistStep) {
          if (preparationOverrideLabel) {
            displayLabel = preparationOverrideLabel;
          } else if (checklistName) {
            displayLabel = checklistName;
          }
        }

        const subtitleLines: Array<{ key: string; text: string; withPaperclip?: boolean }> = [];
        if (isChecklistStep && checklistSubtitle) {
          subtitleLines.push({ key: 'rules', text: checklistSubtitle });
        }
        if (isChecklistStep && refFilesSubtitle) {
          subtitleLines.push({ key: 'refs', text: refFilesSubtitle, withPaperclip: true });
        }
        if (step.label === 'Analyzing pages...' && aiModel) {
          subtitleLines.push({ key: 'ai', text: `AI: ${aiModel.name} ${aiModel.stars != null ? starRating(aiModel.stars) : ''}`.trim() });
        }

        return (
          <div
            key={index}
            className={`flex items-start gap-2.5 transition-opacity duration-300 ${isPending ? 'opacity-30' : 'opacity-100'}`}
            style={isCurrent ? { animation: 'slide-up-fade 0.3s ease-out' } : undefined}
          >
            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5">
              {isChecklistStep ? (
                <ClipboardCheck className={`w-4 h-4 ${isCompleted ? 'text-green-500' : isCurrent ? 'text-indigo-500' : 'text-gray-400 dark:text-gray-500'}`} />
              ) : isCompleted ? (
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : isCurrent ? (
                <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
              ) : (
                <div className="w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-600" />
              )}
            </div>
            <div className="flex flex-col min-w-0">
              <span className={`text-sm ${isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground'} truncate`}>
                {displayLabel}
              </span>
              {subtitleLines.map((line) => (
                <span key={line.key} className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                  {line.withPaperclip && <Paperclip className="w-3 h-3 flex-shrink-0" />}
                  <span className="truncate">{line.text}</span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SummaryView({
  passedCount,
  failedCount,
  changesCount,
  compliancePct,
  hasFailures,
  onDismiss,
  checklistName,
  aiModel,
  trackChanges,
}: {
  passedCount: number;
  failedCount: number;
  changesCount: number;
  compliancePct: number;
  hasFailures: boolean;
  onDismiss: () => void;
  checklistName?: string | null;
  aiModel?: IAIModelOption | null;
  trackChanges?: boolean;
}) {
  const badgeColor = compliancePct === 100
    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    : compliancePct >= 80
    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";

  // Split the failed total into compliance issues vs change-detections when
  // the checklist was run with track_changes on. Without track_changes there
  // are no change checks, so "Issues" equals the full failedCount and the
  // Changes pill is hidden.
  const showChangesPill = !!trackChanges && changesCount > 0;
  const issuesPillCount = showChangesPill ? failedCount - changesCount : failedCount;

  // Keyboard shortcuts: Enter or Space dismisses the splash and lands on
  // the results, matching the highlighted "Explore Results" button. The
  // button is auto-focused on mount, so a native click handles it for the
  // user — but the doc-level listener also covers the case where focus
  // landed somewhere else (e.g. a previously-focused viewer element).
  // Skip when the user is typing in an input/textarea so we don't hijack
  // form interaction in some future composition of this view.
  const exploreButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    exploreButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div className="space-y-4" style={{ animation: "slide-up-fade 0.3s ease-out" }}>
      {/* Header row: icon + title + compliance badge all on one line */}
      <div className="flex items-center gap-3">
        {hasFailures ? (
          <svg className="w-8 h-8 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        ) : (
          <svg className="w-8 h-8 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        )}
        <span className="text-lg font-semibold text-foreground flex-1 truncate">
          {hasFailures ? "Review complete" : "All checks passed"}
        </span>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium flex-shrink-0 ${badgeColor}`}>
          {compliancePct}%
        </span>
      </div>

      {/* Stat pills — big number + icon + label, one per outcome. Switches
          between 2-up (Issues / Passed) and 3-up (Issues / Passed / Changes)
          when the checklist has track_changes enabled and detected any
          changes. Auto-flex keeps pills equal width at both sizes. */}
      <div className={`grid ${showChangesPill ? "grid-cols-3" : "grid-cols-2"} gap-2`}>
        <StatPill
          value={issuesPillCount}
          label="Issues"
          tone="issue"
        />
        <StatPill
          value={passedCount}
          label="Passed"
          tone="pass"
        />
        {showChangesPill && (
          <StatPill
            value={changesCount}
            label="Changes"
            tone="change"
          />
        )}
      </div>

      {/* Checklist + AI meta — compact text lines, no nested card */}
      {(checklistName || aiModel) && (
        <div className="space-y-1">
          {checklistName && (
            <div className="text-xs text-muted-foreground truncate">
              Checklist: {checklistName}{trackChanges ? " (changes detection)" : ""}
            </div>
          )}
          {aiModel && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
              <span className="truncate">{aiModel.name}</span>
              {aiModel.stars != null && (
                <span className="text-amber-500 flex-shrink-0">{starRating(aiModel.stars)}</span>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
        {AI_DISCLAIMER}
      </p>

      <div className="pt-2">
        <button
          ref={exploreButtonRef}
          onClick={onDismiss}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-base font-semibold transition-colors bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Explore Results
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// Single outcome stat rendered as a tinted pill card: large count at the top,
// icon + label at the bottom. Tone selects the color scheme; dark-mode
// variants track the site theme. The card grows to fill whatever grid cell
// SummaryView hands it (grid-cols-2 or grid-cols-3), so it stays balanced
// without manual width math.
function StatPill({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "issue" | "pass" | "change";
}) {
  const palette =
    tone === "issue"
      ? {
          wrap: "bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-900",
          value: "text-rose-700 dark:text-rose-300",
          label: "text-rose-700/80 dark:text-rose-300/80",
          icon: AlertTriangle,
        }
      : tone === "pass"
      ? {
          wrap: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900",
          value: "text-emerald-700 dark:text-emerald-300",
          label: "text-emerald-700/80 dark:text-emerald-300/80",
          icon: CheckCircle2,
        }
      : {
          wrap: "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900",
          value: "text-indigo-700 dark:text-indigo-300",
          label: "text-indigo-700/80 dark:text-indigo-300/80",
          icon: GitCompareArrows,
        };
  const Icon = palette.icon;

  return (
    <div
      className={`rounded-lg border ${palette.wrap} px-3 py-2.5 flex flex-col items-center justify-center gap-1 min-w-0`}
    >
      <span className={`text-2xl font-bold tabular-nums leading-none ${palette.value}`}>
        {value}
      </span>
      <span className={`flex items-center gap-1 text-[11px] font-medium ${palette.label}`}>
        <Icon className="h-3 w-3 flex-shrink-0" />
        {label}
      </span>
    </div>
  );
}
