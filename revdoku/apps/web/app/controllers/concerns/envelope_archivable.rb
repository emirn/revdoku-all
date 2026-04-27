# frozen_string_literal: true

module EnvelopeArchivable
  extend ActiveSupport::Concern

  included do
    rescue_from EnvelopeArchivedError, with: :render_envelope_archived_error
  end

  class EnvelopeArchivedError < StandardError; end

  private

  def ensure_envelope_not_archived!
    envelope = find_envelope_for_archive_check
    return unless envelope&.archived?

    raise EnvelopeArchivedError
  end

  def find_envelope_for_archive_check
    @envelope || @report&.envelope_revision&.envelope || @check&.report&.envelope_revision&.envelope
  end

  def render_envelope_archived_error
    render_api_forbidden("Envelope is archived")
  end
end
