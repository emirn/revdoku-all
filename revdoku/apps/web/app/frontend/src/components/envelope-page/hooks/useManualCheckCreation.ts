import { useState, useEffect, useRef } from "react";
import {
  ICoordinates,
  IReport,
  ICheck,
  ICheckForDisplay,
  IEnvelope,
  IEnvelopeRevision,
  IChecklist,
  IRule,
  ITypedRule,
  getWidth,
  getHeight,
  getColorsForCheckResult,
  createNewCheck,
} from "@revdoku/lib";
import { CheckFilterType } from "@revdoku/lib";
import type { CheckFilter } from "@/components/envelope-page/CheckNavigator";
import { ICreateCheckResponse } from "@/lib/schemas/common-client";
import { ApiClient } from "@/lib/api-client";
import { showToast } from "@/lib/toast";
import { v4 as uuidv4 } from "uuid";

type InteractionMode = 'grab' | 'cursor';

export interface UseManualCheckCreationParams {
  isEditingDisabled: boolean;
  currentReport: IReport | null;
  setCurrentReport: React.Dispatch<React.SetStateAction<IReport | null>>;
  currentEnvelope: IEnvelope | null;
  setCurrentEnvelope: React.Dispatch<React.SetStateAction<IEnvelope | null>>;
  currentPageIndex: number;
  currentEnvelopeRevision: IEnvelopeRevision | null | undefined;
  checkFilter: CheckFilter;
  setCheckFilter: (f: CheckFilter) => void;
  scaleCoordinatesFromCurrentViewerToPDF: (coords: ICoordinates) => ICoordinates;
  trackSave: <T>(promise: Promise<T>) => Promise<T>;
  fontScaleRef: React.MutableRefObject<number>;
  pageScrollContainerRef: React.RefObject<HTMLDivElement | null>;
  selectedCheckId: string | null;
  setSelectedCheckId: (id: string | null) => void;
  isDraggingHighlight: boolean;
  isResizingHighlight: boolean;
  setChecklistError: (err: string | null) => void;
  showDebug: boolean;
  inlineEditorSize: { width: number; height: number } | null;
  setInlineEditorSize: React.Dispatch<React.SetStateAction<{ width: number; height: number } | null>>;
  getCurrentChecklistId: () => string | null;
  updateReportInBothStates: (report: IReport) => void;
  addCheckToReport: (newCheck: ICheck, updatedChecklist?: IChecklist) => void;
  updateCheckInReport: (updatedCheck: ICheck) => void;
  removeCheckFromReport: (checkId: string) => void;
  onEditRuleRequested: () => void;
  pendingNewCheck: ICheckForDisplay | null;
  setPendingNewCheck: React.Dispatch<React.SetStateAction<ICheckForDisplay | null>>;
  inlineEditCheckId: string | null;
  setInlineEditCheckId: React.Dispatch<React.SetStateAction<string | null>>;
  isContinuousScroll?: boolean;
}

export function useManualCheckCreation({
  isEditingDisabled,
  currentReport,
  setCurrentReport,
  currentEnvelope,
  setCurrentEnvelope,
  currentPageIndex,
  currentEnvelopeRevision,
  checkFilter,
  setCheckFilter,
  scaleCoordinatesFromCurrentViewerToPDF,
  trackSave,
  fontScaleRef,
  pageScrollContainerRef,
  selectedCheckId,
  setSelectedCheckId,
  isDraggingHighlight,
  isResizingHighlight,
  setChecklistError,
  showDebug,
  inlineEditorSize,
  setInlineEditorSize,
  getCurrentChecklistId,
  updateReportInBothStates,
  addCheckToReport,
  updateCheckInReport,
  removeCheckFromReport,
  onEditRuleRequested,
  pendingNewCheck,
  setPendingNewCheck,
  inlineEditCheckId,
  setInlineEditCheckId,
  isContinuousScroll = false,
}: UseManualCheckCreationParams) {
  // Track which page the selection started on (for continuous scroll mode)
  const selectionPageRef = useRef<number>(currentPageIndex);

  // Interaction mode: 'grab' for panning, 'cursor' for selecting areas to add issues
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('grab');

  // Derive isManualSelectionMode from interactionMode for backward compatibility
  const isManualSelectionMode = interactionMode === 'cursor';
  const setIsManualSelectionMode = (value: boolean) => setInteractionMode(value ? 'cursor' : 'grab');

  const [hoveredCheckId, setHoveredCheckId] = useState<string | null>(null);
  const [hoveredElementType, setHoveredElementType] = useState<'highlight' | 'label' | null>(null);

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [showManualCheckDialog, setShowManualCheckDialog] = useState(false);
  const [selectedArea, setSelectedArea] = useState<ICoordinates | null>(null);
  const [editingCheckId, setEditingCheckId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");
  // inlineEditCheckId and pendingNewCheck are now managed by the parent and passed as params
  // Inline editor resize ref
  const inlineEditorResizeRef = useRef<{
    startX: number; startY: number; startW: number; startH: number;
    corner: 'nw' | 'ne' | 'sw' | 'se';
    labelEl: HTMLElement | null;
    startTranslateX: number; startTranslateY: number;
  } | null>(null);
  const [selectedManualCheckRule, setSelectedManualCheckRule] = useState<ITypedRule | null>(null);
  const [isRuleDropdownOpen, setIsRuleDropdownOpen] = useState(false);
  // New state for improved manual check creation
  const [newRuleText, setNewRuleText] = useState("");
  const [manualCheckMessage, setManualCheckMessage] = useState("");
  const [isMessageManuallyEdited, setIsMessageManuallyEdited] = useState(false);

  // Close inline editor on page change or report change
  useEffect(() => {
    setInlineEditCheckId(null);
  }, [currentPageIndex, currentReport?.id]);

  const updateReportUpdatedAt = (report: IReport): IReport => {
    return {
      ...report,
      updated_at: new Date().toISOString(),
    };
  };

  // Function to delete a check with confirmation — returns true if deleted
  const deleteCheck = async (id: string): Promise<boolean> => {
    if (isEditingDisabled) return false;
    if (!currentReport) return false;

    const checkToDelete = currentReport.checks.find((c) => c.id === id);
    if (!checkToDelete) return false;

    const confirmMessage = `Delete this check: "${checkToDelete.description.substring(0, 50)}${checkToDelete.description.length > 50 ? "..." : ""}"?`;

    if (window.confirm(confirmMessage)) {
      try {
        await trackSave(ApiClient.deleteCheck(id));

        // Update local state by removing the check
        removeCheckFromReport(id);

        // Clear selection if the deleted check was selected
        if (selectedCheckId === id) {
          setSelectedCheckId(null);
        }
        return true;
      } catch (error) {
        console.error('Failed to delete check:', error);
        return false;
      }
    }
    return false;
  };

  const updateCheckDescription = async (id: string, newMessage: string) => {
    if (isEditingDisabled) return;
    if (!currentReport) return;

    try {
      const result = await trackSave(ApiClient.updateCheck(id, { description: newMessage }));

      // Update local state with the full report if returned, otherwise just the check
      if (result.report?.report) {
        updateReportInBothStates(result.report.report);
      } else if (result.check) {
        updateCheckInReport(result.check);
      }
    } catch (error) {
      console.error('Failed to update check description:', error);
    }
  };

  const startEditing = (id: string, currentMessage: string) => {
    if (isEditingDisabled) return;
    setEditingCheckId(id);
    setEditingText(currentMessage);
  };

  const saveEditOfCheckDescription = () => {
    if (editingCheckId && editingText.trim()) {
      updateCheckDescription(editingCheckId, editingText.trim());
    }
    setEditingCheckId(null);
    setEditingText("");
  };

  const cancelEditOfCheckDescription = () => {
    setEditingCheckId(null);
    setEditingText("");
  };

  const handleKeyDownOnEditingCheckDescription = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEditOfCheckDescription();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditOfCheckDescription();
    }
  };

  // Clamp inline editor position within the scroll container viewport
  // Editor is now portaled to document.body with fixed centering — no label repositioning needed
  const clampInlineEditorPosition = (_checkId: string) => {};

  // Open inline editor in message box
  const openInlineEditor = (check: ICheck) => {
    setInlineEditCheckId(check.id);
    // Restore persisted editor size from sessionStorage (if fontScale matches)
    try {
      const stored = sessionStorage.getItem('revdoku_inline_editor_size');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.fontScale === fontScaleRef.current) {
          setInlineEditorSize({ width: parsed.width, height: parsed.height });
        } else {
          setInlineEditorSize(null);
        }
      } else {
        setInlineEditorSize(null);
      }
    } catch {
      setInlineEditorSize(null);
    }
    clampInlineEditorPosition(check.id);
  };

  // Close inline editor
  const closeInlineEditor = () => {
    if (inlineEditCheckId) {
      const labelEl = document.querySelector(`[data-label-id="${inlineEditCheckId}"]`) as HTMLElement;
      if (labelEl) labelEl.style.transform = '';
    }
    setPendingNewCheck(null);
    setInlineEditCheckId(null);
    setInlineEditorSize(null);
  };

  // Edit rule: close inline editor and open checklist dialog on envelope rules tab
  const handleEditRule = (_ruleId: string) => {
    closeInlineEditor();
    onEditRuleRequested();
  };

  // Delete check from inline editor, then close editor
  const handleDeleteCheckFromInline = async (id: string) => {
    const deleted = await deleteCheck(id);
    if (deleted) closeInlineEditor();
  };

  // Inline editor resize handlers (all four corners)
  const handleInlineEditorResizeStart = (
    e: React.MouseEvent,
    currentWidth: number,
    currentHeight: number,
    corner: 'nw' | 'ne' | 'sw' | 'se' = 'se'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const labelEl = (e.target as HTMLElement).closest('[data-label-id]') as HTMLElement | null;
    let tx = 0, ty = 0;
    if (labelEl) {
      const m = labelEl.style.transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
      if (m) { tx = parseFloat(m[1]) || 0; ty = parseFloat(m[2]) || 0; }
    }
    inlineEditorResizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      startW: currentWidth, startH: currentHeight,
      corner, labelEl, startTranslateX: tx, startTranslateY: ty,
    };
    document.body.style.userSelect = 'none';

    const handleMove = (ev: MouseEvent) => {
      if (!inlineEditorResizeRef.current) return;
      const { startX, startY, startW, startH, corner, labelEl, startTranslateX, startTranslateY } = inlineEditorResizeRef.current;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      let newW = startW, newH = startH, offsetX = startTranslateX, offsetY = startTranslateY;
      if (corner === 'se') { newW = startW + dx; newH = startH + dy; }
      else if (corner === 'sw') { newW = startW - dx; offsetX = startTranslateX + dx; newH = startH + dy; }
      else if (corner === 'ne') { newW = startW + dx; newH = startH - dy; offsetY = startTranslateY + dy; }
      else if (corner === 'nw') { newW = startW - dx; offsetX = startTranslateX + dx; newH = startH - dy; offsetY = startTranslateY + dy; }

      newW = Math.max(100, newW);
      newH = Math.max(100, newH);
      setInlineEditorSize({ width: newW, height: newH });
      if (labelEl) {
        labelEl.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
      }
    };

    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.userSelect = '';
      inlineEditorResizeRef.current = null;
      // Persist to sessionStorage
      setInlineEditorSize(prev => {
        if (prev) {
          try {
            sessionStorage.setItem('revdoku_inline_editor_size', JSON.stringify({
              width: prev.width,
              height: prev.height,
              fontScale: fontScaleRef.current,
            }));
          } catch { /* ignore */ }
        }
        return prev;
      });
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  // Handle saving check updates from the dialog
  const handleSaveCheck = async (checkId: string, updates: { message?: string; rule_key?: string; passed?: boolean; rule_prompt?: string }) => {
    if (isEditingDisabled) return;
    if (!currentReport) return;

    try {
      const result = await trackSave(ApiClient.updateCheck(checkId, updates));

      // Update local state with the full report if returned, otherwise just the check
      if (result.report?.report) {
        updateReportInBothStates(result.report.report);
      } else if (result.check) {
        updateCheckInReport(result.check);
      }

      // Update checklist if rule prompt was changed (checklist is part of report)
      if (result.checklist && updates.rule_prompt) {
        // Update the current report's checklist with the new rules
        setCurrentReport(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            checklist: result.checklist
          };
        });
      }
    } catch (error) {
      console.error('Failed to update check:', error);
      throw error; // Re-throw so dialog knows about the error
    }
  };

  // Handle creating a new check from inline editor (create mode)
  const handleCreateCheck = async (data: {
    description: string;
    passed: boolean;
    rule_key?: string;
    new_rule_text?: string;
  }) => {
    if (isEditingDisabled) return;
    if (!pendingNewCheck) return;

    // Ensure a report exists (create stub if needed — checklist is optional)
    let reportForCheck = currentReport;
    if (!reportForCheck) {
      if (!currentEnvelopeRevision?.id) return;
      const currentChecklistId = getCurrentChecklistId();
      try {
        const stubResponse = await ApiClient.createStubReport({
          envelope_revision_id: currentEnvelopeRevision.id,
          ...(currentChecklistId ? { checklist_id: currentChecklistId } : {}),
        });
        reportForCheck = stubResponse.report;
        updateReportInBothStates(reportForCheck);
      } catch (error: any) {
        showToast(error?.message || 'Failed to prepare report', 'error');
        return;
      }
    }

    const newCheckData: any = {
      ...createNewCheck(),
      description: data.description,
      page: pendingNewCheck.page,
      x1: Math.round(pendingNewCheck.x1),
      y1: Math.round(pendingNewCheck.y1),
      x2: Math.round(pendingNewCheck.x2),
      y2: Math.round(pendingNewCheck.y2),
      passed: data.passed,
    };

    if (data.rule_key) {
      newCheckData.rule_id = data.rule_key;
    } else if (data.new_rule_text) {
      newCheckData.new_rule_text = data.new_rule_text;
    }

    try {
      const result = await trackSave(ApiClient.createCheck(reportForCheck.id, newCheckData));
      if (result.report?.report) {
        updateReportInBothStates(result.report.report);
      } else if (result.check) {
        addCheckToReport(result.check, result.checklist);
      }
      showToast('Check added successfully', 'success');
    } catch (error: any) {
      showToast(error?.message || 'Failed to create check', 'error');
      return; // Don't clear pending on error — user can retry
    }

    // Clear pending check state
    setPendingNewCheck(null);
    setInlineEditCheckId(null);
    setInlineEditorSize(null);
  };

  const handleMouseDownForAddingManualIssue = (e: React.MouseEvent) => {
    if (isEditingDisabled) return;
    if (!isManualSelectionMode || isDraggingHighlight || isResizingHighlight)
      return;

    e.preventDefault();
    e.stopPropagation();

    // In continuous mode, use the event target's page index; otherwise fall back to currentPageIndex
    if (isContinuousScroll) {
      const pageEl = (e.currentTarget as HTMLElement).closest('[data-page-index]');
      if (pageEl) selectionPageRef.current = parseInt(pageEl.getAttribute('data-page-index')!, 10);
    } else {
      selectionPageRef.current = currentPageIndex;
    }

    const viewerContainer = (e.currentTarget as HTMLElement);
    const rect = viewerContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setSelectionStart({ x, y });
    setSelectionEnd({ x, y });
    setIsSelecting(true);
  };

  const handleMouseMoveForAddingManualIssue = (e: React.MouseEvent) => {
    if (isEditingDisabled) return;
    if (!isManualSelectionMode || !isSelecting || !selectionStart) return;

    e.preventDefault();
    e.stopPropagation();

    const viewerContainer = (e.currentTarget as HTMLElement);
    const rect = viewerContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setSelectionEnd({ x, y });
  };

  const handleMouseUpForAddingManualIssue = (e: React.MouseEvent) => {
    if (isEditingDisabled) return;
    if (
      !isManualSelectionMode ||
      !isSelecting ||
      !selectionStart ||
      !selectionEnd
    )
      return;

    e.preventDefault();
    e.stopPropagation();

    setIsSelecting(false);

    // Calculate the selected area in screen coordinates
    const x1 = Math.min(selectionStart.x, selectionEnd.x);
    const y1 = Math.min(selectionStart.y, selectionEnd.y);
    const x2 = Math.max(selectionStart.x, selectionEnd.x);
    const y2 = Math.max(selectionStart.y, selectionEnd.y);

    const selectedArea: ICoordinates = { x1, y1, x2, y2 };

    // Only proceed if the selection is meaningful (not just a click)
    // and the envelope is not archived
    if (getWidth(selectedArea) > 5 && getHeight(selectedArea) > 5) {
      // Don't allow manual checks when envelope is archived
      if (currentEnvelope?.archived_at) {
        showToast('Cannot add checks while envelope is archived', 'error');
        setSelectionStart(null);
        setSelectionEnd(null);
        return;
      }

      // Convert screen coordinates back to PDF coordinates using the inverse scaling function
      const pdfCoordinates =
        scaleCoordinatesFromCurrentViewerToPDF(selectedArea);

      // Create a temporary pending check for inline creation
      const tempId = `pending_${uuidv4()}`;
      const pendingCheck: ICheckForDisplay = {
        id: tempId,
        rule_id: '',
        passed: false,
        description: '',
        page: selectionPageRef.current,
        source: 'user' as any,
        rule_order: 9999,
        rule_prompt: '',
        x1: pdfCoordinates.x1,
        y1: pdfCoordinates.y1,
        x2: pdfCoordinates.x2,
        y2: pdfCoordinates.y2,
        colors: getColorsForCheckResult({ passed: false, source: 'user' } as any),
      };
      setPendingNewCheck(pendingCheck);
      setInlineEditCheckId(tempId);
      // Exit selection mode so user can interact with the editor
      setIsManualSelectionMode(false);
      // Clamp editor position after React renders the pending check
      // Use longer delay since DOM element doesn't exist yet
      setTimeout(() => clampInlineEditorPosition(tempId), 150);
    }

    // Reset selection
    setSelectionStart(null);
    setSelectionEnd(null);
  };


  const handleAddManualCheck = async () => {
    if (!selectedArea) return;

    // Don't allow manual checks when envelope is archived
    if (currentEnvelope?.archived_at) {
      showToast('Cannot add checks while envelope is archived', 'error');
      return;
    }

    // If no report exists yet, create a stub report (checklist is optional)
    let reportForCheck = currentReport;
    if (!reportForCheck) {
      if (!currentEnvelopeRevision?.id) return;
      const currentChecklistId = getCurrentChecklistId();
      try {
        const stubResponse = await ApiClient.createStubReport({
          envelope_revision_id: currentEnvelopeRevision.id,
          ...(currentChecklistId ? { checklist_id: currentChecklistId } : {}),
        });
        reportForCheck = stubResponse.report;
        updateReportInBothStates(reportForCheck);
      } catch (error: any) {
        console.error('Failed to create stub report:', error);
        showToast(error?.message || 'Failed to prepare report for envelope check', 'error');
        return;
      }
    }

    // Validation
    if (!manualCheckMessage.trim()) {
      alert("Cannot add envelope check without a message");
      return;
    }

    // If creating new rule, validate rule text
    if (!selectedManualCheckRule && !newRuleText.trim()) {
      alert("Please enter rule text when creating a new rule");
      return;
    }

    try {
      // Build the check data based on which flow we're using
      const newCheckData: any = {
        ...createNewCheck(),
        description: manualCheckMessage.trim(),
        page: selectionPageRef.current,
        x1: Math.round(selectedArea.x1),
        y1: Math.round(selectedArea.y1),
        x2: Math.round(selectedArea.x2),
        y2: Math.round(selectedArea.y2),
        passed: false
      };

      if (selectedManualCheckRule) {
        // Flow B: Using existing rule
        newCheckData.rule_id = selectedManualCheckRule.id;
      } else {
        // Flow A: Creating new rule
        newCheckData.new_rule_text = newRuleText.trim();
      }

      const result: ICreateCheckResponse = await trackSave(ApiClient.createCheck(reportForCheck.id, newCheckData));

      // Update local state with the full report if returned, otherwise just the check
      if (result.report?.report) {
        updateReportInBothStates(result.report.report);
      } else if (result.check) {
        addCheckToReport(result.check, result.checklist);
      }

      // Sync envelope revision revision_rules from returned checklist so
      // ChecklistDialog shows new envelope rules without a page refresh
      if (result.checklist?.rules && currentEnvelopeRevision?.id) {
        const userRules = result.checklist.rules.filter((r: IRule) => r.origin === 'user');
        setCurrentEnvelope(prev => {
          if (!prev?.envelope_revisions) return prev;
          return {
            ...prev,
            envelope_revisions: prev.envelope_revisions.map(rev =>
              rev.id === currentEnvelopeRevision.id
                ? { ...rev, revision_rules: userRules }
                : rev
            ),
          };
        });
      }

      showToast('Check added successfully', 'success');

      // New manual checks are always failed — switch filter so the check is visible
      if (checkFilter === CheckFilterType.PASSED) {
        setCheckFilter(CheckFilterType.FAILED_AND_CHANGES);
      }

      // Only reset dialog state on success
      setShowManualCheckDialog(false);
      setSelectedArea(null);
      setIsManualSelectionMode(false);
      setSelectedManualCheckRule(null);
      setIsRuleDropdownOpen(false);
      setNewRuleText("");
      setManualCheckMessage("");
      setIsMessageManuallyEdited(false);
    } catch (error: any) {
      console.error('Error creating manual check:', error);
      // Show visible error toast — dialog stays open for retry
      showToast(error?.message || 'Failed to create check', 'error');
    }
  };

  // Function to toggle check passed status with confirmation
  const toggleCheckPassedStatus = async (id: string, currentPassed: boolean) => {
    if (isEditingDisabled) return;
    const newStatus = currentPassed ? "failed" : "passed";
    const confirmMessage = `Change to ${newStatus}?`;

    if (window.confirm(confirmMessage)) {
      if (!currentReport) return;

      // Find the check to get its coordinates
      const checkToUpdate = currentReport.checks.find(c => c.id === id);
      if (!checkToUpdate) return;

      try {
        const result = await trackSave(ApiClient.updateCheck(id, {
          passed: !currentPassed,
          x1: checkToUpdate.x1,
          y1: checkToUpdate.y1,
          x2: checkToUpdate.x2,
          y2: checkToUpdate.y2,
          description: checkToUpdate.description
        }));

        // Update local state with the full report if returned, otherwise just the check
        if (result.report?.report) {
          updateReportInBothStates(result.report.report);
        } else if (result.check) {
          updateCheckInReport(result.check);
        }
      } catch (error) {
        console.error('Failed to update check status:', error);
      }
    }
  };

  const quickToggleCheckPassed = async (id: string, currentPassed: boolean) => {
    if (isEditingDisabled) return;
    if (!currentReport) return;

    const checkToUpdate = currentReport.checks.find(c => c.id === id);
    if (!checkToUpdate) return;

    try {
      const result = await trackSave(ApiClient.updateCheck(id, {
        passed: !currentPassed,
        x1: checkToUpdate.x1,
        y1: checkToUpdate.y1,
        x2: checkToUpdate.x2,
        y2: checkToUpdate.y2,
        description: checkToUpdate.description
      }));

      if (result.report?.report) {
        updateReportInBothStates(result.report.report);
      } else if (result.check) {
        updateCheckInReport(result.check);
      }
    } catch (error) {
      console.error('Failed to toggle check status:', error);
    }
  };

  const getCurrentSelection = (): ICoordinates | null => {
    if (!selectionStart || !selectionEnd) return null;

    const x = Math.min(selectionStart.x, selectionEnd.x);
    const y = Math.min(selectionStart.y, selectionEnd.y);
    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);

    return { x1: x, y1: y, x2: x + width, y2: y + height } as ICoordinates;
  };

  return {
    // Interaction mode state
    interactionMode, setInteractionMode,
    isManualSelectionMode, setIsManualSelectionMode,

    // Hover state
    hoveredCheckId, setHoveredCheckId,
    hoveredElementType, setHoveredElementType,

    // Selection state
    isSelecting, setIsSelecting,
    selectionStart, setSelectionStart,
    selectionEnd, setSelectionEnd,

    // Manual check dialog state
    showManualCheckDialog, setShowManualCheckDialog,
    selectedArea, setSelectedArea,

    // Editing state
    editingCheckId, setEditingCheckId,
    editingText, setEditingText,

    // Inline editor state
    inlineEditorResizeRef,

    // Manual check creation state
    selectedManualCheckRule, setSelectedManualCheckRule,
    isRuleDropdownOpen, setIsRuleDropdownOpen,
    newRuleText, setNewRuleText,
    manualCheckMessage, setManualCheckMessage,
    isMessageManuallyEdited, setIsMessageManuallyEdited,

    // Functions
    updateReportUpdatedAt,
    deleteCheck,
    updateCheckDescription,
    startEditing,
    saveEditOfCheckDescription,
    cancelEditOfCheckDescription,
    handleKeyDownOnEditingCheckDescription,
    clampInlineEditorPosition,
    openInlineEditor,
    closeInlineEditor,
    handleEditRule,
    handleDeleteCheckFromInline,
    handleInlineEditorResizeStart,
    handleSaveCheck,
    handleCreateCheck,
    handleMouseDownForAddingManualIssue,
    handleMouseMoveForAddingManualIssue,
    handleMouseUpForAddingManualIssue,
    handleAddManualCheck,
    toggleCheckPassedStatus,
    quickToggleCheckPassed,
    getCurrentSelection,
  };
}
