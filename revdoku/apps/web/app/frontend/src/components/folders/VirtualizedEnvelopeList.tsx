import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { IEnvelope, ITag } from '@revdoku/lib';
import type { ViewMode } from '@/hooks/useFolderView';
import EnvelopeItem from './EnvelopeItem';
import EnvelopeCard from './EnvelopeCard';
import { VersionBadge } from '@/components/ui/VersionBadge';

interface VirtualizedEnvelopeListProps {
  envelopes: IEnvelope[];
  maxDisplayCount?: number;
  showLoadMore?: boolean;
  onLoadMore?: () => void;
  onDelete?: (id: string) => void;
  onToggleStar?: (id: string) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  isArchiveView?: boolean;
  // Selection
  selectedIds?: Set<string>;
  onToggleSelection?: (id: string) => void;
  // Highlight
  highlightedEnvelopeId?: string | null;
  // Tags
  availableTags?: ITag[];
  onToggleTag?: (envelopeId: string, tagId: string) => void;
  onManageTags?: () => void;
  // View mode
  viewMode?: ViewMode;
  // Show compliance status dot on each item (for "All" view)
  showComplianceDot?: boolean;
  // Show folder icon on each card (for "All" view)
  showFolderIcon?: boolean;
}

const VirtualizedEnvelopeList = React.memo(function VirtualizedEnvelopeList({
  envelopes,
  maxDisplayCount = 50,
  showLoadMore = true,
  onLoadMore,
  onDelete,
  onToggleStar,
  onArchive,
  onUnarchive,
  onDuplicate,
  isArchiveView,
  selectedIds,
  onToggleSelection,
  highlightedEnvelopeId,
  availableTags,
  onToggleTag,
  onManageTags,
  viewMode = 'list',
  showComplianceDot,
  showFolderIcon
}: VirtualizedEnvelopeListProps) {
  const { displayedEnvelopes, hasMore } = useMemo(() => {
    const displayed = envelopes.slice(0, maxDisplayCount);
    const hasMoreItems = envelopes.length > maxDisplayCount;

    return {
      displayedEnvelopes: displayed,
      hasMore: hasMoreItems
    };
  }, [envelopes, maxDisplayCount]);

  // Hover preview state (shared between list and grid views)
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoomPosition, setZoomPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hoveredEnvelope = useMemo(() => {
    if (!hoveredId) return null;
    return displayedEnvelopes.find(e => e.id === hoveredId) || null;
  }, [hoveredId, displayedEnvelopes]);

  const handleThumbMouseEnter = useCallback((envelopeId: string, rect: DOMRect) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      const previewWidth = 316;
      const spaceRight = window.innerWidth - rect.right;
      const left = spaceRight >= previewWidth + 16
        ? rect.right + 8
        : rect.left - previewWidth - 8;
      setZoomPosition({ top: rect.top, left });
      setHoveredId(envelopeId);
    }, 300);
  }, []);

  const handleThumbMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoveredId(null);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const content = viewMode === 'grid' ? (
    <div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
        {displayedEnvelopes.map((envelope) => (
          <EnvelopeCard
            key={envelope.id}
            envelope={envelope}
            onDelete={onDelete}
            onToggleStar={onToggleStar}
            onArchive={onArchive}
            onUnarchive={onUnarchive}
            onDuplicate={onDuplicate}
            isArchiveView={isArchiveView}
            isSelected={selectedIds?.has(envelope.id)}
            onToggleSelection={onToggleSelection}
            availableTags={availableTags}
            onToggleTag={onToggleTag}
            onManageTags={onManageTags}
            onThumbMouseEnter={handleThumbMouseEnter}
            onThumbMouseLeave={handleThumbMouseLeave}
            showFolderIcon={showFolderIcon}
          />
        ))}
      </div>

      {hasMore && showLoadMore && onLoadMore && (
        <div className="text-center pt-4">
          <button
            onClick={onLoadMore}
            className="text-sm text-muted-foreground hover:text-foreground bg-secondary hover:bg-accent px-3 py-1 rounded transition-colors"
          >
            Show {Math.min(50, envelopes.length - maxDisplayCount)} more items...
          </button>
        </div>
      )}

      {hasMore && (!showLoadMore || !onLoadMore) && (
        <div className="text-center pt-4">
          <span className="text-sm text-muted-foreground">
            +{envelopes.length - maxDisplayCount} more items
          </span>
        </div>
      )}
    </div>
  ) : (
    <div className="space-y-0">
      {displayedEnvelopes.map((envelope, index) => (
        <EnvelopeItem
          key={envelope.id}
          envelope={envelope}
          index={index}
          onDelete={onDelete}
          onToggleStar={onToggleStar}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onDuplicate={onDuplicate}
          isArchiveView={isArchiveView}
          isSelected={selectedIds?.has(envelope.id)}
          onToggleSelection={onToggleSelection}
          isHighlighted={envelope.id === highlightedEnvelopeId}
          availableTags={availableTags}
          onToggleTag={onToggleTag}
          onManageTags={onManageTags}
          onThumbMouseEnter={handleThumbMouseEnter}
          onThumbMouseLeave={handleThumbMouseLeave}
          showComplianceDot={showComplianceDot}
        />
      ))}

      {hasMore && showLoadMore && onLoadMore && (
        <div className="text-center pt-2">
          <button
            onClick={onLoadMore}
            className="text-sm text-muted-foreground hover:text-foreground bg-secondary hover:bg-accent px-3 py-1 rounded transition-colors"
          >
            Show {Math.min(50, envelopes.length - maxDisplayCount)} more items...
          </button>
        </div>
      )}

      {hasMore && (!showLoadMore || !onLoadMore) && (
        <div className="text-center pt-2">
          <span className="text-sm text-muted-foreground">
            +{envelopes.length - maxDisplayCount} more items
          </span>
        </div>
      )}
    </div>
  );

  return (
    <>
      {content}

      {/* Hover zoom portal (shared between list and grid views) */}
      {hoveredId && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ top: zoomPosition.top, left: zoomPosition.left }}
        >
          <div className="bg-card border-2 border-border rounded-lg shadow-2xl p-1.5">
            {hoveredEnvelope && (
              <div className="px-1 py-1 text-sm font-medium text-foreground break-words text-center max-w-[300px] flex items-center justify-center gap-1.5">
                <VersionBadge revisionCount={(hoveredEnvelope as any).revision_count} />
                <span>
                  {(hoveredEnvelope.title || 'Untitled').length > 150
                    ? (hoveredEnvelope.title || 'Untitled').slice(0, 150) + '…'
                    : (hoveredEnvelope.title || 'Untitled')}
                </span>
              </div>
            )}
            <img
              src={`/api/v1/envelopes/${hoveredId}/thumbnail`}
              alt=""
              className="w-[300px] h-auto object-contain rounded"
              onError={() => setHoveredId(null)}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
});

export default VirtualizedEnvelopeList;
