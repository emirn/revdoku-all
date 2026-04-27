import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { IEnvelope, ITag } from '@revdoku/lib';
import {
  groupEnvelopesByTag,
  searchGroupedEnvelopes,
  calculateFolderStats,
  buildTabs,
  filterEnvelopesByTab,
  GroupedEnvelopes,
  ComplianceFilter,
  FolderTab
} from '@/lib/envelope-grouping';

export type SortOption = 'name' | 'created' | 'updated';
export type ArchiveTab = 'active' | 'archived';
export type ViewMode = 'list' | 'grid';

interface FolderViewState {
  activeTab: string;
  searchQuery: string;
  sortBy: SortOption;
  complianceFilter: ComplianceFilter;
  archiveTab: ArchiveTab;
  selectedIds: Set<string>;
  viewMode: ViewMode;
}

interface UseFolderViewOptions {
  persistState?: boolean;
  storageKey?: string;
}

export interface UseFolderViewReturn {
  // View state
  activeTab: string;
  searchQuery: string;
  sortBy: SortOption;
  complianceFilter: ComplianceFilter;
  archiveTab: ArchiveTab;
  selectedIds: Set<string>;
  viewMode: ViewMode;

  // Derived data
  groupedEnvelopes: GroupedEnvelopes;
  folderStats: ReturnType<typeof calculateFolderStats>;
  tabs: FolderTab[];
  filteredEnvelopes: IEnvelope[];
  recursiveTagCounts: Record<string, number>;

  // Actions
  setActiveTab: (tab: string) => void;
  setSearchQuery: (query: string) => void;
  setSortBy: (sort: SortOption) => void;
  setComplianceFilter: (filter: ComplianceFilter) => void;
  setArchiveTab: (tab: ArchiveTab) => void;
  setViewMode: (mode: ViewMode) => void;
  setSidebarSelection: (activeTab: string, complianceFilter: ComplianceFilter, archiveTab: ArchiveTab) => void;

  // Selection actions
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
}

const DEFAULT_OPTIONS: Required<UseFolderViewOptions> = {
  persistState: true,
  storageKey: 'envelope-folder-view'
};

export function useFolderView(
  envelopes: IEnvelope[],
  tags: ITag[],
  options: UseFolderViewOptions = {}
): UseFolderViewReturn {
  const config = { ...DEFAULT_OPTIONS, ...options };

  // Initialize state from localStorage if available
  const [state, setState] = useState<FolderViewState>(() => {
    const initialState: FolderViewState = {
      activeTab: 'all',
      searchQuery: '',
      sortBy: 'updated' as SortOption,
      complianceFilter: 'all' as ComplianceFilter,
      archiveTab: 'active' as ArchiveTab,
      selectedIds: new Set<string>(),
      viewMode: 'list' as ViewMode
    };

    if (config.persistState && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(config.storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          return {
            ...initialState,
            activeTab: parsed.activeTab || initialState.activeTab,
            searchQuery: parsed.searchQuery || initialState.searchQuery,
            sortBy: parsed.sortBy || initialState.sortBy,
            complianceFilter: parsed.complianceFilter || initialState.complianceFilter,
            archiveTab: parsed.archiveTab || initialState.archiveTab,
            viewMode: parsed.viewMode || initialState.viewMode
          };
        }
      } catch (error) {
        console.debug('Failed to load folder view state from localStorage:', error);
      }
    }

    return initialState;
  });

  // Persist state to localStorage (exclude selectedIds — transient)
  useEffect(() => {
    if (config.persistState && typeof window !== 'undefined') {
      try {
        const stateToSave = {
          activeTab: state.activeTab,
          searchQuery: state.searchQuery,
          sortBy: state.sortBy,
          complianceFilter: state.complianceFilter,
          archiveTab: state.archiveTab,
          viewMode: state.viewMode
        };
        localStorage.setItem(config.storageKey, JSON.stringify(stateToSave));
      } catch (error) {
        console.debug('Failed to save folder view state to localStorage:', error);
      }
    }
  }, [state.activeTab, state.searchQuery, state.sortBy, state.complianceFilter, state.archiveTab, state.viewMode, config.persistState, config.storageKey]);

  // Stable sort order — only recompute when sort criteria or envelope count changes,
  // NOT when envelope metadata (like tags) changes. This prevents jarring re-sorts
  // when the user is editing tags.
  const sortOrderRef = useRef<string[]>([]);
  const prevSortByRef = useRef(state.sortBy);
  const prevEnvelopeCountRef = useRef(envelopes.length);

  const computeSortOrder = useCallback((envs: IEnvelope[], sortBy: SortOption): string[] => {
    return [...envs].sort((a, b) => {
      const aStarred = a.starred ? 1 : 0;
      const bStarred = b.starred ? 1 : 0;
      if (aStarred !== bStarred) return bStarred - aStarred;

      switch (sortBy) {
        case 'name':
          return (a.title || '').localeCompare(b.title || '');
        case 'created':
          return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
        case 'updated':
        default:
          return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
      }
    }).map(e => e.id);
  }, []);

  // Recompute sort order only on initial load, sort change, or envelope add/remove
  if (
    sortOrderRef.current.length === 0 ||
    prevSortByRef.current !== state.sortBy ||
    prevEnvelopeCountRef.current !== envelopes.length
  ) {
    sortOrderRef.current = computeSortOrder(envelopes, state.sortBy);
    prevSortByRef.current = state.sortBy;
    prevEnvelopeCountRef.current = envelopes.length;
  }

  // Memoized grouped envelopes using stable sort order
  const groupedEnvelopes = useMemo(() => {
    const orderMap = new Map(sortOrderRef.current.map((id, idx) => [id, idx]));
    const sortedEnvelopes = [...envelopes].sort((a, b) => {
      const aIdx = orderMap.get(a.id) ?? Infinity;
      const bIdx = orderMap.get(b.id) ?? Infinity;
      return aIdx - bIdx;
    });

    // Group by tags with compliance filter
    const grouped = groupEnvelopesByTag(sortedEnvelopes, tags, state.complianceFilter);

    // Apply search filter if needed
    if (state.searchQuery.trim()) {
      return searchGroupedEnvelopes(grouped, state.searchQuery);
    }

    return grouped;
  }, [envelopes, tags, state.sortBy, state.searchQuery, state.complianceFilter]);

  // Memoized folder stats
  const folderStats = useMemo(() =>
    calculateFolderStats(groupedEnvelopes, envelopes),
    [groupedEnvelopes, envelopes]
  );

  // Derive tabs from grouped envelopes
  const tabs = useMemo(() =>
    buildTabs(groupedEnvelopes, envelopes),
    [groupedEnvelopes, envelopes]
  );

  // Auto-reset activeTab if the selected tab disappears
  useEffect(() => {
    if (state.activeTab === 'all') return;
    const tabExists = tabs.some(t => t.id === state.activeTab);
    if (!tabExists) {
      setState(prev => ({ ...prev, activeTab: 'all', selectedIds: new Set() }));
    }
  }, [tabs, state.activeTab]);

  // Derive filtered envelopes from active tab, re-sorted by stable order
  const filteredEnvelopes = useMemo(() => {
    const filtered = filterEnvelopesByTab(groupedEnvelopes, state.activeTab, tags);
    const orderMap = new Map(sortOrderRef.current.map((id, idx) => [id, idx]));
    return [...filtered].sort((a, b) => {
      const aIdx = orderMap.get(a.id) ?? Infinity;
      const bIdx = orderMap.get(b.id) ?? Infinity;
      return aIdx - bIdx;
    });
  }, [groupedEnvelopes, state.activeTab, tags]);

  // Compute recursive deduped tag counts (self + all descendants, deduped by envelope id).
  // Walks up the parent hierarchy per envelope-tag, so complexity is O(Envelopes * AvgTags * MaxDepth).
  const recursiveTagCounts = useMemo(() => {
    const parentMap = new Map<string, string>();
    tags.forEach(t => { if (t.parent_id) parentMap.set(t.id, t.parent_id); });

    // For each tag, collect the set of unique envelope IDs that count toward it
    const tagToEnvelopes = new Map<string, Set<string>>();

    const processEnvelope = (e: IEnvelope) => {
      if (!e.tags) return;
      // Collect all ancestor tag IDs for this envelope's tags (deduped)
      const affectedTags = new Set<string>();
      for (const t of e.tags) {
        let curr: string | undefined = t.id;
        while (curr) {
          if (affectedTags.has(curr)) break; // already walked this branch
          affectedTags.add(curr);
          curr = parentMap.get(curr);
        }
      }
      for (const tagId of affectedTags) {
        let set = tagToEnvelopes.get(tagId);
        if (!set) { set = new Set(); tagToEnvelopes.set(tagId, set); }
        set.add(e.id);
      }
    };

    groupedEnvelopes.tagFolders.forEach(folder => folder.envelopes.forEach(processEnvelope));
    groupedEnvelopes.specialFolders.untagged.forEach(processEnvelope);

    const counts: Record<string, number> = {};
    tags.forEach(t => { counts[t.id] = tagToEnvelopes.get(t.id)?.size ?? 0; });
    return counts;
  }, [groupedEnvelopes, tags]);

  // Action creators
  const setActiveTab = useCallback((tab: string) => {
    setState(prev => ({ ...prev, activeTab: tab, selectedIds: new Set() }));
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setState(prev => ({ ...prev, searchQuery: query }));
  }, []);

  const setSortBy = useCallback((sort: SortOption) => {
    setState(prev => ({ ...prev, sortBy: sort }));
  }, []);

  const setComplianceFilter = useCallback((filter: ComplianceFilter) => {
    setState(prev => ({ ...prev, complianceFilter: filter }));
  }, []);

  const setArchiveTab = useCallback((tab: ArchiveTab) => {
    setState(prev => ({ ...prev, archiveTab: tab, selectedIds: new Set() }));
  }, []);

  const setViewMode = useCallback((mode: ViewMode) => {
    setState(prev => ({ ...prev, viewMode: mode }));
  }, []);

  // Atomic sidebar selection — sets activeTab + complianceFilter + archiveTab together
  const setSidebarSelection = useCallback((activeTab: string, complianceFilter: ComplianceFilter, archiveTab: ArchiveTab) => {
    setState(prev => ({ ...prev, activeTab, complianceFilter, archiveTab, selectedIds: new Set() }));
  }, []);

  // Selection actions
  const toggleSelection = useCallback((id: string) => {
    setState(prev => {
      const newSelected = new Set(prev.selectedIds);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return { ...prev, selectedIds: newSelected };
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setState(prev => ({ ...prev, selectedIds: new Set(ids) }));
  }, []);

  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selectedIds: new Set() }));
  }, []);

  const isSelected = useCallback((id: string) => {
    return state.selectedIds.has(id);
  }, [state.selectedIds]);

  return {
    // State
    activeTab: state.activeTab,
    searchQuery: state.searchQuery,
    sortBy: state.sortBy,
    complianceFilter: state.complianceFilter,
    archiveTab: state.archiveTab,
    selectedIds: state.selectedIds,
    viewMode: state.viewMode,

    // Data
    groupedEnvelopes,
    folderStats,
    tabs,
    filteredEnvelopes,
    recursiveTagCounts,

    // Actions
    setActiveTab,
    setSearchQuery,
    setSortBy,
    setComplianceFilter,
    setArchiveTab,
    setViewMode,
    setSidebarSelection,

    // Selection
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected
  };
}
