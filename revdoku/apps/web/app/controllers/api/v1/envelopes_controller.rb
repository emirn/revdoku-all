# frozen_string_literal: true

class Api::V1::EnvelopesController < Api::BaseController
  class DuplicateFileError < StandardError; end

  include EnvelopeArchivable

  before_action :set_envelope, only: [:show, :update, :destroy, :document_files, :create_revision, :update_document_files, :rollback, :archive, :unarchive, :toggle_star, :duplicate, :thumbnail, :upload_thumbnail, :edit_current_revision, :update_revision_comment, :debug_only_export_fixture, :clear_caches, :ref_file_history]
  before_action :authorize_envelope, only: [:show, :update, :destroy, :document_files]
  before_action :authorize_rollback!, only: [:rollback]
  before_action :ensure_envelope_not_archived!, only: [:update, :update_document_files, :create_revision, :rollback, :edit_current_revision, :update_revision_comment]

  # GET /api/v1/envelopes
  def index
    authorize Envelope
    @envelopes = policy_scope(Envelope)
                   .includes(:document_files, { tags: :parent_tag }, envelope_revisions: { report: :checks })

    # Filter by archive status (default: active only)
    if params[:archived] == "true"
      @envelopes = @envelopes.archived
    else
      @envelopes = @envelopes.active
    end

    precompute_tag_lookups!

    envelopes_data = @envelopes.map do |envelope|
      format_envelope_summary(envelope)
    end

    render_api_success({ envelopes: envelopes_data })
  end

  # GET /api/v1/envelopes/:id
  def show
    # Re-load with eager loading to avoid N+1 queries in format_envelope_detail
    @envelope = policy_scope(Envelope)
      .includes(
        { tags: :parent_tag },
        document_files: :document_file_revisions,
        envelope_revisions: {
          document_file_revisions: :document_file,
          report: { checks: :created_by }
        }
      )
      .find_by_prefix_id(params[:id])
    return render_api_not_found("Envelope") unless @envelope
    authorize @envelope

    # Mark as viewed (account-level: any user viewing clears "unseen" for everyone)
    @envelope.update_column(:last_viewed_at, Time.current)

    precompute_tag_lookups!

    envelope_data = format_envelope_detail(@envelope)
    render_api_success({ envelope: envelope_data })
  end

  # POST /api/v1/envelopes
  def create
    authorize Envelope

    # Enforce account envelope limit
    unless current_account.allows_envelope_creation?
      return render_api_error(
        "Envelope limit reached (#{current_account.max_envelopes}). Contact support to increase your limit.",
        status: :forbidden,
        code: "ENVELOPE_LIMIT_REACHED"
      )
    end

    @envelope = current_account.envelopes.build(envelope_params)
    # Allow empty title - it will be auto-populated when first files are added
    @envelope.title = "" if @envelope.title.nil?

    # Auto-detect source from token type, allow explicit override via params
    if params.dig(:envelope, :source).present?
      @envelope.source = params[:envelope][:source]
    else
      @envelope.source = @api_key&.api? ? :api : :web
    end

    if @envelope.save
      # Create initial envelope revision
      revision = @envelope.envelope_revisions.build(revision_number: 0)
      revision.comment = "Initial version"
      revision.save!

      envelope_data = format_envelope_detail(@envelope)
      render_api_created({ envelope: envelope_data })
    else
      render_api_validation_error(@envelope)
    end
  end

  # PUT /api/v1/envelopes/:id
  def update
    # Handle encrypted user_scripts separately — array of { id, code, name?, created_at? }
    if params[:envelope]&.key?(:user_scripts)
      incoming = params[:envelope][:user_scripts]
      scripts = incoming.is_a?(Array) ? incoming.map.with_index { |s, i|
        entry = { "id" => s["id"].presence || "script_#{i}", "code" => s["code"].to_s }
        entry["name"] = s["name"].to_s if s["name"].present?
        entry["created_at"] = s["created_at"].to_s if s["created_at"].present?
        entry
      } : []
      @envelope.user_scripts = scripts
    end

    if @envelope.update(envelope_params)
      envelope_data = format_envelope_detail(@envelope)
      render_api_success({ envelope: envelope_data })
    else
      render_api_validation_error(@envelope)
    end
  end

  # DELETE /api/v1/envelopes/:id
  def destroy
    @envelope.destroy
    render_api_no_content
  end

  # GET /api/v1/envelopes/:id/document_files
  def document_files
    document_files = @envelope.document_files.includes(document_file_revisions: { file_attachment: :blob })

    document_files_data = document_files.map do |document_file|
      format_document_file(document_file)
    end

    render_api_success({ document_files: document_files_data })
  end

  # POST /api/v1/envelopes/:id/create_revision
  def create_revision
    authorize @envelope, :create_revision?

    # Enforce account revision limit
    unless current_account.allows_revision_creation?
      render_api_error(
        "Revision limit reached (#{current_account.max_revisions}). Contact support to increase your limit.",
        status: :forbidden,
        code: "REVISION_LIMIT_REACHED"
      )
      return
    end

    current_revision = @envelope.envelope_revisions.order(revision_number: :desc).first

    # Block new revision if current revision hasn't been reviewed (no inspection_context)
    if current_revision
      report = current_revision.report
      if !report || report.inspection_context.blank?
        render_api_error(
          "Please review the current revision before creating a new one.",
          status: :unprocessable_entity,
          code: "REVIEW_REQUIRED"
        )
        return
      end
    end

    max_revision = @envelope.envelope_revisions.maximum(:revision_number) || -1

    new_revision = @envelope.envelope_revisions.build(revision_number: max_revision + 1)
    new_revision.comment = params[:comment] || "New revision"
    new_revision.save!

    @envelope.update!(current_revision_index: @envelope.envelope_revisions.count - 1)

    render_api_created({
      revision: format_envelope_revision(new_revision),
      envelope: {
        current_revision_index: @envelope.current_revision_index
      }
    })
  end

  # POST /api/v1/envelopes/:id/update_document_files
  def update_document_files
    authorize @envelope, :update_document_files?

    file_state = params[:file_state].present? ? JSON.parse(params[:file_state]) : []

    # Validate file size limits before processing
    if params[:files].present?
      account_max_file = FileSizeLimits.max_file_size_for_account(current_account)

      total_new_size = 0
      params[:files].each_value do |file|
        if file.size > account_max_file
          render_api_error(FileSizeLimits.file_too_large_message(current_account.max_file_size_mb), status: :unprocessable_entity, code: "FILE_TOO_LARGE")
          return
        end
        total_new_size += file.size
      end

      unless FileSizeLimits.validate_envelope_size(@envelope, total_new_size)
        render_api_error(FileSizeLimits.envelope_too_large_message, status: :unprocessable_entity, code: "ENVELOPE_TOO_LARGE")
        return
      end
    end

    comment = params[:comment].presence

    current_revision = @envelope.envelope_revisions.order(revision_number: :desc).first

    is_first_empty_revision = current_revision &&
      current_revision.revision_number == 0 &&
      current_revision.document_file_revisions.empty?

    new_revision = nil
    ActiveRecord::Base.transaction do
      if is_first_empty_revision
        new_revision = current_revision
        new_revision.update!(comment: comment) if comment != "Initial version"
      else
        # Enforce account revision limit when creating a non-initial revision
        unless current_account.allows_revision_creation?
          render_api_error(
            "Revision limit reached (#{current_account.max_revisions}). Contact support to increase your limit.",
            status: :forbidden,
            code: "REVISION_LIMIT_REACHED"
          )
          return
        end

        max_revision = @envelope.envelope_revisions.maximum(:revision_number) || -1
        new_revision = @envelope.envelope_revisions.build(revision_number: max_revision + 1)
        new_revision.comment = comment
        new_revision.save!
      end

      process_file_state(new_revision, file_state)

      # Save total page count from frontend (used for per-page credit pricing)
      if params[:page_count].present?
        new_revision.update!(page_count: params[:page_count].to_i)
      end

      # Auto-update envelope title from filenames if this is the first revision and title is blank
      if is_first_empty_revision && @envelope.title.blank?
        @envelope.update_title_from_files!(new_revision.document_file_revisions.reload)
      end

      unless is_first_empty_revision
        @envelope.update!(current_revision_index: @envelope.envelope_revisions.count - 1)
      end
    end

    render_api_created({
      revision: format_envelope_revision(new_revision),
      envelope: {
        current_revision_index: @envelope.current_revision_index,
        title: @envelope.title
      }
    })
  rescue DuplicateFileError => e
    render_api_error(e.message, status: :unprocessable_entity, code: "DUPLICATE_FILE")
  rescue ActiveRecord::RecordInvalid => e
    render_api_error(e.message, status: :unprocessable_entity, code: "SAVE_FAILED")
  end

  # POST /api/v1/envelopes/:id/rollback
  def rollback
    revision_index = params[:revision_index].to_i

    if revision_index < 0 || revision_index >= @envelope.envelope_revisions.count
      render_api_error("Invalid revision index", status: :bad_request, code: "INVALID_REVISION_INDEX")
      return
    end

    ActiveRecord::Base.transaction do
      revisions_to_delete = @envelope.envelope_revisions
        .where("revision_number > ?", revision_index)
        .includes(:document_file_revisions)

      all_deleted_file_revision_ids = revisions_to_delete
        .flat_map(&:document_file_revision_ids).uniq

      remaining_file_revision_ids = @envelope.envelope_revisions
        .where("revision_number <= ?", revision_index)
        .flat_map(&:document_file_revision_ids).uniq

      orphaned_file_revision_ids = all_deleted_file_revision_ids - remaining_file_revision_ids

      revisions_to_delete.destroy_all

      if orphaned_file_revision_ids.any?
        DocumentFileRevision.where(id: orphaned_file_revision_ids).destroy_all

        empty_document_files = @envelope.document_files
          .left_joins(:document_file_revisions)
          .where(document_file_revisions: { id: nil })
        empty_document_files.destroy_all
      end
    end

    @envelope.update!(current_revision_index: @envelope.envelope_revisions.count - 1)

    render_api_success({ envelope: format_envelope_detail(@envelope.reload) })
  end

  # POST /api/v1/envelopes/:id/archive
  def archive
    authorize @envelope, :archive?
    @envelope.archive!
    render_api_success({ envelope: format_envelope_detail(@envelope.reload) })
  end

  # POST /api/v1/envelopes/:id/unarchive
  def unarchive
    authorize @envelope, :unarchive?
    @envelope.unarchive!
    render_api_success({ envelope: format_envelope_detail(@envelope.reload) })
  end

  # POST /api/v1/envelopes/:id/toggle_star
  def toggle_star
    authorize @envelope, :toggle_star?
    @envelope.update!(starred: !@envelope.starred)
    render_api_success({ envelope: format_envelope_summary(@envelope.reload) })
  end

  # POST /api/v1/envelopes/:id/edit_current_revision
  def edit_current_revision
    authorize @envelope, :update?

    revision = @envelope.envelope_revisions.order(revision_number: :desc).first
    unless revision
      return render_api_not_found("Revision")
    end

    # Guard: if revision has a non-reset report, reject
    if revision.report.present? && revision.report.job_status != "reset"
      return render_api_error(
        "Cannot edit revision with an active report. Reset the report first.",
        status: :unprocessable_entity,
        code: "REPORT_NOT_RESET"
      )
    end

    file_state = params[:file_state].present? ? JSON.parse(params[:file_state]) : []

    # Validate file size limits before processing
    if params[:files].present?
      account_max_file = FileSizeLimits.max_file_size_for_account(current_account)

      total_new_size = 0
      params[:files].each_value do |file|
        if file.size > account_max_file
          render_api_error(FileSizeLimits.file_too_large_message(current_account.max_file_size_mb), status: :unprocessable_entity, code: "FILE_TOO_LARGE")
          return
        end
        total_new_size += file.size
      end

      unless FileSizeLimits.validate_envelope_size(@envelope, total_new_size)
        render_api_error(FileSizeLimits.envelope_too_large_message, status: :unprocessable_entity, code: "ENVELOPE_TOO_LARGE")
        return
      end
    end

    ActiveRecord::Base.transaction do
      # Clear existing file revision links
      revision.document_file_revisions.clear

      # Rebuild links using process_file_state
      process_file_state(revision, file_state)

      # Update comment if provided
      comment = params[:comment]
      revision.update!(comment: comment) if comment.present?

      # Update page count if provided
      if params[:page_count].present?
        revision.update!(page_count: params[:page_count].to_i)
      end
    end

    render_api_success({
      revision: format_envelope_revision(revision.reload),
      envelope: {
        current_revision_index: @envelope.current_revision_index,
        title: @envelope.title
      }
    })
  rescue DuplicateFileError => e
    render_api_error(e.message, status: :unprocessable_entity, code: "DUPLICATE_FILE")
  rescue ActiveRecord::RecordInvalid => e
    render_api_error(e.message, status: :unprocessable_entity, code: "SAVE_FAILED")
  end

  # POST /api/v1/envelopes/:id/update_revision_comment
  # Lightweight endpoint for updating only the revision comment (metadata).
  # No report-status guard — comment doesn't affect inspection results.
  def update_revision_comment
    authorize @envelope, :update?

    revision = @envelope.envelope_revisions.order(revision_number: :desc).first
    unless revision
      return render_api_not_found("Revision")
    end

    comment = params[:comment]
    unless comment.present?
      return render_api_bad_request("Comment is required")
    end

    revision.update!(comment: comment)

    render_api_success({
      revision: format_envelope_revision(revision.reload)
    })
  rescue ActiveRecord::RecordInvalid => e
    render_api_error(e.message, status: :unprocessable_entity, code: "SAVE_FAILED")
  end

  # POST /api/v1/envelopes/:id/duplicate
  def duplicate
    authorize @envelope, :duplicate?

    # Enforce account envelope limit
    unless current_account.allows_envelope_creation?
      return render_api_error(
        "Envelope limit reached (#{current_account.max_envelopes}). Contact support to increase your limit.",
        status: :forbidden,
        code: "ENVELOPE_LIMIT_REACHED"
      )
    end

    # Validate copy_mode parameter
    copy_mode = params[:copy_mode].to_s.presence || "all_revisions"
    unless %w[latest_only all_revisions].include?(copy_mode)
      return render_api_bad_request("Invalid copy_mode. Must be 'latest_only' or 'all_revisions'.")
    end

    include_manual_checks = params[:include_manual_checks] != false &&
                            params[:include_manual_checks] != "false"

    service = DuplicateEnvelopeService.new(
      @envelope,
      current_user: current_user,
      copy_mode: copy_mode.to_sym,
      include_manual_checks: include_manual_checks
    )
    result = service.call

    if result[:success]
      render_api_created({
        envelope: format_envelope_detail(result[:envelope]),
        message: "Envelope duplicated successfully"
      })
    else
      render_api_internal_error(result[:message])
    end
  end

  # POST /api/v1/envelopes/:id/debug_only_export_fixture (development only)
  def debug_only_export_fixture
    return render_api_not_found unless Rails.env.development?

    authorize @envelope, :show?

    # Use specific revision if provided, otherwise auto-detect
    revision = if params[:envelope_revision_id].present?
      @envelope.envelope_revisions.find_by_prefix_id(params[:envelope_revision_id])
    end
    result = revision ? EnvelopeFixtureExporter.call(@envelope, revision: revision) : EnvelopeFixtureExporter.call(@envelope)

    if result[:success]
      # Build descriptive filename: envelope_id + revision_N + checklist_id + model
      rev = revision || @envelope.envelope_revisions.order(revision_number: :desc).detect { |r| r.report&.job_status_completed? }
      rev_num = rev&.revision_number || 0
      checklist_id = rev&.report&.inspection_checklist_id || "no-checklist"
      ai_model = rev&.report&.ai_model || "unknown"
      safe_model = ai_model.gsub(/[^a-zA-Z0-9_-]/, "_")
      filename = "#{@envelope.prefix_id}_revision_#{rev_num + 1}_#{checklist_id}_#{safe_model}.json"

      # In development, also save to /tmp/cache/ for quick reload
      if Rails.env.development?
        cache_dir = Rails.root.join("tmp/cache/fixtures")
        FileUtils.mkdir_p(cache_dir)
        cache_path = cache_dir.join(filename)
        File.write(cache_path, JSON.pretty_generate(result[:fixture]))
        Rails.logger.info "Saved fixture cache to #{cache_path}"
      end

      render_api_success({ fixture: result[:fixture], filename: filename })
    else
      render_api_internal_error(result[:message])
    end
  end

  # POST /api/v1/envelopes/:id/clear_caches (development only)
  def clear_caches
    return render_api_not_found unless Rails.env.development?

    authorize @envelope, :show?

    cleared = 0
    @envelope.envelope_revisions.each do |rev|
      rev.document_file_revisions.each do |file_rev|
        if file_rev.rendered_pages_cache.attached?
          file_rev.rendered_pages_cache.purge
          cleared += 1
        end
        if file_rev.page_thumbnails.attached?
          file_rev.page_thumbnails.purge
          cleared += 1
        end
      end
    end

    render_api_success({ cleared: cleared, message: "Cleared #{cleared} cache attachments" })
  end

  # POST /api/v1/envelopes/load_fixture (development only)
  def load_fixture
    return render_api_not_found unless Rails.env.development?

    authorize Envelope, :create?

    fixture = params[:fixture]
    unless fixture.is_a?(ActionController::Parameters) || fixture.is_a?(Hash)
      return render_api_bad_request("fixture must be a JSON object")
    end

    fixture_hash = fixture.to_unsafe_h

    result = EnvelopeFixtureImporter.call(current_account, fixture_hash)

    if result[:success]
      render_api_created({ envelope: format_envelope_detail(result[:envelope]) })
    else
      render_api_error(result[:message], status: :unprocessable_entity, code: "FIXTURE_IMPORT_FAILED")
    end
  end

  # GET /api/v1/envelopes/:id/thumbnail
  def thumbnail
    authorize @envelope, :show?

    latest_revision = @envelope.envelope_revisions.order(revision_number: :desc).first
    first_file_rev = latest_revision&.document_file_revisions&.first
    return head(:not_found) unless first_file_rev

    # Prefer lightweight thumbnails (small JPEG ~2-4 KB)
    thumbs = PageThumbnails.fetch(first_file_rev)
    if thumbs&.first && thumbs.first["pageAsImage"].present?
      image_data = Base64.decode64(thumbs.first["pageAsImage"])
      expires_in 1.hour, public: false
      send_data image_data, type: "image/webp", disposition: "inline"
      return
    end

    # Fallback to full rendered pages cache (page 0 = first file-relative page)
    pages_by_index = RenderedPagesCache.fetch_pages_by_index(first_file_rev)
    first_page = pages_by_index && pages_by_index["0"]
    if first_page && first_page["pageAsImage"].present?
      image_data = Base64.decode64(first_page["pageAsImage"])
      expires_in 1.hour, public: false
      send_data image_data, type: "image/jpeg", disposition: "inline"
      return
    end

    head :not_found
  end

  # PUT /api/v1/envelopes/:id/thumbnail
  MAX_THUMBNAIL_BASE64_SIZE = 200_000 # ~150 KB decoded image

  def upload_thumbnail
    authorize @envelope, :update?

    thumbnail_data = params[:thumbnail]
    return head(:bad_request) unless thumbnail_data.present?

    latest_revision = @envelope.envelope_revisions.order(revision_number: :desc).first
    first_file_rev = latest_revision&.document_file_revisions&.first
    return head(:not_found) unless first_file_rev

    # Strip data URL prefix if present (e.g. "data:image/jpeg;base64,...")
    base64 = thumbnail_data.sub(%r{\Adata:image/\w+;base64,}, "")

    # Guard against oversized payloads
    return head(:bad_request) if base64.length > MAX_THUMBNAIL_BASE64_SIZE

    thumbnails = [{
      "pageAsImage" => base64,
      "width" => params[:width].to_i.presence || 300,
      "height" => params[:height].to_i.presence || 160
    }]

    PageThumbnails.store(first_file_rev, thumbnails)
    head :ok
  end

  # POST /api/v1/envelopes/bulk_action
  def bulk_action
    authorize Envelope, :bulk_action?

    action = params[:action_type]
    ids = params[:ids]

    unless %w[archive unarchive delete].include?(action)
      return render_api_bad_request("Invalid action. Must be archive, unarchive, or delete.")
    end

    unless ids.is_a?(Array) && ids.any?
      return render_api_bad_request("ids must be a non-empty array of envelope prefix IDs.")
    end

    envelopes = ids.filter_map { |id| policy_scope(Envelope).find_by_prefix_id(id) }

    if envelopes.empty?
      return render_api_not_found("No envelopes found for the given IDs.")
    end

    case action
    when "archive"
      envelopes.each(&:archive!)
    when "unarchive"
      envelopes.each(&:unarchive!)
    when "delete"
      envelopes.each do |env|
        authorize env, :destroy?
        env.destroy
      end
    end

    render_api_success({ affected_count: envelopes.size })
  end

  # GET /api/v1/envelopes/:id/ref_file_history
  #
  # Returns the most recent DocumentFileRevision pinned for a given rule
  # (or checklist-scoped slot) on any envelope_revision of this envelope.
  # Used by the Review dialog to pre-fill the upload control when a rule
  # carries a `#ref[...]` marker.
  #
  # Pins live on `envelope_revision.ref_files` (not on Report), so
  # re-opening the dialog after a previous inspection — whether the
  # previous Report was completed, reset, or cancelled — can always
  # surface the last-used revision.
  def ref_file_history
    authorize @envelope, :show?

    rule_id = params[:rule_id]
    checklist_scoped = params[:checklist_scoped] == "true" || params[:checklist_scoped] == true
    position = params[:position].to_i

    if rule_id.blank? && !checklist_scoped
      return render_api_bad_request("rule_id is required (or pass checklist_scoped=true for checklist-level files)")
    end

    scope = RefFile
      .joins(:envelope_revision)
      .where(envelope_revisions: { envelope_id: @envelope.id })
      .where(account_id: current_account.id)
      .where(position: position)

    scope =
      if checklist_scoped
        scope.where(rule_id: nil)
      else
        scope.where(rule_id: rule_id)
      end

    ref = scope
      .order("envelope_revisions.created_at DESC, ref_files.created_at DESC")
      .includes(:document_file_revision)
      .first

    return render_api_not_found("Rule file history") unless ref

    revision = ref.document_file_revision
    render_api_success({
      document_file_revision: {
        prefix_id: revision.prefix_id,
        revision_number: revision.revision_number,
        name: revision.name,
        mime_type: revision.mime_type,
        byte_size: revision.file_size,
        ready: revision.ready?,
        uploaded_at: revision.created_at.iso8601
      },
      description: nil,
      rule_id: ref.rule_id,
      scope: ref.rule_id.nil? ? "checklist" : "rule"
    })
  end

  private

  # Precomputes tag full_path and parent prefix_id lookups from all account tags.
  # Call once per action, then use @tag_full_paths and @tag_parent_prefix_map in formatters.
  def precompute_tag_lookups!
    all_tags = current_account.tags.to_a
    @tag_full_paths = Tag.compute_full_paths(all_tags)
    @tag_parent_prefix_map = all_tags.each_with_object({}) { |t, h| h[t.id] = t.prefix_id }
  end

  def format_tag_for_envelope(tag)
    {
      id: tag.prefix_id,
      name: tag.name,
      color: tag.color,
      position: tag.position,
      parent_id: @tag_parent_prefix_map&.dig(tag.parent_tag_id),
      full_path: @tag_full_paths&.dig(tag.id) || tag.full_path
    }
  end

  def set_envelope
    @envelope = policy_scope(Envelope).find_by_prefix_id(params[:id])
    render_api_not_found("Envelope") unless @envelope
  end

  def authorize_envelope
    authorize @envelope
  end

  def authorize_rollback!
    authorize @envelope, :rollback?
  end

  def envelope_params
    params.fetch(:envelope, {}).permit(:title, :status,
      report_settings: [
        :show_checklist_name, :show_rules, :show_audit_logs, :show_title_info,
        :show_compliance_summary, :show_compliance_percent, :show_default_footer, :last_checklist_id,
        :show_page_images, :show_check_details, :show_extracted_data, :show_pages_with_checks,
        :show_pages_without_checks, :show_checklist_info, :show_checklist_general_prompt,
        :show_checklist_rules_summary, :show_checklist_rules_details,
        :show_checklist_envelope_rules, :show_timezone, :show_revision_comparison,
        :show_check_attribution, :show_envelope_datetime, :show_envelope_revisions_info,
        :show_checklist_ai_model, :show_page_filenames, :show_page_summary_icons,
        :show_group_header, :show_group_checklist, :show_group_pages,
        :show_group_footer, :show_checklist_ai_model_info
      ],
      view_settings: [
        :check_filter, :report_check_filter, :report_layout_mode, :show_annotations, :view_mode,
        :ref_viewer_x, :ref_viewer_y, :ref_viewer_width, :ref_viewer_height
      ]
    )
  end

  def format_envelope_summary(envelope)
    data = change_id_to_prefix_in_object(envelope)
    data[:permissions] = envelope.user_permissions(current_user)
    data[:role_name] = envelope.user_role(current_user)
    data[:source] = envelope.source
    data[:archived_at] = envelope.archived_at&.iso8601
    data[:starred] = envelope.starred
    data[:has_scripts] = envelope.user_scripts.present?

    latest_revision = envelope.envelope_revisions.max_by(&:revision_number)
    if latest_revision&.report
      report = latest_revision.report
      checks = report.checks
      data[:last_report] = {
        checklist_id: report.inspection_checklist_id,
        checklist_name: report.inspection_checklist_name,
        ai_model: report.ai_model,
        ai_model_display: format_ai_model_label(report.ai_model),
        created_at: report.created_at,
        total_checks: checks.length,
        passed_checks: checks.select(&:passed).length,
        failed_checks: checks.reject(&:passed).length,
        job_status: report.job_status,
        prefix_id: report.prefix_id
      }
    end

    data[:latest_revision_id] = latest_revision&.prefix_id
    data[:tags] = envelope.tags.sort_by(&:position).map { |t| format_tag_for_envelope(t) }
    data[:document_count] = envelope.document_files.length
    data[:revision_count] = envelope.envelope_revisions.length
    data[:page_count] = latest_revision&.page_count || 0
    data[:unseen] = envelope.last_viewed_at.nil? || envelope.updated_at > envelope.last_viewed_at
    data[:report_settings] = build_report_settings(envelope)
    data[:view_settings] = build_view_settings(envelope)
    data
  end

  def format_ai_model_label(model_id)
    return nil unless model_id.present?
    entry = AiModelResolver.find_model(model_id, account: current_account)
    return nil unless entry
    "#{AiModelResolver.display_name(entry)} #{AiModelResolver.star_rating(entry)}"
  end

  def build_report_settings(envelope)
    # Default true for most toggles (nil means never set → show by default)
    default_true = ->(val) { val.nil? ? true : val == true }
    default_false = ->(val) { val == true }

    {
      show_checklist_name: default_false.call(envelope.show_checklist_name),
      show_rules: default_false.call(envelope.show_rules),
      show_audit_logs: default_false.call(envelope.show_audit_logs),
      show_title_info: default_true.call(envelope.show_title_info),
      show_compliance_summary: default_false.call(envelope.show_compliance_summary),
      show_compliance_percent: default_true.call(envelope.show_compliance_percent),
      show_default_footer: default_true.call(envelope.show_default_footer),
      show_page_images: default_true.call(envelope.show_page_images),
      show_check_details: default_true.call(envelope.show_check_details),
      show_extracted_data: default_false.call(envelope.show_extracted_data),
      show_pages_with_checks: default_true.call(envelope.show_pages_with_checks),
      show_pages_without_checks: default_true.call(envelope.show_pages_without_checks),
      show_checklist_info: default_true.call(envelope.show_checklist_info),
      show_checklist_general_prompt: default_true.call(envelope.show_checklist_general_prompt),
      show_checklist_rules_summary: default_true.call(envelope.show_checklist_rules_summary),
      show_checklist_rules_details: default_true.call(envelope.show_checklist_rules_details),
      show_checklist_envelope_rules: default_true.call(envelope.show_checklist_envelope_rules),
      show_timezone: default_true.call(envelope.show_timezone),
      show_revision_comparison: default_true.call(envelope.show_revision_comparison),
      show_check_attribution: default_false.call(envelope.show_check_attribution),
      show_envelope_datetime: default_true.call(envelope.show_envelope_datetime),
      show_envelope_revisions_info: default_true.call(envelope.show_envelope_revisions_info),
      show_checklist_ai_model: default_false.call(envelope.show_checklist_ai_model),
      show_page_filenames: default_true.call(envelope.show_page_filenames),
      show_page_summary_icons: default_true.call(envelope.show_page_summary_icons),
      show_group_header: default_true.call(envelope.show_group_header),
      show_group_checklist: default_false.call(envelope.show_group_checklist),
      show_group_pages: default_true.call(envelope.show_group_pages),
      show_group_footer: default_true.call(envelope.show_group_footer),
      show_checklist_ai_model_info: default_true.call(envelope.show_checklist_ai_model_info)
    }
  end

  def build_view_settings(envelope)
    {
      check_filter: envelope.check_filter,
      report_check_filter: envelope.report_check_filter,
      report_layout_mode: envelope.report_layout_mode,
      show_annotations: envelope.show_annotations,
      view_mode: envelope.view_mode,
      ref_viewer_x: envelope.ref_viewer_x,
      ref_viewer_y: envelope.ref_viewer_y,
      ref_viewer_width: envelope.ref_viewer_width,
      ref_viewer_height: envelope.ref_viewer_height
    }
  end

  def format_envelope_detail(envelope)
    data = change_id_to_prefix_in_object(envelope)
    data[:permissions] = envelope.user_permissions(current_user)
    data[:role_name] = envelope.user_role(current_user)
    data[:source] = envelope.source
    data[:archived_at] = envelope.archived_at&.iso8601
    data[:starred] = envelope.starred
    data[:report_settings] = build_report_settings(envelope)
    data[:view_settings] = build_view_settings(envelope)
    data[:user_scripts] = envelope.user_scripts if envelope.user_scripts.present?
    data[:envelope_revisions] = envelope.envelope_revisions.includes(document_file_revisions: :document_file, report: { checks: :created_by }).map do |revision|
      format_envelope_revision(revision)
    end
    data[:document_files] = envelope.document_files.map do |document_file|
      format_document_file(document_file)
    end
    data[:current_revision_index] = envelope.current_revision_index
    data[:tags] = envelope.tags.sort_by(&:position).map { |t| format_tag_for_envelope(t) }
    data
  end

  def format_envelope_revision(revision)
    data = change_id_to_prefix_in_object(revision)
    data[:document_file_revision_links] = revision.ordered_document_file_revisions.map do |file_rev|
      {
        document_file_id: file_rev.document_file.prefix_id,
        revision_number: file_rev.revision_number
      }
    end

    if revision.report
      data[:report] = change_id_to_prefix_in_object(revision.report)
      data[:report][:created_at] = revision.report.created_at.iso8601 if revision.report.created_at
      data[:report][:updated_at] = revision.report.updated_at.iso8601 if revision.report.updated_at
      cache = build_rule_prompt_cache_from_report(revision.report)
      data[:report][:checks] = revision.report.checks.map { |check| change_id_to_prefix_in_object(check, json_options: { rule_prompt_cache: cache }) }
      checklist_data = build_checklist_from_inspection_context(revision.report)
      if checklist_data
        data[:report][:checklist_id] = checklist_data[:id]
        data[:report][:source_checklist_id] = checklist_data[:id]
        data[:report][:checklist] = checklist_data
      end
      data[:report][:label_font_scale] = revision.report.label_font_scale
      data[:report][:page_font_scales] = revision.report.page_font_scales
      data[:report][:font_family] = revision.report.font_family
      data[:report][:highlight_mode] = revision.report.highlight_mode
      data[:report][:has_page_texts] = revision.report.has_page_texts?
      data[:report][:meta] = revision.report.meta if revision.report.meta.present?
      data[:report][:user_scripts_output] = revision.report.user_scripts_output if revision.report.user_scripts_output.present?
      # Per-page review status + total page count — required by the frontend's
      # "Pages X–Y not reviewed. Continue review" banner (see EnvelopePage.tsx
      # around line 3343, which reads currentReport.page_statuses and
      # currentReport.page_count). Without these two fields in the envelope
      # endpoint response, the banner silently has no data on page reload and
      # disappears. Parity with reports_controller#format_report.
      data[:report][:page_count] = revision.page_count
      data[:report][:page_statuses] = revision.report.page_statuses
      # Stitched document-relative layout JSON for useLabelGeometry.ts / DebugPanel.tsx.
      data[:report][:pages_layout_json] = revision.report.pages_layout_json_aggregated
      # Ref file metadata for HighlightOverlay's #file:dfrev_xxx → "ref:filename"
      # citation rendering + viewer panel. Without this, page reload drops the
      # ref files and every citation reverts to raw dfrev_xxx text. Merges
      # pinned pins with ad-hoc refs (from report.inspection_context) so
      # both kinds resolve uniformly.
      rpt = revision.report
      pinned = revision.ref_files_meta
      ad_hoc = if rpt
        ctx = rpt.inspection_context || {}
        Array(ctx["ad_hoc_ref_files"]).filter_map do |entry|
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
      else
        []
      end
      seen = pinned.map { |m| m[:document_file_revision_prefix_id] }.to_set
      ad_hoc_merged = ad_hoc.reject { |m| seen.include?(m[:document_file_revision_prefix_id]) }
      ad_hoc_merged.each { |m| seen << m[:document_file_revision_prefix_id] }

      # Defensive recovery: cite-from-description fallback for reports
      # finalized before ad_hoc_ref_files was preserved in inspection_context.
      # See reports_controller#build_ref_files_meta for the same logic.
      check_cited = if rpt
        rpt.checks.flat_map { |c|
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
      else
        []
      end

      data[:report][:ref_files_meta] = pinned + ad_hoc_merged + check_cited

      # Also expose ad_hoc_ref_files separately so the Review dialog's
      # "Add note" pre-fill on re-run can distinguish user-attached refs
      # from checklist-pinned, and so ToolbarActions can label them as
      # "ref " (no rule scope).
      if rpt
        ctx2 = rpt.inspection_context || {}
        data[:report][:ad_hoc_ref_files] = Array(ctx2["ad_hoc_ref_files"]).map do |entry|
          dfrev_id = (entry["document_file_revision_id"] || entry[:document_file_revision_id]).to_s
          rev = dfrev_id.present? ? DocumentFileRevision.find_by_prefix_id(dfrev_id) : nil
          {
            document_file_revision_id: dfrev_id,
            label: (entry["label"] || entry[:label]).to_s,
            filename: rev&.name
          }
        end
      end
    end

    data
  end

  def serialize_checklist(c)
    return nil if c.nil?

    {
      id: c.prefix_id,
      name: c.name,
      rules: serialize_rules(c.rules),
      system_prompt: c.system_prompt,
      ai_model: c.ai_model,
      highlight_mode: Checklist.highlight_modes[c.highlight_mode]
    }
  end

  # Build checklist data from a report's inspection_context for API responses
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

  # Build a rule_key => prompt cache from a report's inspection_context rules
  def build_rule_prompt_cache_from_report(report)
    report.rules.each_with_object({}) do |r, h|
      key = r["id"] || r[:id]
      h[key] = r["prompt"] || r[:prompt]
    end
  end

  def serialize_rules(rules)
    return [] if rules.blank?

    rules.map do |r|
      {
        id: r[:id] || r["id"],
        prompt: r[:prompt] || r["prompt"],
        order: r[:order] || r["order"],
        title: r[:title] || r["title"],
        origin: r[:origin] || r["origin"],
        source_envelope_revision_id: r[:source_envelope_revision_id] || r["source_envelope_revision_id"],
        source_rule_id: r[:source_rule_id] || r["source_rule_id"],
        created_at: r[:created_at] || r["created_at"]
      }.compact
    end
  end

  def format_document_file(document_file)
    data = change_id_to_prefix_in_object(document_file)
    data[:document_file_revisions] = document_file.document_file_revisions.map do |revision|
      revision_data = change_id_to_prefix_in_object(revision)
      revision_data[:has_data] = revision.file.attached?
      revision_data
    end
    data
  end

  def process_file_state(new_revision, file_state)
    # Collect content_hashes of existing PRIMARY document files being included
    # in this revision. Reference files (DocumentFile.reference == true) live
    # on the envelope alongside primary docs but are tracked via RefFile pins,
    # not via EnvelopeRevision.document_file_revision_links — they must be
    # excluded from both the dedup seed AND the carry-over loop below, or
    # uploading a primary doc whose content happens to match a ref would
    # trip `DuplicateFileError` (and refs would get pulled into the revision
    # as if they were primary docs).
    existing_hashes = Set.new
    file_state.each do |fi|
      fi = fi.with_indifferent_access
      next unless fi[:document_file_id] && fi[:revision_number]
      df = @envelope.document_files.find_by_prefix_id(fi[:document_file_id])
      next if df&.reference?
      rev = df&.document_file_revisions&.find_by(revision_number: fi[:revision_number])
      existing_hashes.add(rev.content_hash) if rev&.content_hash.present?
    end

    file_state.each do |file_info|
      file_info = file_info.with_indifferent_access

      if file_info[:replacement] && file_info[:document_file_id]
        # Replacement: create a new revision for an existing document_file atomically
        document_file = @envelope.document_files.find_by_prefix_id(file_info[:document_file_id])
        # Replacing a reference file via this endpoint isn't supported — refs
        # are managed through /api/v1/files. Skip silently rather than risk
        # creating an orphaned primary-doc revision linked to a ref.
        next if document_file&.reference?
        if document_file
          file = params[:files][file_info[:file_index].to_s]
          if file
            content_hash = Digest::SHA256.hexdigest(file.read)
            file.rewind

            latest_revision = document_file.document_file_revisions.order(revision_number: :desc).first
            if latest_revision&.content_hash == content_hash
              raise DuplicateFileError, "This file is identical to the current version"
            end

            max_rev = document_file.document_file_revisions.maximum(:revision_number) || -1
            dfr = document_file.document_file_revisions.build(
              revision_number: max_rev + 1,
              mime_type: file.content_type,
              content_hash: content_hash
            )
            dfr.name = file.original_filename
            dfr.file.attach(io: file, filename: dfr.sanitized_blob_filename, content_type: file.content_type)
            dfr.save!
            new_revision.add_document_file_revision(dfr)
          end
        end
      elsif file_info[:document_file_id] && file_info[:revision_number]
        document_file = @envelope.document_files.find_by_prefix_id(file_info[:document_file_id])
        # Revisions only link PRIMARY document files. Reference files are
        # tracked via RefFile pins on the envelope_revision, not by
        # document_file_revision_links.
        next if document_file&.reference?
        if document_file
          file_revision = document_file.document_file_revisions.find_by(revision_number: file_info[:revision_number])
          new_revision.add_document_file_revision(file_revision) if file_revision
        end
      elsif file_info[:new_file]
        file = params[:files][file_info[:file_index].to_s]
        if file
          content_hash = Digest::SHA256.hexdigest(file.read)
          file.rewind

          if existing_hashes.include?(content_hash)
            raise DuplicateFileError, "A file with identical content already exists in this revision (#{file.original_filename})"
          end
          existing_hashes.add(content_hash)

          document_file = @envelope.document_files.create!
          document_file_revision = document_file.document_file_revisions.build(
            revision_number: 0,
            mime_type: file.content_type,
            content_hash: content_hash
          )
          document_file_revision.name = file.original_filename
          sanitized_name = document_file_revision.sanitized_blob_filename
          document_file_revision.file.attach(
            io: file,
            filename: sanitized_name,
            content_type: file.content_type
          )
          document_file_revision.save!
          new_revision.add_document_file_revision(document_file_revision)
        end
      end
    end
  end
end
