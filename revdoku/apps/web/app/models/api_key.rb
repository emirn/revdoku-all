# frozen_string_literal: true

class ApiKey < ApplicationRecord
  # Fallback TTLs when no account context is available (e.g. keys without metadata).
  # Authoritative values live in Account::SECURITY_SETTINGS per level.
  FALLBACK_SESSION_TTL = 15.minutes
  API_TTL = 10.years
  FALLBACK_IDLE_TIMEOUT = 10.minutes

  include UserAgentParseable

  has_prefix_id :atok

  belongs_to :user

  enum :token_type, { api: 0, session: 1 }
  enum :status, { usable: 0, lapsed: 1, revoked: 2 }
  enum :scope, { read_only: 0, inspect_and_annotate: 1, full_account_access: 2 }, prefix: :scope
  enum :rate_limit_tier, { standard: 0, elevated: 1, unlimited: 2 }, prefix: :rate

  has_encrypted :token

  validates :label, presence: true
  validates :token, presence: true
  validates :expires_at, presence: true

  before_validation :generate_token, if: -> { token.blank? }, on: :create
  before_validation :set_default_expiration, on: :create
  before_save :compute_secret_hash, if: :token_ciphertext_changed?

  scope :usable_and_live, -> { where(status: :usable).where("expires_at > ?", Time.current) }
  scope :lapsed_or_past_expiry, -> { where("status = ? OR expires_at <= ?", statuses[:lapsed], Time.current) }
  scope :sessions, -> { where(token_type: :session) }
  scope :api_keys_only, -> { where(token_type: :api) }
  scope :for_account, ->(account_id) { where("json_extract(metadata, '$.account_id') = ?", account_id) }

  # Block-based resolver. Yields the key on a successful match, returns the
  # block's value; otherwise returns nil. Callers express the success path
  # explicitly inside the block rather than reading a nilable return value.
  def self.resolve(raw_secret)
    hash = Revdoku::Crypto::KeyHasher.digest(raw_secret)
    record = usable_and_live.find_by(secret_hash: hash)
    return nil unless record
    block_given? ? yield(record) : record
  end

  def expired?
    expires_at <= Time.current
  end

  def near_expiry?(threshold = 5.minutes)
    expires_at <= threshold.from_now
  end

  def idle?
    session? && last_authenticated_at.present? && last_authenticated_at < idle_timeout_duration.ago
  end

  def idle_timeout_duration
    # Prefer metadata (avoids DB lookup) — falls back to account or default
    timeout_seconds = metadata&.dig("idle_timeout_seconds")
    return timeout_seconds.seconds if timeout_seconds.present?

    account = resolve_account
    account ? account.idle_timeout : FALLBACK_IDLE_TIMEOUT
  end

  def mark_authenticated!
    return if last_authenticated_at && last_authenticated_at > 5.minutes.ago
    update_column(:last_authenticated_at, Time.current)
  end

  def masked_hint
    return "revdoku_..." unless secret_hash.present?
    "revdoku_...#{secret_hash.last(8)}"
  end

  def revoke!
    update!(status: :revoked, expires_at: Time.current)
    Rails.cache.delete("auth_token:#{secret_hash}")
  end

  def permits?(action)
    case action.to_sym
    when :read
      true
    when :write, :inspect
      scope_inspect_and_annotate? || scope_full_account_access?
    when :admin
      scope_full_account_access?
    else
      false
    end
  end

  def self.record_device_info!(key, request)
    key.update!(
      ip_address: request.remote_ip,
      user_agent_raw: request.user_agent&.truncate(500),
      device_info: parse_user_agent(request.user_agent)
    )
  end

  private

  def generate_token
    self.token = api? ? "revdoku_#{SecureRandom.base58(36)}" : SecureRandom.base58(24)
  end

  def resolve_account
    @resolved_account ||= begin
      account_prefix = metadata&.dig("account_id")
      return nil unless account_prefix.present?
      Account.find_by_prefix_id(account_prefix)
    end
  end

  def compute_secret_hash
    self.secret_hash = Revdoku::Crypto::KeyHasher.digest(token)
  end

  def set_default_expiration
    return if expires_at.present?

    self.expires_at = session? ? FALLBACK_SESSION_TTL.from_now : API_TTL.from_now
  end
end
