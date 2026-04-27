# frozen_string_literal: true

class Api::V1::TagsController < Api::BaseController
  before_action :set_tag, only: [:update, :destroy]
  before_action :authorize_tag, only: [:update, :destroy]

  # GET /api/v1/tags
  def index
    authorize Tag
    tags = policy_scope(Tag).ordered.to_a

    # Batch-compute full paths and parent prefix IDs in memory (zero extra queries)
    full_paths = Tag.compute_full_paths(tags)
    parent_prefix_map = tags.each_with_object({}) { |t, h| h[t.id] = t.prefix_id }

    tags_data = tags.map { |tag| format_tag(tag, full_paths: full_paths, parent_prefix_map: parent_prefix_map) }

    render_api_success({ tags: tags_data })
  end

  # POST /api/v1/tags
  def create
    authorize Tag
    tag = current_account.tags.new(tag_params)
    tag.position = (current_account.tags.maximum(:position) || -1) + 1 unless params[:tag][:position]

    resolve_parent_tag_id!(tag)
    tag.save!

    render_api_created({ tag: format_tag(tag) })
  end

  # PUT /api/v1/tags/:id
  def update
    resolve_parent_tag_id!(@tag)
    @tag.update!(tag_params)

    render_api_success({ tag: format_tag(@tag) })
  end

  # DELETE /api/v1/tags/:id
  def destroy
    # Collect all affected IDs in memory before destroying (avoids double traversal)
    all_tags = current_account.tags.to_a
    descendant_ids = Tag.descendant_ids_from_collection(all_tags, @tag.id)
    all_affected_ids = Set.new([@tag.id] + descendant_ids)
    deleted_prefix_ids = all_tags.select { |t| all_affected_ids.include?(t.id) }.map(&:prefix_id)

    @tag.destroy!
    render_api_success({ message: "Tag deleted", deleted_ids: deleted_prefix_ids })
  end

  private

  def set_tag
    @tag = current_account.tags.find_by_prefix_id!(params[:id])
  end

  def authorize_tag
    authorize @tag
  end

  def tag_params
    params.require(:tag).permit(:name, :color, :position)
  end

  # Resolves a parent_id prefix_id from params into a real parent_tag_id on the model.
  # Handles null/blank (set to nil = root) and prefix_id strings (decode to integer id).
  def resolve_parent_tag_id!(tag)
    return unless params[:tag]&.key?(:parent_id)

    parent_prefix_id = params[:tag][:parent_id]
    if parent_prefix_id.blank?
      tag.parent_tag_id = nil
    else
      parent = current_account.tags.find_by_prefix_id!(parent_prefix_id)
      tag.parent_tag_id = parent.id
    end
  end

  def format_tag(tag, full_paths: nil, parent_prefix_map: nil)
    {
      id: tag.prefix_id,
      name: tag.name,
      color: tag.color,
      position: tag.position,
      auto_source: tag.auto_source,
      parent_id: parent_prefix_map ? parent_prefix_map[tag.parent_tag_id] : tag.parent_tag&.prefix_id,
      full_path: full_paths ? full_paths[tag.id] : tag.full_path,
      created_at: tag.created_at&.iso8601,
      updated_at: tag.updated_at&.iso8601
    }
  end
end
