import {
  IReport,
  IPageInfo,
  IDocumentFileRevision,
  CheckSource,
  getColorsForCheckResult,
  IEnvelopeRevisionExport,
  IPreviousRevisionExport,
  IChecklistExport,
  IDocumentFileRevisionExport,
  cleanFilename,
  ReportLayoutMode,
  MessageBoxMode,
  REVDOKU_ANNOTATION_MARGIN,
  REVDOKU_ANNOTATION_MARGIN_SCALE_EXPONENT,
  getFontFamilyCss,
  LabelFontFamily,
  CheckFilterType,
  REVDOKU_CHECK_FILTER_LABELS,
  buildCheckIconSvg,
} from '@revdoku/lib';
import { truncateFilename } from './string-utils';
import { REVDOKU_CATCH_CHANGES_RULE_ID } from './checklist-utils';
import { createSvgPagesForExport } from './svg-export-utils';
import { createImagesWithHighlights } from './image-utils';
import { EXPORT_RENDER_MODE } from './constants';
import { IPageInfoExtended } from '../schemas/common-server';
import { enrichAndRenderFilesRelatedToEnvelopeRevision } from './document-utils';
import Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load and compile the template once
const templatePath = path.join(__dirname, '../templates/report-export.hbs');
const templateSource = fs.readFileSync(templatePath, 'utf-8');
const reportTemplate = Handlebars.compile(templateSource);

// Helper: equality check for template conditionals
Handlebars.registerHelper('eq', function (a: unknown, b: unknown) { return a === b; });

// Helper: renders a dynamic Handlebars template string with provided data context.
// Used for user script output templates that are stored as data + template.
Handlebars.registerHelper('renderUserScript', function (template: string, dataJson: string) {
  if (!template || !dataJson) return '';
  try {
    const data = typeof dataJson === 'string' ? JSON.parse(dataJson) : dataJson;
    const compiled = Handlebars.compile(template);
    return new Handlebars.SafeString(compiled(data));
  } catch (e) {
    console.error('[renderUserScript] failed to render user script template:', e);
    return '';
  }
});

// Helper: renders a check description with inline `#ref[...]` markers
// replaced by non-editable chip HTML. Rails pre-processes AI-emitted
// `#file:dfrev_xxx` citations into `#ref[file:<filename>]` for export
// (so the rendered report doesn't expose internal prefix_ids). Chip
// label extraction mirrors the frontend `renderDescriptionWithFileCitations`:
//   - `#ref[scheme:value|label]`  → label (fallback: value)
//   - `#ref[description]`         → description
//
// HTML-escapes everything outside chip spans so the helper is safe for
// description text that may contain user input.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}
Handlebars.registerHelper('renderCheckDescription', function (text: string) {
  if (!text) return '';
  // Chip visual: document icon + label pill. Label = the scheme's
  // value (Rails substituted prefix_ids → filenames on the export
  // path, so file chips show filenames; deferred chips show the
  // description body; future schemes show the raw value).
  const chipStyle = [
    'display:inline-flex',
    'align-items:center',
    'gap:4px',
    'vertical-align:baseline',
    'padding:0 6px',
    'border-radius:4px',
    'border:1px solid rgba(37,99,235,0.3)',
    'background:rgba(37,99,235,0.08)',
    'color:#2563eb',
    'font-weight:600',
    'font-size:0.9em',
    'white-space:nowrap',
  ].join(';');
  const iconSvg =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/></svg>';
  // Muted "ref:" prefix between icon and label — matches the in-app chip so
  // exported reports render consistently with the live viewer.
  const refPrefixSpan =
    '<span style="opacity:0.65;font-weight:500;margin-right:2px">ref:</span>';
  const parts = text.split(/(#ref\[[^\]]*\])/g);
  const html = parts.map(part => {
    const m = part.match(/^#ref\[([^\]]*)\]$/);
    if (!m) return escapeHtml(part);
    const body = m[1] || '';
    let label = body;
    const pin = body.match(/^([a-z][a-z0-9_]*):([^|]+)(?:\|(.*))?$/);
    if (pin) {
      const value = pin[2];
      const pinLabel = pin[3];
      label = pinLabel || value;
    }
    return `<span style="${chipStyle}">${iconSvg}${refPrefixSpan}${escapeHtml(label)}</span>`;
  }).join('');
  return new Handlebars.SafeString(html);
});


const REPORT_EXCLUDE_PASSED_CHECKS = true;

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, exp);
  return `${size.toFixed(1)} ${units[exp]}`;
}

// Layout mode configuration
const LAYOUT_MODE_CONFIG = {
  compact: {
    max_page_width: 150,
    exclude_pages_without_highlights: false, // Show all pages for compact
    message_box_mode: 'numbers_message_box_only' as MessageBoxMode, // Draw numbers at message box positions only, no badges on highlights
    crop_margins: true, // Crop white margins from pages
  },
  detailed: {
    max_page_width: 400,
    exclude_pages_without_highlights: true, // Only pages with issues for detailed
    message_box_mode: 'full' as MessageBoxMode, // Full message boxes with text
    crop_margins: true, // Crop white margins from pages
  },
  full: {
    max_page_width: 800,
    exclude_pages_without_highlights: true,
    message_box_mode: 'full' as MessageBoxMode,
    crop_margins: true,
  }
} as const;

const TAG_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  red: { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
  orange: { bg: '#fff7ed', border: '#fed7aa', text: '#ea580c' },
  yellow: { bg: '#fefce8', border: '#fde68a', text: '#ca8a04' },
  green: { bg: '#f0fdf4', border: '#bbf7d0', text: '#16a34a' },
  blue: { bg: '#eff6ff', border: '#bfdbfe', text: '#2563eb' },
  purple: { bg: '#faf5ff', border: '#d8b4fe', text: '#9333ea' },
  gray: { bg: '#f9fafb', border: '#d1d5db', text: '#4b5563' },
};

// Extended report type with temporary properties for report generation
interface IReportWithImages extends IReport {
  pages_as_images_with_highlights?: string[];
}

// Audit log entry for export
interface IAuditLogExport {
  datetime: string;
  action: string;
  user: string;
  response_code?: number;
}


// Helper function to get the filename for a specific page number
const getFilenameForPage = (files_revisions: IDocumentFileRevision[], pageIndex: number): string => {
  let idx = pageIndex;

  for (const fileRevision of files_revisions) {
    if (!fileRevision.pages) continue;
    if (idx < fileRevision.pages.length) {
      return fileRevision.name;
    }
    idx -= fileRevision.pages.length;
  }

  return 'Unknown File';
};

export const generateReport = async (

  {
    title,
    envelope_id,
    files,
    report,
    checklist,
    envelope_checklist,
    document,
    previous_revision,
    include_passed_checks = false,
    check_filter,
    include_rules = false,
    include_technical_info = false,
    message_box_mode = 'none',
    audit_logs = [],
    layout_mode = 'detailed',
    show_checklist_name = true,
    show_title_info = true,
    show_compliance_summary = true,
    show_compliance_percent = true,
    show_default_footer = true,
    app_version,
    timezone,
    ai_model_id,
    ai_model_display_name,
    ai_model_actual_id,
    ai_model_provider,
    ai_model_stars,
    ai_model_stars_display,
    ai_model_credits_per_page,
    ai_model_hipaa,
    ai_model_location,
    ai_model_description,
    ai_model_model_name,
    show_annotations = true,
    initial_show_pages_with_checks,
    initial_show_pages_without_checks,
    initial_show_page_images,
    initial_show_check_details,
    initial_show_extracted_data,
    initial_show_title_info,
    initial_show_checklist_name,
    initial_show_compliance_summary,
    initial_show_compliance_percent,
    initial_include_rules,
    initial_include_technical_info,
    initial_show_default_footer,
    initial_show_checklist_info,
    initial_show_checklist_general_prompt,
    initial_show_checklist_rules_summary,
    initial_show_checklist_rules_details,
    initial_show_checklist_envelope_rules,
    initial_show_timezone,
    initial_show_revision_comparison,
    initial_show_check_attribution,
    initial_show_envelope_datetime,
    initial_show_envelope_revisions_info,
    initial_show_checklist_ai_model,
    initial_show_page_filenames,
    initial_show_page_summary_icons,
    initial_show_group_header,
    initial_show_group_checklist,
    initial_show_group_pages,
    initial_show_group_footer,
    initial_show_checklist_ai_model_details,
    font_scale,
    font_family,
    highlight_mode,
    revisions_history,
    initial_show_document_history,
    tags,
    initial_show_tags,
    align_labels_to_top = false,
    user_js_1_output_template,
    user_js_1_output_data,
    initial_show_user_js_1_output,
  }: {
    title: string,
    envelope_id?: string,
    files: IDocumentFileRevisionExport[],
    report: IReportWithImages,
    checklist: IChecklistExport,
    envelope_checklist?: IChecklistExport | null,
    document?: IEnvelopeRevisionExport,
    previous_revision?: IPreviousRevisionExport | null,
    include_passed_checks: boolean,
    check_filter?: CheckFilterType,
    include_rules: boolean,
    include_technical_info?: boolean,
    message_box_mode?: MessageBoxMode,
    audit_logs?: IAuditLogExport[],
    layout_mode?: ReportLayoutMode,
    show_checklist_name?: boolean,
    show_title_info?: boolean,
    show_compliance_summary?: boolean,
    show_compliance_percent?: boolean,
    show_default_footer?: boolean,
    app_version?: string,
    timezone?: string,
    ai_model_id?: string,
    ai_model_display_name?: string,
    ai_model_actual_id?: string,
    ai_model_provider?: string,
    ai_model_stars?: number,
    ai_model_stars_display?: string,
    ai_model_credits_per_page?: number,
    ai_model_hipaa?: boolean,
    ai_model_location?: string,
    ai_model_description?: string,
    ai_model_model_name?: string,
    show_annotations?: boolean,
    initial_show_pages_with_checks?: boolean,
    initial_show_pages_without_checks?: boolean,
    initial_show_page_images?: boolean,
    initial_show_check_details?: boolean,
    /** Controls visibility of raw `val=...` data chips next to check descriptions.
     *  Defaults to false — only power users who want to audit extracted values
     *  should see them in the exported report. */
    initial_show_extracted_data?: boolean,
    initial_show_title_info?: boolean,
    initial_show_checklist_name?: boolean,
    initial_show_compliance_summary?: boolean,
    initial_show_compliance_percent?: boolean,
    initial_include_rules?: boolean,
    initial_include_technical_info?: boolean,
    initial_show_default_footer?: boolean,
    initial_show_checklist_info?: boolean,
    initial_show_checklist_general_prompt?: boolean,
    initial_show_checklist_rules_summary?: boolean,
    initial_show_checklist_rules_details?: boolean,
    initial_show_checklist_envelope_rules?: boolean,
    initial_show_timezone?: boolean,
    initial_show_revision_comparison?: boolean,
    initial_show_check_attribution?: boolean,
    initial_show_envelope_datetime?: boolean,
    initial_show_envelope_revisions_info?: boolean,
    initial_show_checklist_ai_model?: boolean,
    initial_show_page_filenames?: boolean,
    initial_show_page_summary_icons?: boolean,
    initial_show_group_header?: boolean,
    initial_show_group_checklist?: boolean,
    initial_show_group_pages?: boolean,
    initial_show_group_footer?: boolean,
    initial_show_checklist_ai_model_details?: boolean,
    font_scale?: number,
    font_family?: LabelFontFamily,
    highlight_mode?: number,
    revisions_history?: Array<{
      revision_number: number;
      created_at: string;
      comment?: string;
      created_by?: string;
      has_report: boolean;
      page_count: number;
      total_checks: number;
      failed_checks: number;
      passed_checks: number;
      files: Array<{ name: string; size: number }>;
    }>,
    initial_show_document_history?: boolean,
    tags?: Array<{ name: string; color: string }>,
    initial_show_tags?: boolean,
    align_labels_to_top?: boolean,
    user_js_1_output_template?: string,
    user_js_1_output_data?: Record<string, unknown>,
    initial_show_user_js_1_output?: boolean,
  }
) => {
  if (!report) {
    const errorMessage = 'No inspection report: can not generate report';
    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  // First make sure file revisions are rendered into page images.
  // The helper returns the enriched file revisions with page data.
  // Export only needs pageAsImage for createImagesWithHighlights — skip grid generation.
  const enrichedFiles: IDocumentFileRevision[] = await enrichAndRenderFilesRelatedToEnvelopeRevision(files, false, undefined, undefined, undefined, true);

  // Extract all pages from the enriched file revisions. Each page will have the
  // required extended information for highlight rendering.
  const pages: IPageInfoExtended[] = enrichedFiles.flatMap(f => f.pages || []) as IPageInfoExtended[];

  // Merge persisted content bounding boxes into pages (for margin cropping during export).
  // These were saved on the Report during inspection and passed through via Rails export serialization.
  const contentBBoxes = (report as any).content_bounding_boxes;
  if (contentBBoxes && typeof contentBBoxes === 'object') {
    for (const [pageIdx, bbox] of Object.entries(contentBBoxes)) {
      const idx = parseInt(pageIdx, 10);
      if (pages[idx] && bbox && !pages[idx].content_bounding_box) {
        pages[idx].content_bounding_box = bbox as { x1: number; y1: number; x2: number; y2: number };
      }
    }
  }

  // Get highlighted images from the inspection report

  // generate images with highlights
  console.debug('generating previews of images with highlights');

  // Get layout mode configuration
  const mode_config = LAYOUT_MODE_CONFIG[layout_mode];
  const DEFAULT_REPORT_FONT_SCALE = 1.15;
  const effective_font_scale = (font_scale && font_scale > 0) ? font_scale : DEFAULT_REPORT_FONT_SCALE;
  // max_page_width is NOT scaled by font_scale — font_scale only affects label sizes
  // (via font_scale_override in createImagesWithHighlights), matching envelope view behavior
  // where A+/A- changes label size without changing page/document width.
  const max_page_width = mode_config.max_page_width;
  console.debug('generateReport', `layout_mode: ${layout_mode}, mode_config: ${JSON.stringify(mode_config)}`);

  // Determine layout mode flags for template
  const is_compact_mode = layout_mode === 'compact';
  const is_detailed_mode = !is_compact_mode;  // detailed & full both use detailed template

  let page_renders: string[];  // SVG markup or base64 PNG depending on render mode
  const useSvgMode = EXPORT_RENDER_MODE === 'svg';

  const effective_check_filter: CheckFilterType = check_filter || CheckFilterType.FAILED_AND_CHANGES;

  const filterLabels = REVDOKU_CHECK_FILTER_LABELS[effective_check_filter] || REVDOKU_CHECK_FILTER_LABELS[CheckFilterType.ALL];

  // When filter includes all checks or there are no checks, include pages without highlights
  // For compact mode, always include all pages; for detailed mode, follow the setting
  // checked_pages_only overrides: if set, always exclude pages without any checks
  const show_all_pages = effective_check_filter === 'all' || report.checks.length === 0;
  const include_empty_pages = initial_show_pages_without_checks !== false;
  const exclude_pages_without_highlights = mode_config.exclude_pages_without_highlights && !show_all_pages && !include_empty_pages;

  // Resolve effective message_box_mode: config takes priority if not 'none', otherwise use parameter
  const effective_message_box_mode: MessageBoxMode = mode_config.message_box_mode !== 'none'
    ? mode_config.message_box_mode
    : (message_box_mode || 'none');
  const effective_show_hints = effective_message_box_mode !== 'none';

  try {

    if (useSvgMode) {
      // SVG mode: static SVG overlays (vector-crisp, zero JS)
      // Always render ALL checks — client-side JS handles filtering via data attributes
      page_renders = await createSvgPagesForExport(
        pages,
        report,
        'all',
        false, // include all pages — client-side handles page visibility
        max_page_width,
        effective_show_hints,
        mode_config.crop_margins,
        effective_message_box_mode,
        !show_annotations,
        effective_font_scale,
        font_family as LabelFontFamily | undefined,
        highlight_mode,
        align_labels_to_top,
      );
    } else {
      // Canvas mode: legacy Node-canvas rasterisation (PNG highlights baked into images)
      page_renders = await createImagesWithHighlights(
        pages,
        report,
        effective_check_filter,
        exclude_pages_without_highlights,
        max_page_width,
        effective_show_hints,
        false, // show_source_badge
        mode_config.crop_margins,
        effective_message_box_mode,
        !show_annotations,
        effective_font_scale,
        font_family as LabelFontFamily | undefined,
        highlight_mode,
        align_labels_to_top,
      );
    }

    console.debug('input', `Generated ${page_renders.length} page renders (mode: ${EXPORT_RENDER_MODE}). excludePassedChecks: ${REPORT_EXCLUDE_PASSED_CHECKS}, exclude_pages_without_highlights: ${exclude_pages_without_highlights}`);

    if (!page_renders || !Array.isArray(page_renders)) {
      throw new Error('Page render returned null or undefined');
    }

    if (page_renders.length !== pages.length) {
      throw new Error(`Generated ${page_renders.length} page renders, but expected ${pages.length}`);
    }

    report.pages_as_images_with_highlights = page_renders;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error(`Failed to generate page renders (mode: ${EXPORT_RENDER_MODE}):`, errorMessage);
    console.error('Error details:', error);

    const contextInfo = {
      render_mode: EXPORT_RENDER_MODE,
      source_images_count: pages.length,
      report_checks_count: report.checks?.length || 0,
      exclude_passed_checks: REPORT_EXCLUDE_PASSED_CHECKS,
      exclude_pages_without_highlights: exclude_pages_without_highlights,
      max_page_width: max_page_width,
      layout_mode: layout_mode,
    };

    console.error('Generation context:', contextInfo);

    throw new Error(`Failed to generate page renders (${EXPORT_RENDER_MODE}): ${errorMessage}. Context: ${JSON.stringify(contextInfo)}`);
  }

  console.debug('Page renders:', report.pages_as_images_with_highlights?.length || 0, `(mode: ${EXPORT_RENDER_MODE})`);


  const reportGeneratedAt = new Date();


  const formattedReportGeneratedDateTime = reportGeneratedAt.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: timezone || undefined,
  });



  // Combine all checks from inspection and manual checks
  const allChecks = [
    ...report.checks
  ];

  // Sort checks by original checklist order
  const sortedChecks = [...allChecks].sort((a, b) => a.rule_order! - b.rule_order!);

  // Separate failed and passed checks from sorted list
  const checks = sortedChecks.filter(check => !check.passed);
  const passedChecks = sortedChecks.filter(check => check.passed);

  // Calculate statistics
  const totalChecks = allChecks.length;
  const totalFailedChecks = checks.length;
  const totalPassedChecks = passedChecks.length;
  const passRate = totalChecks > 0 ? Math.round((totalPassedChecks / totalChecks) * 100) : 0;

  // Format revision created date
  const formatDateTime = (isoString?: string): string => {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone || undefined,
    });
  };

  // Format file size
  const formatFileSize = (bytes?: number): string => {
    if (!bytes || bytes === 0) return 'N/A';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  // Calculate comparison with previous revision if available
  const previousComparison = (() => {
    if (!previous_revision?.report_summary) return null;

    const prevFailed = previous_revision.report_summary.failed;
    const currentFailed = totalFailedChecks;
    const prevPassed = previous_revision.report_summary.passed;
    const currentPassed = totalPassedChecks;

    // Find resolved issues (were failed in previous, not failed in current)
    const previousFailedRuleKeys = new Set(
      previous_revision.report_summary.failed_checks?.map(c => c.rule_key) || []
    );
    const currentFailedRuleKeys = new Set(
      checks.map(c => c.rule_id)
    );

    // Issues that were in previous failed but not in current failed = resolved
    const resolvedCount = [...previousFailedRuleKeys].filter(
      key => !currentFailedRuleKeys.has(key)
    ).length;

    // New issues = in current failed but not in previous failed
    const newIssuesCount = [...currentFailedRuleKeys].filter(
      key => !previousFailedRuleKeys.has(key)
    ).length;

    // Unresolved = in both
    const unresolvedCount = [...previousFailedRuleKeys].filter(
      key => currentFailedRuleKeys.has(key)
    ).length;

    return {
      resolved: resolvedCount,
      new_issues: newIssuesCount,
      unresolved: unresolvedCount,
      prev_total: previous_revision.report_summary.total_checks,
      prev_passed: prevPassed,
      prev_failed: prevFailed,
      prev_pass_rate: previous_revision.report_summary.total_checks > 0
        ? Math.round((prevPassed / previous_revision.report_summary.total_checks) * 100)
        : 0
    };
  })();

  // Calculate total pages and file count
  const totalPages = files.reduce((cnt, f) => cnt + (f.pages?.length || 0), 0);
  const totalFileSize = files.reduce((sum, f) => sum + (f.size || 0), 0);

  // Format short date for compact header
  const formatShortDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Group checks by page number
  const checksByPage = new Map<number, Array<typeof allChecks[0]>>();
  allChecks.forEach(check => {
    const pageNum = check.page;
    if (!checksByPage.has(pageNum)) {
      checksByPage.set(pageNum, []);
    }
    checksByPage.get(pageNum)!.push(check);
  });

  // Always include all pages — client-side JS handles filtering via data attributes
  const filteredPages = Array.from({ length: totalPages }, (_, i) => i);

  // Build page sections data for template
  const pages_sections = filteredPages.map(pageNum => {
    const pageChecks = checksByPage.get(pageNum) || [];
    const pageFailedChecks = pageChecks.filter(check => !check.passed);
    const pagePassedChecks = pageChecks.filter(check => check.passed);
    const pageImageIndex = pageNum;
    const has_highlighted_image = report.pages_as_images_with_highlights &&
      pageImageIndex < report.pages_as_images_with_highlights.length &&
      report.pages_as_images_with_highlights[pageImageIndex];

    // Always include all checks — client-side JS handles filtering via data attributes
    const show_failed_checks = true;
    const show_passed_checks = true;
    const visibleFailedChecks = pageFailedChecks;
    const visiblePassedChecks = pagePassedChecks;

    const rawFilename = getFilenameForPage(files, pageNum);
    const prevPageNum = filteredPages[filteredPages.indexOf(pageNum) - 1];
    const prevFilename = prevPageNum !== undefined ? getFilenameForPage(files, prevPageNum) : null;
    const is_file_start = prevFilename !== rawFilename;
    return {
      page_number: pageNum + 1,
      filename: rawFilename,
      is_file_start,
      truncated_filename: truncateFilename(rawFilename, 22),
      has_issues: visibleFailedChecks.length > 0,
      issue_count: visibleFailedChecks.length,
      issues_plural: visibleFailedChecks.length !== 1,
      status_bg: visibleFailedChecks.length > 0 ? '#fef2f2' : '#f0fdf4',
      status_color: visibleFailedChecks.length > 0 ? '#dc2626' : '#16a34a',
      has_highlighted_image: !!has_highlighted_image,
      highlighted_image: has_highlighted_image ? report.pages_as_images_with_highlights![pageImageIndex] : null,
      has_no_checks: pageChecks.length === 0,
      has_visible_checks: pageChecks.length > 0,
      show_passed_checks,
      show_failed_checks,
      include_rules: include_rules,
      failed_checks: visibleFailedChecks.map(check => {
        const checkColors = getColorsForCheckResult(check);
        const rule = checklist?.rules?.find(r => r.id === check.rule_id);
        const is_recheck = check.description?.startsWith('#recheck ');
        const is_diff = check.rule_id === REVDOKU_CATCH_CHANGES_RULE_ID;
        const check_filter_type = is_diff ? 'changes' : is_recheck ? 'recheck' : 'failed';
        return {
          check_id: check.id,
          check_passed: false,
          check_filter_type,
          rule_order: check.check_index ?? ((check.rule_order ?? 0) + 1),
          border_color: checkColors.border_color,
          badge_bg_color: is_diff ? '#d97706' : '#ef4444',
          source_icon: check.source === CheckSource.USER ? '👤' : '✨',
          source_title: check.source === CheckSource.USER ? 'Envelope check' : 'AI check',
          description: is_recheck ? check.description.slice('#recheck '.length) : check.description,
          data_val: check.data?.val || null,
          is_recheck,
          is_diff,
          rule_prompt: rule?.prompt || check.rule_prompt || '',
          include_rules: include_rules,
          rule_origin: rule?.origin || 'checklist',
          rule_origin_label: rule?.origin === 'user' ? 'Envelope rule' : 'Checklist rule',
          created_by: (check as any).created_by_name || (rule as any)?.created_by_name || null,
        };
      }),
      passed_checks: visiblePassedChecks.map(check => {
        const checkColors = getColorsForCheckResult(check);
        const rule = checklist?.rules?.find(r => r.id === check.rule_id);
        const is_recheck = check.description?.startsWith('#recheck ');
        const is_diff = check.rule_id === REVDOKU_CATCH_CHANGES_RULE_ID;
        const check_filter_type = is_diff ? 'changes' : is_recheck ? 'recheck' : 'passed';
        return {
          check_id: check.id,
          check_passed: true,
          check_filter_type,
          rule_order: check.check_index ?? ((check.rule_order ?? 0) + 1),
          border_color: checkColors.border_color,
          badge_bg_color: is_diff ? '#d97706' : '#22c55e',
          source_icon: check.source === CheckSource.USER ? '👤' : '✨',
          source_title: check.source === CheckSource.USER ? 'Envelope check' : 'AI check',
          description: is_recheck ? check.description.slice('#recheck '.length) : check.description,
          data_val: check.data?.val || null,
          is_recheck,
          is_diff,
          rule_prompt: rule?.prompt || check.rule_prompt || '',
          include_rules: include_rules,
          rule_origin: rule?.origin || 'checklist',
          rule_origin_label: rule?.origin === 'user' ? 'Envelope rule' : 'Checklist rule',
          created_by: (check as any).created_by_name || (rule as any)?.created_by_name || null,
        };
      })
    };
  });

  // Build files data for footer (shows files inspected with page/issue/check counts)
  let currentPageIndex = 0;
  const filesData = files.map(file => {
    const filePageCount = file.pages?.length || 0;
    let fileFailedCount = 0;
    let fileTotalCount = 0;
    for (let i = 0; i < filePageCount; i++) {
      const pageIndex = currentPageIndex + i;
      const pageChecks = checksByPage.get(pageIndex) || [];
      fileTotalCount += pageChecks.length;
      fileFailedCount += pageChecks.filter(check => !check.passed).length;
    }
    currentPageIndex += filePageCount;

    return {
      truncated_name: file.name,
      page_count: filePageCount,
      pages_plural: filePageCount !== 1,
      file_size: file.size ? formatFileSize(file.size) : null,
      total_checks: fileTotalCount,
      failed_checks: fileFailedCount,
      passed_checks: fileTotalCount - fileFailedCount,
      has_checks: fileTotalCount > 0,
      has_failures: fileFailedCount > 0,
      checks_plural: fileTotalCount !== 1,
    };
  });

  // Build rules lists for Checklist section
  const checklistOriginRules = (checklist.rules || [])
    .filter(r => r.origin !== 'user')
    .sort((a, b) => a.order - b.order)
    .map(r => ({
      order: r.order + 1,
      title: `Rule ${r.order + 1}`,
      prompt: r.prompt,
    }));

  const envelopeOnlyRules = (checklist.rules || [])
    .filter(r => r.origin === 'user')
    .sort((a, b) => a.order - b.order)
    .map(r => ({
      order: r.order + 1,
      title: `Rule ${r.order + 1}`,
      prompt: r.prompt,
    }));

  // Compute timezone abbreviation (e.g. "PST", "EST", "UTC")
  const tzAbbr = timezone
    ? new Date().toLocaleString('en-US', { timeZone: timezone, timeZoneName: 'short' }).split(' ').pop() || 'UTC'
    : 'UTC';

  // Build template context
  const templateContext = {
    title,
    revision_number: (document?.revision_number ?? 0) + 1,
    is_revised: ((document?.revision_number ?? 0) + 1) > 1,
    total_revisions: document?.total_revisions,
    revision_updated_at: document?.updated_at ? formatShortDate(new Date(document.updated_at)) : null,
    short_date: formatShortDate(reportGeneratedAt),
    full_date_time: formattedReportGeneratedDateTime,
    files_count: files.length,
    files_plural: files.length !== 1,
    total_pages: totalPages,
    checklist_name: checklist.name || 'Unnamed Checklist',
    truncated_checklist_name: truncateFilename(checklist.name || 'Unnamed Checklist', 25),
    total_rules: checklist.total_rules || checklist.rules?.length || 0,
    passed_count: totalPassedChecks,
    failed_count: totalFailedChecks,
    total_checks: totalChecks,
    pass_rate: passRate,
    pass_rate_color: passRate >= 100 ? '#059669' : passRate >= 75 ? '#16a34a' : passRate >= 50 ? '#d97706' : '#dc2626',
    previous_comparison: previousComparison ? {
      resolved: previousComparison.resolved,
      new_issues: previousComparison.new_issues,
      unresolved: previousComparison.unresolved,
      prev_revision: (previous_revision?.revision_number ?? 0) + 1
    } : null,
    pass_rate_improved: previousComparison && passRate > previousComparison.prev_pass_rate,
    pass_rate_declined: previousComparison && passRate < previousComparison.prev_pass_rate,
    pass_rate_change: previousComparison
      ? (passRate > previousComparison.prev_pass_rate
        ? `↑ +${passRate - previousComparison.prev_pass_rate}%`
        : passRate < previousComparison.prev_pass_rate
          ? `↓ ${passRate - previousComparison.prev_pass_rate}%`
          : '→ 0%')
      : null,
    failed_section_label: filterLabels.failedSection,
    passed_section_label: filterLabels.passedSection,
    pages_sections,
    initial_check_filter: effective_check_filter,
    initial_highlight_mode: highlight_mode ?? 0,
    initial_show_annotations: show_annotations !== false,
    has_changes_checks: report.checks.some(c => c.rule_id === REVDOKU_CATCH_CHANGES_RULE_ID),
    has_recheck_checks: report.checks.some(c => c.description?.startsWith('#recheck ')),
    max_page_preview_width: effective_show_hints
      ? max_page_width + (is_compact_mode
        ? 50 // Compact mode: small margin for pill-sized badges
        : Math.round(REVDOKU_ANNOTATION_MARGIN * Math.pow(
          Math.max(
            report.label_font_scale || 1.0,
            ...Object.values(report.page_font_scales || {}).map(Number)
          ) * effective_font_scale,
          REVDOKU_ANNOTATION_MARGIN_SCALE_EXPONENT
        ) * 2)) // *2 for potential left+right margin labels
      : max_page_width,
    use_svg_mode: useSvgMode,
    include_rules,
    include_technical_info,
    show_checklist_name: show_checklist_name !== false,
    show_title_info: show_title_info !== false,
    show_compliance_summary: show_compliance_summary !== false,
    show_compliance_percent: show_compliance_percent !== false,
    show_default_footer: show_default_footer !== false,
    // Revdoku version string (e.g. "1.0.77") rendered in the always-visible
    // branding header + footer. Blank when caller didn't supply it — the
    // template then renders the brand line without the version suffix.
    app_version: app_version || null,
    // Initial visibility preferences (for inline toggle controls in HTML)
    initial_show_title_info: initial_show_title_info !== undefined ? initial_show_title_info : (show_title_info !== false),
    initial_show_checklist_name: initial_show_checklist_name !== undefined ? initial_show_checklist_name : (show_checklist_name !== false),
    initial_show_compliance_summary: initial_show_compliance_summary !== undefined ? initial_show_compliance_summary : (show_compliance_summary !== false),
    initial_show_compliance_percent: initial_show_compliance_percent !== undefined ? initial_show_compliance_percent : (show_compliance_percent !== false),
    initial_include_rules: initial_include_rules !== undefined ? initial_include_rules : include_rules,
    initial_include_technical_info: initial_include_technical_info !== undefined ? initial_include_technical_info : !!include_technical_info,
    initial_show_default_footer: initial_show_default_footer !== undefined ? initial_show_default_footer : (show_default_footer !== false),
    initial_show_pages_with_checks: initial_show_pages_with_checks !== undefined ? initial_show_pages_with_checks : true,
    initial_show_pages_without_checks: initial_show_pages_without_checks !== undefined ? initial_show_pages_without_checks : true,
    initial_show_page_images: initial_show_page_images !== undefined ? initial_show_page_images : true,
    initial_show_check_details: initial_show_check_details !== undefined ? initial_show_check_details : true,
    initial_show_extracted_data: initial_show_extracted_data !== undefined ? initial_show_extracted_data : false,
    // AI model info for technical section
    ai_model_id: ai_model_id || null,
    ai_model_display_name: ai_model_display_name || null,
    ai_model_actual_id: ai_model_actual_id || null,
    ai_model_provider: ai_model_provider || null,
    ai_model_stars: ai_model_stars || null,
    ai_model_stars_display: ai_model_stars_display || null,
    ai_model_credits_per_page: ai_model_credits_per_page ?? null,
    show_pricing: false,
    ai_model_hipaa: ai_model_hipaa || false,
    ai_model_location: ai_model_location || null,
    ai_model_description: ai_model_description || null,
    ai_model_model_name: ai_model_model_name || null,
    report_id: report.id || 'N/A',
    envelope_id: envelope_id || 'N/A',
    // Files inspected for footer
    files: filesData,
    has_files: filesData.length > 0,
    // Audit logs for footer (format datetimes with timezone)
    audit_logs: (audit_logs || []).map((log: IAuditLogExport) => ({
      ...log,
      datetime: new Date(log.datetime as string).toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: timezone || undefined,
      }),
    })),
    has_audit_logs: (audit_logs?.length || 0) > 0,
    // Revisions history for Document History section
    has_revisions_history: (revisions_history?.length || 0) > 0,
    initial_show_document_history: initial_show_document_history !== undefined ? initial_show_document_history : false,
    revisions_history: (revisions_history || []).map(rev => ({
      ...rev,
      formatted_date: new Date(rev.created_at).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone || undefined,
      }),
      is_current: rev.revision_number === ((document?.revision_number ?? 0) + 1),
      has_comment: !!rev.comment,
      has_created_by: !!rev.created_by,
      has_checks: rev.total_checks > 0,
      files: rev.files.map(f => ({
        ...f,
        formatted_size: formatFileSize(f.size),
      })),
    })),
    // Layout mode flags for template
    is_compact_mode,
    is_detailed_mode,
    layout_mode,
    // Checklist section data
    checklist_created_at: checklist.created_at ? formatShortDate(new Date(checklist.created_at)) : null,
    checklist_updated_at: checklist.updated_at ? formatShortDate(new Date(checklist.updated_at)) : null,
    checklist_version: checklist.revision_number || 1,
    checklist_system_prompt: checklist.system_prompt || null,
    has_checklist_system_prompt: !!checklist.system_prompt,
    checklist_rules_list: checklistOriginRules,
    checklist_rules_count: checklistOriginRules.length,
    has_checklist_rules: checklistOriginRules.length > 0,
    envelope_rules_list: envelopeOnlyRules,
    envelope_rules_count: envelopeOnlyRules.length,
    has_envelope_rules: envelopeOnlyRules.length > 0,
    // Timezone
    timezone_abbr: tzAbbr,
    // New toggle initial states
    initial_show_checklist_info: initial_show_checklist_info !== undefined ? initial_show_checklist_info : true,
    initial_show_checklist_general_prompt: initial_show_checklist_general_prompt !== undefined ? initial_show_checklist_general_prompt : true,
    initial_show_checklist_rules_summary: initial_show_checklist_rules_summary !== undefined ? initial_show_checklist_rules_summary : true,
    initial_show_checklist_rules_details: initial_show_checklist_rules_details !== undefined ? initial_show_checklist_rules_details : true,
    initial_show_checklist_envelope_rules: initial_show_checklist_envelope_rules !== undefined ? initial_show_checklist_envelope_rules : true,
    initial_show_timezone: initial_show_timezone !== undefined ? initial_show_timezone : true,
    initial_show_revision_comparison: initial_show_revision_comparison !== undefined ? initial_show_revision_comparison : true,
    initial_show_check_attribution: initial_show_check_attribution !== undefined ? initial_show_check_attribution : true,
    initial_show_envelope_datetime: initial_show_envelope_datetime !== undefined ? initial_show_envelope_datetime : true,
    initial_show_envelope_revisions_info: initial_show_envelope_revisions_info !== undefined ? initial_show_envelope_revisions_info : true,
    initial_show_checklist_ai_model: initial_show_checklist_ai_model !== undefined ? initial_show_checklist_ai_model : true,
    initial_show_page_filenames: initial_show_page_filenames !== undefined ? initial_show_page_filenames : true,
    initial_show_page_summary_icons: initial_show_page_summary_icons !== undefined ? initial_show_page_summary_icons : true,
    // Section group toggles
    initial_show_group_header: initial_show_group_header !== undefined ? initial_show_group_header : true,
    initial_show_group_checklist: initial_show_group_checklist !== undefined ? initial_show_group_checklist : true,
    initial_show_group_pages: initial_show_group_pages !== undefined ? initial_show_group_pages : true,
    initial_show_group_footer: initial_show_group_footer !== undefined ? initial_show_group_footer : true,
    // Checklist AI model info
    initial_show_checklist_ai_model_details: initial_show_checklist_ai_model_details !== undefined ? initial_show_checklist_ai_model_details : false,
    // Tags
    tags: (tags || []).map(t => ({
      name: t.name,
      color: t.color,
      bg: TAG_COLORS[t.color]?.bg || '#f9fafb',
      border: TAG_COLORS[t.color]?.border || '#d1d5db',
      text: TAG_COLORS[t.color]?.text || '#4b5563',
    })),
    has_tags: (tags?.length || 0) > 0,
    initial_show_tags: initial_show_tags !== undefined ? initial_show_tags : true,
    // User JS script output — template + data passed to client for rendering
    user_js_1_output_template: user_js_1_output_template || null,
    user_js_1_output_data_json: (user_js_1_output_template && user_js_1_output_data)
      ? JSON.stringify(user_js_1_output_data)
      : null,
    initial_show_user_js_1_output: initial_show_user_js_1_output !== undefined ? initial_show_user_js_1_output : true,
    // Font family CSS for body style
    font_family_css: getFontFamilyCss(font_family, 'browser'),
    // Check icon SVGs (font-independent)
    recheck_icon_svg: buildCheckIconSvg('recheck', 12),
    changes_icon_svg: buildCheckIconSvg('changes', 12),
    recheck_icon_svg_lg: buildCheckIconSvg('recheck', 14),
    changes_icon_svg_lg: buildCheckIconSvg('changes', 14),
  };

  // Render the template
  const html = reportTemplate(templateContext);

  return html;
};