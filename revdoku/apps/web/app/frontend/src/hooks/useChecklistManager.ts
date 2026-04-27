import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { IChecklist } from '@revdoku/lib';
import { ApiClient } from '@/lib/api-client';
import { v4 as uuidv4 } from 'uuid';

export type ChecklistSortBy = 'name' | 'date' | 'updated' | 'created';

export function useChecklistManager(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const [checklists, setChecklists] = useState<IChecklist[]>([]);
  const [selectedChecklist, setSelectedChecklist] = useState<IChecklist | null>(null);
  const [showAddChecklist, setShowAddChecklist] = useState(false);
  const [showChecklistDetails, setShowChecklistDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<ChecklistSortBy>('updated');
  const lastFetchTime = useRef<number>(0);
  const FETCH_COOLDOWN = 2000; // 2 seconds cooldown between fetches

  const filteredChecklists = useCallback(() => checklists, [checklists]);

  // Fetch checklists from server with debounce
  const fetchChecklists = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchTime.current < FETCH_COOLDOWN) {
      return; // Skip if within cooldown period
    }

    try {
      setIsLoading(true);
      setError(null);

      const result = await ApiClient.getChecklists();

      setChecklists(result.checklists);
      lastFetchTime.current = now;
    } catch (error) {
      console.error('Error fetching data:', error);
      setError(error instanceof Error ? error.message : 'Failed to load checklists. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load checklists when enabled (deferred until envelope loads to avoid concurrent API requests)
  useEffect(() => {
    if (enabled) fetchChecklists(true);
  }, [fetchChecklists, enabled]);

  // Refresh checklists when tab regains focus (e.g. after editing on /checklists page)
  useEffect(() => {
    if (!enabled) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchChecklists(true);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchChecklists, enabled]);

  // Handle viewing checklist details
  const handleViewChecklist = (checklist: IChecklist) => {
    setSelectedChecklist(checklist);
    setShowChecklistDetails(true);
  };

  // Handle closing checklist details
  const handleCloseChecklistDetails = () => {
    setShowChecklistDetails(false);
    setSelectedChecklist(null);
  };

  const getChecklistRevisions = useCallback(
    async (checklist: IChecklist): Promise<any[]> => {
      if (!checklist) return [];

      try {
        const result = await ApiClient.getChecklistVersions(checklist.id);
        return result.versions || [];
      } catch (error) {
        console.error('Error fetching checklist versions:', error);
        return [];
      }
    },
    []
  );

  // Handle saving checklist changes
  const handleSaveChecklist = async (checklist: IChecklist) => {
    try {
      setError(null);

      // Filter out checks with empty (trimmed) prompt
      const cleanedChecklist = {
        ...checklist,
        rules: checklist.rules.filter(rule => rule.prompt?.trim())
      };

      const result = await ApiClient.updateChecklist(cleanedChecklist.id, cleanedChecklist);

      setChecklists(prev => prev.map(a => a.id === result.checklist.id ? { ...a, ...result.checklist } : a));

      return Promise.resolve();
    } catch (error) {
      console.error('Error saving checklist:', error);
      setError(error instanceof Error ? error.message : 'Failed to save checklist. Please try again.');
      return Promise.reject(error);
    }
  };

  const handleDeleteChecklist = async (id: string) => {
    try {
      setError(null);
      await ApiClient.deleteChecklist(id);

      // Update local state after successful deletion
      setChecklists(prev => prev.filter(a => a.id !== id));

      if (selectedChecklist?.id === id) {
        setSelectedChecklist(null);
        setShowChecklistDetails(false);
      }

      return Promise.resolve();
    } catch (error) {
      console.error('Error deleting checklist:', error);
      setError(error instanceof Error ? error.message : 'Failed to delete checklist. Please try again.');
      return Promise.reject(error);
    }
  };

  // Handle adding a new checklist (for manually created checklists)
  const handleAddChecklist = async (checklist: IChecklist): Promise<IChecklist> => {
    try {
      setError(null);

      // Add the checklist to the server
      const result = await ApiClient.createChecklist(checklist);

      // Use the result directly - Rails already transformed it
      const savedChecklist = result.checklist;

      // Update local state
      setChecklists(prev => [...prev, savedChecklist]);

      return savedChecklist;
    } catch (error) {
      console.error('Error adding checklist:', error);
      const message = error instanceof Error ? error.message : 'Failed to add checklist. Please try again.';
      setError(message);
      throw error;
    }
  };

  // Handle a checklist that was already generated and saved by the API
  // This only updates local state without making another API call
  const handleGeneratedChecklist = (checklist: IChecklist): IChecklist => {
    setChecklists(prev => [...prev, checklist]);
    return checklist;
  };

  // Handle duplicating a checklist
  const handleDuplicateChecklist = async (checklist: IChecklist): Promise<IChecklist> => {
    try {
      setError(null);

      // Create a duplicate with new IDs
      const duplicated: IChecklist = {
        ...checklist,
        id: undefined as any, // Server will generate new ID
        name: `Copy of ${checklist.name || 'Untitled'}`,
        rules: checklist.rules.map(rule => ({
          ...rule,
          id: uuidv4() // New IDs for rules
        }))
      };

      const result = await ApiClient.createChecklist(duplicated);
      const savedChecklist = result.checklist;

      // Update local state
      setChecklists(prev => [...prev, savedChecklist]);

      return savedChecklist;
    } catch (error) {
      console.error('Error duplicating checklist:', error);
      const message = error instanceof Error ? error.message : 'Failed to duplicate checklist. Please try again.';
      setError(message);
      throw error;
    }
  };

  // Since we always show latest version, just return all checklists sorted
  const latestChecklistVersions = useMemo(() => {
    return [...checklists].sort((a, b) => {
      if (sortBy === 'date' || sortBy === 'updated') {
        const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return dateB - dateA; // Newest first
      }
      if (sortBy === 'created') {
        const dateA = (a as any).created_at ? new Date((a as any).created_at).getTime() : 0;
        const dateB = (b as any).created_at ? new Date((b as any).created_at).getTime() : 0;
        return dateB - dateA; // Newest first
      }
      return (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }); // Case-insensitive alphabetical
    });
  }, [checklists, sortBy]);

  // Handle rollback with deletion of newer versions
  const handleRollbackChecklist = async (versionId: string) => {
    try {
      setError(null);

      if (!selectedChecklist) {
        throw new Error('No checklist selected for rollback');
      }

      // Call the rollback API
      const result = await ApiClient.rollbackChecklist(selectedChecklist.id, versionId);

      // Update local state with the rolled back checklist
      setChecklists(prev => prev.map(c => c.id === result.checklist.id ? result.checklist : c));
      setSelectedChecklist(result.checklist);

      return Promise.resolve();
    } catch (error) {
      console.error('Error rolling back checklist:', error);
      setError(error instanceof Error ? error.message : 'Failed to rollback checklist. Please try again.');
      return Promise.reject(error);
    }
  };

  return {
    checklists: filteredChecklists(),
    latestChecklists: latestChecklistVersions,
    selectedChecklist,
    setSelectedChecklist,
    showAddChecklist,
    setShowAddChecklist,
    showChecklistDetails,
    isLoading,
    error,
    sortBy,
    setSortBy,
    handleViewChecklist,
    handleCloseChecklistDetails,
    handleSaveChecklist,
    handleDeleteChecklist,
    handleAddChecklist,
    handleGeneratedChecklist,
    handleDuplicateChecklist,
    handleRollbackChecklist,
    getChecklistRevisions,
    fetchChecklists
  };
}
