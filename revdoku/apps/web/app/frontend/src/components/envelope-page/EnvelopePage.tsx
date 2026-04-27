"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Document, Page } from "react-pdf";
import { ZoomSelect, type ZoomMode } from "./ZoomSelect";
import {
  getColorsForCheckResult,
  IPageInfo,
  ICoordinates,
  IReport,
  IChecklist,
  IRule,
  ICheck,
  ICheckForDisplay,
  IEnvelopeRevision,
  IDocumentFileRevision,
  getWidth,
  getHeight,
  IEnvelope,
  ITag,
  appendEnvelopeRevision,
  getCurrentEnvelopeRevision,
  envelopeToJSON,
  envelopeFromJSON,
  getPageCountFromDocument,
  getPagesForDocument,
  getDocumentMetaData,
  getDocumentFileRevisionsForEnvelopeRevision,
  getDateTimeAgoAsHumanString,
  getFilesWithOnlyRelatedFileRevisionsForEnvelopeRevision,
  cleanFilename,
  getTitleFromFiles,
  createNewReport,
  createNewRule,
  ITypedRule,
  ICheckFlatten,
  ERuleSource,
  CheckSource,
  ReportJobStatus,
  ReportLayoutMode,
  REVDOKU_LABEL_FONT_FAMILIES,
  HighlightMode,
  CheckType,
  getCheckTypes,
  REVDOKU_CHECK_FILTER_LABELS,
  REVDOKU_CATCH_CHANGES_RULE_ID,
  IPageText,
} from "@revdoku/lib";
import type { LabelFontFamily } from "@revdoku/lib";
import { truncateFilename } from "@/lib/string-utils";
import { convertFileRevisionsToBase64PdfForDisplay } from "@/lib/pdf-utils-client";
import { base64ToFile } from "@/lib/file-utils";
import { generatePreview } from "@/utils/file-preview";
import { v4 as uuidv4 } from "uuid";

import ChecklistDialog from "@/components/ChecklistDialog";
import AddChecklistDialog from "@/components/AddChecklistDialog";
import AIModelSelectionDialog from "@/components/AIModelSelectionDialog";
import type { CreateFromTemplateData } from "@/components/AddChecklistDialog";
import FileRearrangeDialog from "@/components/FileRearrangeDialog";
import OnboardingHint from "@/components/OnboardingHint";
import EmptyEnvelopeDropzone from "@/components/EmptyEnvelopeDropzone";

import { useChecklistManager } from "@/hooks/useChecklistManager";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import { usePanning } from "./hooks/usePanning";
import { useHighlightDragResize } from "./hooks/useHighlightDragResize";
import { useLabelDragResize } from "./hooks/useLabelDragResize";
import { useViewerZoom } from "./hooks/useViewerZoom";
import { useReportOptions } from "./hooks/useReportOptions";
import { useInspection, saveInspectionProgress } from "./hooks/useInspection";
import { useManualCheckCreation } from "./hooks/useManualCheckCreation";
import { useFileManagement } from "./hooks/useFileManagement";
import { useLabelGeometry } from "./hooks/useLabelGeometry";
import { useContinuousScroll, PAGE_GAP } from "./hooks/useContinuousScroll";

import { ApiClient } from "@/lib/api-client";
import { getApiConfig } from "@/config/api";
import { setLoadedModels } from "@/lib/ai-model-utils";
import { getEditabilityState } from "@/lib/editability-state";
// REVDOKU_CATCH_CHANGES_RULE_ID now imported from @revdoku/lib
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { useEnvelopesLayout } from "@/app/envelopes/EnvelopesLayout";
import { Badge } from "@/components/ui/badge";
import { EnvelopeRuleBadge } from "@/components/ui/EnvelopeRuleBadge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { VersionBadge } from "@/components/ui/VersionBadge";
import { ScriptsBadge } from "@/components/ui/ScriptsBadge";
import { Pencil, Archive, ArchiveRestore, Share, Share2, FileDiff, FilePlus, Trash2, ClipboardCheck, Upload, BoxSelect, Tag, Eye, X, GitCompare, ArrowLeft, Play, Loader2, Copy, Check, AlertTriangle } from "lucide-react";
import TagChip from "@/components/folders/TagChip";
import { TAG_DOT_CLASSES } from "@/lib/tag-colors";
import TagPicker from "@/components/folders/TagPicker";

import InlineCheckEditor from "@/components/envelope-page/InlineCheckEditor";
import { AppFooter } from "@/components/AppFooter";
import { showToast } from "@/lib/toast";
import { ApiError } from "@/lib/api-error";
import CheckNavigator from "@/components/envelope-page/CheckNavigator";
import { CheckFilterType } from "@revdoku/lib";
type CheckFilter = CheckFilterType;
import InspectionProgressOverlay from "@/components/envelope-page/InspectionProgressOverlay";
import ReportPopup from "@/components/envelope-page/ReportPopup";
import DebugPanel from "@/components/envelope-page/DebugPanel";
import PageDiffViewer, { type RevisionOption } from "@/components/envelope-page/PageDiffViewer";
import DebugGrid from "@/components/envelope-page/DebugGrid";
import ToolbarActions from "@/components/envelope-page/ToolbarActions";
import HighlightOverlay from "@/components/envelope-page/HighlightOverlay";
import EnvelopeKebabMenu from "@/components/envelope-page/EnvelopeKebabMenu";
import CustomScriptDialog from "@/components/envelope-page/CustomScriptDialog";
import { renderMustache, splitScriptCodeAndTemplate } from "@revdoku/lib";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { getCompliancePercentColor } from "@/lib/envelope-status";
import ManualCheckDialog from "@/components/envelope-page/ManualCheckDialog";
import ReviewCustomDialog from "@/components/envelope-page/ReviewCustomDialog";
import { DuplicateEnvelopeDialog } from "@/components/DuplicateEnvelopeDialog";
import { SUPPORT_EMAIL } from "@/lib/support";
import {
  filterChecks as filterChecksUtil,
  updateReportInBothStates as updateReportInBothStatesUtil,
  addCheckToReport as addCheckToReportUtil,
  updateCheckInReport as updateCheckInReportUtil,
  removeCheckFromReport as removeCheckFromReportUtil,
} from "@/components/envelope-page/envelope-utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";

const CREATE_NEW_RULE_OPTION = "-- create new rule --";
const CHECKLIST_RULE_ID_PREFIX = "crule_";
const ENVELOPE_RULE_ID_PREFIX = "erule_";

// Gray colors for dimmed (non-hovered) elements — UI-only, not used in canvas/export
const DIMMED_HIGHLIGHT_COLOR = 'rgba(156, 163, 175, 0.05)';  // gray-400 at highlight fill opacity
const DIMMED_BORDER_COLOR = 'rgba(156, 163, 175, 0.4)';      // gray-400 at reduced border opacity
const DIMMED_TEXT_COLOR = '#9ca3af';                            // gray-400 solid

export default function EnvelopePage() {

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshEnvelopes, registerInspection, unregisterInspection } = useEnvelopesLayout();
  const features = useFeatureFlags();
  const isViewRoute = location.pathname === '/envelopes/view';
  // Support both 'envelopeId' and 'id' query parameters for flexibility
  const envelopeId = searchParams.get('envelopeId') || searchParams.get('id');

  const [inputFileConvertedForDisplay, setInputFileConvertedForDisplay] =
    useState<File | null>(null);
  const [inputBase64ConvertedForDisplay, setInputBase64ConvertedForDisplay] =
    useState<string | null>(null);
  const [inputPdfBytes, setInputPdfBytes] = useState<Uint8Array | null>(null);
  const [isProcessingInput, setIsProcessingInput] = useState(false);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'single_page' | 'continuous_scroll'>('continuous_scroll');
  const [alignLabelsToTop, setAlignLabelsToTop] = useState(false);
  const [currentEnvelope, setCurrentEnvelope] = useState<IEnvelope | null>(
    null,
  );
  const [isLoadingEnvelope, setIsLoadingEnvelope] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);
  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(import.meta.env.DEV);
  const [showPageDiffs, setShowPageDiffs] = useState(false);
  const [showCustomScriptDialog, setShowCustomScriptDialog] = useState(false);
  const [userJsOutputHtml1, setUserJsOutputHtml1] = useState<string | null>(null);
  const [userJsScript1Data, setUserJsScript1Data] = useState<Record<string, unknown> | null>(null);
  const [userJsScript1LastRun, setUserJsScript1LastRun] = useState<Date | null>(null);
  const [userJsScript1Running, setUserJsScript1Running] = useState(false);
  const [userJsScript1Copied, setUserJsScript1Copied] = useState(false);
  // userJsScript1Expanded state removed — script output is always fully visible
  const pageTextsCacheRef = useRef<Map<string, IPageText[]>>(new Map());
  const [pageTextsCacheTrigger, setPageTextsCacheTrigger] = useState(0);
  // Library files available as diff-viewer comparison targets. Fetched lazily
  // on first diff-viewer open. Each entry's `latest_revision.prefix_id` is
  // also the cache key in pageTextsCacheRef (revision prefix_ids `dfrev_…`
  // don't collide with report prefix_ids `rpt_…`).
  const [libraryDiffFiles, setLibraryDiffFiles] = useState<Array<{
    prefix_id: string;
    latest_revision: {
      prefix_id: string;
      name: string;
      mime_type: string;
      ready: boolean;
      uploaded_at: string;
    };
  }>>([]);
  const [debugSkipAI, setSkipAI] = useState(false);
  const [debugForceInspection, setDebugForceInspection] = useState(false);
  const [debugGridMode, setDebugGridMode] = useState<string>('');
  const [debugPages, setDebugPages] = useState<string>('');
  const [debugScaleMultiplierX, setDebugScaleMultiplierX] = useState<number>(1.0);
  const [debugScaleMultiplierY, setDebugScaleMultiplierY] = useState<number>(1.0);
  const [checkFilter, setCheckFilter] = useState<CheckFilter>(CheckFilterType.FAILED_AND_CHANGES);
  const [selectedChecklistId, setSelectedChecklistId] = useState<
    string | "auto-detect" | "use-previous" | "please-select"
  >("please-select");
  const [currentChecklist, setCurrentChecklist] = useState<IChecklist | null>(null);
  const [showChecklistDialog, setShowChecklistDialog] = useState(false);
  const [showAddChecklistDialog, setShowAddChecklistDialog] = useState(false);
  const [isGeneratingChecklist, setIsGeneratingChecklist] = useState(false);
  const [generateChecklistError, setGenerateChecklistError] = useState<string | null>(null);
  const [selectedChecklistVersions, setSelectedChecklistVersions] = useState<any[]>([]);
  // AI model selection two-step flow state
  const [showModelSelection, setShowModelSelection] = useState(false);
  const [pendingSourceText, setPendingSourceText] = useState('');
  const [checklistDialogInitialTab, setChecklistDialogInitialTab] = useState<string | undefined>();
  // When user jumps from a check to "Edit in source checklist", we scroll the
  // matching rule into view inside ChecklistDialog. Cleared on close.
  const [checklistDialogFocusRuleId, setChecklistDialogFocusRuleId] = useState<string | undefined>();
  // Track newly created checklist so we can delete it if user cancels without saving
  // Use ref for synchronous reads (avoids race between onSave clearing + onClose reading)
  const [justCreatedChecklistId, setJustCreatedChecklistId] = useState<string | null>(null);
  const justCreatedRef = useRef<string | null>(null);
  const reopenReviewDialogRef = useRef(false);
  const openedFromReviewDialogRef = useRef(false);
  const reviewDialogChecklistIdRef = useRef<string | null>(null);
  // File management state and handlers extracted to useFileManagement hook (initialized after dependencies are available)
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const titleEditCancelledRef = useRef(false);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [availableTags, setAvailableTags] = useState<ITag[]>([]);

  // Unified save status tracker for all save operations
  const { saveState, trackSave, reportExternalStatus } = useSaveTracker();

  // State for lock toggle
  const [isTogglingArchive, setIsTogglingArchive] = useState(false);

  // Onboarding hints — show for first 3 completed inspections
  const [showOnboardingHints, setShowOnboardingHints] = useState(() => {
    try {
      return parseInt(localStorage.getItem('revdoku_onboarding_count') || '0', 10) < 3;
    } catch { return false; }
  });

  // Checklist onboarding hints — show for first 3 checklists created
  const [showChecklistOnboardingHints, setShowChecklistOnboardingHints] = useState(() => {
    try {
      return parseInt(localStorage.getItem('revdoku_checklist_onboarding_count') || '0', 10) < 3;
    } catch { return false; }
  });

  // Warn user before closing tab when there's a save error
  useEffect(() => {
    if (!saveError) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveError]);

  // Load AI models on mount so getModelDisplayLabel() works in splash screen
  useEffect(() => {
    ApiClient.getModelsCached()
      .then(res => setLoadedModels(res.models, res.default_model_id, res.default_checklist_generation_model_id, res.default_text_extraction_model_id, res.aliases || []))
      .catch(() => { }); // non-critical — splash just won't show model name
  }, []);

  // Version/revision for the in-page AppFooter. layout.tsx does the same
  // fetch for the app-shell footer; this one is the envelope-view footer,
  // which layout.tsx suppresses via isEnvelopeViewPage.
  const [appVersion, setAppVersion] = useState<string>('');
  const [appRevision, setAppRevision] = useState<string>('');
  useEffect(() => {
    getApiConfig().then(c => {
      setAppVersion(c.appVersion || '');
      setAppRevision(c.appRevision || '');
    }).catch(() => {});
  }, []);

  // Checklist error highlight
  const [checklistError, setChecklistError] = useState<string | null>(null);

  const pageScrollContainerRef = useRef<HTMLDivElement>(null);
  // Magnify cycle (Z key): 3-state cycle.
  // 0 = not magnified (initial), 1 = zoomed to highlight+label, 2 = zoomed to highlight only.
  // On state 0→1: save zoom, zoom to fit highlight+label. On 1→2: zoom to highlight only.
  // On 2→0: restore saved zoom.
  const preMagnifyZoomRef = useRef<number | null>(null);
  const magnifyStageRef = useRef<0 | 1 | 2>(0);

  // Separate state for current report to prevent PDF reload on highlight changes
  const [currentReport, setCurrentReport] = useState<IReport | null>(null);

  // Ephemeral dismissal state for the "Pages X–Y not reviewed" toolbar banner.
  // Tracks the report id the user last dismissed the banner for — NOT persisted
  // (a page reload resets this to null so the banner reappears), and NOT tied
  // to the report record so different reports get independent dismissal state.
  const [dismissedBannerReportId, setDismissedBannerReportId] = useState<string | null>(null);

  const currentEnvelopeRevision = currentEnvelope
    ? getCurrentEnvelopeRevision(currentEnvelope)
    : null;

  // Get previous report
  const previousReport: IReport | null = getPreviousReport();
  function getPreviousReport(): IReport | null {
    if (!currentEnvelope || !currentEnvelope.envelope_revisions || currentEnvelope.envelope_revisions.length <= 1) return null;

    const currentIdx = currentEnvelope.current_revision_index;
    if (currentIdx <= 0) return null;

    const previousRevision = currentEnvelope.envelope_revisions[currentIdx - 1];
    return previousRevision?.report || null;
  };

  // Build revision options for the diff viewer (selectable revisions)
  const allDiffRevisions = useMemo((): RevisionOption[] => {
    if (!currentEnvelope?.envelope_revisions) return [];

    const getFileNames = (rev: typeof currentEnvelope.envelope_revisions[0]): string[] => {
      if (!rev?.document_file_revision_links || !currentEnvelope?.document_files) return [];
      try {
        return getDocumentFileRevisionsForEnvelopeRevision(currentEnvelope.document_files, rev).map(f => f.name);
      } catch { return []; }
    };

    const revisionOpts: RevisionOption[] = currentEnvelope.envelope_revisions.map((rev, idx) => {
      const reportId = rev.report?.id;
      const cached = reportId ? pageTextsCacheRef.current.get(reportId) : undefined;
      const hasFlag = !!(rev.report?.has_page_texts);
      return {
        index: idx,
        kind: 'revision' as const,
        revisionNumber: (rev.revision_number ?? 0) + 1,
        createdAt: rev.created_at,
        fileNames: getFileNames(rev),
        totalPages: cached?.length ?? 0,
        hasPageTexts: hasFlag || !!cached,
        pageTexts: cached ?? [],
      };
    });

    // Envelope-scoped reference files — pinned to any revision's report via
    // RefFile records, exposed through report.ref_files_meta. Union across
    // all revisions and dedupe by document_file_revision_prefix_id so the
    // selector shows each referenced file once regardless of how many
    // revisions cite it.
    type RefFileMeta = {
      document_file_revision_prefix_id?: string;
      filename?: string | null;
    };
    const refFileSeen = new Set<string>();
    const refFileEntries: Array<{ revId: string; filename: string }> = [];
    for (const rev of currentEnvelope.envelope_revisions) {
      const metas = ((rev.report as unknown as { ref_files_meta?: RefFileMeta[] })?.ref_files_meta) || [];
      for (const m of metas) {
        const revId = m.document_file_revision_prefix_id;
        if (!revId || refFileSeen.has(revId)) continue;
        refFileSeen.add(revId);
        refFileEntries.push({ revId, filename: m.filename || revId });
      }
    }
    const refFileOpts: RevisionOption[] = refFileEntries.map((e, i) => {
      const cached = pageTextsCacheRef.current.get(e.revId);
      return {
        index: revisionOpts.length + i,
        kind: 'ref_file' as const,
        libraryFileName: e.filename,
        fileNames: [e.filename],
        totalPages: cached?.length ?? 0,
        hasPageTexts: !!cached,
        pageTexts: cached ?? [],
      };
    });

    // Append library-file options. Their page_texts are normalised by the
    // SAME pipeline as envelope revisions (NormalizeDocumentFileRevisionJob →
    // ai.extractPageTexts for PDFs/images, PromptSanitizer for csv/txt), so
    // the downstream computePageDiffs() sees uniform `IPageText[]` input.
    // Filter out any library file whose revision already appears as an
    // envelope ref file (avoids duplicate rows when an envelope-scoped ref
    // was also copied to the library).
    const libraryOpts: RevisionOption[] = libraryDiffFiles
      .filter(lf => !refFileSeen.has(lf.latest_revision.prefix_id))
      .map((lf, i) => {
        const revId = lf.latest_revision.prefix_id;
        const cached = pageTextsCacheRef.current.get(revId);
        return {
          index: revisionOpts.length + refFileOpts.length + i,
          kind: 'library' as const,
          libraryFileName: lf.latest_revision.name,
          createdAt: lf.latest_revision.uploaded_at,
          fileNames: [lf.latest_revision.name],
          totalPages: cached?.length ?? 0,
          hasPageTexts: !!cached,
          pageTexts: cached ?? [],
        };
      });

    return [...revisionOpts, ...refFileOpts, ...libraryOpts];
  }, [currentEnvelope?.envelope_revisions, currentEnvelope?.document_files, libraryDiffFiles, pageTextsCacheTrigger]);

  // Lazy-fetch page_texts when diff viewer opens
  useEffect(() => {
    if (!showPageDiffs || !currentEnvelope?.envelope_revisions) return;

    const revisionsToFetch = currentEnvelope.envelope_revisions.filter(rev => {
      const reportId = rev.report?.id;
      if (!reportId) return false;
      if (pageTextsCacheRef.current.has(reportId)) return false;
      return !!(rev.report?.has_page_texts);
    });

    if (revisionsToFetch.length === 0) return;

    const fetchAll = async () => {
      const results = await Promise.allSettled(
        revisionsToFetch.map(async rev => {
          const reportId = rev.report!.id;
          const { page_texts } = await ApiClient.getReportPageTexts(reportId);
          return { reportId, page_texts };
        })
      );

      let updated = false;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          pageTextsCacheRef.current.set(result.value.reportId, result.value.page_texts);
          updated = true;
        }
      }
      if (updated) {
        setPageTextsCacheTrigger(n => n + 1);
      }
    };

    fetchAll();
  }, [showPageDiffs, currentEnvelope?.envelope_revisions]);

  // When diff viewer opens, fetch the account's library file list once and
  // then lazily hydrate each library file's page_texts. Uses the same
  // pageTextsCacheRef storage as envelope revisions — revision prefix_ids
  // (`dfrev_…`) are disjoint from report prefix_ids (`rpt_…`) so there's
  // no key collision. Files whose `ready` flag is false are skipped; their
  // page_texts will still be missing the next time diff is opened, which
  // surfaces as "(no data)" in the selector until the normalize job finishes.
  useEffect(() => {
    if (!showPageDiffs) return;

    let cancelled = false;
    const run = async () => {
      try {
        const { files } = await ApiClient.listLibraryFiles();
        if (cancelled) return;
        const readyFiles = files.filter(f => f.latest_revision.ready);
        setLibraryDiffFiles(readyFiles);

        const toFetch = readyFiles.filter(f => !pageTextsCacheRef.current.has(f.latest_revision.prefix_id));
        if (toFetch.length === 0) return;

        const results = await Promise.allSettled(
          toFetch.map(async f => {
            const revId = f.latest_revision.prefix_id;
            const { page_texts } = await ApiClient.getLibraryFileRevisionPageTexts(revId);
            return { revId, page_texts };
          })
        );
        if (cancelled) return;

        let updated = false;
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.page_texts.length > 0) {
            pageTextsCacheRef.current.set(result.value.revId, result.value.page_texts);
            updated = true;
          }
        }
        if (updated) setPageTextsCacheTrigger(n => n + 1);
      } catch {
        // Library fetch failures are non-fatal — the diff viewer still works
        // with just envelope revisions. Silence the error to avoid spamming
        // the user on every diff-viewer open when they have no library access.
      }
    };

    run();
    return () => { cancelled = true; };
  }, [showPageDiffs]);

  // Lazy-fetch page_texts for envelope-scoped reference files when the diff
  // viewer opens. Reference files are collected from report.ref_files_meta
  // in the allDiffRevisions builder above; here we hydrate their cached
  // page_texts via the same endpoint as library files (the endpoint accepts
  // any DocumentFileRevision owned by current_account). Keyed by revision
  // prefix_id in pageTextsCacheRef so a ref file that's ALSO in the library
  // only gets fetched once.
  useEffect(() => {
    if (!showPageDiffs || !currentEnvelope?.envelope_revisions) return;

    const refRevIds = new Set<string>();
    for (const rev of currentEnvelope.envelope_revisions) {
      const metas = ((rev.report as unknown as { ref_files_meta?: Array<{ document_file_revision_prefix_id?: string }> })?.ref_files_meta) || [];
      for (const m of metas) {
        const revId = m.document_file_revision_prefix_id;
        if (revId) refRevIds.add(revId);
      }
    }

    const toFetch = [...refRevIds].filter(id => !pageTextsCacheRef.current.has(id));
    if (toFetch.length === 0) return;

    let cancelled = false;
    const run = async () => {
      const results = await Promise.allSettled(
        toFetch.map(async id => {
          const { page_texts } = await ApiClient.getLibraryFileRevisionPageTexts(id);
          return { id, page_texts };
        })
      );
      if (cancelled) return;
      let updated = false;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.page_texts.length > 0) {
          pageTextsCacheRef.current.set(result.value.id, result.value.page_texts);
          updated = true;
        }
      }
      if (updated) setPageTextsCacheTrigger(n => n + 1);
    };
    run();
    return () => { cancelled = true; };
  }, [showPageDiffs, currentEnvelope?.envelope_revisions]);

  // Initialize view settings from persisted envelope settings
  // (report_settings initialization is handled by useReportOptions hook)
  useEffect(() => {
    if (currentEnvelope?.view_settings) {
      const prevReport = getPreviousReport();
      const hasPrev = !!prevReport;
      const resolveFilter = (f: string | undefined, fallback: string) => {
        if (!f) return fallback;
        if ((f === 'changes' || f === 'rechecks') && !hasPrev) return 'failed';
        return f;
      };
      setCheckFilter(resolveFilter(currentEnvelope.view_settings.check_filter, 'failed') as CheckFilter);
      setReportCheckFilter(resolveFilter(currentEnvelope.view_settings.report_check_filter, 'failed') as CheckFilter);
      setReportLayoutMode(currentEnvelope.view_settings.report_layout_mode ?? 'compact');
      setReportShowAnnotations(currentEnvelope.view_settings.show_annotations ?? true);
      setViewMode(currentEnvelope.view_settings.view_mode ?? 'continuous_scroll');
      setAlignLabelsToTop(currentEnvelope.view_settings.align_labels_to_top ?? false);
    }
  }, [currentEnvelope?.id]);

  // Ref to skip initial fire of view settings auto-save
  const viewSettingsInitRef = useRef(false);
  // Ref to track whether scroll position has been restored from localStorage
  const scrollRestoredRef = useRef(false);

  const getRuleForCheck = (ruleId: string | null): IRule | null => {
    if (!ruleId) return null;
    // First check the report's checklist (which is a snapshot with all rules)
    // Match by id first, then fall back to source_rule_id for cross-snapshot matching
    const reportRule = currentReport?.checklist?.rules?.find(
      (r: IRule) => r.id === ruleId || (r as any).source_rule_id === ruleId
    );
    if (reportRule) return reportRule;
    // Fall back to the template checklist
    const checklistRule = currentChecklist?.rules?.find(
      (r) => r.id === ruleId || (r as any).source_rule_id === ruleId
    );
    if (checklistRule) return checklistRule;
    if (import.meta.env.DEV) console.debug(`Rule with ID ${ruleId} not found in report or template checklist.`);
    return null;
  };

  const getCheckRuleId = (check: any): string | null => {
    return check.rule_id || null;
  };

  const ruleKeysWithChecks = useMemo(() => {
    if (!currentReport?.checks) return new Map<string, number>();
    const countMap = new Map<string, number>();
    currentReport.checks.forEach((c: ICheck) => {
      const key = c.rule_id;
      if (key) countMap.set(key, (countMap.get(key) ?? 0) + 1);
    });
    return countMap;
  }, [currentReport?.checks]);

  const isReadOnlyRevision = Boolean(
    currentEnvelope &&
    currentEnvelope.envelope_revisions &&
    (
      currentEnvelope.envelope_revisions.length > 1 &&
      currentEnvelope.current_revision_index !== currentEnvelope.envelope_revisions.length - 1
    )
  );

  const filterChecks = (checks: ICheck[], filter: CheckFilter): ICheck[] =>
    filterChecksUtil(checks, filter);

  const setInspectionReport = (
    value: IReport | ((prev: IReport | null) => IReport | null),
  ) => {
    setCurrentReport(value);
  };

  const updateReportInBothStates = (newReport: IReport) =>
    updateReportInBothStatesUtil(newReport, setCurrentReport, setCurrentEnvelope);

  const addCheckToReport = (newCheck: ICheck, updatedChecklist?: IChecklist) =>
    addCheckToReportUtil(newCheck, currentReport?.id, setCurrentReport, setCurrentEnvelope, updatedChecklist);

  const updateCheckInReport = (updatedCheck: ICheck) =>
    updateCheckInReportUtil(updatedCheck, currentReport?.id, setCurrentReport, setCurrentEnvelope);

  const removeCheckFromReport = (checkId: string) =>
    removeCheckFromReportUtil(checkId, currentReport?.id, setCurrentReport, setCurrentEnvelope);

  // Check navigator state
  const [currentCheckIndex, setCurrentCheckIndex] = useState(0);

  // State for managing overlapping highlights
  const [overlappingHighlights, setOverlappingHighlights] = useState<string[]>(
    [],
  );
  const [currentOverlapIndex, setCurrentOverlapIndex] = useState(0);

  const currentRevisionPages: IPageInfo[] = useMemo(() => {
    if (!currentEnvelope || !currentEnvelopeRevision || !currentEnvelope.document_files || currentEnvelope.document_files.length === 0) {
      return [];
    }
    try {
      return getPagesForDocument(currentEnvelope.document_files, currentEnvelopeRevision) || [];
    } catch (error) {
      if (import.meta.env.DEV) console.debug('Error getting pages for document:', error);
      return [];
    }
  }, [currentEnvelope?.document_files, currentEnvelopeRevision?.id, currentEnvelopeRevision?.document_file_revision_links]);

  // Get file revisions directly without converting to File objects
  const fileRevisions = useMemo(() => {
    if (!currentEnvelope || !currentEnvelopeRevision) return [] as IDocumentFileRevision[];
    // Handle case where envelope has no source files yet (blank envelope)
    if (!currentEnvelope.document_files || currentEnvelope.document_files.length === 0) {
      return [] as IDocumentFileRevision[];
    }
    // Check if current revision has any file revision links
    if (!currentEnvelopeRevision.document_file_revision_links || currentEnvelopeRevision.document_file_revision_links.length === 0) {
      return [] as IDocumentFileRevision[];
    }
    try {
      return getDocumentFileRevisionsForEnvelopeRevision(currentEnvelope.document_files, currentEnvelopeRevision);
    } catch (error) {
      if (import.meta.env.DEV) console.debug('Error getting file revisions for source document:', error);
      return [] as IDocumentFileRevision[];
    }
  }, [currentEnvelope?.document_files, currentEnvelopeRevision?.id, currentEnvelopeRevision?.document_file_revision_links]); // Only recalculate when revision ID or file links change, not when report updates

  // Lazily fetch file content for revisions that have data on the server but not yet loaded
  const fileContentFetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!currentEnvelope || fileRevisions.length === 0) return;

    // Clear stale entries: if a revision was previously fetched but lost its data
    // (e.g. envelope was reloaded from API after file edit), allow re-fetching
    for (const r of fileRevisions) {
      if (!r.data && fileContentFetchedRef.current.has(r.id)) {
        fileContentFetchedRef.current.delete(r.id);
      }
    }

    const revisionsNeedingContent = fileRevisions.filter(
      (r: IDocumentFileRevision) => !r.data && (r as any).has_data && !fileContentFetchedRef.current.has(r.id)
    );
    if (revisionsNeedingContent.length === 0) return;

    // Mark as in-flight to prevent duplicate fetches
    revisionsNeedingContent.forEach(r => fileContentFetchedRef.current.add(r.id));

    const fetchContent = async () => {
      const results = await Promise.all(
        revisionsNeedingContent.map(async (rev) => {
          try {
            const { content } = await ApiClient.getDocumentFileRevisionContent(rev.id);
            return { id: rev.id, content };
          } catch (err) {
            console.error(`Failed to fetch content for revision ${rev.id}:`, err);
            fileContentFetchedRef.current.delete(rev.id);
            return null;
          }
        })
      );

      // Patch the content into currentEnvelope's document_files
      const contentMap = new Map<string, string>();
      for (const r of results) {
        if (r) contentMap.set(r.id, r.content);
      }
      if (contentMap.size === 0) return;

      setCurrentEnvelope(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          document_files: prev.document_files.map(df => ({
            ...df,
            document_file_revisions: df.document_file_revisions.map(rev =>
              contentMap.has(rev.id) ? { ...rev, data: contentMap.get(rev.id)! } : rev
            ),
          })),
        };
      });
    };

    fetchContent();
  }, [fileRevisions, currentEnvelope?.id]);

  // Keep inputFiles for backward compatibility with file upload operations
  const inputFiles = useMemo(() => {
    return fileRevisions
      .filter((f: IDocumentFileRevision) => f.data) // Filter out revisions without data
      .map((f: IDocumentFileRevision) =>
        base64ToFile(f.data, f.name, f.mime_type)
      );
  }, [fileRevisions]);

  // Track when each file was added (parallel array to inputFiles)
  const createdAtDates = useMemo(() => {
    return fileRevisions
      .filter((f: IDocumentFileRevision) => f.data)
      .map((f: IDocumentFileRevision) => f.created_at || '');
  }, [fileRevisions]);

  // First-view thumbnail fallback. Envelopes created via paths that
  // don't run the client-side pdf.js upload hook (inbound email,
  // API creation, the sample-envelope seed) arrive at the viewer
  // with no thumbnail until a Review runs. Once we have the first
  // file's bytes in hand, probe the /thumbnail endpoint with an
  // <img> load and — if it 404s — render page 1 locally via pdf.js
  // (same `generatePreview` helper the upload hooks use) and POST it
  // back. One-shot per envelope mount, fire-and-forget.
  const thumbnailEnsuredRef = useRef<string | null>(null);
  useEffect(() => {
    const envId = currentEnvelope?.id;
    if (!envId || inputFiles.length === 0) return;
    if (thumbnailEnsuredRef.current === envId) return;
    thumbnailEnsuredRef.current = envId;

    const probe = new Image();
    probe.onload = () => { /* thumbnail already exists — nothing to do */ };
    probe.onerror = () => {
      generatePreview(inputFiles[0])
        .then((dataUrl) => {
          if (dataUrl) ApiClient.uploadThumbnail(envId, dataUrl).catch(() => {});
        })
        .catch(() => {});
    };
    probe.src = `/api/v1/envelopes/${envId}/thumbnail?t=${Date.now()}`;
  }, [currentEnvelope?.id, inputFiles]);


  const {
    checklists,
    latestChecklists,
    selectedChecklist,
    setSelectedChecklist,
    isLoading: checklistsLoading,
    error: checklistsError,
    handleSaveChecklist: saveChecklist,
    handleDeleteChecklist: deleteChecklist,
    getChecklistRevisions,
    handleGeneratedChecklist,
    handleAddChecklist,
    fetchChecklists,
  } = useChecklistManager();

  // Increment checklist onboarding counter
  const incrementChecklistOnboardingCount = useCallback(() => {
    try {
      const count = parseInt(localStorage.getItem('revdoku_checklist_onboarding_count') || '0', 10);
      const newCount = count + 1;
      localStorage.setItem('revdoku_checklist_onboarding_count', String(newCount));
      if (newCount >= 3) setShowChecklistOnboardingHints(false);
    } catch { }
  }, []);

  // Generate checklist callback for AddChecklistDialog
  // Returns true on success, false on failure
  const handleGenerateNewChecklist = useCallback(async (sourceText: string, aiModel?: string): Promise<boolean> => {
    setIsGeneratingChecklist(true);
    setGenerateChecklistError(null);

    try {
      const result = await ApiClient.generateChecklist(sourceText, aiModel);

      if (!result.checklist) {
        throw new Error('Failed to generate checklist');
      }

      const savedChecklist = handleGeneratedChecklist(result.checklist);
      setShowAddChecklistDialog(false);
      incrementChecklistOnboardingCount();

      // Open the editor with the new checklist
      if (savedChecklist) {
        justCreatedRef.current = savedChecklist.id;
        setJustCreatedChecklistId(savedChecklist.id);
        setSelectedChecklistId(savedChecklist.id);
        setSelectedChecklist(savedChecklist);
        setShowChecklistDialog(true);
      }
      return true;
    } catch (error) {
      console.error('Error processing checklist:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to process checklist. Please try again.';
      setGenerateChecklistError(errorMessage);
      return false;
    } finally {
      setIsGeneratingChecklist(false);
    }
  }, [handleGeneratedChecklist, setSelectedChecklist, incrementChecklistOnboardingCount]);

  // Create from template or parsed text callback for AddChecklistDialog
  const handleCreateFromTemplate = useCallback(async (data: CreateFromTemplateData) => {
    try {
      const saved = await handleAddChecklist({
        name: data.name,
        system_prompt: data.system_prompt,
        rules: data.rules.map(r => ({ prompt: r.prompt, order: r.order })),
        ai_model: data.ai_model,
        user_scripts: data.user_scripts,
      } as unknown as IChecklist);
      setShowAddChecklistDialog(false);
      incrementChecklistOnboardingCount();
      if (saved) {
        justCreatedRef.current = saved.id;
        setJustCreatedChecklistId(saved.id);
        setSelectedChecklistId(saved.id);
        setSelectedChecklist(saved);
        setShowChecklistDialog(true);
      }
    } catch (error) {
      // error already handled by handleAddChecklist
    }
  }, [handleAddChecklist, setSelectedChecklist, incrementChecklistOnboardingCount]);

  // Two-step flow: AddChecklistDialog -> AIModelSelectionDialog
  const handleNeedAIModel = useCallback((sourceText: string) => {
    setPendingSourceText(sourceText);
    setShowAddChecklistDialog(false);
    setShowModelSelection(true);
  }, []);

  const handleModelSelected = useCallback(async (modelId: string | null) => {
    if (modelId === null) {
      setShowModelSelection(false);
      // "Manually, no AI" — first line = name, rest = system_prompt
      const lines = pendingSourceText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const name = lines[0] || 'New Checklist';
      const systemPrompt = lines.slice(1).join('\n').trim() || null;
      try {
        const saved = await handleAddChecklist({
          name,
          system_prompt: systemPrompt,
          rules: [{ prompt: '', order: 0 }],
        } as unknown as IChecklist);
        incrementChecklistOnboardingCount();
        if (saved) {
          justCreatedRef.current = saved.id;
          setJustCreatedChecklistId(saved.id);
          setSelectedChecklistId(saved.id);
          setSelectedChecklist(saved);
          setChecklistDialogInitialTab('ai');
          setShowChecklistDialog(true);
        }
      } catch (error) {
        console.error('Error creating checklist:', error);
      }
    } else {
      // AI generation — keep dialog open to show "Processing..." spinner
      setChecklistDialogInitialTab(undefined);
      const success = await handleGenerateNewChecklist(pendingSourceText, modelId);
      setShowModelSelection(false);
      if (!success) {
        // Reopen text entry dialog so user sees the error
        setShowAddChecklistDialog(true);
      }
    }
  }, [pendingSourceText, handleGenerateNewChecklist, handleAddChecklist, setSelectedChecklist, incrementChecklistOnboardingCount]);

  // Auto-save functionality
  const autoSaveFunction = useCallback(async () => {
    if (currentEnvelope && hasUnsavedChanges) {
      await saveEnvelopeToDatabase(currentEnvelope, false);
      setHasUnsavedChanges(false);
    }
  }, [currentEnvelope, hasUnsavedChanges]);

  const { saveStatus, debouncedSave, saveImmediately } = useAutoSave(
    autoSaveFunction,
    10000 // 10 seconds
  );

  // Mirror envelope auto-save status into unified tracker
  useEffect(() => {
    reportExternalStatus(saveStatus);
  }, [saveStatus, reportExternalStatus]);

  // Prefer the embedded checklist from the report (which includes rules), fall back to lookup from checklists array
  const inspectionReportChecklist: IChecklist | null =
    currentReport?.checklist ??
    (currentReport?.checklist_id
      ? checklists.find((c) => c.id === currentReport.checklist_id) ?? null
      : null);

  // Collect custom rules from all envelope revisions (source of truth for envelope rules)
  const envelopeUserRules: IRule[] = useMemo(() => {
    const revisions = currentEnvelope?.envelope_revisions;
    if (!revisions?.length) return [];
    // Sort by revision_number and collect all revision_rules
    return [...revisions]
      .sort((a, b) => a.revision_number - b.revision_number)
      .flatMap(rev => (rev.revision_rules || []).map(r => ({ ...r, origin: 'user' as const })));
  }, [currentEnvelope?.envelope_revisions]);

  // Detect if revision rules changed since the last AI review
  const rulesChangedSinceReview = useMemo(() => {
    if (!currentReport?.checklist?.rules) return false;
    const inspectedUserRules = (currentReport.checklist.rules || [])
      .filter((r: IRule) => (r.origin === 'user'))
      .map((r: IRule) => r.prompt?.trim())
      .sort();
    const currentUserRules = envelopeUserRules
      .map((r: IRule) => r.prompt?.trim())
      .sort();
    if (inspectedUserRules.length !== currentUserRules.length) return true;
    return inspectedUserRules.some((p: string, i: number) => p !== currentUserRules[i]);
  }, [currentReport?.checklist?.rules, envelopeUserRules]);

  // Map of rule_id → prompt from last inspection for per-rule diff hints
  const inspectedUserRulesMap = useMemo<Record<string, string>>(() => {
    if (!currentReport?.checklist?.rules) return {};
    return (currentReport.checklist.rules || [])
      .filter((r: IRule) => r.origin === 'user' && r.id)
      .reduce((acc: Record<string, string>, r: IRule) => {
        acc[r.id!] = r.prompt?.trim() || '';
        return acc;
      }, {});
  }, [currentReport?.checklist?.rules]);

  const [
    documentPagesToDisplayImageDimensions,
    setDocumentPagesToDisplayImageDimensions,
  ] = useState<IPageInfo[]>([]);
  const [viewerWidth, setViewerWidth] = useState<number>(800);
  const [viewerHeight, setViewerHeight] = useState<number>(600);

  // Inline editor size — owned here because useViewerZoom and useManualCheckCreation both need it
  const [inlineEditorSize, setInlineEditorSize] = useState<{ width: number; height: number } | null>(null);

  // Pending new check and inline edit state — owned here because both useLabelGeometry and useManualCheckCreation need them
  const [pendingNewCheck, setPendingNewCheck] = useState<ICheckForDisplay | null>(null);
  const [inlineEditCheckId, setInlineEditCheckId] = useState<string | null>(null);

  // --- Extracted hooks ---
  const {
    zoomLevel, setZoomLevel, zoomMode, setZoomMode,
    pageFontScales, setPageFontScales, labelFontScale, fontScaleRef,
    fontFamily, highlightMode, handleFontFamilyChange, handleHighlightModeChange,
    handleZoomIn, handleZoomOut, handleFontScaleUp, handleFontScaleDown, handleFontScaleReset,
    handleZoomSelect, saveFontScaleImmediately,
  } = useViewerZoom({
    viewerWidth, viewerHeight, documentPagesToDisplayImageDimensions,
    currentPageIndex, currentReport, trackSave, setInlineEditorSize,
  });

  const {
    showReportPopup, setShowReportPopup,
    reportContent, reportLoading,
    reportCheckFilter, setReportCheckFilter,
    reportLayoutMode, setReportLayoutMode,
    reportShowAnnotations, setReportShowAnnotations,
    reportFontScale, setReportFontScale,
    reportFontFamily, setReportFontFamily,
    generateReport, formatReportAsText, updateReportOption,
  } = useReportOptions({
    currentReport, currentEnvelope, currentEnvelopeRevision: currentEnvelopeRevision ?? null, currentChecklist,
    checkFilter, envelopeId, trackSave, pageFontScales, fontFamily, highlightMode, saveFontScaleImmediately,
    alignLabelsToTop,
  });

  // Save envelope to database
  const saveEnvelopeToDatabase = async (envelope: IEnvelope, isNew = false) => {
    if (!envelope) return;
    try {
      if (isNew) {
        // Create new envelope
        const { envelope: created } = await ApiClient.createEnvelope({
          title: envelope.title,
          tags: envelope.tags as any
        });
        // Use the full created envelope data which includes revisions
        const newEnvelope = {
          ...created,
          document_files: [],  // New envelopes have no source files yet
          envelope_revisions: created.envelope_revisions || []  // Ensure envelope_revisions is always an array
        };
        setCurrentEnvelope(newEnvelope);
      } else {
        // Update existing envelope - only update metadata
        await ApiClient.updateEnvelope(envelope.id, {
          title: envelope.title,
          status: envelope.status
        });
      }
    } catch (err) {
      console.error('Error saving envelope:', err);
      setError(err instanceof Error ? err.message : 'Failed to save envelope changes');
    }
  };

  // Ref-forwarded callback for getCurrentChecklistId (defined later, used by useInspection event handlers)
  const getCurrentChecklistIdRef = useRef<() => string | null>(() => null);

  const {
    isInspecting, isCancelling,
    inspectingChecklistName, inspectingAiModel, inspectionStartTime,
    inspectionSummary, inspectionError, inspectionContext, resumedStepIndex,
    selectAIDialogState, setSelectAIDialogState,
    debugInfoData, revdokuDocApiElapsedMs,
    pendingInspectionAfterArrange, setPendingInspectionAfterArrange,
    lastInspectedState, setLastInspectedState,
    batchMeta,
    preparationMeta,
    refFilesTotal,
    handleInspect, handleCancelInspection, handleOverlayDismiss, handleResumeInspection,
  } = useInspection({
    currentEnvelope, setCurrentEnvelope,
    currentEnvelopeRevision: currentEnvelopeRevision ?? null,
    currentReport, setCurrentReport,
    previousReport,
    currentChecklist,
    checklists,
    envelopeId,
    numPages,
    checkFilter, setCheckFilter,
    getCurrentChecklistIdRef,
    showDebug, debugSkipAI, debugForceInspection, debugPages, debugGridMode,
    showOnboardingHints, setShowOnboardingHints,
    updateReportInBothStates,
    trackSave,
    setError,
    setChecklistError,
    saveEnvelopeToDatabase,
    checklistsLoading,
    onInspectionStatusChange: refreshEnvelopes,
    onInspectionStart: registerInspection,
    onInspectionEnd: unregisterInspection,
  });

  // Combined check: editing disabled when viewing previous revision, envelope is locked, or inspecting
  const isEditingDisabled = isReadOnlyRevision || !!currentEnvelope?.archived_at || isInspecting;

  // Debug checklists data
  useEffect(() => {
    if (import.meta.env.DEV) {
      if (checklists.length > 0) {
        console.debug(
          "Loaded checklists:",
          checklists.map((c) => ({
            id: c.id,
            name: c.name,
            rulesCount: c?.rules?.length,
            firstRuleOrder: c?.rules?.[0]?.order,
          })),
        );
        console.debug(
          "First checklist rules:",
          checklists[0]?.rules?.map((r) => ({
            id: r.id,
            order: r.order,
            prompt: r.prompt,
          })),
        );
      }
      console.debug("Button state:", {
        files: currentEnvelopeRevision?.document_file_revision_links?.length || 0,
        isInspecting,
        checklistsLoading,
        selectedChecklistId,
        buttonDisabled:
          !currentEnvelopeRevision ||
          !currentEnvelopeRevision.document_file_revision_links ||
          currentEnvelopeRevision.document_file_revision_links.length === 0 ||
          isInspecting ||
          checklistsLoading
      });
    }
  }, [checklists, currentEnvelopeRevision, isInspecting, checklistsLoading]);

  // Load localStorage viewer settings (zoom, selected check, page index)
  useEffect(() => {
    if (!currentEnvelope?.id) return;
    scrollRestoredRef.current = false; // reset scroll restoration flag for new envelope
    try {
      const stored = localStorage.getItem(`revdoku_viewer_${currentEnvelope.id}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.zoomMode) setZoomMode(parsed.zoomMode);
        if (typeof parsed.zoomLevel === 'number') setZoomLevel(parsed.zoomLevel);
        if (parsed.selectedCheckId) setSelectedCheckId(parsed.selectedCheckId);
        if (typeof parsed.currentPageIndex === 'number') setCurrentPageIndex(parsed.currentPageIndex);
      }
    } catch { /* ignore corrupted localStorage */ }
  }, [currentEnvelope?.id]);

  // Auto-save server-side view settings with debounce
  useEffect(() => {
    if (!viewSettingsInitRef.current) {
      viewSettingsInitRef.current = true;
      return;
    }
    if (!currentEnvelope?.id) return;

    const timer = setTimeout(() => {
      trackSave(ApiClient.updateEnvelope(currentEnvelope.id, {
        view_settings: {
          ...currentEnvelope.view_settings,
          check_filter: checkFilter,
          report_check_filter: reportCheckFilter,
          report_layout_mode: reportLayoutMode,
          show_annotations: reportShowAnnotations,
          view_mode: viewMode,
          align_labels_to_top: alignLabelsToTop,
        }
      } as any));
    }, 1000);

    return () => clearTimeout(timer);
  }, [checkFilter, reportCheckFilter, reportLayoutMode, reportShowAnnotations, viewMode, alignLabelsToTop]);

  // Auto-save localStorage viewer settings (zoom, selected check, page index)
  useEffect(() => {
    if (!currentEnvelope?.id) return;
    try {
      localStorage.setItem(`revdoku_viewer_${currentEnvelope.id}`, JSON.stringify({
        zoomLevel, zoomMode, selectedCheckId, currentPageIndex,
      }));
    } catch { /* quota exceeded */ }
  }, [currentEnvelope?.id, zoomLevel, zoomMode, selectedCheckId, currentPageIndex]);

  // Debounced scroll position persistence to localStorage
  useEffect(() => {
    const el = pageScrollContainerRef.current;
    if (!el || !currentEnvelope?.id) return;

    let timer: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const key = `revdoku_viewer_${currentEnvelope.id}`;
          const existing = JSON.parse(localStorage.getItem(key) || '{}');
          localStorage.setItem(key, JSON.stringify({
            ...existing, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft,
          }));
        } catch { /* ignore */ }
      }, 500);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => { clearTimeout(timer); el.removeEventListener('scroll', handleScroll); };
  }, [currentEnvelope?.id, inputFiles.length]);

  // Track scroll container size via ResizeObserver so viewerWidth/viewerHeight updates
  // when the container first appears (conditional render) and on window resize.
  useEffect(() => {
    const el = pageScrollContainerRef.current;
    if (!el) return;

    const updateSize = () => {
      const w = el.clientWidth;
      const newW = Math.max(400, w > 0 ? w - 48 : 0); // 48px for padding (p-4 = 32px + buffer)
      const newH = Math.max(200, el.clientHeight > 0 ? el.clientHeight - 16 : 0); // 16px for card wrapper padding + buffer
      // Hysteresis: ignore changes smaller than 20px to prevent oscillation from
      // scrollbar appearance/disappearance (~17px). Real window resizes are larger.
      setViewerWidth(prev => (prev === 0 || Math.abs(prev - newW) >= 20) ? newW : prev);
      setViewerHeight(prev => (prev === 0 || Math.abs(prev - newH) >= 20) ? newH : prev);
    };

    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    updateSize(); // initial measurement

    return () => ro.disconnect();
  }, [inputFiles]); // re-attach when inputFiles changes (container is conditionally rendered)

  // Navigate checks by delta (+1 = next, -1 = previous) in check-number order
  const navigateCheckByDelta = (delta: 1 | -1) => {
    if (!currentReport) return;
    const allVisibleChecks = filterChecks(currentReport.checks || [], checkFilter)
      .sort((a, b) => (a.check_index ?? a.rule_order ?? 0) - (b.check_index ?? b.rule_order ?? 0));
    if (allVisibleChecks.length === 0) return;

    // No check selected — auto-select first (j) or last (k)
    if (!selectedCheckId) {
      const pick = delta === 1 ? allVisibleChecks[0] : allVisibleChecks[allVisibleChecks.length - 1];
      setSelectedCheckId(pick.id);
      setCurrentCheckIndex(delta === 1 ? 0 : allVisibleChecks.length - 1);
      if (pick.page !== currentPageIndex) {
        setCurrentPageIndex(pick.page);
      }
      scrollToCheck(pick);
      return;
    }

    const currentIndex = allVisibleChecks.findIndex(c => c.id === selectedCheckId);
    if (currentIndex === -1) {
      setSelectedCheckId(allVisibleChecks[0].id);
      setCurrentCheckIndex(0);
      setCurrentPageIndex(allVisibleChecks[0].page);
      return;
    }
    const nextIndex = (currentIndex + delta + allVisibleChecks.length) % allVisibleChecks.length;
    const nextCheck = allVisibleChecks[nextIndex];
    setSelectedCheckId(nextCheck.id);
    setCurrentCheckIndex(nextIndex);
    if (nextCheck.page !== currentPageIndex) {
      setCurrentPageIndex(nextCheck.page);
    }
    scrollToCheck(nextCheck);
  };

  // Sync report from document revision when it changes
  useEffect(() => {
    if (currentEnvelopeRevision?.report) {
      setCurrentReport(currentEnvelopeRevision.report);
      // Auto-switch filter so user sees relevant results immediately
      const checks = currentEnvelopeRevision.report.checks || [];
      const failedCount = checks.filter((c: ICheck) => !c.passed).length;
      if (failedCount === 0 && checks.length > 0) {
        setCheckFilter(CheckFilterType.ALL);
      } else if (failedCount > 0 && checkFilter === CheckFilterType.PASSED) {
        setCheckFilter(CheckFilterType.FAILED_AND_CHANGES);
      }
    } else {
      setCurrentReport(null);
    }
  }, [currentEnvelopeRevision?.id, currentEnvelopeRevision?.report?.id]); // Only sync when revision or report ID changes

  // Process file changes and handle image to PDF conversion
  useEffect(() => {
    const processFiles = async () => {
      if (fileRevisions.length === 0) {
        setInputPdfBytes(null);
        setInputBase64ConvertedForDisplay(null);
        setInputFileConvertedForDisplay(null);
        setIsProcessingInput(false);
        return;
      }

      // Wait for lazy-loaded content — skip processing until all revisions have data
      const pendingContent = fileRevisions.some(r => !r.data && (r as any).has_data);
      if (pendingContent) return;

      try {
        setIsProcessingInput(true);

        // Yield to let React paint "Preparing image..." before blocking sync work
        await new Promise(resolve => setTimeout(resolve, 0));

        // Use direct base64 conversion for efficiency
        const { base64, pdfBytes, documentPagesToDisplayImageDimensions } =
          await convertFileRevisionsToBase64PdfForDisplay(fileRevisions);

        // Cleanup previous blob URL if it exists
        if (inputBase64ConvertedForDisplay && inputBase64ConvertedForDisplay.startsWith('blob:')) {
          URL.revokeObjectURL(inputBase64ConvertedForDisplay);
        }

        // Pass Uint8Array directly to react-pdf — avoids double data URL decoding
        setInputPdfBytes(pdfBytes);

        // For large files, create Blob URL for download; otherwise keep data URL
        const BASE64_SIZE_THRESHOLD = 10 * 1024 * 1024; // 10MB in bytes (roughly 13.3MB in base64)
        if (base64.length > BASE64_SIZE_THRESHOLD) {
          if (import.meta.env.DEV) console.debug(`Large PDF detected (${(base64.length / 1024 / 1024).toFixed(1)}MB base64), using Blob URL for download`);
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const blobUrl = URL.createObjectURL(blob);
          setInputBase64ConvertedForDisplay(blobUrl);
        } else {
          setInputBase64ConvertedForDisplay(base64);
        }

        // Clear the file-based display since we're using base64 now
        setInputFileConvertedForDisplay(null);

        setDocumentPagesToDisplayImageDimensions(
          documentPagesToDisplayImageDimensions,
        );
        setIsProcessingInput(false);
      } catch (error) {
        console.error("Error converting files:", error);
        setError(`Failed to convert files: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setIsProcessingInput(false);
        // Don't throw - just log the error and continue
      }
    };

    processFiles();
  }, [fileRevisions, retryCounter]);

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (inputBase64ConvertedForDisplay && inputBase64ConvertedForDisplay.startsWith('blob:')) {
        URL.revokeObjectURL(inputBase64ConvertedForDisplay);
      }
    };
  }, [inputBase64ConvertedForDisplay]);

  // --- Label geometry hook (creates refs shared with drag/resize hooks) ---
  const isContinuousScroll = viewMode === 'continuous_scroll';

  // --- Continuous scroll hook (must be called before useLabelGeometry so visiblePageRange is available) ---
  const {
    pageHeights: continuousPageHeights,
    pageYOffsets: continuousPageYOffsets,
    totalHeight: continuousTotalHeight,
    visiblePageRange: continuousVisiblePageRange,
    scrollToPage,
  } = useContinuousScroll({
    numPages, pageScrollContainerRef, setCurrentPageIndex,
    documentPagesToDisplayImageDimensions, zoomLevel, viewerWidth,
    isContinuousScroll,
  });

  const {
    labelGeometry, hasOverhangs,
    allPageGeometries, maxOverhangs,
    scaleCoordinatesToCurrentViewer, scaleCoordinatesFromCurrentViewerToPDF,
    doRectanglesIntersect, getCurrentPageHighlights, findHighlightsAtPoint, hasValidCoordinates,
    scrollContainerRef, contentWrapperRef, sizerRef, measuredCanvasWidthRef,
    labelPlacementMapRef, currentReportRef, currentPageIndexRef, labelGeometryRef,
    labelDragScaleRef, draggedLabelPositionsRef, labelResizeActiveRef,
    containerWidth,
  } = useLabelGeometry({
    currentReport, currentPageIndex, viewerWidth, viewerHeight,
    zoomLevel, setZoomLevel, zoomMode,
    documentPagesToDisplayImageDimensions, checkFilter,
    pendingNewCheck, inlineEditCheckId,
    labelFontScale, pageFontScales, fontFamily,
    showDebug, debugScaleMultiplierX, debugScaleMultiplierY,
    numPages, currentEnvelopeRevision,
    pageScrollContainerRef,
    isContinuousScroll,
    visiblePageRange: continuousVisiblePageRange,
    alignLabelsToTop,
  });

  // --- Extracted drag/resize/panning hooks ---
  const {
    isDraggingHighlight, isResizingHighlight, wasDraggingHighlightRef,
    handleHighlightMouseDown, handleHighlightTouchStart, handleResizeMouseDown, handleResizeTouchStart,
  } = useHighlightDragResize({
    isEditingDisabled, currentReportRef, currentPageIndexRef,
    labelPlacementMapRef, labelGeometryRef,
    scaleCoordinatesToCurrentViewer, scaleCoordinatesFromCurrentViewerToPDF,
    setCurrentReport, updateReportInBothStates, updateCheckInReport, trackSave,
  });

  const {
    draggingLabelId, setDraggingLabelId, dragLabelStartRef,
    isResizingLabel, resizeLabelCheckId, resizeLabelHandle,
    handleLabelResizeMouseDown, handleLabelResizeTouchStart,
  } = useLabelDragResize({
    isEditingDisabled, currentReportRef, currentPageIndexRef,
    labelPlacementMapRef, labelGeometryRef, labelDragScaleRef,
    draggedLabelPositionsRef, labelResizeActiveRef,
    scaleCoordinatesToCurrentViewer, setCurrentReport, updateCheckInReport,
    currentReport, currentPageIndex, zoomLevel,
  });

  const {
    interactionMode, setInteractionMode,
    isManualSelectionMode, setIsManualSelectionMode,
    hoveredCheckId, setHoveredCheckId,
    hoveredElementType, setHoveredElementType,
    isSelecting, setIsSelecting, selectionStart, setSelectionStart, selectionEnd, setSelectionEnd,
    showManualCheckDialog, setShowManualCheckDialog,
    selectedArea, setSelectedArea,
    editingCheckId, setEditingCheckId,
    editingText, setEditingText,
    inlineEditorResizeRef,
    selectedManualCheckRule, setSelectedManualCheckRule,
    isRuleDropdownOpen, setIsRuleDropdownOpen,
    newRuleText, setNewRuleText,
    manualCheckMessage, setManualCheckMessage,
    isMessageManuallyEdited, setIsMessageManuallyEdited,
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
  } = useManualCheckCreation({
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
    getCurrentChecklistId: () => getCurrentChecklistIdRef.current(),
    updateReportInBothStates,
    addCheckToReport,
    updateCheckInReport,
    removeCheckFromReport,
    onEditRuleRequested: () => {
      setChecklistDialogInitialTab("envelope");
      setShowChecklistDialog(true);
    },
    pendingNewCheck,
    setPendingNewCheck,
    inlineEditCheckId,
    setInlineEditCheckId,
    isContinuousScroll,
  });

  const {
    handlePanMouseDown, handlePanMouseMove, handlePanMouseUp,
  } = usePanning({
    pageScrollContainerRef, isManualSelectionMode, isEditingDisabled,
  });

  const {
    showFileRearrangeDialog, setShowFileRearrangeDialog,
    fileRearrangeMode, setFileRearrangeMode,
    quickPickedFiles, setQuickPickedFiles,
    quickFileInputRef,
    isEmptyAreaDragOver, setIsEmptyAreaDragOver,
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
    isUploadingFiles,
  } = useFileManagement({
    currentEnvelope, setCurrentEnvelope,
    currentEnvelopeRevision,
    currentReport, setCurrentReport,
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
  });

  // Auto-load initial files passed via router state (from "Open File" flow)
  const initialFilesLoadedRef = useRef(false);
  const hasPendingInitialFiles = !initialFilesLoadedRef.current &&
    !!((location.state as any)?.initialFiles?.length);
  useEffect(() => {
    if (initialFilesLoadedRef.current) return;
    const initialFiles = (location.state as any)?.initialFiles as File[] | undefined;
    if (initialFiles?.length && currentEnvelope?.id && !isLoadingEnvelope) {
      initialFilesLoadedRef.current = true;
      // Clear router state to prevent re-triggering
      navigate(location.pathname + location.search, { replace: true, state: {} });
      handleFilesSelected(initialFiles);
    }
  }, [currentEnvelope?.id, isLoadingEnvelope, location.state, navigate, location.pathname, location.search, handleFilesSelected]);

  // Ctrl/Cmd + scroll wheel zoom (also handles trackpad pinch on macOS)
  // Uses deltaY magnitude for smooth proportional zoom instead of discrete preset steps
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY === 0) return;
      preMagnifyZoomRef.current = null; magnifyStageRef.current = 0; // clear magnify state on manual zoom
      const scale = Math.pow(2, -e.deltaY / 300);
      setZoomMode('custom');
      setZoomLevel(prev => Math.min(5.0, Math.max(0.25, prev * scale)));
    }
  }, [setZoomLevel, setZoomMode]);

  const hasInputFiles = inputFiles.length > 0;
  useEffect(() => {
    const el = pageScrollContainerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel, hasInputFiles]);

  // TAB + Arrow + j/k keyboard navigation for highlights + Ctrl/Cmd zoom shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const isEditing = !!editingCheckId || !!inlineEditCheckId;
      // Skip non-modifier shortcuts when a dialog is open (checklist editor,
      // AI model selection, script editor, etc.) — these dialogs need Tab,
      // Space, J/K, Z, arrows, etc. for their own inputs and controls.
      const isDialogOpen = !!target.closest('[role="dialog"]');

      // Zoom shortcuts: Ctrl/Cmd + Shift + =/- /0
      // Uses Shift modifier to avoid interfering with browser's default Cmd+/- zoom
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          preMagnifyZoomRef.current = null; magnifyStageRef.current = 0;
          handleZoomIn();
          return;
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          preMagnifyZoomRef.current = null; magnifyStageRef.current = 0;
          handleZoomOut();
          return;
        }
        if (e.key === '0' || e.key === ')') {
          e.preventDefault();
          preMagnifyZoomRef.current = null; magnifyStageRef.current = 0;
          handleZoomSelect('fit-width', zoomLevel, {
            left: labelGeometry.overhangLeft,
            right: labelGeometry.overhangRight,
            top: labelGeometry.overhangTop,
            bottom: labelGeometry.overhangBottom,
          });
          return;
        }
        if (e.key === '9' || e.key === '(') {
          e.preventDefault();
          preMagnifyZoomRef.current = null; magnifyStageRef.current = 0;
          handleZoomSelect('fit-page', zoomLevel, {
            left: labelGeometry.overhangLeft,
            right: labelGeometry.overhangRight,
            top: labelGeometry.overhangTop,
            bottom: labelGeometry.overhangBottom,
          });
          return;
        }
        // Ctrl/Cmd + Shift + R — run review (with confirmation if already reviewed)
        if (e.key === 'R') {
          e.preventDefault();
          if (currentReport?.checks?.length && currentReport.job_status !== ReportJobStatus.CANCELLED) {
            if (!window.confirm('Re-run review? All existing checks will be replaced with new results.')) return;
          }
          handleInspect();
          return;
        }
      }

      // Escape — cancel running review (with confirmation) — works even in dialogs
      if (e.key === 'Escape' && isInspecting && !isCancelling && !isDialogOpen) {
        e.preventDefault();
        if (window.confirm('Cancel the running review? Progress will be saved but remaining pages will not be reviewed.')) {
          handleCancelInspection();
        }
        return;
      }

      // j/k — next/previous check (Gmail-style, only when not typing in an input)
      if ((e.key === 'j' || e.key === 'k') && !isInput && !isEditing && !isDialogOpen) {
        e.preventDefault();
        navigateCheckByDelta(e.key === 'j' ? 1 : -1);
      }

      // z — 3-stage magnify cycle: highlight+label → highlight only → restore
      if ((e.key === 'z' || e.key === 'Z') && !isInput && !isEditing && !isDialogOpen && selectedCheckId && !(e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        magnifySelectedCheck();
      }

      // Only handle TAB when a highlight is selected and not editing
      if (e.key === 'Tab' && selectedCheckId && !isEditing && !isDialogOpen) {
        e.preventDefault();
        navigateCheckByDelta(e.shiftKey ? -1 : 1);
      }

      // Arrow keys — navigate checks (same as Tab/Shift+Tab)
      if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && selectedCheckId && !isEditing && !isInput && !isDialogOpen) {
        e.preventDefault();
        navigateCheckByDelta(1);
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && selectedCheckId && !isEditing && !isInput && !isDialogOpen) {
        e.preventDefault();
        navigateCheckByDelta(-1);
      }

      // Space / Shift+Space — scroll viewport (continuous) or next/prev page (single page)
      // After scrolling, auto-select the first (or last) visible check in the new viewport.
      if (e.key === ' ' && !isInput && !isEditing && !isDialogOpen) {
        e.preventDefault();
        const scrollingUp = e.shiftKey;
        if (isContinuousScroll) {
          const container = pageScrollContainerRef.current;
          if (container) {
            const scrollAmount = container.clientHeight * 0.8;
            container.scrollBy({ top: scrollingUp ? -scrollAmount : scrollAmount, behavior: 'smooth' });

            // After scroll settles, find and select the first/last visible check
            if (currentReport?.checks?.length) {
              setTimeout(() => {
                const c = pageScrollContainerRef.current;
                if (!c) return;
                const vpTop = c.scrollTop;
                const vpBottom = vpTop + c.clientHeight;

                // Compute screen Y for each check and filter to visible ones
                const visible: { check: ICheck; screenY: number }[] = [];
                for (const chk of currentReport.checks) {
                  const pageDims = documentPagesToDisplayImageDimensions[chk.page];
                  if (!pageDims?.original_width) continue;
                  const pageYOff = continuousPageYOffsets[chk.page] || 0;
                  const renderedW = viewerWidth * zoomLevel;
                  const scale = renderedW / pageDims.original_width;
                  const centerY = pageYOff + ((chk.y1 + chk.y2) / 2) * scale;
                  if (centerY >= vpTop && centerY <= vpBottom) {
                    visible.push({ check: chk, screenY: centerY });
                  }
                }
                if (visible.length === 0) return;

                // Sort by Y and pick first (scroll down) or last (scroll up)
                visible.sort((a, b) => a.screenY - b.screenY);
                const pick = scrollingUp ? visible[visible.length - 1] : visible[0];
                setSelectedCheckId(pick.check.id);
                // Sync navigator index
                const navChecks = filterChecks([...currentReport.checks], checkFilter);
                navChecks.sort((a, b) => (a.check_index ?? a.rule_order ?? 0) - (b.check_index ?? b.rule_order ?? 0));
                const idx = navChecks.findIndex(nc => nc.id === pick.check.id);
                if (idx >= 0) setCurrentCheckIndex(idx);
              }, 400);
            }
          }
        } else {
          const target = scrollingUp ? Math.max(0, currentPageIndex - 1) : Math.min((numPages || 1) - 1, currentPageIndex + 1);
          setCurrentPageIndex(target);
        }
      }

      // PageDown / PageUp — next/previous page
      if ((e.key === 'PageDown' || e.key === 'PageUp') && !isInput && !isEditing && !isDialogOpen) {
        e.preventDefault();
        const target = e.key === 'PageUp' ? Math.max(0, currentPageIndex - 1) : Math.min((numPages || 1) - 1, currentPageIndex + 1);
        if (isContinuousScroll) scrollToPage(target);
        else setCurrentPageIndex(target);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedCheckId, currentReport, checkFilter, currentPageIndex, editingCheckId, inlineEditCheckId, handleZoomIn, handleZoomOut, handleZoomSelect, zoomLevel, labelGeometry.overhangLeft, labelGeometry.overhangRight, numPages]);

  // Checklists are now loaded via useChecklistManager hook

  // Load envelope from URL parameter
  useEffect(() => {
    if (envelopeId && !currentEnvelope) {
      const loadEnvelope = async () => {
        setIsLoadingEnvelope(true);
        try {
          // Load envelope and tags in parallel
          const [envelopeResult, tagsResult] = await Promise.allSettled([
            ApiClient.getEnvelope(envelopeId),
            ApiClient.getTagsCached()
          ]);

          if (envelopeResult.status === 'rejected') throw envelopeResult.reason;

          const { envelope } = envelopeResult.value;
          const envelopeWithFiles = {
            ...envelope,
            document_files: envelope.document_files || [],
            envelope_revisions: envelope.envelope_revisions || []
          };

          setCurrentEnvelope(envelopeWithFiles);

          // Set report and checklist selection immediately (avoids multi-render delay
          // where the dropdown renders without a matching option for the snapshot ID)
          const revIdx = envelopeWithFiles.current_revision_index ?? envelopeWithFiles.envelope_revisions.length - 1;
          const loadedRevision = envelopeWithFiles.envelope_revisions[revIdx];
          if (loadedRevision?.report) {
            if (import.meta.env.DEV) console.debug('Envelope load: report found', { job_status: loadedRevision.report.job_status, checklist_id: loadedRevision.report.checklist_id, checks: loadedRevision.report.checks?.length });
            setCurrentReport(loadedRevision.report);
            if (loadedRevision.report.checklist_id) {
              setSelectedChecklistId(loadedRevision.report.checklist_id);
            }
          } else if (revIdx > 0) {
            const prevRevision = envelopeWithFiles.envelope_revisions[revIdx - 1];
            if (prevRevision?.report?.checklist_id) {
              setSelectedChecklistId("use-previous");
            }
          }

          if (tagsResult.status === 'fulfilled') {
            setAvailableTags(tagsResult.value.tags || []);
          }

        } catch (err) {
          console.error('Error loading envelope:', err);
          if (err instanceof ApiError && err.statusCode === 404) {
            showToast('Envelope not found', 'error');
            navigate('/envelopes/', { replace: true });
            return;
          }
          const errorMessage = err instanceof Error ? err.message : 'Failed to load envelope';
          setError(errorMessage);
        } finally {
          setIsLoadingEnvelope(false);
        }
      };
      loadEnvelope();
    }
  }, [envelopeId, currentEnvelope, retryCounter]);

  // Auto-create envelope when navigating without an ID (e.g. direct /envelopes/view URL)
  useEffect(() => {
    if (!envelopeId && !currentEnvelope && !isLoadingEnvelope) {
      const createAndRedirect = async () => {
        setIsLoadingEnvelope(true);
        try {
          const { envelope: created } = await ApiClient.createEnvelope({});
          navigate(`/envelopes/view?id=${created.id}`, { replace: true });
        } catch (err) {
          console.error('Failed to create envelope:', err);
          setError(err instanceof Error ? err.message : 'Failed to create envelope');
          setIsLoadingEnvelope(false);
        }
      };
      createAndRedirect();
    }
  }, [envelopeId]);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setCurrentPageIndex(0);
  }, []);

  const onDocumentLoadError = useCallback((error: Error) => {
    console.debug("onDocumentLoadError:", error);
    setError(`Failed to load PDF: ${error.message}`);
  }, []);

  // Load versions for selected checklist when dialog opens
  useEffect(() => {
    const loadVersions = async () => {
      if (selectedChecklist && showChecklistDialog) {
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
  }, [selectedChecklist?.id, showChecklistDialog]);

  // Get page dimensions when the page renders
  const handlePageRenderSuccess = (page: any) => {
    if (!page) return;
    const pageIndex = page.pageNumber - 1;
    // Get pdfjs original dimensions (same library the doc-api uses)
    const originalViewport = page.getViewport({ scale: 1 });
    const pdfjs_original_width = originalViewport.width;
    const pdfjs_original_height = originalViewport.height;

    if (import.meta.env.DEV && showDebug) {
      console.debug(
        `[HIGHLIGHT-DEBUG] onRender page ${pageIndex}: ` +
        `pdfJs_viewport=(${pdfjs_original_width}x${pdfjs_original_height}), ` +
        `rendered=(${page.width}x${page.height}), ` +
        `scaleFactor=${page.width / pdfjs_original_width}`,
      );
    }
    // Measure the actual canvas CSS width (ground truth for coordinate scaling).
    // react-pdf's <Page width=W> may produce a canvas whose clientWidth differs
    // from W due to DPR rounding, sub-pixel layout, etc.
    setTimeout(() => {
      // In continuous mode, find canvas within the specific page container; in single-page, use contentWrapperRef
      const canvas = isContinuousScroll
        ? (pageScrollContainerRef.current?.querySelector(`[data-page-index="${pageIndex}"] canvas`) as HTMLCanvasElement | null)
        : contentWrapperRef.current?.querySelector('canvas');
      if (canvas) {
        measuredCanvasWidthRef.current.set(pageIndex, canvas.clientWidth);
        if (import.meta.env.DEV) {
          const requestedWidth = viewerWidth * zoomLevel;
          const cssWidth = canvas.clientWidth;
          if (Math.abs(requestedWidth - cssWidth) > 0.5) {
            console.debug(
              `[COORD-DIAG] page ${pageIndex}: requested=${requestedWidth.toFixed(1)}, ` +
              `canvasCSS=${cssWidth}, ratio=${(requestedWidth / cssWidth).toFixed(6)}, ` +
              `DPR=${window.devicePixelRatio}, orig_w=${pdfjs_original_width}`
            );
          }
        }
      }
      setDocumentPagesToDisplayImageDimensions(prev => {
        if (pageIndex < 0 || pageIndex >= prev.length) return prev;
        const entry = prev[pageIndex];

        // Skip update if dimensions haven't changed (avoid unnecessary re-renders)
        if (entry.width === page.width && entry.height === page.height
          && entry.original_width === pdfjs_original_width
          && entry.original_height === pdfjs_original_height) return prev;
        const updated = [...prev];
        updated[pageIndex] = {
          ...entry,
          width: page.width,
          height: page.height,
          original_width: pdfjs_original_width,
          original_height: pdfjs_original_height,
        };
        return updated;
      });
    }, 50);

    // Restore scroll position from localStorage once after first page render
    if (!scrollRestoredRef.current && currentEnvelope?.id) {
      scrollRestoredRef.current = true;
      // Use 150ms delay so the zoom-center layoutEffect runs first
      setTimeout(() => {
        requestAnimationFrame(() => {
          try {
            const stored = localStorage.getItem(`revdoku_viewer_${currentEnvelope.id}`);
            if (stored) {
              const parsed = JSON.parse(stored);
              const el = pageScrollContainerRef.current;
              if (isContinuousScroll && typeof parsed.currentPageIndex === 'number') {
                // In continuous mode, scroll to the saved page instead of raw scrollTop
                scrollToPage(parsed.currentPageIndex);
              } else if (el && typeof parsed.scrollTop === 'number') {
                el.scrollTop = parsed.scrollTop;
                el.scrollLeft = parsed.scrollLeft || 0;
              }
            }
          } catch { /* ignore */ }
        });
      }, 150);
    }
  };



  // Unified editability state - single source of truth for all lock/editability flags
  const editability = useMemo(() => getEditabilityState({
    currentRevision: currentEnvelopeRevision,
    currentReport,
    previousReport,
    currentChecklist,
    isReadOnlyRevision,
    isEnvelopeArchived: !!currentEnvelope?.archived_at,
    isInspecting,
  }), [currentEnvelopeRevision, currentReport, previousReport, currentChecklist, isReadOnlyRevision, currentEnvelope?.archived_at, isInspecting]);

  // Destructure for backward compatibility with existing references
  const { isFirstRevision, isChecklistLocked, lockedChecklistId, isSnapshotChecklist } = editability;

  // Check if the current checklist version matches the report's checklist
  const isChecklistVersionMismatch = currentReport?.checklist_id && currentChecklist
    && currentReport.checklist_id !== currentChecklist.id
    && !(isFirstRevision && !isReadOnlyRevision);

  const getCurrentChecklistId = (): string | null => {
    // For viewing historical revisions with existing reports, always use the report's checklist
    if (isReadOnlyRevision && currentReport?.checklist_id) {
      return currentReport.checklist_id;
    }

    // For 2nd+ revisions, use locked checklist for consistency
    if (isChecklistLocked && lockedChecklistId) {
      return lockedChecklistId;
    }

    // For the latest revision (first revision), allow manual selection
    return getUISelectedChecklistId();
  };
  // Keep the ref in sync so useInspection event handlers can call it
  getCurrentChecklistIdRef.current = getCurrentChecklistId;

  const getUISelectedChecklistId = (): string | null => {
    // No checklist selected yet
    if (selectedChecklistId === "please-select") {
      return null;
    }

    // Handle "use-previous" option - use checklist from previous revision
    if (selectedChecklistId === "use-previous" && previousReport?.checklist_id) {
      return previousReport.checklist_id;
    }

    // Handle auto-detect - default to previous checklist if available, otherwise use latest
    if (selectedChecklistId === "auto-detect") {
      if (previousReport?.checklist_id) {
        return previousReport.checklist_id;
      }
      if (checklists.length > 0) {
        return (checklists[checklists.length - 1] as IChecklist).id;
      }
    }

    // Handle specific checklist selection
    if (selectedChecklistId !== "auto-detect" && selectedChecklistId !== "use-previous") {
      // If it's the current report's snapshot ID, return it directly (re-inspect same checklist)
      if (currentReport?.checklist_id === selectedChecklistId) {
        return selectedChecklistId;
      }
      const selectedChecklistFound: IChecklist | undefined = checklists.find((c) => c.id === selectedChecklistId);
      if (!selectedChecklistFound) {
        if (import.meta.env.DEV) console.debug(`Selected checklist ${selectedChecklistId} not found in templates`);
        // Fall back to previous or latest
        if (previousReport?.checklist_id) {
          return previousReport.checklist_id;
        }
        if (checklists.length > 0) {
          return (checklists[checklists.length - 1] as IChecklist).id;
        }
      }
      return selectedChecklistFound?.id || null;
    }

    return null;
  };

  const loadCurrentChecklist = async () => {
    try {
      // If report has embedded checklist from inspection_context, use it directly (frozen snapshot)
      if (currentReport?.checklist) {
        if (import.meta.env.DEV) console.debug('Using embedded checklist from inspection_context');
        setCurrentChecklist(currentReport.checklist as IChecklist);
        return;
      }

      // First revision OR no report: load the selected checklist (template)
      const checklistId = getCurrentChecklistId();
      if (checklistId) {
        if (import.meta.env.DEV) console.debug(`Loading selected checklist: ${checklistId}`);
        const { checklist } = await ApiClient.getChecklist(checklistId);
        setCurrentChecklist(checklist);
      } else {
        setCurrentChecklist(null);
      }
    } catch (error) {
      console.error("Failed to load full checklist:", error);
      setCurrentChecklist(null);
    }
  };

  // Auto-select checklist based on context
  useEffect(() => {
    // When viewing a historical revision with a report, don't change the selection
    if (isReadOnlyRevision && currentReport?.checklist_id) {
      return;
    }

    // Auto-select current report's checklist when it exists
    // Always select the snapshot ID — dropdown shows it under "Current inspection"
    if ((selectedChecklistId === "auto-detect" || selectedChecklistId === "please-select")
      && currentReport?.checklist_id) {
      setSelectedChecklistId(currentReport.checklist_id);
      return;
    }

    // For new revisions, auto-select based on previous report
    if ((selectedChecklistId === "auto-detect" || selectedChecklistId === "please-select") && previousReport?.checklist_id) {
      // Auto-select "use-previous" when there's a previous report
      setSelectedChecklistId("use-previous");
      return;
    }

    // Fallback: if no reports exist but envelope has a last_checklist_id hint (e.g. from duplication)
    if (selectedChecklistId === "auto-detect" && !currentReport && !previousReport && currentEnvelope?.report_settings?.last_checklist_id) {
      const hintId = currentEnvelope.report_settings.last_checklist_id;
      const found = checklists.find(c => c.id === hintId);
      if (found) {
        setSelectedChecklistId(hintId);
      }
    }
  }, [previousReport?.checklist_id, isReadOnlyRevision, currentReport?.checklist_id, selectedChecklistId, isFirstRevision, currentReport?.source_checklist_id, checklists, currentEnvelope?.report_settings?.last_checklist_id]);

  // Load full checklist when checklist ID changes or report changes
  useEffect(() => {
    loadCurrentChecklist();
  }, [currentReport?.checklist_id, selectedChecklistId, isFirstRevision, currentEnvelopeRevision, checklists]);


  // Handle clicking on a check item to highlight the corresponding area
  const handleCheckClick = (id: string) => {
    // find checkresult by id
    const checkResult = currentReport?.checks?.find((c) => c.id === id);
    if (checkResult) {
      // find page index by page number
      const pageIndex: number = checkResult.page;
      if (isContinuousScroll) {
        scrollToPage(pageIndex);
      } else {
        setCurrentPageIndex(pageIndex);
      }
    }
    setSelectedCheckId(id === selectedCheckId ? null : id);
    // Reset overlapping highlights when selecting from sidebar
    setOverlappingHighlights([]);
    setCurrentOverlapIndex(0);

    // Sync check navigator index
    if (currentReport) {
      const navigableChecks = filterChecks([...currentReport.checks], checkFilter)
        .sort((a, b) => (a.check_index ?? a.rule_order ?? 0) - (b.check_index ?? b.rule_order ?? 0));
      const idx = navigableChecks.findIndex((c) => c.id === id);
      if (idx >= 0) setCurrentCheckIndex(idx);
    }
  };

  // Navigate to a check by index in the navigator
  const navigateToCheck = (index: number) => {
    if (!currentReport) return;
    const navigableChecks = filterChecks([...currentReport.checks], checkFilter)
      .sort((a, b) => (a.check_index ?? a.rule_order ?? 0) - (b.check_index ?? b.rule_order ?? 0));
    if (index < 0 || index >= navigableChecks.length) return;
    const check = navigableChecks[index];
    setCurrentCheckIndex(index);
    setSelectedCheckId(check.id);
    if (isContinuousScroll) {
      scrollToPage(check.page);
    } else {
      setCurrentPageIndex(check.page);
    }
    setOverlappingHighlights([]);
    setCurrentOverlapIndex(0);
    scrollToCheck(check);
  };

  // Scroll the viewer so a check's highlight is centered vertically
  // Helper: scroll container to center on a highlight at a given zoom, computed analytically.
  // Uses document coordinates so it works correctly even right after a zoom change.
  const scrollToCheckAtZoom = (check: ICheck, targetZoom: number, behavior: ScrollBehavior = 'smooth') => {
    const container = pageScrollContainerRef.current;
    if (!container) return;
    const pageDims = documentPagesToDisplayImageDimensions[check.page];
    if (!pageDims || !pageDims.original_width) return;

    const newScale = (viewerWidth * targetZoom) / pageDims.original_width;
    const hlCenterX = ((check.x1 + check.x2) / 2) * newScale;
    const hlCenterY = ((check.y1 + check.y2) / 2) * newScale;
    const vpW = container.clientWidth;
    const vpH = container.clientHeight;

    if (isContinuousScroll) {
      // Recompute page Y offset analytically at new zoom
      const renderedWidth = viewerWidth * targetZoom;
      let pageYOffset = 0;
      for (let i = 0; i < check.page; i++) {
        const d = documentPagesToDisplayImageDimensions[i];
        const ph = (d && d.original_width && d.original_height)
          ? (d.original_height / d.original_width) * renderedWidth
          : renderedWidth * 1.294;
        pageYOffset += ph + PAGE_GAP;
      }
      container.scrollTo({
        top: Math.max(0, pageYOffset + hlCenterY - vpH / 2),
        left: Math.max(0, hlCenterX - vpW / 2),
        behavior,
      });
    } else {
      container.scrollTo({
        top: Math.max(0, hlCenterY - vpH / 2),
        left: Math.max(0, hlCenterX - vpW / 2),
        behavior,
      });
    }
  };

  // Z key: 3-stage magnify cycle on the selected check.
  //   Stage 0 → 1: zoom to fit highlight + label at ~95% viewport
  //   Stage 1 → 2: zoom to fit highlight only (deeper zoom, label may clip)
  //   Stage 2 → 0: restore the original pre-magnify zoom
  // Uses double-rAF to scroll AFTER React has re-rendered at the new zoom.
  const magnifySelectedCheck = useCallback(() => {
    if (!selectedCheckId || !currentReport) return;
    const check = currentReport.checks.find(c => c.id === selectedCheckId);
    if (!check) return;

    const applyZoomAndScroll = (targetZoom: number) => {
      setZoomLevel(targetZoom);
      setZoomMode('custom');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const container = pageScrollContainerRef.current;
          if (!container) return;
          const pd = documentPagesToDisplayImageDimensions[check.page];
          if (!pd?.original_width) return;

          const newScale = (viewerWidth * targetZoom) / pd.original_width;
          let minX = check.x1 * newScale, maxX = check.x2 * newScale;
          let minY = check.y1 * newScale, maxY = check.y2 * newScale;

          const lp = labelPlacementMapRef.current.get(check.id);
          if (lp) {
            minX = Math.min(minX, lp.labelBox.x);
            maxX = Math.max(maxX, lp.labelBox.x + lp.labelBox.width);
            minY = Math.min(minY, lp.labelBox.y);
            maxY = Math.max(maxY, lp.labelBox.y + lp.labelBox.height);
          }

          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          const vpW = container.clientWidth;
          const vpH = container.clientHeight;

          if (isContinuousScroll) {
            const renderedWidth = viewerWidth * targetZoom;
            let pageYOffset = 0;
            for (let i = 0; i < check.page; i++) {
              const d = documentPagesToDisplayImageDimensions[i];
              const ph = (d?.original_width && d?.original_height)
                ? (d.original_height / d.original_width) * renderedWidth
                : renderedWidth * 1.294;
              pageYOffset += ph + PAGE_GAP;
            }
            container.scrollTo({
              top: Math.max(0, pageYOffset + centerY - vpH / 2),
              left: Math.max(0, centerX - vpW / 2),
              behavior: 'instant',
            });
          } else {
            container.scrollTo({
              top: Math.max(0, centerY - vpH / 2),
              left: Math.max(0, centerX - vpW / 2),
              behavior: 'instant',
            });
          }
        });
      });
    };

    const computeTargetZoom = (includeLabel: boolean): number => {
      const container = pageScrollContainerRef.current;
      if (!container) return zoomLevel;
      const pageDims = documentPagesToDisplayImageDimensions[check.page];
      if (!pageDims?.original_width) return zoomLevel;

      const actualRenderedWidth = measuredCanvasWidthRef.current.get(check.page) ?? (viewerWidth * zoomLevel);
      const scale = pageDims.original_width > 0 ? actualRenderedWidth / pageDims.original_width : 1;

      let boundsW: number, boundsH: number;
      if (includeLabel) {
        let minX = check.x1 * scale, maxX = check.x2 * scale;
        let minY = check.y1 * scale, maxY = check.y2 * scale;
        const lp = labelPlacementMapRef.current.get(check.id);
        if (lp) {
          minX = Math.min(minX, lp.labelBox.x);
          maxX = Math.max(maxX, lp.labelBox.x + lp.labelBox.width);
          minY = Math.min(minY, lp.labelBox.y);
          maxY = Math.max(maxY, lp.labelBox.y + lp.labelBox.height);
        }
        boundsW = maxX - minX;
        boundsH = maxY - minY;
      } else {
        boundsW = (check.x2 - check.x1) * scale;
        boundsH = (check.y2 - check.y1) * scale;
      }

      if (boundsW <= 0 || boundsH <= 0) return zoomLevel;
      const PAD = 20;
      const fillRatioW = (boundsW + PAD * 2) / viewerWidth;
      const fillRatioH = (boundsH + PAD * 2) / viewerHeight;
      const fillRatio = Math.max(fillRatioW, fillRatioH);
      return Math.min(5.0, Math.max(0.25, zoomLevel * (0.95 / fillRatio)));
    };

    const stage = magnifyStageRef.current;

    if (stage === 0) {
      // Stage 0 → 1: zoom to fit highlight + label
      preMagnifyZoomRef.current = zoomLevel;
      magnifyStageRef.current = 1;
      applyZoomAndScroll(computeTargetZoom(true));
    } else if (stage === 1) {
      // Stage 1 → 2: zoom to fit highlight only (deeper)
      magnifyStageRef.current = 2;
      applyZoomAndScroll(computeTargetZoom(false));
    } else {
      // Stage 2 → 0: restore original zoom
      const restoreZoom = preMagnifyZoomRef.current ?? zoomLevel;
      preMagnifyZoomRef.current = null; magnifyStageRef.current = 0;
      magnifyStageRef.current = 0;
      applyZoomAndScroll(restoreZoom);
    }
  }, [selectedCheckId, currentReport, zoomLevel, viewerWidth, viewerHeight, documentPagesToDisplayImageDimensions, isContinuousScroll]);

  const scrollToCheck = (check: ICheck) => {
    requestAnimationFrame(() => {
      const container = pageScrollContainerRef.current;
      if (!container) return;
      const pageDims = documentPagesToDisplayImageDimensions[check.page];
      if (!pageDims) return;

      const actualRenderedWidth = measuredCanvasWidthRef.current.get(check.page) ?? (viewerWidth * zoomLevel);
      const scale = pageDims.original_width > 0 ? actualRenderedWidth / pageDims.original_width : 1;
      const hlY1 = check.y1 * scale;
      const hlY2 = check.y2 * scale;
      const hlX1 = check.x1 * scale;
      const hlX2 = check.x2 * scale;

      // Include label bounds so both highlight and label are visible
      let minY = hlY1, maxY = hlY2, minX = hlX1, maxX = hlX2;
      const lp = labelPlacementMapRef.current.get(check.id);
      if (lp) {
        minY = Math.min(minY, lp.labelBox.y);
        maxY = Math.max(maxY, lp.labelBox.y + lp.labelBox.height);
        minX = Math.min(minX, lp.labelBox.x);
        maxX = Math.max(maxX, lp.labelBox.x + lp.labelBox.width);
      }

      const vpW = container.clientWidth;
      const vpH = container.clientHeight;
      const boundsW = maxX - minX;
      const boundsH = maxY - minY;
      const PAD = 40;

      // Check if auto-zoom is needed
      if (boundsW > 0 && boundsH > 0) {
        const fillRatioW = (boundsW + PAD * 2) / vpW;
        const fillRatioH = (boundsH + PAD * 2) / vpH;
        const fillRatio = Math.max(fillRatioW, fillRatioH);

        if (fillRatio > 1.02) {
          // Bounds overflow viewport — zoom out to fit
          const newZoom = Math.max(0.20, zoomLevel / fillRatio);
          if (newZoom < zoomLevel * 0.95) {
            setZoomLevel(newZoom);
            setZoomMode('custom');
            setTimeout(() => scrollToCheckAtZoom(check, newZoom), 100);
            return;
          }
        } else if (fillRatio < 0.55) {
          // Bounds use less than 55% of viewport — zoom in to fill ~75%
          const newZoom = Math.min(5.0, zoomLevel * (0.75 / fillRatio));
          if (newZoom > zoomLevel * 1.08) {
            setZoomLevel(newZoom);
            setZoomMode('custom');
            setTimeout(() => scrollToCheckAtZoom(check, newZoom), 100);
            return;
          }
        }
      }

      // No zoom change needed — center on combined bounds or highlight
      let centerX: number, centerY: number;
      if (boundsW <= vpW && boundsH <= vpH) {
        centerX = (minX + maxX) / 2;
        centerY = (minY + maxY) / 2;
      } else {
        // Fallback: center on highlight, shift toward label
        const hlCenterX = (hlX1 + hlX2) / 2;
        const hlCenterY = (hlY1 + hlY2) / 2;
        centerX = hlCenterX;
        centerY = hlCenterY;
        const pad = 20;
        if (lp) {
          const vLeft = hlCenterX - vpW / 2;
          const vRight = vLeft + vpW;
          const lblRight = lp.labelBox.x + lp.labelBox.width;
          if (lblRight > vRight) {
            const shift = Math.min(lblRight - vRight, hlX1 - vLeft - pad);
            if (shift > 0) centerX += shift;
          } else if (lp.labelBox.x < vLeft) {
            const shift = Math.min(vLeft - lp.labelBox.x, vRight - hlX2 - pad);
            if (shift > 0) centerX -= shift;
          }
          const vTop = hlCenterY - vpH / 2;
          const vBottom = vTop + vpH;
          const lblBottom = lp.labelBox.y + lp.labelBox.height;
          if (lblBottom > vBottom) {
            const shift = Math.min(lblBottom - vBottom, hlY1 - vTop - pad);
            if (shift > 0) centerY += shift;
          } else if (lp.labelBox.y < vTop) {
            const shift = Math.min(vTop - lp.labelBox.y, vBottom - hlY2 - pad);
            if (shift > 0) centerY -= shift;
          }
        }
      }

      if (isContinuousScroll) {
        const pageYOffset = continuousPageYOffsets[check.page] || 0;
        const targetScrollTop = pageYOffset + centerY - vpH / 2;
        const targetScrollLeft = maxOverhangs.left + centerX - vpW / 2;
        container.scrollTo({
          top: Math.max(0, targetScrollTop),
          left: Math.max(0, targetScrollLeft),
          behavior: 'smooth',
        });
      } else {
        const targetScrollTop = labelGeometry.overhangTop + centerY - vpH / 2;
        const targetScrollLeft = labelGeometry.overhangLeft + centerX - vpW / 2;
        container.scrollTo({
          top: Math.max(0, targetScrollTop),
          left: Math.max(0, targetScrollLeft),
          behavior: 'smooth',
        });
      }
    });
  };

  // Handle starting a drag on a margin label
  const handleLabelDragStart = (e: React.MouseEvent, checkId: string, labelX: number, labelY: number) => {
    if (isResizingLabel || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDraggingLabelId(checkId);
    dragLabelStartRef.current = { x: e.clientX, y: e.clientY, startLabelX: labelX, startLabelY: labelY };
  };

  // Handle starting a touch drag on a margin label — requires long-press (300ms hold)
  // to distinguish from scroll gestures on touch screens
  const touchLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleLabelTouchDragStart = (e: React.TouchEvent, checkId: string, labelX: number, labelY: number) => {
    if (isResizingLabel) return;
    const touch = e.touches[0];
    if (!touch) return;
    const startX = touch.clientX;
    const startY = touch.clientY;

    // Don't preventDefault yet — allow scrolling during the long-press delay
    const cancelLongPress = () => {
      if (touchLongPressTimerRef.current) {
        clearTimeout(touchLongPressTimerRef.current);
        touchLongPressTimerRef.current = null;
      }
      document.removeEventListener('touchmove', onMoveCancel);
      document.removeEventListener('touchend', cancelLongPress);
    };
    // Cancel if finger moves more than 10px (user is scrolling)
    const onMoveCancel = (ev: TouchEvent) => {
      const t = ev.touches[0];
      if (t && (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10)) {
        cancelLongPress();
      }
    };
    document.addEventListener('touchmove', onMoveCancel, { passive: true });
    document.addEventListener('touchend', cancelLongPress, { once: true });

    touchLongPressTimerRef.current = setTimeout(() => {
      touchLongPressTimerRef.current = null;
      document.removeEventListener('touchmove', onMoveCancel);
      document.removeEventListener('touchend', cancelLongPress);
      // Long-press confirmed — start drag
      setDraggingLabelId(checkId);
      dragLabelStartRef.current = { x: startX, y: startY, startLabelX: labelX, startLabelY: labelY };
    }, 300);
  };

  // Handle clicking on highlights in the document viewer with overlap cycling
  const handleHighlightClick = (
    e: React.MouseEvent,
    clickedCheckId: string,
  ) => {
    e.stopPropagation();
    if (wasDraggingHighlightRef.current || isResizingHighlight) return;

    // Get click position relative to the document viewer
    const viewerContainer = document.querySelector(
      '[data-document-viewer="true"]',
    ) as HTMLElement;
    if (!viewerContainer) return;

    const rect = viewerContainer.getBoundingClientRect();
    const clickPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    // Find all highlights at this point
    const highlightsAtPoint = findHighlightsAtPoint(clickPoint, currentPageIndex);
    const highlightIds = highlightsAtPoint.map((h) => h.id);

    // Helper to sync navigator index when a check is selected
    const syncNavigatorIndex = (checkId: string) => {
      if (currentReport) {
        const navChecks = filterChecks([...currentReport.checks], checkFilter)
          .sort((a, b) => (a.check_index ?? a.rule_order ?? 0) - (b.check_index ?? b.rule_order ?? 0));
        const idx = navChecks.findIndex((c) => c.id === checkId);
        if (idx >= 0) setCurrentCheckIndex(idx);
      }
    };

    if (highlightIds.length <= 1) {
      // Single or no highlight - normal behavior
      const newId = clickedCheckId === selectedCheckId ? null : clickedCheckId;
      setSelectedCheckId(newId);
      if (newId) syncNavigatorIndex(newId);
      setOverlappingHighlights([]);
      setCurrentOverlapIndex(0);
    } else {
      // Multiple overlapping highlights - cycle through them
      if (
        overlappingHighlights.length === 0 ||
        !arraysEqual(overlappingHighlights, highlightIds)
      ) {
        // First click or different set of overlapping highlights
        setOverlappingHighlights(highlightIds);
        setCurrentOverlapIndex(0);
        setSelectedCheckId(highlightIds[0]);
        syncNavigatorIndex(highlightIds[0]);
      } else {
        // Subsequent clicks - cycle through overlapping highlights
        const nextIndex = (currentOverlapIndex + 1) % highlightIds.length;
        setCurrentOverlapIndex(nextIndex);
        setSelectedCheckId(highlightIds[nextIndex]);
        syncNavigatorIndex(highlightIds[nextIndex]);
      }
    }
  };

  // Helper function to compare arrays
  const arraysEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, i) => val === sortedB[i]);
  };

  // formatReportAsText, generateReport, updateReportOption — moved to useReportOptions hook


  // Determine the checklist to view directly from UI state,
  // bypassing getCurrentChecklistId() which is designed for inspection logic
  const handleViewChecklist = async () => {
    justCreatedRef.current = null;
    setJustCreatedChecklistId(null); // Not a newly created checklist
    try {
      // If current report has inspection_context, show the frozen checklist from it (read-only)
      if (currentReport?.checklist) {
        setSelectedChecklist(currentReport.checklist);
        setShowChecklistDialog(true);
        return;
      }

      // No report yet — try to load the selected template checklist
      let checklistIdToView: string | null = null;

      const isRealSelection = selectedChecklistId
        && selectedChecklistId !== "auto-detect"
        && selectedChecklistId !== "please-select"
        && selectedChecklistId !== "use-previous";

      if (isChecklistLocked && lockedChecklistId) {
        checklistIdToView = lockedChecklistId;
      } else if (isRealSelection) {
        checklistIdToView = selectedChecklistId;
      } else if (selectedChecklistId === "use-previous" && previousReport?.checklist_id) {
        checklistIdToView = previousReport.checklist_id;
      }

      if (!checklistIdToView) {
        // No checklist but have envelope rules — open in envelope-rules-only mode
        if (envelopeUserRules.length > 0) {
          setSelectedChecklist(null);
          setShowChecklistDialog(true);
          return;
        }
        if (import.meta.env.DEV) console.debug('No checklist selected to view');
        return;
      }

      const { checklist } = await ApiClient.getChecklist(checklistIdToView);
      setSelectedChecklist(checklist);
      setShowChecklistDialog(true);
    } catch (error) {
      console.error('Failed to load checklist:', error);
      // Fallback: try local list
      const fallbackId = isChecklistLocked ? lockedChecklistId : selectedChecklistId;
      if (fallbackId) {
        const checklist = checklists.find(c => c.id === fallbackId) || null;
        if (checklist) {
          setSelectedChecklist(checklist);
          setShowChecklistDialog(true);
        }
      }
    }
  };

  // Jump from a check in the overlay to the originating rule in the SOURCE
  // template checklist (the live one in the account library), not the
  // frozen snapshot on the report. The source_checklist_id comes from the
  // report's inspection_context — edits the user makes here do NOT
  // retroactively change this report's checks; they need to re-run review
  // to see the effect.
  const handleEditChecklistRule = async (ruleId: string) => {
    const sourceId = (currentReport as any)?.source_checklist_id as string | undefined;
    if (!sourceId) {
      console.debug('[edit-source-rule] no source_checklist_id on report');
      return;
    }
    try {
      const { checklist } = await ApiClient.getChecklist(sourceId);
      closeInlineEditor();
      justCreatedRef.current = null;
      setJustCreatedChecklistId(null);
      setSelectedChecklist(checklist);
      setChecklistDialogInitialTab("checklist");
      setChecklistDialogFocusRuleId(ruleId);
      setShowChecklistDialog(true);
    } catch (err) {
      console.error('Failed to load source checklist for rule edit:', err);
    }
  };

  const handleCloseChecklistDialog = async () => {
    const unsavedId = justCreatedRef.current;
    if (unsavedId) {
      try { await deleteChecklist(unsavedId); } catch { }
    }
    const shouldReopenReviewDialog = !unsavedId && reopenReviewDialogRef.current;
    // Preserve the checklist selection for the review dialog when reopening
    if (shouldReopenReviewDialog && selectedChecklist?.id) {
      reviewDialogChecklistIdRef.current = selectedChecklist.id;
    }
    justCreatedRef.current = null;
    setJustCreatedChecklistId(null);
    setShowChecklistDialog(false);
    setSelectedChecklist(null);
    setChecklistDialogFocusRuleId(undefined);
    openedFromReviewDialogRef.current = false;
    reopenReviewDialogRef.current = false;
    // Reopen review dialog after saving a new checklist so user can select it
    if (shouldReopenReviewDialog) {
      setSelectAIDialogState({});
    }
  };

  // Intercept "new_revision" to prompt review if current revision has no report
  const handleNewRevisionOrReview = () => {
    // Block if current revision has no completed AI review (no checklist in report = no inspection_context)
    const hasCompletedReview = currentReport?.checklist?.name;
    if (!hasCompletedReview && currentEnvelopeRevision) {
      const runReview = window.confirm(
        'The current revision has not been reviewed yet.\n\nWould you like to run a review first?'
      );
      if (runReview) {
        setSelectAIDialogState({});
      }
      return; // Either way, don't open new revision dialog
    }
    handleOpenFileRearrangeDialog('new_revision');
  };

  const handleSaveChecklist = async (checklist: IChecklist) => {
    await saveChecklist(checklist);
    // Reopen review dialog if just-created OR if opened from review dialog's "View" link
    reopenReviewDialogRef.current = !!justCreatedRef.current || openedFromReviewDialogRef.current;
    justCreatedRef.current = null; // Clear synchronously so onClose reads correct value
    setJustCreatedChecklistId(null); // Saved — don't delete on close
  };

  const handleDeleteChecklist = async (id: string) => {
    await deleteChecklist(id);
  };

  const handleSaveEnvelopeRules = async (rules: IRule[]) => {
    if (!currentEnvelopeRevision?.id) return;

    const revisionId = currentEnvelopeRevision.id;

    // Current revision's existing revision_rules (only these are editable)
    const currentRevCustomRules = currentEnvelopeRevision.revision_rules || [];
    const currentRevRuleIds = new Set(currentRevCustomRules.map((r: any) => r.id).filter(Boolean));

    // Detect new rules (have _localKey, no id — these are brand new)
    const newRules = rules.filter((r: any) => r._localKey && !r.id);

    // Detect deleted rules: current revision rules that are no longer in the incoming set
    const incomingRuleIds = new Set(rules.map((r: any) => r.id).filter(Boolean));
    const deletedRuleIds = currentRevCustomRules
      .filter((r: any) => r.id && !incomingRuleIds.has(r.id))
      .map((r: any) => r.id);

    // Detect edited rules: current revision rules whose prompt changed
    const existingRulesById = new Map(currentRevCustomRules.map((r: any) => [r.id, r]));
    const editedRules = rules.filter((r: any) => {
      if (!r.id || !currentRevRuleIds.has(r.id)) return false;
      const orig = existingRulesById.get(r.id);
      return orig && orig.prompt !== r.prompt;
    });

    if (newRules.length === 0 && deletedRuleIds.length === 0 && editedRules.length === 0) return;

    let updatedRevision: any = null;

    if (deletedRuleIds.length > 0) {
      const result = await ApiClient.removeRevisionCustomRules(revisionId, deletedRuleIds);
      updatedRevision = result.envelope_revision;
    }

    if (editedRules.length > 0) {
      const result = await ApiClient.updateRevisionCustomRules(
        revisionId,
        editedRules.map((r: any) => ({ id: r.id, prompt: r.prompt }))
      );
      updatedRevision = result.envelope_revision;
    }

    if (newRules.length > 0) {
      const result = await ApiClient.addRevisionCustomRules(
        revisionId,
        newRules.map(r => ({ prompt: r.prompt }))
      );
      updatedRevision = result.envelope_revision;
    }

    // Update local state with the revision's updated revision_rules
    if (updatedRevision && currentEnvelope) {
      const updatedRevisions = (currentEnvelope.envelope_revisions || []).map((rev: any) =>
        rev.id === revisionId ? { ...rev, revision_rules: updatedRevision.revision_rules } : rev
      );
      setCurrentEnvelope({ ...currentEnvelope, envelope_revisions: updatedRevisions });
    }
  };

  // --- User JS Script 1 ---
  // Restore persisted output when report changes
  useEffect(() => {
    const output = currentReport?.user_scripts_output?.[0];
    if (output?.template && output?.data) {
      setUserJsOutputHtml1(renderMustache(output.template, output.data));
      setUserJsScript1Data(output.data as Record<string, unknown>);
    } else {
      setUserJsOutputHtml1(null);
      setUserJsScript1Data(null);
    }
  }, [currentReport?.id, currentReport?.user_scripts_output]);

  // Auto-run script when inspection completes successfully
  const prevInspectionSummaryRef = useRef(inspectionSummary);
  useEffect(() => {
    const wasNull = prevInspectionSummaryRef.current === null;
    prevInspectionSummaryRef.current = inspectionSummary;
    if (wasNull && inspectionSummary && currentEnvelope?.user_scripts?.[0]?.code?.trim()) {
      // Small delay to ensure report state is fully updated
      setTimeout(() => handleRunUserScript1(), 500);
    }
  }, [inspectionSummary]);

  const handleRunUserScript1 = () => {
    if (userJsScript1Running) return;
    const userScript = currentEnvelope?.user_scripts?.[0];
    if (!userScript?.code?.trim()) {
      console.warn('[user_js_script_1] no script code found');
      setUserJsOutputHtml1('<em>No script code found.</em>');
      return;
    }
    if (!currentReport) {
      console.warn('[user_js_script_1] no report — run Review first');
      setUserJsOutputHtml1('<em>No report — run Review first.</em>');
      return;
    }
    if (!currentReport.checks?.length) {
      console.warn('[user_js_script_1] no checks in report');
      setUserJsOutputHtml1('<em>No checks — run Review first.</em>');
      return;
    }
    const { js: executableCode, template: tplString } = splitScriptCodeAndTemplate(userScript.code);
    if (!executableCode.trim()) {
      console.warn('[user_js_script_1] no executable JS code found after stripping template');
      setUserJsOutputHtml1('<em>No executable code found in script.</em>');
      return;
    }
    const SCRIPT_MIN_EXECUTION_DISPLAY_MS = 1500;
    setUserJsScript1Running(true);
    const startTime = Date.now();

    let html: string;
    let scriptData: Record<string, unknown> = {};
    try {
      const fn = new Function('checks', executableCode);
      const result = fn(currentReport.checks || []);
      scriptData = result?.data || {};
      if (tplString.trim()) {
        html = renderMustache(tplString, scriptData);
      } else {
        console.warn('[user_js_script_1] script ran but no script_template variable found — no output to display');
        html = '<span style="color:#b45309"><b>No output template.</b> Add <code>const script_template = `...`</code> to your script to render results.</span>';
      }
      console.log('[user_js_script_1] data:', scriptData, 'html:', html);
    } catch (e: unknown) {
      console.error('[user_js_script_1] error:', e);
      const msg = e instanceof Error ? e.message : String(e);
      html = `<span style="color:red">Error: ${msg}</span>`;
    }

    const elapsed = Date.now() - startTime;
    const delay = Math.max(0, SCRIPT_MIN_EXECUTION_DISPLAY_MS - elapsed);
    setTimeout(() => {
      setUserJsOutputHtml1(html);
      setUserJsScript1Data(Object.keys(scriptData).length > 0 ? scriptData : null);
      setUserJsScript1LastRun(new Date());
      setUserJsScript1Running(false);
      // Only persist output when there's a template to re-render from cache.
      // Without a template the output is just the warning message — saving it
      // would trigger the restore-useEffect which sees empty template and
      // resets the panel to "Script ready", wiping the warning.
      if (currentReport?.id && Object.keys(scriptData).length > 0 && tplString.trim()) {
        const scriptId = userScript.id || 'script_0';
        const outputEntry = { id: scriptId, data: scriptData, template: tplString, executed_at: new Date().toISOString() };
        setCurrentReport(prev => prev ? { ...prev, user_scripts_output: [outputEntry] } : prev);
        ApiClient.updateReportUserScriptsOutput(currentReport.id, scriptId, scriptData, tplString).catch(console.error);
      }
    }, delay);
  };

  const handleSaveUserScript1 = (code: string, templateId?: string, templateName?: string) => {
    if (!currentEnvelope?.id) return;
    const existing = currentEnvelope?.user_scripts?.[0];
    const scripts = code ? [{
      id: templateId || existing?.id || 'script_0',
      name: templateName || existing?.name || 'Script 1',
      code,
      created_at: existing?.created_at || new Date().toISOString(),
    }] : [];
    ApiClient.updateEnvelope(currentEnvelope.id, {
      user_scripts: scripts,
    } as any).catch(console.error);
    setCurrentEnvelope((prev: any) => prev ? {
      ...prev,
      user_scripts: scripts,
    } : prev);
    if (!code) {
      // Script was removed — wipe the previously-persisted script output
      // from the current Report. Without this, a stale yellow output
      // block keeps appearing in the report view / exports even though
      // the envelope no longer has any script.
      setUserJsOutputHtml1(null);
      setUserJsScript1Data(null);
      if (currentReport?.id) {
        setCurrentReport(prev => prev ? { ...prev, user_scripts_output: [] } : prev);
        ApiClient.clearReportUserScriptsOutput(currentReport.id).catch(console.error);
      }
    }
  };

  const handleCopyScriptOutput = () => {
    if (!userJsOutputHtml1) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = userJsOutputHtml1.replace(/<br\s*\/?>/gi, '\n');
    navigator.clipboard.writeText(tmp.textContent || '').then(() => {
      setUserJsScript1Copied(true);
      setTimeout(() => setUserJsScript1Copied(false), 2000);
    }).catch(console.error);
  };

  const handleExportChecksCsv = () => {
    if (!currentReport?.checks?.length) return;
    const fileNames = (currentEnvelope?.document_files || [])
      .map((f: any) => f.document_file_revisions?.[0]?.name || f.name || '')
      .filter(Boolean);
    import('@/lib/checks-csv-export').then(m => m.openChecksCsvInTab(currentReport.checks, {
      envelopeTitle: currentEnvelope?.title,
      fileNames,
      checklistName: currentChecklist?.name,
      reportDatetime: currentReport.created_at || currentReport.updated_at,
    }));
  };

  const handleExportScriptValues = (format: 'csv' | 'json') => {
    if (!userJsScript1Data || Object.keys(userJsScript1Data).length === 0) return;
    const script = currentEnvelope?.user_scripts?.[0];
    const ctx = {
      envelopeTitle: currentEnvelope?.title,
      scriptName: script?.name || 'Script 1',
      executedAt: userJsScript1LastRun?.toISOString(),
    };
    import('@/lib/script-values-export').then(m => {
      if (format === 'csv') m.openScriptValuesCsvInTab(userJsScript1Data, ctx);
      else m.openScriptValuesJsonInTab(userJsScript1Data, ctx);
    });
  };

  const handleArchiveToggle = async () => {
    if (!currentEnvelope?.id || isTogglingArchive) return;

    setIsTogglingArchive(true);
    try {
      const response = currentEnvelope.archived_at
        ? await ApiClient.unarchiveEnvelope(currentEnvelope.id)
        : await ApiClient.archiveEnvelope(currentEnvelope.id);
      setCurrentEnvelope(prev => prev ? {
        ...prev,
        archived_at: response.envelope.archived_at,
        permissions: response.envelope.permissions,
      } : prev);
      showToast(response.envelope.archived_at ? 'Envelope archived' : 'Envelope unarchived', 'success');
    } catch (error: any) {
      console.error('Failed to toggle archive:', error);
      showToast(error?.message || 'Failed to toggle archive', 'error');
    } finally {
      setIsTogglingArchive(false);
    }
  };

  // Title editing handlers
  const handleToggleTag = useCallback(async (tagId: string) => {
    if (!currentEnvelope) return;
    const isAssigned = currentEnvelope.tags?.some(t => t.id === tagId);
    try {
      if (isAssigned) {
        await ApiClient.removeTagFromEnvelope(currentEnvelope.id, tagId);
      } else {
        await ApiClient.addTagsToEnvelope(currentEnvelope.id, [tagId]);
      }
      // Refresh envelope to get updated tags
      const { envelope } = await ApiClient.getEnvelope(currentEnvelope.id);
      setCurrentEnvelope(prev => prev ? { ...prev, tags: envelope.tags } : null);
    } catch (err) {
      console.error('Failed to toggle tag:', err);
    }
  }, [currentEnvelope]);

  const handleTitleUpdate = async (newTitle: string) => {
    if (!currentEnvelope || !newTitle.trim()) return;
    const trimmedTitle = newTitle.trim();
    if (trimmedTitle === currentEnvelope.title) {
      setIsEditingTitle(false);
      return;
    }
    try {
      await ApiClient.updateEnvelope(currentEnvelope.id, { title: trimmedTitle });
      setCurrentEnvelope(prev => prev ? { ...prev, title: trimmedTitle } : null);
      setIsEditingTitle(false);
    } catch (err) {
      console.error('Failed to update title:', err);
      setError(err instanceof Error ? err.message : 'Failed to update title');
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleUpdate(editingTitleValue);
    } else if (e.key === 'Escape') {
      titleEditCancelledRef.current = true;
      setIsEditingTitle(false);
      setEditingTitleValue(currentEnvelope?.title || '');
    }
  };

  const startEditingTitle = () => {
    if (isEditingDisabled) return;
    if (currentEnvelope?.permissions?.envelope_meta_edit) {
      setEditingTitleValue(currentEnvelope.title);
      setIsEditingTitle(true);
    }
  };

  const handleDownloadEnvelopePdf = () => {
    if (!inputBase64ConvertedForDisplay) return;
    const a = document.createElement("a");
    a.href = inputBase64ConvertedForDisplay;
    a.download = `${currentEnvelope?.title || 'envelope'}.pdf`;
    a.click();
  };

  const handleExportSampleEnvelope = async () => {
    if (!currentEnvelope) return;
    try {
      const { fixture, filename } = await ApiClient.exportEnvelopeFixture(currentEnvelope.id, currentEnvelopeRevision?.id);
      const blob = new Blob([JSON.stringify(fixture, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export fixture:', err);
      alert('Failed to export fixture. Check console for details.');
    }
  };

  const handleLoadFixture = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      input.remove();
      if (!file) return;
      try {
        const text = await file.text();
        const fixture = JSON.parse(text);
        // Client-side validation: fixture must have report with checks
        if (!fixture.report?.checks?.length) {
          alert('Invalid fixture: must contain a report with checks.');
          return;
        }
        if (!fixture.checklist_snapshot && !fixture.checklist_name) {
          alert('Invalid fixture: must contain checklist_snapshot or checklist_name.');
          return;
        }
        const { envelope } = await ApiClient.loadFixture(fixture);
        navigate(`/envelopes/view?id=${envelope.id}`);
      } catch (err) {
        console.error('Failed to load fixture:', err);
        alert('Failed to load fixture. Check console for details.');
      }
    };
    input.addEventListener('cancel', () => input.remove());
    input.click();
  };

  const handleEnvelopeDownload = () => {
    if (!currentEnvelope) return;
    const json = envelopeToJSON(currentEnvelope);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentEnvelope.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleEnvelopeUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const env = envelopeFromJSON(text);
      // Ensure envelope_revisions exist
      const envelopeWithRevisions = {
        ...env,
        envelope_revisions: env.envelope_revisions || []
      };
      setCurrentEnvelope(envelopeWithRevisions);
    } catch (err) {
      alert("Invalid envelope file");
    }
  };

  // Reset check navigator when filters change or new inspection report is loaded
  useEffect(() => {
    setCurrentCheckIndex(0);
  }, [checkFilter, currentReport]);

  // Reset overlapping highlight cycling when visible check set changes
  useEffect(() => {
    setOverlappingHighlights([]);
    setCurrentOverlapIndex(0);
  }, [checkFilter]);

  // Reset page index when revision changes to prevent accessing non-existent pages
  useEffect(() => {
    if (currentEnvelope) {
      const maxPageIndex = Math.max(0, (currentRevisionPages?.length || 1) - 1);
      if (currentPageIndex > maxPageIndex) {
        if (import.meta.env.DEV) console.debug(`Resetting page index from ${currentPageIndex} to ${maxPageIndex} for revision change`);
        setCurrentPageIndex(maxPageIndex);
      }
    }
  }, [currentEnvelope?.current_revision_index, currentRevisionPages?.length]);

  // Add ESC/Delete/Enter key listener for dialogs and check actions
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "Escape") {
        if (showReportPopup) {
          setShowReportPopup(false);
        } else if (showManualCheckDialog) {
          setShowManualCheckDialog(false);
          setSelectedArea(null);
          setIsManualSelectionMode(false);
        } else if (showFileRearrangeDialog) {
          handleCloseFileRearrangeDialog();
        } else if (showChecklistDialog) {
          handleCloseChecklistDialog();
        } else if (selectedCheckId) {
          // Deselect check if no dialogs are open
          setSelectedCheckId(null);
        }
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedCheckId
      ) {
        // Delete the selected check when Delete key is pressed
        deleteCheck(selectedCheckId);
      } else if (
        event.key === "Enter" &&
        selectedCheckId &&
        !inlineEditCheckId &&
        !editingCheckId
      ) {
        // Open inline editor for selected check
        const check = currentReport?.checks?.find(c => c.id === selectedCheckId);
        if (check && !isEditingDisabled) {
          openInlineEditor(check);
        }
      } else if (
        (event.key === "x" || event.key === "X") &&
        selectedCheckId &&
        !inlineEditCheckId &&
        !editingCheckId &&
        !isEditingDisabled &&
        !(target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable))
      ) {
        // Toggle pass/fail for selected check
        event.preventDefault();
        const check = currentReport?.checks?.find(c => c.id === selectedCheckId);
        if (check) {
          quickToggleCheckPassed(check.id, check.passed);
        }
      }
    };

    document.addEventListener("keydown", handleEscapeKey);
    return () => {
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [
    showReportPopup,
    showManualCheckDialog,
    showFileRearrangeDialog,
    showChecklistDialog,
    selectedCheckId,
    inlineEditCheckId,
    editingCheckId,
    currentReport,
    isEditingDisabled,
    quickToggleCheckPassed,
  ]);


  // Memoize the file prop for react-pdf — copy the buffer so the Worker's
  // transferable postMessage doesn't detach our source Uint8Array
  const pdfDocumentFile = useMemo(() => {
    if (inputPdfBytes) {
      return { data: new Uint8Array(inputPdfBytes) };
    }
    return null;
  }, [inputPdfBytes]);

  // Fatal load error: envelope failed to load entirely — show full-page error instead of blank screen
  if (error && !currentEnvelope && !isLoadingEnvelope) {
    return (
      <div className="flex flex-col flex-1 min-h-0 items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <svg className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.007H12v-.007Z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground">Failed to load envelope</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          {SUPPORT_EMAIL && (
            <p className="text-xs text-muted-foreground">
              If this issue persists, please <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary underline hover:text-primary/80">contact support</a>.
            </p>
          )}
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => navigate('/envelopes')}
              className="px-4 py-2 text-sm font-medium rounded-md border border-input bg-background hover:bg-muted transition-colors"
            >
              Back to envelopes
            </button>
            <button
              onClick={() => { setError(null); setRetryCounter(c => c + 1); }}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Main panel - PDF viewer (full width) */}
      <div ref={scrollContainerRef} className="flex-1 flex flex-col p-0 sm:p-0.5 overflow-hidden">
        <div className="flex-shrink-0">
          {/* Show loading state when loading envelope from URL */}
          {isLoadingEnvelope && (
            <div className="mb-4">
              <div className="flex justify-center items-center p-8 bg-muted rounded-lg">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                  <p className="text-muted-foreground">Loading envelope...</p>
                </div>
              </div>
            </div>
          )}

          {/* Persistent save error banner */}
          {saveError && (
            <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-2 text-sm flex items-center gap-2 mb-4">
              <span className="flex-1">Save failed: {saveError}</span>
              <button onClick={() => setSaveError(null)} className="shrink-0 font-bold opacity-70 hover:opacity-100">&times;</button>
            </div>
          )}

          {/* Version Mismatch Warning */}
          {isChecklistVersionMismatch && (
            <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-4">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-amber-700">
                    <strong>Warning:</strong> The checklist version has changed since this report was created.
                    Some rules may not be found. Consider re-inspecting to use the latest checklist version.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Document Toolbar - Google Docs style */}
          {currentEnvelope && (
            <div className="mb-0.5 sm:mb-1 bg-card border border-border rounded-lg shadow-sm">
              {/* Archived envelope warning - displayed above title */}
              {!isReadOnlyRevision && currentEnvelope?.archived_at && (
                currentEnvelope?.permissions?.envelope_archive ? (
                  <button
                    onClick={handleArchiveToggle}
                    disabled={isTogglingArchive}
                    className="w-full flex items-center justify-end px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
                  >
                    <span className="text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
                      {isTogglingArchive ? (
                        <>
                          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-amber-800 dark:border-amber-300" />
                          Unarchiving...
                        </>
                      ) : (
                        <>
                          <Archive className="h-4 w-4" />
                          Envelope is archived. <span className="underline">Click to unarchive</span>
                        </>
                      )}
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center justify-end px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
                    <span className="text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
                      <Archive className="h-4 w-4" />
                      Envelope is archived. Contact the owner to unarchive.
                    </span>
                  </div>
                )
              )}
              {/* Row 0: Identity — Title + Save Status + Revision + Archive */}
              <div className="flex flex-wrap items-center justify-between pl-4 pr-2 py-2 border-b border-gray-100 gap-y-1">
                {/* Left: Title + Timestamp + Tags — wraps as a group */}
                <div className="flex flex-wrap items-center min-w-0 w-full sm:w-auto sm:flex-1 sm:mr-4 gap-y-1">
                  <div className="flex items-center min-w-0">
                    {isViewRoute && (
                      <button
                        onClick={() => navigate('/envelopes')}
                        className="p-1 rounded-md hover:bg-muted transition-colors flex-shrink-0 mr-2"
                        title="Back to envelopes"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                    )}
                    {currentEnvelope.archived_at && (
                      <Archive className="h-4 w-4 text-amber-600 flex-shrink-0 mr-1.5" />
                    )}
                    {isEditingTitle ? (
                      <input
                        type="text"
                        value={editingTitleValue}
                        onChange={(e) => setEditingTitleValue(e.target.value)}
                        onKeyDown={handleTitleKeyDown}
                        onBlur={() => {
                          if (titleEditCancelledRef.current) {
                            titleEditCancelledRef.current = false;
                            return;
                          }
                          handleTitleUpdate(editingTitleValue);
                        }}
                        className="text-lg font-semibold text-foreground bg-card border border-indigo-400 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                        autoFocus
                      />
                    ) : (
                      <>
                        <VersionBadge revisionCount={currentEnvelope.envelope_revisions?.length} size="md" className="mr-2" />
                        {isInspecting && (
                          <div
                            className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin flex-shrink-0 mr-2"
                            title="Review in progress"
                            aria-label="Review in progress"
                          />
                        )}
                        <h1
                          onClick={currentEnvelope.archived_at ? undefined : startEditingTitle}
                          className={`text-lg font-semibold ${currentEnvelope.title ? 'text-foreground' : 'text-muted-foreground'
                            } ${currentEnvelope?.permissions?.envelope_meta_edit && !currentEnvelope.archived_at
                              ? 'cursor-pointer hover:bg-secondary rounded px-2 py-1 -mx-2 -my-1'
                              : ''
                            }`}
                          title={currentEnvelope.archived_at ? 'Envelope is archived' : (currentEnvelope?.permissions?.envelope_meta_edit ? 'Click to edit title' : (currentEnvelope.title || 'Untitled'))}
                        >
                          {currentEnvelope.title || 'Untitled'}
                        </h1>
                      </>
                    )}
                  </div>
                  {/* Timestamp + Tags — sit after title, wrap to next line together if no space */}
                  <div className="flex items-center gap-1 flex-wrap ml-2">
                    {currentEnvelope.updated_at && (
                      <span className="text-xs text-muted-foreground/50 flex-shrink-0 whitespace-nowrap" title={new Date(currentEnvelope.updated_at).toLocaleString()}>
                        {saveState.status === 'saving' ? 'Saving...' : saveState.status === 'error' ? 'Save failed' : (() => {
                          const ago = getDateTimeAgoAsHumanString(currentEnvelope.updated_at);
                          const report = currentEnvelopeRevision?.report;
                          if (report?.updated_at && report.updated_at >= (currentEnvelope.updated_at || '')) {
                            if (report.job_status === ReportJobStatus.COMPLETED) return `Reviewed ${ago}`;
                            if (report.job_status === ReportJobStatus.FAILED) return `Review failed ${ago}`;
                            if (report.job_status === ReportJobStatus.PENDING || report.job_status === ReportJobStatus.PROCESSING) return `Review started ${ago}`;
                            if (report.job_status === ReportJobStatus.RESET) return `Review reset ${ago}`;
                          }
                          return `Updated ${ago}`;
                        })()}
                      </span>
                    )}
                    <ScriptsBadge userScripts={currentEnvelope.user_scripts} />
                    {currentEnvelope.tags && currentEnvelope.tags.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {currentEnvelope.tags.map(tag => (
                          <TagChip
                            key={tag.id}
                            tag={tag}
                            size="sm"
                            onRemove={() => handleToggleTag(tag.id)}
                            onClick={() => {
                              try {
                                const saved = localStorage.getItem('envelope-folder-view');
                                const state = saved ? JSON.parse(saved) : {};
                                localStorage.setItem('envelope-folder-view', JSON.stringify({ ...state, activeTab: tag.id }));
                              } catch { }
                              navigate('/envelopes');
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {availableTags.length > 0 && (
                      <TagPicker
                        availableTags={availableTags}
                        assignedTagIds={new Set((currentEnvelope.tags || []).map(t => t.id))}
                        onToggleTag={handleToggleTag}
                      >
                        <button className="flex items-center flex-shrink-0 group/tag hover:opacity-80 transition-opacity">
                          <Tag className="h-3.5 w-3.5 text-muted-foreground/30 group-hover/tag:text-muted-foreground transition-colors" />
                        </button>
                      </TagPicker>
                    )}
                  </div>
                </div>

                {/* Right: Revision Dropdown */}
                <div className="flex items-center space-x-1.5 flex-shrink-0 ml-auto">
                  {/* Revision Dropdown + Comment */}
                  {currentEnvelope?.envelope_revisions && currentEnvelope.envelope_revisions.length > 0 && (
                    <div className="flex items-center gap-1.5 relative">
                      {/* Diff Viewer Toggle Button */}
                      {features.diff_viewer && (
                        <button
                          onClick={() => setShowPageDiffs(!showPageDiffs)}
                          className={`p-1.5 rounded transition-colors ${showPageDiffs
                            ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900'
                            : 'text-muted-foreground/50 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-secondary'
                            }`}
                          title={
                            showPageDiffs ? "Hide revision changes"
                              : currentEnvelope.envelope_revisions.length === 1 ? "View revision content"
                                : "Compare revisions"
                          }
                        >
                          <GitCompare className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Upload new revision (latest) or View files (older revisions) */}
                      {(() => {
                        const isLatestRevision = currentEnvelope.current_revision_index === currentEnvelope.envelope_revisions.length - 1;
                        if (isLatestRevision && !isEditingDisabled) {
                          return (
                            <button
                              onClick={handleNewRevisionOrReview}
                              className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground/50 hover:text-foreground"
                              title="Create new revision"
                            >
                              <FilePlus className="h-3.5 w-3.5" />
                            </button>
                          );
                        }
                        return (
                          <button
                            onClick={() => handleOpenFileRearrangeDialog('view_readonly')}
                            className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground/50 hover:text-foreground"
                            title="View revision files"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        );
                      })()}
                      <select
                        className="text-sm border border-border rounded px-1.5 py-1 bg-card text-secondary-foreground hover:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={currentEnvelope.current_revision_index}
                        onChange={(e) => {
                          if (e.target.value === '__new_revision__') {
                            e.target.value = String(currentEnvelope.current_revision_index);
                            handleNewRevisionOrReview();
                            return;
                          }
                          const idx = parseInt(e.target.value, 10);
                          setCurrentPageIndex(0);
                          setCurrentEnvelope((prev) =>
                            prev ? { ...prev, current_revision_index: idx } : prev,
                          );
                        }}
                      >
                        {!isEditingDisabled && (
                          <>
                            <option value="__new_revision__">New Revision...</option>
                            <option disabled>──────</option>
                          </>
                        )}
                        {[...currentEnvelope?.envelope_revisions ?? []].map((r, idx) => ({ r, idx })).reverse().map(({ r, idx }) => {
                          const revNum = r.revision_number + 1;
                          const timeStr = r.created_at ? ` (${getDateTimeAgoAsHumanString(r.created_at)})` : '';
                          return (
                            <option key={r.id} value={idx}>
                              Rev {revNum}{timeStr}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}
                  {/* Kebab menu */}
                  <EnvelopeKebabMenu
                    onRenameEnvelope={startEditingTitle}
                    onCreateRevision={handleNewRevisionOrReview}
                    onEditRevision={() => handleOpenFileRearrangeDialog('edit_current')}
                    isEditingDisabled={isEditingDisabled}
                    highlightMode={highlightMode}
                    onHighlightModeChange={handleHighlightModeChange}
                    fontFamily={fontFamily}
                    onFontFamilyChange={handleFontFamilyChange}
                    labelFontScale={labelFontScale}
                    onFontScaleReset={handleFontScaleReset}
                    currentReport={currentReport}
                    currentEnvelope={currentEnvelope}
                    onArchiveToggle={handleArchiveToggle}
                    onDuplicateEnvelope={() => {
                      if (!currentEnvelope?.id) return;
                      setShowDuplicateDialog(true);
                    }}
                    onDeleteEnvelope={async () => {
                      if (!currentEnvelope?.id) return;
                      if (!window.confirm('Are you sure you want to delete this envelope? This action cannot be undone.')) return;
                      try {
                        await ApiClient.deleteEnvelope(currentEnvelope.id);
                        navigate('/envelopes');
                      } catch (err) {
                        console.error('Failed to delete envelope:', err);
                      }
                    }}
                    isInspecting={isInspecting}
                    showPageDiffs={showPageDiffs}
                    setShowPageDiffs={setShowPageDiffs}
                    previousReport={previousReport}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    alignLabelsToTop={alignLabelsToTop}
                    onAlignLabelsToTopChange={setAlignLabelsToTop}
                    showDebug={showDebug}
                    setShowDebug={setShowDebug}
                    debugSkipAI={debugSkipAI}
                    setSkipAI={setSkipAI}
                    debugForceInspection={debugForceInspection}
                    setDebugForceInspection={setDebugForceInspection}
                    debugGridMode={debugGridMode}
                    setDebugGridMode={setDebugGridMode}
                    debugPages={debugPages}
                    setDebugPages={setDebugPages}
                    onDownloadEnvelopePdf={handleDownloadEnvelopePdf}
                    onExportSampleEnvelope={handleExportSampleEnvelope}
                    onLoadFixture={handleLoadFixture}
                    onEditUserScript1={() => setShowCustomScriptDialog(true)}
                    onExportChecksCsv={() => {
                      if (currentReport?.checks?.length) {
                        const fileNames = (currentEnvelope?.document_files || []).map((f: any) => f.document_file_revisions?.[0]?.name || f.name || '').filter(Boolean);
                        import('@/lib/checks-csv-export').then(m => m.openChecksCsvInTab(currentReport.checks, {
                          envelopeTitle: currentEnvelope?.title,
                          fileNames,
                          checklistName: currentChecklist?.name,
                          reportDatetime: currentReport.created_at || currentReport.updated_at,
                        }));
                      }
                    }}
                  />
                </div>
              </div>


              {inputFiles.length > 0 && (
                <>
                  <ToolbarActions
                    currentChecklist={currentChecklist}
                    currentReport={currentReport}
                    checklists={checklists}
                    isSnapshotChecklist={isSnapshotChecklist}
                    isChecklistLocked={isChecklistLocked}
                    lockedChecklistId={lockedChecklistId}
                    isReportReset={editability.isReportReset}
                    isReadOnlyRevision={isReadOnlyRevision}
                    isInspecting={isInspecting}
                    currentEnvelope={currentEnvelope}
                    currentEnvelopeRevision={currentEnvelopeRevision ?? null}
                    previousReport={previousReport}
                    handleViewChecklist={handleViewChecklist}
                    generateReport={() => generateReport()}
                    showOnboardingHints={showOnboardingHints && !showChecklistDialog}
                    envelopeId={currentEnvelope?.id}
                    showReviewHint={pendingInspectionAfterArrange}
                    onReviewHintDismiss={() => setPendingInspectionAfterArrange(false)}
                    onOpenSelectAIDialog={() => setSelectAIDialogState({})}
                    rulesChangedSinceReview={rulesChangedSinceReview}
                    envelopeRuleCount={envelopeUserRules.length}
                  />

                  {/* Row 2: Results — Check Navigator + Add Issue */}
                  <div className="flex items-center px-2 sm:px-4 py-1.5 border-b border-border bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <CheckNavigator
                        currentReport={currentReport}
                        currentCheckIndex={currentCheckIndex}
                        onNavigate={navigateToCheck}
                        checkFilter={checkFilter}
                        isInspecting={isInspecting}
                        isManualSelectionMode={isManualSelectionMode}
                        selectedCheckId={selectedCheckId}
                        onEditCheck={openInlineEditor}
                        isEditingDisabled={isEditingDisabled}
                        hasEnvelopeScript={!!currentEnvelope?.user_scripts?.[0]?.code?.trim()}
                        onRunReview={() => setSelectAIDialogState({})}
                      />
                    </div>
                    {/* Add Issue button / Cancel Adding Issue link */}
                    {!isEditingDisabled && (
                      <>
                        {!isManualSelectionMode && (
                          <button
                            onClick={() => setInteractionMode('cursor')}
                            className="ml-2 h-7 px-2 flex items-center justify-center rounded text-xs font-medium transition-colors flex-shrink-0 bg-indigo-600 text-white hover:bg-indigo-700"
                            title="Select mode (draw to add issue)"
                          >
                            <BoxSelect className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1">Add Issue</span>
                          </button>
                        )}
                        {isManualSelectionMode && (
                          <button
                            onClick={() => {
                              setInteractionMode('grab');
                              setIsSelecting(false);
                              setSelectionStart(null);
                              setSelectionEnd(null);
                              setSelectedArea(null);
                            }}
                            className="ml-2 h-7 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <span className="hidden sm:inline">Cancel Adding Issue</span><span className="sm:hidden">Cancel</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* Row 3: Viewer Controls — Filter+Compliance | Zoom | Page Nav | A-/A+ */}
                  <div className="flex items-center px-2 sm:px-4 py-1.5">
                    {/* Left: Filter + Compliance */}
                    <div className="flex-1 flex items-center space-x-1.5">
                      {currentReport && currentReport.checks?.length > 0 && (() => {
                        const allChecks = currentReport.checks;
                        const totalChecks = allChecks.length;
                        const passedChecks = allChecks.filter((c: { passed: boolean }) => c.passed).length;
                        const failedChecks = totalChecks - passedChecks;
                        const changesChecks = allChecks.filter((c: ICheck) => getCheckTypes(c).has(CheckType.CHANGE)).length;
                        const recheckChecks = allChecks.filter((c: ICheck) => getCheckTypes(c).has(CheckType.RECHECK)).length;
                        const failedOnlyChecks = allChecks.filter((c: ICheck) => { const t = getCheckTypes(c); return t.has(CheckType.FAILED) && !t.has(CheckType.CHANGE); }).length;
                        const compliancePercentage = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;
                        return (
                          <>
                            <Select value={checkFilter} onValueChange={(v) => setCheckFilter(v as CheckFilter)}>
                              <SelectTrigger className="h-7 w-auto text-xs px-2 py-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">
                                  <span className="flex items-center gap-1.5">
                                    <span className="flex items-center gap-0.5">
                                      <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                                      <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                                    </span>
                                    ({totalChecks}) <span className="hidden sm:inline">{REVDOKU_CHECK_FILTER_LABELS.all.label}</span>
                                  </span>
                                </SelectItem>
                                <SelectItem value="failed">
                                  <span className="flex items-center gap-1.5">
                                    <span className="flex items-center gap-0.5">
                                      <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                                      <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                                    </span>
                                    ({failedChecks}) <span className="hidden sm:inline">{REVDOKU_CHECK_FILTER_LABELS.failed.label}</span>
                                  </span>
                                </SelectItem>
                                <SelectItem value="failed_only">
                                  <span className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                                    ({failedOnlyChecks}) <span className="hidden sm:inline">{REVDOKU_CHECK_FILTER_LABELS.failed_only.label}</span>
                                  </span>
                                </SelectItem>
                                <SelectItem value="passed">
                                  <span className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                                    ({passedChecks}) <span className="hidden sm:inline">{REVDOKU_CHECK_FILTER_LABELS.passed.label}</span>
                                  </span>
                                </SelectItem>
                                {changesChecks > 0 && (
                                  <SelectItem value="changes">
                                    <span className="flex items-center gap-1.5">
                                      <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                                      ({changesChecks}) <span className="hidden sm:inline">{REVDOKU_CHECK_FILTER_LABELS.changes.label}</span>
                                    </span>
                                  </SelectItem>
                                )}
                                {recheckChecks > 0 && (
                                  <SelectItem value="rechecks">
                                    <span className="flex items-center gap-1.5">
                                      <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
                                      ({recheckChecks}) <span className="hidden sm:inline">{REVDOKU_CHECK_FILTER_LABELS.rechecks.label}</span>
                                    </span>
                                  </SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                            <span title={`${passedChecks}/${totalChecks} passed`} className={`text-xs font-bold tabular-nums ${getCompliancePercentColor(compliancePercentage)}`}>
                              {compliancePercentage}%
                            </span>
                          </>
                        );
                      })()}
                    </div>

                    {/* Center: zoom + page nav */}
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={handleZoomOut}
                        className="w-7 h-7 flex items-center justify-center bg-secondary text-secondary-foreground rounded hover:bg-accent transition-colors"
                        title="Zoom Out"
                      >
                        <span aria-hidden="true">−</span>
                      </button>

                      <ZoomSelect zoomMode={zoomMode} zoomLevel={zoomLevel} onSelect={handleZoomSelect} />

                      <button
                        onClick={handleZoomIn}
                        className="w-7 h-7 flex items-center justify-center bg-secondary text-secondary-foreground rounded hover:bg-accent transition-colors"
                        title="Zoom In"
                      >
                        <span aria-hidden="true">+</span>
                      </button>

                      {numPages && numPages > 1 && (
                        <>
                          <div className="w-px h-5 bg-border mx-1" />
                          <button
                            onClick={() => {
                              const prev = Math.max(0, currentPageIndex - 1);
                              if (isContinuousScroll) scrollToPage(prev);
                              else setCurrentPageIndex(prev);
                            }}
                            disabled={currentPageIndex <= 0}
                            className="w-7 h-7 flex items-center justify-center bg-secondary text-secondary-foreground rounded hover:bg-accent disabled:opacity-50 disabled:hover:bg-secondary transition-colors"
                            title="Previous Page"
                          >
                            <span aria-hidden="true">←</span>
                          </button>
                          <span className="text-sm text-muted-foreground min-w-[40px] text-center">
                            {currentPageIndex + 1} / {numPages}
                          </span>
                          <button
                            onClick={() => {
                              const next = Math.min((numPages || 1) - 1, currentPageIndex + 1);
                              if (isContinuousScroll) scrollToPage(next);
                              else setCurrentPageIndex(next);
                            }}
                            disabled={currentPageIndex >= (numPages || 1) - 1}
                            className="w-7 h-7 flex items-center justify-center bg-secondary text-secondary-foreground rounded hover:bg-accent disabled:opacity-50 disabled:hover:bg-secondary transition-colors"
                            title="Next Page"
                          >
                            <span aria-hidden="true">→</span>
                          </button>
                        </>
                      )}
                    </div>

                    {/* Right: A-/A+ font scale controls */}
                    <div className="flex-1 flex justify-end">
                      {currentReport && currentReport.checks?.length > 0 && (
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={handleFontScaleDown}
                            disabled={labelFontScale <= 0.25}
                            className="w-7 h-7 flex items-center justify-center bg-secondary text-secondary-foreground rounded hover:bg-accent disabled:opacity-50 disabled:hover:bg-secondary transition-colors text-xs font-medium"
                            title="Decrease label font size"
                          >
                            A−
                          </button>
                          <button
                            onClick={handleFontScaleUp}
                            disabled={labelFontScale >= 3.0}
                            className="w-7 h-7 flex items-center justify-center bg-secondary text-secondary-foreground rounded hover:bg-accent disabled:opacity-50 disabled:hover:bg-secondary transition-colors text-xs font-medium"
                            title="Increase label font size"
                          >
                            A+
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 4: Read-only revision warning (conditional) */}
                  {isReadOnlyRevision && (
                    <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-t border-amber-200">
                      <span className="text-sm text-amber-800">
                        Viewing revision {currentEnvelope.envelope_revisions[currentEnvelope.current_revision_index]?.revision_number + 1} (read-only)
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={handleSwitchToLatest}
                          className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
                        >
                          Switch to Latest
                        </button>
                        <button
                          onClick={handleRollbackToCurrentRevision}
                          className="px-3 py-1 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
                        >
                          Rollback to This Version
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

            </div>
          )}


        </div>
        {/* Loading files state - shown during upload or when file content is being fetched */}
        {currentEnvelope && inputFiles.length === 0 && (isUploadingFiles || hasPendingInitialFiles || fileRevisions.length > 0) && (
          <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-4rem)]">
            <div className="text-center p-8">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center bg-indigo-100 dark:bg-indigo-900/50">
                <svg className="animate-spin w-10 h-10 text-indigo-600 dark:text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                {isUploadingFiles || hasPendingInitialFiles ? 'Uploading...' : 'Loading documents...'}
              </h3>
              <p className="text-muted-foreground max-w-sm">
                {isUploadingFiles || hasPendingInitialFiles
                  ? 'Your documents are being encrypted and uploaded. This may take a moment for large files.'
                  : 'Loading and decrypting document content...'}
              </p>
            </div>
          </div>
        )}
        {/* Empty envelope state - prompt to add files */}
        {currentEnvelope && inputFiles.length === 0 && fileRevisions.length === 0 && !isLoadingEnvelope && !isProcessingInput && !isUploadingFiles && !hasPendingInitialFiles && (
          <div className="flex-1 flex items-center justify-center">
            <div className="p-8">
              <EmptyEnvelopeDropzone
                headline="No files yet"
                onFilesSelected={handleEmptyAreaFilesSelected}
                disabled={isEditingDisabled}
                size="large"
                dropzoneWrapper={showOnboardingHints ? (dropzone) => (
                  <OnboardingHint
                    hintKey={`guide-add-files-${currentEnvelope?.id}`}
                    message="Start by adding your documents"
                    position="top"
                    disabled={showChecklistDialog}
                  >
                    {dropzone}
                  </OnboardingHint>
                ) : undefined}
              />
            </div>
          </div>
        )}
        {inputFiles.length > 0 && <div ref={pageScrollContainerRef} className="flex-1 min-h-0 overflow-auto relative bg-background flex flex-col">
          {/* User JS Script 1 — output panel */}
          {currentEnvelope?.user_scripts?.[0]?.code?.trim() && (
            <div
              className="mx-2 sm:mx-4 my-1.5 p-2.5 rounded-lg border text-xs font-mono flex items-start gap-2 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800/50"
              onClick={(e) => {
                const link = (e.target as HTMLElement).closest('a[href^="#page_"]');
                if (link) {
                  e.preventDefault();
                  const pageNum = parseInt(link.getAttribute('href')!.slice(6));
                  if (!isNaN(pageNum) && pageNum > 0) scrollToPage(pageNum - 1);
                }
              }}
            >
              <div className="flex flex-col items-center gap-1 shrink-0 self-stretch justify-between">
                <button
                  onClick={handleRunUserScript1}
                  disabled={!currentReport || userJsScript1Running}
                  className="p-1.5 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/30 disabled:opacity-50"
                  title="Run script"
                >
                  {userJsScript1Running
                    ? <Loader2 className="h-4 w-4 text-amber-700 dark:text-amber-400 animate-spin" />
                    : <Play className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                  }
                </button>
                {userJsOutputHtml1 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="p-1 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/30"
                        title="Export"
                      >
                        {userJsScript1Copied
                          ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                          : <Share className="h-3.5 w-3.5 text-muted-foreground" />
                        }
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={handleCopyScriptOutput}>
                        <Copy className="h-3.5 w-3.5 mr-2" />
                        Copy Text
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleExportScriptValues('csv')}
                        disabled={!userJsScript1Data || Object.keys(userJsScript1Data).length === 0}
                      >
                        Export Values as CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleExportScriptValues('json')}
                        disabled={!userJsScript1Data || Object.keys(userJsScript1Data).length === 0}
                      >
                        Export Values as JSON
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={handleExportChecksCsv}
                        disabled={!currentReport?.checks?.length}
                      >
                        Export Checks as CSV
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : <div />}
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                {userJsScript1Running
                  ? <span className="text-muted-foreground">Executing...</span>
                  : userJsOutputHtml1
                    ? <div
                      dangerouslySetInnerHTML={{ __html: userJsOutputHtml1 }}
                      className="[&_a]:underline [&_a]:cursor-pointer"
                    />
                    : <span className="text-muted-foreground">Script ready</span>
                }
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0 self-stretch justify-between">
                <button
                  onClick={() => setShowCustomScriptDialog(true)}
                  className="p-1 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/30"
                  title="Edit script"
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                {userJsScript1LastRun && (
                  <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                    last run {getDateTimeAgoAsHumanString(userJsScript1LastRun.toISOString())}
                  </span>
                )}
              </div>
            </div>
          )}
          <InspectionProgressOverlay
            isVisible={isInspecting}
            checklistName={isInspecting ? inspectingChecklistName : (currentChecklist?.name || null)}
            aiModel={inspectingAiModel}
            reportSummary={inspectionSummary}
            inspectionError={inspectionError}
            onDismiss={handleOverlayDismiss}
            inspectionContext={inspectionContext}
            reportStartTime={inspectionStartTime}
            reportId={currentReport?.id || null}
            onCancel={handleCancelInspection}
            initialStepIndex={resumedStepIndex}
            onStepChange={(step) => {
              if (currentEnvelope?.id && currentReport?.id && inspectionStartTime) {
                saveInspectionProgress(currentEnvelope.id, currentReport.id, step, inspectionStartTime);
              }
            }}
            batchMeta={batchMeta}
            preparationMeta={preparationMeta}
            refFilesTotal={refFilesTotal}
            totalPagesHint={numPages}
            pageStatuses={currentReport?.page_statuses}
            isCancelling={isCancelling}
            onReviewRemaining={handleResumeInspection}
          />
          {/* Unreviewed pages toolbar — shows after a cancelled or partial review.
              Sticky (non-scrollable) so it stays visible at the top of the document
              viewer while the user scrolls. Closable for the current session via the
              X button (state is in-memory only — a page reload brings the toolbar
              back so the user can't lose track of the unfinished review).
              "Continue review" triggers handleResumeInspection which calls
              /reports/:id/resume. */}
          {!isInspecting && currentReport && dismissedBannerReportId !== currentReport.id && (() => {
            const statuses = currentReport.page_statuses;
            const totalPages = (currentReport as any).page_count || numPages || 0;

            if (!statuses || Object.keys(statuses).length === 0 || totalPages <= 0) return null;

            const unreviewed: number[] = [];
            for (let i = 0; i < totalPages; i++) {
              const status = statuses[String(i)];
              if (status === undefined || status === null) {
                unreviewed.push(i + 1);
              } else {
                const s = Number(status);
                if (s < 0 || s >= 90) unreviewed.push(i + 1);
              }
            }
            if (unreviewed.length === 0) return null;
            unreviewed.sort((a, b) => a - b);

            // Collapse consecutive page numbers into ranges (e.g. "1, 5–7, 12")
            const ranges: string[] = [];
            let start = unreviewed[0], end = unreviewed[0];
            for (let i = 1; i < unreviewed.length; i++) {
              if (unreviewed[i] === end + 1) { end = unreviewed[i]; }
              else { ranges.push(start === end ? `${start}` : `${start}\u2013${end}`); start = end = unreviewed[i]; }
            }
            ranges.push(start === end ? `${start}` : `${start}\u2013${end}`);
            const rangeText = ranges.length <= 3
              ? `Pages ${ranges.join(', ')}`
              : `${unreviewed.length} pages (${ranges[0]}, ${ranges[1]} and others)`;

            const bannerReportId = currentReport.id;
            return (
              <div className="sticky top-0 z-20 flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800 shadow-sm backdrop-blur-sm">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span className="text-xs text-amber-800 dark:text-amber-300 flex-1 min-w-0 truncate">
                  {rangeText} not reviewed.{' '}
                  <button
                    onClick={handleResumeInspection}
                    className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                  >
                    Continue review
                  </button>
                </span>
                <button
                  onClick={() => setDismissedBannerReportId(bannerReportId)}
                  aria-label="Dismiss"
                  title="Dismiss (reappears on reload)"
                  className="flex-shrink-0 p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })()}
          <div className="bg-card p-0.5 sm:p-1 rounded-lg shadow">
            <div className="relative">
              {isProcessingInput ? (
                <div className="flex justify-center items-center p-8">
                  <div className="animate-pulse text-muted-foreground">
                    Loading and preparing document...
                  </div>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center p-8 gap-3">
                  <p className="text-sm text-destructive">{error}</p>
                  <button
                    onClick={handleRetryFileProcessing}
                    className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Refresh
                  </button>
                </div>
              ) : fileRevisions.length > 0 && !pdfDocumentFile ? (
                <div className="flex flex-col items-center justify-center p-8 gap-3">
                  <p className="text-sm text-muted-foreground">Document could not be displayed.</p>
                  <button
                    onClick={handleRetryFileProcessing}
                    className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Refresh
                  </button>
                </div>
              ) : fileRevisions.length > 0 ? (
                <Document
                  file={pdfDocumentFile}
                  onLoadSuccess={onDocumentLoadSuccess}
                  onLoadError={onDocumentLoadError}
                  className=""
                  error={<p>Failed to display input.</p>}
                  loading={<p className="text-center">Loading document...</p>}
                >
                  {(numPages || (pdfDocumentFile && !isProcessingInput)) && isContinuousScroll && numPages ? (
                    /* --- Continuous scroll mode: all pages stacked vertically --- */
                    <div
                      style={{
                        width: maxOverhangs.left + viewerWidth * zoomLevel + maxOverhangs.right,
                        minHeight: continuousTotalHeight + (numPages - 1) * PAGE_GAP,
                        position: "relative",
                        margin: "0 auto",
                      }}
                    >
                      {Array.from({ length: numPages }, (_, pageIdx) => {
                        const isVisible = pageIdx >= continuousVisiblePageRange.start && pageIdx <= continuousVisiblePageRange.end;
                        const pageHeight = continuousPageHeights[pageIdx] || 0;
                        const pageGeo = allPageGeometries.get(pageIdx);
                        const pageTop = continuousPageYOffsets[pageIdx] || 0;
                        const pageHasOverhangs = pageGeo ? (
                          pageGeo.overhangLeft > 0 || pageGeo.overhangRight > 0 ||
                          pageGeo.overhangTop > 0 || pageGeo.overhangBottom > 0
                        ) : false;

                        if (!isVisible) {
                          // Placeholder for virtualized (off-screen) pages
                          return (
                            <div
                              key={`page-placeholder-${pageIdx}`}
                              style={{
                                height: pageHeight + PAGE_GAP,
                                width: "100%",
                              }}
                            />
                          );
                        }

                        return (
                          <div
                            key={`page-continuous-${pageIdx}`}
                            data-page-index={pageIdx}
                            style={{
                              position: "relative",
                              width: maxOverhangs.left + viewerWidth * zoomLevel + maxOverhangs.right,
                              minHeight: pageHeight,
                              marginBottom: PAGE_GAP,
                              overflow: "visible",
                            }}
                          >
                            <div
                              style={{
                                position: "absolute",
                                left: maxOverhangs.left,
                                top: 0,
                                width: viewerWidth * zoomLevel,
                                overflow: "visible",
                                outline: "1px solid #d1d5db",
                              }}
                            >
                              <Page
                                pageNumber={pageIdx + 1}
                                width={viewerWidth * zoomLevel}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                                onRenderSuccess={handlePageRenderSuccess}
                                onRenderError={(error: Error) => console.debug('Page onRenderError:', error)}
                                onLoadError={(error: Error) => console.debug('Page onLoadError:', error)}
                              />
                              <div
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  top: 0,
                                  right: 0,
                                  bottom: 0,
                                  pointerEvents: isEditingDisabled ? "none" : "auto",
                                  zIndex: 10,
                                  cursor: isEditingDisabled
                                    ? "default"
                                    : isManualSelectionMode
                                      ? "crosshair"
                                      : "grab",
                                }}
                                data-document-viewer="true"
                                data-page-index={pageIdx}
                                onMouseDown={
                                  isEditingDisabled ? undefined : isManualSelectionMode ? handleMouseDownForAddingManualIssue : handlePanMouseDown
                                }
                                onMouseMove={
                                  isEditingDisabled ? undefined : isManualSelectionMode ? handleMouseMoveForAddingManualIssue : handlePanMouseMove
                                }
                                onMouseUp={
                                  isEditingDisabled ? undefined : isManualSelectionMode ? handleMouseUpForAddingManualIssue : handlePanMouseUp
                                }
                              >
                                {(currentReport || pendingNewCheck) && pageGeo &&
                                  documentPagesToDisplayImageDimensions[pageIdx]?.height > 0 && (
                                    <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
                                      {import.meta.env.DEV && showDebug && currentRevisionPages[pageIdx] && (
                                        <DebugGrid
                                          pageInfo={currentRevisionPages[pageIdx]}
                                          scaleCoordinatesToCurrentViewer={scaleCoordinatesToCurrentViewer}
                                          currentPageIndex={pageIdx}
                                        />
                                      )}
                                      <HighlightOverlay
                                        pageHighlights={pageGeo.pageHighlights}
                                        labelPlacements={pageGeo.labelPlacements}
                                        useAdjacentLabels={pageGeo.useAdjacentLabels}
                                        renderedPageWidth={pageGeo.renderedPageWidth}
                                        renderedPageHeight={pageGeo.renderedPageHeight}
                                        effectiveFontSize={pageGeo.effectiveFontSize}
                                        effectivePadding={pageGeo.effectivePadding}
                                        overhangTop={pageGeo.overhangTop}
                                        overhangRight={pageGeo.overhangRight}
                                        overhangBottom={pageGeo.overhangBottom}
                                        overhangLeft={pageGeo.overhangLeft}
                                        selectedCheckId={selectedCheckId}
                                        hoveredCheckId={hoveredCheckId}
                                        hoveredElementType={hoveredElementType}
                                        currentPageIndex={pageIdx}
                                        currentReport={currentReport}
                                        pendingNewCheck={pendingNewCheck}
                                        inlineEditCheckId={inlineEditCheckId}
                                        inlineEditorSize={inlineEditorSize}
                                        overlappingHighlights={overlappingHighlights}
                                        currentOverlapIndex={currentOverlapIndex}
                                        labelFontScale={labelFontScale}
                                        fontFamily={fontFamily}
                                        highlightMode={highlightMode}
                                        isDraggingHighlight={isDraggingHighlight}
                                        isResizingHighlight={isResizingHighlight}
                                        draggingLabelId={draggingLabelId}
                                        isResizingLabel={isResizingLabel}
                                        resizeLabelCheckId={resizeLabelCheckId}
                                        resizeLabelHandle={resizeLabelHandle}
                                        isEditingDisabled={isEditingDisabled}
                                        scaleCoordinatesToCurrentViewer={scaleCoordinatesToCurrentViewer}
                                        doRectanglesIntersect={doRectanglesIntersect}
                                        findHighlightsAtPoint={findHighlightsAtPoint}
                                        getCheckRuleId={getCheckRuleId}
                                        handleHighlightMouseDown={handleHighlightMouseDown}
                                        handleHighlightTouchStart={handleHighlightTouchStart}
                                        handleResizeMouseDown={handleResizeMouseDown}
                                        handleResizeTouchStart={handleResizeTouchStart}
                                        handleHighlightClick={handleHighlightClick}
                                        handleLabelDragStart={handleLabelDragStart}
                                        handleLabelTouchDragStart={handleLabelTouchDragStart}
                                        handleLabelResizeMouseDown={handleLabelResizeMouseDown}
                                        handleLabelResizeTouchStart={handleLabelResizeTouchStart}
                                        handleInlineEditorResizeStart={handleInlineEditorResizeStart}
                                        openInlineEditor={openInlineEditor}
                                        closeInlineEditor={closeInlineEditor}
                                        handleSaveCheck={handleSaveCheck}
                                        handleCreateCheck={handleCreateCheck}
                                        handleDeleteCheckFromInline={handleDeleteCheckFromInline}
                                        setHoveredCheckId={setHoveredCheckId}
                                        setHoveredElementType={setHoveredElementType}
                                        currentEnvelopeRevision={currentEnvelopeRevision ?? null}
                                        currentEnvelope={currentEnvelope}
                                        onEditRule={handleEditRule}
                                        onEditChecklistRule={handleEditChecklistRule}
                                        onViewRevisionChanges={() => setShowPageDiffs(true)}
                                        onViewChecklistRules={() => { setChecklistDialogInitialTab("checklist"); handleViewChecklist(); }}
                                        onViewEnvelopeRules={() => { setChecklistDialogInitialTab("envelope"); handleViewChecklist(); }}
                                        onToggleCheckPassed={quickToggleCheckPassed}
                                        draggedLabelPositionsRef={draggedLabelPositionsRef}
                                        onScrollToPage={scrollToPage}
                                      />
                                    </div>
                                  )}
                                {isManualSelectionMode &&
                                  isSelecting &&
                                  (() => {
                                    const selection = getCurrentSelection();
                                    return selection ? (
                                      <div
                                        className="absolute border-2 border-dashed border-blue-500 bg-blue-200 bg-opacity-20 pointer-events-none"
                                        style={{
                                          left: `${selection.x1}px`,
                                          top: `${selection.y1}px`,
                                          width: `${getWidth(selection)}px`,
                                          height: `${getHeight(selection)}px`,
                                          zIndex: 60,
                                        }}
                                      />
                                    ) : null;
                                  })()}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (numPages || (pdfDocumentFile && !isProcessingInput)) ? (
                    /* --- Single page mode (original rendering) --- */
                    <div
                      ref={sizerRef}
                      style={{
                        width: labelGeometry.overhangLeft + viewerWidth * zoomLevel + labelGeometry.overhangRight,
                        minHeight: labelGeometry.overhangTop + labelGeometry.renderedPageHeight + labelGeometry.overhangBottom,
                        position: "relative",
                        margin: "0 auto",
                      }}
                    >
                      <div
                        ref={contentWrapperRef}
                        style={{
                          position: "absolute",
                          left: labelGeometry.overhangLeft,
                          top: labelGeometry.overhangTop,
                          width: viewerWidth * zoomLevel,
                          overflow: "visible",
                          outline: "1px solid #d1d5db",
                        }}
                      >
                        <Page
                          pageNumber={currentPageIndex + 1}
                          width={viewerWidth * zoomLevel}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                          onRenderSuccess={handlePageRenderSuccess}
                          onRenderError={(error: Error) => console.debug('Page onRenderError:', error)}
                          onLoadError={(error: Error) => console.debug('Page onLoadError:', error)}
                        />
                        <div
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            right: 0,
                            bottom: 0,
                            pointerEvents: isEditingDisabled ? "none" : "auto",
                            zIndex: 10,
                            cursor: isEditingDisabled
                              ? "default"
                              : isManualSelectionMode
                                ? "crosshair"
                                : "grab",
                          }}
                          data-document-viewer="true"
                          onMouseDown={
                            isEditingDisabled ? undefined : isManualSelectionMode ? handleMouseDownForAddingManualIssue : handlePanMouseDown
                          }
                          onMouseMove={
                            isEditingDisabled ? undefined : isManualSelectionMode ? handleMouseMoveForAddingManualIssue : handlePanMouseMove
                          }
                          onMouseUp={
                            isEditingDisabled ? undefined : isManualSelectionMode ? handleMouseUpForAddingManualIssue : handlePanMouseUp
                          }
                        >
                          {/* Overlay for highlighted areas (also shown when adding a pending issue without a report) */}
                          {(currentReport || pendingNewCheck) &&
                            documentPagesToDisplayImageDimensions[
                              currentPageIndex
                            ]?.height > 0 && (
                              <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
                                {/* Debug grid - only shown when debugging is enabled */}
                                {import.meta.env.DEV && showDebug && currentRevisionPages[currentPageIndex] && (
                                  <DebugGrid
                                    pageInfo={currentRevisionPages[currentPageIndex]}
                                    scaleCoordinatesToCurrentViewer={scaleCoordinatesToCurrentViewer}
                                    currentPageIndex={currentPageIndex}
                                  />
                                )}
                                {/* Render all highlight overlays on top of the document */}
                                <HighlightOverlay
                                  pageHighlights={labelGeometry.pageHighlights}
                                  labelPlacements={labelGeometry.labelPlacements}
                                  useAdjacentLabels={labelGeometry.useAdjacentLabels}
                                  renderedPageWidth={labelGeometry.renderedPageWidth}
                                  renderedPageHeight={labelGeometry.renderedPageHeight}
                                  effectiveFontSize={labelGeometry.effectiveFontSize}
                                  effectivePadding={labelGeometry.effectivePadding}
                                  overhangTop={labelGeometry.overhangTop}
                                  overhangRight={labelGeometry.overhangRight}
                                  overhangBottom={labelGeometry.overhangBottom}
                                  overhangLeft={labelGeometry.overhangLeft}
                                  selectedCheckId={selectedCheckId}
                                  hoveredCheckId={hoveredCheckId}
                                  hoveredElementType={hoveredElementType}
                                  currentPageIndex={currentPageIndex}
                                  currentReport={currentReport}
                                  pendingNewCheck={pendingNewCheck}
                                  inlineEditCheckId={inlineEditCheckId}
                                  inlineEditorSize={inlineEditorSize}
                                  overlappingHighlights={overlappingHighlights}
                                  currentOverlapIndex={currentOverlapIndex}
                                  labelFontScale={labelFontScale}
                                  fontFamily={fontFamily}
                                  highlightMode={highlightMode}
                                  isDraggingHighlight={isDraggingHighlight}
                                  isResizingHighlight={isResizingHighlight}
                                  draggingLabelId={draggingLabelId}
                                  isResizingLabel={isResizingLabel}
                                  resizeLabelCheckId={resizeLabelCheckId}
                                  resizeLabelHandle={resizeLabelHandle}
                                  isEditingDisabled={isEditingDisabled}
                                  scaleCoordinatesToCurrentViewer={scaleCoordinatesToCurrentViewer}
                                  doRectanglesIntersect={doRectanglesIntersect}
                                  findHighlightsAtPoint={findHighlightsAtPoint}
                                  getCheckRuleId={getCheckRuleId}
                                  handleHighlightMouseDown={handleHighlightMouseDown}
                                  handleHighlightTouchStart={handleHighlightTouchStart}
                                  handleResizeMouseDown={handleResizeMouseDown}
                                  handleResizeTouchStart={handleResizeTouchStart}
                                  handleHighlightClick={handleHighlightClick}
                                  handleLabelDragStart={handleLabelDragStart}
                                  handleLabelTouchDragStart={handleLabelTouchDragStart}
                                  handleLabelResizeMouseDown={handleLabelResizeMouseDown}
                                  handleLabelResizeTouchStart={handleLabelResizeTouchStart}
                                  handleInlineEditorResizeStart={handleInlineEditorResizeStart}
                                  openInlineEditor={openInlineEditor}
                                  closeInlineEditor={closeInlineEditor}
                                  handleSaveCheck={handleSaveCheck}
                                  handleCreateCheck={handleCreateCheck}
                                  handleDeleteCheckFromInline={handleDeleteCheckFromInline}
                                  setHoveredCheckId={setHoveredCheckId}
                                  setHoveredElementType={setHoveredElementType}
                                  currentEnvelopeRevision={currentEnvelopeRevision ?? null}
                                  currentEnvelope={currentEnvelope}
                                  onEditRule={handleEditRule}
                                  onEditChecklistRule={handleEditChecklistRule}
                                  onViewRevisionChanges={() => setShowPageDiffs(true)}
                                  onViewChecklistRules={() => { setChecklistDialogInitialTab("checklist"); handleViewChecklist(); }}
                                  onViewEnvelopeRules={() => { setChecklistDialogInitialTab("envelope"); handleViewChecklist(); }}
                                  onToggleCheckPassed={quickToggleCheckPassed}
                                  draggedLabelPositionsRef={draggedLabelPositionsRef}
                                  onScrollToPage={scrollToPage}
                                />
                              </div>
                            )}
                          {/* Selection rectangle — rendered independently of report overlay */}
                          {isManualSelectionMode &&
                            isSelecting &&
                            (() => {
                              const selection = getCurrentSelection();
                              return selection ? (
                                <div
                                  className="absolute border-2 border-dashed border-blue-500 bg-blue-200 bg-opacity-20 pointer-events-none"
                                  style={{
                                    left: `${selection.x1}px`,
                                    top: `${selection.y1}px`,
                                    width: `${getWidth(selection)}px`,
                                    height: `${getHeight(selection)}px`,
                                    zIndex: 60,
                                  }}
                                />
                              ) : null;
                            })()}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </Document>
              ) : (
                <div className="flex justify-center items-center p-8">
                  <div className="text-muted-foreground">
                    Preparing file for display...
                  </div>
                </div>
              )}

            </div>
          </div>

          {features.diff_viewer && showPageDiffs && (
            allDiffRevisions.length >= 1 && allDiffRevisions.some(r => r.hasPageTexts) ? (
              <PageDiffViewer
                allRevisions={allDiffRevisions}
                initialPreviousIndex={allDiffRevisions.length >= 2 ? Math.max(0, currentEnvelope!.current_revision_index - 1) : 0}
                initialCurrentIndex={currentEnvelope!.current_revision_index}
                onClose={() => setShowPageDiffs(false)}
              />
            ) : (
              <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowPageDiffs(false)}>
                <div className="absolute inset-0 bg-black/40" />
                <div className="relative bg-background rounded-lg shadow-xl p-6" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">Revision Changes</h3>
                    <button onClick={() => setShowPageDiffs(false)} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-muted-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Page text extraction is not available for one of the revisions.
                    Re-run the review on both revisions to enable change comparison.
                  </p>
                </div>
              </div>
            )
          )}

          {import.meta.env.DEV && showDebug && (
            <>
              {/* Coordinate scale multipliers — diagnose compression per axis */}
              <div className="mb-2 p-3 bg-orange-50 border border-orange-300 rounded-lg flex flex-col gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-sm font-medium text-orange-800 whitespace-nowrap w-8">X:</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="5"
                    value={debugScaleMultiplierX}
                    onChange={(e) => setDebugScaleMultiplierX(parseFloat(e.target.value) || 1.0)}
                    className="w-20 px-2 py-1 text-sm border border-orange-300 rounded bg-white text-orange-900 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  <input
                    type="range"
                    step="0.01"
                    min="0.5"
                    max="2.5"
                    value={debugScaleMultiplierX}
                    onChange={(e) => setDebugScaleMultiplierX(parseFloat(e.target.value))}
                    className="w-32"
                  />
                  <span className="text-xs text-orange-600">{debugScaleMultiplierX.toFixed(2)}x</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-sm font-medium text-orange-800 whitespace-nowrap w-8">Y:</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="5"
                    value={debugScaleMultiplierY}
                    onChange={(e) => setDebugScaleMultiplierY(parseFloat(e.target.value) || 1.0)}
                    className="w-20 px-2 py-1 text-sm border border-orange-300 rounded bg-white text-orange-900 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  <input
                    type="range"
                    step="0.01"
                    min="0.5"
                    max="2.5"
                    value={debugScaleMultiplierY}
                    onChange={(e) => setDebugScaleMultiplierY(parseFloat(e.target.value))}
                    className="w-32"
                  />
                  <span className="text-xs text-orange-600">{debugScaleMultiplierY.toFixed(2)}x</span>
                </div>
                <div className="flex items-center gap-2">
                  {(debugScaleMultiplierX !== 1.0 || debugScaleMultiplierY !== 1.0) && (
                    <button
                      type="button"
                      onClick={() => { setDebugScaleMultiplierX(1.0); setDebugScaleMultiplierY(1.0); }}
                      className="text-xs px-2 py-0.5 bg-orange-200 hover:bg-orange-300 rounded text-orange-800"
                    >
                      Reset Both
                    </button>
                  )}
                  {documentPagesToDisplayImageDimensions[currentPageIndex] && (
                    <span className="text-xs text-orange-500">
                      page orig_w={documentPagesToDisplayImageDimensions[currentPageIndex].original_width}
                      {currentRevisionPages[currentPageIndex] && (
                        <> img={currentRevisionPages[currentPageIndex].width}x{currentRevisionPages[currentPageIndex].height}
                          {' '}orig={currentRevisionPages[currentPageIndex].original_width}x{currentRevisionPages[currentPageIndex].original_height}
                          {' '}sf={currentRevisionPages[currentPageIndex].scaling_factor?.toFixed(3)}
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>
              <DebugPanel
                currentChecklist={currentChecklist}
                currentEnvelope={currentEnvelope}
                currentEnvelopeRevision={currentEnvelopeRevision ?? null}
                currentReport={currentReport}
                previousReport={previousReport}
                inspectionReportChecklist={inspectionReportChecklist}
                isReadOnlyRevision={isReadOnlyRevision}
                debugInfoData={debugInfoData}
                revdokuDocApiElapsedMs={revdokuDocApiElapsedMs}
              />
            </>
          )}

          <div className="mt-auto">
            <AppFooter appVersion={appVersion} appRevision={appRevision} />
          </div>
        </div>}

      </div>

      {/* Report Popup */}
      {showReportPopup && (
        <ReportPopup
          currentReport={currentReport}
          reportContent={reportContent}
          reportLoading={reportLoading}
          checkFilter={reportCheckFilter}
          setCheckFilter={setReportCheckFilter}
          reportLayoutMode={reportLayoutMode}
          setReportLayoutMode={setReportLayoutMode}
          showAnnotations={reportShowAnnotations}
          setShowAnnotations={setReportShowAnnotations}
          generateReport={generateReport}
          fontScale={reportFontScale}
          setFontScale={setReportFontScale}
          fontFamily={reportFontFamily}
          setFontFamily={setReportFontFamily}
          highlightMode={highlightMode}
          formatReportAsText={formatReportAsText}
          onClose={() => setShowReportPopup(false)}
          showOnboardingHints={showOnboardingHints}
          envelopeId={currentEnvelope?.id}
          envelopeTitle={currentEnvelope?.title}
          hasPreviousReport={!!previousReport}
          alignLabelsToTop={alignLabelsToTop}
          onAlignLabelsToTopChange={setAlignLabelsToTop}
          onExportChecksCsv={() => {
            if (currentReport?.checks?.length) {
              const fileNames = (currentEnvelope?.document_files || []).map((f: any) => f.document_file_revisions?.[0]?.name || f.name || '').filter(Boolean);
              import('@/lib/checks-csv-export').then(m => m.openChecksCsvInTab(currentReport.checks, {
                envelopeTitle: currentEnvelope?.title,
                fileNames,
                checklistName: currentChecklist?.name,
                reportDatetime: currentReport.created_at || currentReport.updated_at,
              }));
            }
          }}
        />
      )}

      {/* Manual Check Dialog */}
      <ManualCheckDialog
        open={showManualCheckDialog}
        inspectionReportChecklist={inspectionReportChecklist}
        currentEnvelope={currentEnvelope}
        currentEnvelopeRevision={currentEnvelopeRevision ?? null}
        selectedManualCheckRule={selectedManualCheckRule}
        setSelectedManualCheckRule={setSelectedManualCheckRule}
        isRuleDropdownOpen={isRuleDropdownOpen}
        setIsRuleDropdownOpen={setIsRuleDropdownOpen}
        newRuleText={newRuleText}
        setNewRuleText={setNewRuleText}
        manualCheckMessage={manualCheckMessage}
        setManualCheckMessage={setManualCheckMessage}
        isMessageManuallyEdited={isMessageManuallyEdited}
        setIsMessageManuallyEdited={setIsMessageManuallyEdited}
        onSubmit={handleAddManualCheck}
        onClose={() => {
          setShowManualCheckDialog(false);
          setSelectedArea(null);
          setIsManualSelectionMode(false);
          setSelectedManualCheckRule(null);
          setIsRuleDropdownOpen(false);
          setNewRuleText("");
          setManualCheckMessage("");
          setIsMessageManuallyEdited(false);
        }}
      />

      {/* Custom Script Editor Dialog */}
      <CustomScriptDialog
        isOpen={showCustomScriptDialog}
        onClose={() => setShowCustomScriptDialog(false)}
        onSave={handleSaveUserScript1}
        initialCode={currentEnvelope?.user_scripts?.[0]?.code}
      />

      {/* Hidden file input for quick file picking on empty envelopes */}
      <input
        ref={quickFileInputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"
        onChange={handleQuickFileSelect}
        tabIndex={-1}
        style={{ position: 'fixed', top: '-9999px', left: '-9999px', opacity: 0 }}
      />

      {/* File Rearrangement Dialog */}
      <FileRearrangeDialog
        isOpen={showFileRearrangeDialog}
        files={inputFiles}
        onClose={handleCloseFileRearrangeDialog}
        onFilesReordered={handleFilesReordered}
        editability={editability}
        onResetReport={handleResetReport}
        createdAtDates={createdAtDates}
        initialNewFiles={quickPickedFiles.length > 0 ? quickPickedFiles : undefined}
        showOnboardingHints={showOnboardingHints}
        envelopeId={currentEnvelope?.id}
        mode={fileRearrangeMode}
        initialComment={fileRearrangeMode === 'edit_current' ? (currentEnvelopeRevision?.comment || '') : undefined}
      />

      {/* ChecklistDialog component */}
      <ChecklistDialog
        checklist={selectedChecklist}
        revisions={selectedChecklistVersions}
        rules={!selectedChecklist || selectedChecklist.checklist_type === 'report_snapshot' ? envelopeUserRules : undefined}
        isOpen={showChecklistDialog}
        onClose={() => { handleCloseChecklistDialog(); setChecklistDialogInitialTab(undefined); }}
        onSave={handleSaveChecklist}
        onSaverules={!selectedChecklist || selectedChecklist.checklist_type === 'report_snapshot' ? handleSaveEnvelopeRules : undefined}
        onDelete={handleDeleteChecklist}
        isEnvelopeContext={!selectedChecklist || selectedChecklist.checklist_type === 'report_snapshot' ? !!envelopeId : false}
        currentRevisionId={currentEnvelopeRevision?.id}
        envelopeRevisions={currentEnvelope?.envelope_revisions}
        editability={editability}
        ruleKeysWithChecks={ruleKeysWithChecks}
        showOnboardingHints={showChecklistOnboardingHints}
        initialTab={checklistDialogInitialTab}
        focusRuleId={checklistDialogFocusRuleId}
        isNewlyCreated={justCreatedChecklistId != null}
        rulesChangedSinceReview={rulesChangedSinceReview}
        inspectedUserRules={inspectedUserRulesMap}
        envelopeTitle={currentEnvelope?.title}
      />

      {/* Quick create checklist from text (envelope context) */}
      <AddChecklistDialog
        isOpen={showAddChecklistDialog}
        onClose={() => {
          setShowAddChecklistDialog(false);
          setGenerateChecklistError(null);
          setPendingSourceText('');
          if (reopenReviewDialogRef.current) {
            reopenReviewDialogRef.current = false;
            setSelectAIDialogState({});
          }
        }}
        onGenerate={handleGenerateNewChecklist}
        onCreateFromTemplate={handleCreateFromTemplate}
        onNeedAIModel={handleNeedAIModel}
        isProcessing={isGeneratingChecklist}
        error={generateChecklistError}
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
          setShowAddChecklistDialog(true);
        }}
        isProcessing={isGeneratingChecklist}
        purpose="checklist_generation"
        showManualOption={true}
      />



      {/* Duplicate Envelope Dialog */}
      <DuplicateEnvelopeDialog
        open={showDuplicateDialog}
        onOpenChange={setShowDuplicateDialog}
        isLoading={isLoadingEnvelope}
        onConfirm={async (copyMode) => {
          if (!currentEnvelope?.id) return;
          try {
            setIsLoadingEnvelope(true);
            const result = await ApiClient.duplicateEnvelope(currentEnvelope.id, copyMode);
            showToast(result.message || "Envelope duplicated successfully", "success");
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to duplicate envelope";
            showToast(errorMessage, "error");
            console.error("Duplicate envelope error:", err);
          } finally {
            setIsLoadingEnvelope(false);
            setShowDuplicateDialog(false);
          }
        }}
      />

      <ReviewCustomDialog
        envelopeId={currentEnvelope?.id}
        isOpen={!!selectAIDialogState}
        onClose={() => { setSelectAIDialogState(null); reviewDialogChecklistIdRef.current = null; }}
        onReview={({ modelId, trackChanges, checklistId, highlightMode, referenceFiles, reviewNote, adHocRefFiles, refFilesTotal }) => {
          setSelectAIDialogState(null);
          reviewDialogChecklistIdRef.current = null;
          if (checklistId) setSelectedChecklistId(checklistId);

          // Give feedback about script propagation. Backend (ReportCreationService#copy_checklist_scripts_to_envelope)
          // already performs the copy on successful inspection when the envelope has no scripts.
          const chosenChecklist = latestChecklists.find(c => c.id === checklistId) || currentChecklist;
          const checklistHasScript = !!chosenChecklist?.user_scripts?.[0]?.code?.trim();
          const envelopeScript = currentEnvelope?.user_scripts?.[0];
          const envelopeHasScript = !!envelopeScript?.code?.trim();
          if (checklistHasScript && envelopeHasScript) {
            showToast(
              "Checklist's script was not applied because the envelope already has its own script.",
              'info',
              5000
            );
          } else if (checklistHasScript && !envelopeHasScript) {
            showToast("Checklist's script will be applied to this envelope.", 'info');
          }

          handleInspect({ ai_model: modelId, track_changes: trackChanges, highlight_mode: highlightMode, force: true, checklist_id: checklistId, reference_files: referenceFiles, review_note: reviewNote, ad_hoc_ref_files: adHocRefFiles, ref_files_total: refFilesTotal });
        }}
        currentChecklist={currentChecklist}
        latestChecklists={latestChecklists}
        defaultModelId={currentChecklist?.ai_model}
        title={selectAIDialogState?.title}
        errorMessage={selectAIDialogState?.errorMessage}
        submitLabel={selectAIDialogState?.submitLabel}
        variant={selectAIDialogState?.variant}
        pageCount={numPages}
        defaultChecklistId={reviewDialogChecklistIdRef.current}
        existingRefFiles={(currentReport as any)?.ref_files_meta?.map((r: any) => ({
          rule_id: r.rule_id ?? null,
          document_file_revision_prefix_id: r.document_file_revision_prefix_id,
          filename: r.filename || r.description || r.document_file_revision_prefix_id,
        })) || []}
        // Pre-fill source for the Review dialog's "Add note" section.
        // When `currentReport` has a completed review (has a checklist
        // snapshot), use its note + ad-hoc refs so re-runs preserve
        // what the user entered — including a deliberately cleared
        // note. When `currentReport` is absent or a pre-inspection
        // stub (no checklist — typical for a freshly-created
        // revision), fall back to `previousReport` so the user
        // doesn't have to re-type their note or re-attach the same
        // reference file across successive revisions.
        existingReviewNote={
          ((currentReport as any)?.checklist
            ? (currentReport as any)
            : (previousReport as any))?.review_note ?? null
        }
        existingAdHocRefFiles={
          ((currentReport as any)?.checklist
            ? (currentReport as any)
            : (previousReport as any))?.ad_hoc_ref_files ?? []
        }
        onCreateChecklist={() => {
          setSelectAIDialogState(null);
          reopenReviewDialogRef.current = true;
          setShowAddChecklistDialog(true);
        }}
        onViewChecklist={(checklistId) => {
          reviewDialogChecklistIdRef.current = checklistId;
          reopenReviewDialogRef.current = true;
          openedFromReviewDialogRef.current = true;
          // Sync-first: the Review dialog already has this checklist in
          // its list (the user just picked it from the dropdown), so
          // populate + mount the ChecklistDialog atomically in one
          // React batch. The earlier async-first flow left a gap where
          // neither dialog was visible — on any network hiccup that
          // looked like "the dialog disappeared" to the user.
          const sync = latestChecklists.find(c => c.id === checklistId) || currentChecklist;
          if (sync) setSelectedChecklist(sync);
          setSelectAIDialogState(null);
          setShowChecklistDialog(true);
          // Background refresh picks up any server-side edits without
          // blocking the transition. Failure keeps the sync copy in
          // place so the dialog stays populated.
          void ApiClient.getChecklist(checklistId)
            .then(({ checklist }) => setSelectedChecklist(checklist))
            .catch(() => { /* keep sync copy */ });
        }}
        isChecklistLocked={!isFirstRevision && !!previousReport?.checklist?.name}
        lockedChecklistName={previousReport?.checklist?.name}
        lockedChecklistRuleCount={previousReport?.checklist?.rules?.filter((r: IRule) => r.origin === 'checklist').length}
        previousPassedCount={previousReport?.checks?.filter((c: ICheck) => c.passed).length}
        previousFailedCount={previousReport?.checks?.filter((c: ICheck) => !c.passed).length}
        envelopeRuleCount={envelopeUserRules.length}
        // Catch-changes checkbox lives on revisions 2+ only — nothing to
        // diff against on the first revision.
        hasPreviousRevision={!isFirstRevision}
        // Seed the checkbox from the last report's inspection_context so
        // re-opening the Review dialog preserves the user's choice.
        // Prefer currentReport's snapshot (this revision's last run); on
        // a fresh revision with no report yet, fall back to previousReport.
        existingTrackChanges={
          (currentReport as any)?.checklist?.track_changes
          ?? (previousReport as any)?.checklist?.track_changes
          ?? null
        }
      />

    </div>
  );
}
