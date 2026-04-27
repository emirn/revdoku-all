# frozen_string_literal: true

class Api::V1::DocumentFilesController < Api::BaseController
  include EnvelopeArchivable

  before_action :set_envelope
  before_action :set_document_file, only: [:destroy]
  before_action :ensure_envelope_not_archived!, only: [:destroy]

  # GET /api/v1/envelopes/:envelope_id/document_files
  def index
    authorize @envelope, :show?

    document_files = @envelope.document_files.includes(:document_file_revisions)

    document_files_data = document_files.map do |document_file|
      format_document_file(document_file)
    end

    render_api_success({ document_files: document_files_data })
  end

  # DELETE /api/v1/document_files/:id
  def destroy
    authorize @envelope, :update_document_files?

    # Only allow file deletion from the latest revision
    latest_revision = @envelope.envelope_revisions.order(revision_number: :desc).first
    if latest_revision
      earlier_revisions = @envelope.envelope_revisions.where.not(id: latest_revision.id)
      if @document_file.document_file_revisions.joins(:envelope_revisions)
          .where(envelope_revisions: { id: earlier_revisions.select(:id) }).exists?
        return render_api_error(
          "Cannot delete files used in earlier revisions. Only files from the latest revision can be removed.",
          status: :unprocessable_entity,
          code: "FILE_IN_EARLIER_REVISION"
        )
      end
    end

    @document_file.destroy

    render_api_no_content
  end

  private

  def set_envelope
    if params[:envelope_id]
      @envelope = policy_scope(Envelope).find_by_prefix_id(params[:envelope_id])
    elsif params[:id]
      # Standalone route (DELETE /document_files/:id) — resolve envelope through document_file
      doc_file = DocumentFile.joins(:envelope)
        .where(envelopes: { account_id: current_account.id })
        .find_by_prefix_id(params[:id])
      @envelope = doc_file&.envelope
    end
    render_api_not_found("Envelope") unless @envelope
  end

  def set_document_file
    @document_file = @envelope.document_files.find_by_prefix_id(params[:id])
    render_api_not_found("Document file") unless @document_file
  end

  def format_document_file(document_file)
    data = change_id_to_prefix_in_object(document_file)
    data[:document_file_revisions] = document_file.document_file_revisions.map do |revision|
      format_document_file_revision(revision)
    end
    data
  end

  def format_document_file_revision(revision)
    data = change_id_to_prefix_in_object(revision)
    data[:has_data] = revision.file.attached?
    data
  end
end
