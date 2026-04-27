# frozen_string_literal: true

class Api::V1::DocumentFileRevisionsController < Api::BaseController
  before_action :set_document_file_revision, only: [:content]

  # GET /api/v1/document_file_revisions/:id/content
  def content
    skip_authorization
    data = @document_file_revision.to_base64

    if data.present?
      render_api_success({
        content: data,
        mime_type: @document_file_revision.mime_type,
        name: @document_file_revision.name
      })
    else
      render_api_not_found("Document content")
    end
  end

  private

  def set_document_file_revision
    # Try envelope-scoped first (joins through envelope for tenant check),
    # then account-scoped (reference files with envelope_id: nil).
    @document_file_revision = DocumentFileRevision
      .joins(document_file: :envelope)
      .where(envelopes: { account_id: current_account.id })
      .find_by_prefix_id(params[:id])

    unless @document_file_revision
      # Account-scoped reference files (DocumentFile.envelope_id is nil)
      @document_file_revision = DocumentFileRevision
        .joins(:document_file)
        .where(document_files: { account_id: current_account.id, envelope_id: nil })
        .find_by_prefix_id(params[:id])
    end

    unless @document_file_revision
      render_api_not_found("Document file revision")
      return
    end

    envelope = @document_file_revision.document_file.envelope
    if envelope && !envelope.accessible_by?(current_user)
      render_api_forbidden("You do not have access to this document")
    end
  end
end
