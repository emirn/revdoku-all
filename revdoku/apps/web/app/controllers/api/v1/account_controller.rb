# frozen_string_literal: true

class Api::V1::AccountController < Api::BaseController
  skip_after_action :verify_authorized # Account-scoped self-service endpoints, access controlled by token auth

  # GET /api/v1/account/profile
  # Returns user profile info and login history
  def profile
    high_security = current_account.security_level_high?
    login_histories = current_user.login_histories.recent.limit(5).map do |history|
      entry = {
        signed_in_at: history.signed_in_at.iso8601,
        device_summary: history.device_summary
      }
      if high_security
        entry[:ip_address] = history.ip_address
        entry[:user_agent] = truncate_user_agent(history.user_agent)
      end
      entry
    end

    render_api_success({
      profile: {
        user: {
          id: current_user.prefix_id,
          email: current_user.email,
          name: current_user.name,
          first_name: current_user.first_name,
          last_name: current_user.last_name,
          created_at: current_user.created_at.iso8601,
          last_sign_in_at: (current_user.last_sign_in_at || current_user.current_sign_in_at)&.iso8601,
          last_sign_in_ip: high_security ? (current_user.last_sign_in_ip || current_user.current_sign_in_ip) : nil,
          sign_in_count: current_user.sign_in_count,
          two_factor_enabled: current_user.two_factor_enabled?,
          time_zone: current_user.time_zone
        },
        login_history: login_histories,
        current_account: {
          id: current_account.prefix_id,
          name: current_account.name,
          security_level: current_account.security_level,
          hipaa_enabled: current_account.hipaa_enabled?,
          default_checklist_generation_model: current_account.default_checklist_generation_model,
          default_checklist_model: current_account.default_checklist_model,
          default_text_extraction_model: current_account.default_text_extraction_model,
          default_font_family: current_account.default_font_family,
          default_font_scale: current_account.default_font_scale,
          primary_color: current_account.primary_color,
          # Data region is nil unless a multi-region overlay is loaded.
          # UI renders "n/a" when nil.
          data_region: (Revdoku.respond_to?(:current_data_region) ? Revdoku.current_data_region&.slice("id", "name", "location") : nil),
        }
      }
    })
  end

  # GET /api/v1/account/members
  # Returns all account members with permissions and seat limits
  def members
    memberships = current_account.members.includes(:user)

    render_api_success({
      members: memberships.map do |m|
        {
          id: m.id,
          prefix_id: m.user.prefix_id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          is_owner: current_account.owner?(m.user),
          removable: m.dischargeable?
        }
      end,
      permissions: {
        can_add_member: Principal.account_member&.may_administer_members? || false,
        can_manage: Principal.account_member&.may_administer_members? || false
      },
      limits: {
        current_count: current_account.members_count,
        user_limit: current_account.user_limit,
        can_add_member: current_account.can_add_member?
      }
    })
  end

  # PATCH /api/v1/account/ai_preferences
  # Updates AI model preferences for the current account. Region is
  # deployment-locked (see Revdoku.default_region); this endpoint silently
  # ignores any `preferred_region` value the client may still send so an
  # outdated UI can't write a value that the resolver no longer honours.
  def ai_preferences
    permitted = params.permit(:default_checklist_generation_model, :default_checklist_model, :default_text_extraction_model)

    # Validate that specified models actually exist (allow blank to clear)
    permitted.each do |key, value|
      next if value.blank?
      unless AiModelResolver.find_model(value, account: current_account)
        render_api_bad_request("Unknown AI model: #{value}")
        return
      end
      unless current_account.allows_ai_model?(value)
        render_api_error("AI model not available on your plan: #{value}", status: :forbidden, code: "MODEL_NOT_AVAILABLE")
        return
      end
    end

    # Allow clearing by setting blank values to nil
    updates = {}
    updates[:default_checklist_generation_model] = permitted[:default_checklist_generation_model].presence if permitted.key?(:default_checklist_generation_model)
    updates[:default_checklist_model] = permitted[:default_checklist_model].presence if permitted.key?(:default_checklist_model)
    updates[:default_text_extraction_model] = permitted[:default_text_extraction_model].presence if permitted.key?(:default_text_extraction_model)

    current_account.update!(updates) if updates.any?

    render_api_success({
      default_checklist_generation_model: current_account.default_checklist_generation_model,
      default_checklist_model: current_account.default_checklist_model,
      default_text_extraction_model: current_account.default_text_extraction_model,
      preferred_region: AiModelResolver.effective_region
    })
  end

  # PATCH /api/v1/account/profile
  # Updates user profile settings (e.g., timezone)
  def update_profile
    permitted = params.permit(:time_zone, :first_name, :last_name, :account_name, :default_font_family, :default_font_scale, :primary_color)

    if permitted[:time_zone].present?
      unless ActiveSupport::TimeZone[permitted[:time_zone]]
        render_api_bad_request("Invalid timezone: #{permitted[:time_zone]}")
        return
      end
    end

    # Batch user updates into a single save
    user_updates = {}
    user_updates[:time_zone] = permitted[:time_zone] if permitted.key?(:time_zone)
    user_updates[:first_name] = permitted[:first_name] if permitted.key?(:first_name)
    user_updates[:last_name] = permitted[:last_name] if permitted.key?(:last_name)
    current_user.update!(user_updates) if user_updates.present?

    # Validate color format early (before batching account updates)
    if permitted.key?(:primary_color)
      color = permitted[:primary_color]
      if color.present? && color !~ /\A#[0-9a-fA-F]{6}\z/
        render_api_bad_request("Invalid color format")
        return
      end
    end

    # Batch ALL account updates into a single save
    account_updates = {}
    if permitted.key?(:account_name) && permitted[:account_name].present?
      account_updates[:name] = permitted[:account_name]
    end
    if permitted.key?(:primary_color)
      account_updates[:primary_color] = permitted[:primary_color].presence
    end
    if permitted.key?(:default_font_family)
      valid_families = %w[sans-serif serif monospace]
      if permitted[:default_font_family].blank? || valid_families.include?(permitted[:default_font_family])
        account_updates[:default_font_family] = permitted[:default_font_family].presence
      end
    end
    if permitted.key?(:default_font_scale)
      scale = permitted[:default_font_scale].to_f
      account_updates[:default_font_scale] = scale.between?(0.5, 3.0) ? scale : nil
    end
    current_account.update!(account_updates) if account_updates.present?

    render_api_success({
      time_zone: current_user.time_zone,
      first_name: current_user.first_name,
      last_name: current_user.last_name,
      name: current_user.name,
      account_name: current_account.name,
      default_font_family: current_account.default_font_family,
      default_font_scale: current_account.default_font_scale,
      primary_color: current_account.primary_color
    })
  end

  # POST /api/v1/account/switch_account
  # Switches the current account context for the frontend session
  def switch_account
    account = current_user.accounts.find_by_prefix_id(params[:account_id])
    unless account
      return render_api_not_found("Account")
    end

    # Create new session key for the target account
    new_key = current_user.api_keys.create!(
      label: "Frontend Session",
      token_type: :session,
      expires_at: account.session_ttl.from_now,
      metadata: { "account_id" => account.prefix_id, "idle_timeout_seconds" => account.idle_timeout.to_i }
    )
    ApiKey.record_device_info!(new_key, request)

    # Update cookie with new key
    cookies.signed[:revdoku_api_key] = {
      value: new_key.token,
      expires: new_key.expires_at,
      httponly: true,
      secure: !Rails.env.development?,
      same_site: :lax
    }

    # Destroy old key and clear its cache
    old_key_id = @api_key.id
    @api_key.destroy
    Rails.cache.delete("auth_ctx:#{old_key_id}")

    render_api_success({
      account: { id: account.prefix_id, name: account.name, personal: account.personal? }
    })
  end

  # POST /api/v1/account/logout
  # Logs out the current user by invalidating session tokens and Devise session
  def logout
    # Only destroy session keys — preserve API keys
    current_user.api_keys.sessions.destroy_all

    # Clear the cookie (if frontend is using cookie auth)
    cookies.delete(:revdoku_api_key)

    # Sign out the Devise/Warden session — this also triggers the
    # Warden::Manager.before_logout hook which creates an AuditLog entry
    sign_out(current_user)

    render_api_success({
      message: "Successfully logged out",
      redirect_to: "/users/sign_in"
    })
  end

  private

  def truncate_user_agent(user_agent)
    return nil unless user_agent
    user_agent.truncate(100)
  end
end
