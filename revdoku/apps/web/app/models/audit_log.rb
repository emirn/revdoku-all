# frozen_string_literal: true

class AuditLog < AuditRecord
  # NOTE: has_prefix_id removed — audit logs are never looked up by prefix_id.
  # They are queried by user_id, account_id, envelope_id, created_at range.
  # Removing it eliminates UUID generation + unique index check on every INSERT.

  # --- Lockbox encryption for sensitive audit fields ---
  has_encrypted :ip, key: :lockbox_encryption_key
  has_encrypted :user_agent, key: :lockbox_encryption_key
  has_encrypted :request, key: :lockbox_encryption_key, type: :json
  has_encrypted :response, key: :lockbox_encryption_key, type: :json

  enum :source_type, {
    INTERNAL: 0,
    API: 1,
    WEB: 2,
    ADMIN: 3
  }

  validates :path, presence: true
  validates :response_code, inclusion: { in: 100..599 }
  validates :source_type, presence: true, inclusion: { in: source_types.keys }

  # Essential scopes for HIPAA compliance reporting
  scope :failed_attempts, -> { where(response_code: 400..599) }
  scope :for_user, ->(user) { where(user_id: user.prefix_id) }
  scope :for_envelope, ->(envelope_id) { where(envelope_id: envelope_id) }
  scope :for_resource, ->(resource_id) { where(envelope_id: resource_id).or(where("path LIKE ?", "%#{resource_id}%")) }
  scope :in_date_range, ->(start_date, end_date) { where(created_at: start_date..end_date) }
  scope :for_account, ->(account) { where(account_id: account.prefix_id) }
  scope :recent, ->(days = 30) { where(created_at: days.days.ago..Time.current) }

  # Immutability enforced by SQLite triggers (BEFORE UPDATE, BEFORE DELETE).
  # See config/initializers/sqlite_config.rb for trigger creation.
  # No Rails callbacks needed — triggers provide stronger, database-level protection
  # that cannot be bypassed by raw SQL.

  def self.immutability_configured?
    # SQLite trigger detection (note: SQLite has no TRUNCATE, so only update/delete triggers)
    connection.execute(<<~SQL).to_a.any?
      SELECT 1 FROM sqlite_master
      WHERE type = 'trigger'
      AND tbl_name = 'audit_logs'
      AND name IN ('audit_logs_no_update', 'audit_logs_no_delete')
    SQL
  rescue
    false
  end

  # Encryption-key resolver: one Lockbox-master-derived key for the whole
  # audit_logs table.
  def lockbox_encryption_key
    Lockbox.attribute_key(table: "audit_logs", attribute: "master_fallback")
  end

  class << self
    def ransackable_attributes(auth_object = nil)
      ["account_id", "created_at", "duration", "envelope_id", "id", "id_value", "path", "prefix_id", "request_id", "response_code", "source_type", "updated_at", "user_id"]
    end

    def ransackable_associations(auth_object = nil)
      []
    end
  end
end
