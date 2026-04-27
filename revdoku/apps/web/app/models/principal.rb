# frozen_string_literal: true

# Identity carrier for the authenticated entity making the current request.
# Holds only identity/session data — role and permission predicates live in
# MemberRole so this class stays free of decision logic.
class Principal < ActiveSupport::CurrentAttributes
  attribute :user, :account, :account_member,
            :correlation_id, :ip_address, :user_agent,
            :authenticated_via
end
