# frozen_string_literal: true

class Api::V1::ChecklistsController < Api::BaseController

  before_action :set_checklist, only: [:show, :update, :destroy, :versions, :add_rules, :remove_rules, :update_rules, :file_suggestions]
  before_action :authorize_checklist, only: [:show, :update, :destroy, :versions, :add_rules, :remove_rules, :update_rules]

  # GET /api/v1/checklists
  # Only returns template checklists, not report snapshots
  def index
    authorize Checklist
    @checklists = policy_scope(Checklist)
      .templates
      .order(updated_at: :desc)

    checklists_data = @checklists.map do |checklist|
      data = change_id_to_prefix_in_object(checklist)
      data[:rules] = checklist.rules
      data[:rules_count] = checklist.rules.count
      data[:ref_files_required] = count_ref_file_markers(checklist)
      # checklist_type removed — all checklists are templates now
      data[:revision_number] = checklist.revision_number
      data.delete(:source_text) # Exclude large field from list response
      data
    end

    render_api_success({ checklists: checklists_data })
  end

  # GET /api/v1/checklists/:id
  def show
    checklist_data = change_id_to_prefix_in_object(@checklist)
    checklist_data[:rules] = @checklist.rules
    checklist_data[:revision_number] = @checklist.revision_number
    checklist_data[:source_text] = @checklist.source_text
    checklist_data[:ref_files_required] = count_ref_file_markers(@checklist)
    render_api_success({ checklist: checklist_data })
  end

  # POST /api/v1/checklists
  def create
    authorize Checklist

    unless current_account.allows_checklist_creation?
      return render_api_error(
        "Checklist limit reached (#{current_account.max_checklists}). Contact support to increase your limit.",
        status: :forbidden,
        code: "CHECKLIST_LIMIT_REACHED"
      )
    end

    @checklist = Checklist.new(checklist_params.merge(account: current_account))
    # All checklists are templates now (no snapshot type)
    @checklist.ai_model = @checklist.ai_model.presence || current_account.default_ai_model(:inspection)

    # Handle encrypted user_scripts separately — array of { id, code, name?, created_at? }
    if params[:checklist]&.key?(:user_scripts)
      incoming = params[:checklist][:user_scripts]
      scripts = incoming.is_a?(Array) ? incoming.map.with_index { |s, i|
        entry = { "id" => s["id"].presence || "script_#{i}", "code" => s["code"].to_s }
        entry["name"] = s["name"].to_s if s["name"].present?
        entry["created_at"] = s["created_at"].to_s if s["created_at"].present?
        entry
      } : []
      @checklist.user_scripts = scripts
    end

    if @checklist.save
      checklist_data = change_id_to_prefix_in_object(@checklist)
      checklist_data[:rules] = @checklist.rules
      # checklist_type removed — all checklists are templates now
      checklist_data[:revision_number] = @checklist.revision_number
      render_api_created({ checklist: checklist_data })
    else
      render_api_validation_error(@checklist)
    end
  end

  # PUT /api/v1/checklists/:id
  def update
    # Handle encrypted user_scripts separately — array of { id, code, name?, created_at? }
    if params[:checklist]&.key?(:user_scripts)
      incoming = params[:checklist][:user_scripts]
      scripts = incoming.is_a?(Array) ? incoming.map.with_index { |s, i|
        entry = { "id" => s["id"].presence || "script_#{i}", "code" => s["code"].to_s }
        entry["name"] = s["name"].to_s if s["name"].present?
        entry["created_at"] = s["created_at"].to_s if s["created_at"].present?
        entry
      } : []
      @checklist.user_scripts = scripts
    end

    if @checklist.update(checklist_params)
      checklist_data = change_id_to_prefix_in_object(@checklist)
      checklist_data[:rules] = @checklist.rules
      checklist_data[:revision_number] = @checklist.revision_number
      render_api_success({ checklist: checklist_data })
    else
      render_api_validation_error(@checklist)
    end
  end

  # DELETE /api/v1/checklists/:id
  def destroy
    @checklist.destroy
    render_api_no_content
  end

  # POST /api/v1/checklists/generate
  def generate
    authorize Checklist, :generate?

    unless current_account.allows_checklist_creation?
      return render_api_error(
        "Checklist limit reached (#{current_account.max_checklists}). Contact support to increase your limit.",
        status: :forbidden,
        code: "CHECKLIST_LIMIT_REACHED"
      )
    end

    source_text = params[:source_text]

    unless source_text.present?
      render_api_error("Source text is required", code: "MISSING_SOURCE")
      return
    end

    # Resolve effective model for generation
    model_id = params[:ai_model].presence || current_account.default_ai_model(:checklist_generation)

    # Enforce plan model tier and HIPAA restrictions
    unless current_account.allows_ai_model?(model_id)
      is_hipaa_block = current_account.hipaa_enabled? && !AiModelResolver.parse_alias_id(model_id)[:hipaa]
      render_api_error(
        is_hipaa_block ?
          "HIPAA compliance requires a HIPAA-certified AI model." :
          "The AI model for this checklist is not available on your plan. Upgrade to access this model.",
        status: :forbidden,
        code: is_hipaa_block ? "HIPAA_MODEL_REQUIRED" : "MODEL_NOT_AVAILABLE"
      )
      return
    end

    # Call the doc-api to generate checklist
    revdoku_doc_api_response = RevdokuDocApiClient.client.generate_checklist(
      source_text,
      system_prompt: params[:system_prompt],
      existing_rules: params[:existing_rules],
      checklist_name: params[:checklist_name],
      ai_model: model_id
    )

    if revdoku_doc_api_response[:success]

      generated_data = revdoku_doc_api_response[:checklist]

      # Create checklist from generated data
      generated_name = generated_data["name"] || "Generated Checklist"
      # doc-api currently converts the AI's highlight_mode string to a numeric
      # HighlightMode enum value (0..3) before returning it, but the raw AI
      # response is a string. Accept both shapes via .to_s so this stays robust
      # if doc-api's transformation changes. Treat BRACKET and unknown/missing
      # values as :rectangle — bracket is no longer an AI-recommended mode.
      raw_highlight_mode = generated_data["highlight_mode"].to_s
      ai_highlight_mode = case raw_highlight_mode
                          when "dot", Checklist.highlight_modes[:dot].to_s
                            :dot
                          when "underline", Checklist.highlight_modes[:underline].to_s
                            :underline
                          else
                            :rectangle
                          end

      @checklist = Checklist.new(
        account: current_account,
        name: generated_name,
        ai_model: current_account.default_ai_model(:inspection),
        highlight_mode: ai_highlight_mode,
        system_prompt: generated_data["system_prompt"],
        source_text: source_text,
        rules: (generated_data["rules"] || []).map.with_index do |rule, index|
          {
            id: "#{SecureRandom.uuid}",
            prompt: rule["prompt"] || rule["description"],
            order: rule["order"] || index
          }
        end
      )

      if @checklist.save
        # Retroactively tag the just-created credit_transactions row with
        # the checklist id (no-op when the table isn't present).
        if current_account.respond_to?(:credit_transactions)
          current_account.credit_transactions.where(reason: "generation").order(created_at: :desc).limit(1)
            .update_all(note: "Generate: #{@checklist.prefix_id}")
        end
        checklist_data = change_id_to_prefix_in_object(@checklist)
        checklist_data[:rules] = @checklist.rules
        checklist_data[:revision_number] = @checklist.revision_number
        render_api_created({ checklist: checklist_data })
      else
        render_api_validation_error(@checklist)
      end
    else
      render_api_error(revdoku_doc_api_response[:message] || "Checklist generation failed",
                       status: :unprocessable_entity,
                       code: "GENERATION_FAILED")
    end
  end

  # GET /api/v1/checklists/:id/versions
  # Version tracking is handled via API audit logs (AuditLog).
  def versions
    render_api_success({
      versions: [],
      current_revision_number: @checklist.revision_number
    })
  end

  # GET /api/v1/checklists/:id/file_suggestions
  #
  # Returns library DocumentFileRevisions that were previously pinned
  # via a RefFile for this checklist + scope (rule_id or
  # checklist-level). Drives the "Recently used" chips next to each
  # upload slot in the Review dialog.
  #
  # Params:
  #   rule_id=<id>           — rule-scoped suggestions
  #   checklist_scoped=true  — checklist-scoped suggestions (rule_id IS NULL)
  #
  # Encryption note: this endpoint never returns raw file contents — only
  # filenames and metadata, which are already encrypted at rest via
  # `has_encrypted :name` on DocumentFileRevision and surface through
  # the model decrypted for the current Lockbox context.
  def file_suggestions
    authorize @checklist, :show?
    rule_id = params[:rule_id]
    checklist_scoped = params[:checklist_scoped] == "true" || params[:checklist_scoped] == true

    if rule_id.blank? && !checklist_scoped
      return render_api_bad_request("rule_id is required (or pass checklist_scoped=true)")
    end

    scope = RefFile
      .joins(document_file_revision: :document_file)
      .where(document_files: { envelope_id: nil, reference: true })
      .where(ref_files: { account_id: current_account.id, checklist_id: @checklist.id })
    scope = checklist_scoped ? scope.where(rule_id: nil) : scope.where(rule_id: rule_id)

    # Dedup by revision id, keep the most recently used first. Cap at
    # 10 — the Review dialog shows them as inline chips and more than
    # that becomes noise.
    grouped = scope
      .select("ref_files.document_file_revision_id, MAX(ref_files.created_at) AS last_used_at")
      .group("ref_files.document_file_revision_id")
      .order("last_used_at DESC")
      .limit(10)

    revisions = DocumentFileRevision
      .where(id: grouped.map(&:document_file_revision_id))
      .index_by(&:id)

    suggestions = grouped.map { |g|
      rev = revisions[g.document_file_revision_id]
      next unless rev
      {
        document_file_revision_id: rev.prefix_id,
        name: rev.name,
        mime_type: rev.mime_type,
        byte_size: rev.file_size,
        revision_number: rev.revision_number,
        last_used_at: g.last_used_at
      }
    }.compact

    render_api_success({ suggestions: suggestions })
  end

  # POST /api/v1/checklists/:id/add_rules
  # Add rules to a checklist
  def add_rules
    rules = params[:rules]
    unless rules.is_a?(Array) && rules.any?
      return render_api_error("At least one rule is required", code: "MISSING_RULES")
    end
    if rules.length > 50
      return render_api_error("Maximum 50 rules per request", code: "TOO_MANY_RULES")
    end

    source_revision_id = params[:source_envelope_revision_id]

    rules.each do |rule_params|
      prompt = rule_params[:prompt].to_s.strip
      next if prompt.blank?

      @checklist.add_manual_rule(
        prompt: prompt,
        created_by_id: current_user.id,
        source_envelope_revision_id: source_revision_id
      )
    end

    @checklist.reload
    checklist_data = change_id_to_prefix_in_object(@checklist)
    checklist_data[:rules] = @checklist.rules
    checklist_data[:revision_number] = @checklist.revision_number
    render_api_success({ checklist: checklist_data })
  end

  # POST /api/v1/checklists/:id/update_rules
  # Update prompts/titles on user-origin rules in a checklist
  def update_rules
    rules_params = params[:rules]
    unless rules_params.is_a?(Array) && rules_params.any?
      return render_api_error("At least one rule is required", code: "MISSING_RULES")
    end

    updates = rules_params.index_by { |r| r[:id].to_s }
    updated_rules = @checklist.rules.map do |r|
      rule_id = (r[:id] || r["id"]).to_s
      origin = r[:origin] || r["origin"]
      if updates[rule_id] && origin == "user"
        r.merge("prompt" => updates[rule_id][:prompt].to_s)
      else
        r
      end
    end
    @checklist.update!(rules: updated_rules)

    checklist_data = change_id_to_prefix_in_object(@checklist)
    checklist_data[:rules] = @checklist.rules
    checklist_data[:revision_number] = @checklist.revision_number
    render_api_success({ checklist: checklist_data })
  end

  # POST /api/v1/checklists/:id/remove_rules
  # Remove user-origin rules from a checklist
  def remove_rules
    rule_ids = params[:rule_ids]
    unless rule_ids.is_a?(Array) && rule_ids.any?
      return render_api_error("At least one rule_id is required", code: "MISSING_RULE_IDS")
    end

    ids_to_remove = rule_ids.map(&:to_s).to_set

    # Guard: prevent deleting rules that have inspection checks
    report = @checklist.reports.order(:id).first
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

    updated_rules = @checklist.rules.reject { |r| ids_to_remove.include?((r[:id] || r["id"]).to_s) && (r[:origin] || r["origin"]) == "user" }
    @checklist.update!(rules: updated_rules)

    checklist_data = change_id_to_prefix_in_object(@checklist)
    checklist_data[:rules] = @checklist.rules
    checklist_data[:revision_number] = @checklist.revision_number
    render_api_success({ checklist: checklist_data })
  end

  private

  def set_checklist
    @checklist = policy_scope(Checklist).find_by_prefix_id(params[:id])
    render_api_not_found("Checklist") unless @checklist
  end

  # Total number of #ref[...] markers across all rules +
  # system_prompt. Powers the "(2 required)" badge next to checklist
  # names in the review dropdown and checklist list.
  def count_ref_file_markers(checklist)
    total = 0
    Array(checklist.rules).each do |rule|
      prompt = rule.is_a?(Hash) ? (rule[:prompt] || rule["prompt"]) : nil
      total += RuleFileResolver.scan_markers(prompt).length
    end
    total += RuleFileResolver.scan_markers(checklist.system_prompt).length
    total
  end

  def authorize_checklist
    authorize @checklist
  end

  def checklist_params
    params.require(:checklist).permit(:name, :system_prompt, :ai_model, :highlight_mode, :source_text, rules: [:id, :prompt, :order, :description])
  end

  def format_user_display(user, fallback_id = nil)
    return "System" unless user || fallback_id
    return fallback_id || "System" unless user
    if user.name.present?
      "#{user.name} <#{user.email}>"
    else
      user.email
    end
  end
end
