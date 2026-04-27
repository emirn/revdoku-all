import { useState, useCallback, useRef } from "react";
import type {
  IReport,
  IEnvelope,
  IEnvelopeRevision,
  IDocumentFileRevision,
} from "@revdoku/lib";
import {
  getFileNameFromFiles,
  cleanFilename,
  ReportJobStatus,
} from "@revdoku/lib";
import { ApiClient } from "@/lib/api-client";
import { generatePreview } from "@/utils/file-preview";
import { getApiConfig } from "@/config/api";
import { showToast } from "@/lib/toast";
import { v4 as uuidv4 } from "uuid";
import { PDFDocument } from "pdf-lib";
import type { ILastInspectedState } from "./useInspection";

// Count total pages across a batch of files without rendering.
// PDFs: parse header via pdf-lib getPageCount(). Images: 1 page each.
// Unknown types: counted as 1 (defensive).
async function countPagesInFiles(files: File[]): Promise<number> {
  let total = 0;
  for (const f of files) {
    if (f.type === 'application/pdf') {
      try {
        const buf = await f.arrayBuffer();
        const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
        total += doc.getPageCount();
      } catch {
        total += 1; // conservative fallback
      }
    } else {
      total += 1;
    }
  }
  return total;
}

export interface UseFileManagementParams {
  currentEnvelope: IEnvelope | null;
  setCurrentEnvelope: React.Dispatch<React.SetStateAction<IEnvelope | null>>;
  currentEnvelopeRevision: IEnvelopeRevision | null | undefined;
  currentReport: IReport | null;
  setCurrentReport: React.Dispatch<React.SetStateAction<IReport | null>>;
  envelopeId: string | null;
  trackSave: <T>(promise: Promise<T>) => Promise<T>;
  setIsProcessingInput: React.Dispatch<React.SetStateAction<boolean>>;
  setInputBase64ConvertedForDisplay: React.Dispatch<React.SetStateAction<string | null>>;
  setInputFileConvertedForDisplay: React.Dispatch<React.SetStateAction<File | null>>;
  setNumPages: React.Dispatch<React.SetStateAction<number | null>>;
  setCurrentPageIndex: React.Dispatch<React.SetStateAction<number>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setSaveError: React.Dispatch<React.SetStateAction<string | null>>;
  setHasUnsavedChanges: React.Dispatch<React.SetStateAction<boolean>>;
  setLastInspectedState: React.Dispatch<React.SetStateAction<ILastInspectedState | null>>;
  setPendingInspectionAfterArrange: React.Dispatch<React.SetStateAction<boolean>>;
  setIsManualSelectionMode: (value: boolean) => void;
  setRetryCounter: React.Dispatch<React.SetStateAction<number>>;
  showDebug: boolean;
  debouncedSave: () => void;
}

export function useFileManagement({
  currentEnvelope,
  setCurrentEnvelope,
  currentEnvelopeRevision,
  currentReport,
  setCurrentReport,
  envelopeId,
  trackSave,
  setIsProcessingInput,
  setInputBase64ConvertedForDisplay,
  setInputFileConvertedForDisplay,
  setNumPages,
  setCurrentPageIndex,
  setError,
  setSaveError,
  setHasUnsavedChanges,
  setLastInspectedState,
  setPendingInspectionAfterArrange,
  setIsManualSelectionMode,
  setRetryCounter,
  showDebug,
  debouncedSave,
}: UseFileManagementParams) {
  // --- File management state ---
  const [showFileRearrangeDialog, setShowFileRearrangeDialog] = useState(false);
  const [fileRearrangeMode, setFileRearrangeMode] = useState<'new_revision' | 'edit_current' | 'view_readonly'>('new_revision');
  const [quickPickedFiles, setQuickPickedFiles] = useState<File[]>([]);
  const quickFileInputRef = useRef<HTMLInputElement>(null);
  const [isEmptyAreaDragOver, setIsEmptyAreaDragOver] = useState(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);

  // --- Convert File objects to IDocumentFileRevision format ---
  const filesToMyFileRevisions = async (
    files: File[],
  ): Promise<IDocumentFileRevision[]> => {
    return Promise.all(
      files.map(
        (file) =>
          new Promise<IDocumentFileRevision>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const now = new Date().toISOString();

              const fileRevision: IDocumentFileRevision = {
                id: uuidv4(),
                revision_number: 0,
                name: file.name,
                mime_type: file.type,
                data: result.split(",")[1],
                size: file.size,
                metadata: JSON.stringify({
                  originalName: file.name,
                  size: file.size,
                  lastModified: file.lastModified,
                }),
                pages: [],
                created_at: now,
                updated_at: now,
              };

              resolve(fileRevision);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    );
  };

  // --- Main file upload handler ---
  const handleFilesSelected = (selectedFiles: File[]) => {
    if (import.meta.env.DEV) {
      console.debug('handleFilesSelected called', {
        filesCount: selectedFiles.length,
        currentEnvelopeExists: !!currentEnvelope,
        currentEnvelopeId: currentEnvelope?.id,
        currentRevisionCount: currentEnvelope?.envelope_revisions?.length
      });
    }

    if (selectedFiles.length > 0) {
      setIsUploadingFiles(true);
      (async () => {
        try {
          if (!currentEnvelope?.id) return;

          // Client-side file size validation
          const config = await getApiConfig();
          const maxBytes = config.limits?.maxFileSize;
          const maxMb = config.limits?.maxFileSizeMb;
          if (maxBytes) {
            const tooLarge = selectedFiles.filter(f => f.size > maxBytes);
            if (tooLarge.length > 0) {
              const names = tooLarge.map(f => f.name).join(', ');
              const msg = `File size exceeds the maximum allowed size of ${maxMb ?? Math.round(maxBytes / 1048576)}MB: ${names}`;
              setSaveError(msg);
              showToast(msg, 'error', 5000);
              return;
            }
          }

          // Existing envelope - use update_document_files for atomic operation
          if (import.meta.env.DEV) console.debug('Uploading files to existing envelope');

          // Build file state for the new files
          const fileState: Array<{
            document_file_id?: string;
            revision_number?: number;
            new_file?: boolean;
            file_index?: number;
          }> = [];

          // If there are existing PRIMARY files, include them in the state.
          // Reference files live on envelope.document_files (envelope-scoped,
          // reference=true) but are tracked via RefFile pins, not via a
          // revision's document_file_revision_links — so they must be
          // filtered out here or the backend dedup in process_file_state
          // would trip on primary docs whose content matches a ref.
          if (currentEnvelope.document_files && currentEnvelopeRevision) {
            currentEnvelope.document_files
              .filter(sf => !sf.reference)
              .forEach(sourceFile => {
                const latestRevision = sourceFile.document_file_revisions[sourceFile.document_file_revisions.length - 1];
                if (latestRevision) {
                  fileState.push({
                    document_file_id: sourceFile.id,
                    revision_number: latestRevision.revision_number
                  });
                }
              });
          }

          // Add new files to the state
          selectedFiles.forEach((file, index) => {
            fileState.push({
              new_file: true,
              file_index: index
            });
          });

          // Count total pages across existing PRIMARY files + new files.
          // Same ref filter as above — refs aren't part of the inspection body,
          // so their pages don't belong in the envelope_revision page budget.
          let existingPageCount = 0;
          if (currentEnvelope.document_files && currentEnvelopeRevision) {
            existingPageCount = currentEnvelope.document_files
              .filter(sf => !sf.reference)
              .reduce((sum, sf) => {
                const latest = sf.document_file_revisions[sf.document_file_revisions.length - 1];
                return sum + (latest?.pages?.length || 0);
              }, 0);
          }
          const newPagesCount = await countPagesInFiles(selectedFiles);
          const totalPageCount = existingPageCount + newPagesCount;

          // Use update_document_files endpoint for atomic update
          const { revision, envelope: envelopeUpdate } = await ApiClient.updateDocumentFiles(
            currentEnvelope.id,
            fileState,
            selectedFiles,
            "",
            totalPageCount
          );

          // Fire-and-forget: generate thumbnail from first uploaded file
          if (selectedFiles.length > 0) {
            generatePreview(selectedFiles[0]).then((dataUrl) => {
              if (dataUrl) ApiClient.uploadThumbnail(currentEnvelope.id, dataUrl).catch(() => {});
            }).catch(() => {});
          }

          // Reload the envelope with updated source files
          const { envelope } = await ApiClient.getEnvelope(currentEnvelope.id);
          const { document_files } = await ApiClient.getEnvelopeDocumentFiles(currentEnvelope.id);

          const updatedEnvelope = {
            ...envelope,
            document_files: document_files || [],
            envelope_revisions: envelope.envelope_revisions || []  // Ensure envelope_revisions is always an array
          };

          // Set processing state BEFORE updating envelope to avoid a blank-viewer
          // flash: without this, React renders with fileRevisions.length > 0 but
          // isProcessingInput still false, causing <Document file={null}>.
          setIsProcessingInput(true);
          setInputBase64ConvertedForDisplay(null);
          setInputFileConvertedForDisplay(null);

          setCurrentEnvelope(updatedEnvelope);

          setSaveError(null);
          setError(null);
          setNumPages(null);
          setCurrentPageIndex(0);
          setIsUploadingFiles(false);

        } catch (err) {
          console.error('Error handling files:', err);
          const errorMessage = err instanceof Error ? err.message : 'Failed to upload files';
          setSaveError(errorMessage);
          showToast(errorMessage, 'error', 5000);
          setIsUploadingFiles(false);
        }
      })();
    } else {
      setCurrentEnvelope(null);
    }
  };

  // --- Retry file processing callback ---
  const handleRetryFileProcessing = useCallback(() => {
    setError(null);
    setIsProcessingInput(true);
    setInputBase64ConvertedForDisplay(null);
    setInputFileConvertedForDisplay(null);
    setRetryCounter((c) => c + 1);
  }, []);

  // --- File rearrangement handlers ---
  const handleOpenFileRearrangeDialog = (mode: 'new_revision' | 'edit_current' | 'view_readonly' = 'new_revision') => {
    setFileRearrangeMode(mode);
    setShowFileRearrangeDialog(true);
  };

  const handleCloseFileRearrangeDialog = () => {
    setShowFileRearrangeDialog(false);
    setQuickPickedFiles([]);
  };

  // Quick file pick: opens native file picker directly, then opens dialog with those files
  const handleQuickFilePick = () => {
    quickFileInputRef.current?.click();
  };
  const handleQuickFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setQuickPickedFiles(Array.from(files));
    setFileRearrangeMode('new_revision');
    setShowFileRearrangeDialog(true);
    // Reset input so the same files can be re-selected
    e.target.value = '';
  };
  const handleEmptyAreaDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsEmptyAreaDragOver(false);
    const acceptedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => acceptedTypes.includes(f.type));
    if (droppedFiles.length === 0) return;
    setQuickPickedFiles(droppedFiles);
    setFileRearrangeMode('new_revision');
    setShowFileRearrangeDialog(true);
  };
  const handleEmptyAreaFilesSelected = (files: File[]) => {
    const acceptedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const filtered = files.filter(f => acceptedTypes.includes(f.type));
    if (filtered.length === 0) return;
    setQuickPickedFiles(filtered);
    setFileRearrangeMode('new_revision');
    setShowFileRearrangeDialog(true);
  };

  // pendingInspectionAfterArrange stays true after file rearrangement;
  // ToolbarActions shows a transient hint on the Review button instead of window.confirm

  const handleResetReport = async () => {
    if (!currentReport?.id) throw new Error("No report to reset");
    const { report } = await ApiClient.resetReport(currentReport.id);
    // Clear frontend skip guard so next "Run Inspection" actually calls the API
    setLastInspectedState(null);
    // Update report state — report stays but with only user checks and status: completed
    setCurrentReport(report);
    setCurrentEnvelope(prev => {
      if (!prev?.envelope_revisions) return prev;
      return {
        ...prev,
        envelope_revisions: prev.envelope_revisions.map(rev =>
          rev.report?.id === currentReport.id ? { ...rev, report } : rev
        )
      };
    });
  };

  const handleFilesReordered = async (newFiles: File[], replacementInfo: Array<{ index: number; isReplacement: boolean }>, comment?: string, totalPageCount?: number, autoRenameEnvelope?: boolean) => {
    try {
      if (!currentEnvelope || !currentEnvelope.id || !currentEnvelopeRevision) {
        console.error('No envelope to update');
        showToast('Unable to add files. Please reload the page and try again.', 'error');
        throw new Error('No envelope or revision available');
      }

      if (import.meta.env.DEV) console.debug('Processing file rearrangement');

      // Build ordered list of document files matching the dialog's file order.
      // The dialog receives files in document_file_revision_links order (by position),
      // so info.index maps into this ordered list, NOT into the unordered document_files array.
      const orderedDocumentFiles = (currentEnvelopeRevision.document_file_revision_links || []).map(link => {
        return currentEnvelope.document_files.find(f => f.id === link.document_file_id);
      }).filter(Boolean) as typeof currentEnvelope.document_files;

      // Build the file state array
      const fileState: Array<{
        document_file_id?: string;
        revision_number?: number;
        new_file?: boolean;
        replacement?: boolean;
        file_index?: number;
      }> = [];

      const newFilesOnly: File[] = [];
      let newFileIndex = 0;

      // Process each file in the new order
      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        const info = replacementInfo[i];

        if (info.isReplacement && info.index < orderedDocumentFiles.length) {
          // This is a replacement - include atomically via updateDocumentFiles
          const sourceFile = orderedDocumentFiles[info.index];

          fileState.push({
            document_file_id: sourceFile.id,
            replacement: true,
            file_index: newFileIndex
          });
          newFilesOnly.push(file);
          newFileIndex++;
        } else if (info.index < orderedDocumentFiles.length) {
          // This is an existing file being kept in a new position
          const sourceFile = orderedDocumentFiles[info.index];
          const latestRevision = sourceFile.document_file_revisions[sourceFile.document_file_revisions.length - 1];

          fileState.push({
            document_file_id: sourceFile.id,
            revision_number: latestRevision.revision_number
          });
        } else {
          // This is a new file
          fileState.push({
            new_file: true,
            file_index: newFileIndex
          });
          newFilesOnly.push(file);
          newFileIndex++;
        }
      }

      // Handle removed files by deleting them
      const keptIndices = new Set(replacementInfo.map(info => info.index));
      const deletedFileIds: string[] = [];
      for (let i = 0; i < orderedDocumentFiles.length; i++) {
        if (!keptIndices.has(i)) {
          deletedFileIds.push(orderedDocumentFiles[i].id);
        }
      }

      // Detect comment-only change in edit_current mode — use lightweight endpoint
      // that bypasses the report-reset guard (comment is metadata, not document content).
      // Must also verify file order hasn't changed, otherwise a pure reorder would be skipped.
      const isFileOrderUnchanged = fileState.every((fs, i) =>
        fs.document_file_id === orderedDocumentFiles[i]?.id
      );
      if (fileRearrangeMode === 'edit_current' && newFilesOnly.length === 0 && deletedFileIds.length === 0 &&
          fileState.length === orderedDocumentFiles.length &&
          fileState.every(fs => !fs.new_file && !fs.replacement) && isFileOrderUnchanged && comment !== undefined) {
        const { revision } = await ApiClient.updateRevisionComment(currentEnvelope.id, comment);
        // Update the revision comment in local state
        setCurrentEnvelope(prev => {
          if (!prev?.envelope_revisions) return prev;
          return {
            ...prev,
            envelope_revisions: prev.envelope_revisions.map(rev =>
              rev.id === revision.id ? { ...rev, comment: revision.comment } : rev
            )
          };
        });
        return;
      }

      // Capture previous first file's LATEST revision name for auto-rename logic
      const prevRevisions = currentEnvelope.document_files?.[0]?.document_file_revisions || [];
      const prevFirstFileName = prevRevisions[prevRevisions.length - 1]?.name || '';

      // Execute deletions first
      if (deletedFileIds.length > 0) {
        await Promise.all(deletedFileIds.map(id => ApiClient.deleteDocumentFile(id)));
      }

      if (fileRearrangeMode === 'edit_current') {
        // Auto-reset report if needed before editing files
        if (currentReport && currentReport.job_status !== ReportJobStatus.RESET) {
          if (!window.confirm('Editing files will reset the current report. AI checks will be cleared, envelope checks will be preserved. Continue?')) {
            return;
          }
          await handleResetReport();
        }

        // Edit current revision in place
        await ApiClient.editCurrentRevision(
          currentEnvelope.id,
          fileState,
          newFilesOnly,
          comment,
          totalPageCount
        );
      } else {
        // Now create the new document revision with the complete file state
        await ApiClient.updateDocumentFiles(
          currentEnvelope.id,
          fileState,
          newFilesOnly,
          comment,
          totalPageCount
        );
      }

      // Fire-and-forget: generate thumbnail from first file in new revision
      if (newFilesOnly.length > 0) {
        generatePreview(newFilesOnly[0]).then((dataUrl) => {
          if (dataUrl) ApiClient.uploadThumbnail(currentEnvelope.id, dataUrl).catch(() => {});
        }).catch(() => {});
      }

      // Reload the envelope with updated source files
      const { envelope } = await ApiClient.getEnvelope(currentEnvelope.id);
      const { document_files } = await ApiClient.getEnvelopeDocumentFiles(currentEnvelope.id);

      const updatedEnvelope = {
        ...envelope,
        document_files: document_files || [],
        envelope_revisions: envelope.envelope_revisions || []  // Handle both naming conventions
      };

      // Set processing state BEFORE updating envelope to avoid gray-viewer bug:
      // without this, React renders with numPages=null but stale PDF source,
      // and react-pdf won't re-fire onLoadSuccess for the same file.
      setIsProcessingInput(true);
      setInputBase64ConvertedForDisplay(null);
      setInputFileConvertedForDisplay(null);

      setCurrentEnvelope(updatedEnvelope);

      // Update title if needed
      if (autoRenameEnvelope && fileRearrangeMode !== 'edit_current' && prevFirstFileName) {
        // Auto-rename: if title starts with the old first filename (cleaned), replace with "new - was: old"
        const revisions = (document_files || [])[0]?.document_file_revisions || [];
        const newFirstFileName = revisions[revisions.length - 1]?.name || '';
        const currentTitle = envelope.title || '';
        const prevCleaned = cleanFilename(prevFirstFileName, '-');
        // Match against both raw filename and cleaned version (title may be either)
        const matchRaw = currentTitle.startsWith(prevFirstFileName);
        const matchCleaned = currentTitle.startsWith(prevCleaned);
        const matchLength = matchRaw ? prevFirstFileName.length : matchCleaned ? prevCleaned.length : 0;
        if (import.meta.env.DEV) console.debug('Auto-rename debug:', { prevFirstFileName, newFirstFileName, currentTitle, prevCleaned, matchRaw, matchCleaned, revisionNames: revisions.map((r: any) => r.name), autoRenameEnvelope, fileRearrangeMode });
        if (newFirstFileName && newFirstFileName !== prevFirstFileName && matchLength > 0) {
          const suffix = currentTitle.slice(matchLength);
          const newTitle = `${newFirstFileName} - was: ${prevFirstFileName}${suffix}`;
          await ApiClient.updateEnvelope(currentEnvelope.id, { title: newTitle });
          setCurrentEnvelope(prev => prev ? { ...prev, title: newTitle } : prev);
        }
      } else {
        const newTitle = getFileNameFromFiles(document_files || []);
        if (newTitle !== envelope.title) {
          await ApiClient.updateEnvelope(currentEnvelope.id, { title: newTitle });
          setCurrentEnvelope(prev => prev ? { ...prev, title: newTitle } : prev);
        }
      }

      // Mark as having unsaved changes and trigger auto-save
      setHasUnsavedChanges(true);
      debouncedSave();

      if (fileRearrangeMode !== 'edit_current') {
        // Clear report for new revision but keep history
        setPendingInspectionAfterArrange(true);
      }
      setSaveError(null);
      setError(null);
      setNumPages(null);
      setCurrentPageIndex(0);

    } catch (err) {
      console.error('Error rearranging files:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to update files';
      setSaveError(errorMessage);
      showToast(errorMessage, 'error', 5000);
      throw err; // Re-throw so FileRearrangeDialog keeps dialog open
    }
  };

  const handleSwitchToLatest = () => {
    if (!currentEnvelope) return;
    setCurrentPageIndex(0);
    setCurrentEnvelope((prev) =>
      prev ? { ...prev, current_revision_index: prev.envelope_revisions.length - 1 } : prev,
    );
    setIsManualSelectionMode(false);
  };

  const handleRollbackToCurrentRevision = async () => {
    if (!currentEnvelope) return;

    const currentRevisionNumber = currentEnvelope.current_revision_index + 1;
    const totalRevisions = currentEnvelope.envelope_revisions.length;
    const revisionsToDelete = totalRevisions - currentRevisionNumber;

    // Only show confirmation if there are revisions to delete
    if (revisionsToDelete > 0) {
      const confirmed = window.confirm(
        `⚠️ Rollback Confirmation\n\n` +
        `You are about to rollback to Document Revision ${currentRevisionNumber} of ${totalRevisions}.\n\n` +
        `This will permanently DELETE:\n` +
        `• ${revisionsToDelete} newer document revision(s)\n` +
        `• Associated reports and inspection results\n` +
        `• Envelope checks created in those revisions\n` +
        `• Unused file uploads\n\n` +
        `This action CANNOT be undone. Continue?`
      );

      if (!confirmed) return;
    }

    try {
      // Clear viewer state before rollback to force react-pdf remount
      setIsProcessingInput(true);
      setInputBase64ConvertedForDisplay(null);
      setInputFileConvertedForDisplay(null);
      setNumPages(null);
      setError(null);

      // Call backend to perform rollback
      const result = await ApiClient.rollbackEnvelope(
        currentEnvelope.id,
        currentEnvelope.current_revision_index
      );

      // Fetch document files (same pattern as initial load)
      const { document_files } = await ApiClient.getEnvelopeDocumentFiles(currentEnvelope.id);

      // Update local state with backend response, merging in document files
      setCurrentEnvelope({
        ...result.envelope,
        document_files: document_files || [],
      });
      setCurrentPageIndex(0);
      setIsManualSelectionMode(false);

      // Show success message (brief, non-blocking)
      if (import.meta.env.DEV) console.debug(`Successfully rolled back to revision ${currentRevisionNumber}`);
    } catch (error) {
      console.error('Rollback failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to rollback revision';
      setError(errorMessage);
      setIsProcessingInput(false);
      alert(errorMessage);
    }
  };

  return {
    // State
    showFileRearrangeDialog, setShowFileRearrangeDialog,
    fileRearrangeMode, setFileRearrangeMode,
    quickPickedFiles, setQuickPickedFiles,
    quickFileInputRef,
    isEmptyAreaDragOver, setIsEmptyAreaDragOver,
    isUploadingFiles,

    // Functions
    filesToMyFileRevisions,
    handleFilesSelected,
    handleRetryFileProcessing,
    handleOpenFileRearrangeDialog,
    handleCloseFileRearrangeDialog,
    handleQuickFilePick,
    handleQuickFileSelect,
    handleEmptyAreaDrop,
    handleEmptyAreaFilesSelected,
    handleResetReport,
    handleFilesReordered,
    handleSwitchToLatest,
    handleRollbackToCurrentRevision,
  };
}
