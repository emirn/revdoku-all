import { useState, useEffect, useRef } from "react";
import { renderMustache } from "@revdoku/lib";
import type {
  IReport,
  IEnvelope,
  IEnvelopeRevision,
  IChecklist,
  IDocumentFile,
  LabelFontFamily,
  HighlightMode,
} from "@revdoku/lib";
import {
  ReportLayoutMode,
  getFilesWithOnlyRelatedFileRevisionsForEnvelopeRevision,
  CheckFilterType,
} from "@revdoku/lib";
import type { CheckFilter } from "@/components/envelope-page/CheckNavigator";
import { ApiClient } from "@/lib/api-client";
import { showToast } from "@/lib/toast";

export interface UseReportOptionsParams {
  currentReport: IReport | null;
  currentEnvelope: IEnvelope | null;
  currentEnvelopeRevision: IEnvelopeRevision | null;
  currentChecklist: IChecklist | null;
  checkFilter: CheckFilter;
  envelopeId: string | null;
  trackSave: <T>(promise: Promise<T>) => Promise<T>;
  pageFontScales: Record<number, number>;
  fontFamily: LabelFontFamily;
  highlightMode: HighlightMode;
  saveFontScaleImmediately: () => Promise<void>;
  alignLabelsToTop: boolean;
}

export type ReportOptionKey =
  | 'show_checklist_name' | 'show_rules' | 'show_audit_logs'
  | 'show_title_info' | 'show_compliance_summary' | 'show_compliance_percent' | 'show_default_footer'
  | 'show_page_images' | 'show_check_details' | 'show_extracted_data'
  | 'show_pages_with_checks' | 'show_pages_without_checks'
  | 'show_checklist_info' | 'show_checklist_general_prompt'
  | 'show_checklist_rules_summary' | 'show_checklist_rules_details'
  | 'show_checklist_envelope_rules'
  | 'show_timezone' | 'show_revision_comparison' | 'show_check_attribution'
  | 'show_envelope_datetime' | 'show_envelope_revisions_info'
  | 'show_checklist_ai_model'
  | 'show_page_filenames' | 'show_page_summary_icons'
  | 'show_group_header' | 'show_group_checklist' | 'show_group_pages' | 'show_group_footer'
  | 'show_checklist_ai_model_details' | 'show_document_history' | 'show_tags'
  | 'show_user_js_1_output';

export function useReportOptions({
  currentReport,
  currentEnvelope,
  currentEnvelopeRevision,
  currentChecklist,
  checkFilter,
  envelopeId,
  trackSave,
  pageFontScales,
  fontFamily,
  highlightMode,
  saveFontScaleImmediately,
  alignLabelsToTop,
}: UseReportOptionsParams) {
  // --- Report popup state ---
  const [showReportPopup, setShowReportPopup] = useState(false);
  const [reportContent, setReportContent] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const reportHtmlCacheRef = useRef<Map<string, string>>(new Map());

  // --- Report display option states ---
  const [reportIncludeRules, setReportIncludeRules] = useState(false);
  const [reportIncludeTechnicalInfo, setReportIncludeTechnicalInfo] = useState(false);
  const [reportLayoutMode, setReportLayoutMode] = useState<ReportLayoutMode>('compact');
  const [reportShowChecklistName, setReportShowChecklistName] = useState(false);
  const [reportShowTitleInfo, setReportShowTitleInfo] = useState(true);
  const [reportShowComplianceSummary, setReportShowComplianceSummary] = useState(false);
  const [reportShowCompliancePercent, setReportShowCompliancePercent] = useState(true);
  const [reportShowDefaultFooter, setReportShowDefaultFooter] = useState(true);
  const [reportShowAnnotations, setReportShowAnnotations] = useState(true);
  const [reportShowPagesWithChecks, setReportShowPagesWithChecks] = useState(true);
  const [reportShowPagesWithoutChecks, setReportShowPagesWithoutChecks] = useState(true);
  const [reportShowPageImages, setReportShowPageImages] = useState(true);
  const [reportShowCheckDetails, setReportShowCheckDetails] = useState(true);
  // Off by default — raw `val=...` badges are diagnostic detail that most
  // readers don't need. Power users opt in via the gear menu.
  const [reportShowExtractedData, setReportShowExtractedData] = useState(false);
  const [reportShowChecklistInfo, setReportShowChecklistInfo] = useState(true);
  const [reportShowChecklistGeneralPrompt, setReportShowChecklistGeneralPrompt] = useState(true);
  const [reportShowChecklistRulesSummary, setReportShowChecklistRulesSummary] = useState(true);
  const [reportShowChecklistRulesDetails, setReportShowChecklistRulesDetails] = useState(true);
  const [reportShowChecklistEnvelopeRules, setReportShowChecklistEnvelopeRules] = useState(true);
  const [reportShowTimezone, setReportShowTimezone] = useState(true);
  const [reportShowRevisionComparison, setReportShowRevisionComparison] = useState(true);
  const [reportShowCheckAttribution, setReportShowCheckAttribution] = useState(false);
  const [reportShowEnvelopeDatetime, setReportShowEnvelopeDatetime] = useState(true);
  const [reportShowEnvelopeRevisionsInfo, setReportShowEnvelopeRevisionsInfo] = useState(true);
  const [reportShowChecklistAiModel, setReportShowChecklistAiModel] = useState(false);
  const [reportShowPageFilenames, setReportShowPageFilenames] = useState(true);
  const [reportShowPageSummaryIcons, setReportShowPageSummaryIcons] = useState(true);
  const [reportShowGroupHeader, setReportShowGroupHeader] = useState(true);
  const [reportShowGroupChecklist, setReportShowGroupChecklist] = useState(false);
  const [reportShowGroupPages, setReportShowGroupPages] = useState(true);
  const [reportShowGroupFooter, setReportShowGroupFooter] = useState(true);
  const [reportShowChecklistAiModelDetails, setReportShowChecklistAiModelDetails] = useState(false);
  const [reportShowDocumentHistory, setReportShowDocumentHistory] = useState(false);
  const [reportShowTags, setReportShowTags] = useState(true);
  const [reportShowUserJs1Output, setReportShowUserJs1Output] = useState(true);
  const [reportFontScale, setReportFontScale] = useState(1.0);
  const [reportFontFamily, setReportFontFamily] = useState<LabelFontFamily>('sans-serif');
  const [reportCheckFilter, setReportCheckFilter] = useState<CheckFilter>(CheckFilterType.FAILED_AND_CHANGES);

  // --- Initialize report options from envelope settings ---
  useEffect(() => {
    if (currentEnvelope?.report_settings) {
      setReportShowChecklistName(currentEnvelope.report_settings.show_checklist_name ?? false);
      setReportIncludeRules(currentEnvelope.report_settings.show_rules ?? false);
      setReportIncludeTechnicalInfo(currentEnvelope.report_settings.show_audit_logs ?? false);
      setReportShowTitleInfo(currentEnvelope.report_settings.show_title_info ?? true);
      setReportShowComplianceSummary(currentEnvelope.report_settings.show_compliance_summary ?? false);
      setReportShowCompliancePercent((currentEnvelope.report_settings as any).show_compliance_percent ?? true);
      setReportShowDefaultFooter(currentEnvelope.report_settings.show_default_footer ?? true);
      setReportShowPageImages(currentEnvelope.report_settings.show_page_images ?? true);
      setReportShowCheckDetails(currentEnvelope.report_settings.show_check_details ?? true);
      setReportShowExtractedData((currentEnvelope.report_settings as any).show_extracted_data ?? false);
      setReportShowPagesWithChecks(currentEnvelope.report_settings.show_pages_with_checks ?? true);
      setReportShowPagesWithoutChecks(currentEnvelope.report_settings.show_pages_without_checks ?? true);
      setReportShowChecklistInfo(currentEnvelope.report_settings.show_checklist_info ?? true);
      setReportShowChecklistGeneralPrompt(currentEnvelope.report_settings.show_checklist_general_prompt ?? true);
      setReportShowChecklistRulesSummary(currentEnvelope.report_settings.show_checklist_rules_summary ?? true);
      setReportShowChecklistRulesDetails(currentEnvelope.report_settings.show_checklist_rules_details ?? true);
      setReportShowChecklistEnvelopeRules(currentEnvelope.report_settings.show_checklist_envelope_rules ?? true);
      setReportShowTimezone(currentEnvelope.report_settings.show_timezone ?? true);
      setReportShowRevisionComparison(currentEnvelope.report_settings.show_revision_comparison ?? true);
      setReportShowCheckAttribution(currentEnvelope.report_settings.show_check_attribution ?? false);
      setReportShowEnvelopeDatetime(currentEnvelope.report_settings.show_envelope_datetime ?? true);
      setReportShowEnvelopeRevisionsInfo(currentEnvelope.report_settings.show_envelope_revisions_info ?? true);
      setReportShowChecklistAiModel(currentEnvelope.report_settings.show_checklist_ai_model ?? false);
      setReportShowPageFilenames(currentEnvelope.report_settings.show_page_filenames ?? true);
      setReportShowPageSummaryIcons(currentEnvelope.report_settings.show_page_summary_icons ?? true);
      setReportShowGroupHeader(currentEnvelope.report_settings.show_group_header ?? true);
      setReportShowGroupChecklist(currentEnvelope.report_settings.show_group_checklist ?? false);
      setReportShowGroupPages(currentEnvelope.report_settings.show_group_pages ?? true);
      setReportShowGroupFooter(currentEnvelope.report_settings.show_group_footer ?? true);
      setReportShowChecklistAiModelDetails((currentEnvelope.report_settings as any).show_checklist_ai_model_details ?? false);
      setReportShowDocumentHistory((currentEnvelope.report_settings as any).show_document_history ?? false);
      setReportShowTags((currentEnvelope.report_settings as any).show_tags ?? true);
      setReportShowUserJs1Output((currentEnvelope.report_settings as any).show_user_js_1_output ?? true);
    }
  }, [currentEnvelope?.id]);

  // --- Clear report HTML cache ---
  useEffect(() => {
    reportHtmlCacheRef.current.clear();
  }, [currentReport?.id, currentReport?.checks?.length, currentReport?.updated_at, currentReport?.user_scripts_output]);

  useEffect(() => {
    reportHtmlCacheRef.current.clear();
  }, [envelopeId]);

  useEffect(() => {
    reportHtmlCacheRef.current.clear();
  }, [pageFontScales]);

  // --- Format report as plain text ---
  const formatReportAsText = (): string => {
    if (!currentReport || !currentChecklist) return '';

    const checks = currentReport.checks
      .filter(c => {
        if (checkFilter === 'failed') return !c.passed;
        if (checkFilter === 'passed') return c.passed;
        return true;
      })
      .sort((a, b) => (a.check_index ?? a.rule_order ?? 0) - (b.check_index ?? b.rule_order ?? 0));

    const passed = checks.filter(c => c.passed).length;
    const failed = checks.filter(c => !c.passed).length;

    const lines: string[] = [];
    if (reportShowTitleInfo) {
      lines.push(`Revdoku Report: ${currentEnvelope?.title ?? 'Untitled'}`);
      if (currentEnvelopeRevision) {
        lines.push(`Revision: ${currentEnvelopeRevision.revision_number}`);
      }
    }
    if (reportShowChecklistName) {
      lines.push(`Checklist: ${currentChecklist.name}`);
    }
    lines.push(`Filter: ${checkFilter}`);
    lines.push(`Generated: ${new Date().toLocaleDateString()}`);
    lines.push('========================================');
    if (reportShowComplianceSummary) {
      lines.push('');
      lines.push(`Summary: ${passed} passed, ${failed} failed out of ${checks.length} checks`);
    }

    // Group by page
    const byPage = new Map<number, typeof checks>();
    for (const check of checks) {
      const page = check.page + 1; // 0-based to 1-based
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page)!.push(check);
    }

    for (const [page, pageChecks] of byPage) {
      lines.push('');
      lines.push(`--- Page ${page} ---`);
      lines.push('');
      for (const check of pageChecks) {
        const idx = check.check_index ?? ((check.rule_order ?? 0) + 1);
        const status = check.passed ? 'PASS' : 'FAIL';
        const ruleText = reportIncludeRules && check.rule_prompt ? ` - Rule: ${check.rule_prompt}` : '';
        lines.push(`[${status}] #${idx}${ruleText}`);
        if (check.description) {
          lines.push(`  Check: ${check.description}`);
        }
      }
    }

    lines.push('');
    if (reportShowDefaultFooter) {
      lines.push('Generated by Revdoku');
    }
    lines.push('========================================');
    return lines.join('\n');
  };

  // --- Generate HTML report via API ---
  const generateReport = async (
    customLayoutMode?: ReportLayoutMode,
    overrideCheckFilter?: CheckFilter,
    overrideShowAnnotations?: boolean,
    overrideFontScale?: number,
    overrideFontFamily?: LabelFontFamily,
    overrideHighlightMode?: HighlightMode,
  ) => {
    if (!currentReport || !currentEnvelopeRevision || !currentEnvelopeRevision.document_file_revision_links || currentEnvelopeRevision.document_file_revision_links.length === 0) {
      console.warn("No review report or input file: can not generate report");
      return "";
    }

    // Initialize report font family from viewer on first open (ephemeral)
    if (!showReportPopup && overrideFontFamily === undefined) {
      setReportFontFamily(fontFamily);
    }

    // Flush any pending font scale save before export
    await saveFontScaleImmediately();

    const activeCheckFilter = overrideCheckFilter ?? reportCheckFilter;
    const activeShowAnnotations = overrideShowAnnotations !== undefined ? overrideShowAnnotations : reportShowAnnotations;
    const activeFontScale = overrideFontScale !== undefined ? overrideFontScale : reportFontScale;
    const activeFontFamily = overrideFontFamily ?? reportFontFamily;
    const activeHighlightMode = overrideHighlightMode ?? highlightMode;
    const layoutMode = customLayoutMode !== undefined ? customLayoutMode : reportLayoutMode;

    const document_filesWithRelatedFileRevisionsOnly: IDocumentFile[] = getFilesWithOnlyRelatedFileRevisionsForEnvelopeRevision(currentEnvelope?.document_files || [], currentEnvelopeRevision.document_file_revision_links || []);

    if (!document_filesWithRelatedFileRevisionsOnly || document_filesWithRelatedFileRevisionsOnly.length === 0) {
      throw new Error("No files with related file revisions only found in the source document");
    }

    if (import.meta.env.DEV) console.debug(`generating report as html with layout mode ${layoutMode}`);

    // Cache key only includes layout mode — all other rendering preferences are client-side via postMessage.
    const cacheKey = `${currentReport.id}_${layoutMode}`;
    const cached = reportHtmlCacheRef.current.get(cacheKey);
    if (cached) {
      if (import.meta.env.DEV) console.debug(`report cache hit: ${cacheKey}`);
      setReportContent(cached);
      setShowReportPopup(true);
      return;
    }

    // Show dialog immediately with loading state
    setShowReportPopup(true);
    setReportLoading(true);

    try {
      const response = await ApiClient.exportReport(
        currentReport.id,
        {
          format: 'html',
          check_filter: activeCheckFilter, // initial filter — client-side JS applies it on load
          include_rules: reportIncludeRules,
          include_technical_info: reportIncludeTechnicalInfo,
          layout_mode: layoutMode,
          show_checklist_name: reportShowChecklistName,
          show_title_info: reportShowTitleInfo,
          show_compliance_summary: reportShowComplianceSummary,
          show_compliance_percent: reportShowCompliancePercent,
          show_default_footer: reportShowDefaultFooter,
          show_annotations: activeShowAnnotations,
          show_pages_with_checks: reportShowPagesWithChecks,
          show_pages_without_checks: reportShowPagesWithoutChecks,
          show_page_images: reportShowPageImages,
          show_check_details: reportShowCheckDetails,
          show_extracted_data: reportShowExtractedData,
          show_checklist_info: reportShowChecklistInfo,
          show_checklist_general_prompt: reportShowChecklistGeneralPrompt,
          show_checklist_rules_summary: reportShowChecklistRulesSummary,
          show_checklist_rules_details: reportShowChecklistRulesDetails,
          show_checklist_envelope_rules: reportShowChecklistEnvelopeRules,
          show_timezone: reportShowTimezone,
          show_revision_comparison: reportShowRevisionComparison,
          show_check_attribution: reportShowCheckAttribution,
          show_envelope_datetime: reportShowEnvelopeDatetime,
          show_envelope_revisions_info: reportShowEnvelopeRevisionsInfo,
          show_checklist_ai_model: reportShowChecklistAiModel,
          show_page_filenames: reportShowPageFilenames,
          show_page_summary_icons: reportShowPageSummaryIcons,
          show_group_header: reportShowGroupHeader,
          show_group_checklist: reportShowGroupChecklist,
          show_group_pages: reportShowGroupPages,
          show_group_footer: reportShowGroupFooter,
          show_checklist_ai_model_details: reportShowChecklistAiModelDetails,
          show_document_history: reportShowDocumentHistory,
          show_tags: reportShowTags,
          show_user_js_1_output: reportShowUserJs1Output,
          user_js_1_output_template: currentReport?.user_scripts_output?.[0]?.template,
          user_js_1_output_data: currentReport?.user_scripts_output?.[0]?.data,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          font_scale: activeFontScale !== 1.0 ? activeFontScale : undefined,
          font_family: activeFontFamily !== 'sans-serif' ? activeFontFamily : undefined,
          highlight_mode: activeHighlightMode,
          align_labels_to_top: alignLabelsToTop,
        }
      );

      setReportContent(response.content);

      // Store in cache (cap at 30 entries)
      const cache = reportHtmlCacheRef.current;
      if (cache.size >= 30) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
      cache.set(cacheKey, response.content);
    } catch (err) {
      console.error("Failed to generate report:", err);
      const errorMessage = err instanceof Error
        ? err.message
        : "Failed to generate report. Please try again.";
      showToast(errorMessage, 'error', 5000);
      setReportContent(`<p style='padding:2rem;color:#666;'>${errorMessage}</p>`);
    } finally {
      setReportLoading(false);
    }
  };

  // --- Update a single report option and persist ---
  const updateReportOption = (key: ReportOptionKey, value: boolean) => {
    let newShowChecklistName = reportShowChecklistName;
    let newIncludeRules = reportIncludeRules;
    let newIncludeTechnicalInfo = reportIncludeTechnicalInfo;
    let newShowTitleInfo = reportShowTitleInfo;
    let newShowComplianceSummary = reportShowComplianceSummary;
    let newShowCompliancePercent = reportShowCompliancePercent;
    let newShowDefaultFooter = reportShowDefaultFooter;
    let newShowPageImages = reportShowPageImages;
    let newShowCheckDetails = reportShowCheckDetails;
    let newShowExtractedData = reportShowExtractedData;
    let newShowPagesWithChecks = reportShowPagesWithChecks;
    let newShowPagesWithoutChecks = reportShowPagesWithoutChecks;
    let newShowChecklistInfo = reportShowChecklistInfo;
    let newShowChecklistGeneralPrompt = reportShowChecklistGeneralPrompt;
    let newShowChecklistRulesSummary = reportShowChecklistRulesSummary;
    let newShowChecklistRulesDetails = reportShowChecklistRulesDetails;
    let newShowChecklistEnvelopeRules = reportShowChecklistEnvelopeRules;
    let newShowTimezone = reportShowTimezone;
    let newShowRevisionComparison = reportShowRevisionComparison;
    let newShowCheckAttribution = reportShowCheckAttribution;
    let newShowEnvelopeDatetime = reportShowEnvelopeDatetime;
    let newShowEnvelopeRevisionsInfo = reportShowEnvelopeRevisionsInfo;
    let newShowChecklistAiModel = reportShowChecklistAiModel;
    let newShowPageFilenames = reportShowPageFilenames;
    let newShowPageSummaryIcons = reportShowPageSummaryIcons;
    let newShowGroupHeader = reportShowGroupHeader;
    let newShowGroupChecklist = reportShowGroupChecklist;
    let newShowGroupPages = reportShowGroupPages;
    let newShowGroupFooter = reportShowGroupFooter;
    let newShowChecklistAiModelDetails = reportShowChecklistAiModelDetails;
    let newShowDocumentHistory = reportShowDocumentHistory;
    let newShowTags = reportShowTags;
    let newShowUserJs1Output = reportShowUserJs1Output;

    if (key === 'show_checklist_name') { newShowChecklistName = value; setReportShowChecklistName(value); }
    if (key === 'show_rules') { newIncludeRules = value; setReportIncludeRules(value); }
    if (key === 'show_audit_logs') { newIncludeTechnicalInfo = value; setReportIncludeTechnicalInfo(value); }
    if (key === 'show_title_info') { newShowTitleInfo = value; setReportShowTitleInfo(value); }
    if (key === 'show_compliance_summary') { newShowComplianceSummary = value; setReportShowComplianceSummary(value); }
    if (key === 'show_compliance_percent') { newShowCompliancePercent = value; setReportShowCompliancePercent(value); }
    if (key === 'show_default_footer') { newShowDefaultFooter = value; setReportShowDefaultFooter(value); }
    if (key === 'show_page_images') { newShowPageImages = value; setReportShowPageImages(value); }
    if (key === 'show_check_details') { newShowCheckDetails = value; setReportShowCheckDetails(value); }
    if (key === 'show_extracted_data') { newShowExtractedData = value; setReportShowExtractedData(value); }
    if (key === 'show_pages_with_checks') { newShowPagesWithChecks = value; setReportShowPagesWithChecks(value); }
    if (key === 'show_pages_without_checks') { newShowPagesWithoutChecks = value; setReportShowPagesWithoutChecks(value); }
    if (key === 'show_checklist_info') { newShowChecklistInfo = value; setReportShowChecklistInfo(value); }
    if (key === 'show_checklist_general_prompt') { newShowChecklistGeneralPrompt = value; setReportShowChecklistGeneralPrompt(value); }
    if (key === 'show_checklist_rules_summary') { newShowChecklistRulesSummary = value; setReportShowChecklistRulesSummary(value); }
    if (key === 'show_checklist_rules_details') { newShowChecklistRulesDetails = value; setReportShowChecklistRulesDetails(value); }
    if (key === 'show_checklist_envelope_rules') { newShowChecklistEnvelopeRules = value; setReportShowChecklistEnvelopeRules(value); }
    if (key === 'show_timezone') { newShowTimezone = value; setReportShowTimezone(value); }
    if (key === 'show_revision_comparison') { newShowRevisionComparison = value; setReportShowRevisionComparison(value); }
    if (key === 'show_check_attribution') { newShowCheckAttribution = value; setReportShowCheckAttribution(value); }
    if (key === 'show_envelope_datetime') { newShowEnvelopeDatetime = value; setReportShowEnvelopeDatetime(value); }
    if (key === 'show_envelope_revisions_info') { newShowEnvelopeRevisionsInfo = value; setReportShowEnvelopeRevisionsInfo(value); }
    if (key === 'show_checklist_ai_model') { newShowChecklistAiModel = value; setReportShowChecklistAiModel(value); }
    if (key === 'show_page_filenames') { newShowPageFilenames = value; setReportShowPageFilenames(value); }
    if (key === 'show_page_summary_icons') { newShowPageSummaryIcons = value; setReportShowPageSummaryIcons(value); }
    if (key === 'show_group_header') { newShowGroupHeader = value; setReportShowGroupHeader(value); }
    if (key === 'show_group_checklist') { newShowGroupChecklist = value; setReportShowGroupChecklist(value); }
    if (key === 'show_group_pages') { newShowGroupPages = value; setReportShowGroupPages(value); }
    if (key === 'show_group_footer') { newShowGroupFooter = value; setReportShowGroupFooter(value); }
    if (key === 'show_checklist_ai_model_details') { newShowChecklistAiModelDetails = value; setReportShowChecklistAiModelDetails(value); }
    if (key === 'show_document_history') { newShowDocumentHistory = value; setReportShowDocumentHistory(value); }
    if (key === 'show_tags') { newShowTags = value; setReportShowTags(value); }
    if (key === 'show_user_js_1_output') { newShowUserJs1Output = value; setReportShowUserJs1Output(value); }

    // Persist to envelope (no API re-export needed — HTML toggles sections inline)
    if (currentEnvelope?.id) {
      trackSave(ApiClient.updateEnvelope(currentEnvelope.id, {
        report_settings: {
          show_checklist_name: newShowChecklistName,
          show_rules: newIncludeRules,
          show_audit_logs: newIncludeTechnicalInfo,
          show_title_info: newShowTitleInfo,
          show_compliance_summary: newShowComplianceSummary,
          show_compliance_percent: newShowCompliancePercent,
          show_default_footer: newShowDefaultFooter,
          show_page_images: newShowPageImages,
          show_check_details: newShowCheckDetails,
          show_extracted_data: newShowExtractedData,
          show_pages_with_checks: newShowPagesWithChecks,
          show_pages_without_checks: newShowPagesWithoutChecks,
          show_checklist_info: newShowChecklistInfo,
          show_checklist_general_prompt: newShowChecklistGeneralPrompt,
          show_checklist_rules_summary: newShowChecklistRulesSummary,
          show_checklist_rules_details: newShowChecklistRulesDetails,
          show_checklist_envelope_rules: newShowChecklistEnvelopeRules,
          show_timezone: newShowTimezone,
          show_revision_comparison: newShowRevisionComparison,
          show_check_attribution: newShowCheckAttribution,
          show_envelope_datetime: newShowEnvelopeDatetime,
          show_envelope_revisions_info: newShowEnvelopeRevisionsInfo,
          show_checklist_ai_model: newShowChecklistAiModel,
          show_page_filenames: newShowPageFilenames,
          show_page_summary_icons: newShowPageSummaryIcons,
          show_group_header: newShowGroupHeader,
          show_group_checklist: newShowGroupChecklist,
          show_group_pages: newShowGroupPages,
          show_group_footer: newShowGroupFooter,
          show_checklist_ai_model_details: newShowChecklistAiModelDetails,
          show_document_history: newShowDocumentHistory,
          show_tags: newShowTags,
          show_user_js_1_output: newShowUserJs1Output,
        }
      } as any));
    }
  };

  // --- Listen for postMessage from the report iframe to persist toggle changes ---
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'revdoku-toggle') return;
      const { section, visible } = e.data as { section: string; visible: boolean };
      const keyMap: Record<string, string> = {
        'envelope-title': 'show_title_info',
        'checklist-name': 'show_checklist_name',
        'compliance-summary': 'show_compliance_summary',
        'compliance-percent': 'show_compliance_percent',
        'rules': 'show_rules',
        'technical-info': 'show_audit_logs',
        'default-footer': 'show_default_footer',
        'page-images': 'show_page_images',
        'check-details': 'show_check_details',
        'extracted-data': 'show_extracted_data',
        'pages-with-checks': 'show_pages_with_checks',
        'pages-without-checks': 'show_pages_without_checks',
        'checklist-info': 'show_checklist_info',
        'checklist-general-prompt': 'show_checklist_general_prompt',
        'checklist-rules-summary': 'show_checklist_rules_summary',
        'checklist-rules-details': 'show_checklist_rules_details',
        'checklist-envelope-rules': 'show_checklist_envelope_rules',
        'show-timezone': 'show_timezone',
        'revision-comparison': 'show_revision_comparison',
        'check-attribution': 'show_check_attribution',
        'envelope-datetime': 'show_envelope_datetime',
        'envelope-revisions-info': 'show_envelope_revisions_info',
        'checklist-ai-model': 'show_checklist_ai_model',
        'page-filenames': 'show_page_filenames',
        'page-summary-icons': 'show_page_summary_icons',
        'group-header': 'show_group_header',
        'group-checklist': 'show_group_checklist',
        'group-pages': 'show_group_pages',
        'group-footer': 'show_group_footer',
        'checklist-ai-model-details': 'show_checklist_ai_model_details',
        'document-history': 'show_document_history',
        'tags': 'show_tags',
        'user-js-output': 'show_user_js_1_output',
      };
      const key = keyMap[section];
      if (key) {
        updateReportOption(key as ReportOptionKey, visible);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [currentEnvelope?.id, reportShowChecklistName, reportIncludeRules, reportIncludeTechnicalInfo, reportShowTitleInfo, reportShowComplianceSummary, reportShowCompliancePercent, reportShowDefaultFooter, reportShowPageImages, reportShowCheckDetails, reportShowExtractedData, reportShowPagesWithChecks, reportShowPagesWithoutChecks, reportShowChecklistInfo, reportShowChecklistGeneralPrompt, reportShowChecklistRulesSummary, reportShowChecklistRulesDetails, reportShowChecklistEnvelopeRules, reportShowTimezone, reportShowRevisionComparison, reportShowCheckAttribution, reportShowEnvelopeDatetime, reportShowEnvelopeRevisionsInfo, reportShowChecklistAiModel, reportShowPageFilenames, reportShowPageSummaryIcons, reportShowGroupHeader, reportShowGroupChecklist, reportShowGroupPages, reportShowGroupFooter, reportShowChecklistAiModelDetails, reportShowDocumentHistory, reportShowTags, reportShowUserJs1Output]);

  return {
    // Popup state
    showReportPopup, setShowReportPopup,
    reportContent, reportLoading,

    // Display options (used by view settings auto-save in parent)
    reportCheckFilter, setReportCheckFilter,
    reportLayoutMode, setReportLayoutMode,
    reportShowAnnotations, setReportShowAnnotations,
    reportFontScale, setReportFontScale,
    reportFontFamily, setReportFontFamily,

    // Functions
    generateReport,
    formatReportAsText,
    updateReportOption,
  };
}
