# frozen_string_literal: true

# Account-library file storage endpoints backing the reference-file feature.
#
# These endpoints manage `DocumentFile`s with `envelope_id: nil` — the
# shared "account library" of reusable reference files that rule authors
# can point to via `#ref[file:df_xxx]` markers and that reviewers can pick
# from the Review dialog.
#
# See ~/.claude/plans/bubbly-sniffing-hamming.md for the full flow.
class Api::V1::FilesController < Api::BaseController
  # All actions here operate on the account's library — access is scoped
  # to current_account in every query, so no per-resource Pundit check
  # is needed beyond the membership check Api::BaseController already
  # performs. Same pattern as AuditLogsController / AiModelsController.
  skip_after_action :verify_authorized

  before_action :set_document_file, only: [:revisions, :create_revision]

  # GET /api/v1/files
  #
  # Lists library-saved DocumentFiles for the current account, newest first.
  # Supports optional `q` filename filter and `mime` exact filter. Each row
  # carries its latest revision metadata so the picker UI can render
  # filename + size + uploaded_at + revision_number without a second call.
  def index
    files = DocumentFile.library.where(account_id: current_account.id)
    files = files.joins(:document_file_revisions)
      .distinct
      .order(created_at: :desc)

    if params[:mime].present?
      files = files.where(document_file_revisions: { mime_type: params[:mime] })
    end

    results = files.map do |df|
      latest = df.document_file_revisions.order(revision_number: :desc).first
      next unless latest

      # Client-side filename filter on the decrypted revision name — we
      # cannot push this into SQL because `name` is encrypted.
      if params[:q].present?
        next unless latest.name.to_s.downcase.include?(params[:q].to_s.downcase)
      end

      format_file(df, latest)
    end.compact

    render_api_success({ files: results })
  end

  # POST /api/v1/files
  #
  # Uploads a new reference file. Creates a DocumentFile(envelope_id: nil)
  # and its first DocumentFileRevision. `save_in_library` is a boolean
  # flag: `true` promotes it to the library (browsable, reusable via
  # `#ref[file:df_xxx]`); `false` (default) creates an ephemeral file which can
  # only be referenced by passing its dfrev_prefix_id back in the
  # `ref_files` payload on POST /reports.
  #
  # The frontend polls the returned revision's `ready` flag for PDF
  # uploads that need async normalization.
  def create
    unless params[:file].present?
      return render_api_bad_request("file parameter is required")
    end

    upload = params[:file]
    mime_type = upload.content_type.to_s

    unless DocumentFileRevision::REFERENCE_ALLOWED_MIME_TYPES.include?(mime_type)
      return render_api_error(
        "unsupported mime type #{mime_type}",
        status: :unprocessable_entity,
        code: "UNSUPPORTED_MIME"
      )
    end

    if upload.size > DocumentFileRevision::REFERENCE_MAX_FILE_BYTES
      return render_api_error(
        "file size exceeds the reference file limit of #{(DocumentFileRevision::REFERENCE_MAX_FILE_BYTES / 1.megabyte.to_f).round(1)}MB",
        status: :unprocessable_entity,
        code: "FILE_TOO_LARGE"
      )
    end

    # Reference files are ALWAYS saved to the envelope first. The
    # "Save to Library" flag is stored on the RefFile pin and
    # acted upon AFTER the review completes — the normalized file is
    # then copied from the envelope to the account library. This keeps
    # the envelope self-contained and avoids orphaned account-scoped files.
    #
    # When no envelope_id is provided (e.g. uploading to the Files page
    # directly), the file goes to the account library.
    target_envelope = nil
    if params[:envelope_id].present?
      target_envelope = policy_scope(Envelope).find_by_prefix_id(params[:envelope_id])
      return render_api_not_found("Envelope") unless target_envelope
    end

    document_file = nil
    revision = nil

    ActiveRecord::Base.transaction do
      document_file = DocumentFile.create!(
        account: current_account,
        envelope: target_envelope, # nil = library upload; envelope = review upload
        reference: true
      )

      revision = DocumentFileRevision.new(
        document_file: document_file,
        account: current_account,
        name: upload.original_filename.to_s,
        mime_type: mime_type,
        size: upload.size,
        revision_number: 0
      )
      revision.file.attach(
        io: upload.tempfile,
        filename: revision.sanitized_blob_filename,
        content_type: mime_type
      )
      revision.save!
    end

    NormalizeDocumentFileRevisionJob.perform_later(revision.prefix_id)

    render_api_created({
      document_file: format_file(document_file, revision),
      latest_revision: format_revision(revision)
    })
  rescue ActiveRecord::RecordInvalid => e
    render_api_validation_error(e.record)
  end

  # GET /api/v1/files/revisions/:revision_id
  #
  # Returns the current readiness + metadata of a single
  # DocumentFileRevision by its prefix_id. Polled by the Review dialog
  # after the user clicks Run Review — we upload each picked file, then
  # loop on this endpoint until `ready: true` before proceeding to
  # create the Report. Keeps the OCR/normalize work async on the server
  # side while giving the frontend a tight progress signal.
  def revision_status
    revision = DocumentFileRevision
      .joins(:document_file)
      .where(document_files: { account_id: current_account.id, envelope_id: nil })
      .find_by_prefix_id(params[:revision_id])

    return render_api_not_found("Revision") unless revision

    render_api_success({
      revision: format_revision(revision)
    })
  end

  # GET /api/v1/files/revisions/:revision_id/page_texts
  #
  # Returns the cached per-page text for a DocumentFileRevision owned by the
  # current account — library files (envelope_id: nil) AND envelope-scoped
  # reference files both resolve through here. Populated by
  # NormalizeDocumentFileRevisionJob when the file was first uploaded (PDF/
  # image via ai.extractPageTexts in doc-api; csv/txt via PromptSanitizer).
  # The envelope diff viewer uses this endpoint to compare the current report
  # against either an arbitrary library document or a reference file pinned
  # to some revision in the same envelope — same shape as the report's own
  # #page_texts endpoint, so the frontend feeds both through the identical
  # computePageDiffs() pipeline.
  def revision_page_texts
    revision = DocumentFileRevision
      .joins(:document_file)
      .where(document_files: { account_id: current_account.id })
      .find_by_prefix_id(params[:revision_id])

    return render_api_not_found("Revision") unless revision

    render_api_success({ page_texts: revision.page_texts || [] })
  end

  # POST /api/v1/files/copy_to_library
  #
  # Copies an envelope-scoped reference file into the account-wide
  # library. Shares the same ActiveStorage blob (no byte duplication)
  # and copies all normalized content. The original envelope file is
  # unaffected.
  def copy_to_library
    revision = DocumentFileRevision
      .joins(:document_file)
      .where(document_files: { account_id: current_account.id })
      .find_by_prefix_id(params[:document_file_revision_id])

    return render_api_not_found("Revision") unless revision

    if revision.document_file.library?
      return render_api_error("File is already in the library", status: :unprocessable_entity, code: "ALREADY_IN_LIBRARY")
    end

    lib_file = nil
    lib_rev = nil
    ActiveRecord::Base.transaction do
      lib_file = DocumentFile.create!(
        account: current_account,
        envelope: nil,
        reference: true
      )
      lib_rev = DocumentFileRevision.new(
        document_file: lib_file,
        account: current_account,
        name: params[:name].presence || revision.name,
        mime_type: revision.mime_type,
        size: revision.size,
        revision_number: 0
      )
      lib_rev.file.attach(revision.file.blob) if revision.file.attached?
      lib_rev.page_texts = revision.page_texts if revision.page_texts.present?
      lib_rev.pages_layout = revision.pages_layout if revision.pages_layout.present?
      lib_rev.rendered_pages_cache.attach(revision.rendered_pages_cache.blob) if revision.rendered_pages_cache.attached?
      lib_rev.save!
    end

    render_api_created({
      document_file: format_file(lib_file, lib_rev),
      latest_revision: format_revision(lib_rev)
    })
  rescue ActiveRecord::RecordInvalid => e
    render_api_validation_error(e.record)
  end

  # GET /api/v1/files/:id/revisions
  def revisions
    return unless @document_file

    revisions = @document_file.document_file_revisions.order(revision_number: :desc)
    render_api_success({
      revisions: revisions.map { |r| format_revision(r) }
    })
  end

  # POST /api/v1/files/:id/revisions
  #
  # Adds a new DocumentFileRevision to an existing library DocumentFile.
  # Only allowed for `library: true` files — ephemeral DocumentFiles are
  # single-revision-for-a-single-report and never gain additional revisions.
  def create_revision
    return unless @document_file

    unless @document_file.library?
      return render_api_error(
        "revisions can only be added to library files",
        status: :unprocessable_entity,
        code: "NOT_A_LIBRARY_FILE"
      )
    end

    unless params[:file].present?
      return render_api_bad_request("file parameter is required")
    end

    upload = params[:file]
    mime_type = upload.content_type.to_s

    unless DocumentFileRevision::REFERENCE_ALLOWED_MIME_TYPES.include?(mime_type)
      return render_api_error("unsupported mime type #{mime_type}", status: :unprocessable_entity, code: "UNSUPPORTED_MIME")
    end

    if upload.size > DocumentFileRevision::REFERENCE_MAX_FILE_BYTES
      return render_api_error("file too large", status: :unprocessable_entity, code: "FILE_TOO_LARGE")
    end

    next_number = (@document_file.document_file_revisions.maximum(:revision_number) || -1) + 1

    revision = DocumentFileRevision.new(
      document_file: @document_file,
      account: current_account,
      name: upload.original_filename.to_s,
      mime_type: mime_type,
      size: upload.size,
      revision_number: next_number
    )
    revision.file.attach(
      io: upload.tempfile,
      filename: revision.sanitized_blob_filename,
      content_type: mime_type
    )
    revision.save!

    NormalizeDocumentFileRevisionJob.perform_later(revision.prefix_id)

    render_api_created({
      revision: format_revision(revision)
    })
  rescue ActiveRecord::RecordInvalid => e
    render_api_validation_error(e.record)
  end

  # DELETE /api/v1/files/:id
  #
  # Removes a library DocumentFile and cascades to its revisions (and the
  # attached ActiveStorage blobs via `dependent: :destroy`). The
  # DocumentFile#before_destroy guard (`guard_referenced_by_ref_files`)
  # blocks the delete when the file is currently pinned to any envelope
  # revision — in that case we surface a 422 so the UI can tell the user
  # to drop the referencing revisions first.
  def destroy
    file = DocumentFile.library.where(account_id: current_account.id).find_by_prefix_id(params[:id])
    return render_api_not_found("File") unless file

    if file.destroy
      render_api_success({ deleted: true, prefix_id: file.prefix_id })
    else
      render_api_error(
        file.errors[:base].first || "Cannot delete file",
        status: :unprocessable_entity,
        code: "LIBRARY_FILE_IN_USE"
      )
    end
  end

  private

  def set_document_file
    @document_file = DocumentFile.library.where(account_id: current_account.id).find_by_prefix_id(params[:id])
    render_api_not_found("File") unless @document_file
  end

  def format_file(document_file, latest_revision)
    {
      prefix_id: document_file.prefix_id,
      library: document_file.library?,
      latest_revision: latest_revision ? format_revision(latest_revision) : nil
    }
  end

  def format_revision(revision)
    {
      prefix_id: revision.prefix_id,
      revision_number: revision.revision_number,
      name: revision.name,
      mime_type: revision.mime_type,
      byte_size: revision.file_size,
      ready: revision.ready?,
      uploaded_at: revision.created_at.iso8601
    }
  end
end
