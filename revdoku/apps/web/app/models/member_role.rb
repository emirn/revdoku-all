# frozen_string_literal: true

# Encapsulates role and permission predicates for the current principal.
# Decouples decision logic from the request-scoped identity carrier
# (Principal), so policies/controllers depend on this class rather than on
# accessors defined on the CurrentAttributes subclass.
class MemberRole
  def initialize(user: Principal.user, account: Principal.account, account_member: Principal.account_member)
    @user = user
    @account = account
    @account_member = account_member
  end

  attr_reader :user, :account, :account_member

  def administrator?
    return false if @account_member.blank?
    @account_member.administrator? || @account_member.owner?
  end

  def owner?
    return false unless @user && @account
    @account.owner?(@user)
  end

  def member_present?
    @account_member.present?
  end
end
