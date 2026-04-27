import { ICheck, IReport, getCheckDataTypeLabels, CheckFilterType, filterChecksByType, getCheckTypes, CheckType, getColorsForCheckResult, formatValDisplay } from "@revdoku/lib";
import { Pencil, Check, X, GitCompareArrows, RefreshCcw } from "lucide-react";

export type CheckFilter = CheckFilterType;

interface CheckNavigatorProps {
  currentReport: IReport | null;
  currentCheckIndex: number;
  onNavigate: (index: number) => void;
  checkFilter: CheckFilter;
  isInspecting: boolean;
  isManualSelectionMode: boolean;
  selectedCheckId: string | null;
  onEditCheck: (check: ICheck) => void;
  isEditingDisabled: boolean;
  // True when the envelope has a user_script defined. The `val=...` badge
  // next to the check description is a script-input hint — if there's no
  // script consuming `val`, surfacing it in the toolbar is noise and
  // looks like a debug leftover. Matches the same gate used in the
  // per-highlight label hover panel in HighlightOverlay.tsx:1930.
  hasEnvelopeScript?: boolean;
  // Opens the Review dialog (same handler the toolbar Review button uses).
  // When omitted, the empty-state "Run Review" link falls back to plain text.
  onRunReview?: () => void;
}

export default function CheckNavigator({
  currentReport,
  currentCheckIndex,
  onNavigate,
  checkFilter,
  isInspecting,
  isManualSelectionMode,
  selectedCheckId,
  onEditCheck,
  isEditingDisabled,
  hasEnvelopeScript = false,
  onRunReview,
}: CheckNavigatorProps) {
  const renderEmptyMessage = (msg: string) => {
    // "No checks, run Review to review documents" — make "Run Review"
    // clickable when a handler is wired. Other empty states (filter
    // produced no results) stay plain text since the action doesn't apply.
    if (msg.includes('run Review') && onRunReview) {
      const [pre, post] = msg.split('run Review');
      return (
        <span className="text-sm text-muted-foreground">
          {pre}
          <button
            type="button"
            onClick={onRunReview}
            className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
          >
            Run Review
          </button>
          {post}
        </span>
      );
    }
    return <span className="text-sm text-muted-foreground">{msg}</span>;
  };
  if (isManualSelectionMode) {
    return (
      <div className="flex items-center space-x-2">
        <span className="text-sm text-amber-700 dark:text-amber-300 font-medium">
          Click and drag on the document to select an area and add an issue
        </span>
      </div>
    );
  }

  if (isInspecting) {
    return (
      <div className="flex items-center space-x-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
        <span className="text-sm text-muted-foreground">Reviewing...</span>
      </div>
    );
  }

  if (!currentReport) {
    return (
      <div className="flex items-center">
        {renderEmptyMessage("No checks, run Review to review documents")}
      </div>
    );
  }

  const allChecks = [...currentReport.checks];
  const totalChecks = allChecks.length;
  const passedChecks = allChecks.filter((c) => c.passed).length;
  const failedChecks = totalChecks - passedChecks;

  // Build the navigable checks list based on filter
  const navigableChecks = filterChecksByType(allChecks, checkFilter);
  navigableChecks.sort((a, b) => (a.check_index ?? a.rule_order ?? 0) - (b.check_index ?? b.rule_order ?? 0));

  const currentCheck = navigableChecks[currentCheckIndex] || null;
  const navigableCount = navigableChecks.length;

  // Derive check type info for styling
  const checkTypes = currentCheck ? getCheckTypes(currentCheck) : null;
  const isChange = checkTypes?.has(CheckType.CHANGE) ?? false;
  const isRecheck = currentCheck?.description?.startsWith('#recheck ') ?? false;
  const hintTextColor = currentCheck ? getColorsForCheckResult(currentCheck).hint_text_color : undefined;

  // Empty state message
  const emptyMessage = (() => {
    if (totalChecks === 0) return "No checks, run Review to review documents";
    switch (checkFilter) {
      case 'failed': return "All checks passed";
      case 'passed': return "No passed checks";
      case 'all': return "No checks to display";
      case 'changes': return "No change detection checks";
      case 'rechecks': return "No recheck results";
      case 'failed_only': return "No rule failures found";
    }
  })();

  // Status icon based on check type
  const statusIcon = (() => {
    if (!currentCheck) return null;
    const iconClass = "w-3.5 h-3.5 flex-shrink-0";
    if (isChange) return <GitCompareArrows className={iconClass} style={{ color: hintTextColor }} />;
    if (isRecheck) return <RefreshCcw className={iconClass} style={{ color: hintTextColor }} />;
    if (currentCheck.passed) return <Check className={iconClass} style={{ color: hintTextColor }} />;
    return <X className={iconClass} style={{ color: hintTextColor }} />;
  })();

  // Description text — strip #recheck prefix for rechecks, then rewrite ref
  // citation markers to a readable inline form so the nav strip doesn't show
  // raw `#ref[file:dfrev_xxx]` tokens. Lookup resolves prefix_id → filename
  // from the report's ref_files_meta when available.
  const descRaw = currentCheck
    ? (isRecheck ? currentCheck.description!.slice('#recheck '.length) : currentCheck.description)
    : '';
  const refMeta: Array<{ document_file_revision_prefix_id?: string; filename?: string | null; description?: string | null }> =
    (currentReport as any)?.ref_files_meta || [];
  const byId = new Map<string, { filename?: string | null; description?: string | null }>();
  refMeta.forEach(r => { if (r.document_file_revision_prefix_id) byId.set(r.document_file_revision_prefix_id, r); });
  const descriptionText = (descRaw || '').replace(
    /#ref\[([^\]]*)\]|#file:(dfrev_[A-Za-z0-9]+)|#file_(\d+)/g,
    (_m, body?: string, dfrevId?: string, fileNum?: string) => {
      if (dfrevId) return `ref: ${byId.get(dfrevId)?.filename || dfrevId}`;
      if (fileNum) {
        const idx = parseInt(fileNum, 10) - 1;
        return `ref: ${refMeta[idx]?.filename || `file_${fileNum}`}`;
      }
      const pin = (body || '').match(/^([a-z][a-z0-9_]*):([^|]+)(?:\|(.*))?$/);
      if (pin) {
        const value = pin[2];
        const pinLabel = pin[3];
        if (pin[1] === 'file' && /^dfrev_|^df_/.test(value)) {
          return `ref: ${byId.get(value)?.filename || pinLabel || value}`;
        }
        return `ref: ${pinLabel || value}`;
      }
      return `ref: ${body || ''}`.trim();
    },
  );

  // Data type tags — recheck excludes 'recheck' label, all use amber style
  const dataTypeTags = currentCheck ? (() => {
    const labels = getCheckDataTypeLabels(currentCheck);
    const filtered = isRecheck ? labels.filter(l => l !== 'recheck') : labels;
    return filtered.map(label => (
      <span key={label} className="inline-flex items-center px-1 py-0 text-[9px] font-semibold rounded flex-shrink-0 whitespace-nowrap" style={{ border: '1px solid rgba(217,119,6,0.3)', background: 'rgba(217,119,6,0.1)', color: '#b45309' }}>{label}</span>
    ));
  })() : [];

  return (
    <div className="flex items-center space-x-2 min-w-0">
      {/* Navigation arrows */}
      <div className="flex items-center space-x-1.5 flex-shrink-0">
        {navigableCount > 0 && (
          <>
            <button
              onClick={() => onNavigate(Math.max(0, currentCheckIndex - 1))}
              disabled={currentCheckIndex <= 0}
              className="w-6 h-6 flex items-center justify-center bg-secondary text-secondary-foreground rounded hover:bg-accent disabled:opacity-30 transition-colors text-xs"
              title="Previous check (K)"
            >
              ←
            </button>
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              {currentCheck ? (currentCheck.check_index ?? (currentCheck.rule_order ?? 0) + 1) : currentCheckIndex + 1}/{navigableCount}
            </span>
            <button
              onClick={() => onNavigate(Math.min(navigableCount - 1, currentCheckIndex + 1))}
              disabled={currentCheckIndex >= navigableCount - 1}
              className="w-6 h-6 flex items-center justify-center bg-secondary text-secondary-foreground rounded hover:bg-accent disabled:opacity-30 transition-colors text-xs"
              title="Next check (J)"
            >
              →
            </button>
          </>
        )}
      </div>

      {/* Separator */}
      {currentCheck && <div className="w-px h-4 bg-border flex-shrink-0" />}

      {/* Check Detail — clickable to open inline editor */}
      {currentCheck && (
        <div
          className={`flex items-center space-x-1.5 min-w-0 flex-1 ${!isEditingDisabled ? 'cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 transition-colors' : ''}`}
          onClick={!isEditingDisabled ? () => onEditCheck(currentCheck) : undefined}
          title={currentCheck.description}
        >
          {/* Status icon */}
          {statusIcon}
          {/* Message */}
          <span className="text-xs truncate min-w-0 flex-1" style={{ color: hintTextColor }}>
            {descriptionText}
          </span>
          {hasEnvelopeScript && currentCheck.data?.val && (
            <span className="text-[10px] font-mono shrink-0" style={{ color: hintTextColor, opacity: 0.7 }}>
              {formatValDisplay(currentCheck.data.val)}
            </span>
          )}
          {dataTypeTags}
        </div>
      )}

      {/* Empty state */}
      {navigableCount === 0 && renderEmptyMessage(emptyMessage ?? "No checks to display")}

      {/* Edit button — pencil icon only */}
      {currentCheck && !isEditingDisabled && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEditCheck(currentCheck);
          }}
          className="flex items-center px-1.5 py-0.5 hover:bg-accent rounded transition-colors flex-shrink-0"
          title="Edit check"
        >
          <Pencil className="w-3 h-3 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
