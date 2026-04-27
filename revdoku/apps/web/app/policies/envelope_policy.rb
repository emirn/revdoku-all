# frozen_string_literal: true

class EnvelopePolicy < ApplicationPolicy
  def index?
    account_member?
  end

  def show?
    account_owns_envelope?
  end

  def create?
    account_member?
  end

  def update?
    account_owns_envelope?
  end

  def destroy?
    account_owns_envelope? && account_admin?
  end

  def create_revision?
    account_owns_envelope?
  end

  def update_document_files?
    account_owns_envelope?
  end

  def create_report?
    account_owns_envelope?
  end

  def rollback?
    account_owns_envelope?
  end

  def archive?
    account_owns_envelope?
  end

  def unarchive?
    account_owns_envelope?
  end

  def toggle_star?
    account_owns_envelope?
  end

  def duplicate?
    account_owns_envelope?
  end

  def bulk_action?
    account_member?
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      if user.nil?
        scope.none
      else
        # Only return envelopes from current account
        scope.where(account: Principal.account)
      end
    end
  end

  private

  def account_owns_envelope?
    record.account_id == Principal.account&.id
  end
end
