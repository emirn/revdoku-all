# frozen_string_literal: true

class Account < ApplicationRecord
  has_prefix_id :acct
  has_one_attached :avatar

  # Per-account AI provider API keys, encrypted as a single JSON blob with
  # the account's Lockbox key. Shape:
  #   {
  #     "openai"     => { "api_key" => "sk-...", "enabled" => true },
  #     "openrouter" => { "api_key" => "sk-or-...", "enabled" => true },
  #   }
  # Per-provider URL is NOT stored on the account — it lives only in the
  # predefined catalog at config/ai_models.yml so users can never point
  # doc-api at an arbitrary host. Prefer #ai_provider_key /
  # #set_ai_provider_key over writing to `ai_provider_keys` directly —
  # they normalize the hash shape and treat a missing blob as `{}`.
  has_encrypted :ai_provider_keys, type: :json

  belongs_to :owner, class_name: "User", inverse_of: :owned_accounts
  has_many :members, class_name: "AccountMember", dependent: :destroy
  has_many :users, through: :members

  # Revdoku associations
  has_many :envelopes, dependent: :destroy
  has_many :checklists, dependent: :destroy
  has_many :reports, dependent: :destroy
  has_many :checks, dependent: :destroy
  has_many :tags, dependent: :destroy
  has_many :document_files, dependent: :destroy
  has_many :document_file_revisions, dependent: :destroy
  has_many :notifications, dependent: :destroy

  # Account-scoped alias so existing callers (`Account::DEFAULT_RETENTION_DAYS`,
  # admin views, retention fallback) don't need to know about the Revdoku
  # module. Single source of truth is 00_revdoku.rb.
  DEFAULT_RETENTION_DAYS = Revdoku::AUDIT_RETENTION_DAYS_DEFAULT

  DEFAULT_LIMITS = Revdoku::DEFAULT_LIMITS

  # Security levels — low (0) is default, high (99) enables strict sessions, 2FA, full audit logging
  # "normal" is an alias for "low" (both map to 0 in the DB)
  enum :security_level, { low: 0, high: 99 }, default: :low

  # Explicit security level checks (clearer than enum-generated `high?` / `low?`)
  def security_level_high?
    high?
  end

  def security_level_low?
    low?
  end

  # Per-level security settings
  SECURITY_SETTINGS = {
    low: { session_ttl: 366.days, idle_timeout: 14.days, requires_2fa: false, full_audit_logging: false },
    high: { session_ttl: 15.minutes, idle_timeout: 10.minutes, requires_2fa: true, full_audit_logging: true },
  }.freeze

  validates :name, presence: true

  # `preferred_region` column is retained for backwards compat but no
  # longer drives resolution — the deployment locks to a single region
  # via Revdoku.default_region. AiModelResolver.effective_region is the
  # only region read site; HIPAA accounts are forced to "us" there.
  # No validation / snap needed — writes never happen via the UI anymore.

  def primary_color
    meta&.dig("primary_color")
  end

  def primary_color=(value)
    self.meta = (meta || {}).merge("primary_color" => value)
  end

  before_update :enforce_security_mode_lock

  before_create :assign_inbound_token


  scope :personal, -> { where(personal: true) }
  scope :team, -> { where(personal: false) }
  scope :sorted, -> { order(personal: :desc, name: :asc) }

  def self.ransackable_attributes(auth_object = nil)
    %w[name personal security_level hipaa_enabled created_at]
  end

  def self.ransackable_associations(auth_object = nil)
    %w[orders subscriptions]
  end

  def team?
    !personal?
  end

  def owner?(user)
    owner_id == user.id
  end

  def personal_account_for?(user)
    personal? && owner_id == user.id
  end

  # Transfer ownership to another administrator
  def transfer_ownership(new_owner)
    return false unless can_transfer?(new_owner)

    transaction do
      # Demote the outgoing owner to administrator
      outgoing_owner_membership = members.find_by(user: owner)
      outgoing_owner_membership.update!(role: :administrator)

      # Set new owner
      self.owner = new_owner
      save!

      # Promote the new owner
      incoming_owner_membership = members.find_by(user: new_owner)
      incoming_owner_membership.update!(role: :owner)
    end
  end

  def can_transfer?(new_owner)
    team? &&
      users.include?(new_owner) &&
      members.find_by(user: new_owner)&.administrator? &&
      users.count >= 2
  end

  # Credit pool helpers (#active_purchased_credits, #total_credits, #credits,
  # #paid?) live in AccountBillingEE. Core has no credits.

  # Member count for per-seat billing
  def members_count
    members.count
  end

  # Account-level safety caps (columns on accounts table)
  def user_limit
    max_team_members
  end

  def user_limit_reached?
    members_count >= max_team_members
  end

  def can_add_member?
    !user_limit_reached?
  end

  def allows_envelope_creation?
    envelopes.count < max_envelopes
  end

  def allows_revision_creation?
    total_revision_count = ActsAsTenant.without_tenant {
      EnvelopeRevision.joins(:envelope)
        .where(envelopes: { account_id: id }).count
    }
    total_revision_count < max_revisions
  end

  def allows_checklist_creation?
    checklists.templates.count < max_checklists
  end

  def max_file_size_bytes
    max_file_size_mb.megabytes
  end

  # #apply_paid_limits! and #payg_account? live in AccountBillingEE. Core
  # accounts have no plan promotion flow.

  # Storage counts for billing
  def total_page_count
    ActsAsTenant.without_tenant {
      EnvelopeRevision.joins(:envelope)
        .where(envelopes: { account_id: id })
        .sum(:page_count)
    }
  end

  def total_checklist_count
    checklists.templates.count
  end

  # Security policy helpers — all delegate to SECURITY_SETTINGS by level
  def security_settings
    SECURITY_SETTINGS[security_level.to_sym] || SECURITY_SETTINGS[:low]
  end

  def session_ttl
    security_settings[:session_ttl]
  end

  def idle_timeout
    security_settings[:idle_timeout]
  end

  def requires_2fa?
    security_settings[:requires_2fa]
  end

  def full_audit_logging?
    security_settings[:full_audit_logging]
  end


  def hipaa_enabled?
    hipaa_enabled
  end

  # #current_plan lives in AccountBillingEE; core has no plan concept.

  # Returns the account's enabled AI-provider key entry for `provider_key`,
  # or nil when the account hasn't configured one (or soft-disabled it).
  # Shape: { "api_key" => "sk-...", "enabled" => true }
  # AiModelResolver uses this as the one-call predicate that gates the
  # per-account override over the instance ENV fallback.
  def ai_provider_key(provider_key)
    return nil if provider_key.blank?
    entry = (ai_provider_keys || {})[provider_key.to_s]
    return nil unless entry.is_a?(Hash) && entry["api_key"].to_s.strip.present?
    return nil if entry["enabled"] == false
    entry
  end

  # Idempotent upsert — writes the whole hash back because Lockbox encrypts
  # the blob atomically. All kwargs are optional; unspecified fields preserve
  # their previous value so a UI that only toggles `enabled` or changes
  # `model_id` doesn't wipe the stored key, and a commercial-SaaS account
  # (no BYOK key slot) can still record its per-provider model choice.
  def set_ai_provider_key(provider_key, api_key: nil, enabled: nil, model_id: nil, base_url: nil, models: nil)
    raise ArgumentError, "provider_key required" if provider_key.blank?
    keys = ai_provider_keys.is_a?(Hash) ? ai_provider_keys.dup : {}
    prev = keys[provider_key.to_s].is_a?(Hash) ? keys[provider_key.to_s] : {}

    Rails.logger.info "[Account#set_ai_provider_key] account=#{prefix_id} provider=#{provider_key} " \
      "kw_base_url=#{base_url.inspect} kw_model_id=#{model_id.inspect} kw_models=#{models.is_a?(Array) ? "[#{models.size}]" : models.inspect} " \
      "prev_base_url=#{prev["base_url"].inspect}"

    entry = prev.dup
    entry["api_key"]  = api_key.to_s.strip unless api_key.nil?
    entry["enabled"]  = !!enabled          unless enabled.nil?
    entry["model_id"] = model_id.to_s.strip.presence unless model_id.nil?
    entry["base_url"] = base_url.to_s.strip.presence unless base_url.nil?

    # `models:` is an array of objects. Shape:
    #   [{ "alias" => "...", "model_id" => "...", "revdoku_options" => "..." }]
    # `alias` is the picker label and account-scoped identifier (validated
    # for uniqueness in AiProviderKeysController). `model_id` is the
    # upstream API model name sent verbatim to the provider SDK. Room for
    # `stars`, `description`, `credits_per_page` later without a migration.
    unless models.nil?
      entry["models"] = Array(models).filter_map do |m|
        h = m.respond_to?(:to_h) ? m.to_h.stringify_keys : (m.is_a?(Hash) ? m.stringify_keys : nil)
        next nil unless h.is_a?(Hash)
        alias_name = h["alias"].to_s.strip
        model_id = h["model_id"].to_s.strip
        next nil if alias_name.blank? || model_id.blank?
        out = { "alias" => alias_name, "model_id" => model_id }
        preset = h["revdoku_options"].to_s.strip.presence
        out["revdoku_options"] = preset if preset
        out
      end
      entry.delete("models") if entry["models"].empty?
    end

    # First write defaults to enabled: true unless the caller said otherwise.
    entry["enabled"] = true unless entry.key?("enabled")

    compacted = entry.compact
    keys[provider_key.to_s] = compacted
    Rails.logger.info "[Account#set_ai_provider_key] pre-save entry_keys=#{compacted.keys.inspect} base_url=#{compacted["base_url"].inspect} models_count=#{Array(compacted["models"]).size}"
    update!(ai_provider_keys: keys)
    reloaded_entry = reload.ai_provider_keys&.dig(provider_key.to_s) || {}
    Rails.logger.info "[Account#set_ai_provider_key] post-reload entry_keys=#{reloaded_entry.keys.inspect} base_url=#{reloaded_entry["base_url"].inspect}"
  end

  # Account's per-provider preferred model id (sub-provider segment, e.g.
  # "gpt-4.1-2025-04-14"). Returns nil when the account hasn't chosen one —
  # caller falls back to the catalog's provider-level default_model_id.
  def provider_model_id(provider_key)
    return nil if provider_key.blank?
    entry = (ai_provider_keys || {})[provider_key.to_s]
    return nil unless entry.is_a?(Hash)
    entry["model_id"].to_s.strip.presence
  end

  # Account's per-provider base_url override. Only honoured by the resolver
  # for providers flagged `custom: true` in the catalog — non-custom providers
  # ignore it so owners cannot redirect cloud-provider traffic to an
  # attacker-controlled host. Returns nil when the account hasn't set one;
  # caller falls back to the catalog's base_url (LM Studio default).
  def provider_base_url(provider_key)
    return nil if provider_key.blank?
    entry = (ai_provider_keys || {})[provider_key.to_s]
    if entry.is_a?(Hash)
      val = entry["base_url"].to_s.strip.presence
      Rails.logger.info "[Account#provider_base_url] account=#{prefix_id} provider=#{provider_key} value=#{val.inspect}"
      val
    else
      Rails.logger.info "[Account#provider_base_url] account=#{prefix_id} provider=#{provider_key} no_entry=true"
      nil
    end
  end

  # Account's user-defined custom-provider models. Returns an array of hashes
  # `[{"alias" => "...", "model_id" => "...", "revdoku_options" => "..."?}]`, or [] when none.
  # `alias` is the picker label (account-scoped identifier; uniqueness enforced
  # in AiProviderKeysController). `model_id` is the upstream API model name.
  # Non-custom providers ignore this field entirely.
  def provider_models(provider_key)
    return [] if provider_key.blank?
    entry = (ai_provider_keys || {})[provider_key.to_s]
    return [] unless entry.is_a?(Hash)
    Array(entry["models"]).select do |m|
      m.is_a?(Hash) && m["alias"].to_s.strip.present? && m["model_id"].to_s.strip.present?
    end
  end

  def remove_ai_provider_key(provider_key)
    return if provider_key.blank?
    keys = ai_provider_keys.is_a?(Hash) ? ai_provider_keys.except(provider_key.to_s) : {}
    update!(ai_provider_keys: keys)
  end

  def allows_ai_model?(ai_model)
    return true unless ai_model.present?

    # HIPAA filter — accounts with hipaa_enabled get filtered to providers
    # flagged `hipaa: true`.
    if hipaa_enabled?
      return false unless AiModelResolver.model_is_hipaa_eligible?(ai_model)
    end

    true
  end

  def default_ai_model(operation = :inspection)
    # Check account-level preference first, then fall back to system default
    stored = case operation.to_sym
             when :checklist_generation then default_checklist_generation_model
             when :inspection then default_checklist_model
             when :text_extraction then default_text_extraction_model
             else nil
             end
    # Discard stale stored preference if the model no longer exists in the new
    # catalog. Users who had an old alias ID saved (`us:standard`, etc.) will
    # land on the system default until they re-pick via the UI — per the
    # provider-centric rewrite's "no data migration" stance. Pass `self` so
    # user-defined custom-provider models survive this check.
    stored = nil if stored.present? && AiModelResolver.find_model(stored, account: self).nil?
    default_id = stored.presence || AiModelResolver.default_model_id(operation)

    if hipaa_enabled?
      unless AiModelResolver.model_is_hipaa_eligible?(default_id)
        hipaa_default = AiModelResolver.first_hipaa_model_id
        return hipaa_default if hipaa_default
      end
    end
    default_id
  end

  # Run deferred account setup (checklists, default plan, sample envelope).
  # Called after email confirmation or immediately for OAuth users.
  def complete_setup!
    return if setup_completed?

    create_default_checklists
    # Default tags (Blue / Gray / Green / etc.) are NOT auto-seeded — users
    # create their own from the Labels sidebar. `DefaultTagLoader` and the
    # `tags:seed_defaults` rake task are kept for operators who want to
    # seed an existing account explicitly, but new accounts start empty.
    assign_default_subscription_plan if respond_to?(:assign_default_subscription_plan, true)
    create_sample_envelope
    update_column(:setup_completed_at, Time.current)
  end

  def setup_completed?
    setup_completed_at.present?
  end

  # On core, accounts have no subscription plan so retention is always the
  # Revdoku-wide constant (env-overridable via REVDOKU_AUDIT_RETENTION_DAYS).
  # AccountBillingEE prepends a richer implementation that consults the plan.
  def audit_retention_days
    DEFAULT_RETENTION_DAYS
  end

  # Only exposes crypto-shred state — the column exists in both editions but
  # is only ever set by AccountKmsEE#shred_encryption_key!. In core, this
  # returns false for every account and callers (e.g. DuplicateEnvelopeService's
  # pre-flight check) become data-driven no-ops.
  def encryption_key_shredded?
    encryption_key_shredded_at.present?
  end

  private

  def assign_inbound_token
    return if inbound_token.present?
    loop do
      self.inbound_token = SecureRandom.hex(6)
      break unless Account.exists?(inbound_token: inbound_token)
    end
  end

  def enforce_security_mode_lock
    if security_level_changed?
      old_val = self.class.security_levels[security_level_was] || 0
      new_val = self.class.security_levels[security_level] || 0
      if old_val > new_val
        errors.add(:security_level, "cannot be lowered once raised")
        throw(:abort)
      end
    end
    if hipaa_enabled_changed? && !hipaa_enabled?
      errors.add(:hipaa_enabled, "cannot be disabled once enabled")
      throw(:abort)
    end
  end

  def create_default_checklists
    ActsAsTenant.without_tenant do
      DefaultChecklistLoader.create_for_account(self)
    end
  rescue => e
    Rails.logger.error("Failed to create default checklists for account #{id}: #{e.class} - #{e.message}\n#{e.backtrace.first(3).join("\n")}")
  end

  def create_sample_envelope
    ActsAsTenant.without_tenant do
      SampleEnvelopeCreator.create_for_account(self)
    end
  rescue => e
    Rails.logger.error("Failed to create sample envelope for account #{id}: #{e.class} - #{e.message}\n#{e.backtrace.first(3).join("\n")}")
  end
end
