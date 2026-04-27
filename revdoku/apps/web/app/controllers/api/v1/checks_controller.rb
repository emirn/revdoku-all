# frozen_string_literal: true

class Api::V1::ChecksController < Api::BaseController
  include EnvelopeArchivable
  before_action :set_report, only: [:create]
  before_action :set_check, only: [:update, :destroy]
  before_action :authorize_report_access, only: [:create]
  before_action :authorize_check, only: [:update, :destroy]
  before_action :ensure_envelope_not_archived!, only: [:create, :update, :destroy]
  before_action :ensure_report_not_processing!, only: [:create, :update, :destroy]

  # POST /api/v1/reports/:report_id/checks
  # Creates a manual check with either:
  # - Flow A: new_rule_text provided -> creates new rule in checklist, then creates check
  # - Flow B: rule_id provided -> uses existing rule from checklist, creates check
  def create
    rule_id = params.dig(:check, :rule_id)
    new_rule_text = params.dig(:check, :new_rule_text)
    description = params.dig(:check, :description)

    # Determine which flow to use
    if rule_id.present?
      # Flow B: Use existing rule
      existing_rule = find_rule_in_report(rule_id)
      if existing_rule.nil?
        return render_api_error("Rule not found in report", status: :not_found)
      end
      rule_key = existing_rule["id"] || existing_rule[:id]
    else
      # Flow A: Create new rule
      # Use new_rule_text if provided, fall back to legacy rule_prompt, then message-based default
      rule_text = new_rule_text.presence ||
                  params.dig(:check, :rule_prompt).presence ||
                  "MUST HAVE: opposite of \"#{description}\""

      # Write to revision as source of truth
      envelope_revision = @report.envelope_revision
      new_rule = envelope_revision.add_revision_rule(
        prompt: rule_text,
        created_by_id: current_user.id
      )
      rule_key = new_rule[:id] || new_rule["id"]

      # Also add the rule to inspection_context so it appears in the report's rule list
      add_rule_to_inspection_context(@report, {
        id: rule_key,
        prompt: rule_text,
        origin: "user",
        created_by_id: current_user.id,
        source_envelope_revision_id: envelope_revision.prefix_id
      })
    end

    # Now create the check referencing the rule
    @check = @report.checks.build(check_params_for_create)
    @check.account = @report.account
    @check.source = :user
    @check.rule_key = rule_key

    # Assign next sequential check_index for unique badge numbering
    max_check_index = @report.checks.maximum(:check_index) || 0
    @check.check_index = max_check_index + 1

    authorize @check, :create?

    if @check.save
      @report.touch
      # Return check, report, and updated checklist
      render_api_created({
        check: change_id_to_prefix_in_object(@check),
        report: report_json(@report.reload),
        checklist: build_checklist_from_inspection_context(@report.reload)
      })
    else
      render_api_validation_error(@check)
    end
  end

  # PUT /api/v1/checks/:id
  def update
    rule_key_changing = check_params[:rule_key].present? && check_params[:rule_key] != @check.rule_key

    # If editing rule_prompt without changing rule_key, update the rule in inspection_context
    # (Only for user-created rules that the user owns)
    if !rule_key_changing && params.dig(:check, :rule_prompt).present?
      update_rule_in_inspection_context(@check, params[:check])
    end

    # Promote AI check to user source when meaningfully modified.
    # This preserves the check (with its index) on re-inspection.
    if @check.ai?
      meaningful_fields = %w[passed description page rule_key]
      meaningful_change = meaningful_fields.any? do |field|
        check_params.key?(field) && check_params[field].to_s != @check.send(field).to_s
      end
      @check.source = :user if meaningful_change
    end

    if @check.update(check_params)
      @check.report.touch
      render_api_success({
        check: change_id_to_prefix_in_object(@check),
        report: report_json(@check.report.reload)
      })
    else
      render_api_validation_error(@check)
    end
  end

  # DELETE /api/v1/checks/:id
  def destroy
    # Optionally remove the rule from checklist if it's a user-added rule
    # For now, we keep the rule but delete the check
    # This allows the rule to be re-evaluated in future inspections
    @check.destroy
    render_api_no_content
  end

  private

  def set_report
    @report = policy_scope(Report).find_by_prefix_id(params[:report_id])
    render_api_not_found("Report") unless @report
  end

  def set_check
    @check = policy_scope(Check).find_by_prefix_id(params[:id])
    render_api_not_found("Check") unless @check
  end

  def authorize_report_access
    authorize @report, :show?
  end

  def authorize_check
    authorize @check
  end

  def check_params
    permitted = params.require(:check).permit(:passed, :description, :rule_key, :page, :x1, :y1, :x2, :y2, :title)
    # Convert nested description_position to JSON string for storage
    if params.dig(:check, :description_position).present?
      permitted[:description_position_json] = params[:check][:description_position].to_json
    end
    # Merge data JSON — update individual keys, preserve existing ones
    if params.dig(:check, :data).present?
      existing_data = @check&.data.present? ? (JSON.parse(@check.data) rescue {}) : {}
      new_data = params[:check][:data].to_unsafe_h
      permitted[:data] = existing_data.merge(new_data).to_json
    end
    permitted
  end

  # Parameters for creating a check (excludes rule_id and new_rule_text which are handled separately)
  def check_params_for_create
    params.require(:check).permit(:passed, :description, :page, :x1, :y1, :x2, :y2, :title)
  end

  # Find a rule in the report's inspection_context by ID
  def find_rule_in_report(rule_id)
    @report.rules.find do |rule|
      (rule["id"] || rule[:id]) == rule_id
    end
  end

  def update_rule_in_inspection_context(check, params)
    return unless check.user? # Only update rules for user-created checks

    ctx = check.report.inspection_context
    return unless ctx && ctx["checklist"] && ctx["checklist"]["rules"]

    updated_rules = ctx["checklist"]["rules"].map do |rule|
      if (rule["id"] || rule[:id]) == check.rule_key
        rule = rule.deep_dup
        rule["prompt"] = params[:rule_prompt] || params[:description] if params[:rule_prompt] || params[:description]
      end
      rule
    end
    ctx["checklist"]["rules"] = updated_rules
    check.report.update!(inspection_context: ctx)
  end

  # Add a new rule to the report's inspection_context
  def add_rule_to_inspection_context(report, rule_hash)
    ctx = report.inspection_context || {}
    ctx["checklist"] ||= { "rules" => [] }
    ctx["checklist"]["rules"] ||= []

    next_order = ctx["checklist"]["rules"].length
    new_rule = rule_hash.stringify_keys
    new_rule["order"] = next_order

    ctx["checklist"]["rules"] << new_rule
    report.update!(inspection_context: ctx)
  end

  # Build checklist data from inspection_context for API responses
  def build_checklist_from_inspection_context(report)
    ctx = report.inspection_context
    return nil unless ctx
    checklist_data = ctx["checklist"]
    return nil unless checklist_data

    {
      id: checklist_data["id"],
      name: checklist_data["name"],
      rules: checklist_data["rules"] || [],
      system_prompt: checklist_data["system_prompt"],
      ai_model: checklist_data["ai_model"],
      highlight_mode: checklist_data["highlight_mode"],
      track_changes: checklist_data["track_changes"]
    }
  end

  def report_json(rep)
    cache = build_rule_prompt_cache_from_report(rep)
    {
      report: change_id_to_prefix_in_object(rep).merge(
        checks: rep.checks.map { |c| change_id_to_prefix_in_object(c, json_options: { rule_prompt_cache: cache }) },
        checklist: build_checklist_from_inspection_context(rep)
      )
    }
  end

  def build_rule_prompt_cache_from_report(report)
    report.rules.each_with_object({}) do |r, h|
      key = r["id"] || r[:id]
      h[key] = r["prompt"] || r[:prompt]
    end
  end

  # Override base class path-based extraction to capture envelope_id
  # for check routes (e.g., POST /api/v1/reports/:id/checks, PATCH /api/v1/checks/:id)
  # which don't include /envelopes/env_xxx in the path.
  def extract_envelope_id_from_path
    report = @report || @check&.report
    report&.envelope_revision&.envelope&.prefix_id || super
  end

  # Server-side companion to the frontend's `isEditingDisabled` guard.
  # While a report's inspection job is running (pending or processing),
  # reject mutations so a stale client or direct API caller cannot race
  # against the background job. The client UI already disables all edit
  # surfaces during this window — this is the defence-in-depth layer.
  def ensure_report_not_processing!
    report = @report || @check&.report
    return unless report
    return unless report.job_status_pending? || report.job_status_processing?

    render_api_error(
      "Cannot modify checks while a review is running",
      status: :conflict,
      code: "REPORT_IN_PROGRESS"
    )
  end
end
