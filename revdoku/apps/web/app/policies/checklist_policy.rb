# frozen_string_literal: true

class ChecklistPolicy < ApplicationPolicy
  def index?
    account_member?
  end

  def show?
    account_owns_checklist? || public_checklist?
  end

  def create?
    account_member?
  end

  def update?
    account_owns_checklist? && account_admin?
  end

  def destroy?
    account_owns_checklist? && account_admin?
  end

  def generate?
    account_member?
  end

  def versions?
    account_owns_checklist?
  end

  def rollback?
    account_owns_checklist? && account_admin?
  end

  def add_rules?
    account_owns_checklist? && account_member?
  end

  def remove_rules?
    account_owns_checklist? && account_member?
  end

  def update_rules?
    account_owns_checklist? && account_member?
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      if user.nil? || Principal.account.nil?
        scope.none
      else
        # Return checklists owned by current account
        scope.where(account: Principal.account)
      end
    end
  end

  private

  def account_owns_checklist?
    record.account_id == Principal.account&.id
  end

  def public_checklist?
    # For future: public/shared checklists
    false
  end
end
