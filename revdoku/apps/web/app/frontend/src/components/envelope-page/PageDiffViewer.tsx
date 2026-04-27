import type { IPageText } from "@revdoku/lib";
import { getDateTimeAgoAsHumanString } from "@revdoku/lib";
import { X, Copy, Check, ArrowRight, Info } from "lucide-react";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { computePageDiffs, computeHtmlAwareWordDiffs, type TokenChange } from "@/lib/diff-utils";
import { AI_DISCLAIMER } from "@/lib/constants";
import MarkdownDiffDisplay, { MarkdownSingleSideDisplay } from "./MarkdownDiffDisplay";

type ViewMode = 'rendered' | 'side-by-side' | 'raw';

export interface RevisionOption {
  index: number;              // index in the flat `allRevisions` array passed down
  kind?: 'revision' | 'library' | 'ref_file'; // defaults to 'revision' for backwards compat
  revisionNumber?: number;    // 1-indexed display number; only for 'revision' kind
  libraryFileName?: string;   // file name; used for 'library' and 'ref_file' kinds
  createdAt?: string;
  fileNames: string[];
  totalPages: number;
  hasPageTexts: boolean;      // whether page_texts are available (cached client-side)
  pageTexts: IPageText[];     // empty array if not yet loaded
}

/** @deprecated Use RevisionOption with allRevisions prop instead */
export interface RevisionSummary {
  revisionNumber: number;
  createdAt?: string;
  fileNames: string[];
  totalPages: number;
}

interface PageDiffViewerProps {
  allRevisions: RevisionOption[];
  initialPreviousIndex: number;
  initialCurrentIndex: number;
  onClose: () => void;
}

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

function RevisionSelector({
  label,
  variant,
  allRevisions,
  selectedIndex,
  disabledIndex,
  onChange,
}: {
  label: string;
  variant: 'previous' | 'current';
  allRevisions: RevisionOption[];
  selectedIndex: number;
  disabledIndex: number;
  onChange: (index: number) => void;
}) {
  const bgColor = variant === 'previous' ? 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800' : 'bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800';
  const labelColor = variant === 'previous' ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400';
  const selected = allRevisions[selectedIndex];

  // Split into three optgroups so users can distinguish "earlier versions
  // of this document" (revisions) from "reference file attached to this
  // envelope" (ref_file) from "arbitrary library reference" (library).
  // Revisions first (most common comparison), envelope refs second, library
  // last.
  const revisionOpts = allRevisions.filter(r => (r.kind ?? 'revision') === 'revision');
  const refFileOpts = allRevisions.filter(r => r.kind === 'ref_file');
  const libraryOpts = allRevisions.filter(r => r.kind === 'library');

  const labelFor = (rev: RevisionOption): string => {
    if (rev.kind === 'library' || rev.kind === 'ref_file') {
      return rev.libraryFileName || rev.fileNames[0] || (rev.kind === 'library' ? 'Library file' : 'Reference file');
    }
    return `Revision ${rev.revisionNumber}`;
  };

  const renderOption = (rev: RevisionOption) => (
    <option
      key={rev.index}
      value={rev.index}
      disabled={rev.index === disabledIndex || !rev.hasPageTexts}
    >
      {labelFor(rev)}
      {rev.createdAt ? ` (${getDateTimeAgoAsHumanString(rev.createdAt)})` : ''}
      {!rev.hasPageTexts ? ' (no data)' : ''}
    </option>
  );

  // Only wrap in <optgroup> when at least one non-revision group is present,
  // so envelopes with no ref files or library files keep the original flat
  // dropdown look.
  const hasExtraGroups = refFileOpts.length > 0 || libraryOpts.length > 0;
  const selectedLabel = selected ? labelFor(selected) : '';

  return (
    <div className={`flex-1 rounded border px-2.5 py-1 ${bgColor}`}>
      <div className={`text-[10px] font-semibold ${labelColor}`}>{label}</div>
      <select
        value={selectedIndex}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full text-sm font-medium text-gray-900 dark:text-gray-100 bg-transparent border-none p-0 focus:ring-0 focus:outline-none cursor-pointer"
      >
        {revisionOpts.length > 0 && (
          hasExtraGroups
            ? <optgroup label="Revisions">{revisionOpts.map(renderOption)}</optgroup>
            : revisionOpts.map(renderOption)
        )}
        {refFileOpts.length > 0 && (
          <optgroup label="Reference files in this envelope">
            {refFileOpts.map(renderOption)}
          </optgroup>
        )}
        {libraryOpts.length > 0 && (
          <optgroup label="Library">
            {libraryOpts.map(renderOption)}
          </optgroup>
        )}
      </select>
      {selected && (
        <div className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight mt-0.5" title={selectedLabel}>
          {selected.createdAt && (
            <span>{getDateTimeAgoAsHumanString(selected.createdAt)} &middot; {formatShortDate(selected.createdAt)}</span>
          )}
          {selected.fileNames.length > 0 && (
            <div className="text-gray-500 dark:text-gray-400 truncate">{selected.fileNames.join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
}

function PageCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="absolute top-1.5 right-1.5 z-10 p-1 rounded bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors opacity-0 group-hover/page:opacity-100"
      title="Copy page text"
    >
      {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3 text-gray-500" />}
    </button>
  );
}

function WordDiffDisplay({ oldText, newText }: { oldText: string; newText: string }) {
  const segments = useMemo(() => computeHtmlAwareWordDiffs(oldText, newText), [oldText, newText]);

  return (
    <pre className="text-xs mt-1 p-3 bg-gray-50 dark:bg-gray-900 rounded overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
      {segments.map((seg: TokenChange, i: number) => {
        const text = seg.value.join('');
        if (seg.added) {
          return <span key={i} className="bg-green-200 dark:bg-green-900/50 text-green-900 dark:text-green-300 rounded-sm px-0.5">{text}</span>;
        }
        if (seg.removed) {
          return <span key={i} className="bg-red-200 dark:bg-red-900/50 text-red-900 dark:text-red-300 line-through rounded-sm px-0.5">{text}</span>;
        }
        return <span key={i}>{text}</span>;
      })}
    </pre>
  );
}

function useSyncScroll() {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const handleScroll = useCallback((source: 'left' | 'right') => {
    if (syncing.current) return;
    syncing.current = true;
    const src = source === 'left' ? leftRef.current : rightRef.current;
    const dst = source === 'left' ? rightRef.current : leftRef.current;
    if (src && dst) {
      dst.scrollTop = src.scrollTop;
      dst.scrollLeft = src.scrollLeft;
    }
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  return { leftRef, rightRef, handleScroll };
}

function SideBySideRenderedDisplay({ oldText, newText, markDiffs }: { oldText: string; newText: string; markDiffs: boolean }) {
  const { leftRef, rightRef, handleScroll } = useSyncScroll();

  return (
    <div className="mt-1 flex gap-1" style={{ maxHeight: '400px' }}>
      <div className="flex-1 min-w-0 border border-red-200 dark:border-red-800 rounded overflow-hidden flex flex-col">
        <div className="text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 px-2 py-0.5 flex-shrink-0">Previous</div>
        <MarkdownSingleSideDisplay
          ref={leftRef}
          oldText={oldText}
          newText={newText}
          side="old"
          markDiffs={markDiffs}
          onScroll={() => handleScroll('left')}
        />
      </div>
      <div className="flex-1 min-w-0 border border-green-200 dark:border-green-800 rounded overflow-hidden flex flex-col">
        <div className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/50 px-2 py-0.5 flex-shrink-0">Current</div>
        <MarkdownSingleSideDisplay
          ref={rightRef}
          oldText={oldText}
          newText={newText}
          side="new"
          markDiffs={markDiffs}
          onScroll={() => handleScroll('right')}
        />
      </div>
    </div>
  );
}

export default function PageDiffViewer({ allRevisions, initialPreviousIndex, initialCurrentIndex, onClose }: PageDiffViewerProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('rendered');
  const [markDiffs, setMarkDiffs] = useState(true);
  const [prevIdx, setPrevIdx] = useState(initialPreviousIndex);
  const [currIdx, setCurrIdx] = useState(initialCurrentIndex);

  const isSingleRevision = allRevisions.length < 2;
  const previousPageTexts = isSingleRevision ? [] : (allRevisions[prevIdx]?.pageTexts ?? []);
  const currentPageTexts = allRevisions[currIdx]?.pageTexts ?? [];

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const pageDiffs = useMemo(
    () => isSingleRevision ? [] : computePageDiffs(previousPageTexts, currentPageTexts),
    [previousPageTexts, currentPageTexts, isSingleRevision]
  );
  const changedPages = pageDiffs.filter(d => d.has_changes);

  const prevMap = useMemo(
    () => new Map(previousPageTexts.map(p => [p.page, p.text])),
    [previousPageTexts]
  );
  const currMap = useMemo(
    () => new Map(currentPageTexts.map(p => [p.page, p.text])),
    [currentPageTexts]
  );

  const handleCopyAll = () => {
    const text = isSingleRevision
      ? currentPageTexts.map(p => `--- Page ${p.page} ---\n${p.text}`).join("\n\n")
      : pageDiffs.map(d => d.diff).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Dialog */}
      <div
        className="relative bg-background rounded-lg shadow-xl flex flex-col"
        style={{ width: !isSingleRevision && viewMode === 'side-by-side' ? '1200px' : '900px', maxWidth: '95vw', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-muted rounded-t-lg flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold">{isSingleRevision ? 'Revision Content' : 'Revision Changes'}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isSingleRevision
                ? `${currentPageTexts.length} page${currentPageTexts.length !== 1 ? 's' : ''}`
                : `${changedPages.length} page${changedPages.length !== 1 ? "s" : ""} with changes`
              }
            </p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">{AI_DISCLAIMER}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded border dark:border-gray-600 overflow-hidden">
              <button
                onClick={() => setViewMode('rendered')}
                className={`text-xs px-2.5 py-1.5 transition-colors ${
                  viewMode === 'rendered' ? 'bg-gray-200 dark:bg-gray-700 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                Rendered
              </button>
              {!isSingleRevision && (
                <button
                  onClick={() => setViewMode('side-by-side')}
                  className={`text-xs px-2.5 py-1.5 border-l dark:border-gray-600 transition-colors ${
                    viewMode === 'side-by-side' ? 'bg-gray-200 dark:bg-gray-700 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  Side by Side
                </button>
              )}
              <button
                onClick={() => setViewMode('raw')}
                className={`text-xs px-2.5 py-1.5 border-l dark:border-gray-600 transition-colors ${
                  viewMode === 'raw' ? 'bg-gray-200 dark:bg-gray-700 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                Raw
              </button>
            </div>
            {!isSingleRevision && viewMode === 'side-by-side' && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={markDiffs}
                  onChange={(e) => setMarkDiffs(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                />
                Mark diffs
              </label>
            )}
            <button
              onClick={handleCopyAll}
              className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={isSingleRevision ? "Copy all page text" : "Copy all diffs"}
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy all"}
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Revision comparison selectors (multi-revision) */}
        {!isSingleRevision && (
          <div className="px-5 py-3 border-b flex items-center gap-2">
            <RevisionSelector
              label="Previous"
              variant="previous"
              allRevisions={allRevisions}
              selectedIndex={prevIdx}
              disabledIndex={currIdx}
              onChange={setPrevIdx}
            />
            <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <RevisionSelector
              label="Current"
              variant="current"
              allRevisions={allRevisions}
              selectedIndex={currIdx}
              disabledIndex={prevIdx}
              onChange={setCurrIdx}
            />
          </div>
        )}

        {/* Single revision info banner */}
        {isSingleRevision && (
          <div className="px-5 py-3 border-b flex items-center gap-2">
            <div className="flex-1 rounded border px-2.5 py-1 bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800">
              <div className="text-[10px] font-semibold text-green-700 dark:text-green-400">Current</div>
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Revision {allRevisions[0]?.revisionNumber}
                {allRevisions[0]?.createdAt ? ` (${getDateTimeAgoAsHumanString(allRevisions[0].createdAt)})` : ''}
              </div>
              {allRevisions[0]?.fileNames.length > 0 && (
                <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{allRevisions[0].fileNames.join(', ')}</div>
              )}
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 rounded border px-2.5 py-2 bg-muted/50 border-dashed border-muted-foreground/30">
              <div className="flex items-start gap-2">
                <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  No other revisions available. Create a new revision with updated documents to compare changes.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="p-4 space-y-2 overflow-y-auto flex-1">
          {/* Show message when page texts are not available */}
          {currentPageTexts.length === 0 && previousPageTexts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Info className="w-8 h-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">Text comparison is not available for this revision</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-sm">
                Enable &ldquo;Report revision changes&rdquo; in the checklist Rules tab and re-run inspection to extract page text for comparison.
              </p>
            </div>
          ) : isSingleRevision ? (
            /* Single revision: show rendered or raw page content */
            currentPageTexts.map(pt => (
              <details key={pt.page} open>
                <summary className="text-sm font-medium cursor-pointer px-2 py-1.5 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  Page {pt.page}
                </summary>
                <div className="relative group/page">
                  <PageCopyButton text={pt.text} />
                  {viewMode === 'raw' ? (
                    <pre className="text-xs mt-1 p-3 bg-gray-50 dark:bg-gray-900 rounded overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">{pt.text}</pre>
                  ) : (
                    <MarkdownSingleSideDisplay
                      oldText={pt.text}
                      newText={pt.text}
                      side="new"
                      markDiffs={false}
                    />
                  )}
                </div>
              </details>
            ))
          ) : (
            /* Multi-revision: show diffs */
            pageDiffs.map(pd => (
              <details key={pd.page} open={pd.has_changes}>
                <summary className={`text-sm font-medium cursor-pointer px-2 py-1.5 rounded ${
                  pd.has_changes ? "text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/50 hover:bg-orange-100 dark:hover:bg-orange-900/50" : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                } transition-colors`}>
                  Page {pd.page} {!pd.has_changes && "(no changes)"}
                </summary>
                {pd.has_changes && (() => {
                  const prevText = prevMap.get(pd.page) || '';
                  const currText = currMap.get(pd.page) || '';
                  return (
                    <div className="relative group/page">
                      <PageCopyButton text={currText} />
                      {viewMode === 'rendered' ? (
                        <MarkdownDiffDisplay oldText={prevText} newText={currText} />
                      ) : viewMode === 'side-by-side' ? (
                        <SideBySideRenderedDisplay oldText={prevText} newText={currText} markDiffs={markDiffs} />
                      ) : (
                        <WordDiffDisplay oldText={prevText} newText={currText} />
                      )}
                    </div>
                  );
                })()}
              </details>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
