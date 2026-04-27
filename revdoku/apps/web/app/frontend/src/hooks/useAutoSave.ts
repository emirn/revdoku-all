import { useCallback, useEffect, useRef, useState } from 'react';

export interface AutoSaveStatus {
  status: 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  lastSaved?: Date;
  error?: string;
}

export function useAutoSave(
  saveFunction: () => Promise<void>,
  debounceMs: number = 10000 // 10 seconds default
) {
  const [saveStatus, setSaveStatus] = useState<AutoSaveStatus>({ status: 'idle' });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCheckRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  
  const triggerSave = useCallback(async () => {
    if (isSavingRef.current) {
      // If already saving, mark as pending to save again after current save completes
      setSaveStatus(prev => ({ ...prev, status: 'pending' }));
      return;
    }

    try {
      isSavingRef.current = true;
      setSaveStatus(prev => ({ ...prev, status: 'saving' }));
      
      await saveFunction();
      
      setSaveStatus({
        status: 'saved',
        lastSaved: new Date(),
        error: undefined
      });
    } catch (error) {
      setSaveStatus({
        status: 'error',
        error: error instanceof Error ? error.message : 'Save failed',
        lastSaved: undefined
      });
    } finally {
      isSavingRef.current = false;
      
      // Check if there's a pending save
      pendingCheckRef.current = setTimeout(() => {
        pendingCheckRef.current = null;
        setSaveStatus(prev => {
          if (prev.status === 'pending') {
            triggerSave();
            return prev;
          }
          return prev;
        });
      }, 100);
    }
  }, [saveFunction]);

  const debouncedSave = useCallback(() => {
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // Don't queue if already saving - just mark as pending
    if (isSavingRef.current) {
      setSaveStatus(prev => ({ ...prev, status: 'pending' }));
      return;
    }
    
    setSaveStatus(prev => ({ ...prev, status: 'pending' }));
    
    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      triggerSave();
    }, debounceMs);
  }, [debounceMs, triggerSave]);

  const saveImmediately = useCallback(async () => {
    // Clear any pending debounced save
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    await triggerSave();
  }, [triggerSave]);

  // Cleanup timeout on unmount
  const cancelSave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (pendingCheckRef.current) {
      clearTimeout(pendingCheckRef.current);
      pendingCheckRef.current = null;
    }
    setSaveStatus({ status: 'idle' });
  }, []);

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (pendingCheckRef.current) clearTimeout(pendingCheckRef.current);
    };
  }, []);

  return {
    saveStatus,
    debouncedSave,
    saveImmediately,
    cancelSave
  };
}