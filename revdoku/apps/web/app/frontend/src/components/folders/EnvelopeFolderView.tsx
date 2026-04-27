import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { IEnvelope, ITag, IChecklist } from '@revdoku/lib';
import type { UseFolderViewReturn, ArchiveTab } from '@/hooks/useFolderView';
import type { ComplianceFilter } from '@/lib/envelope-grouping';
import { ApiClient } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import VirtualizedEnvelopeList from './VirtualizedEnvelopeList';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, FileText, Archive, ArchiveRestore, Trash2, X, Check, LayoutGrid, LayoutList, Play, Loader2, ClipboardCheck, Eye, Plus, ChevronRight, Clock, Inbox, Star } from 'lucide-react';
import EmptyEnvelopeDropzone from '@/components/EmptyEnvelopeDropzone';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import ChecklistDialog from '@/components/ChecklistDialog';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useEnvelopesLayout } from '@/app/envelopes/EnvelopesLayout';
import GhostTransitionRow from './GhostTransitionRow';

const MAX_BATCH_REVIEW_COUNT = 5;

interface EnvelopeFolderViewProps {
  envelopes: IEnvelope[];
  archivedEnvelopes: IEnvelope[];
  tags: ITag[];
  isLoading?: boolean;
  folderView: UseFolderViewReturn;
  onDeleteEnvelope?: (id: string) => void;
  onToggleStar?: (id: string) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onBulkAction?: (action: 'archive' | 'unarchive' | 'delete', ids: string[]) => void;
  highlightedEnvelopeId?: string | null;
  onToggleTag?: (envelopeId: string, tagId: string) => void;
  onCreateEnvelope?: () => void;
  onCreateEnvelopeWithFiles?: (files: File[]) => void;
}

export default function EnvelopeFolderView({
  envelopes,
  archivedEnvelopes,
  tags,
  isLoading,
  folderView,
  onDeleteEnvelope,
  onToggleStar,
  onArchive,
  onUnarchive,
  onDuplicate,
  onBulkAction,
  highlightedEnvelopeId,
  onToggleTag,
  onCreateEnvelope,
  onCreateEnvelopeWithFiles,
}: EnvelopeFolderViewProps) {
  const {
    searchQuery,
    sortBy,
    archiveTab,
    selectedIds,
    filteredEnvelopes,
    setSearchQuery,
    setSortBy,
    viewMode,
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected,
    setViewMode,
    complianceFilter,
    activeTab,
    folderStats,
    setSidebarSelection,
  } = folderView;

  const features = useFeatureFlags();
  const { folderTransitions } = useEnvelopesLayout();
  const isArchiveView = archiveTab === 'archived';
  const currentEnvelopes = isArchiveView ? archivedEnvelopes : filteredEnvelopes;

  // Ghost rows: transitions whose fromStatus matches the current compliance filter
  const relevantTransitions = useMemo(() => {
    if (isArchiveView || complianceFilter === 'all') return [];
    return folderTransitions.filter(t => t.fromStatus === complianceFilter);
  }, [folderTransitions, complianceFilter, isArchiveView]);
  const selectionCount = selectedIds.size;

  // All visible envelope IDs for "select all"
  const allVisibleIds = useMemo(() => {
    return currentEnvelopes.map(e => e.id);
  }, [currentEnvelopes]);

  const handleSelectAll = () => {
    if (selectionCount === allVisibleIds.length) {
      clearSelection();
    } else {
      selectAll(allVisibleIds);
    }
  };

  const handleBulkArchive = () => {
    if (!onBulkAction) return;
    onBulkAction('archive', Array.from(selectedIds));
    clearSelection();
  };

  const handleBulkUnarchive = () => {
    if (!onBulkAction) return;
    onBulkAction('unarchive', Array.from(selectedIds));
    clearSelection();
  };

  const handleBulkDelete = () => {
    if (!onBulkAction) return;
    if (!window.confirm(`Permanently delete ${selectionCount} envelope${selectionCount > 1 ? 's' : ''}? This action cannot be undone.`)) return;
    onBulkAction('delete', Array.from(selectedIds));
    clearSelection();
  };

  // Batch review state
  const [checklists, setChecklists] = useState<IChecklist[]>([]);
  const [selectedChecklistId, setSelectedChecklistId] = useState<string>('');
  const [batchReviewProgress, setBatchReviewProgress] = useState<{ current: number; total: number } | null>(null);
  const [checklistDialogOpen, setChecklistDialogOpen] = useState(false);
  const [selectedChecklist, setSelectedChecklist] = useState<IChecklist | null>(null);
  // Mobile-only search expansion. On mobile the search input collapses
  // to an icon button (above) so it stops fighting the view/sort/count
  // cluster for horizontal space. Tapping the icon sets this true and
  // the filter row swaps to a full-width search input with a close X.
  // Ignored on `sm:` and up (desktop always shows the inline input).
  const [searchOpenMobile, setSearchOpenMobile] = useState(false);

  // Computed: which selected envelopes already have checklists
  const selectedEnvelopesList = useMemo(() =>
    envelopes.filter(e => selectedIds.has(e.id)), [envelopes, selectedIds]);

  const allSelectedHaveChecklists = useMemo(() =>
    selectedEnvelopesList.length > 0 && selectedEnvelopesList.every(e => (e as any).last_report?.checklist_id),
    [selectedEnvelopesList]);

  const overLimit = selectionCount > MAX_BATCH_REVIEW_COUNT;

  // Fetch checklists when selection appears
  useEffect(() => {
    if (selectionCount > 0 && checklists.length === 0) {
      ApiClient.getChecklists().then(res => setChecklists(res.checklists || [])).catch(() => { });
    }
  }, [selectionCount, checklists.length]);

  const handleBatchReview = useCallback(async () => {
    if (selectionCount === 0) return;
    if (!selectedChecklistId && !allSelectedHaveChecklists) return;

    const envAny = selectedEnvelopesList as any[];
    const reviewable = envAny.filter(e => (e.revision_count ?? 0) > 0 && e.latest_revision_id);

    if (reviewable.length === 0) {
      showToast('None of the selected envelopes have documents to review', 'error');
      return;
    }

    const total = reviewable.length;
    setBatchReviewProgress({ current: 0, total });
    let completed = 0;

    for (let i = 0; i < total; i++) {
      const env = reviewable[i];

      setBatchReviewProgress({ current: i + 1, total });

      // Use selected checklist if set, otherwise use envelope's own checklist
      const checklistId = selectedChecklistId
        || env.last_report?.source_checklist_id
        || env.last_report?.checklist_id;

      if (!checklistId) continue;

      try {
        await ApiClient.createReport({
          envelope_revision_id: env.latest_revision_id,
          checklist_id: checklistId,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        completed++;
      } catch (error: any) {
        if (error?.statusCode === 429) {
          showToast(`Concurrent review limit reached. ${completed} of ${total} reviews started.`, 'info');
          break;
        }
        console.error(`Failed to review envelope ${env.id}:`, error);
      }
    }

    setBatchReviewProgress(null);
    clearSelection();
    showToast(`Started review for ${completed} envelopes`, 'success');
  }, [selectedChecklistId, selectionCount, selectedEnvelopesList, allSelectedHaveChecklists, clearSelection]);

  const canBatchReview = selectionCount > 0 && !overLimit && (selectedChecklistId || allSelectedHaveChecklists) && !batchReviewProgress;

  // Checklist dialog handlers
  const handleViewChecklist = useCallback(async () => {
    if (!selectedChecklistId) return;
    try {
      const res = await ApiClient.getChecklist(selectedChecklistId);
      setSelectedChecklist(res.checklist);
      setChecklistDialogOpen(true);
    } catch { }
  }, [selectedChecklistId]);

  const handleSaveChecklist = useCallback(async (checklist: IChecklist) => {
    await ApiClient.updateChecklist(checklist.id, checklist);
    const res = await ApiClient.getChecklists();
    setChecklists(res.checklists || []);
  }, []);

  const handleDeleteChecklist = useCallback(async (id: string) => {
    await ApiClient.deleteChecklist(id);
    setSelectedChecklistId('');
    setChecklistDialogOpen(false);
    const res = await ApiClient.getChecklists();
    setChecklists(res.checklists || []);
  }, []);

  // Reset onboarding state when user has zero envelopes
  useEffect(() => {
    if (isLoading) return;
    if (envelopes.length === 0 && archivedEnvelopes.length === 0) {
      try {
        localStorage.removeItem('revdoku_onboarding_count');
        localStorage.removeItem('revdoku_hint_dismissed_empty-state-create-envelope');
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('revdoku_onboarding_seen_') || key.startsWith('revdoku_hint_dismissed_guide-'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      } catch { }
    }
  }, [isLoading, envelopes.length, archivedEnvelopes.length]);

  // Empty state — brand-new account with zero envelopes
  if (!isLoading && envelopes.length === 0 && archivedEnvelopes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-[calc(100vh-8rem)] p-6">
        {onCreateEnvelopeWithFiles ? (
          <EmptyEnvelopeDropzone
            icon={
              <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center mb-4">
                <FileText className="h-8 w-8 text-indigo-500" />
              </div>
            }
            headline="Welcome to Revdoku"
            subtext="Drop a document below to create your first envelope and run an inspection."
            onFilesSelected={onCreateEnvelopeWithFiles}
            maxWidthClass="max-w-md"
          />
        ) : onCreateEnvelope ? (
          <>
            <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center mb-4">
              <FileText className="h-8 w-8 text-indigo-500" />
            </div>
            <h3 className="text-2xl font-semibold text-foreground mb-2">Welcome to Revdoku</h3>
            <p className="text-muted-foreground mb-5 text-center max-w-md">
              Drop a document below to create your first envelope and run an inspection.
            </p>
            <Button onClick={onCreateEnvelope}>
              <Plus className="h-4 w-4 mr-2" />
              New Envelope
            </Button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 p-4 space-y-3">
      {/* Bulk Action Bar */}
      {selectionCount > 0 && (
        <div className="flex items-center gap-3 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-lg px-4 py-2">
          <button
            onClick={handleSelectAll}
            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selectionCount === allVisibleIds.length
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
              }`}
          >
            {selectionCount === allVisibleIds.length && <Check className="h-3 w-3" />}
          </button>
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            {selectionCount} selected
          </span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {/* Batch review controls */}
            {features.batch_review && !isArchiveView && checklists.length > 0 && (
              <>
                <div className="flex items-center gap-1">
                  <button
                    onClick={selectedChecklistId ? handleViewChecklist : undefined}
                    className={`flex-shrink-0 p-0.5 ${selectedChecklistId ? 'text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 cursor-pointer' : 'text-indigo-600 dark:text-indigo-400'}`}
                    title={selectedChecklistId ? 'View checklist' : undefined}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" />
                  </button>
                  {selectedChecklistId && (
                    <button
                      onClick={handleViewChecklist}
                      className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 flex-shrink-0 p-0.5"
                      title="View checklist"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <select
                    value={selectedChecklistId}
                    onChange={(e) => setSelectedChecklistId(e.target.value)}
                    className="py-1 px-2 border rounded text-xs bg-background text-foreground border-border min-w-[160px]"
                  >
                    <option value="">-- Select --</option>
                    <optgroup label="Your checklists">
                      {checklists.filter(c => c.checklist_type !== 'report_snapshot').map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name || 'Untitled'} ({c.rules?.length || 0} rules)
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                {!selectedChecklistId && allSelectedHaveChecklists && !overLimit && (
                  <span className="text-xs text-muted-foreground" title="Each envelope will be reviewed with its existing checklist">
                    Using existing checklists
                  </span>
                )}
                {overLimit && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    Max {MAX_BATCH_REVIEW_COUNT} for batch review
                  </span>
                )}
                <Button
                  size="sm"
                  onClick={handleBatchReview}
                  disabled={!canBatchReview}
                  title={
                    overLimit
                      ? `Select up to ${MAX_BATCH_REVIEW_COUNT} envelopes for batch review`
                      : !selectedChecklistId && !allSelectedHaveChecklists
                        ? 'Select a checklist or ensure all envelopes have been reviewed before'
                        : undefined
                  }
                >
                  {batchReviewProgress ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Reviewing {batchReviewProgress.current}/{batchReviewProgress.total}</>
                  ) : (
                    <><Play className="h-3.5 w-3.5 mr-1" />Review Selected</>
                  )}
                </Button>
                <div className="w-px h-6 bg-border" />
              </>
            )}

            {!isArchiveView && onBulkAction && (
              <Button variant="outline" size="sm" onClick={handleBulkArchive}>
                <Archive className="h-3.5 w-3.5 mr-1" />
                Archive
              </Button>
            )}
            {isArchiveView && onBulkAction && (
              <Button variant="outline" size="sm" onClick={handleBulkUnarchive}>
                <ArchiveRestore className="h-3.5 w-3.5 mr-1" />
                Unarchive
              </Button>
            )}
            {onBulkAction && (
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={handleBulkDelete}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Filters + Controls — search, sort, view mode only (sidebar
          handles status/label/archive). On mobile the search input
          collapses to an icon button so it stops squeezing the
          view-mode/sort controls; tapping it expands a full-width
          search row that hides the other controls behind it until
          the user closes it. Desktop (sm:) keeps the inline input. */}
      <div className="flex items-center gap-2 sm:gap-4 border-b border-border pb-3">
        {searchOpenMobile ? (
          <div className="flex items-center gap-2 flex-1 sm:hidden">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search envelopes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => { setSearchOpenMobile(false); setSearchQuery(''); }}
              aria-label="Close search"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            {/* Mobile: magnifying-glass icon button (expands search row). */}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="sm:hidden shrink-0"
              onClick={() => setSearchOpenMobile(true)}
              aria-label="Search envelopes"
              title="Search envelopes"
            >
              <Search className="h-4 w-4" />
            </Button>

            {/* Desktop: inline search input. */}
            <div className="relative flex-1 min-w-0 hidden sm:block">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search envelopes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </>
        )}

        {/* View mode + Sort + count — hidden on mobile when the search
            row is expanded so the search gets the full width. */}
        <div className={`flex items-center gap-2 shrink-0 ${searchOpenMobile ? 'hidden sm:flex' : 'flex'}`}>
          <Select value={viewMode} onValueChange={(value) => setViewMode(value as 'list' | 'grid')}>
            <SelectTrigger className="w-[60px] h-9" title="View mode" aria-label="View mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="list">
                <span className="flex items-center gap-2"><LayoutList className="h-4 w-4" /> List</span>
              </SelectItem>
              <SelectItem value="grid">
                <span className="flex items-center gap-2"><LayoutGrid className="h-4 w-4" /> Grid</span>
              </SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(value) => setSortBy(value as any)}>
            <SelectTrigger className="w-[150px] h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Sort by Name</SelectItem>
              <SelectItem value="created">Sort by Created</SelectItem>
              <SelectItem value="updated">Sort by Updated</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-sm text-muted-foreground whitespace-nowrap hidden sm:inline">
            {currentEnvelopes.length} {currentEnvelopes.length === 1 ? 'envelope' : 'envelopes'}
          </span>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0">
        {isArchiveView ? (
          archivedEnvelopes.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-muted-foreground">
                <Archive className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
                <p>No archived envelopes</p>
              </div>
            </div>
          ) : (
            <VirtualizedEnvelopeList
              envelopes={archivedEnvelopes}
              onDelete={onDeleteEnvelope}
              onToggleStar={onToggleStar}
              onUnarchive={onUnarchive}
              onDuplicate={onDuplicate}
              isArchiveView
              selectedIds={selectedIds}
              onToggleSelection={toggleSelection}
              highlightedEnvelopeId={highlightedEnvelopeId}
              availableTags={tags}
              onToggleTag={onToggleTag}
              viewMode={viewMode}
            />
          )
        ) : filteredEnvelopes.length === 0 && searchQuery ? (
          <div className="text-center py-12">
            <div className="text-muted-foreground">
              <p>No envelopes found matching &ldquo;{searchQuery}&rdquo;</p>
              <Button
                onClick={() => setSearchQuery('')}
                variant="link"
                size="sm"
                className="mt-2 p-0 h-auto"
              >
                Clear search
              </Button>
            </div>
          </div>
        ) : filteredEnvelopes.length === 0 ? (
          <>
            {relevantTransitions.length > 0 && (
              <div className="border-b border-dashed border-border mb-2">
                {relevantTransitions.map(t => (
                  <GhostTransitionRow
                    key={t.envelopeId}
                    transition={t}
                    onNavigate={(toStatus) => setSidebarSelection('all', toStatus as ComplianceFilter, 'active')}
                  />
                ))}
              </div>
            )}
            <ContextualEmptyState
              complianceFilter={complianceFilter}
              activeTab={activeTab}
              onCreateEnvelopeWithFiles={onCreateEnvelopeWithFiles}
              tags={tags}
            />
          </>
        ) : (
          <>
            <VirtualizedEnvelopeList
              envelopes={filteredEnvelopes}
              onDelete={onDeleteEnvelope}
              onToggleStar={onToggleStar}
              onArchive={onArchive}
              onDuplicate={onDuplicate}
              selectedIds={selectedIds}
              onToggleSelection={toggleSelection}
              highlightedEnvelopeId={highlightedEnvelopeId}
              availableTags={tags}
              onToggleTag={onToggleTag}
              viewMode={viewMode}
              showComplianceDot={complianceFilter === 'all' && archiveTab === 'active'}
              showFolderIcon={complianceFilter === 'all' && archiveTab === 'active'}
            />
            {relevantTransitions.length > 0 && (
              <div className="border-t border-dashed border-border mt-1">
                {relevantTransitions.map(t => (
                  <GhostTransitionRow
                    key={t.envelopeId}
                    transition={t}
                    onNavigate={(toStatus) => setSidebarSelection('all', toStatus as ComplianceFilter, 'active')}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Checklist view/edit dialog */}
      <ChecklistDialog
        checklist={selectedChecklist}
        isOpen={checklistDialogOpen}
        onClose={() => setChecklistDialogOpen(false)}
        onSave={handleSaveChecklist}
        onDelete={handleDeleteChecklist}
      />
    </div>
  );
}

function ContextualEmptyState({
  complianceFilter,
  activeTab,
  onCreateEnvelopeWithFiles,
  tags,
}: {
  complianceFilter: string;
  activeTab: string;
  onCreateEnvelopeWithFiles?: (files: File[]) => void;
  tags: ITag[];
}) {
  // Determine folder name and subtitle based on current view.
  // Subtitles intentionally kept short — the empty state is
  // purely action-oriented (drop files / email them in). The
  // previous cross-folder count links and "create empty envelope"
  // text button were removed to simplify the UI; users who want
  // an empty envelope still have that option inside the "+ Open
  // File" dropdown in the sidebar.
  let folderName = 'this view';
  let subtitle = '';

  if (complianceFilter === 'drafts' && activeTab === 'all') {
    folderName = 'Inbox';
    subtitle = 'New envelopes and drafts that haven\'t been reviewed yet appear here';
  } else if (complianceFilter === 'reviewing' && activeTab === 'all') {
    folderName = 'Reviewing';
    subtitle = 'Envelopes with at least one review appear here';
  } else if (complianceFilter === 'revised' && activeTab === 'all') {
    folderName = 'Revised';
    subtitle = 'Envelopes with a new revision since the first review appear here';
  } else if (activeTab === 'recent') {
    folderName = 'Recent';
    subtitle = 'Your most recently updated envelopes appear here';
  } else if (activeTab === 'unread') {
    folderName = 'Unread';
    subtitle = 'Envelopes you haven\'t looked at since their last activity appear here';
  } else if (activeTab === 'starred') {
    folderName = 'Starred';
    subtitle = 'Star your important envelopes to find them here';
  } else if (activeTab !== 'all' && activeTab !== 'untagged') {
    const tag = tags.find(t => t.id === activeTab);
    folderName = tag?.name || 'this label';
    subtitle = 'Envelopes tagged with this label appear here';
  } else if (activeTab === 'untagged') {
    folderName = 'Untagged';
    subtitle = 'Envelopes without any labels appear here';
  }

  if (!onCreateEnvelopeWithFiles) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <FileText className="h-10 w-10 text-muted-foreground/30 mb-4" />
        <p className="text-lg font-medium text-foreground mb-1">No envelopes in {folderName}</p>
        {subtitle && (
          <p className="text-sm text-muted-foreground text-center max-w-sm">{subtitle}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex justify-center py-16">
      <EmptyEnvelopeDropzone
        icon={<FileText className="h-10 w-10 text-muted-foreground/30 mb-4" />}
        headline={`No envelopes in ${folderName}`}
        subtext={subtitle}
        onFilesSelected={onCreateEnvelopeWithFiles}
      />
    </div>
  );
}
