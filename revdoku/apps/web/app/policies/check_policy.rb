# frozen_string_literal: true

class CheckPolicy < ApplicationPolicy
  def index?
    can_view_checks?
  end

  def show?
    can_view_checks?
  end

  def create?
    can_add_checks?
  end

  def update?
    can_edit_checks?
  end

  def destroy?
    can_delete_checks?
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      if user.nil? || Principal.account.nil?
        scope.none
      else
        scope.where(account: Principal.account)
      end
    end
  end

  private

  def envelope
    @envelope ||= record.report&.envelope_revision&.envelope
  end

  def can_view_checks?
    return false unless envelope

    # Account members can view
    return true if record.account_id == Principal.account&.id

    # Check envelope permissions
    envelope.can_view_report?(user)
  end

  def can_add_checks?
    return false unless envelope

    # Account members can add manual checks
    return true if envelope.account_id == Principal.account&.id

    # Check envelope permissions
    envelope.can_add_manual_checks?(user)
  end

  def can_edit_checks?
    return false unless envelope
    return false unless latest_revision?  # Only allow editing on latest revision

    # Account members can edit
    return true if envelope.account_id == Principal.account&.id

    # Check envelope permissions
    envelope.can_add_manual_checks?(user)
  end

  def latest_revision?
    revision = record.report&.envelope_revision
    return false unless revision

    latest = envelope.envelope_revisions.order(revision_number: :desc).first
    revision.id == latest&.id
  end

  def can_delete_checks?
    # Only user-created checks can be deleted
    return false unless record.user?
    return false unless envelope

    # Must be creator or have permission
    return true if record.created_by_id == user.id
    return true if envelope.account_id == Principal.account&.id && account_admin?

    envelope.can_add_manual_checks?(user)
  end
end
