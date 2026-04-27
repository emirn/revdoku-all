# frozen_string_literal: true

class Checklist < AccountRecord
  include AccountEncryptable
  include UserTrackable
  include UniqueNaming

  has_prefix_id :clst

  has_encrypted :name, key: :lockbox_encryption_key
  has_encrypted :system_prompt, key: :lockbox_encryption_key
  has_encrypted :rules, key: :lockbox_encryption_key, type: :json
  has_encrypted :source_text, key: :lockbox_encryption_key
  has_encrypted :user_scripts, key: :lockbox_encryption_key, type: :json

  # Normalization module prepended AFTER has_encrypted so it wraps Lockbox's rules= setter.
  # MRO: RulesNormalization#rules= → Lockbox's rules= (encrypts) → AR attribute write
  module RulesNormalization
    # Ensure rules is always an Array
    def rules
      value = super
      value.is_a?(Array) ? value : []
    end

    # Assign rules with normalization (order, id)
    def rules=(arr)
      incoming = Array(arr)

      # If this is a new record without prefix_id, just store the rules as-is
      if new_record? && prefix_id.blank?
        super(incoming)
        return
      end

      # Compute max numeric suffix across existing + incoming ids
      existing = rules
      max_seq = [existing, incoming].flatten.compact.map { |r|
        rid = r.is_a?(Hash) ? (r[:id] || r["id"]) : nil
        extract_rule_seq(rid)
      }.compact.max
      max_seq = max_seq.nil? ? 0 : max_seq + 1

      parent_prefix = prefix_id

      normalized = incoming.each_with_index.map do |rule, idx|
        r = rule.is_a?(Hash) ? rule.deep_dup : rule.as_json
        r = r.to_h.symbolize_keys
        if r[:id].blank?
          r[:id] = "#{parent_prefix}_rule_#{max_seq}"
          max_seq += 1
        end
        r[:order] = idx if r[:order].nil?
        r
      end
      super(normalized)
    end
  end
  prepend RulesNormalization

  belongs_to :account

  # Highlight mode controls how highlights are rendered on the document viewer
  enum :highlight_mode, {
    rectangle: 0,  # Traditional rectangle border around detected area (default, good for documents)
    dot: 1,        # Connector line to center of highlight area with a small dot (good for photos)
    underline: 2,  # Subtle line under the detected area (good for text-heavy documents)
    bracket: 3     # Corner-only markers like selection handles (minimal, professional)
  }, default: :rectangle, prefix: true

  # Scopes
  scope :templates, -> { all }

  validates :name, presence: true
  # 20 KB is enough for the longest bundled templates (the Invoice Detailed
  # Review + Group by Category prompts are ~5 KB today) plus headroom for
  # user-authored prompts that pull in many structured rules. 2000 was the
  # old cap and rejected our own default-template seed on fresh installs.
  validates :system_prompt, length: { maximum: 20_000 }, allow_blank: true
  validates :source_text, length: { maximum: 500_000 }, allow_blank: true
  validate :validate_rules_format
  validate :validate_rule_file_markers

  attr_accessor :pending_rules

  before_validation :set_default_ai_model
  before_create :store_and_clear_rules_for_creation
  after_create :assign_rules_with_prefix
  after_create :set_initial_revision_number
  before_update :increment_revision_number
  # Add a manual rule to this checklist
  def add_manual_rule(prompt:, created_by_id: nil, source_envelope_revision_id: nil)
    next_order = rules.length
    next_seq = (rules.map { |r| extract_rule_seq(r[:id] || r["id"]) }.compact.max || -1) + 1

    new_rule = {
      id: "#{prefix_id}_rule_#{next_seq}",
      prompt: prompt,
      order: next_order,
      origin: "user",
      created_by_id: created_by_id,
      source_envelope_revision_id: source_envelope_revision_id
    }.compact

    updated_rules = rules + [new_rule]
    update!(rules: updated_rules)

    new_rule
  end

  def as_json(options = {})
    base = super(options)
    base["name"] = name
    base["rules"] = rules
    base["system_prompt"] = system_prompt
    base["ai_model"] = ai_model
    base["highlight_mode"] = Checklist.highlight_modes[highlight_mode]
    base["source_text"] = source_text
    base["user_scripts"] = user_scripts if user_scripts.present?
    base.except("name_ciphertext", "system_prompt_ciphertext", "rules_ciphertext", "source_text_ciphertext", "user_scripts_ciphertext")
  end

  def store_and_clear_rules_for_creation
    current_rules = rules
    if current_rules.present? && current_rules.any?
      @pending_rules = current_rules
      self.rules = []
    end
  end

  def assign_rules_with_prefix
    if @pending_rules.present?
      self.rules = @pending_rules
      @pending_rules = nil
      save!(validate: false)
    end
  end

  def self.ransackable_attributes(auth_object = nil)
    %w[created_at]
  end

  private

  def set_initial_revision_number
    update_column(:revision_number, 1)
  end

  def set_default_ai_model
    self.ai_model = AiModelResolver.default_model_id(:inspection) if ai_model.blank?
  end

  def increment_revision_number
    self.revision_number = (revision_number || 0) + 1
  end

  def extract_rule_seq(rule_id)
    return nil unless rule_id.is_a?(String)
    if rule_id =~ /_rule_(\d+)\z/
      $1.to_i
    end
  end

  def validate_rules_format
    return if new_record?
    return if rules.blank?

    expected_prefix = prefix_id.presence || "unknown_checklist"

    rules.each_with_index do |rule, index|
      rule_hash = rule.is_a?(Hash) ? rule : rule.as_json
      rule_hash = rule_hash.symbolize_keys

      rule_id = rule_hash[:id]
      if rule_id.blank?
        errors.add(:rules, "Rule #{index + 1}: ID cannot be empty")
        next
      end

      unless rule_id.match(/^#{Regexp.escape(expected_prefix)}_rule_\d+$/)
        errors.add(:rules, "Rule #{index + 1}: ID must follow format '#{expected_prefix}_rule_{number}'")
      end

      prompt = rule_hash[:prompt]
      if prompt.blank?
        errors.add(:rules, "Rule #{index + 1}: Prompt cannot be empty")
      end
    end
  end

  # Enforces the v1 cap of at most one `#ref[...]` marker per rule and
  # checks that every explicit `#ref[file:<prefix_id>]` resolves to an
  # account-library DocumentFile / DocumentFileRevision the current
  # account owns.
  def validate_rule_file_markers
    return if new_record?
    return if rules.blank?

    rules.each_with_index do |rule, index|
      rule_hash = rule.is_a?(Hash) ? rule : rule.as_json
      prompt = rule_hash.symbolize_keys[:prompt].to_s
      markers = RuleFileResolver.scan_markers(prompt)
      next if markers.empty?

      # Multiple markers per rule are supported — each gets resolved to its
      # own pin by the controller using array-index-as-position. Only the
      # explicit library-bound markers (`file:<prefix_id>`) are validated
      # here; `#ref[...]` (deferred) markers pick their file at review time.
      markers.each do |marker|
        next if marker[:kind] == :deferred
        result = RuleFileResolver.find_library_revision_for_marker(marker, account: account)
        if result.nil?
          errors.add(:rules, "Rule #{index + 1}: references #{marker[:prefix_id]}, which is not in this account's file library")
        end
      end
    end
  end
end
