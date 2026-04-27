# frozen_string_literal: true

class DuplicateEnvelopeService
  attr_reader :source_envelope, :new_envelope, :current_user, :copy_mode

  def initialize(source_envelope, current_user:, copy_mode: :all_revisions, include_manual_checks: true)
    @source_envelope = source_envelope
    @current_user = current_user
    @copy_mode = copy_mode # :latest_only or :all_revisions
    @include_manual_checks = include_manual_checks
    @new_envelope = nil
    @file_id_map = {} # maps source document_file.id → new DocumentFile
  end

  def call
    # Validation checks
    return validation_error if validation_failed?

    # Wrap in transaction for atomicity
    ActiveRecord::Base.transaction do
      @new_envelope = duplicate_envelope_record
      duplicate_document_files
      duplicate_revisions
      duplicate_reports
    end

    { success: true, envelope: @new_envelope }
  rescue => e
    Rails.logger.error "DuplicateEnvelopeService error: #{e.message}\n#{e.backtrace.join("\n")}"
    { success: false, message: e.message }
  end

  private

  def validation_failed?
    @validation_error.present?
  end

  def validation_error
    if source_envelope.account.encryption_key_shredded?
      @validation_error = { success: false, message: "Cannot duplicate: account encryption key shredded" }
    elsif !source_envelope.account.allows_envelope_creation?
      @validation_error = { success: false, message: "Envelope limit reached (#{source_envelope.account.max_envelopes}). Contact support to increase your limit." }
    end
    @validation_error
  end

  def duplicate_envelope_record
    new_title = generate_copy_title(source_envelope.title)
    settings = source_envelope.report_settings&.dup || {}

    # Preserve last checklist hint so the duplicate pre-selects the same checklist
    source_report = source_envelope.latest_report
    if source_report
      checklist_id = source_report.inspection_checklist_id
      settings["last_checklist_id"] = checklist_id if checklist_id
    end

    Envelope.create!(
      account: source_envelope.account,
      title: new_title,
      status: source_envelope.status,
      source: source_envelope.source,
      report_settings: settings,
      starred: source_envelope.starred,
      created_by: current_user,
      updated_by: current_user,
      # Reset fields
      archived_at: nil
    )
  end

  def generate_copy_title(original_title)
    "Copy of #{original_title.presence || 'Untitled'}"
  end

  def duplicate_document_files
    source_envelope.document_files.each do |source_file|
      new_file = DocumentFile.create!(
        envelope: new_envelope,
        created_by: current_user,
        updated_by: current_user
      )
      @file_id_map[source_file.id] = new_file

      # Copy all file revisions
      source_file.document_file_revisions.each do |source_revision|
        # Account will be auto-set from document_file via before_validation callback
        new_file_revision = DocumentFileRevision.new(
          document_file: new_file,
          revision_number: source_revision.revision_number,
          name: source_revision.name,
          mime_type: source_revision.mime_type,
          size: source_revision.size,
          content_hash: source_revision.content_hash,
          metadata: source_revision.metadata&.dup,
          pages_layout_json: source_revision.read_attribute(:pages_layout_json),
          created_by: current_user,
          updated_by: current_user
        )
        # Copy encrypted page_texts (same account key, so raw copy would work,
        # but going through the attribute is safer if the key ever changes).
        new_file_revision.page_texts = source_revision.page_texts if source_revision.page_texts.present?

        # Save first to get an ID for ActiveStorage
        new_file_revision.save!

        # Copy ActiveStorage attachments after saving
        copy_file_attachment(source_revision, new_file_revision, :file)
        copy_file_attachment(source_revision, new_file_revision, :rendered_pages_cache)
      end
    end
  end

  def duplicate_revisions
    revisions_to_copy = if copy_mode == :latest_only
      [source_envelope.envelope_revisions.order(:revision_number).last].compact
    else
      source_envelope.envelope_revisions.order(:revision_number)
    end

    revisions_to_copy.each_with_index do |source_revision, index|
      # For latest_only mode, always use revision_number 0
      # For all_revisions mode, preserve original revision numbers
      target_revision_number = copy_mode == :latest_only ? 0 : source_revision.revision_number

      new_revision = EnvelopeRevision.create!(
        envelope: new_envelope,
        revision_number: target_revision_number,
        created_by: current_user,
        updated_by: current_user
      )

      # Copy HABTM associations to document file revisions
      copy_revision_file_associations(source_revision, new_revision)
    end
  end

  def copy_revision_file_associations(source_revision, new_revision)
    source_revision.document_file_revisions.each do |source_file_revision|
      source_file = source_file_revision.document_file
      new_file = @file_id_map[source_file.id]

      if new_file
        new_file_revision = new_file.document_file_revisions.find_by(
          revision_number: source_file_revision.revision_number
        )

        if new_file_revision
          new_revision.add_document_file_revision(new_file_revision)
        else
          Rails.logger.warn "Could not find matching file revision for file #{source_file.prefix_id} rev #{source_file_revision.revision_number}"
        end
      else
        Rails.logger.warn "Could not find matching document file for source #{source_file.prefix_id}"
      end
    end
  end

  def duplicate_reports
    revisions_to_copy = if copy_mode == :latest_only
      [source_envelope.envelope_revisions.order(:revision_number).last].compact
    else
      source_envelope.envelope_revisions.order(:revision_number)
    end

    revisions_to_copy.each do |source_revision|
      source_report = source_revision.report
      next unless source_report

      new_revision = if copy_mode == :latest_only
        new_envelope.envelope_revisions.first
      else
        new_envelope.envelope_revisions.find_by(revision_number: source_revision.revision_number)
      end
      next unless new_revision

      # Copy inspection_context from source report (if present).
      # If not including manual checks, filter out user-origin rules from the context.
      source_ctx = source_report.inspection_context&.deep_dup
      if source_ctx && !@include_manual_checks
        rules = source_ctx.dig("checklist", "rules")
        if rules.is_a?(Array)
          source_ctx["checklist"]["rules"] = rules.reject { |r| (r["origin"] || r[:origin]) == "user" }
        end
      end

      # Create a stub report in reset state — signals "needs inspection"
      new_report = Report.create!(
        envelope_revision: new_revision,
        account: new_envelope.account,
        job_status: :reset,
        ai_model: source_report.ai_model,
        inspection_context: source_ctx
      )

      copy_manual_checks(source_report, new_report) if @include_manual_checks
    end
  end

  def copy_manual_checks(source_report, new_report)
    # Rule keys are preserved as-is (no snapshot ID remapping needed)
    source_report.checks.where(source: :user).find_each do |source_check|
      Check.create!(
        report: new_report,
        account: new_report.account,
        rule_key: source_check.rule_key,
        description: source_check.description,
        passed: source_check.passed,
        source: :user,
        page: source_check.page,
        x1: source_check.x1, y1: source_check.y1,
        x2: source_check.x2, y2: source_check.y2,
        check_index: source_check.check_index,
        description_position_json: source_check.description_position_json
      )
    end
  end

  def copy_file_attachment(source_revision, new_revision, attachment_name)
    source_attachment = source_revision.public_send(attachment_name)
    return unless source_attachment.attached?

    begin
      blob = source_attachment.blob
      # CRITICAL: Use attachment.download (decrypted by Lockbox)
      # NOT blob.download (returns raw encrypted bytes → double-encryption)
      decrypted_content = source_attachment.download
      new_revision.public_send(attachment_name).attach(
        io: StringIO.new(decrypted_content),
        filename: blob.filename,
        content_type: blob.content_type
      )
    rescue ActiveStorage::FileNotFoundError => e
      Rails.logger.warn "Skipping missing blob for #{attachment_name}: #{e.message}"
    rescue => e
      Rails.logger.error "Error copying #{attachment_name}: #{e.message}"
      raise
    end
  end
end
