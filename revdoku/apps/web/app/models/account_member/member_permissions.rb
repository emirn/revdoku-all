# frozen_string_literal: true

# Interprets the JSON `permissions` payload on AccountMember.
#
# Payload shape: `{ "perm": { "role": "administrator"|"collaborator"|"owner",
#                              "scopes": [] } }`.
# One role per membership; scopes are reserved for future granular
# permissions (e.g. per-envelope delegation).
class AccountMember::MemberPermissions
  VALID_ROLES = %w[owner administrator collaborator].freeze
  DEFAULT_ROLE = "collaborator"

  def initialize(raw)
    @raw = raw.is_a?(Hash) ? raw : {}
  end

  def role
    inner = @raw["perm"] || @raw[:perm] || {}
    candidate = inner["role"] || inner[:role]
    VALID_ROLES.include?(candidate) ? candidate : DEFAULT_ROLE
  end

  def scopes
    inner = @raw["perm"] || @raw[:perm] || {}
    Array(inner["scopes"] || inner[:scopes])
  end

  def administrator?
    role == "administrator"
  end

  def collaborator?
    role == "collaborator"
  end

  def owner?
    role == "owner"
  end

  def to_h
    { "perm" => { "role" => role, "scopes" => scopes } }
  end
end
