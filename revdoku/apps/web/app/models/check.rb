# frozen_string_literal: true

class Check < AccountRecord
  has_prefix_id :chk

  # Encrypt fields that may contain PHI (HIPAA compliance)
  # Uses per-account encryption key (Lockbox)
  include AccountEncryptable
  include UserTrackable

  has_encrypted :description, key: :lockbox_encryption_key
  has_encrypted :data, key: :lockbox_encryption_key

  belongs_to :account
  belongs_to :report, optional: true
  belongs_to :checklist, optional: true

  validates :passed, inclusion: { in: [true, false] }
  validates :description, presence: true
  validates :rule_key, presence: true

  # Source of the check - distinguishes AI-generated from manually added checks
  enum :source, {
    ai: 0,
    user: 1
  }, default: :ai

  before_validation :set_account_from_report, on: :create
  before_save :sanitize_description_position

  # Derive rule_prompt from the report's inspection_context (single source of truth).
  # Accepts optional prebuilt cache to avoid N+1 queries and repeated array scans.
  def rule_prompt(prompt_cache = nil)
    if prompt_cache
      return prompt_cache[rule_key]
    end
    rules = report&.rules || []
    rule = rules.find { |r| (r["id"] || r[:id]) == rule_key }
    rule && (rule["prompt"] || rule[:prompt])
  end

  # Build a rule_key => prompt lookup hash from a report's inspection_context rules.
  # Call once per report, then pass to as_json via rule_prompt_cache option.
  def self.build_rule_prompt_cache(report_or_checklist)
    # Accept either a Report (preferred) or a Checklist (legacy/transition)
    rules = if report_or_checklist.is_a?(Report)
      report_or_checklist.rules
    elsif report_or_checklist.respond_to?(:rules)
      report_or_checklist.rules
    else
      []
    end
    return {} unless rules
    rules.each_with_object({}) do |r, h|
      key = r[:id] || r["id"]
      h[key] = r[:prompt] || r["prompt"]
    end
  end

  def as_json(options = {})
    base = super(options)
    base["description"] = description # Lockbox virtual attr not included by super
    base["rule_id"] = base["rule_key"]
    base["check_index"] = check_index
    base["rule_prompt"] = rule_prompt(options[:rule_prompt_cache])
    base["description_position"] = description_position_json.present? ? JSON.parse(description_position_json) : nil
    base["created_by_name"] = created_by&.to_s
    base["data"] = data.present? ? JSON.parse(data) : nil
    base.except("description_ciphertext", "description_position_json", "data_ciphertext")
  end

  private

  def set_account_from_report
    self.account ||= report&.account || report&.envelope_revision&.envelope&.account
  end

  # Strip stale keys (position, mode, arrow) from description_position_json — only `box` is needed.
  def sanitize_description_position
    return unless description_position_json.present?
    parsed = JSON.parse(description_position_json)
    return unless parsed.is_a?(Hash)
    cleaned = parsed.slice("box")
    self.description_position_json = cleaned.to_json if cleaned != parsed
  rescue JSON::ParserError
    # Leave malformed JSON as-is
  end
end
