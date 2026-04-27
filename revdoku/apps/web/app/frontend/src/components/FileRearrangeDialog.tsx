"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Document, Page } from "react-pdf";
import { pdfjs } from "react-pdf";
import { isMimeTypeImage } from "@revdoku/lib";
import type { EditabilityState } from "@/lib/editability-state";
import { formatFileSize, areFilesIdentical } from "@/lib/file-utils";
import { showToast } from "@/lib/toast";
import OnboardingHint from "@/components/OnboardingHint";

interface FileWithPreview {
  file: File;
  preview?: string; // Base64 image preview
  previewError?: boolean;
  pageCount?: number; // Number of pages (PDFs) or 1 for images
  originalFileIndex?: number; // Track which original file this replaces (for revisions)
  isReplacement?: boolean; // Track if this is a replacement/revision
  isOriginalFile?: boolean; // Track if this file existed when dialog opened (vs newly added)
  addedAt?: string; // ISO date string for when the file was added
}

function formatAddedDate(isoDate?: string): string | null {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  const absolute = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago \u00b7 ${absolute}`;
  if (diffHours < 24) return `${diffHours}h ago \u00b7 ${absolute}`;
  if (diffDays < 30) return `${diffDays}d ago \u00b7 ${absolute}`;
  return absolute;
}

interface FileRearrangeDialogProps {
  isOpen: boolean;
  files: File[];
  onClose: () => void;
  onFilesReordered: (newFiles: File[], replacementInfo: Array<{ index: number; isReplacement: boolean }>, comment?: string, totalPageCount?: number, autoRenameEnvelope?: boolean) => void | Promise<void>;
  isFirstRevision?: boolean; // true for revision_number === 0
  hasInspectionRun?: boolean; // true if report.checklist_id exists
  onResetReport?: () => Promise<void>;
  editability?: EditabilityState; // Unified editability state from envelope context
  createdAtDates?: string[]; // ISO date strings parallel to files array
  initialNewFiles?: File[]; // Pre-load these files when dialog opens (from quick file pick)
  showOnboardingHints?: boolean;
  envelopeId?: string;
  mode?: 'new_revision' | 'edit_current' | 'view_readonly'; // Dialog mode
  initialComment?: string; // Pre-populate comment field when editing
}

export default function FileRearrangeDialog({
  isOpen,
  files,
  onClose,
  onFilesReordered,
  isFirstRevision: isFirstRevisionProp = true,
  hasInspectionRun: hasInspectionRunProp = false,
  onResetReport,
  editability,
  createdAtDates,
  initialNewFiles,
  showOnboardingHints,
  envelopeId,
  mode = 'new_revision',
  initialComment,
}: FileRearrangeDialogProps) {
  // Derive from editability when available, fall back to individual props
  const isFirstRevision = editability?.isFirstRevision ?? isFirstRevisionProp;
  const hasInspectionRun = editability?.hasInspectionRun ?? hasInspectionRunProp;
  const [filesWithPreviews, setFilesWithPreviews] = useState<FileWithPreview[]>(
    [],
  );
  const [comment, setComment] = useState("");
  const [autoRenameEnvelope, setAutoRenameEnvelope] = useState(true);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isGeneratingPreviews, setIsGeneratingPreviews] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    | { type: 'remove'; index: number }
    | { type: 'reorder'; newFiles: FileWithPreview[] }
    | null
  >(null);
  const [isExecutingReset, setIsExecutingReset] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialNewFilesProcessedRef = useRef(false);
  const replaceFileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [zoomPosition, setZoomPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    replaceFileInputRefs.current = replaceFileInputRefs.current.slice(
      0,
      filesWithPreviews.length,
    );
    cardRefs.current = cardRefs.current.slice(0, filesWithPreviews.length);
  }, [filesWithPreviews.length]);

  const handleCardMouseEnter = useCallback((index: number) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      const card = cardRefs.current[index];
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const zoomWidth = 312; // 300px image + padding
      const spaceRight = window.innerWidth - rect.right;
      if (spaceRight >= zoomWidth + 12) {
        setZoomPosition({ top: rect.top, left: rect.right + 12 });
      } else {
        setZoomPosition({ top: rect.top, left: rect.left - zoomWidth - 12 });
      }
      setHoveredIndex(index);
    }, 300);
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoveredIndex(null);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const isReadOnly = mode === 'view_readonly';

  // Files are unlocked only on first revision with no report
  const isFilesUnlocked = !isReadOnly && isFirstRevision && !hasInspectionRun;
  // Action needs reset when modifying original files (1st revision w/ inspection OR 2nd+ revision)
  const needsResetForAction = !isReadOnly && hasInspectionRun;
  // Drag is enabled whenever files are unlocked or user has a way to reset
  const isDragEnabled = !isReadOnly && (isFilesUnlocked || (hasInspectionRun && !!onResetReport) || !isFirstRevision);

  // Determine if a file can be removed
  const canRemoveFile = (item: FileWithPreview): boolean => {
    // Newly added files (not original, not a replacement) can always be removed before applying
    if (!item.isOriginalFile && !item.isReplacement) return true;
    // On first revision with no inspection, all files can be removed
    if (isFirstRevision && !hasInspectionRun) return true;
    // If we have a way to reset, show the remove button (will trigger confirmation)
    if (onResetReport) return true;
    // Otherwise, original files on 2nd+ revision can't be removed without reset capability
    return false;
  };

  // Download a single file by index
  const handleDownloadFile = (index: number) => {
    const item = filesWithPreviews[index];
    if (!item?.file) return;
    const url = URL.createObjectURL(item.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Download all files individually
  const handleDownloadAll = () => {
    filesWithPreviews.forEach((item) => {
      const url = URL.createObjectURL(item.file);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  };

  // Merge all files into a single PDF and download
  const handleDownloadMerged = async () => {
    if (filesWithPreviews.length === 0) return;
    setIsMerging(true);
    try {
      const { convertInputFilesToPdfForDisplay } = await import('@/lib/pdf-utils-client');
      const result = await convertInputFilesToPdfForDisplay(filesWithPreviews.map(f => f.file));
      const url = URL.createObjectURL(result.file);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'merged-document.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to merge files:', err);
      showToast('Failed to merge files for download', 'error');
    } finally {
      setIsMerging(false);
    }
  };

  // Generate previews for all files when dialog opens
  useEffect(() => {
    if (isOpen) {
      setDuplicateWarning(null);
      if (initialComment != null) {
        setComment(initialComment);
      }
      if (files.length > 0) {
        generatePreviews();
      }
    }
  }, [isOpen, files]);

  // Handle paste events (images and PDFs from clipboard)
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (!isOpen) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (!file) continue;
        if (isMimeTypeImage(item.type)) {
          const ext = file.type.split("/")[1] || "png";
          const namedFile = new File([file], `pasted-image-${Date.now()}.${ext}`, { type: file.type });
          pastedFiles.push(namedFile);
        } else if (item.type === "application/pdf") {
          const namedFile = new File([file], `pasted-document-${Date.now()}.pdf`, { type: file.type });
          pastedFiles.push(namedFile);
        }
      }
    }

    if (pastedFiles.length > 0) {
      e.preventDefault();

      // Filter out files identical to existing ones
      const uniqueFiles: File[] = [];
      const duplicateNames: string[] = [];
      for (const newFile of pastedFiles) {
        let isDuplicate = false;
        for (const existing of filesWithPreviews) {
          try {
            if (await areFilesIdentical(newFile, existing.file)) {
              isDuplicate = true;
              duplicateNames.push(newFile.name);
              break;
            }
          } catch (err) {
            console.warn('[FileRearrangeDialog] Hash comparison failed:', err);
          }
        }
        if (!isDuplicate) uniqueFiles.push(newFile);
      }

      if (duplicateNames.length > 0) {
        setDuplicateWarning(`Skipped ${duplicateNames.length} duplicate file${duplicateNames.length > 1 ? 's' : ''}: ${duplicateNames.join(', ')}`);
      }
      if (uniqueFiles.length === 0) return;

      const newFilesWithPreviews: FileWithPreview[] = uniqueFiles.map((file) => ({
        file,
        preview: undefined,
        previewError: false,
        originalFileIndex: undefined,
        isReplacement: false,
        isOriginalFile: false,
        addedAt: new Date().toISOString(),
      }));
      setFilesWithPreviews((prev) => [...prev, ...newFilesWithPreviews]);
      generatePreviewsForNewFiles(uniqueFiles);
    }
  }, [isOpen, filesWithPreviews]);

  useEffect(() => {
    if (isOpen && !isReadOnly) {
      document.addEventListener("paste", handlePaste);
      return () => document.removeEventListener("paste", handlePaste);
    }
  }, [isOpen, isReadOnly, handlePaste]);

  // Pre-load files from quick file pick (bypasses broken setTimeout file picker)
  useEffect(() => {
    if (isOpen && initialNewFiles && initialNewFiles.length > 0 && !initialNewFilesProcessedRef.current) {
      initialNewFilesProcessedRef.current = true;
      const newFilesWithPreviews: FileWithPreview[] = initialNewFiles.map((file) => ({
        file,
        preview: undefined,
        previewError: false,
        originalFileIndex: undefined,
        isReplacement: false,
        isOriginalFile: false,
        addedAt: new Date().toISOString(),
      }));
      setFilesWithPreviews((prev) => [...prev, ...newFilesWithPreviews]);
      generatePreviewsForNewFiles(initialNewFiles);
    }
    if (!isOpen) {
      initialNewFilesProcessedRef.current = false;
    }
  }, [isOpen, initialNewFiles]);

  const generatePreviews = async () => {
    setIsGeneratingPreviews(true);
    const previews: FileWithPreview[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        let preview: string | undefined;
        let pageCount: number | undefined;

        if (isMimeTypeImage(file.type)) {
          preview = await createImagePreview(file);
          pageCount = 1;
        } else if (file.type === "application/pdf") {
          const result = await createPdfPreview(file);
          preview = result.preview;
          pageCount = result.pageCount;
        }

        previews.push({
          file,
          preview,
          previewError: !preview,
          pageCount,
          originalFileIndex: i,
          isReplacement: false,
          isOriginalFile: true,
          addedAt: createdAtDates?.[i],
        });
      } catch (error) {
        console.error("Error generating preview for file:", file.name, error);
        previews.push({
          file,
          previewError: true,
          originalFileIndex: i,
          isReplacement: false,
          isOriginalFile: true,
          addedAt: createdAtDates?.[i],
        });
      }
    }

    setFilesWithPreviews(previews);
    setIsGeneratingPreviews(false);
  };

  const createImagePreview = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = new Image();

      img.onload = () => {
        // Set canvas size for thumbnail (max 600px on longest side)
        const maxSize = 600;
        let { width, height } = img;

        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;

        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };

      img.onerror = () => reject(new Error("Failed to load image"));

      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  };

  const createPdfPreview = (file: File): Promise<{ preview: string; pageCount: number }> => {
    return new Promise((resolve, reject) => {
      const fileUrl = URL.createObjectURL(file);

      pdfjs
        .getDocument(fileUrl)
        .promise.then((pdf) => {
          const pageCount = pdf.numPages;
          pdf
            .getPage(1)
            .then((page) => {
              const viewport = page.getViewport({ scale: 0.5 });
              const canvas = document.createElement("canvas");
              const context = canvas.getContext("2d");

              canvas.height = viewport.height;
              canvas.width = viewport.width;

              const renderContext = {
                canvasContext: context!,
                viewport: viewport,
              };

              page
                .render(renderContext)
                .promise.then(() => {
                  URL.revokeObjectURL(fileUrl);
                  resolve({ preview: canvas.toDataURL("image/jpeg", 0.8), pageCount });
                })
                .catch(reject);
            })
            .catch(reject);
        })
        .catch(reject);
    });
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/html", "");
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();

    if (draggedIndex === null) return;

    const newFiles = [...filesWithPreviews];
    const draggedFile = newFiles[draggedIndex];

    // Remove from old position
    newFiles.splice(draggedIndex, 1);

    // Insert at new position
    newFiles.splice(dropIndex, 0, draggedFile);

    setDraggedIndex(null);
    setDragOverIndex(null);

    // If the dragged file is an original file and action needs reset, show confirmation
    if (needsResetForAction && !isFilesUnlocked && draggedFile.isOriginalFile) {
      setPendingAction({ type: 'reorder', newFiles });
    } else {
      setFilesWithPreviews(newFiles);
    }
  };

  const handleRemoveFile = (index: number) => {
    const item = filesWithPreviews[index];
    // If action needs reset and this is an original file, show confirmation
    if (needsResetForAction && item.isOriginalFile) {
      setPendingAction({ type: 'remove', index });
    } else {
      const newFiles = filesWithPreviews.filter((_, i) => i !== index);
      setFilesWithPreviews(newFiles);
    }
  };

  const handleConfirmReset = async () => {
    if (!onResetReport || !pendingAction) return;
    setIsExecutingReset(true);
    try {
      await onResetReport();
      // Execute the pending action
      if (pendingAction.type === 'remove') {
        const newFiles = filesWithPreviews.filter((_, i) => i !== pendingAction.index);
        setFilesWithPreviews(newFiles);
      } else if (pendingAction.type === 'reorder') {
        setFilesWithPreviews(pendingAction.newFiles);
      }
    } catch (error) {
      console.error("Failed to reset report:", error);
      alert("Failed to reset report. Please try again.");
    } finally {
      setIsExecutingReset(false);
      setPendingAction(null);
    }
  };

  const handleCancelReset = () => {
    setPendingAction(null);
    // Reset drag state too
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleReplaceFileClick = (index: number) => {
    console.debug('[DEBUG] handleReplaceFileClick called, index:', index, 'ref:', replaceFileInputRefs.current[index]);
    replaceFileInputRefs.current[index]?.click();
  };

  const handleReplaceFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
    index: number,
  ) => {
    const selected = event.target.files ? event.target.files[0] : undefined;
    if (!selected) return;

    // Check if the selected file is identical to the current version
    const currentFile = filesWithPreviews[index]?.file;
    if (currentFile) {
      try {
        const identical = await areFilesIdentical(selected, currentFile);
        if (identical) {
          setDuplicateWarning(`"${selected.name}"'s content is identical to the current version and thus can't be used as a new version.`);
          const inputEl = replaceFileInputRefs.current[index];
          if (inputEl) inputEl.value = "";
          return;
        }
      } catch {
        // If hash comparison fails, proceed with the replacement
      }
    }

    // Check against the original file at the same slot (from files prop)
    const origIdx = filesWithPreviews[index]?.originalFileIndex;
    const originalFile = origIdx != null ? files[origIdx] : undefined;
    if (originalFile && originalFile !== currentFile) {
      try {
        if (await areFilesIdentical(selected, originalFile)) {
          setDuplicateWarning(`"${selected.name}" is identical to the original version from this revision.`);
          const inputEl = replaceFileInputRefs.current[index];
          if (inputEl) inputEl.value = "";
          return;
        }
      } catch {
        // proceed
      }
    }

    // Check against all other files in the dialog
    for (let i = 0; i < filesWithPreviews.length; i++) {
      if (i === index) continue;
      try {
        if (await areFilesIdentical(selected, filesWithPreviews[i].file)) {
          setDuplicateWarning(`"${selected.name}" is identical to another file already in this revision.`);
          const inputEl = replaceFileInputRefs.current[index];
          if (inputEl) inputEl.value = "";
          return;
        }
      } catch {
        // proceed
      }
    }

    setDuplicateWarning(null);

    let preview: string | undefined;
    let pageCount: number | undefined;
    try {
      if (isMimeTypeImage(selected.type)) {
        preview = await createImagePreview(selected);
        pageCount = 1;
      } else if (selected.type === "application/pdf") {
        const result = await createPdfPreview(selected);
        preview = result.preview;
        pageCount = result.pageCount;
      }
    } catch (err) {
      console.error("Error generating preview for replaced file", err);
    }

    setFilesWithPreviews((prev) => {
      const updated = [...prev];
      updated[index] = {
        file: selected,
        preview,
        previewError: !preview,
        pageCount,
        originalFileIndex: updated[index].originalFileIndex,
        isReplacement: true,
        addedAt: new Date().toISOString(),
      };
      return updated;
    });
  };

  const handleAddFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files
      ? Array.from(event.target.files)
      : [];
    if (selectedFiles.length > 0) {
      // Filter out files identical to existing ones
      const uniqueFiles: File[] = [];
      const duplicateNames: string[] = [];

      for (const newFile of selectedFiles) {
        let isDuplicate = false;
        for (const existing of filesWithPreviews) {
          try {
            if (await areFilesIdentical(newFile, existing.file)) {
              isDuplicate = true;
              duplicateNames.push(newFile.name);
              break;
            }
          } catch (err) {
            console.warn('[FileRearrangeDialog] Hash comparison failed, treating file as unique:', err);
          }
        }
        if (!isDuplicate) uniqueFiles.push(newFile);
      }

      if (duplicateNames.length > 0) {
        setDuplicateWarning(
          `Skipped ${duplicateNames.length} duplicate file${duplicateNames.length > 1 ? 's' : ''}: ${duplicateNames.join(', ')}`
        );
      } else {
        setDuplicateWarning(null);
      }

      if (uniqueFiles.length > 0) {
        const newFilesWithPreviews: FileWithPreview[] = uniqueFiles.map(
          (file) => ({
            file,
            preview: undefined,
            previewError: false,
            originalFileIndex: undefined,
            isReplacement: false,
            isOriginalFile: false,
            addedAt: new Date().toISOString(),
          }),
        );

        setFilesWithPreviews((prev) => [...prev, ...newFilesWithPreviews]);
        generatePreviewsForNewFiles(uniqueFiles);
      }
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const generatePreviewsForNewFiles = async (newFiles: File[]) => {
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];

      try {
        let preview: string | undefined;
        let pageCount: number | undefined;

        if (isMimeTypeImage(file.type)) {
          preview = await createImagePreview(file);
          pageCount = 1;
        } else if (file.type === "application/pdf") {
          const result = await createPdfPreview(file);
          preview = result.preview;
          pageCount = result.pageCount;
        }

        setFilesWithPreviews((prev) => {
          const idx = prev.findIndex(item => item.file === file);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            preview,
            previewError: !preview,
            pageCount,
          };
          return updated;
        });
      } catch (error) {
        console.error(
          "Error generating preview for new file:",
          file.name,
          error,
        );
        setFilesWithPreviews((prev) => {
          const idx = prev.findIndex(item => item.file === file);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            previewError: true,
          };
          return updated;
        });
      }
    }
  };

  const handleSave = async () => {
    const reorderedFiles = filesWithPreviews.map((item) => item.file);
    const replacementInfo = filesWithPreviews.map((item, index) => ({
      index: item.originalFileIndex ?? index,
      isReplacement: item.isReplacement ?? false,
    }));
    const totalPageCount = filesWithPreviews.reduce((sum, item) => sum + (item.pageCount ?? 1), 0);
    setIsSaving(true);
    try {
      await onFilesReordered(reorderedFiles, replacementInfo, comment.trim() || undefined, totalPageCount, autoRenameEnvelope);
      setComment("");
      setDuplicateWarning(null);
      onClose();
    } catch (err) {
      console.error('Error saving files:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to save files';
      showToast(errorMessage, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset to original files
    setFilesWithPreviews(files.map((file, i) => ({
      file,
      originalFileIndex: i,
      isReplacement: false,
      isOriginalFile: true,
    })));
    setComment("");
    setDuplicateWarning(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl border border-border/50 p-4 w-[800px] max-w-[95%] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {isReadOnly ? 'Revision Files' : mode === 'edit_current' ? 'Edit Revision' : 'Upload New Revision'}
            </h2>
            {mode === 'new_revision' && !isReadOnly && (
              <p className="text-xs text-muted-foreground mt-0.5">Replace or add documents below, then confirm to create a new revision.</p>
            )}
          </div>
          <button
            onClick={handleCancel}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Hidden file input for adding files */}
        {!isReadOnly && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"
            onChange={handleAddFiles}
            className="hidden"
          />
        )}

        {/* Files Grid */}
        <div className="flex-1 overflow-auto">
          {isGeneratingPreviews && filesWithPreviews.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-2"></div>
                <p className="text-muted-foreground">Generating previews...</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 p-4">
              {filesWithPreviews.map((item, index) => (
                <div
                  key={`${item.file.name}-${index}`}
                  ref={(el) => (cardRefs.current[index] = el)}
                  className={`relative bg-card border-2 rounded-lg p-5 ${isDragEnabled ? 'cursor-move' : 'cursor-default'} transition-all duration-200 ${draggedIndex === index ? "opacity-50 scale-95" : ""
                    } ${dragOverIndex === index
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50"
                      : "border-border hover:border-muted-foreground"
                    }`}
                  draggable={isDragEnabled}
                  onDragStart={isDragEnabled ? (e) => handleDragStart(e, index) : undefined}
                  onDragOver={isDragEnabled ? (e) => handleDragOver(e, index) : undefined}
                  onDragLeave={isDragEnabled ? handleDragLeave : undefined}
                  onDrop={isDragEnabled ? (e) => handleDrop(e, index) : undefined}
                  onMouseEnter={() => handleCardMouseEnter(index)}
                  onMouseLeave={handleCardMouseLeave}
                >
                  {/* Remove Button - only show if removal is allowed */}
                  {!isReadOnly && canRemoveFile(item) && (
                    <button
                      onClick={() => handleRemoveFile(index)}
                      className="absolute -top-3 -right-2 w-7 h-7 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors z-10 flex items-center justify-center shadow-md"
                      title="Remove file"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  )}

                  {/* Page Number */}
                  <div className="absolute -top-3 -left-1 w-7 h-7 bg-indigo-500 text-white rounded-full flex items-center justify-center text-xs font-medium shadow-md">
                    {index + 1}
                  </div>

                  {/* Preview */}
                  <div
                    className="aspect-[3/4] mb-3 bg-muted rounded-md overflow-hidden flex items-center justify-center p-4 relative"
                  >
                    {item.preview ? (
                      <img
                        src={item.preview}
                        alt={`Preview of ${item.file.name}`}
                        className="max-w-full max-h-full object-contain rounded-sm shadow-sm"
                      />
                    ) : item.previewError ? (
                      <div className="text-center text-muted-foreground">
                        <svg
                          className="w-8 h-8 mx-auto mb-1"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        <span className="text-xs">No preview</span>
                      </div>
                    ) : (
                      <div className="text-center text-muted-foreground">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-muted-foreground mx-auto mb-1"></div>
                        <span className="text-xs">Loading...</span>
                      </div>
                    )}
                  </div>

                  {/* Full-card hover overlay for replace */}
                  {!isReadOnly && (
                    <div
                      className="absolute inset-0 bg-black/40 text-white text-sm font-medium flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded-lg cursor-pointer z-[5]"
                      onClick={() => handleReplaceFileClick(index)}
                    >
                      Upload new version
                    </div>
                  )}
                  {!isReadOnly && (
                    <input
                      ref={(el) => (replaceFileInputRefs.current[index] = el)}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"
                      className="hidden"
                      onChange={(e) => handleReplaceFileChange(e, index)}
                    />
                  )}

                  {/* File Info */}
                  <div className="text-center space-y-0.5">
                    <p
                      className="text-xs font-medium text-foreground line-clamp-2"
                      title={item.file.name}
                    >
                      {item.file.name}
                    </p>
                    {item.isReplacement && (
                      <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                        Updated
                      </span>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {formatFileSize(item.file.size)}
                      {item.pageCount != null && <> &middot; {item.pageCount} {item.pageCount === 1 ? 'page' : 'pages'}</>}
                    </p>
                    {formatAddedDate(item.addedAt) && (
                      <p className="text-[10px] text-muted-foreground">
                        {formatAddedDate(item.addedAt)}
                      </p>
                    )}
                    {!isReadOnly && (
                      <button
                        onClick={() => handleReplaceFileClick(index)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-300 rounded-md px-2 py-0.5 mt-1 transition-colors dark:text-indigo-300 dark:bg-indigo-950/50 dark:border-indigo-700 dark:hover:bg-indigo-900/50"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Upload New Version
                      </button>
                    )}
                  </div>

                  {/* Download Button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownloadFile(index); }}
                    className="absolute bottom-2 left-2 text-muted-foreground opacity-60 hover:opacity-100 transition-opacity"
                    title={`Download ${item.file.name}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>

                  {/* Drag Handle - only show when drag is enabled */}
                  {isDragEnabled && (
                    <div className="absolute bottom-2 right-2 text-muted-foreground opacity-60 hover:opacity-100 transition-opacity">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 6h.01M8 10h.01M8 14h.01M8 18h.01M12 6h.01M12 10h.01M12 14h.01M12 18h.01M16 6h.01M16 10h.01M16 14h.01M16 18h.01"
                        />
                      </svg>
                    </div>
                  )}
                </div>
              ))}

              {/* Add Files Box */}
              {!isReadOnly && (
                <div
                  className="relative bg-muted border-2 border-dashed border-border rounded-lg p-5 cursor-pointer transition-all duration-200 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex flex-col items-center justify-center"
                  title="Add a new document to this revision"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                      fileInputRef.current.click();
                    }
                  }}
                >
                  <div className="aspect-[3/4] mb-3 flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                      <svg
                        className="w-12 h-12 mx-auto mb-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 4v16m8-8H4"
                        />
                      </svg>
                      <span className="text-sm font-medium">Add New Document</span>
                      <p className="text-xs text-muted-foreground/70 mt-1 px-2">To update an existing file, click on it</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Duplicate Warning Banner */}
        {duplicateWarning && (
          <div className="mx-1 mt-2 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="flex-1">{duplicateWarning}</span>
            <button
              onClick={() => setDuplicateWarning(null)}
              className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Comment */}
        {!isReadOnly && (
          <div className="mt-2 px-1">
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={mode === 'edit_current' ? "Revision note (optional)" : "Comment for the revision (optional)"}
              maxLength={200}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Auto-rename envelope checkbox (new revision mode — always creating 2nd+ revision) */}
        {!isReadOnly && mode === 'new_revision' && (
          <label className="flex items-center gap-2 mt-2 px-1 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRenameEnvelope}
              onChange={(e) => setAutoRenameEnvelope(e.target.checked)}
              className="rounded border-border"
            />
            {"If filename changed, rename envelope to \"<new> - was: <old>\""}
          </label>
        )}

        {/* Footer */}
        <div className="flex justify-between items-center mt-3 pt-3 border-t border-border">
          <div className="text-sm text-muted-foreground flex items-center gap-3">
            <span>
              {filesWithPreviews.length} file
              {filesWithPreviews.length !== 1 ? "s" : ""} total
            </span>
            {filesWithPreviews.length > 0 && (
              <span className="flex items-center gap-2">
                {filesWithPreviews.length === 1 ? (
                  <button onClick={() => handleDownloadFile(0)} className="text-xs text-indigo-600 hover:text-indigo-800 dark:hover:text-indigo-400 underline">
                    Download
                  </button>
                ) : (
                  <>
                    <button onClick={handleDownloadAll} className="text-xs text-indigo-600 hover:text-indigo-800 dark:hover:text-indigo-400 underline">
                      Download all
                    </button>
                    <span className="text-muted-foreground/30">|</span>
                    <button onClick={handleDownloadMerged} disabled={isMerging} className="text-xs text-indigo-600 hover:text-indigo-800 dark:hover:text-indigo-400 underline disabled:opacity-50">
                      {isMerging ? 'Merging...' : 'Download merged PDF'}
                    </button>
                  </>
                )}
              </span>
            )}
            {!isReadOnly && (
              <span className="text-xs opacity-60">
                {navigator.platform?.toLowerCase().includes("mac") ? "\u2318V" : "Ctrl+V"} to paste
              </span>
            )}
          </div>
          <div className="flex space-x-3">
            {isReadOnly ? (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
              >
                Close
              </button>
            ) : (
              <>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 text-secondary-foreground bg-secondary rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                  disabled={isSaving}
                >
                  Cancel
                </button>
                {showOnboardingHints && filesWithPreviews.length > 0 ? (
                  <OnboardingHint
                    hintKey={`guide-apply-${envelopeId}`}
                    message="Apply changes to create a revision"
                    position="top"
                    align="end"
                  >
                    <button
                      onClick={handleSave}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                      disabled={filesWithPreviews.length === 0 || isSaving}
                    >
                      {isSaving && (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      )}
                      {isSaving ? "Saving..." : (mode === 'edit_current' ? "Save Changes" : "Apply Changes")}
                    </button>
                  </OnboardingHint>
                ) : (
                  <button
                    onClick={handleSave}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                    disabled={filesWithPreviews.length === 0 || isSaving}
                  >
                    {isSaving && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    )}
                    {isSaving ? "Saving..." : (mode === 'edit_current' ? "Save Changes" : "Apply Changes")}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Zoom preview portal */}
      {hoveredIndex !== null && filesWithPreviews[hoveredIndex]?.preview && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ top: zoomPosition.top, left: zoomPosition.left }}
        >
          <div className="bg-card border-2 border-border rounded-lg shadow-2xl p-2">
            <img
              src={filesWithPreviews[hoveredIndex].preview}
              alt="Zoom preview"
              className="w-[300px] h-auto object-contain rounded"
            />
          </div>
        </div>,
        document.body
      )}

      {/* Reset Confirmation Modal */}
      {pendingAction !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[100]">
          <div className="bg-card rounded-lg shadow-xl border border-border/50 p-6 w-[400px] max-w-[95%]">
            <h3 className="text-lg font-semibold text-foreground mb-2">Reset Report Required</h3>
            <p className="text-sm text-muted-foreground mb-5">
              Removing or reordering files requires resetting the current report and all failed and passed checks. This cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={handleCancelReset}
                disabled={isExecutingReset}
                className="px-4 py-2 text-secondary-foreground bg-secondary rounded-md hover:bg-accent transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReset}
                disabled={isExecutingReset}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isExecutingReset && (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                )}
                {isExecutingReset ? "Resetting..." : "Reset & Proceed"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
