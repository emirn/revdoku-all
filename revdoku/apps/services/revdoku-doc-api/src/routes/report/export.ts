import { FastifyPluginAsync } from 'fastify';
import {
  IReport,
  IDocumentFileRevision,
  IEnvelopeRevisionExport,
  IPreviousRevisionExport,
  IChecklistExport,
  IDocumentFileRevisionExport,
  ReportLayoutMode,
  MessageBoxMode,
  CheckFilterType,
} from '@revdoku/lib';
import { IReply } from '../../schemas/common-server';
import { generateReport } from '../../lib/report-utils';
import { v4 as uuidv4 } from 'uuid';

/* ────────────────────────────────────────────────────────────────
   Configuration Constants
   ──────────────────────────────────────────────────────────────── */

// Credits: 1 credit per 100KB of HTML content (approximately 1 page)
const HTML_BYTES_PER_CREDIT_PAGE = 100000;

/* ────────────────────────────────────────────────────────────────
   Request / response contracts
   ──────────────────────────────────────────────────────────────── */

interface IAuditLogExport {
  datetime: string;
  action: string;
  user: string;
  response_code?: number;
}

interface IRevisionFileExport {
  name: string;
  size: number;
}

interface IRevisionHistoryExport {
  revision_number: number;
  created_at: string;
  comment?: string;
  created_by?: string;
  has_report: boolean;
  page_count: number;
  total_checks: number;
  failed_checks: number;
  passed_checks: number;
  files: IRevisionFileExport[];
}

interface IReportExportBody {
  title: string;
  envelope_id?: string;
  document_files_revisions: IDocumentFileRevisionExport[];
  report: IReport;
  checklist: IChecklistExport;
  envelope_checklist?: IChecklistExport | null;
  document: IEnvelopeRevisionExport;
  previous_revision?: IPreviousRevisionExport | null;
  include_passed_checks?: boolean;
  check_filter?: CheckFilterType;
  include_rules?: boolean;
  include_technical_info?: boolean;
  message_box_mode?: MessageBoxMode;
  max_page_width?: number;
  audit_logs?: IAuditLogExport[];
  layout_mode?: ReportLayoutMode;
  show_checklist_name?: boolean;
  show_title_info?: boolean;
  show_compliance_summary?: boolean;
  show_compliance_percent?: boolean;
  show_default_footer?: boolean;
  // Revdoku app version (from Rails.application.version). Rendered in the
  // always-visible branding header + footer. Optional — when absent the
  // branding line still renders, minus the "v.X.Y.Z" suffix.
  app_version?: string;
  timezone?: string; // IANA timezone string for formatting display dates
  ai_model_id?: string;
  ai_model_display_name?: string;
  ai_model_stars?: number;
  ai_model_stars_display?: string;
  ai_model_credits_per_page?: number;
  ai_model_hipaa?: boolean;
  ai_model_location?: string;
  ai_model_description?: string;
  ai_model_actual_id?: string;
  ai_model_provider?: string;
  ai_model_model_name?: string;
  show_annotations?: boolean;
  initial_show_pages_with_checks?: boolean;
  initial_show_pages_without_checks?: boolean;
  initial_show_page_images?: boolean;
  initial_show_check_details?: boolean;
  initial_show_title_info?: boolean;
  initial_show_checklist_name?: boolean;
  initial_show_compliance_summary?: boolean;
  initial_show_compliance_percent?: boolean;
  initial_include_rules?: boolean;
  initial_include_technical_info?: boolean;
  initial_show_default_footer?: boolean;
  initial_show_checklist_info?: boolean;
  initial_show_checklist_general_prompt?: boolean;
  initial_show_checklist_rules_summary?: boolean;
  initial_show_checklist_rules_details?: boolean;
  initial_show_checklist_envelope_rules?: boolean;
  initial_show_timezone?: boolean;
  initial_show_revision_comparison?: boolean;
  initial_show_check_attribution?: boolean;
  initial_show_envelope_datetime?: boolean;
  initial_show_envelope_revisions_info?: boolean;
  initial_show_checklist_ai_model?: boolean;
  initial_show_page_filenames?: boolean;
  initial_show_page_summary_icons?: boolean;
  initial_show_group_header?: boolean;
  initial_show_group_checklist?: boolean;
  initial_show_group_pages?: boolean;
  initial_show_group_footer?: boolean;
  initial_show_checklist_ai_model_details?: boolean;
  font_scale?: number;
  font_family?: string;
  highlight_mode?: number;
  revisions_history?: IRevisionHistoryExport[];
  initial_show_document_history?: boolean;
  tags?: Array<{ name: string; color: string }>;
  initial_show_tags?: boolean;
  align_labels_to_top?: boolean;
  user_js_1_output_template?: string;
  user_js_1_output_data?: Record<string, unknown>;
  initial_show_user_js_1_output?: boolean;
}

interface IReportExportSuccess extends IReply {
  success: true;
  output_type: 'html';
  report: {
    export: {
      file: IDocumentFileRevision;
    }
  }
}

interface IReportExportError extends IReply {
  success: false;
  message: string;
}

type IReportExportReply = IReportExportSuccess | IReportExportError;

/* ────────────────────────────────────────────────────────────────
   Route plugin
   ──────────────────────────────────────────────────────────────── */

const reportExportPlugin: FastifyPluginAsync = async (app) => {
  app.post<{ 
    Body: IReportExportBody; 
    Reply: IReportExportReply 
  }>(
    '/export',
    {
      preValidation: async (request, reply) => {
        if (request.headers['content-type'] !== 'application/json') {
          reply.code(415);
          throw new Error('Must be application/json');
        }
      },
    },
    async (request, reply) => {
      try {
        /* 1️⃣  Extract & validate input */
        const {
          title,
          envelope_id,
          document_files_revisions,
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
          layout_mode = 'full',
          show_checklist_name = true,
          show_title_info = true,
          show_compliance_summary = true,
          show_compliance_percent = true,
          show_default_footer = true,
          app_version,
          timezone,
          ai_model_id,
          ai_model_display_name,
          ai_model_stars,
          ai_model_stars_display,
          ai_model_credits_per_page,
          ai_model_hipaa,
          ai_model_location,
          ai_model_description,
          ai_model_actual_id,
          ai_model_provider,
          ai_model_model_name,
          initial_show_title_info,
          initial_show_checklist_name,
          show_annotations,
          initial_show_pages_with_checks,
          initial_show_pages_without_checks,
          initial_show_page_images,
          initial_show_check_details,
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
          align_labels_to_top,
          user_js_1_output_template,
          user_js_1_output_data,
          initial_show_user_js_1_output,
        }: IReportExportBody = request.body;

        if (!report) {
          reply.code(400).send({
            success: false,
            message: 'Missing required parameter: report',
            pages_processed: 0
          });
          return;
        }

        if (!document) {
          reply.code(400).send({
            success: false,
            message: 'Missing required parameter: document',
            pages_processed: 0
          });
          return;
        }

        if (!document_files_revisions || document_files_revisions.length === 0) {
          reply.code(400).send({
            success: false,
            message: 'Document must contain at least one file revision',
            pages_processed: 0
          });
          return;
        }

        /* 2️⃣  Generate report (HTML string) */
        let content = '';
        try {
          content = await generateReport(
            {
              title: title,
              envelope_id,
              files: document_files_revisions,
              report,
              checklist: checklist,
              envelope_checklist,
              document,
              previous_revision,
              include_passed_checks,
              check_filter,
              include_rules,
              include_technical_info,
              message_box_mode,
              audit_logs,
              layout_mode,
              show_checklist_name,
              show_title_info,
              show_compliance_summary,
              show_compliance_percent,
              show_default_footer,
              app_version,
              timezone,
              ai_model_id,
              ai_model_display_name,
              ai_model_stars,
              ai_model_stars_display,
              ai_model_credits_per_page,
              ai_model_hipaa,
              ai_model_location,
              ai_model_description,
              ai_model_actual_id,
              ai_model_provider,
              ai_model_model_name,
              show_annotations,
              initial_show_pages_with_checks,
              initial_show_pages_without_checks,
              initial_show_page_images,
              initial_show_check_details,
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
              font_family: font_family as any,
              highlight_mode,
              revisions_history,
              initial_show_document_history,
              tags,
              initial_show_tags,
              align_labels_to_top,
              user_js_1_output_template,
              user_js_1_output_data,
              initial_show_user_js_1_output: initial_show_user_js_1_output,
            }
          );

          if (!content || content.length === 0) {
            const errorMessage = 'Error generating report: no content';
            console.error(errorMessage);
            reply.code(500).send({
              success: false,
              message: errorMessage,
              pages_processed: 0
            });
            return;
          }
        } catch (err) {
          // rethrow the error to be handled by the error handler
          throw err;
        }

        const todayDate = new Date().toISOString();

        /* 3️⃣  Send the response */
        reply.code(200).send({
          success: true,
          output_type: 'html',
          pages_processed: Math.max(1, Math.ceil(content.length / HTML_BYTES_PER_CREDIT_PAGE)),
          report: {
            export: {
              file: {
                id: uuidv4(),
                revision_number: 0,
                created_at: todayDate,
                updated_at: todayDate,
                file_revision_id: `report-export-${uuidv4()}`,
                name: `inspection-report-${(title || 'document').replace(/[.\s]+/g, '-')}.html`,
                mime_type: 'text/html',
                metadata: '',
                pages: [],
                data: content as string,
                size: content.length
              } as IDocumentFileRevision
            }
          }
        });
      } catch (err) {
        /* 4️⃣  Unhandled exception */
        app.log.error({ err }, `Error generating report: ${err}`);
        reply.code(500).send({
          success: false,
          message: 'Error generating report',
          pages_processed: 0
        });
      }
    },
  );
};

export default reportExportPlugin;
