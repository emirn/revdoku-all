# frozen_string_literal: true

# Shared helper for HIPAA-grade audit logging from Warden hooks.
# Matches the retry + notification behavior of Api::BaseController#record_audit_log.
module WardenAuditHelper
  AUDIT_LOG_MAX_RETRIES = 3

  def self.create_audit_log!(attrs)
    retries = 0
    begin
      AuditLog.create!(attrs)
    rescue ActiveRecord::StatementInvalid, SQLite3::BusyException => e
      retries += 1
      if retries <= AUDIT_LOG_MAX_RETRIES
        sleep(0.1 * (2**retries))
        retry
      else
        Rails.logger.error("[CRITICAL] Warden audit log PERMANENTLY FAILED after #{AUDIT_LOG_MAX_RETRIES} retries: #{e.message}")
        notify_exception(e, attrs)
      end
    rescue => e
      Rails.logger.error("Failed to create Warden audit log: #{e.message}")
      notify_exception(e, attrs)
    end
  end

  def self.notify_exception(error, attrs)
  end
end

Warden::Manager.after_set_user except: :fetch do |user, auth, opts|
  if opts[:scope] == :user && opts[:event] == :authentication
    auth.session.delete(:current_account_id)

    # Check if this is a known device BEFORE recording the login
    fingerprint = LoginHistory.compute_fingerprint(auth.request.user_agent)
    new_device = !LoginHistory.known_device?(user, fingerprint)

    login_history = LoginHistory.record_login(user, auth.request)

    first_sign_in = user.sign_in_count.to_i == 0

    user.update_columns(
      sign_in_count: user.sign_in_count.to_i + 1,
      current_sign_in_at: Time.current,
      last_sign_in_at: user.current_sign_in_at,
      current_sign_in_ip: auth.request.remote_ip,
      last_sign_in_ip: user.current_sign_in_ip
    )

    WardenAuditHelper.create_audit_log!(
      path: "/auth/login",
      response_code: 200,
      source_type: "WEB",
      user_id: user.prefix_id,
      account_id: user.personal_account&.prefix_id,
      ip: auth.request.remote_ip,
      user_agent: auth.request.user_agent&.truncate(100),
      request: { method: "POST", action: "login" }
    )

    # Only notify on new/unrecognized devices for regular accounts;
    # always notify for high-security accounts (HIPAA requirement)
    should_notify = new_device || user.has_high_security_account?
    should_notify = false if first_sign_in && !Revdoku.notify_on_signup_sign_in
    SendLoginNotificationJob.perform_later(login_history.id, new_device) if should_notify
  end
end

Warden::Manager.before_logout do |user, auth, opts|
  next unless user

  # Resolve the account the user was signed into (from session), fallback to personal
  session_account_id = auth.request.session[:current_account_id] rescue nil
  logout_account = if session_account_id
                     user.accounts.find_by(id: session_account_id)
                   end
  logout_account ||= user.personal_account

  WardenAuditHelper.create_audit_log!(
    path: "/auth/logout",
    response_code: 200,
    source_type: "WEB",
    user_id: user.prefix_id,
    account_id: logout_account&.prefix_id,
    ip: auth.request.remote_ip,
    user_agent: auth.request.user_agent&.truncate(100),
    request: { method: "POST", action: "logout", account_name: logout_account&.name }
  )
end

Warden::Manager.before_failure do |env, opts|
  request = ActionDispatch::Request.new(env)
  attempted_email = request.params.dig("user", "email") || "unknown"

  WardenAuditHelper.create_audit_log!(
    path: "/auth/login_failed",
    response_code: 401,
    source_type: "WEB",
    user_id: nil,
    account_id: nil,
    ip: request.remote_ip,
    user_agent: request.user_agent&.truncate(100),
    request: {
      method: "POST",
      action: "login_failed",
      attempted_email: attempted_email.to_s.truncate(100),
      failure_reason: opts[:message]&.to_s || "invalid_credentials"
    }
  )
end
