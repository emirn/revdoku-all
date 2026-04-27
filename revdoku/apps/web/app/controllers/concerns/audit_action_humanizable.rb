# frozen_string_literal: true

# Shared YAML-driven action humanization for audit logs.
# Matches API paths + HTTP methods to human-readable descriptions
# defined in config/audit_action_descriptions.yml.
#
# Used by:
# - AuditLogsController (audit page Activity view)
# - ReportsController (exported report Activity Log section)
module AuditActionHumanizable
  extend ActiveSupport::Concern

  AUDIT_ACTION_DESCRIPTIONS = begin
    yaml = YAML.load_file(Rails.root.join("config/audit_action_descriptions.yml"))
    {
      actions: (yaml["actions"] || []).map { |a|
        pattern = "\\A" + Regexp.escape(a["path"]).gsub("\\*", "[^/]+") + "\\z"
        a.merge("regex" => Regexp.new(pattern))
      },
      fallback_verbs: yaml["fallback_verbs"] || {}
    }
  rescue => e
    Rails.logger.error("Failed to load audit_action_descriptions.yml: #{e.message}")
    { actions: [], fallback_verbs: { "GET" => "Viewed", "POST" => "Created", "PUT" => "Updated", "PATCH" => "Updated", "DELETE" => "Deleted" } }
  end

  private

  # Returns just the human-readable description string (e.g., "Ran review").
  # Used in contexts that need a flat label (e.g., report export).
  def humanize_action_label(log, request_data = nil)
    humanize_action_structured(log, request_data)[:description]
  end

  # Returns structured hash with :description, :model_type, :envelope_id.
  # Does NOT include :detail (use interpolate_detail separately if needed).
  def humanize_action_structured(log, request_data = nil)
    method = request_data.is_a?(Hash) ? request_data.dig("method") : "GET"
    path = log.path.to_s

    # Optional response_code narrowing. YAML entries MAY include an
    # integer `response_code` (or a `response_codes` array) — used for
    # paths where the same method produces meaningfully different
    # outcomes by status. Entries with no response_code match any
    # status, so existing rules are backward compatible. Specific
    # entries must be ordered before wildcards in YAML since `find`
    # returns the first match.
    response_code = log.response_code.to_i
    match = AUDIT_ACTION_DESCRIPTIONS[:actions].find { |a|
      next false unless a["method"] == method && a["regex"].match?(path)
      if a["response_codes"].is_a?(Array)
        a["response_codes"].map(&:to_i).include?(response_code)
      elsif a["response_code"]
        a["response_code"].to_i == response_code
      else
        true
      end
    }

    if match
      {
        description: match["description"],
        detail_template: match["detail"],
        model_type: match["model_type"],
        envelope_id: log.envelope_id
      }
    else
      after_prefix = path.split("api/v1/").last || ""
      parts = after_prefix.split("/").reject { |s| s.empty? }

      resource_name = parts.first
      fallback_model = resource_name&.singularize

      last = parts.last
      sub_action = (parts.length > 1 && last != resource_name && !last.match?(/\d/)) ? last : nil

      resource = (resource_name || "resource").singularize.humanize.downcase

      verb = if sub_action.present?
        sub_action.humanize
      else
        AUDIT_ACTION_DESCRIPTIONS[:fallback_verbs][method] || method
      end

      {
        description: "#{verb} #{resource}",
        detail_template: nil,
        model_type: fallback_model,
        envelope_id: log.envelope_id
      }
    end
  end
end
