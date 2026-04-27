# frozen_string_literal: true

class ReportPolicy < ApplicationPolicy
  def show?
    can_view_report?
  end

  def create?
    can_run_report?
  end

  def update?
    can_run_report?
  end

  def export?
    can_export?
  end

  def status?
    can_view_report?
  end

  def page_texts?
    can_view_report?
  end

  def reset?
    can_run_report?
  end

  def cancel?
    can_run_report?
  end

  def resume?
    can_run_report?
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
    @envelope ||= record.envelope_revision&.envelope
  end

  def can_view_report?
    return false unless envelope

    # Account members can view reports from their account
    return true if record.account_id == Principal.account&.id

    # Check envelope-level permissions
    envelope.can_view_report?(user)
  end

  def can_run_report?
    return false unless envelope

    # Account members can run reports
    return true if envelope.account_id == Principal.account&.id

    # Check envelope-level permissions
    envelope.can_run_report?(user)
  end

  def can_export?
    return false unless envelope

    # Account members can export
    return true if record.account_id == Principal.account&.id

    # Check envelope-level permissions
    envelope.can_export?(user)
  end
end
