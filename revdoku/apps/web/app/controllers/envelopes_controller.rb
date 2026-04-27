# frozen_string_literal: true

class EnvelopesController < ApplicationController
  # Allow unsafe-eval for user-defined envelope scripts that execute via
  # `new Function()` in EnvelopePage.tsx. Scoped to this controller only so
  # the rest of the app (login, admin, etc.) retains strict CSP.
  content_security_policy do |policy|
    policy.script_src :self, :unsafe_eval
  end

  before_action :authenticate_user!, except: [:manifest]
  before_action :ensure_account!, except: [:manifest]
  before_action :enforce_two_factor_setup!, except: [:manifest]

  def index
    generate_api_token
    render layout: "envelope"
  end

  def show
    generate_api_token
    render layout: "envelope"
  end

  # GET /envelopes/manifest
  # Provides configuration data for the React frontend
  def manifest
    # Always return the basic API config (needed for the frontend to know where to make requests)
    response = {
      api: {
        baseUrl: "/api/v1/"
      },
      # File upload limits (in bytes) - account-specific for file size, global for envelope
      limits: {
        maxFileSize: user_signed_in? && current_account ? current_account.max_file_size_bytes : FileSizeLimits.max_file_size,
        maxFileSizeMb: user_signed_in? && current_account ? current_account.max_file_size_mb : FileSizeLimits.max_file_size_mb,
        maxEnvelopeSize: FileSizeLimits.max_envelope_size,
        maxEnvelopeSizeMb: FileSizeLimits.max_envelope_size_mb
      },
      # Note: auth.tokenCookie removed - HttpOnly cookies are sent automatically by the browser
      appVersion: Revdoku.app_version_string,
      appRevision: Rails.env.development? ? Revdoku.app_revision : nil,
      legal: {
        terms:       Revdoku.terms_url,
        privacy:     Revdoku.privacy_url,
        source_code: Revdoku.source_code_url
      }
    }

    # If user is authenticated and has an account, include additional info
    if user_signed_in? && current_account
      # Ensure token cookie exists (use signed cookie check)
      generate_api_token unless cookies.signed[:revdoku_api_key].present?

      # Note: api_token value not included - HttpOnly cookie can't and shouldn't be read by JS
      response[:authenticated] = true
      response[:user] = {
        id: current_user.prefix_id,
        email: current_user.email,
        first_name: current_user.first_name,
        last_name: current_user.last_name,
        name: current_user.name
      }
      response[:account] = {
        id: current_account.prefix_id,
        name: current_account.name,
        personal: current_account.personal?
      }
      response[:accounts] = current_user.memberships.includes(:account).map do |m|
        {
          id: m.account.prefix_id,
          name: m.account.name,
          personal: m.account.personal?,
          role: m.account.owner?(current_user) ? "owner" : m.role,
          members_count: m.account.users.count
        }
      end
      response[:security] = {
        security_level: current_account.security_level,
        hipaa_enabled: current_account.hipaa_enabled?,
        session_ttl_seconds: current_account.session_ttl.to_i,
        idle_timeout_seconds: current_account.idle_timeout.to_i,
        requires_2fa: current_account.requires_2fa?,
        user_2fa_enabled: current_user.two_factor_enabled?,
        full_audit_logging: current_account.full_audit_logging?,
        audit_retention_days: current_account.audit_retention_days
      }
      response[:features] = Revdoku.feature_flags
    else
      response[:authenticated] = false
    end

    render json: response
  end

  private

  def generate_api_token
    # Reuse existing valid session token if >5 min remaining
    existing_token = find_reusable_session_token
    if existing_token
      set_token_cookie(existing_token)
      return
    end

    # Generate a new session key for the frontend
    key = current_user.api_keys.create!(
      label: "Frontend Session",
      token_type: :session,
      expires_at: current_account.session_ttl.from_now,
      metadata: { "account_id" => current_account&.prefix_id, "idle_timeout_seconds" => current_account.idle_timeout.to_i }
    )

    ApiKey.record_device_info!(key, request)

    set_token_cookie(key)
  end

  def find_reusable_session_token
    account_prefix = current_account&.prefix_id
    current_user.api_keys.sessions.usable_and_live
      .for_account(account_prefix)
      .order(expires_at: :desc)
      .find { |key| !key.near_expiry? }
  end

  def set_token_cookie(key)
    # SECURE: Use signed cookie with httponly: true to prevent XSS attacks
    # The browser sends this cookie automatically with credentials: 'include'
    # Backend validates the cookie directly (no JavaScript access needed)
    #
    # `secure:` follows config.force_ssl instead of the Rails env. Browsers
    # silently refuse secure cookies on plain-HTTP origins, which breaks
    # self-host deployments that run on http://localhost without a TLS
    # terminator in front (every /api/* call then 401s with "API key
    # required"). Deployments behind TLS (Kamal/Cloudflare) flip
    # REVDOKU_FORCE_SSL=true and keep the secure flag.
    cookies.signed[:revdoku_api_key] = {
      value: key.token,
      expires: key.expires_at,
      httponly: true,
      secure: Rails.application.config.force_ssl,
      same_site: :lax
    }
  end

  def ensure_account!
    return if current_account.present?

    # Auto-create personal account if missing (data recovery)
    current_user.create_default_account
    @current_account = nil # clear memoized value
    return if current_account.present?

    sign_out current_user
    redirect_to new_user_session_path, alert: "Your session has expired. Please sign in again."
  end

  def enforce_two_factor_setup!
    return unless current_account&.requires_2fa?
    return if current_user&.two_factor_enabled?

    redirect_to users_two_factor_authentication_path,
      alert: "Your account requires two-factor authentication. Please set it up to continue."
  end

  def current_account
    @current_account ||= account_from_cookie || account_from_session || current_user.personal_account
  end

  def account_from_cookie
    raw_secret = cookies.signed[:revdoku_api_key]
    return unless raw_secret.present?

    api_key = ApiKey.resolve(raw_secret)
    return unless api_key&.user == current_user

    account_prefix = api_key.metadata&.dig("account_id")
    return unless account_prefix.present?

    current_user.accounts.find_by_prefix_id(account_prefix)
  end

  def account_from_session
    account_id = session[:current_account_id]
    current_user.accounts.find_by(id: account_id) if account_id
  end
  helper_method :current_account
end
