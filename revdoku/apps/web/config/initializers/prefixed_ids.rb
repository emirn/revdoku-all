# frozen_string_literal: true

# config/initializers/prefixed_ids.rb
salt = ENV["PREFIX_ID_SALT"]

# In development, use a fallback salt if not set
if salt.blank? && Rails.env.development?
  salt = "development_prefix_id_salt_for_local_use_only"
end

# During Docker builds (SECRET_KEY_BASE_DUMMY is set), use a dummy salt
# This allows asset precompilation without credentials
if salt.blank? && ENV["SECRET_KEY_BASE_DUMMY"].present?
  salt = "docker_build_dummy_salt_not_for_production"
end

if salt.blank?
  raise "PREFIX_ID_SALT environment variable is not set"
end

PrefixedIds.salt = salt

# Define object prefixes we use for records
RECORD_PREFIXES = {
  "Envelope" => "env",
  "Report" => "rep",
  "Check" => "chk",
  "Checklist" => "clst",
  "ChecklistRule" => "clrl",
  "EnvelopeRule" => "evrl",
  "User" => "user",
  "Plan" => "plan",
  "EnvelopeRevision" => "envrv",
  "DocumentFile" => "df",
  "DocumentFileRevision" => "dfrev",
  "Account" => "acct",
  "ApiKey" => "atkn",
  "AuditLog" => "log",
  "Internal" => "internal"
}.freeze
