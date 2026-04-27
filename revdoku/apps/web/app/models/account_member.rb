# frozen_string_literal: true

class AccountMember < ApplicationRecord
  belongs_to :account
  belongs_to :user

  validates :user_id, uniqueness: { scope: :account_id }

  scope :with_role, ->(role) {
    where("json_extract(permissions, '$.perm.role') = ?", role.to_s)
  }
  scope :sorted, -> { includes(:user).order("users.last_name ASC") }

  # Thin wrapper around the JSON `permissions` column.
  def permissions_object
    @permissions_object ||= MemberPermissions.new(attributes["permissions"])
  end

  def role
    permissions_object.role
  end

  def role=(new_role)
    candidate = new_role.to_s
    raise ArgumentError, "Unknown role: #{new_role.inspect}" unless MemberPermissions::VALID_ROLES.include?(candidate)
    merged = permissions_object.to_h.merge("perm" => permissions_object.to_h["perm"].merge("role" => candidate))
    self.permissions = merged
    @permissions_object = nil
  end

  def administrator?
    permissions_object.administrator?
  end

  def collaborator?
    permissions_object.collaborator?
  end

  def owner?
    permissions_object.owner?
  end

  # Revdoku-specific: a member scoped to a single envelope has restricted access
  # (reserved for commercial delegated-review roles).
  def scoped_to_envelope?(envelope)
    return false unless scoped_to_envelope_id
    scoped_to_envelope_id == envelope&.id
  end

  def may_administer_members?
    administrator? || owner?
  end

  def may_initiate_join_requests?
    account.owner?(user)
  end

  def dischargeable?
    !account.owner?(user)
  end
end
