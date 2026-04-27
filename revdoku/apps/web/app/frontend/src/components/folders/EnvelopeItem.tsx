import React, { useState, useRef, useCallback } from 'react';
import type { IEnvelope, ITag, EnvelopeSource } from '@revdoku/lib';
import { Link } from 'react-router-dom';
import { timeAgo } from '@/lib/date-utils';
import { FileText, Archive, Star, Code, Mail, Check, Loader2, ClipboardCheck, Tag } from 'lucide-react';
import EnvelopeActionsMenu from './EnvelopeActionsMenu';
import { getInspectionStatus, getCompliancePercentColor } from '@/lib/envelope-status';
import TagChip from './TagChip';
import TagPicker from './TagPicker';
import { VersionBadge } from '@/components/ui/VersionBadge';
import { ScriptsBadge } from '@/components/ui/ScriptsBadge';

function SourceBadge({ source }: { source?: EnvelopeSource }) {
  if (!source || source === 'web') return null;
  if (source === 'api') {
    return <span title="Created via API"><Code className="h-3 w-3 text-muted-foreground flex-shrink-0" /></span>;
  }
  if (source === 'email') {
    return <span title="Created via email"><Mail className="h-3 w-3 text-muted-foreground flex-shrink-0" /></span>;
  }
  return null;
}

const EnvelopeItem = React.memo(({
  envelope,
  index,
  onDelete,
  onToggleStar,
  onArchive,
  onUnarchive,
  onDuplicate,
  isArchiveView,
  isSelected,
  onToggleSelection,
  isHighlighted,
  availableTags,
  onToggleTag,
  onManageTags,
  onThumbMouseEnter,
  onThumbMouseLeave,
  showComplianceDot
}: {
  envelope: IEnvelope & { last_report?: any; document_count?: number; revision_count?: number; page_count?: number };
  index: number;
  onDelete?: (id: string) => void;
  onToggleStar?: (id: string) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  isArchiveView?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (id: string) => void;
  isHighlighted?: boolean;
  availableTags?: ITag[];
  onToggleTag?: (envelopeId: string, tagId: string) => void;
  onManageTags?: () => void;
  onThumbMouseEnter?: (envelopeId: string, rect: DOMRect) => void;
  onThumbMouseLeave?: () => void;
  showComplianceDot?: boolean;
}) => {
  const status = getInspectionStatus(envelope);
  const [thumbError, setThumbError] = useState(false);
  const tagPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const thumbWrapperRef = useRef<HTMLDivElement>(null);

  const handleThumbMouseEnter = useCallback(() => {
    if (onThumbMouseEnter && thumbWrapperRef.current && envelope.document_count && envelope.document_count > 0) {
      onThumbMouseEnter(envelope.id, thumbWrapperRef.current.getBoundingClientRect());
    }
  }, [envelope.id, envelope.document_count, onThumbMouseEnter]);

  const handleThumbMouseLeave = useCallback(() => {
    onThumbMouseLeave?.();
  }, [onThumbMouseLeave]);

  return (
    <div className={`flex items-center justify-between px-3 py-2.5 border-b border-border transition-colors ${
      isHighlighted
        ? 'flash-highlight'
        : isSelected
          ? 'bg-indigo-50/50 dark:bg-indigo-950/30'
          : 'hover:bg-accent/50'
    }`}>
      <div className="flex items-start flex-1 min-w-0">
        {/* Selection checkbox */}
        {onToggleSelection && (
          <div className="flex-shrink-0 mr-2.5 mt-0.5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onToggleSelection(envelope.id)}
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                isSelected
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400'
              }`}
            >
              {isSelected && <Check className="h-3 w-3" />}
            </button>
          </div>
        )}

        {/* Document thumbnail or fallback icon */}
        <Link to={`/envelopes/view?id=${envelope.id}`}>
          <div
            ref={thumbWrapperRef}
            className="relative flex-shrink-0 mr-3 mt-0.5 cursor-pointer"
            onMouseEnter={handleThumbMouseEnter}
            onMouseLeave={handleThumbMouseLeave}
          >
            {thumbError ? (
              // Blank-page-with-title fallback: shows a paper-like
              // rectangle carrying the envelope title as small wrapped
              // text. Much more identifiable than a generic FileText
              // icon when scanning a list of envelopes that haven't
              // been reviewed yet (inbound-email, API-created, fresh
              // uploads before pdf.js renders page 1).
              <div className="w-14 h-20 rounded border border-border bg-white dark:bg-gray-900 overflow-hidden flex items-start justify-center p-1">
                <span
                  className="text-[7px] leading-[9px] text-foreground/80 font-medium line-clamp-5 text-center break-words"
                  title={envelope.title || 'Untitled'}
                >
                  {envelope.title || 'Untitled'}
                </span>
              </div>
            ) : (
              <img
                src={`/api/v1/envelopes/${envelope.id}/thumbnail`}
                alt=""
                loading="lazy"
                className="w-14 h-20 object-contain rounded border border-border bg-muted"
                onError={() => setThumbError(true)}
              />
            )}
          </div>
        </Link>
        <div className="flex-1 min-w-0">
          {/* Row 1: Title + lock + source badge + processing spinner + tags */}
          <div className="flex items-center gap-2 flex-wrap">
            {(envelope.last_report?.job_status === 'pending' ||
              envelope.last_report?.job_status === 'processing') && (
              <span title="Review in progress">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500 flex-shrink-0" />
              </span>
            )}

            {/* Star — inline with the title so it doesn't eat a whole
                column before the thumbnail on narrow/mobile viewports. */}
            {onToggleStar && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleStar(envelope.id); }}
                className="flex-shrink-0 hover:scale-110 transition-transform"
                title={envelope.starred ? 'Unstar' : 'Star'}
                aria-label={envelope.starred ? 'Unstar' : 'Star'}
              >
                <Star
                  className={`h-4 w-4 ${
                    envelope.starred
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-muted-foreground/40 hover:text-amber-400'
                  }`}
                />
              </button>
            )}
            {/* Compliance status is indicated by sidebar folder, no dot needed */}
            {envelope.archived_at && <Archive className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />}
            <VersionBadge revisionCount={envelope.revision_count} />
            {(envelope as any).unseen && (
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" title="Updated since last viewed" />
            )}
            <Link
              to={`/envelopes/view?id=${envelope.id}`}
              className={`hover:text-indigo-600 truncate ${(envelope as any).unseen ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground'}`}
            >
              {envelope.title || 'Untitled'}
            </Link>
            <SourceBadge source={envelope.source} />
            {/* Inline tag labels */}
            {availableTags && onToggleTag ? (
              <TagPicker
                availableTags={availableTags}
                assignedTagIds={new Set((envelope.tags || []).map(t => t.id))}
                onToggleTag={(tagId) => onToggleTag(envelope.id, tagId)}
                onManageTags={onManageTags}
              >
                <button ref={tagPickerTriggerRef} className="flex items-center gap-1 flex-shrink-0 group/tag hover:opacity-80 transition-opacity">
                  <ScriptsBadge userScripts={envelope.user_scripts} hasScripts={(envelope as any).has_scripts} />
                  {envelope.tags && envelope.tags.length > 0 ? (
                    envelope.tags.slice(0, 3).map(tag => (
                      <TagChip key={tag.id} tag={tag} size="sm" />
                    ))
                  ) : (
                    <Tag className="h-3 w-3 text-muted-foreground/30 group-hover/tag:text-muted-foreground transition-colors" />
                  )}
                  {envelope.tags && envelope.tags.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">+{envelope.tags.length - 3}</span>
                  )}
                </button>
              </TagPicker>
            ) : (
              <>
                <ScriptsBadge userScripts={envelope.user_scripts} hasScripts={(envelope as any).has_scripts} />
                {envelope.tags && envelope.tags.length > 0 && envelope.tags.slice(0, 3).map(tag => (
                  <TagChip key={tag.id} tag={tag} size="sm" />
                ))}
              </>
            )}
          </div>

          {/* Row 2: Compliance progress */}
          {status.totalChecks > 0 && (
            <div className="flex items-center gap-2 mt-1.5">
              <div className="h-1 max-w-[200px] flex-1 rounded-full overflow-hidden flex">
                <div className="h-full bg-green-500" style={{ width: `${status.progress}%` }} />
                <div className="h-full bg-red-400" style={{ width: `${100 - status.progress}%` }} />
              </div>
              <span title={`${status.passedChecks}/${status.totalChecks} passed`} className={`text-sm font-bold tabular-nums ${getCompliancePercentColor(status.progress)}`}>
                {status.progress}%
              </span>
            </div>
          )}

          {/* Row 3: File/page info + updated ago + checklist */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1 min-w-0">
            {envelope.document_count !== undefined && envelope.document_count > 0 && (
              <span className="flex-shrink-0">
                {envelope.page_count && envelope.page_count > 0
                  ? `${envelope.page_count} ${envelope.page_count === 1 ? 'page' : 'pages'} / ${envelope.document_count} ${envelope.document_count === 1 ? 'file' : 'files'}`
                  : `${envelope.document_count} ${envelope.document_count === 1 ? 'file' : 'files'}`
                }
              </span>
            )}
            {envelope.updated_at && (
              <span className="flex-shrink-0">({envelope.last_report?.job_status === 'completed' ? 'reviewed' : envelope.last_report?.job_status === 'pending' || envelope.last_report?.job_status === 'processing' ? 'review started' : 'updated'} {timeAgo(envelope.updated_at)})</span>
            )}
            {envelope.last_report && (
              <>
                <span className="flex-shrink-0">.</span>
                <ClipboardCheck className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
                <span className="truncate" title={envelope.last_report.checklist_name}>
                  {envelope.last_report.checklist_name || 'Unknown'}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right side: actions dropdown */}
      <div className="flex items-center gap-2 ml-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <EnvelopeActionsMenu
          envelopeId={envelope.id}
          isArchiveView={isArchiveView}
          onDelete={onDelete}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onDuplicate={onDuplicate}
          availableTags={availableTags}
          onToggleTag={onToggleTag}
          tagPickerTriggerRef={tagPickerTriggerRef}
        />
      </div>
    </div>
  );
});

export default EnvelopeItem;
