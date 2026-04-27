# frozen_string_literal: true

# Service to create default checklists for new accounts.
# Reads from ChecklistTemplate DB records flagged with
# default_for_new_account: true — an admin-managed flag set per-template.
class DefaultChecklistLoader
  class << self
    # No rescue: any failure here (missing template dir, parser crash,
    # stale bytecode) should surface to the caller's error path. Returning
    # [] on exception silently skipped the per-account checklist seed
    # without leaving any operator-visible signal.
    def load_templates
      ChecklistTemplate.ensure_catalog_seeded!
      ChecklistTemplate
        .where(visible: true, default_for_new_account: true)
        .sorted
        .map do |t|
          {
            name: t.name,
            system_prompt: t.system_prompt,
            rules: (t.rules || []).map(&:symbolize_keys),
            user_scripts: (t.user_scripts || [])
          }
        end
    end

    # Create default checklists for an account
    # @param account [Account] The account to create checklists for
    # @return [Array<Checklist>] Array of created checklists
    def create_for_account(account)
      templates = load_templates
      return [] if templates.empty?

      created_checklists = []

      # Encrypted columns cannot be queried at SQL level; compare in memory
      existing_names = account.checklists.map(&:name).compact.map(&:downcase)

      templates.each do |template|
        name = template[:name]
        next if existing_names.include?(name.downcase)

        rules = (template[:rules] || []).map.with_index do |rule, idx|
          {
            prompt: rule[:prompt] || rule["prompt"],
            order: rule[:order] || rule["order"] || idx
          }
        end

        # Default checklists pin whatever Account#default_ai_model(:inspection)
        # resolves to — which consults, in order:
        #   1. any per-account override (default_checklist_model column)
        #   2. AiModelResolver.default_model_id(:inspection) → the current
        #      region's inspection default from config/ai_models.yml
        #      (shared.defaults.<region>.inspection), currently "us:standard"
        #   3. HIPAA fallback (AiModelResolver.first_hipaa_model_id) when the
        #      account is HIPAA-enabled and the region default isn't HIPAA-certified
        # So changing the default for everyone is a one-line ai_models.yml edit;
        # region and HIPAA handling come for free.
        checklist = Checklist.create!(
          account: account,
          name: name,
          system_prompt: template[:system_prompt],
          ai_model: account.default_ai_model(:inspection),
          rules: rules,
          user_scripts: template[:user_scripts] || []
        )

        created_checklists << checklist
      end

      created_checklists
    end
  end
end
