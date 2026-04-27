import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { IChecklist } from '@revdoku/lib';
import { ChecklistList } from '@/components/ChecklistList';
import ChecklistDialog from '@/components/ChecklistDialog';
import AddChecklistDialog from '@/components/AddChecklistDialog';
import AIModelSelectionDialog from '@/components/AIModelSelectionDialog';
import type { CreateFromTemplateData } from '@/components/AddChecklistDialog';
import { useChecklistManager } from '@/hooks/useChecklistManager';
import { ApiClient } from '@/lib/api-client';

export default function ChecklistsPage() {
  const {
    checklists,
    latestChecklists,
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
  } = useChecklistManager();

  // Checklist onboarding hints — show for first 3 checklists created
  const showChecklistOnboardingHints = useMemo(() => {
    try {
      return parseInt(localStorage.getItem('revdoku_checklist_onboarding_count') || '0', 10) < 3;
    } catch { return false; }
  }, []);

  const [isViewOnlyMode, setIsViewOnlyMode] = useState(true);
  const [selectedChecklistVersions, setSelectedChecklistVersions] = useState<any[]>([]);
  const [showChecklistDialogLocal, setShowChecklistDialogLocal] = useState(false);
  // Track newly created checklist so we can delete it if user cancels without saving
  // Use ref for synchronous reads (avoids race between onSave clearing + onClose reading)
  const [justCreatedChecklistId, setJustCreatedChecklistId] = useState<string | null>(null);
  const justCreatedRef = useRef<string | null>(null);

  // Generate dialog state (owned by page, passed to AddChecklistDialog)
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // AI model selection two-step flow state
  const [showModelSelection, setShowModelSelection] = useState(false);
  const [pendingSourceText, setPendingSourceText] = useState('');
  const [checklistDialogInitialTab, setChecklistDialogInitialTab] = useState<string | undefined>();

  // Fetch data from server on component mount
  useEffect(() => {
    fetchChecklists();
  }, [fetchChecklists]);

  // Override handleViewChecklist to set view-only mode
  const handleView = (checklist: IChecklist) => {
    justCreatedRef.current = null;
    setJustCreatedChecklistId(null); // Not a newly created checklist
    setIsViewOnlyMode(true);
    handleViewChecklist(checklist);
  };

  // Reset view-only mode when closing — delete unsaved new checklist
  const handleClose = async () => {
    const unsavedId = justCreatedRef.current;
    if (unsavedId) {
      try { await handleDeleteChecklist(unsavedId); } catch {}
    }
    justCreatedRef.current = null;
    setJustCreatedChecklistId(null);
    setIsViewOnlyMode(true);
    setShowChecklistDialogLocal(false);
    setChecklistDialogInitialTab(undefined);
    handleCloseChecklistDetails();
  };

  // Handle opening editor from AddChecklistDialog
  const handleOpenEditor = (checklist: IChecklist, initialTab?: string) => {
    justCreatedRef.current = checklist.id; // Track as newly created (ref for sync reads)
    setJustCreatedChecklistId(checklist.id);
    setSelectedChecklist(checklist);
    setChecklistDialogInitialTab(initialTab);
    setShowChecklistDialogLocal(true);
  };

  // Generation callback for AddChecklistDialog (AI generation path)
  // Returns true on success, false on failure
  const handleGenerate = useCallback(async (sourceText: string, aiModel?: string): Promise<boolean> => {
    setIsGenerating(true);
    setGenerateError(null);

    try {
      const result = await ApiClient.generateChecklist(sourceText, aiModel);

      if (!result.checklist) {
        throw new Error('Failed to generate checklist');
      }

      const savedChecklist = handleGeneratedChecklist(result.checklist);
      setShowAddChecklist(false);

      // Open the editor with the new checklist
      if (savedChecklist) {
        handleOpenEditor(savedChecklist);
      }
      return true;
    } catch (error) {
      console.error('Error processing checklist:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to process checklist. Please try again.';
      setGenerateError(errorMessage);
      return false;
    } finally {
      setIsGenerating(false);
    }
  }, [handleGeneratedChecklist, setShowAddChecklist]);

  // Create from template or parsed text (no AI)
  const handleCreateFromTemplate = useCallback(async (data: CreateFromTemplateData) => {
    setIsGenerating(true);
    setGenerateError(null);

    try {
      const saved = await handleAddChecklist({
        name: data.name,
        system_prompt: data.system_prompt,
        rules: data.rules.map(r => ({ prompt: r.prompt, order: r.order })),
        ai_model: data.ai_model,
        user_scripts: data.user_scripts,
      } as unknown as IChecklist);
      setShowAddChecklist(false);
      if (saved) {
        handleOpenEditor(saved);
      }
    } catch (error) {
      console.error('Error creating checklist:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create checklist.';
      setGenerateError(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  }, [handleAddChecklist, setShowAddChecklist]);

  // Two-step flow: AddChecklistDialog -> AIModelSelectionDialog
  const handleNeedAIModel = useCallback((sourceText: string) => {
    setPendingSourceText(sourceText);
    setShowAddChecklist(false);
    setShowModelSelection(true);
  }, [setShowAddChecklist]);

  const handleModelSelected = useCallback(async (modelId: string | null) => {
    if (modelId === null) {
      setShowModelSelection(false);
      // "Manually, no AI" — first line = name, rest = system_prompt
      const lines = pendingSourceText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const name = lines[0] || 'New Checklist';
      const systemPrompt = lines.slice(1).join('\n').trim() || null;
      setIsGenerating(true);
      setGenerateError(null);
      try {
        const saved = await handleAddChecklist({
          name,
          system_prompt: systemPrompt,
          rules: [{ prompt: '', order: 0 }],
        } as unknown as IChecklist);
        if (saved) {
          handleOpenEditor(saved, 'prompt'); // Open on Prompt tab
        }
      } catch (error) {
        console.error('Error creating checklist:', error);
      } finally {
        setIsGenerating(false);
      }
    } else {
      // AI generation — keep dialog open to show "Processing..." spinner
      setChecklistDialogInitialTab(undefined);
      const success = await handleGenerate(pendingSourceText, modelId);
      setShowModelSelection(false);
      if (!success) {
        // Reopen text entry dialog so user sees the error
        setShowAddChecklist(true);
      }
    }
  }, [pendingSourceText, handleGenerate, handleAddChecklist, setShowAddChecklist]);

  // Save and clear the "just created" tracker so close won't delete the checklist
  const handleSaveAndClearNew = useCallback(async (checklist: IChecklist) => {
    await handleSaveChecklist(checklist);
    justCreatedRef.current = null; // Clear synchronously so onClose reads correct value
    setJustCreatedChecklistId(null);
  }, [handleSaveChecklist]);

  // Reset generate error when dialog closes
  const handleCloseAddDialog = useCallback(() => {
    setShowAddChecklist(false);
    setGenerateError(null);
    setPendingSourceText('');
  }, [setShowAddChecklist]);

  // Load versions when a checklist is selected and dialog is open
  useEffect(() => {
    const loadVersions = async () => {
      if (selectedChecklist && (showChecklistDetails || showChecklistDialogLocal)) {
        try {
          const versions = await getChecklistRevisions(selectedChecklist);
          setSelectedChecklistVersions(versions || []);
        } catch (e) {
          setSelectedChecklistVersions([]);
        }
      } else {
        setSelectedChecklistVersions([]);
      }
    };
    loadVersions();
  }, [selectedChecklist?.id, showChecklistDetails, showChecklistDialogLocal]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full">
      {isLoading ? (
        <div className="flex justify-center items-center h-60">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-indigo-600 border-r-transparent"></div>
            <p className="mt-4 text-muted-foreground">Loading checklists...</p>
          </div>
        </div>
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-950/50 border-l-4 border-red-500 p-4 mb-4">
          <div className="flex">
            <div className="ml-3">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          </div>
        </div>
      ) : (
        <>

          {/* Checklists Section */}
          <div className="px-4 py-5 sm:px-6">
            <ChecklistList
              checklists={latestChecklists}
              isLoading={isLoading}
              error={error}
              onViewChecklist={handleView}
              onAddChecklist={() => setShowAddChecklist(true)}
              onDeleteChecklist={handleDeleteChecklist}
              onDuplicateChecklist={handleDuplicateChecklist}
              sortBy={sortBy}
              onSortChange={setSortBy}
              showOnboardingHints={showChecklistOnboardingHints}
            />
          </div>

          {/* Add Checklist Dialog */}
          <AddChecklistDialog
            isOpen={showAddChecklist}
            onClose={handleCloseAddDialog}
            onGenerate={handleGenerate}
            onCreateFromTemplate={handleCreateFromTemplate}
            onNeedAIModel={handleNeedAIModel}
            isProcessing={isGenerating}
            error={generateError}
            mode="checklist"
            initialText={pendingSourceText}
          />

          {/* AI Model Selection Dialog (two-step flow) */}
          <AIModelSelectionDialog
            isOpen={showModelSelection}
            onClose={() => setShowModelSelection(false)}
            onSelect={handleModelSelected}
            onBack={() => {
              setShowModelSelection(false);
              setShowAddChecklist(true);
            }}
            isProcessing={isGenerating}
            purpose="checklist_generation"
            showManualOption={true}
          />

          {/* Checklist Details/Edit Dialog */}
          <ChecklistDialog
            checklist={selectedChecklist}
            revisions={selectedChecklistVersions}
            isOpen={showChecklistDetails || showChecklistDialogLocal}
            onClose={handleClose}
            onSave={handleSaveAndClearNew}
            onDelete={handleDeleteChecklist}
            onRollbackVersion={handleRollbackChecklist}
            onViewVersion={(version) => handleView(version)}
            showOnboardingHints={showChecklistOnboardingHints}
            initialTab={checklistDialogInitialTab}
            isNewlyCreated={justCreatedChecklistId != null}
          />
        </>
      )}
    </div>
  );
}
