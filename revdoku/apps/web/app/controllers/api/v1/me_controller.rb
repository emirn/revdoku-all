# frozen_string_literal: true

class Api::V1::MeController < Api::BaseController
  skip_after_action :verify_authorized # Read-only self data, no resource authorization needed

  # GET /api/v1/me
  def show
    user_data = {
      id: current_user.prefix_id,
      email: current_user.email,
      first_name: current_user.first_name,
      last_name: current_user.last_name,
      name: current_user.name,
      two_factor_enabled: current_user.two_factor_enabled?,
      current_account: current_account ? {
        id: current_account.prefix_id,
        name: current_account.name,
        personal: current_account.personal?,
        primary_color: current_account.primary_color
      } : nil,
      accounts: current_user.memberships.includes(:account).map do |m|
        {
          id: m.account.prefix_id,
          name: m.account.name,
          personal: m.account.personal?,
          primary_color: m.account.primary_color,
          role: m.account.owner?(current_user) ? "owner" : m.role,
          members_count: m.account.users.count
        }
      end
    }

    render_api_success({ user: user_data })
  end
end
