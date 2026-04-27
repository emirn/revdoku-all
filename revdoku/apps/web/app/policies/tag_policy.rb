# frozen_string_literal: true

class TagPolicy < ApplicationPolicy
  def index?
    account_member?
  end

  def create?
    account_member?
  end

  def update?
    account_owns_tag? && account_member?
  end

  def destroy?
    account_owns_tag? && account_member?
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

  def account_owns_tag?
    record.account_id == Principal.account&.id
  end
end
