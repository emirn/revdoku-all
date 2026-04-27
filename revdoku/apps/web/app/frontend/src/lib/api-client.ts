import { apiRequest, apiJsonResponse } from '@/config/api';
import { parseApiError } from '@/lib/api-error';
import type { IEnvelope, ICheck, IChecklist, IReport, ICheckFlatten, IRule, IDocumentFile, IDocumentFileRevision, IEnvelopeRevision, ReportJobStatus, CheckSource, ReportLayoutMode, ITag, TagColor, CheckFilterType, IPageText } from '@revdoku/lib';
import type { ICheckResponse, ICreateCheckResponse, IDeleteCheckResponse } from '@/lib/schemas/common-client';
import { setLoadedModels, type IAIModelOption } from '@/lib/ai-model-utils';

// Module-level caches for rarely-changing data
let _modelsCache: { data: { models: IAIModelOption[]; default_model_id?: string; default_checklist_generation_model_id?: string; default_text_extraction_model_id?: string }; at: number } | null = null;
let _tagsCache: { data: { tags: ITag[] }; at: number } | null = null;
const MODELS_CACHE_TTL = 5 * 60_000; // 5 minutes
const TAGS_CACHE_TTL = 60_000; // 60 seconds

// Drop both caches that hold the AI-models snapshot:
//   - `_modelsCache` here drives `getModelsCached()` (5-min TTL).
//   - `setLoadedModels([])` clears the in-memory snapshot pages read via
//     `getLoadedModels()` (the picker dropdowns + the Review dialog).
// Called whenever a provider-key mutation happens — adding/removing/editing
// a key (especially the local-provider Models field) changes the catalog
// the user sees and resolves at request time, so any stale entry in either
// cache is a footgun (saved provider settings → navigate to Envelopes →
// run a review → fails because the model id was rewritten on the server
// but the client still resolves the old one).
function invalidateModelsCache() {
  _modelsCache = null;
  setLoadedModels([]);
}

export interface IAuditLogEntry {
  id: number;
  path: string;
  response_code: number;
  source_type: string;
  user_id: string | null;
  user_name: string | null;
  ip: string | null;
  user_agent: string | null;
  request: Record<string, unknown> | string | null;
  request_id: string | null;
  response: Record<string, unknown> | string | null;
  duration: number | null;
  created_at: string;
}

export interface IPagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface ExportReportOptions {
  format?: 'html' | 'json';
  check_filter?: CheckFilterType;
  include_rules?: boolean;
  include_technical_info?: boolean;
  layout_mode?: ReportLayoutMode;
  show_checklist_name?: boolean;
  show_title_info?: boolean;
  show_compliance_summary?: boolean;
  show_compliance_percent?: boolean;
  show_default_footer?: boolean;
  show_annotations?: boolean;
  show_pages_with_checks?: boolean;
  show_pages_without_checks?: boolean;
  show_page_images?: boolean;
  show_check_details?: boolean;
  show_extracted_data?: boolean;
  show_checklist_info?: boolean;
  show_checklist_general_prompt?: boolean;
  show_checklist_rules_summary?: boolean;
  show_checklist_rules_details?: boolean;
  show_checklist_envelope_rules?: boolean;
  show_timezone?: boolean;
  show_revision_comparison?: boolean;
  show_check_attribution?: boolean;
  show_envelope_datetime?: boolean;
  show_envelope_revisions_info?: boolean;
  show_checklist_ai_model?: boolean;
  show_page_filenames?: boolean;
  show_page_summary_icons?: boolean;
  show_group_header?: boolean;
  show_group_checklist?: boolean;
  show_group_pages?: boolean;
  show_group_footer?: boolean;
  show_checklist_ai_model_details?: boolean;
  show_document_history?: boolean;
  show_tags?: boolean;
  show_user_js_1_output?: boolean;
  user_js_1_output_template?: string;
  user_js_1_output_data?: Record<string, unknown>;
  timezone?: string;
  font_scale?: number;
  font_family?: string;
  highlight_mode?: number;
  align_labels_to_top?: boolean;
}

export class ApiClient {
  // Account members with permissions and limits
  static async getAccountMembers(): Promise<{
    members: Array<{
      id: number;
      prefix_id: string;
      name: string;
      email: string;
      role: string;
      is_owner: boolean;
      removable: boolean;
    }>;
    permissions: {
      can_add_member: boolean;
      can_manage: boolean;
    };
    limits: {
      current_count: number;
      user_limit: number | null;
      can_add_member: boolean;
    };
  }> {
    const response = await apiRequest('/account/members');
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // Add member directly by email. User must already have a Revdoku account.
  static async addMemberByEmail(email: string): Promise<{
    member: {
      id: number;
      user: { id: string; email: string; name: string };
      role: string;
      created_at: string;
    };
  }> {
    const response = await apiRequest('/account/members', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async removeMember(id: number): Promise<void> {
    const response = await apiRequest(`/account/members/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw await parseApiError(response);
  }

  // Audit log endpoints (HIPAA/SOC2)
  static async getAuditLogs(params: {
    start_date?: string;
    end_date?: string;
    user_id?: string;
    failed_only?: boolean;
    envelope_id?: string;
    page?: number;
    per_page?: number;
    humanize?: boolean;
    // Coarse event-class filter mapped on the server to a specific `path`.
    category?: string;
  } = {}): Promise<{ audit_logs: IAuditLogEntry[]; pagination: IPagination }> {
    const query = new URLSearchParams();
    if (params.start_date) query.set('start_date', params.start_date);
    if (params.end_date) query.set('end_date', params.end_date);
    if (params.user_id) query.set('user_id', params.user_id);
    if (params.failed_only !== undefined) query.set('failed_only', String(params.failed_only));
    if (params.envelope_id) query.set('envelope_id', params.envelope_id);
    if (params.page) query.set('page', String(params.page));
    if (params.per_page) query.set('per_page', String(params.per_page));
    if (params.humanize) query.set('humanize', 'true');
    if (params.category) query.set('category', params.category);

    const response = await apiRequest(`/audit_logs${query.toString() ? `?${query.toString()}` : ''}`);
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async exportAuditLogsCsv(params: {
    start_date?: string;
    end_date?: string;
  } = {}): Promise<Blob> {
    const query = new URLSearchParams();
    query.set('format', 'csv');
    if (params.start_date) query.set('start_date', params.start_date);
    if (params.end_date) query.set('end_date', params.end_date);

    const response = await apiRequest(`/audit_logs/export?${query.toString()}`);
    if (!response.ok) throw await parseApiError(response);
    return response.blob();
  }

  static async getResourceAccess(resourceType: 'envelope' | 'report' | 'check' | 'checklist', resourceId: string, days: number = 30): Promise<{ resource_access_report: Record<string, unknown> }> {
    const response = await apiRequest(`/audit_logs/resource_access/${resourceType}/${resourceId}?days=${days}`);
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // Generic object versions endpoint
  static async getObjectVersions(resourceType: 'envelope' | 'report' | 'check' | 'checklist', resourceId: string): Promise<{ versions: Record<string, unknown>[] }> {
    const response = await apiRequest(`/versions/${resourceType}/${resourceId}`);
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }
  // Envelope endpoints
  static async getEnvelopes(params?: { archived?: boolean }): Promise<{ envelopes: IEnvelope[] }> {
    const query = new URLSearchParams();
    if (params?.archived) query.set('archived', 'true');
    const qs = query.toString();
    const response = await apiRequest(`/envelopes${qs ? `?${qs}` : ''}`);

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async getEnvelope(id: string): Promise<{ envelope: IEnvelope }> {
    const response = await apiRequest(`/envelopes/${id}`);

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async createEnvelope(data: { title?: string; tags?: string } = {}): Promise<{ envelope: IEnvelope }> {
    const response = await apiRequest('/envelopes', {
      method: 'POST',
      body: JSON.stringify({ envelope: data })
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async updateEnvelope(id: string, data: Partial<IEnvelope>): Promise<{ envelope: IEnvelope }> {
    const response = await apiRequest(`/envelopes/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ envelope: data })
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async deleteEnvelope(id: string): Promise<void> {
    const response = await apiRequest(`/envelopes/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }
  }

  static async rollbackEnvelope(envelopeId: string, revisionIndex: number): Promise<{ envelope: IEnvelope }> {
    const response = await apiRequest(`/envelopes/${envelopeId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ revision_index: revisionIndex })
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }


  static async archiveEnvelope(id: string): Promise<{ envelope: IEnvelope }> {
    const response = await apiRequest(`/envelopes/${id}/archive`, { method: 'POST' });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async unarchiveEnvelope(id: string): Promise<{ envelope: IEnvelope }> {
    const response = await apiRequest(`/envelopes/${id}/unarchive`, { method: 'POST' });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async toggleEnvelopeStar(id: string): Promise<{ envelope: IEnvelope }> {
    const response = await apiRequest(`/envelopes/${id}/toggle_star`, { method: 'POST' });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async duplicateEnvelope(
    id: string,
    copyMode: 'latest_only' | 'all_revisions',
    includeManualChecks: boolean = true
  ): Promise<{ envelope: IEnvelope; message?: string }> {
    const response = await apiRequest(`/envelopes/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({
        copy_mode: copyMode,
        include_manual_checks: includeManualChecks
      })
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async exportEnvelopeFixture(id: string, revisionId?: string): Promise<{ fixture: unknown; filename: string }> {
    const response = await apiRequest(`/envelopes/${id}/debug_only_export_fixture`, {
      method: 'POST',
      body: JSON.stringify({ envelope_revision_id: revisionId }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async loadFixture(fixture: unknown): Promise<{ envelope: IEnvelope }> {
    const response = await apiRequest('/envelopes/load_fixture', {
      method: 'POST',
      body: JSON.stringify({ fixture }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async clearEnvelopeCaches(envelopeId: string): Promise<{ cleared: number; message: string }> {
    const response = await apiRequest(`/envelopes/${envelopeId}/clear_caches`, { method: 'POST' });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  /** Max base64 thumbnail payload size (~150 KB encoded ~ 112 KB image) */
  static readonly MAX_THUMBNAIL_BASE64_LENGTH = 200_000;

  static async uploadThumbnail(envelopeId: string, dataUrl: string): Promise<void> {
    // Strip data URL prefix to get raw base64 for size check
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    if (base64.length > ApiClient.MAX_THUMBNAIL_BASE64_LENGTH) return;

    await apiRequest(`/envelopes/${envelopeId}/thumbnail`, {
      method: 'PUT',
      body: JSON.stringify({ thumbnail: dataUrl }),
    });
  }

  static async bulkEnvelopeAction(actionType: 'archive' | 'unarchive' | 'delete', ids: string[]): Promise<{ affected_count: number }> {
    const response = await apiRequest('/envelopes/bulk_action', {
      method: 'POST',
      body: JSON.stringify({ action_type: actionType, ids })
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async updateRevisionComment(envelopeId: string, comment: string): Promise<{ revision: IEnvelopeRevision }> {
    const response = await apiRequest(`/envelopes/${envelopeId}/update_revision_comment`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async editCurrentRevision(envelopeId: string, fileState: Array<{
    document_file_id?: string;
    revision_number?: number;
    new_file?: boolean;
    replacement?: boolean;
    file_index?: number;
  }>, files: File[], comment?: string, pageCount?: number): Promise<{ revision: IEnvelopeRevision; envelope: { current_revision_index: number; title?: string } }> {
    const formData = new FormData();
    formData.append('file_state', JSON.stringify(fileState));
    if (comment) {
      formData.append('comment', comment);
    }
    if (pageCount != null) {
      formData.append('page_count', String(pageCount));
    }
    files.forEach((file, index) => {
      formData.append(`files[${index}]`, file);
    });

    const response = await apiRequest(`/envelopes/${envelopeId}/edit_current_revision`, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Skip-Content-Type': 'true'
      }
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async getEnvelopeDocumentFiles(envelopeId: string): Promise<{ document_files: IDocumentFile[] }> {
    const response = await apiRequest(`/envelopes/${envelopeId}/document_files`);

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async createEnvelopeRevision(envelopeId: string, data: {
    comment?: string;
    copy_existing_files?: boolean;
  }): Promise<{ revision: IEnvelopeRevision; envelope: { current_revision_index: number } }> {
    const response = await apiRequest(`/envelopes/${envelopeId}/create_revision`, {
      method: 'POST',
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async updateDocumentFiles(envelopeId: string, fileState: Array<{
    document_file_id?: string;
    revision_number?: number;
    new_file?: boolean;
    replacement?: boolean;
    file_index?: number;
  }>, files: File[], changeSummary?: string, pageCount?: number): Promise<{ revision: IEnvelopeRevision; envelope: { current_revision_index: number; title?: string } }> {
    const formData = new FormData();

    // Add file state as JSON
    formData.append('file_state', JSON.stringify(fileState));

    // Add change summary if provided
    if (changeSummary) {
      formData.append('comment', changeSummary);
    }

    // Add total page count for per-page credit pricing
    if (pageCount != null) {
      formData.append('page_count', String(pageCount));
    }

    // Add actual files
    files.forEach((file, index) => {
      formData.append(`files[${index}]`, file);
    });

    const response = await apiRequest(`/envelopes/${envelopeId}/update_document_files`, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type header - let browser set it with boundary for FormData
      headers: {
        'X-Skip-Content-Type': 'true'
      }
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async deleteDocumentFile(sourceFileId: string): Promise<void> {
    const response = await apiRequest(`/document_files/${sourceFileId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }
  }

  // File revision endpoints

  static async getDocumentFileRevisionContent(id: string): Promise<{ content: string; mime_type: string; name: string }> {
    const response = await apiRequest(`/document_file_revisions/${id}/content`);
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // Copies an envelope-scoped reference file into the account library.
  // Optional `name` overrides the saved filename (trimmed; falls back to source name).
  static async copyRefFileToLibrary(
    documentFileRevisionId: string,
    name?: string,
  ): Promise<{ document_file: any; latest_revision: any }> {
    const response = await apiRequest('/files/copy_to_library', {
      method: 'POST',
      body: JSON.stringify({ document_file_revision_id: documentFileRevisionId, name: name || undefined }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // Deletes a library DocumentFile (and all its revisions + blobs).
  // Server refuses with 422 LIBRARY_FILE_IN_USE when pinned by any
  // envelope revision; caller should surface that message to the user.
  static async deleteLibraryFile(documentFilePrefixId: string): Promise<void> {
    const response = await apiRequest(`/files/${documentFilePrefixId}`, { method: 'DELETE' });
    if (!response.ok) throw await parseApiError(response);
  }

  // AI Model endpoints
  static async getModels(): Promise<{
    models: IAIModelOption[];
    // Aliases map to an ordered list of concrete model ids and resolve
    // to the first whose provider is reachable.
    aliases?: IAIModelOption[];
    default_model_id?: string;
    default_checklist_generation_model_id?: string;
    default_text_extraction_model_id?: string;
    providers?: Array<{
      provider_key: string;
      name: string;
      hipaa: boolean;
      zdr: boolean;
      available: boolean;
      source: 'account' | 'env' | 'none';
      // Account's chosen sub-provider model id (e.g. "gpt-4.1-2025-04-14");
      // null when the owner hasn't picked one.
      model_id: string | null;
      // Catalog's provider-level default sub-provider model id.
      default_model_id: string | null;
      // Per-provider catalog permissions (default false in YAML).
      // `byok`   — owner may store their own API key.
      // `custom` — owner may override base_url + maintain a per-account
      //            models list. UI gates editor visibility on this.
      byok: boolean;
      custom: boolean;
      base_url: string | null;
      default_base_url: string | null;
      models: Array<{ id: string; name: string; credits_per_page?: number; stars?: number; max_pages?: number; description?: string }>;
    }>;
    // Named `revdoku_options` presets (shared across editions). Each preset
    // bundles options / grid_mode / ai_coord_scale / response_format /
    // max_pages. Rails expands the preset into the doc-api envelope at
    // resolve-time. `desc` is a human-readable blurb for the UI dropdown.
    revdoku_option_presets?: Array<{ key: string; desc: string | null }>;
    // Single-item list with the deployment's locked region. Both editions
    // surface it for display only (the picker has no region selector).
    available_regions?: string[];
    preferred_region?: string;
    feature_flags?: {
      hipaa_mode: boolean;
      // Instance gate for `custom: true` providers (Custom LLM N).
      byok_customizable: boolean;
      byok_enabled: boolean;
    };
  }> {
    const response = await apiRequest('/ai_models');

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async getModelsCached(): Promise<Awaited<ReturnType<typeof ApiClient.getModels>>> {
    if (_modelsCache && Date.now() - _modelsCache.at < MODELS_CACHE_TTL) return _modelsCache.data as Awaited<ReturnType<typeof ApiClient.getModels>>;
    const result = await ApiClient.getModels();
    _modelsCache = { data: result as unknown as { models: IAIModelOption[]; default_model_id?: string; default_checklist_generation_model_id?: string; default_text_extraction_model_id?: string }, at: Date.now() };
    return result;
  }

  // Checklist endpoints
  static async getChecklists(): Promise<{ checklists: IChecklist[] }> {
    const response = await apiRequest(`/checklists`);

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  // gets checklist by id with all the details and rules
  static async getChecklist(id: string): Promise<{ checklist: IChecklist }> {
    const response = await apiRequest(`/checklists/${id}`);

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async createChecklist(checklist: Partial<IChecklist>): Promise<{ checklist: IChecklist }> {
    const response = await apiRequest(`/checklists`, {
      method: 'POST',
      body: JSON.stringify({
        checklist: {
          name: checklist.name,
          system_prompt: checklist.system_prompt,
          ai_model: checklist.ai_model,
          source_text: checklist.source_text,
          rules: checklist.rules?.map(rule => ({
            prompt: rule.prompt,
            order: rule.order
          })),
          user_scripts: (checklist as any).user_scripts,
        }
      })
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async updateChecklist(id: string, checklist: Partial<IChecklist>): Promise<{ checklist: IChecklist }> {
    const response = await apiRequest(`/checklists/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        checklist: {
          name: checklist.name,
          system_prompt: checklist.system_prompt,
          ai_model: checklist.ai_model,
          source_text: checklist.source_text,
          rules: checklist.rules?.map(rule => ({
            id: rule.id,
            prompt: rule.prompt,
            order: rule.order
          })),
          user_scripts: (checklist as any).user_scripts,
        }
      })
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async deleteChecklist(id: string): Promise<void> {
    const response = await apiRequest(`/checklists/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }
  }

  static async getChecklistVersions(id: string): Promise<{ versions: Record<string, unknown>[] }> {
    const response = await apiRequest(`/checklists/${id}/versions`);

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async rollbackChecklist(id: string, versionId: string): Promise<{ checklist: IChecklist; message: string }> {
    const response = await apiRequest(`/checklists/${id}/rollback/${versionId}`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async addChecklistRules(
    checklistId: string,
    rules: Array<{ prompt: string }>,
    sourceEnvelopeRevisionId?: string
  ): Promise<{ checklist: IChecklist }> {
    const response = await apiRequest(`/checklists/${checklistId}/add_rules`, {
      method: 'POST',
      body: JSON.stringify({
        rules,
        source_envelope_revision_id: sourceEnvelopeRevisionId,
      }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async removeChecklistRules(checklistId: string, ruleIds: string[]): Promise<{ checklist: IChecklist }> {
    const response = await apiRequest(`/checklists/${checklistId}/remove_rules`, {
      method: 'POST',
      body: JSON.stringify({ rule_ids: ruleIds }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async updateChecklistRules(checklistId: string, rules: Array<{ id: string; prompt: string }>): Promise<{ checklist: IChecklist }> {
    const response = await apiRequest(`/checklists/${checklistId}/update_rules`, {
      method: 'POST',
      body: JSON.stringify({ rules }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // --- Envelope revision custom rules ---

  static async addRevisionCustomRules(
    revisionId: string,
    rules: Array<{ prompt: string }>
  ): Promise<{ envelope_revision: IEnvelopeRevision }> {
    const response = await apiRequest(`/envelope_revisions/${revisionId}/add_revision_rules`, {
      method: 'POST',
      body: JSON.stringify({ rules }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async updateRevisionCustomRules(
    revisionId: string,
    rules: Array<{ id: string; prompt: string }>
  ): Promise<{ envelope_revision: IEnvelopeRevision }> {
    const response = await apiRequest(`/envelope_revisions/${revisionId}/update_revision_rules`, {
      method: 'POST',
      body: JSON.stringify({ rules }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async removeRevisionCustomRules(
    revisionId: string,
    ruleIds: string[]
  ): Promise<{ envelope_revision: IEnvelopeRevision }> {
    const response = await apiRequest(`/envelope_revisions/${revisionId}/remove_revision_rules`, {
      method: 'POST',
      body: JSON.stringify({ rule_ids: ruleIds }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async getAllCustomRules(
    revisionId: string
  ): Promise<{ revision_rules: IRule[] }> {
    const response = await apiRequest(`/envelope_revisions/${revisionId}/all_revision_rules`);
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async generateChecklist(source_text: string, ai_model?: string): Promise<{ checklist: IChecklist }> {
    const body: Record<string, string> = { source_text };
    if (ai_model) body.ai_model = ai_model;

    const response = await apiRequest(`/checklists/generate`, {
      method: 'POST',
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  // Checklist template catalog (global, read-only). Full content is
  // returned so the picker UI can pre-fill the create-checklist form
  // with name/system_prompt/rules/user_scripts in one round-trip.
  static async getChecklistTemplates(): Promise<{
    templates: Array<{
      id: string;                              // prefix_id (ctpl_...)
      name: string;
      system_prompt: string | null;
      rules: Array<{ prompt: string; order?: number; title?: string; origin?: string }>;
      rules_count: number;
      user_scripts: Array<{ id?: string; name?: string; code: string; created_at?: string }>;
      default_for_new_account: boolean;
      updated_at: string;
    }>;
  }> {
    const response = await apiRequest('/checklist_templates');
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // ── Per-account AI provider keys ─────────────────────────────────────
  // Backed by the encrypted Account#ai_provider_keys JSON attribute. Every
  // account may configure its own key per provider; when absent, the
  // instance ENV fallback applies. See
  // apps/web/app/controllers/api/v1/account/ai_provider_keys_controller.rb.

  static async listProviderKeys(): Promise<{ keys: Array<{
    provider: string;
    name: string;
    in_catalog: boolean;
    // Catalog permissions (defaults false in YAML).
    byok: boolean;
    custom: boolean;
    configured: boolean;
    enabled: boolean;
    key_suffix: string | null;
    model_id: string | null;
    default_model_id: string | null;
    base_url: string | null;
    default_base_url: string | null;
    // User-defined custom-provider models — `alias` is the picker label
    // and the account-scoped identifier (validated for uniqueness on
    // save); `model_id` is the upstream API model name sent verbatim to
    // the provider SDK. `revdoku_options` carries an optional preset key.
    models: Array<{ alias: string; model_id: string; revdoku_options?: string | null; stars?: number; description?: string }>;
    env_var_fallback_available: boolean;
  }> }> {
    const response = await apiRequest('/account/ai_provider_keys');
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async addProviderKey(provider: string, api_key: string): Promise<{ provider: string; configured: boolean }> {
    const response = await apiRequest('/account/ai_provider_keys', {
      method: 'POST',
      body: JSON.stringify({ provider, api_key }),
    });
    if (!response.ok) throw await parseApiError(response);
    invalidateModelsCache();
    return apiJsonResponse(response);
  }

  static async updateProviderKey(
    provider: string,
    patch: {
      api_key?: string;
      enabled?: boolean;
      model_id?: string | null;
      base_url?: string | null;
      // Structured form is the only supported shape — each row carries its
      // own `alias` (picker label, account-scoped identifier), `model_id`
      // (upstream API model name), and optional `revdoku_options` preset.
      models?: Array<{ alias: string; model_id: string; revdoku_options?: string | null; stars?: number }>;
    }
  ): Promise<{
    provider: string;
    configured: boolean;
    enabled: boolean;
    model_id: string | null;
    base_url: string | null;
    models: Array<{ alias: string; model_id: string; revdoku_options?: string | null; stars?: number }>;
  }> {
    const response = await apiRequest(`/account/ai_provider_keys/${encodeURIComponent(provider)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw await parseApiError(response);
    invalidateModelsCache();
    return apiJsonResponse(response);
  }

  static async removeProviderKey(provider: string): Promise<{ removed: string }> {
    const response = await apiRequest(`/account/ai_provider_keys/${encodeURIComponent(provider)}`, { method: 'DELETE' });
    if (!response.ok) throw await parseApiError(response);
    invalidateModelsCache();
    return apiJsonResponse(response);
  }

  // Fire a 1-token test request against the provider's configured key +
  // default model. Backs the per-provider Test button on /account/ai.
  // Always returns a result object — even network / config failures come
  // back as { ok: false, message }, so the caller never needs to try/catch
  // for normal failure modes.
  static async testProviderKey(provider: string): Promise<{ ok: boolean; served_model?: string; message?: string }> {
    const response = await apiRequest(`/account/ai_provider_keys/${encodeURIComponent(provider)}/test`, { method: 'POST' });
    // 401 from the provider is a *success* of the test (the test got an
    // answer from the upstream) — the API returns the result body
    // verbatim, so route both the OK and the 401-on-key-rejected paths
    // through the same JSON parse.
    return apiJsonResponse(response);
  }

  // Report endpoints
  static async createStubReport(data: {
    envelope_revision_id: string;
    checklist_id?: string;
  }): Promise<{ report: IReport }> {
    const response = await apiRequest('/reports/create_stub', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async createReport(data: {
    envelope_revision_id: string;
    checklist_id: string;
    previous_report_id?: string;
    force?: boolean;
    skip_ai?: boolean;
    checklist_switch?: boolean;
    skip_previous_checks?: boolean;
    pages?: string;
    timezone?: string;
    debug?: {
      grid_mode?: string;
      overlay_checks_on_grid?: boolean;
    };
    page_font_scales?: Record<number, number>;
    ai_model?: string;
    track_changes?: boolean;
    highlight_mode?: number;
    /**
     * Reference files pinned to specific rules (or to the checklist as a
     * whole, when rule_id is null). Satisfies `#file` / `file:<id>`
     * markers in the selected checklist. Each entry points at a
     * DocumentFileRevision that was previously uploaded via `uploadFile`.
     */
    reference_files?: Array<{
      rule_id: string | null;
      document_file_revision_id: string;
    }>;
    /**
     * Per-review free-text context the user typed in the "Add note"
     * section. Rails stores on the report's inspection_context; doc-api
     * injects it after the checklist.system_prompt inside a
     * <review_context> block. Absent key preserves any stored note on
     * re-runs; empty string clears it.
     */
    review_note?: string;
    /**
     * Ad-hoc reference files the user attached inside the "Add note"
     * section even though the checklist didn't request them via
     * #ref[...]. Capped at MAX_AD_HOC_REF_FILES server-side. Each entry
     * is a ready-to-use DocumentFileRevision prefix_id the dialog
     * obtained via `uploadFile`.
     */
    ad_hoc_ref_files?: Array<{
      document_file_revision_id: string;
      label?: string;
    }>;
  }): Promise<{ report: IReport; debug_info?: string; revdoku_doc_api_elapsed_ms?: number }> {
    const response = await apiRequest('/reports', {
      method: 'POST',
      body: JSON.stringify({
        envelope_revision_id: data.envelope_revision_id,
        checklist_id: data.checklist_id,
        previous_report_id: data.previous_report_id,
        force: data.force,
        skip_ai: data.skip_ai,
        checklist_switch: data.checklist_switch,
        skip_previous_checks: data.skip_previous_checks,
        pages: data.pages,
        timezone: data.timezone,
        debug: data.debug,
        page_font_scales: data.page_font_scales,
        ai_model: data.ai_model,
        track_changes: data.track_changes,
        highlight_mode: data.highlight_mode,
        reference_files: data.reference_files,
        review_note: data.review_note,
        ad_hoc_ref_files: data.ad_hoc_ref_files,
      })
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  /**
   * Upload a reference file to the account file library. Backs the
   * Review dialog's upload slots (when a rule has `#file`) and the
   * ChecklistDialog's library picker (when the author inserts a
   * `file:df_...` marker).
   *
   * Returns the created DocumentFile + its first DocumentFileRevision.
   * For text uploads (csv/txt) the revision is immediately `ready`; for
   * PDFs the frontend polls because OCR runs async server-side.
   */
  /**
   * Returns the current readiness state of a single library
   * DocumentFileRevision by its prefix_id. Polled by the Review dialog
   * during the "preparing review" phase while the upload's background
   * NormalizeDocumentFileRevisionJob runs OCR on PDFs/images.
   */
  static async getFileRevisionStatus(revisionPrefixId: string): Promise<{
    revision: {
      prefix_id: string;
      revision_number: number;
      name: string;
      mime_type: string;
      byte_size: number;
      ready: boolean;
      uploaded_at: string;
    };
  }> {
    const response = await apiRequest(`/files/revisions/${revisionPrefixId}`);
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  /**
   * Fetches library files previously used for this checklist + scope.
   * Powers the "Recently used" suggestion chips in the Review dialog.
   * Returns plain metadata — no file bytes — so showing suggestions
   * does not require decrypting content blobs.
   */
  static async getChecklistFileSuggestions(args: {
    checklistId: string;
    ruleId?: string;
    checklistScoped?: boolean;
  }): Promise<{
    suggestions: Array<{
      document_file_revision_id: string;
      name: string;
      mime_type: string;
      byte_size: number;
      revision_number: number;
      last_used_at: string;
    }>;
  }> {
    const qs = new URLSearchParams();
    if (args.ruleId) qs.set('rule_id', args.ruleId);
    if (args.checklistScoped) qs.set('checklist_scoped', 'true');
    const response = await apiRequest(`/checklists/${args.checklistId}/file_suggestions?${qs.toString()}`);
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // Lists the account's library of reference files. Used by the inline
  // #file chip editor's popover so the user can pin an existing library
  // file without leaving the checklist dialog.
  static async listLibraryFiles(query?: string): Promise<{
    files: Array<{
      prefix_id: string;
      library: boolean;
      latest_revision: {
        prefix_id: string;
        revision_number: number;
        name: string;
        mime_type: string;
        byte_size: number;
        ready: boolean;
        uploaded_at: string;
      };
    }>;
  }> {
    const qs = new URLSearchParams();
    if (query) qs.set('q', query);
    const response = await apiRequest(`/files${qs.toString() ? `?${qs}` : ''}`);
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async uploadFile(args: {
    file: File;
    save_in_library?: boolean;
    envelope_id?: string;
  }): Promise<{
    document_file: {
      prefix_id: string;
      library: boolean;
      latest_revision: {
        prefix_id: string;
        revision_number: number;
        name: string;
        mime_type: string;
        byte_size: number;
        ready: boolean;
        uploaded_at: string;
      };
    };
    latest_revision: {
      prefix_id: string;
      revision_number: number;
      name: string;
      mime_type: string;
      byte_size: number;
      ready: boolean;
      uploaded_at: string;
    };
  }> {
    const form = new FormData();
    form.append('file', args.file);
    if (args.save_in_library) form.append('save_in_library', 'true');
    if (args.envelope_id) form.append('envelope_id', args.envelope_id);

    const response = await apiRequest('/files', {
      method: 'POST',
      body: form,
      // X-Skip-Content-Type opts out of apiRequest's default
      // application/json header so the browser generates the
      // multipart/form-data boundary itself. See config/api.ts:200.
      headers: { 'X-Skip-Content-Type': '1' },
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async getReport(id: string): Promise<{ report: IReport }> {
    const response = await apiRequest(`/reports/${id}`);

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async getReportStatus(id: string): Promise<{
    report: IReport;
    job_status: ReportJobStatus;
    job_id?: string;
    error_message?: string;
    envelope_user_scripts?: Array<{ id: string; name?: string; code: string; created_at?: string }>;
  }> {
    const response = await apiRequest(`/reports/${id}/status`);

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async getReportPageTexts(reportId: string): Promise<{ page_texts: IPageText[] }> {
    const response = await apiRequest(`/reports/${reportId}/page_texts`);
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // Fetches cached per-page text for a library DocumentFileRevision. Same
  // shape as getReportPageTexts so the diff viewer can feed both through
  // identical downstream code. Library files are normalised by
  // NormalizeDocumentFileRevisionJob on upload; page_texts is populated
  // for PDFs/images (via ai.extractPageTexts in doc-api) and for csv/txt
  // (via PromptSanitizer on Rails).
  static async getLibraryFileRevisionPageTexts(revisionPrefixId: string): Promise<{ page_texts: IPageText[] }> {
    const response = await apiRequest(`/files/revisions/${revisionPrefixId}/page_texts`);
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  /**
   * Cancel an reviewing report job
   */
  static async cancelReport(id: string): Promise<{
    report: IReport;
    refunded: boolean;
    already_completed?: boolean;
    envelope_user_scripts?: Array<{ id: string; name?: string; code: string; created_at?: string }>;
  }> {
    const response = await apiRequest(`/reports/${id}/cancel`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async resetReport(id: string): Promise<{ report: IReport }> {
    const response = await apiRequest(`/reports/${id}/reset`, { method: 'POST' });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // POST /api/v1/reports/:id/resume — resume review from the first unreviewed page.
  // Charges credits for remaining pages, re-enqueues CreateReportJob with meta.resume = true.
  static async resumeReport(id: string, options?: { timezone?: string }): Promise<{
    report: IReport;
    pages_to_review: number;
  }> {
    const body: Record<string, unknown> = {};
    if (options?.timezone) body.timezone = options.timezone;
    const response = await apiRequest(`/reports/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async updateReportFontScale(reportId: string, pageFontScales: Record<number, number>): Promise<{ report: IReport }> {
    const response = await apiRequest(`/reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({ page_font_scales: pageFontScales }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async updateReportFontFamily(reportId: string, fontFamily: string | null): Promise<{ report: IReport }> {
    const response = await apiRequest(`/reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({ font_family: fontFamily }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async updateReportHighlightMode(reportId: string, highlightMode: number): Promise<{ report: IReport }> {
    const response = await apiRequest(`/reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({ highlight_mode: highlightMode }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async updateReportUserScriptsOutput(reportId: string, scriptId: string, data: Record<string, unknown>, template: string): Promise<{ report: IReport }> {
    const entry: Record<string, unknown> = { id: scriptId, data, template, executed_at: new Date().toISOString() };
    const response = await apiRequest(`/reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({ user_scripts_output: [entry] }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async clearReportUserScriptsOutput(reportId: string): Promise<{ report: IReport }> {
    const response = await apiRequest(`/reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({ user_scripts_output: [] }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async exportReport(
    reportId: string,
    opts: ExportReportOptions = {}
  ): Promise<{ content: string; format: string; content_type: string; report_id: string }> {
    const {
      format = 'html',
      check_filter = 'failed',
      include_rules = false,
      include_technical_info = false,
      layout_mode = 'compact',
      show_checklist_name = false,
      show_title_info = true,
      show_compliance_summary = false,
      show_compliance_percent = true,
      show_default_footer = true,
      show_annotations = true,
      show_pages_with_checks = true,
      show_pages_without_checks = true,
      show_page_images = true,
      show_check_details = true,
      show_extracted_data = false,
      show_checklist_info = true,
      show_checklist_general_prompt = true,
      show_checklist_rules_summary = true,
      show_checklist_rules_details = true,
      show_checklist_envelope_rules = true,
      show_timezone = true,
      show_revision_comparison = true,
      show_check_attribution = false,
      show_envelope_datetime = true,
      show_envelope_revisions_info = true,
      show_checklist_ai_model = false,
      show_page_filenames = true,
      show_page_summary_icons = true,
      show_group_header = true,
      show_group_checklist = false,
      show_group_pages = true,
      show_group_footer = true,
      show_checklist_ai_model_details = false,
      show_document_history = false,
      show_tags = true,
      show_user_js_1_output = true,
      user_js_1_output_template,
      user_js_1_output_data,
      timezone,
      font_scale = 1.0,
      font_family,
      highlight_mode,
      align_labels_to_top = false,
    } = opts;

    const response = await apiRequest(`/reports/${reportId}/export`, {
      method: 'POST',
      body: JSON.stringify({
        format,
        check_filter,
        include_rules,
        include_technical_info,
        layout_mode,
        show_checklist_name,
        show_title_info,
        show_compliance_summary,
        show_compliance_percent,
        show_default_footer,
        show_annotations,
        show_pages_with_checks,
        show_pages_without_checks,
        show_page_images,
        show_check_details,
        show_extracted_data,
        show_checklist_info,
        show_checklist_general_prompt,
        show_checklist_rules_summary,
        show_checklist_rules_details,
        show_checklist_envelope_rules,
        show_timezone,
        show_revision_comparison,
        show_check_attribution,
        show_envelope_datetime,
        show_envelope_revisions_info,
        show_checklist_ai_model,
        show_page_filenames,
        show_page_summary_icons,
        show_group_header,
        show_group_checklist,
        show_group_pages,
        show_group_footer,
        show_checklist_ai_model_details,
        show_document_history,
        show_tags,
        show_user_js_1_output,
        user_js_1_output_template,
        user_js_1_output_data,
        timezone,
        font_scale,
        font_family,
        highlight_mode,
        align_labels_to_top,
      })
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  // Check endpoints
  static async createCheck(reportId: string, newCheck: ICheck): Promise<ICreateCheckResponse> {
    // Transform location object to individual parameters

    const response = await apiRequest(`/reports/${reportId}/checks`, {
      method: 'POST',
      body: JSON.stringify({ check: newCheck })
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async updateCheck(checkId: string, data: Partial<ICheck>): Promise<ICheckResponse> {
    const response = await apiRequest(`/checks/${checkId}`, {
      method: 'PUT',
      body: JSON.stringify({ check: data })
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async deleteCheck(checkId: string): Promise<void> {
    const response = await apiRequest(`/checks/${checkId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    // Returns 204 No Content
  }

  // API Key endpoints
  //
  // Two surfaces, two auth postures:
  //   - Singular (`getPrimaryApiKey` / `rotatePrimaryApiKey`) — always available.
  //     Every user has exactly one primary key they can view + rotate.
  //   - Multi-key (`getApiKeys` / `createApiKey` / `revokeApiKey`) — gated
  //     server-side on the `api_key_management` feature flag. 404s on CE.
  static async getPrimaryApiKey(): Promise<{
    // null when the user has never generated a primary API key on this
    // account. The settings page renders a "Generate API key" CTA in that
    // state; the backend no longer auto-mints a key just because #show was
    // called.
    token: {
      id: string;
      name: string;
      masked_hint: string;
      created_at: string;
      last_used_at: string | null;
      expires_at: string;
    } | null;
  }> {
    const response = await apiRequest('/account/api_key');
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async rotatePrimaryApiKey(): Promise<{
    token: {
      id: string;
      name: string;
      masked_hint: string;
      created_at: string;
      last_used_at: string | null;
      expires_at: string;
      plaintext_token: string;
    };
  }> {
    const response = await apiRequest('/account/api_key/rotate', { method: 'POST' });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async getApiKeys(): Promise<{
    tokens: Array<{
      id: string;
      name: string;
      masked_hint: string;
      created_at: string;
      last_used_at: string | null;
      expires_at: string;
    }>;
  }> {
    const response = await apiRequest('/account/api_keys');
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async createApiKey(name: string, expiresIn: '30d' | '90d' | '1y' | '3y' | '5y'): Promise<{
    token: {
      id: string;
      name: string;
      masked_hint: string;
      created_at: string;
      last_used_at: string | null;
      expires_at: string;
      plaintext_token: string;
    };
  }> {
    const response = await apiRequest('/account/api_keys', {
      method: 'POST',
      body: JSON.stringify({ name, expires_in: expiresIn }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async revokeApiKey(id: string): Promise<{ message: string }> {
    const response = await apiRequest(`/account/api_keys/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // Account endpoints
  static async getAccountProfile(): Promise<{
    profile: {
      user: {
        id: string;
        email: string;
        name: string;
        first_name: string;
        last_name: string;
        created_at: string;
        last_sign_in_at: string | null;
        last_sign_in_ip?: string | null;
        sign_in_count: number;
        two_factor_enabled: boolean;
        time_zone: string | null;
      };
      login_history: Array<{
        signed_in_at: string;
        device_summary: string;
        ip_address?: string;
        user_agent?: string | null;
      }>;
      current_account: {
        id: string;
        name: string;
        personal?: boolean;
        security_level: string;
        hipaa_enabled: boolean;
        default_checklist_generation_model: string | null;
        default_checklist_model: string | null;
        default_text_extraction_model: string | null;
        default_font_family?: string | null;
        default_font_scale?: number | null;
        primary_color?: string | null;
        data_region?: { id: string; name: string; location: string } | null;
      };
    };
  }> {
    const response = await apiRequest('/account/profile');
    if (!response.ok) {
      throw await parseApiError(response);
    }
    return apiJsonResponse(response);
  }


  static async updateProfile(data: {
    time_zone?: string;
    first_name?: string;
    last_name?: string;
    account_name?: string;
    primary_color?: string | null;
  }): Promise<{ time_zone: string; first_name: string; last_name: string; name: string; account_name: string; primary_color?: string | null }> {
    const response = await apiRequest('/account/update_profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async updateAiPreferences(prefs: {
    default_checklist_generation_model?: string | null;
    default_checklist_model?: string | null;
    default_text_extraction_model?: string | null;
  }): Promise<{
    default_checklist_generation_model: string | null;
    default_checklist_model: string | null;
    default_text_extraction_model: string | null;
    // Echo of the deployment-locked region; informational only — there's
    // no `preferred_region` write field above.
    preferred_region: string;
  }> {
    const response = await apiRequest('/account/ai_preferences', {
      method: 'PATCH',
      body: JSON.stringify(prefs),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async getAccountOrders(): Promise<{
    orders: Array<{
      prefix_id: string;
      order_ref: string;
      credits: number;
      amount_cents: number;
      status: string;
      note: string | null;
      ordered_at: string;
      invoice_url: string | null;
      plan_name: string | null;
    }>;
  }> {
    const response = await apiRequest('/account/orders');
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async cancelAccountSubscription(): Promise<{
    message: string;
    previous_subscription_sku: string;
  }> {
    const response = await apiRequest('/account/cancel_subscription', {
      method: 'POST',
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }


  static async getAccountCredits(): Promise<{
    credits: {
      balance: number;
      subscription: number;
      purchased: number;
      total: number;
      purchased_expires_at: string | null;
      account_id: string;
      account_name: string;
      plan: {
        name: string;
        credits_per_month: number;
        interval: number;
        price_cents: number;
        interval_label: string;
        max_security_level: number;
        supports_hipaa: boolean;
        audit_retention_days: number;
        is_payg: boolean;
        is_canceling: boolean;
        cancels_at: string | null;
      };
      account_limits: {
        max_envelopes: number;
        max_revisions: number;
        max_checklists: number;
        max_file_size_mb: number;
        max_team_members: number;
      };
      next_refill_at: string | null;
    };
  }> {
    const response = await apiRequest('/account/credits');

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  static async switchAccount(accountId: string): Promise<{
    account: { id: string; name: string; personal: boolean };
  }> {
    const response = await apiRequest('/account/switch_account', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async logout(): Promise<{
    message: string;
    redirect_to: string;
  }> {
    const response = await apiRequest('/account/logout', {
      method: 'POST'
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  // Tag endpoints
  static async getTags(): Promise<{ tags: ITag[] }> {
    const response = await apiRequest('/tags');
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async getTagsCached(): Promise<{ tags: ITag[] }> {
    if (_tagsCache && Date.now() - _tagsCache.at < TAGS_CACHE_TTL) return _tagsCache.data;
    const result = await ApiClient.getTags();
    _tagsCache = { data: result, at: Date.now() };
    return result;
  }

  static async createTag(data: { name: string; color: TagColor; parent_id?: string | null }): Promise<{ tag: ITag }> {
    const response = await apiRequest('/tags', {
      method: 'POST',
      body: JSON.stringify({ tag: data }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async updateTag(id: string, data: Partial<{ name: string; color: TagColor; position: number; parent_id: string | null }>): Promise<{ tag: ITag }> {
    const response = await apiRequest(`/tags/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ tag: data }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async deleteTag(id: string): Promise<void> {
    const response = await apiRequest(`/tags/${id}`, { method: 'DELETE' });
    if (!response.ok) throw await parseApiError(response);
  }

  static async addTagsToEnvelope(envelopeId: string, tagIds: string[]): Promise<{ tags: ITag[] }> {
    const response = await apiRequest(`/envelopes/${envelopeId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tag_ids: tagIds }),
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async removeTagFromEnvelope(envelopeId: string, tagId: string): Promise<{ tags: ITag[] }> {
    const response = await apiRequest(`/envelopes/${envelopeId}/tags/${tagId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // Active sessions management
  static async getSessions(): Promise<{
    sessions: Array<{
      id: string;
      device_info: Record<string, string>;
      display_device: string;
      ip_address: string | null;
      last_used_at: string | null;
      created_at: string;
      is_current: boolean;
    }>;
  }> {
    const response = await apiRequest('/account/sessions');
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async revokeSession(id: string): Promise<{ message: string; revoked_current: boolean }> {
    const response = await apiRequest(`/account/sessions/${id}`, { method: 'DELETE' });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async revokeAllOtherSessions(): Promise<{ message: string; revoked_count: number }> {
    const response = await apiRequest('/account/sessions/revoke_all_others', { method: 'DELETE' });
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  // Get current user info (from /me endpoint)
  static async getCurrentUser(): Promise<{
    user: {
      id: string;
      email: string;
      first_name: string;
      last_name: string;
      name: string;
      two_factor_enabled: boolean;
      current_account: {
        id: string;
        name: string;
        personal: boolean;
        primary_color?: string | null;
      } | null;
      accounts: Array<{
        id: string;
        name: string;
        personal: boolean;
        primary_color?: string | null;
        role: string;
        members_count: number;
      }>;
    };
  }> {
    const response = await apiRequest('/me');

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return apiJsonResponse(response);
  }

  // Notifications
  static async getNotifications(): Promise<{
    notifications: Array<{
      id: string;
      type: string;
      params: Record<string, string>;
      account_id: string | null;
      read_at: string | null;
      created_at: string;
    }>;
  }> {
    const response = await apiRequest('/notifications');
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async getNotificationUnreadCount(): Promise<{ unread_count: number }> {
    const response = await apiRequest('/notifications/unread_count');
    if (!response.ok) throw await parseApiError(response);
    return apiJsonResponse(response);
  }

  static async markNotificationAsRead(id: string): Promise<void> {
    const response = await apiRequest(`/notifications/${id}/mark_as_read`, {
      method: 'POST',
    });
    if (!response.ok) throw await parseApiError(response);
  }

  static async markAllNotificationsAsRead(): Promise<void> {
    const response = await apiRequest('/notifications/mark_all_as_read', {
      method: 'POST',
    });
    if (!response.ok) throw await parseApiError(response);
  }
}
