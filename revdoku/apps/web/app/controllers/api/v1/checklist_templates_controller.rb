# frozen_string_literal: true

# Read-only API for the global ChecklistTemplate catalog. Exposed so the
# frontend "Create checklist → start from template" picker can enumerate
# the shipped templates and pre-fill the editor with one. The catalog is
# not account-scoped — templates are global — so no tenant filtering.
# Accounts still seed their own Checklist rows on account creation from
# templates flagged `default_for_new_account`; this endpoint is the
# on-demand equivalent: the user sees every visible template here and
# picks one to start from.
class Api::V1::ChecklistTemplatesController < Api::BaseController
  skip_after_action :verify_authorized # Read-only global catalog; no Pundit policy.

  # GET /api/v1/checklist_templates
  # Returns the full catalog (all visible templates with their complete
  # content). Kept as a single payload because the catalog is small (single
  # digits); splitting into `show` for per-template fetch would just add a
  # round-trip for the picker UI.
  def index
    ChecklistTemplate.ensure_catalog_seeded!
    templates = ChecklistTemplate.visible.sorted
    render_api_success({ templates: templates.map { |t| serialize(t) } })
  end

  # GET /api/v1/checklist_templates/:id
  # `:id` is a prefix_id (ctpl_...). Fetching one template when the
  # picker lazy-loads a large template body on click. Not strictly
  # required today (index returns everything), but cheap to provide for
  # future UX where the picker shows cards and fetches full content on
  # hover/select.
  def show
    template = ChecklistTemplate.find(params[:id])
    render_api_success({ template: serialize(template) })
  end

  private

  def serialize(t)
    {
      id: t.prefix_id,
      name: t.name,
      system_prompt: t.system_prompt,
      rules: t.rules.is_a?(Array) ? t.rules : [],
      rules_count: t.rules.is_a?(Array) ? t.rules.size : 0,
      user_scripts: Array(t.user_scripts),
      default_for_new_account: t.default_for_new_account,
      updated_at: t.updated_at
    }
  end
end
