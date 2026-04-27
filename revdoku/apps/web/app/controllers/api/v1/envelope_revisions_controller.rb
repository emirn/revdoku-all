# frozen_string_literal: true

class Api::V1::EnvelopeRevisionsController < Api::BaseController
  include EnvelopeArchivable

  before_action :set_envelope_revision
  before_action :ensure_envelope_not_archived!

  # GET /api/v1/envelope_revisions/:id/all_revision_rules
  # Returns revision_rules from all revisions up to this one
  def all_revision_rules
    authorize @envelope, :show?
    render_api_success({ revision_rules: @envelope_revision.all_revision_rules })
  end

  # POST /api/v1/envelope_revisions/:id/add_revision_rules
  # Add custom rules to this revision
  def add_revision_rules
    authorize @envelope, :update?

    rules = params[:rules]
    unless rules.is_a?(Array) && rules.any?
      return render_api_bad_request("At least one rule is required")
    end
    if rules.length > 50
      return render_api_bad_request("Maximum 50 rules per request")
    end

    rules_data = rules.filter_map do |rule_params|
      prompt = rule_params[:prompt].to_s.strip
      next if prompt.blank?
      { prompt: prompt, created_by_id: current_user.id }
    end

    @envelope_revision.add_revision_rules_batch(rules_data) if rules_data.any?

    render_api_success({ envelope_revision: @envelope_revision.as_json })
  end

  # POST /api/v1/envelope_revisions/:id/update_revision_rules
  # Update custom rules on this revision
  def update_revision_rules
    authorize @envelope, :update?

    rules_params = params[:rules]
    unless rules_params.is_a?(Array) && rules_params.any?
      return render_api_bad_request("At least one rule is required")
    end

    updates = rules_params.index_by { |r| r[:id].to_s }
    updated = @envelope_revision.revision_rules.map do |r|
      rule_id = (r[:id] || r["id"]).to_s
      if updates[rule_id]
        r.merge("prompt" => updates[rule_id][:prompt].to_s)
      else
        r
      end
    end
    @envelope_revision.update!(revision_rules: updated)

    render_api_success({ envelope_revision: @envelope_revision.as_json })
  end

  # POST /api/v1/envelope_revisions/:id/remove_revision_rules
  # Remove custom rules from this revision
  def remove_revision_rules
    authorize @envelope, :update?

    rule_ids = params[:rule_ids]
    unless rule_ids.is_a?(Array) && rule_ids.any?
      return render_api_bad_request("At least one rule_id is required")
    end

    ids_to_remove = rule_ids.map(&:to_s).to_set

    # Guard: prevent deleting rules that have inspection checks
    report = @envelope_revision.report
    if report
      rules_with_checks = report.checks.where(rule_key: ids_to_remove.to_a).pluck(:rule_key).uniq
      if rules_with_checks.any?
        return render_api_error(
          "Cannot delete rules that have inspection results. Remove the checks first.",
          status: :unprocessable_entity,
          code: "RULES_HAVE_CHECKS",
          details: [{ field: "rule_ids", message: rules_with_checks.join(", ") }]
        )
      end
    end

    updated = @envelope_revision.revision_rules.reject { |r| ids_to_remove.include?((r[:id] || r["id"]).to_s) }
    @envelope_revision.update!(revision_rules: updated)

    render_api_success({ envelope_revision: @envelope_revision.as_json })
  end

  private

  def set_envelope_revision
    @envelope_revision = EnvelopeRevision.find_by_prefix_id(params[:id])
    return render_api_not_found("EnvelopeRevision") unless @envelope_revision

    @envelope = @envelope_revision.envelope
  end
end
