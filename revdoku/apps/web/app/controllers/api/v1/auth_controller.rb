# frozen_string_literal: true

class Api::V1::AuthController < Api::BaseController
  skip_after_action :verify_authorized # Auth key refresh, access controlled by key auth

  # POST /api/v1/auth/refresh
  # Refreshes the session key for the frontend
  def refresh
    unless @api_key.session?
      render_api_error("Only session keys can be refreshed", status: :forbidden)
      return
    end

    # Create a new session key
    new_key = current_user.api_keys.create!(
      label: "Frontend Session",
      token_type: :session,
      expires_at: current_account.session_ttl.from_now,
      metadata: (@api_key.metadata || {}).merge("account_id" => current_account&.prefix_id, "idle_timeout_seconds" => current_account.idle_timeout.to_i)
    )

    # Update the cookie
    cookies.signed[:revdoku_api_key] = {
      value: new_key.token,
      expires: new_key.expires_at,
      httponly: true,
      secure: !Rails.env.development?,
      same_site: :lax
    }

    # Delete the old key
    @api_key.destroy

    render_api_success({ refreshed: true })
  end
end
