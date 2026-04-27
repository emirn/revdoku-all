# frozen_string_literal: true

class Api::V1::EnvelopeTagsController < Api::BaseController
  before_action :set_envelope

  # POST /api/v1/envelopes/:envelope_id/tags
  # Assign tags: { tag_ids: ["tag_xxx", "tag_yyy"] }
  def create
    authorize @envelope, :update?

    tag_ids = params[:tag_ids] || []
    tag_ids.each do |tag_id|
      tag = current_account.tags.find_by_prefix_id(tag_id)
      next unless tag
      EnvelopeTag.find_or_create_by!(envelope: @envelope, tag: tag)
    end

    render_api_success({ tags: format_envelope_tags })
  end

  # DELETE /api/v1/envelopes/:envelope_id/tags/:id
  def destroy
    authorize @envelope, :update?

    tag = current_account.tags.find_by_prefix_id!(params[:id])
    envelope_tag = @envelope.envelope_tags.find_by(tag: tag)
    envelope_tag&.destroy!

    render_api_success({ tags: format_envelope_tags })
  end

  private

  def set_envelope
    @envelope = current_account.envelopes.find_by_prefix_id!(params[:envelope_id])
  end

  def format_envelope_tags
    @envelope.tags.reload.ordered.map do |tag|
      { id: tag.prefix_id, name: tag.name, color: tag.color, position: tag.position }
    end
  end
end
