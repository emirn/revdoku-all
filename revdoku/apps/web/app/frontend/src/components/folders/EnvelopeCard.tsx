import React, { useState, useRef, useCallback } from 'react';
import type { IEnvelope, ITag } from '@revdoku/lib';
import { Link } from 'react-router-dom';
import { FileText, Archive, Star, Check, Loader2, ClipboardCheck, Tag, Inbox, Clock, RefreshCw } from 'lucide-react';
import { timeAgo } from '@/lib/date-utils';
import { getInspectionStatus, getCompliancePercentColor } from '@/lib/envelope-status';
import { getEnvelopeComplianceStatus } from '@/lib/envelope-grouping';
import TagDot from './TagDot';
import TagPicker from './TagPicker';
import EnvelopeActionsMenu from './EnvelopeActionsMenu';
import { VersionBadge } from '@/components/ui/VersionBadge';
import { ScriptsBadge } from '@/components/ui/ScriptsBadge';

const EnvelopeCard = React.memo(({
  envelope,
  onDelete,
  onToggleStar,
  onArchive,
  onUnarchive,
  onDuplicate,
  isArchiveView,
  isSelected,
  onToggleSelection,
  availableTags,
  onToggleTag,
  onManageTags,
  onThumbMouseEnter,
  onThumbMouseLeave,
  showFolderIcon
}: {
  envelope: IEnvelope & { last_report?: any; document_count?: number; revision_count?: number; page_count?: number };
  onDelete?: (id: string) => void;
  onToggleStar?: (id: string) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  isArchiveView?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (id: string) => void;
  availableTags?: ITag[];
  onToggleTag?: (envelopeId: string, tagId: string) => void;
  onManageTags?: () => void;
  onThumbMouseEnter?: (envelopeId: string, rect: DOMRect) => void;
  onThumbMouseLeave?: () => void;
  showFolderIcon?: boolean;
}) => {
  const status = getInspectionStatus(envelope);
  const hasVersionBadge = envelope.revision_count !== undefined && envelope.revision_count >= 2;
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
    <div className={`group relative bg-card border rounded-lg transition-all hover:shadow-md ${isSelected
      ? 'border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30 ring-1 ring-indigo-400'
      : 'border-border hover:border-muted-foreground/50'
      }`}>
      {/* Selection checkbox — visible on hover or when selected */}
      {onToggleSelection && (
        <div
          className={`absolute top-2 left-2 z-10 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => onToggleSelection(envelope.id)}
            className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shadow-sm ${isSelected
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-indigo-400'
              }`}
          >
            {isSelected && <Check className="h-3 w-3" />}
          </button>
        </div>
      )}

      {/* Status icon (top-right, shifts left when version badge present): archive, processing spinner, or folder icon */}
      {envelope.archived_at ? (
        <div className={`absolute top-2 ${hasVersionBadge ? 'right-10' : 'right-2'} z-10 rounded-full bg-white/90 shadow-sm p-1`}>
          <Archive className="h-3 w-3 text-foreground" />
        </div>
      ) : (envelope.last_report?.job_status === 'pending' ||
        envelope.last_report?.job_status === 'processing') ? (
        <div className={`absolute top-2 ${hasVersionBadge ? 'right-10' : 'right-2'} z-10`}>
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        </div>
      ) : showFolderIcon && (() => {
        const compStatus = getEnvelopeComplianceStatus(envelope);
        const isRevised = compStatus === 'reviewing' && (envelope.current_revision_index ?? 0) >= 1;
        const IconComponent = isRevised ? RefreshCw
          : compStatus === 'drafts' ? Inbox
            : Clock;
        const iconColor = 'text-foreground';
        const label = isRevised ? 'Revised'
          : compStatus === 'drafts' ? 'Inbox'
            : 'Reviewing';
        return (
          <div className={`absolute top-2 ${hasVersionBadge ? 'right-10' : 'right-2'} z-10 rounded-full bg-white/90 shadow-sm p-1`} title={label}>
            <IconComponent className={`h-3 w-3 ${iconColor}`} />
          </div>
        );
      })()}

      {/* Thumbnail area — click navigates */}
      <Link to={`/envelopes/view?id=${envelope.id}`} className="block">
        <div
          ref={thumbWrapperRef}
          className="aspect-[3/4] m-1.5 mb-0 bg-muted rounded-md overflow-hidden flex items-center justify-center relative"
          onMouseEnter={handleThumbMouseEnter}
          onMouseLeave={handleThumbMouseLeave}
        >
          {thumbError ? (
            // Blank-page-with-title fallback — paper-like background
            // with the envelope title rendered as wrapped small text.
            // Replaces the generic FileText icon so the list is
            // visually scannable even before any thumbnail has been
            // produced (e.g. inbound-email envelopes, API-created,
            // fresh uploads in the moment before the client-side pdf.js
            // render posts its capture). Keeps the aspect-ratio frame
            // from the parent wrapper.
            <div className="w-full h-full bg-white dark:bg-gray-900 flex items-start justify-center p-3">
              <span
                className="text-[11px] leading-tight text-foreground/80 font-medium line-clamp-6 text-center break-words"
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
              className="w-full h-full object-contain"
              onError={() => setThumbError(true)}
            />
          )}
          <div className="absolute top-1.5 right-1.5 z-[5] flex items-center gap-1">
            <ScriptsBadge userScripts={envelope.user_scripts} hasScripts={(envelope as any).has_scripts} className="shadow-sm" />
            {envelope.revision_count !== undefined && envelope.revision_count >= 2 && (
              <VersionBadge revisionCount={envelope.revision_count} className="shadow-sm" />
            )}
          </div>
        </div>
      </Link>

      {/* Card info */}
      <div className="p-2 pt-1.5 space-y-1">
        {/* Title row: star + title + actions */}
        <div className="flex items-center gap-1">
          {onToggleStar && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleStar(envelope.id); }}
              className="flex-shrink-0 hover:scale-110 transition-transform"
              title={envelope.starred ? 'Unstar' : 'Star'}
            >
              <Star
                className={`h-3.5 w-3.5 ${envelope.starred
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-muted-foreground/40 hover:text-amber-400'
                  }`}
              />
            </button>
          )}
          {(envelope as any).unseen && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
          )}
          <Link
            to={`/envelopes/view?id=${envelope.id}`}
            className={`flex-1 min-w-0 text-sm hover:text-indigo-600 line-clamp-2 break-words leading-tight ${(envelope as any).unseen ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground'}`}
            title={envelope.title || 'Untitled'}
          >
            {envelope.title || 'Untitled'}
          </Link>
          <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
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

        {/* Checklist name */}
        {envelope.last_report && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <ClipboardCheck className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
            <span className="truncate" title={envelope.last_report.checklist_name}>
              {envelope.last_report.checklist_name || 'Unknown'}
            </span>
          </div>
        )}

        {/* Progress bar */}
        {status.totalChecks > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="h-1 flex-1 rounded-full overflow-hidden flex">
              <div className="h-full bg-green-500" style={{ width: `${status.progress}%` }} />
              <div className="h-full bg-red-400" style={{ width: `${100 - status.progress}%` }} />
            </div>
            <span className={`text-xs font-bold tabular-nums ${getCompliancePercentColor(status.progress)}`}>
              {status.progress}%
            </span>
          </div>
        )}

        {/* Tag dots */}
        {availableTags && onToggleTag ? (
          <TagPicker
            availableTags={availableTags}
            assignedTagIds={new Set((envelope.tags || []).map(t => t.id))}
            onToggleTag={(tagId) => onToggleTag(envelope.id, tagId)}
            onManageTags={onManageTags}
          >
            <button ref={tagPickerTriggerRef} className="flex items-center gap-1 flex-shrink-0 group/tag hover:opacity-80 transition-opacity">
              {envelope.tags && envelope.tags.length > 0 ? (
                envelope.tags.slice(0, 3).map(tag => (
                  <TagDot key={tag.id} color={tag.color} size="lg" name={tag.name} showLetter />
                ))
              ) : (
                <Tag className="h-3 w-3 text-muted-foreground/30 group-hover/tag:text-muted-foreground transition-colors" />
              )}
              {envelope.tags && envelope.tags.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{envelope.tags.length - 3}</span>
              )}
            </button>
          </TagPicker>
        ) : envelope.tags && envelope.tags.length > 0 ? (
          <div className="flex items-center gap-1">
            {envelope.tags.slice(0, 3).map(tag => (
              <TagDot key={tag.id} color={tag.color} size="lg" name={tag.name} showLetter />
            ))}
            {envelope.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{envelope.tags.length - 3}</span>
            )}
          </div>
        ) : null}

        {/* Updated time */}
        {envelope.updated_at && (
          <div className="text-[10px] text-muted-foreground/50" title={new Date(envelope.updated_at).toLocaleString()}>
            {envelope.last_report?.job_status === 'completed' ? 'reviewed' : envelope.last_report?.job_status === 'pending' || envelope.last_report?.job_status === 'processing' ? 'review started' : 'updated'} {timeAgo(envelope.updated_at)}
          </div>
        )}
      </div>
    </div>
  );
});

export default EnvelopeCard;
