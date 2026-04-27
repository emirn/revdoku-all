# frozen_string_literal: true

class Api::V1::ReportsController < Api::BaseController
  include EnvelopeArchivable
  include AuditActionHumanizable

  MAX_CONCURRENT_REVIEWS = 2

  before_action :set_report, only: [:show, :update, :status, :export, :reset, :cancel, :resume, :page_texts]
  before_action :authorize_report, only: [:show, :update, :status, :export, :reset, :cancel, :resume, :page_texts]
  before_action :set_envelope_for_create, only: [:create, :create_stub]
  before_action :ensure_envelope_not_archived!, only: [:create, :create_stub, :reset]
  before_action :ensure_report_not_processing!, only: [:reset]

  # GET /api/v1/reports/:id
  def show
    report_data = format_report(@report)
    render_api_success({ report: report_data })
  end

  # PATCH /api/v1/reports/:id
  def update
    if params[:label_font_scale].present?
      @report.label_font_scale = params[:label_font_scale]
    end
    if params[:page_font_scales].present?
      permitted_scales = {}
      params[:page_font_scales].each do |key, value|
        # Only allow page index strings mapping to numeric values
        if key.to_s.match?(/\A\d+\z/) && value.to_s.match?(/\A\d+(\.\d+)?\z/)
          permitted_scales[key.to_s] = value.to_f
        end
      end
      @report.page_font_scales = permitted_scales
    end
    if params.key?(:font_family)
      @report.font_family = params[:font_family]
    end
    if params.key?(:highlight_mode)
      @report.highlight_mode = params[:highlight_mode]
    end
    if params.key?(:user_scripts_output)
      incoming = params[:user_scripts_output]
      output = incoming.is_a?(Array) ? incoming.map.with_index { |s, i|
        entry = { "id" => s["id"].presence || "script_#{i}" }
        entry["data"] = s["data"].to_unsafe_h if s["data"].present?
        entry["template"] = s["template"].to_s if s["template"].present?
        entry["executed_at"] = s["executed_at"].to_s if s["executed_at"].present?
        entry
      } : []
      @report.user_scripts_output = output
    end
    @report.save!
    Rails.logger.info("[UPDATE] label_font_scale: #{@report.label_font_scale}, page_font_scales: #{@report.page_font_scales}")
    render_api_success({ report: format_report(@report) })
  end

  # POST /api/v1/reports
  def create
    Rails.logger.info "Creating report for revision=#{params[:envelope_revision_id]}, checklist=#{params[:checklist_id]}"

    if params[:envelope_revision_id].blank?
      skip_authorization
      render_api_bad_request("envelope_revision_id is required")
      return
    end

    if params[:checklist_id].blank?
      skip_authorization
      render_api_bad_request("checklist_id is required")
      return
    end

    # Validate optional callback_url (used by Zapier / webhook integrations).
    # Must be HTTPS and host must be in Revdoku::CallbackUrlAllowlist.
    if params[:callback_url].present? && !Revdoku::CallbackUrlAllowlist.allowed?(params[:callback_url])
      skip_authorization
      render_api_error(
        "callback_url is not an allowlisted webhook host",
        status: :unprocessable_entity,
        code: "INVALID_CALLBACK_URL"
      )
      return
    end

    # Enforce concurrent review limit per account
    active_reviews = current_account.reports.where(job_status: [:pending, :processing]).count
    if active_reviews >= MAX_CONCURRENT_REVIEWS
      skip_authorization
      render_api_error(
        "Maximum #{MAX_CONCURRENT_REVIEWS} reviews can run at the same time. Please wait for a review to finish.",
        status: :too_many_requests,
        code: "CONCURRENT_REVIEW_LIMIT"
      )
      return
    end

    envelope_revision = find_envelope_revision(params[:envelope_revision_id])
    unless envelope_revision
      skip_authorization
      return
    end

    # Find the checklist template
    base_checklist = current_account.checklists.find_by_prefix_id(params[:checklist_id])
    unless base_checklist
      skip_authorization
      render_api_not_found("Checklist")
      return
    end

    # Verify user can create report on this envelope
    envelope = envelope_revision.envelope
    authorize envelope, :create_report?

    # Enforce plan model tier and HIPAA restrictions
    checklist_model = params[:ai_model].presence || base_checklist.ai_model.presence || current_account.default_ai_model(:inspection)
    unless current_account.allows_ai_model?(checklist_model)
      is_hipaa_block = current_account.hipaa_enabled? && !AiModelResolver.parse_alias_id(checklist_model)[:hipaa]
      render_api_error(
        is_hipaa_block ?
          "HIPAA compliance requires a HIPAA-certified AI model." :
          "The AI model for this checklist is not available on your plan. Upgrade to access higher-tier models.",
        status: :forbidden,
        code: is_hipaa_block ? "HIPAA_MODEL_REQUIRED" : "MODEL_NOT_AVAILABLE"
      )
      return
    end

    # Validate model exists before proceeding. Pass account: so user-defined
    # custom-provider models (ai_provider_keys[<custom_llm_N>].models entries)
    # are recognised the same way the report-creation service will see them.
    begin
      AiModelResolver.resolve(checklist_model, operation: :inspection, account: current_account)
    rescue => e
      render_api_error(e.message, status: :unprocessable_entity, code: "MODEL_NOT_FOUND")
      return
    end

    # Compute per-page cost and max affordable pages. track_changes adds
    # a text-extraction pass on top of inspection; that pass runs on a
    # separate (cheap) text-extraction model — see ai_models.yml key
    # `:text_extraction` — so its cost is the text-extraction model's
    # credits_per_page, NOT a second inspection-model pass. Formula:
    #   cost_per_page = inspection_cpp + (track_changes ? text_extraction_cpp : 0)
    # The review runs as long as the user can afford at least one page;
    # doc-api trims to max_affordable_pages via the batch loop so only the
    # affordable subset is processed.
    page_count = [envelope_revision.page_count, 1].max
    credits_per_page = AiModelResolver.credits_per_page(checklist_model)
    # Track-changes is strictly per-review (default off). No checklist-level
     # fallback anymore — the Review dialog only shows the checkbox when a
     # prior revision exists, and it defaults to unchecked unless the user
     # explicitly re-enables it for this run.
    track_changes_param = params.key?(:track_changes) ? ActiveModel::Type::Boolean.new.cast(params[:track_changes]) : false
    text_extraction_model_id = AiModelResolver.default_model_id(:text_extraction) || checklist_model
    text_extraction_cpp = AiModelResolver.credits_per_page(text_extraction_model_id)
    cost_per_page = credits_per_page + (track_changes_param ? text_extraction_cpp : 0)
    # Core: no credit system — process every page in the document at zero cost.
    # Max pages the batch processor will handle for this review. Falls
    # back to a very large value when page_count is unknown (first run)
    # so the downstream batch loop is never gated.
    @max_affordable_pages = envelope_revision.page_count > 0 ? envelope_revision.page_count : 1_000_000

    # Resolve user timezone: prefer explicit param, fall back to user setting
    user_timezone = params[:timezone].presence || current_user.time_zone || "UTC"

    existing_report = envelope_revision.report

    # AI model override: passed through to job/service, NOT saved on the checklist.
    # The report itself records which model was actually used (report.ai_model).
    ai_model_override = params[:ai_model].presence

    # Track-changes: per-review only. nil means "not provided" (treated as
    # off by ReportCreationService). There is no checklist-level default
    # to override.
    track_changes_override = if params.key?(:track_changes) && !params[:track_changes].nil?
      ActiveModel::Type::Boolean.new.cast(params[:track_changes])
    else
      nil
    end

    # highlight_mode override: when provided via "Review w/ options" dialog.
    highlight_mode_override = params[:highlight_mode]&.to_i

    # Extract debug options if provided
    debug_options = params[:debug]&.permit(:grid_mode, :overlay_checks_on_grid)&.to_h&.presence
    skip_ai = (params[:skip_ai] == true || params[:skip_ai] == "true") && !Rails.env.production?
    force_param = params[:force] == true || params[:force] == "true"
    pages_param = params[:pages].presence
    page_font_scales_param = if params[:page_font_scales].present?
      params[:page_font_scales].permit!.to_h
        .transform_keys(&:to_i)
        .transform_values(&:to_f)
        .select { |k, v| k > 0 && v.between?(0.5, 3.0) }
        .presence
    end
    skip_previous_checks = params[:skip_previous_checks] == true || params[:skip_previous_checks] == "true"

    # review_note: optional free-text context the user enters in the Review
    # dialog to give the AI extra context for this specific run (e.g.
    # "This is last year's version — flag regressions" or "Ignore line 7
    # on the PO — approved via CO"). Stored on the report's encrypted
    # inspection_context alongside the frozen checklist snapshot, so it
    # travels with the audit trail of "what the AI saw."
    #
    # Semantics: if the client sends the key, we write it (empty string
    # clears a prior note); if the client omits the key, we leave the
    # existing stored note untouched on re-runs.
    review_note_sent = params.key?(:review_note)
    review_note_val = params[:review_note].to_s.strip if review_note_sent
    if review_note_sent && review_note_val.length > 2000
      skip_authorization
      render_api_error(
        "review_note must be 2000 characters or fewer",
        status: :unprocessable_entity,
        code: "REVIEW_NOTE_TOO_LONG"
      )
      return
    end

    # Ad-hoc reference files: files the user attached via the "Add note"
    # section in Review dialog even though the checklist didn't request
    # them via #ref[...]. Stored on inspection_context (per-inspection,
    # not as persistent RefFile pins). ReportCreationService synthesises
    # `#ref[file:<dfrev>|<label>]` markers for each so doc-api's token
    # substitution machinery handles them uniformly. Cap is
    # Revdoku::MAX_AD_HOC_REF_FILES.
    #
    # Semantics mirror review_note: key-present => write (empty array
    # clears); key-absent => preserve existing.
    ad_hoc_refs_sent = params.key?(:ad_hoc_ref_files)
    ad_hoc_refs_resolved = nil
    if ad_hoc_refs_sent
      entries = Array(params[:ad_hoc_ref_files])
      if entries.size > Revdoku::MAX_AD_HOC_REF_FILES
        skip_authorization
        render_api_error(
          "Up to #{Revdoku::MAX_AD_HOC_REF_FILES} additional reference file#{'s' if Revdoku::MAX_AD_HOC_REF_FILES != 1} per review.",
          status: :unprocessable_entity,
          code: "AD_HOC_REF_FILES_LIMIT"
        )
        return
      end
      ad_hoc_refs_resolved = []
      entries.each do |e|
        e = e.to_unsafe_h if e.respond_to?(:to_unsafe_h)
        dfrev_id = (e["document_file_revision_id"] || e[:document_file_revision_id]).to_s
        label = (e["label"] || e[:label]).to_s.strip
        if dfrev_id.blank?
          skip_authorization
          render_api_error(
            "ad_hoc_ref_files entry missing document_file_revision_id",
            status: :unprocessable_entity,
            code: "AD_HOC_REF_FILES_MALFORMED"
          )
          return
        end
        revision = DocumentFileRevision.find_by_prefix_id(dfrev_id)
        unless revision && revision.account_id == current_account.id
          skip_authorization
          render_api_error(
            "ad_hoc_ref_files: revision #{dfrev_id} not accessible",
            status: :not_found,
            code: "AD_HOC_REF_FILE_NOT_FOUND"
          )
          return
        end
        envelope = envelope_revision.envelope
        if revision.document_file.envelope_id != envelope.id
          revision = copy_revision_to_envelope(revision, envelope)
        end
        ad_hoc_refs_resolved << {
          "document_file_revision_id" => revision.prefix_id,
          "label" => (label.presence || revision.name).to_s.truncate(100)
        }
      end
    end

    if existing_report
      # Guard: if a job is already in progress, return the existing report (prevents double-click race)
      if existing_report.job_status_pending? || existing_report.job_status_processing?
        render_api_accepted({ report: format_report(existing_report) })
        return
      end

      # Stub report (no inspection_context yet — created for manual checks only).
      # Run full AI review with the selected checklist template.
      if existing_report.inspection_context.blank?
        Rails.logger.info "Stub report #{existing_report.prefix_id} has no inspection context — running full AI review with #{base_checklist.prefix_id}"
        process_report_asynchronously(envelope_revision, base_checklist, timezone: user_timezone, skip_previous_checks: skip_previous_checks, ai_model_override: ai_model_override, track_changes_override: track_changes_override, highlight_mode_override: highlight_mode_override, max_affordable_pages: @max_affordable_pages, existing_report: existing_report, review_note: (review_note_val.presence if review_note_sent), ad_hoc_ref_files: ad_hoc_refs_resolved)
        return
      end

      # Sync report's highlight_mode from override or checklist default
      effective_highlight_mode = highlight_mode_override || Checklist.highlight_modes[base_checklist.highlight_mode]
      existing_report.highlight_mode = effective_highlight_mode
      existing_report.save!

      checklist_switch = params[:checklist_switch] == true || params[:checklist_switch] == "true"
      force_reinspection = force_param

      # Auto-detect checklist mismatch: if selected checklist differs from the one used in previous inspection
      unless checklist_switch
        previous_checklist_id = existing_report.inspection_checklist_id
        has_no_checklist_rules = existing_report.rules.none? { |r| (r[:origin] || r["origin"]) == "checklist" }
        if has_no_checklist_rules || (previous_checklist_id && previous_checklist_id != base_checklist.prefix_id)
          checklist_switch = true
          Rails.logger.info "Auto-detected checklist mismatch for report #{existing_report.prefix_id}"
        end
      end

      if checklist_switch || force_reinspection || needs_reinspection?(existing_report, base_checklist, envelope_revision)
        Rails.logger.info "Re-running inspection for report #{existing_report.prefix_id} (switch=#{checklist_switch}, force=#{force_reinspection})"

        existing_report.checks.where(source: :ai).destroy_all
        existing_report.update!(job_status: :pending, job_id: nil, error_message: nil)
        # Merge the new review_note into inspection_context if the client
        # sent one (presence => set; empty string => clear). Absent key
        # leaves the previously stored note in place. Same semantics for
        # ad_hoc_ref_files — empty array clears, absent preserves.
        if review_note_sent || ad_hoc_refs_sent
          ctx = existing_report.inspection_context || {}
          ctx["review_note"] = review_note_val.presence if review_note_sent
          ctx["ad_hoc_ref_files"] = ad_hoc_refs_resolved if ad_hoc_refs_sent
          existing_report.update!(inspection_context: ctx)
        end
        persist_callback_url(existing_report, params[:callback_url])

        rerun_kwargs = {
          user_id: current_user.id,
          timezone: user_timezone,
          skip_previous_checks: skip_previous_checks,
          ai_model_override: ai_model_override,
          track_changes_override: track_changes_override,
          highlight_mode_override: highlight_mode_override,
          max_affordable_pages: @max_affordable_pages
        }

        rerun_kickoff = resolve_and_pin_ref_files!(
          report: existing_report,
          envelope_revision: envelope_revision,
          checklist: base_checklist
        )

        if rerun_kickoff == :error
          return
        end

        job = enqueue_with_retry(CreateReportJob,
          existing_report.prefix_id,
          envelope_revision.prefix_id,
          base_checklist.prefix_id,
          **rerun_kwargs
        )
        existing_report.update!(job_id: job.job_id)
        render_api_accepted({ report: format_report(existing_report) })
      else
        Rails.logger.info "No changes detected, returning existing report #{existing_report.prefix_id}"
        render_api_success({ report: format_report(existing_report) })
      end
    else
      process_report_asynchronously(envelope_revision, base_checklist, timezone: user_timezone, skip_previous_checks: skip_previous_checks, ai_model_override: ai_model_override, track_changes_override: track_changes_override, highlight_mode_override: highlight_mode_override, max_affordable_pages: @max_affordable_pages, review_note: (review_note_val.presence if review_note_sent), ad_hoc_ref_files: ad_hoc_refs_resolved)
    end
  rescue ActiveRecord::RecordNotFound
    render_api_not_found("Resource")
  end

  # POST /api/v1/reports/create_stub
  # Creates a minimal report without a checklist for adding manual checks
  # before running AI inspection. Does NOT charge credits.
  # The checklist snapshot is created later when AI review runs.
  def create_stub
    if params[:envelope_revision_id].blank?
      render_api_bad_request("envelope_revision_id is required")
      return
    end

    envelope_revision = find_envelope_revision(params[:envelope_revision_id])
    return unless envelope_revision

    envelope = envelope_revision.envelope
    authorize envelope, :create_report?

    # Return existing report if one already exists (idempotent)
    existing_report = envelope_revision.report
    if existing_report
      render_api_success({ report: format_report(existing_report) })
      return
    end

    begin
      report = Report.create!(
        envelope_revision: envelope_revision,
        account: envelope.account,
        job_status: :completed
      )
    rescue ActiveRecord::RecordNotUnique
      # Race: return existing report (idempotent)
      skip_authorization
      report = envelope_revision.report
      render_api_success({ report: format_report(report) })
      return
    end

    authorize report, :create?

    Rails.logger.info "Stub report created: #{report.prefix_id} for envelope revision: #{envelope_revision.prefix_id}"
    render_api_success({ report: format_report(report) })
  rescue ActiveRecord::RecordNotFound
    render_api_not_found("Resource")
  end

  # GET /api/v1/reports/:id/status
  def status
    # Pre-load associations so convert_foreign_keys resolves prefix_ids
    @report.envelope_revision
    report_data = change_id_to_prefix_in_object(@report)

    # Filter meta: always include client-visible fields, strip internal
    if report_data["meta"].present?
      raw_meta = report_data["meta"].is_a?(Hash) ? report_data["meta"] : (JSON.parse(report_data["meta"]) rescue {})
      client_meta = raw_meta.except("internal")
      report_data["meta"] = client_meta.present? ? client_meta : nil
    end

    # Remove internal/debug fields in non-development environments
    unless Rails.env.development?
      report_data.delete("job_id")
    end

    # Ensure timestamps are ISO8601 strings for consistent frontend parsing
    report_data[:created_at] = @report.created_at.iso8601 if @report.created_at
    report_data[:updated_at] = @report.updated_at.iso8601 if @report.updated_at

    status_info = {
      report: report_data,
      job_status: @report.job_status,
      error_message: sanitize_report_error(@report.error_message)
    }
    status_info[:job_id] = @report.job_id if Rails.env.development?

    # Emit ref files metadata for EVERY status (not gated) so the
    # inspection-progress overlay, toolbar, and any mid-run UI can
    # show the reference files being processed. Unified pinned + ad-hoc.
    status_info[:report][:ref_files_meta] = build_ref_files_meta(@report.envelope_revision, @report)

    # Keep ad_hoc_ref_files separately so the Review dialog's pre-fill
    # (on re-run) can distinguish user-attached refs from checklist-pinned.
    ctx = @report.inspection_context || {}
    status_info[:report][:ad_hoc_ref_files] = Array(ctx["ad_hoc_ref_files"]).map do |entry|
      dfrev_id = (entry["document_file_revision_id"] || entry[:document_file_revision_id]).to_s
      rev = dfrev_id.present? ? DocumentFileRevision.find_by_prefix_id(dfrev_id) : nil
      {
        document_file_revision_id: dfrev_id,
        label: (entry["label"] || entry[:label]).to_s,
        filename: rev&.name
      }
    end

    if @report.job_status_completed? || @report.job_status_cancelled? || @report.job_status_failed? || @report.job_status_reset?
      cache = build_rule_prompt_cache_from_report(@report)
      status_info[:report][:checks] = @report.checks.map { |check| change_id_to_prefix_in_object(check, json_options: { rule_prompt_cache: cache }) }
      status_info[:report][:checklist] = build_checklist_from_inspection_context(@report)
      status_info[:report][:checklist_id] = @report.inspection_checklist_id
      status_info[:report][:source_checklist_id] = @report.inspection_checklist_id
      status_info[:report][:label_font_scale] = @report.label_font_scale
      status_info[:report][:page_font_scales] = @report.page_font_scales
      status_info[:report][:font_family] = @report.font_family
      status_info[:report][:highlight_mode] = @report.highlight_mode
      status_info[:report][:has_page_texts] = @report.has_page_texts?
      # (ref_files_meta emitted above for all statuses)

      # Surface the envelope's current user_scripts so the frontend can refresh
      # `currentEnvelope.user_scripts` after a review (they may have been copied
      # from the checklist by ReportCreationService#copy_checklist_scripts_to_envelope).
      envelope = @report.envelope_revision&.envelope
      if envelope&.user_scripts.present?
        status_info[:envelope_user_scripts] = envelope.user_scripts
      end

      # Report the job's credit consumption only for completed reports
      if @report.job_status_completed? && @report.credits_consumed.to_i > 0
        self.credits_charged = @report.credits_consumed
      end
    else
      # Always include checks array so frontend never gets undefined
      status_info[:report][:checks] = []
    end

    render_api_success(status_info)
  end

  # GET /api/v1/reports/:id/page_texts
  # Returns extracted page texts for diff viewer (lazy-loaded to avoid large envelope responses).
  # Assembled on the fly from each DocumentFileRevision into document-relative order.
  def page_texts
    render_api_success({ page_texts: @report.page_texts })
  end

  # POST /api/v1/reports/:id/reset
  # Soft reset: deletes AI-generated checks but preserves manual (user) checks
  def reset
    envelope_revision = @report.envelope_revision
    unless envelope_revision.revision_number == 0
      render_api_bad_request("Reports can only be reset on the first revision", code: "REPORT_RESET_NOT_ALLOWED")
      return
    end

    if @report.job_status_pending? || @report.job_status_processing?
      render_api_bad_request("Cannot reset report while inspection is in progress", code: "REPORT_IN_PROGRESS")
      return
    end

    if @report.job_status_reset?
      render_api_bad_request("Report is already reset", code: "REPORT_ALREADY_RESET")
      return
    end

    # Delete only AI-generated checks, preserve manual checks.
    # Clear rule-file enrichment state so a subsequent re-run re-enriches
    # from scratch. RefFile pins live on envelope_revision, not on
    # Report, so they survive reset — the user keeps their uploaded files
    # without having to re-upload on re-run.
    @report.checks.where(source: :ai).destroy_all
    @report.update!(
      job_status: :reset,
      error_message: nil,
      
      inspection_enqueued_at: nil
    )

    render_api_success({ report: format_report(@report.reload) })
  end

  # POST /api/v1/reports/:id/cancel
  # Cancels an reviewing report job and optionally refunds credits
  def cancel
    # Already in terminal cancelled/failed state — return success (idempotent)
    if @report.job_status_cancelled? || @report.job_status_failed?
      prior_pages = @report.meta.is_a?(Hash) ? @report.meta["page_offset"].to_i : 0
      prior_total = @report.envelope_revision&.page_count.to_i
      render_api_success({
        report: format_report(@report),
        refunded: false,
        partial: prior_pages > 0,
        pages_processed: prior_pages,
        total_pages: prior_total,
        refund_amount: 0,
        credits_charged: @report.credits_consumed.to_i
      })
      return
    end

    # Already completed/reset — return report so frontend can dismiss overlay and show results
    if @report.job_status_completed? || @report.job_status_reset?
      render_api_success({
        report: format_report(@report),
        refunded: false,
        already_completed: true
      })
      return
    end

    unless @report.job_status_pending? || @report.job_status_processing?
      render_api_bad_request(
        "Job cannot be cancelled (status: #{@report.job_status})",
        code: "JOB_NOT_CANCELLABLE"
      )
      return
    end

    # Attempt to cancel the job from Solid Queue
    cancelled_from_queue = false
    if @report.job_id.present?
      cancelled_from_queue = attempt_solid_queue_cancellation(@report.job_id)
    end

    # Mark the report as cancelled. Previously this code took a "if AI checks
    # exist → :completed" branch intended for re-run cancellation, but during a
    # batched mid-run the partial AI checks already exist, so it wrongly marked
    # the report completed and hid the "Continue review" banner.
    @report.update!(
      job_status: :cancelled,
      error_message: "Inspection cancelled by user"
    )

    if @report.meta.is_a?(Hash) && @report.meta["callback_url"].present?
      ReportCallbackJob.perform_later(@report.prefix_id, "cancelled")
    end

    # Finalize synchronously so a reload immediately reflects the cancelled state:
    #   1. Mark unprocessed pages as CANCELLED_BY_USER in pages_layout_json so the
    #      frontend "Continue review" banner persists across reloads. Without this
    #      the banner appears briefly (from the in-memory response) then disappears
    #      because the reload sees an empty page_statuses hash.
    #   2. Renumber AI check indices. The running CreateReportJob may still be
    #      mid-batch and will also renumber in its ensure block when it notices
    #      the cancellation, but we renumber here too so the user sees correct
    #      unique check labels instead of duplicated per-batch indices while the
    #      job winds down.
    total_pages = @report.envelope_revision&.page_count.to_i
    page_offset = @report.meta.is_a?(Hash) ? @report.meta["page_offset"].to_i : 0
    if total_pages > 0
      ReportCreationService.fill_cancelled_page_statuses(@report, page_offset, total_pages)
    end
    ReportCreationService.renumber_check_indices(@report)

    # Propagate checklist's user_scripts onto the envelope ONLY if the cancelled
    # run produced at least one check. Zero-check cancels mean the user aborted
    # before any meaningful work — don't auto-seed the envelope in that case.
    # The copy is idempotent and only fills empty envelope.user_scripts.
    if @report.checks.any?
      copy_checklist_scripts_to_envelope_for_report(@report)
    end

    # ──────────────────────────────────────────────────────────────────────
    # Fair billing on cancel
    #
    # Previously this path refunded ALL pre-charged credits regardless of how
    # many pages had already been reviewed — a user could cancel after 15 of
    # 20 pages and keep the work for free. That also produced misleading
    # "credits have been refunded" messaging in the UI.
    #
    # New behaviour mirrors CreateReportJob#handle_job_failure's partial-
    # refund logic: keep credits for pages that ran in completed batches,
    # refund only the unreviewed portion. `page_offset` (from meta) is
    # conservative — it reflects pages from batches that were fully counted
    # at cancel time. If the in-flight batch finishes after this point the
    # job's ensure block runs adjust_credits and reconciles any remaining
    # delta (both paths are idempotent relative to credits_consumed).
    # ──────────────────────────────────────────────────────────────────────
    pre_charged = @report.credits_consumed.to_i
    pages_processed = page_offset # already read above from meta
    ai_model = @report.ai_model
    credits_per_page = ai_model.present? ? AiModelResolver.credits_per_page(ai_model) : 1
    track_changes = @report.inspection_track_changes? && @report.envelope_revision&.previous_revision.present?
    multiplier = track_changes ? 2 : 1
    partial_cost = pages_processed > 0 ? [pages_processed * credits_per_page * multiplier, 1].max : 0
    partial_cost = [partial_cost, pre_charged].min
    refund_amount = pre_charged - partial_cost

    if refund_amount > 0
      envelope_prefix = @report.envelope_revision&.envelope&.prefix_id || "unknown"
      note = pages_processed > 0 \
        ? "Partial refund: #{envelope_prefix} (#{pages_processed} pages reviewed before cancel)" \
        : "Refund: #{envelope_prefix} (cancelled before any pages were reviewed)"
    end

    response_payload = {
      report: format_report(@report.reload),
      refunded: refund_amount > 0,
      partial: pages_processed > 0,
      pages_processed: pages_processed,
      total_pages: total_pages,
      refund_amount: refund_amount,
      credits_charged: partial_cost
    }
    envelope = @report.envelope_revision&.envelope
    response_payload[:envelope_user_scripts] = envelope.user_scripts if envelope&.user_scripts.present?
    render_api_success(response_payload)
  rescue ActiveRecord::RecordNotFound
    render_api_not_found("Report")
  end

  # POST /api/v1/reports/:id/resume
  # Resume review from where it stopped. Keeps existing checks, processes remaining pages.
  # Finds the first unreviewed page offset (via Report::PageReviewStatus.unreviewed?)
  # and sets meta.resume = true so the batch loop picks up from that offset.
  def resume
    unless @report.job_status_completed? || @report.job_status_cancelled? || @report.job_status_failed?
      render_api_bad_request(
        "Report must be completed, cancelled, or failed to resume (status: #{@report.job_status})",
        code: "REPORT_NOT_RESUMABLE"
      )
      return
    end
    ReportCreationService.renumber_check_indices(@report)

    total_pages = @report.envelope_revision.page_count
    if total_pages <= 0
      render_api_bad_request("Report has no page count; cannot resume")
      return
    end

    statuses = @report.page_statuses

    # Find first unreviewed page (0-based).
    resume_offset = nil
    (0...total_pages).each do |page_idx|
      status = statuses[page_idx.to_s]
      if Report::PageReviewStatus.unreviewed?(status)
        resume_offset = page_idx
        break
      end
    end

    if resume_offset.nil?
      render_api_bad_request("All pages have been reviewed")
      return
    end

    remaining_pages = total_pages - resume_offset

    # Charge credits for remaining pages (track_changes doubles cost)
    ai_model = @report.ai_model || AiModelResolver.default_model_id(:inspection)
    credits_per_page = AiModelResolver.credits_per_page(ai_model)
    track_changes = @report.inspection_track_changes? && @report.envelope_revision&.previous_revision.present?
    multiplier = track_changes ? 2 : 1
    cost = [remaining_pages * credits_per_page * multiplier, 1].max

    # Set resume state in meta (flat schema — matches CreateReportJob's expectations).
    # Existing checks are kept; the batch loop picks up from page_offset.
    @report.update!(
      job_status: :pending,
      error_message: nil,
      meta: (@report.meta || {}).merge(
        "resume" => true,
        "page_offset" => resume_offset,
        "pages_processed" => resume_offset,
        "total_pages" => total_pages
      )
    )

    # Resolve the checklist prefix_id from inspection_context (single source of truth
    # for what the report was created against).
    checklist_prefix_id = @report.inspection_checklist_id
    unless checklist_prefix_id.present?
      render_api_bad_request("Report has no inspection_context; cannot resume", code: "MISSING_INSPECTION_CONTEXT")
      return
    end

    CreateReportJob.perform_later(
      @report.prefix_id,
      @report.envelope_revision.prefix_id,
      checklist_prefix_id,
      user_id: Principal.user&.id,
      timezone: params[:timezone],
      ai_model_override: @report.ai_model
    )

    render_api_success({
      report: format_report(@report.reload),
      pages_to_review: remaining_pages
    })
  rescue ActiveRecord::RecordNotFound
    render_api_not_found("Report")
  end

  # POST /api/v1/reports/:id/resume
  # Resume review from where it stopped. Keeps existing checks, processes remaining pages.
  # Finds the first unreviewed page offset (via Report::PageReviewStatus.unreviewed?)
  # and sets meta.resume = true so the batch loop picks up from that offset.
  def resume
    unless @report.job_status_completed? || @report.job_status_cancelled? || @report.job_status_failed?
      render_api_bad_request(
        "Report must be completed, cancelled, or failed to resume (status: #{@report.job_status})",
        code: "REPORT_NOT_RESUMABLE"
      )
      return
    end

    total_pages = @report.envelope_revision.page_count
    if total_pages <= 0
      render_api_bad_request("Report has no page count; cannot resume")
      return
    end

    statuses = @report.page_statuses

    # Find first unreviewed page (0-based).
    resume_offset = nil
    (0...total_pages).each do |page_idx|
      status = statuses[page_idx.to_s]
      if Report::PageReviewStatus.unreviewed?(status)
        resume_offset = page_idx
        break
      end
    end

    if resume_offset.nil?
      render_api_bad_request("All pages have been reviewed")
      return
    end

    remaining_pages = total_pages - resume_offset

    # Charge credits for remaining pages (track_changes doubles cost)
    ai_model = @report.ai_model || AiModelResolver.default_model_id(:inspection)
    credits_per_page = AiModelResolver.credits_per_page(ai_model)
    track_changes = @report.inspection_track_changes? && @report.envelope_revision&.previous_revision.present?
    multiplier = track_changes ? 2 : 1
    cost = [remaining_pages * credits_per_page * multiplier, 1].max

    # Set resume state in meta (flat schema — matches CreateReportJob's expectations).
    # Existing checks are kept; the batch loop picks up from page_offset.
    # Critically, also nullify job_id. The previous run's job_id may still be on
    # the record (the cancel controller doesn't clear it), and if the old job is
    # still winding down on another Solid Queue thread its ownership check
    # (placeholder_report.job_id == job_id) would still match and it would
    # clobber the resume state. Nulling job_id here + having the new job install
    # its own job_id on startup (see CreateReportJob#perform) decouples the two
    # runs cleanly.
    @report.update!(
      job_status: :pending,
      job_id: nil,
      error_message: nil,
      meta: (@report.meta || {}).merge(
        "resume" => true,
        "page_offset" => resume_offset,
        "pages_processed" => resume_offset,
        "total_pages" => total_pages
      )
    )

    # Resolve the checklist prefix_id from inspection_context (single source of truth
    # for what the report was created against).
    checklist_prefix_id = @report.inspection_checklist_id
    unless checklist_prefix_id.present?
      render_api_bad_request("Report has no inspection_context; cannot resume", code: "MISSING_INSPECTION_CONTEXT")
      return
    end

    new_job = CreateReportJob.perform_later(
      @report.prefix_id,
      @report.envelope_revision.prefix_id,
      checklist_prefix_id,
      user_id: Principal.user&.id,
      timezone: params[:timezone],
      ai_model_override: @report.ai_model
    )
    # Install the new job's id on the report so the new job's ownership checks
    # pass (and so any lingering old job sees job_id != self.job_id and skips).
    @report.update!(job_id: new_job.job_id) if new_job.respond_to?(:job_id) && new_job.job_id.present?

    render_api_success({
      report: format_report(@report.reload),
      pages_to_review: remaining_pages
    })
  rescue ActiveRecord::RecordNotFound
    render_api_not_found("Report")
  end

  # POST /api/v1/reports/:id/export
  def export
    unless @report.job_status_completed? || @report.checks.exists?
      render_api_bad_request(
        "Report is not ready for export (status: #{@report.job_status})",
        code: "REPORT_NOT_READY"
      )
      return
    end

    envelope = @report.envelope_revision.envelope
    envelope_revision = @report.envelope_revision
    document_file_revisions = envelope_revision.document_file_revisions.includes(:document_file, file_attachment: :blob, rendered_pages_cache_attachment: :blob)

    # Get previous revision info for comparison
    previous_revision_data = build_previous_revision_data(envelope_revision)

    # Always fetch audit logs (HTML report toggles sections via inline JS)
    audit_logs_data = fetch_envelope_audit_logs(envelope)

    # Validate layout_mode parameter
    valid_layout_modes = %w[compact detailed full]
    layout_mode = params[:layout_mode]
    layout_mode = "full" unless valid_layout_modes.include?(layout_mode)

    check_filter = params[:check_filter]
    check_filter = "failed" unless %w[failed passed all changes rechecks failed_only].include?(check_filter)
    include_passed = %w[all passed].include?(check_filter)

    # Resolve AI model display info
    ai_model_id = @report.ai_model
    ai_model_entry = AiModelResolver.find_model(ai_model_id, account: current_account)
    ai_model_display_name = ai_model_entry ? AiModelResolver.display_name(ai_model_entry) : ai_model_id
    # Resolve the underlying model's actual ID and provider (aliases point to models via model_id)
    ai_model_actual_id = ai_model_entry&.dig(:model_id) || ai_model_id
    ai_underlying_model = ai_model_actual_id != ai_model_id ? AiModelResolver.find_model(ai_model_actual_id, account: current_account) : ai_model_entry
    # Derive provider and location from underlying model ID
    underlying_model_id = (ai_underlying_model || ai_model_entry || {})[:id] || ai_model_actual_id
    parsed_underlying = underlying_model_id ? AiModelResolver.parse_model_id(underlying_model_id) : {}
    ai_model_provider = parsed_underlying[:provider]

    export_request = {
      title: envelope.title,
      envelope_id: envelope.prefix_id,
      document_files_revisions: serialize_document_file_revisions_for_export(document_file_revisions, envelope_revision),
      report: serialize_report_for_export(@report),
      checklist: serialize_checklist_for_export_from_report(@report),
      document: serialize_envelope_revision_for_export(envelope_revision),
      previous_revision: previous_revision_data,
      include_passed_checks: include_passed,
      check_filter: check_filter,
      # Always send all-true so doc-api renders all sections; HTML toggles visibility via inline JS
      include_rules: true,
      include_technical_info: true,
      output_type: "html",
      audit_logs: audit_logs_data,
      layout_mode: layout_mode,
      show_checklist_name: true,
      show_title_info: true,
      show_compliance_summary: true,
      show_default_footer: true,
      # Revdoku release string (e.g. "1.0.77") rendered in the always-visible
      # branding header + footer of the exported report. Sourced from
      # Revdoku.app_version_string (00_revdoku.rb) which reads /VERSION at
      # the monorepo root.
      app_version: Revdoku.app_version_string,
      # User's original preferences for initial visibility in the HTML
      initial_show_title_info: params[:show_title_info] != false && params[:show_title_info] != "false",
      initial_show_checklist_name: params[:show_checklist_name] != false && params[:show_checklist_name] != "false",
      initial_show_compliance_summary: params[:show_compliance_summary] == true || params[:show_compliance_summary] == "true",
      initial_show_compliance_percent: params[:show_compliance_percent] != false && params[:show_compliance_percent] != "false",
      initial_include_rules: params[:include_rules] == true || params[:include_rules] == "true",
      initial_include_technical_info: params[:include_technical_info] == true || params[:include_technical_info] == "true",
      initial_show_default_footer: params[:show_default_footer] != false && params[:show_default_footer] != "false",
      # Annotations (Tier 1 — changes image rendering)
      show_annotations: params[:show_annotations] != false && params[:show_annotations] != "false",
      # Page visibility toggles (Tier 2 — CSS toggles via inline script)
      initial_show_pages_with_checks: params[:show_pages_with_checks] != false && params[:show_pages_with_checks] != "false",
      initial_show_pages_without_checks: params[:show_pages_without_checks] != false && params[:show_pages_without_checks] != "false",
      # Content toggles (Tier 2 — always render, control initial CSS visibility)
      initial_show_page_images: params[:show_page_images] != false && params[:show_page_images] != "false",
      initial_show_check_details: params[:show_check_details] != false && params[:show_check_details] != "false",
      # Off by default — only render the raw `val=…` badges when the user
      # opts in via the export gear menu.
      initial_show_extracted_data: params[:show_extracted_data] == true || params[:show_extracted_data] == "true",
      # AI model info for display in technical section
      ai_model_id: ai_model_id,
      ai_model_display_name: ai_model_display_name,
      ai_model_stars: ai_model_entry&.dig(:stars),
      ai_model_stars_display: ai_model_entry ? AiModelResolver.star_rating(ai_model_entry) : nil,
      ai_model_credits_per_page: ai_model_entry&.dig(:credits_per_page) || AiModelResolver::DEFAULT_CREDITS_PER_PAGE,
      ai_model_hipaa: ai_model_entry ? AiModelResolver.parse_alias_id(ai_model_entry[:id])[:hipaa] : false,
      ai_model_location: parsed_underlying[:geo]&.upcase,
      ai_model_actual_id: ai_model_actual_id,
      ai_model_provider: ai_model_provider.present? ? AiModelResolver.provider_name(ai_model_provider) : nil,
      ai_model_model_name: ai_underlying_model&.dig(:name),
      ai_model_description: ai_model_entry&.dig(:description),
      timezone: params[:timezone].presence || current_user.time_zone || "UTC",
      font_scale: params[:font_scale].present? ? params[:font_scale].to_f : 1.0,
      font_family: params[:font_family].presence || @report.font_family,
      highlight_mode: params[:highlight_mode].present? ? params[:highlight_mode].to_i : @report.highlight_mode,
      # Checklist section toggles
      initial_show_checklist_info: params[:show_checklist_info] != false && params[:show_checklist_info] != "false",
      initial_show_checklist_general_prompt: params[:show_checklist_general_prompt] != false && params[:show_checklist_general_prompt] != "false",
      initial_show_checklist_rules_summary: params[:show_checklist_rules_summary] != false && params[:show_checklist_rules_summary] != "false",
      initial_show_checklist_rules_details: params[:show_checklist_rules_details] != false && params[:show_checklist_rules_details] != "false",
      initial_show_checklist_envelope_rules: params[:show_checklist_envelope_rules] != false && params[:show_checklist_envelope_rules] != "false",
      # Misc toggles
      initial_show_timezone: params[:show_timezone] != false && params[:show_timezone] != "false",
      initial_show_revision_comparison: params[:show_revision_comparison] != false && params[:show_revision_comparison] != "false",
      initial_show_check_attribution: params[:show_check_attribution] != false && params[:show_check_attribution] != "false",
      # New header/pages toggles
      initial_show_envelope_datetime: params[:show_envelope_datetime] != false && params[:show_envelope_datetime] != "false",
      initial_show_envelope_revisions_info: params[:show_envelope_revisions_info] != false && params[:show_envelope_revisions_info] != "false",
      initial_show_checklist_ai_model: params[:show_checklist_ai_model] != false && params[:show_checklist_ai_model] != "false",
      initial_show_page_filenames: params[:show_page_filenames] != false && params[:show_page_filenames] != "false",
      initial_show_page_summary_icons: params[:show_page_summary_icons] != false && params[:show_page_summary_icons] != "false",
      # Section group toggles
      initial_show_group_header: params[:show_group_header] != false && params[:show_group_header] != "false",
      initial_show_group_checklist: params[:show_group_checklist] != false && params[:show_group_checklist] != "false",
      initial_show_group_pages: params[:show_group_pages] != false && params[:show_group_pages] != "false",
      initial_show_group_footer: params[:show_group_footer] != false && params[:show_group_footer] != "false",
      # Checklist AI model details toggle (default off — only short badge shown by default)
      initial_show_checklist_ai_model_details: params[:show_checklist_ai_model_details] == true || params[:show_checklist_ai_model_details] == "true",
      # Document History section
      revisions_history: build_revisions_history(envelope),
      initial_show_document_history: params[:show_document_history] == true || params[:show_document_history] == "true",
      # Tags
      tags: envelope.tags.ordered.map { |t| { name: t.name, color: t.color } },
      initial_show_tags: params[:show_tags] != false && params[:show_tags] != "false",
      align_labels_to_top: params[:align_labels_to_top] == true || params[:align_labels_to_top] == "true",
      user_js_1_output_template: params[:user_js_1_output_template],
      user_js_1_output_data: params[:user_js_1_output_data]&.to_unsafe_h,
      initial_show_user_js_1_output: params[:show_user_js_1_output] != false && params[:show_user_js_1_output] != "false"
    }

    Rails.logger.info("[EXPORT] label_font_scale: #{@report.label_font_scale}, pages_layout: #{@report.pages_layout_json_aggregated}")

    revdoku_doc_api_response = RevdokuDocApiClient.client.export_report(export_request)

    if revdoku_doc_api_response[:success]

      render_api_success({
        content: revdoku_doc_api_response[:data],
        format: revdoku_doc_api_response[:format],
        content_type: revdoku_doc_api_response[:content_type],
        report_id: @report.prefix_id
      })
    else
      render_api_error(revdoku_doc_api_response[:message], status: :unprocessable_entity, code: "REVDOKU_DOC_API_ERROR")
    end
  end

  private

  # Resolve the checklist originally used for this report and copy its
  # user_scripts onto the owning envelope (no-op if envelope already has any).
  # Used by the cancel action so a partially-completed review still seeds the
  # envelope's scripts. Intentionally swallows failures — script propagation is
  # best-effort and should never block the primary response.
  def copy_checklist_scripts_to_envelope_for_report(report)
    checklist_id = report.inspection_checklist_id.presence
    return unless checklist_id
    checklist = current_account.checklists.find_by_prefix_id(checklist_id)
    return unless checklist&.user_scripts.present?
    envelope = report.envelope_revision&.envelope
    return unless envelope
    return if envelope.user_scripts.present?
    envelope.update(user_scripts: checklist.user_scripts)
    Rails.logger.info "cancel: copied #{checklist.user_scripts.length} checklist script(s) to envelope #{envelope.prefix_id}"
  rescue => e
    Rails.logger.warn "cancel: failed to copy checklist scripts to envelope: #{e.message}"
  end

  def sanitize_report_error(message)
    return nil if message.blank?
    return RevdokuDocApiClient::GENERIC_ERROR if message.match?(RevdokuDocApiClient::SENSITIVE_PATTERNS)
    message.truncate(200)
  end

  def set_report
    @report = policy_scope(Report).find_by_prefix_id(params[:id])
    render_api_not_found("Report") unless @report
  end

  def authorize_report
    authorize @report
  end

  # Strip large export content from audit logs — keep format, content_type, report_id
  def build_response_metadata
    meta = super
    if action_name == "export" && meta[:data].is_a?(Hash)
      meta[:data] = meta[:data].except(:content, :url, "content", "url")
    end
    meta
  end

  def set_envelope_for_create
    return unless params[:envelope_revision_id].present?

    envelope_revision = EnvelopeRevision.joins(:envelope)
                                        .where(envelopes: { account_id: current_account.id })
                                        .find_by_prefix_id(params[:envelope_revision_id])
    @envelope = envelope_revision&.envelope
  end

  def find_envelope_revision(prefix_id)
    envelope_revision = EnvelopeRevision.joins(:envelope)
                                        .where(envelopes: { account_id: current_account.id })
                                        .find_by_prefix_id(prefix_id)

    unless envelope_revision
      render_api_not_found("Envelope revision")
      return nil
    end

    envelope_revision
  end

  def needs_reinspection?(existing_report, new_checklist, envelope_revision)
    # Re-inspect if report has no AI checks but has rules (was reset)
    if existing_report.checks.where(source: :ai).count == 0 && existing_report.rules.any?
      Rails.logger.info "No AI checks found but rules exist — report was reset, re-inspecting"
      return true
    end

    # Check if the template checklist was updated since the last inspection
    previous_checklist_id = existing_report.inspection_checklist_id
    if previous_checklist_id && previous_checklist_id != new_checklist.prefix_id
      Rails.logger.info "Checklist changed from #{previous_checklist_id} to #{new_checklist.prefix_id}"
      return true
    end

    # Check if the same template's rules were updated since the inspection
    if previous_checklist_id == new_checklist.prefix_id
      inspected_at = existing_report.inspection_context&.dig("inspected_at")
      if inspected_at && new_checklist.updated_at > Time.parse(inspected_at)
        Rails.logger.info "Template updated since last inspection (template: #{new_checklist.updated_at}, inspected: #{inspected_at})"
        return true
      end
    end

    current_file_revisions = envelope_revision.document_file_revisions.pluck(:id).sort
    report_creation_time = existing_report.created_at
    file_revisions_at_report_time = envelope_revision.document_file_revisions
      .where("created_at <= ?", report_creation_time)
      .pluck(:id).sort

    if current_file_revisions != file_revisions_at_report_time
      Rails.logger.info "Document files changed. Current: #{current_file_revisions}, At report time: #{file_revisions_at_report_time}"
      return true
    end

    # Re-inspect if track_changes was enabled but page_texts were not yet extracted
    if existing_report.inspection_track_changes? && !existing_report.has_page_texts?
      Rails.logger.info "track_changes enabled but no page_texts stored — re-inspecting to extract text"
      return true
    end

    false
  end

  def enqueue_with_retry(job_class, *args, max_attempts: 3, **kwargs)
    attempts = 0
    begin
      attempts += 1
      job_class.perform_later(*args, **kwargs)
    rescue SolidQueue::Job::EnqueueError => e
      if attempts < max_attempts
        sleep(0.5 * attempts)
        retry
      else
        raise
      end
    end
  end

  def process_report_asynchronously(envelope_revision, checklist, timezone: nil, skip_previous_checks: false, ai_model_override: nil, track_changes_override: nil, highlight_mode_override: nil, max_affordable_pages: nil, existing_report: nil, review_note: nil, ad_hoc_ref_files: nil)
    Rails.logger.info "Processing report asynchronously"

    if existing_report
      preliminary_context = {
        "checklist" => {
          "id" => checklist.prefix_id,
          "name" => checklist.name,
          "rules" => checklist.rules || [],
          "ai_model" => checklist.ai_model
        },
        "review_note" => review_note,
        "ad_hoc_ref_files" => ad_hoc_ref_files
      }
      existing_report.update!(job_status: :pending, job_id: nil, error_message: nil, inspection_context: preliminary_context)
      report = existing_report
    else
      begin
        # Store minimal inspection_context at creation so the frontend can display
        # checklist name and rules even while the job is still processing.
        # The service will overwrite this with full context when doc-api returns.
        preliminary_context = {
          "checklist" => {
            "id" => checklist.prefix_id,
            "name" => checklist.name,
            "rules" => checklist.rules || [],
            "ai_model" => checklist.ai_model
          },
          "review_note" => review_note,
          "ad_hoc_ref_files" => ad_hoc_ref_files
        }
        report = Report.create!(
          envelope_revision: envelope_revision,
          account: envelope_revision.envelope.account,
          job_status: :pending,
          inspection_context: preliminary_context
        )
      rescue ActiveRecord::RecordNotUnique
        # Race condition: another request created the report between our check and create.
        # Return the existing report — the first request's job will handle processing.
        report = envelope_revision.report
        render_api_accepted({ report: format_report(report) })
        return
      end
    end

    # Store highlight_mode on the report (always sync from override or checklist)
    effective_highlight_mode = highlight_mode_override || Checklist.highlight_modes[checklist.highlight_mode]
    report.highlight_mode = effective_highlight_mode
    report.save!

    persist_callback_url(report, params[:callback_url])

    authorize report, :create?

    # Reference file pinning + synchronous enrichment (#ref[...]
    # markers). Creates RefFile pins on the envelope_revision and
    # rewrites every markered prompt into the canonical
    # `#ref[file:<dfrev_id>|<label>]` form via RuleFileResolver. On success the rewritten prompts + dedup'd
    # ref_files pins are read on-the-fly by
    # ReportCreationService to pick up when building the doc-api request.
    # On error, a 4xx was already rendered. Must run BEFORE enqueuing the
    # job, otherwise the job races with pin creation and doc-api is called
    # without any ref files.
    kickoff_state = resolve_and_pin_ref_files!(
      report: report,
      envelope_revision: envelope_revision,
      checklist: checklist
    )

    if kickoff_state == :error
      return
    end

    job = enqueue_with_retry(CreateReportJob,
      report.prefix_id,
      envelope_revision.prefix_id,
      checklist.prefix_id,
      user_id: current_user.id,
      timezone: timezone,
      skip_previous_checks: skip_previous_checks,
      ai_model_override: ai_model_override,
      track_changes_override: track_changes_override,
      highlight_mode_override: highlight_mode_override,
      max_affordable_pages: max_affordable_pages
    )

    report.update!(job_id: job.job_id)

    Rails.logger.info "Report creation job queued with ID: #{job.job_id} for report: #{report.prefix_id}"

    render_api_accepted({ report: format_report(report) })
  end

  # Scans the merged rules + checklist system_prompt for `#ref[...]`
  # markers. For each markered scope (rule or checklist), resolves each
  # marker to a DocumentFileRevision — either from the caller-supplied
  # `ref_files` array (for deferred `#ref[description]` markers) or
  # from the account library (for typed pins `#ref[file:<id>]`). Creates
  # `RefFile` pins on the envelope_revision and runs the synchronous
  # enrichment over the ref_files pins to rewrite prompts into the
  # canonical `#ref[file:<dfrev_prefix_id>|<label>]` form.
  #
  # Pins live on envelope_revision, so re-runs (reset, checklist switch)
  # reuse the same files. If the caller supplies a new `ref_files`
  # array on re-run, pins are replaced.
  #
  # API shape for `params[:ref_files]` is one of:
  #   Array<Hash> — rich form:
  #     [
  #       { "rule_id": "clst_xxx_rule_3", "document_file_revision_id": "dfrev_abc" },
  #       { "rule_id": null, "document_file_revision_id": "dfrev_def" }  # checklist-scoped
  #     ]
  #   Hash<rule_id, String|Array> — shorthand, one dfrev per rule:
  #     { "clst_xxx_rule_3": "dfrev_abc", "__checklist__": "dfrev_def" }
  #
  # Returns:
  #   :no_markers — nothing to do; caller proceeds to CreateReportJob
  #   :enriched   — pins created, ref_files pins created; caller proceeds
  #                 to CreateReportJob which will use the rewritten prompts
  #   :error      — 4xx already rendered; caller must skip credit charging
  def resolve_and_pin_ref_files!(report:, envelope_revision:, checklist:)
    @_current_envelope_revision = envelope_revision
    merged_rules = ReportCreationService.preview_merged_rules(envelope_revision, checklist)
    markered_rules = merged_rules.select { |r| RuleFileResolver.has_marker?(r[:prompt] || r["prompt"]) }

    checklist_system_prompt = checklist.system_prompt
    system_prompt_has_marker = checklist_system_prompt.present? &&
      RuleFileResolver.has_marker?(checklist_system_prompt)

    # Clear any stale enrichment state from a previous run up-front.
    report.update!(inspection_enqueued_at: nil)

    if markered_rules.empty? && !system_prompt_has_marker
      envelope_revision.ref_files.destroy_all
      return :no_markers
    end

    # Parse the caller's supplied ref_files param into a
    # `{scope_key => [dfrev_prefix_id]}` map. scope_key is a rule_id string
    # or `:checklist` for checklist-level pins.
    supplied = parse_ref_files_param(params[:reference_files])
    return :error if supplied == :invalid

    # Assemble a per-scope pin plan. Each entry: {scope_key, dfrev, position}
    pin_plan = []

    # Multiple #ref[...] markers per scope are supported. Each marker
    # resolves independently to its own pin; the marker's index in the
    # prompt becomes its `position`. Supplied reference files are matched
    # by position within their scope (array order = position).
    markered_rules.each do |rule|
      rule_id = (rule[:id] || rule["id"]).to_s
      prompt = rule[:prompt] || rule["prompt"]
      markers = RuleFileResolver.scan_markers(prompt)

      markers.each_with_index do |marker, position|
        revision = resolve_marker_to_revision(
          marker: marker,
          scope_label: "rule #{rule_id}",
          supplied_for_scope: supplied[rule_id],
          position: position,
          envelope_revision: envelope_revision
        )
        return :error if revision == :error
        next if revision == :skipped
        pin_plan << { scope_key: rule_id, revision: revision, position: position, save_to_library: @_last_resolved_save_to_library }
      end
    end

    if system_prompt_has_marker
      markers = RuleFileResolver.scan_markers(checklist_system_prompt)
      markers.each_with_index do |marker, position|
        revision = resolve_marker_to_revision(
          marker: marker,
          scope_label: "checklist system_prompt",
          supplied_for_scope: supplied[:checklist],
          position: position,
          envelope_revision: envelope_revision
        )
        return :error if revision == :error
        next if revision == :skipped
        pin_plan << { scope_key: :checklist, revision: revision, position: position, save_to_library: @_last_resolved_save_to_library }
      end
    end

    # Replace the envelope_revision's pins atomically with the fresh plan.
    # Enrichment itself (prompt rewriting into `file:<dfrev>` tokens) is
    # deferred to CreateReportJob — see the ref_files pins + the
    # phase-0 wait in create_report_job.rb. That way the controller
    # returns quickly even for large PDF uploads whose OCR is still in
    # flight.
    ActiveRecord::Base.transaction do
      envelope_revision.ref_files.destroy_all
      envelope = envelope_revision.envelope

      pin_plan.each do |pin|
        revision = pin[:revision]
        # Files must be envelope-scoped. If the resolved revision comes
        # from the library (envelope_id nil) or a different envelope,
        # clone it into THIS envelope. Shares the same ActiveStorage blob.
        unless revision.document_file.envelope_id == envelope.id
          revision = copy_revision_to_envelope(revision, envelope)
          pin[:revision] = revision
        end

        RefFile.create!(
          account: current_account,
          envelope_revision: envelope_revision,
          checklist: checklist,
          rule_id: pin[:scope_key] == :checklist ? nil : pin[:scope_key],
          document_file_revision: revision,
          position: pin[:position],
          save_to_library: pin[:save_to_library] == true
        )
      end
    end

    :pinned
  end

  # @return Hash<String|Symbol, Array<String>> mapping scope_key to an
  #         ordered list of DocumentFileRevision prefix_ids, or `:invalid`
  #         when the shape is malformed and a 4xx has already been rendered.
  def parse_ref_files_param(param)
    return {} if param.blank?

    supplied = {}

    case param
    when Array
      param.each do |entry|
        entry = entry.to_unsafe_h if entry.respond_to?(:to_unsafe_h)
        dfrev = entry["document_file_revision_id"] || entry[:document_file_revision_id]
        if dfrev.blank?
          render_api_error(
            "ref_files entry missing document_file_revision_id",
            status: :unprocessable_entity,
            code: "REFERENCE_FILES_MALFORMED"
          )
          return :invalid
        end
        rule_id = entry["rule_id"] || entry[:rule_id]
        save_flag = entry["save_to_library"] == true || entry[:save_to_library] == true
        key = rule_id.blank? ? :checklist : rule_id.to_s
        supplied[key] ||= []
        supplied[key] << { id: dfrev.to_s, save_to_library: save_flag }
      end
    when Hash, ActionController::Parameters
      hash = param.respond_to?(:to_unsafe_h) ? param.to_unsafe_h : param
      hash.each do |k, v|
        key = (k.to_s == "__checklist__" || k.nil?) ? :checklist : k.to_s
        supplied[key] = Array(v).map(&:to_s)
      end
    else
      render_api_error(
        "ref_files must be an array or hash",
        status: :unprocessable_entity,
        code: "REFERENCE_FILES_MALFORMED"
      )
      return :invalid
    end

    supplied
  end

  # Clone a DocumentFileRevision into an envelope-scoped DocumentFile.
  # Shares the same ActiveStorage blob (no raw-byte duplication) and
  # copies all normalized content (page_texts, rendered_pages_cache,
  # pages_layout_json) so the envelope's review is self-contained.
  def copy_revision_to_envelope(source, envelope)
    doc_file = DocumentFile.create!(
      account: current_account,
      envelope: envelope
    )
    rev = DocumentFileRevision.new(
      document_file: doc_file,
      account: current_account,
      name: source.name,
      mime_type: source.mime_type,
      size: source.size,
      revision_number: 0
    )
    rev.file.attach(source.file.blob) if source.file.attached?
    rev.page_texts = source.page_texts if source.page_texts.present?
    rev.pages_layout = source.pages_layout if source.pages_layout.present?
    rev.rendered_pages_cache.attach(source.rendered_pages_cache.blob) if source.rendered_pages_cache.attached?
    rev.save!
    rev
  end

  # Resolve a single marker to a DocumentFileRevision, scoped to the
  # current account. Returns the revision, or `:error` (with a 4xx already
  # rendered).
  #
  # Readiness is NOT checked here — the file's OCR/normalize job may
  # still be running. CreateReportJob's phase-0 wait handles that,
  # blocking the actual inspection until every pinned revision is ready.
  # This lets the Review dialog submit immediately and the user watch a
  # single "Preparing reference files..." progress indicator on the
  # main inspection overlay.
  # Look up a ref file pin from previous revisions of the same envelope
  # to auto-carry-forward when the user didn't supply one for this marker.
  # `position` lets multi-marker scopes (e.g. two #ref[...] in one
  # system_prompt) carry forward each slot independently.
  def find_previous_ref_file_pin(scope_label, marker, position: 0)
    return nil unless @_current_envelope_revision
    env = @_current_envelope_revision.envelope
    return nil unless env

    rule_id = scope_label.start_with?("checklist") ? nil : scope_label.sub(/^rule /, '')
    prior_revisions = EnvelopeRevision
      .where(envelope: env)
      .where("revision_number <= ?", @_current_envelope_revision.revision_number)
      .order(revision_number: :desc)
      .pluck(:id)

    scope = RefFile.where(envelope_revision_id: prior_revisions, position: position)
    scope = rule_id ? scope.where(rule_id: rule_id) : scope.where(rule_id: nil)
    scope.includes(:document_file_revision).first
  end

  # Resolves a single marker at `position` within its scope to a
  # DocumentFileRevision. Returns:
  #   - the revision (DocumentFileRevision) on success
  #   - :skipped when the caller didn't supply a file AND no prior pin
  #     carry-forward matched — the marker is optional; inspection runs
  #     without this reference
  #   - :error when a required resolution failed (a 4xx was rendered)
  def resolve_marker_to_revision(marker:, scope_label:, supplied_for_scope:, position: 0, envelope_revision: nil)
    revision = nil
    save_to_library = false

    case marker[:kind]
    when :deferred
      caller_entries = Array(supplied_for_scope)
      entry = caller_entries[position]

      if entry.nil?
        # Nothing supplied at this position — try auto-carry-forward from
        # a prior revision's pin at the same (rule_id, position). If that
        # also misses, this marker is optional: skip it, inspection runs
        # without the cross-reference.
        prev_pin = find_previous_ref_file_pin(scope_label, marker, position: position)
        if prev_pin
          @_last_resolved_save_to_library = false
          return prev_pin.document_file_revision
        end
        @_last_resolved_save_to_library = false
        return :skipped
      end

      dfrev_id = entry.is_a?(Hash) ? entry[:id] : entry.to_s
      save_to_library = entry.is_a?(Hash) ? entry[:save_to_library] == true : false
      revision = DocumentFileRevision
        .joins(:document_file)
        .where(document_files: { account_id: current_account.id })
        .find_by_prefix_id(dfrev_id)
    when :latest_df, :pinned_dfrev
      revision = RuleFileResolver.find_library_revision_for_marker(marker, account: current_account)
    end

    @_last_resolved_save_to_library = save_to_library

    if revision.nil?
      render_api_error(
        "#{scope_label}: could not resolve reference file",
        status: :unprocessable_entity,
        code: "REFERENCE_FILE_UNRESOLVED"
      )
      return :error
    end

    revision
  end

  # Build ref file metadata for the frontend. Unified list of pinned
  # ref_files (checklist `#ref[...]` markers) PLUS ad-hoc ref files
  # attached via the Review dialog's "Add note" section. Single source
  # of truth — all consumers (HighlightOverlay pills, CheckNavigator
  # strip, toolbar chip list) read this to resolve a `#ref[file:<id>]`
  # citation to its filename. Pass a `report` when available so the
  # ad-hoc half is included.
  def build_ref_files_meta(envelope_revision, report = nil)
    pinned = envelope_revision.ref_files_meta
    return pinned unless report

    ctx = report.inspection_context || {}
    ad_hoc = Array(ctx["ad_hoc_ref_files"]).filter_map do |entry|
      dfrev_id = (entry["document_file_revision_id"] || entry[:document_file_revision_id]).to_s
      next nil if dfrev_id.blank?
      rev = DocumentFileRevision.find_by_prefix_id(dfrev_id)
      label = (entry["label"] || entry[:label]).to_s
      text_content = rev ? Array(rev.page_texts).map { |p| p["text"] || p[:text] }.join("\n\n") : ""
      {
        document_file_revision_prefix_id: dfrev_id,
        rule_id: nil,
        mime_type: rev&.mime_type,
        filename: rev&.name || label.presence || dfrev_id,
        description: label.presence || rev&.name,
        text_content: text_content.presence,
        already_in_library: rev ? rev.in_account_library? : false,
        ad_hoc: true
      }
    end

    # Dedupe by dfrev prefix_id — a file could in theory be both pinned
    # and ad-hoc; prefer pinned (authoritative scope info).
    seen = pinned.map { |m| m[:document_file_revision_prefix_id] }.to_set
    ad_hoc_merged = ad_hoc.reject { |m| seen.include?(m[:document_file_revision_prefix_id]) }
    ad_hoc_merged.each { |m| seen << m[:document_file_revision_prefix_id] }

    # Defensive recovery: scan saved check descriptions for #ref[file:<id>]
    # tokens and add any cited dfrev that isn't already in the list.
    # This rescues reports finalized before `ad_hoc_ref_files` was
    # preserved in inspection_context — the AI-emitted dfrev still exists
    # in the envelope, so we can resolve its filename even though the
    # original user-attached metadata is lost.
    check_cited = report.checks.flat_map { |c|
      (c.description || '').scan(/#ref\[file:(dfrev_[A-Za-z0-9]+)/).flatten
    }.uniq.filter_map do |dfrev_id|
      next nil if seen.include?(dfrev_id)
      rev = DocumentFileRevision.find_by_prefix_id(dfrev_id)
      next nil unless rev
      seen << dfrev_id
      text_content = Array(rev.page_texts).map { |p| p["text"] || p[:text] }.join("\n\n")
      {
        document_file_revision_prefix_id: dfrev_id,
        rule_id: nil,
        mime_type: rev.mime_type,
        filename: rev.name,
        description: rev.name,
        text_content: text_content.presence,
        already_in_library: rev.in_account_library?,
        ad_hoc: true,
        recovered_from_description: true
      }
    end

    pinned + ad_hoc_merged + check_cited
  end

  def format_report(report)
    # Eager-load associations so convert_foreign_keys resolves prefix_ids
    report.envelope_revision
    data = change_id_to_prefix_in_object(report)

    # Ensure timestamps are ISO8601 strings for consistent frontend parsing
    data[:created_at] = report.created_at.iso8601 if report.created_at
    data[:updated_at] = report.updated_at.iso8601 if report.updated_at

    cache = build_rule_prompt_cache_from_report(report)
    data[:checks] = report.checks.map { |check| change_id_to_prefix_in_object(check, json_options: { rule_prompt_cache: cache }) }
    data[:envelope_revision] = change_id_to_prefix_in_object(report.envelope_revision)
    data[:checklist] = build_checklist_from_inspection_context(report)
    data[:checklist_id] = report.inspection_checklist_id
    data[:source_checklist_id] = report.inspection_checklist_id
    data[:label_font_scale] = report.label_font_scale
    data[:page_font_scales] = report.page_font_scales
    data[:font_family] = report.font_family
    data[:highlight_mode] = report.highlight_mode
    data[:page_count] = report.envelope_revision.page_count
    data[:ref_files_meta] = build_ref_files_meta(report.envelope_revision, report)
    # Per-page review status (EPageReviewStatus integer enum). Required for the frontend's
    # "Pages X-Y not reviewed. Continue review" banner — it reads currentReport.page_statuses.
    # Without this, the banner silently has no data and never shows after partial/cancelled runs.
    data[:page_statuses] = report.page_statuses
    # Stitched document-relative layout JSON for consumers reading raw pages_layout_json
    # (useLabelGeometry.ts, DebugPanel.tsx). Assembled from per-DFR data.
    data[:pages_layout_json] = report.pages_layout_json_aggregated
    aggregated_texts = report.page_texts
    data[:page_texts] = aggregated_texts if aggregated_texts.any?
    data[:has_page_texts] = report.has_page_texts?
    data[:meta] = report.meta if report.meta.present?
    data[:user_scripts_output] = report.user_scripts_output if report.user_scripts_output.present?
    # Per-inspection user context — used by the Review dialog to pre-fill
    # the "Add note" section on re-runs so the user doesn't have to
    # retype their note or re-attach their ad-hoc reference files.
    ctx = report.inspection_context || {}
    data[:review_note] = ctx["review_note"]
    data[:ad_hoc_ref_files] = Array(ctx["ad_hoc_ref_files"]).map do |entry|
      dfrev_id = (entry["document_file_revision_id"] || entry[:document_file_revision_id]).to_s
      rev = dfrev_id.present? ? DocumentFileRevision.find_by_prefix_id(dfrev_id) : nil
      {
        document_file_revision_id: dfrev_id,
        label: (entry["label"] || entry[:label]).to_s,
        filename: rev&.name
      }
    end
    data
  end

  def serialize_envelope_revision(envelope_revision)
    {
      id: envelope_revision.prefix_id,
      revision_number: envelope_revision.revision_number,
      report: nil,
      created_at: envelope_revision.created_at.iso8601,
      updated_at: envelope_revision.updated_at.iso8601,
      comment: envelope_revision.comment
    }
  end

  # Enhanced serialization for export with additional metadata
  def serialize_envelope_revision_for_export(envelope_revision)
    {
      id: envelope_revision.prefix_id,
      revision_number: envelope_revision.revision_number,
      created_at: envelope_revision.created_at.iso8601,
      updated_at: envelope_revision.updated_at.iso8601,
      comment: envelope_revision.comment,
      total_revisions: envelope_revision.envelope.envelope_revisions.count
    }
  end

  def serialize_document_file_revisions(document_file_revisions)
    document_file_revisions.map do |file_revision|
      change_id_to_prefix_in_object(file_revision).merge(
        data: file_revision.to_base64
      )
    end
  end

  # Enhanced serialization for export with file metadata.
  # Always sends the raw PDF data PLUS the cached pages_by_index hash. doc-api decides per-page
  # whether to use the cache or render fresh — same protocol as the review path. This way export
  # benefits from any pages cached by prior batched reviews without needing a complete cache.
  def serialize_document_file_revisions_for_export(document_file_revisions, _envelope_revision = nil)
    document_file_revisions.map do |file_revision|
      serialized = {
        id: file_revision.prefix_id,
        name: file_revision.name,
        revision_number: file_revision.revision_number,
        mime_type: file_revision.mime_type,
        size: file_revision.file.attached? ? file_revision.file.byte_size : 0,
        created_at: file_revision.created_at.iso8601,
        updated_at: file_revision.updated_at.iso8601,
        document_file_id: file_revision.document_file&.prefix_id,
      }
      serialized[:data] = file_revision.to_base64
      cached_hash = RenderedPagesCache.fetch_pages_by_index(file_revision)
      serialized[:cached_pages_by_index] = cached_hash if cached_hash.present?
      serialized
    end
  end

  # Build revision history for all revisions of the envelope (newest first)
  def build_revisions_history(envelope)
    envelope.envelope_revisions
      .order(revision_number: :desc)
      .includes(:created_by, document_file_revisions: [:document_file, file_attachment: :blob], report: :checks)
      .map do |rev|
        file_revisions = rev.document_file_revisions
        report = rev.report
        checks = report&.checks&.to_a || []

        {
          revision_number: rev.revision_number + 1, # 1-indexed for display
          created_at: rev.created_at.iso8601,
          comment: rev.comment.presence,
          created_by: format_audit_user_display(rev.created_by),
          has_report: report&.job_status_completed? || false,
          page_count: rev.page_count || file_revisions.sum { |f| f.metadata&.dig("page_count").to_i rescue 0 },
          total_checks: checks.size,
          failed_checks: checks.count { |c| !c.passed },
          passed_checks: checks.count { |c| c.passed },
          files: file_revisions.map do |dfr|
            {
              name: dfr.name,
              size: dfr.file.attached? ? dfr.file.byte_size : 0
            }
          end
        }
      end
  end

  # Build previous revision data for comparison in export
  def build_previous_revision_data(current_revision)
    previous_revision = current_revision.previous_revision
    return nil unless previous_revision

    previous_report = previous_revision.report
    report_summary = nil

    if previous_report&.job_status_completed?
      checks = previous_report.checks
      report_summary = {
        total_checks: checks.count,
        passed: checks.where(passed: true).count,
        failed: checks.where(passed: false).count,
        report_id: previous_report.prefix_id,
        created_at: previous_report.created_at.iso8601,
        # Include failed check details for comparison
        failed_checks: checks.where(passed: false).map do |check|
          {
            rule_key: check.rule_key,
            description: check.description,
            page: check.page,
            rule_prompt: check.rule_prompt
          }
        end
      }
    end

    {
      revision_number: previous_revision.revision_number,
      created_at: previous_revision.created_at.iso8601,
      comment: previous_revision.comment,
      report_summary: report_summary
    }
  end

  # Build checklist data from a report's inspection_context for API responses.
  # Returns nil if inspection_context is blank (stub reports before AI review).
  def build_checklist_from_inspection_context(report)
    ctx = report.inspection_context
    return nil unless ctx
    checklist_data = ctx["checklist"]
    return nil unless checklist_data

    {
      id: checklist_data["id"],
      name: checklist_data["name"],
      rules: serialize_rules(checklist_data["rules"] || []),
      system_prompt: checklist_data["system_prompt"],
      ai_model: checklist_data["ai_model"],
      highlight_mode: checklist_data["highlight_mode"],
      track_changes: checklist_data["track_changes"],
      checklist_type: "report_snapshot",
      is_inspection_snapshot: true,
      inspected_at: ctx["inspected_at"]
    }
  end

  # Build a rule_key => prompt cache from a report's inspection_context rules.
  def build_rule_prompt_cache_from_report(report)
    report.rules.each_with_object({}) do |r, h|
      key = r["id"] || r[:id]
      h[key] = r["prompt"] || r[:prompt]
    end
  end

  # Enhanced checklist serialization for export — reads from inspection_context
  def serialize_checklist_for_export_from_report(report)
    ctx = report.inspection_context
    return {} unless ctx
    checklist_data = ctx["checklist"] || {}
    all_rules = checklist_data["rules"] || []

    checklist_rules_count = all_rules.count { |r| (r[:origin] || r["origin"]) == "checklist" }
    user_rules_count = all_rules.count { |r| (r[:origin] || r["origin"]) == "user" }

    # Resolve user names for rules that have created_by_id
    user_ids = all_rules.filter_map { |r| r[:created_by_id] || r["created_by_id"] }
    users_by_id = user_ids.any? ? User.where(id: user_ids).index_by(&:id) : {}

    {
      id: checklist_data["id"],
      name: checklist_data["name"],
      rules: serialize_rules(all_rules, users_by_id: users_by_id),
      system_prompt: checklist_data["system_prompt"],
      ai_model: checklist_data["ai_model"],
      highlight_mode: checklist_data["highlight_mode"],
      track_changes: checklist_data["track_changes"],
      total_rules: all_rules.count,
      checklist_rules_count: checklist_rules_count,
      user_rules_count: user_rules_count,
      inspected_at: ctx["inspected_at"]
    }
  end

  def serialize_checks(checks, rule_prompt_cache: nil)
    cache = rule_prompt_cache || (checks.first && build_rule_prompt_cache_from_report(checks.first.report))
    checks.map do |c|
      change_id_to_prefix_in_object(c, json_options: cache ? { rule_prompt_cache: cache } : {})
    end
  end

  def serialize_rules(rules, users_by_id: {})
    rules.map do |r|
      created_by_id = r[:created_by_id] || r["created_by_id"]
      {
        id: r[:id] || r["id"],
        prompt: r[:prompt] || r["prompt"],
        order: r[:order] || r["order"],
        title: r[:title] || r["title"],
        origin: r[:origin] || r["origin"],
        source_envelope_revision_id: r[:source_envelope_revision_id] || r["source_envelope_revision_id"],
        source_rule_id: r[:source_rule_id] || r["source_rule_id"],
        created_at: r[:created_at] || r["created_at"],
        created_by_name: users_by_id[created_by_id]&.to_s
      }.compact
    end
  end

  # Serialize a Checklist AR record (used when returning template checklists, not for report data)
  def serialize_checklist(c)
    {
      id: c.prefix_id,
      name: c.name,
      rules: serialize_rules(c.rules),
      system_prompt: c.system_prompt,
      ai_model: c.ai_model,
      highlight_mode: Checklist.highlight_modes[c.highlight_mode]
    }
  end

  def serialize_report_for_export(report)
    checks_with_authors = report.checks.includes(:created_by)
    serialized_checks = serialize_checks(checks_with_authors)
    # Substitute prefix_ids → filenames in `#ref[file:<dfrev>]` markers so
    # the exported report never exposes internal IDs. The doc-api
    # handlebars helper renders `#ref[file:<value>]` verbatim, so putting
    # the filename in `<value>` here gives the chip the right label.
    id_to_filename = build_ref_file_filename_lookup(report.envelope_revision, report)
    serialized_checks.each do |check|
      desc = check[:description] || check["description"]
      next if desc.blank?
      rewritten = rewrite_ref_ids_to_filenames(desc, id_to_filename)
      if check.key?(:description)
        check[:description] = rewritten
      else
        check["description"] = rewritten
      end
    end
    change_id_to_prefix_in_object(report).merge(
      checks: serialized_checks,
      label_font_scale: report.label_font_scale,
      page_font_scales: report.page_font_scales,
      content_bounding_boxes: report.content_bounding_boxes,
      page_coordinate_spaces: report.page_coordinate_spaces,
      page_types: report.page_types,
      page_statuses: report.page_statuses,
      pages_layout_json: report.pages_layout_json_aggregated
    )
  end

  def build_ref_file_filename_lookup(envelope_revision, report = nil)
    # Unified meta is the single source of truth — covers pinned ref_files,
    # ad-hoc attachments from the Review dialog, and any #ref[file:<id>]
    # tokens scanned from finalized check descriptions (recovery for
    # pre-fix reports). Pinned-only lookup used to leave ad-hoc refs
    # unresolved → chips rendered raw `dfrev_xxx` in exports.
    meta = build_ref_files_meta(envelope_revision, report)
    meta.each_with_object({}) do |m, h|
      id = m[:document_file_revision_prefix_id] || m["document_file_revision_prefix_id"]
      name = m[:filename] || m["filename"]
      h[id] = name if id.present? && name.present?
    end
  end

  # Replace `#ref[file:<dfrev_id>|label]` / `#ref[file:<dfrev_id>]` in
  # a description with `#ref[file:<filename>]` so the exported chip
  # renders the user-friendly filename instead of an internal id.
  def rewrite_ref_ids_to_filenames(description, id_to_filename)
    return description if description.blank? || id_to_filename.empty?
    description.to_s.gsub(/#ref\[file:(df_[A-Za-z0-9]+|dfrev_[A-Za-z0-9]+)(?:\|[^\]]*)?\]/) do |match|
      id = $1
      name = id_to_filename[id]
      name ? "#ref[file:#{name}]" : match
    end
  end

  def fetch_envelope_audit_logs(envelope)
    # Part 1: Request-level audit logs (AuditLog)
    request_logs = AuditLog.where(account_id: current_account.prefix_id)
                           .for_envelope(envelope.prefix_id)
                           .order(created_at: :desc)
                           .limit(50)
                           .to_a

    # Batch-load users by prefix_id for request logs
    # Note: prefix_id is a virtual attribute (prefixed_ids gem), not a DB column.
    # Decode to real IDs first, then query by id.
    request_user_ids = request_logs.filter_map(&:user_id).uniq
    real_ids = request_user_ids.filter_map { |pid| User.decode_prefix_id(pid) rescue nil }
    users_by_prefix = real_ids.any? ? User.where(id: real_ids).index_by(&:prefix_id) : {}

    formatted_request_logs = request_logs.map do |log|
      user = users_by_prefix[log.user_id]
      {
        datetime: log.created_at.utc.iso8601,
        action: humanize_action_label(log, log.request),
        user: format_audit_user_display(user),
        user_id: user&.prefix_id || log.user_id,
        response_code: log.response_code
      }
    end

    # Part 2: Revision history entries
    revision_entries = envelope.envelope_revisions.order(:revision_number).includes(
      :created_by,
      document_file_revisions: [:document_file, :created_by]
    ).map do |rev|
      file_revisions = rev.document_file_revisions
      file_names = file_revisions.map { |dfr| dfr.name }.compact
      total_size = file_revisions.sum { |dfr| dfr.file_size.to_i }

      files_summary = if file_names.length > 0
        parts = []
        parts << "#{file_names.length} file#{'s' if file_names.length != 1}"
        parts << format_file_size(total_size) if total_size > 0
        details = parts.join(", ")
        file_list = file_names.first(5).join(", ")
        file_list += "..." if file_names.length > 5
        " (#{details}: #{file_list})"
      else
        ""
      end

      comment_suffix = if rev.respond_to?(:comment) && rev.comment.present? && rev.comment != "Initial version"
        " — #{rev.comment}"
      else
        ""
      end

      {
        datetime: rev.created_at.utc.iso8601,
        action: "Created revision v#{rev.revision_number}#{files_summary}#{comment_suffix}",
        user: format_audit_user_display(rev.created_by),
        user_id: rev.created_by&.prefix_id,
        response_code: nil
      }
    end

    # Merge, deduplicate by [datetime, action, user], sort desc, limit 50
    all_logs = (formatted_request_logs + revision_entries)
                 .uniq { |l| [l[:datetime], l[:action], l[:user]] }
                 .sort_by { |l| l[:datetime] }
                 .reverse
                 .first(50)

    # Remove "System" entries when a real user entry exists for the same datetime+action
    real_user_keys = all_logs.reject { |l| l[:user] == "System" }.map { |l| [l[:datetime], l[:action]] }.to_set
    all_logs.reject! { |l| l[:user] == "System" && real_user_keys.include?([l[:datetime], l[:action]]) }

    # Filter out low-value actions (must match YAML descriptions in audit_action_descriptions.yml)
    low_value_actions = ["Updated envelope", "Viewed envelope"]
    all_logs.reject! { |l| low_value_actions.include?(l[:action]) }

    all_logs
  rescue => e
    Rails.logger.error "Failed to fetch audit logs: #{e.message}"
    []
  end

  def format_file_size(bytes)
    return "0 B" if bytes.nil? || bytes == 0

    units = ["B", "KB", "MB", "GB"]
    exp = (Math.log(bytes) / Math.log(1024)).to_i
    exp = [exp, units.length - 1].min
    size = bytes.to_f / (1024**exp)
    format("%.1f %s", size, units[exp])
  end

  def format_audit_user_display(user)
    return "System" unless user

    name = user.name.presence
    email = user.email

    if name && email
      "#{name} <#{email}>"
    elsif email
      email
    else
      "System"
    end
  end

  # Override base class path-based extraction to also capture envelope_id
  # for report routes (e.g., POST /api/v1/reports, POST /api/v1/reports/:id/export)
  # which don't include /envelopes/env_xxx in the path.
  def extract_envelope_id_from_path
    if @report
      return @report.envelope_revision&.envelope&.prefix_id
    end
    if @envelope
      return @envelope.prefix_id
    end
    super
  end

  # Attempt to cancel job from Solid Queue
  # Returns true if job was found and destroyed, false otherwise
  def attempt_solid_queue_cancellation(job_id)
    return false unless job_id.present?

    begin
      # Query Solid Queue's queue database
      ActiveRecord::Base.connected_to(role: :writing, shard: :queue) do
        # Find job by active_job_id and ensure it's not already finished
        job = SolidQueue::Job.find_by(active_job_id: job_id, finished_at: nil)
        if job
          job.destroy
          Rails.logger.info "Cancelled queued job #{job_id} for report #{@report.prefix_id}"
          return true
        else
          Rails.logger.info "Job #{job_id} not in queue (already picked up or finished)"
          return false
        end
      end
    rescue => e
      Rails.logger.warn "Failed to cancel job from queue: #{e.class.name} - #{e.message}"
      return false
    end
  end


  # Persists the webhook callback URL onto the report's meta JSON. Called
  # from both the new-report path and the re-inspection path so the job and
  # cancel handler can read `meta["callback_url"]` on terminal status. When
  # `url` is blank we strip any stale value so a re-run without callback_url
  # doesn't re-fire an old webhook.
  def persist_callback_url(report, url)
    meta = report.meta.is_a?(Hash) ? report.meta.dup : {}
    if url.present?
      meta["callback_url"] = url.to_s
    else
      meta.delete("callback_url")
    end
    report.update_column(:meta, meta.to_json)
  end

  # Server-side guard mirroring the frontend's `isEditingDisabled`. Blocks
  # report mutations (currently just #reset) while the associated inspection
  # job is pending or processing so a stale client or direct API call cannot
  # race the background job. Display-only #update (font scale, highlight
  # mode, etc.) is intentionally NOT guarded because those settings do not
  # affect report semantics.
  def ensure_report_not_processing!
    return unless @report
    return unless @report.job_status_pending? || @report.job_status_processing?

    render_api_error(
      "Cannot modify a report while its review is running",
      status: :conflict,
      code: "REPORT_IN_PROGRESS"
    )
  end

end
