# frozen_string_literal: true

class Api::BaseController < ActionController::API
  include ActionController::Cookies  # Enable cookie support for API controllers
  include Pundit::Authorization
  include ApiResponses
  include PrefixIdSerialization

  before_action :record_request_start_time
  before_action :authenticate_api_key!
  before_action :set_current_context
  before_action :enforce_two_factor!
  after_action :verify_authorized
  after_action :record_audit_log
  # Commercial billing (credit floor, per-action charges) attaches additional
  # after_actions here via Api::BaseControllerEE when that overlay is present.
  after_action :set_response_time_header

  protected

  def current_user
    @current_user
  end

  def current_account
    Principal.account
  end

  private

  def authenticate_api_key!
    raw_secret = token_from_request

    if raw_secret.blank?
      log_failed_api_auth("token_missing")
      render_api_unauthorized("API key required")
      return false
    end

    # Cache key lookup to avoid DB query on every request
    secret_hash = Revdoku::Crypto::KeyHasher.digest(raw_secret)
    cache_key = "auth_token:#{secret_hash}"
    cached = Rails.cache.read(cache_key)

    if cached
      @api_key = ApiKey.find_by(id: cached[:key_id])
      if @api_key.nil? || @api_key.expired? || @api_key.revoked?
        Rails.cache.delete(cache_key)
        log_failed_api_auth("token_invalid_or_expired")
        render_api_unauthorized("Invalid or expired API key")
        return false
      end
    else
      @api_key = ApiKey.resolve(raw_secret)
      if @api_key.nil?
        log_failed_api_auth("token_invalid_or_expired")
        render_api_unauthorized("Invalid or expired API key")
        return false
      end
      Rails.cache.write(cache_key, { key_id: @api_key.id }, expires_in: 2.minutes)
    end

    if @api_key.session? && @api_key.idle?
      Rails.cache.delete(cache_key)
      log_failed_api_auth("session_idle_timeout")
      render_api_unauthorized("Session expired due to inactivity")
      return false
    end

    @api_key.mark_authenticated!
    if @api_key.ip_address != request.remote_ip
      @api_key.update_column(:ip_address, request.remote_ip)
    end
    @current_user = @api_key.user
    Principal.user = @current_user
    Principal.authenticated_via = :api_key
  end

  # Retrieve token from Authorization header OR signed HttpOnly cookie
  # This supports both external API clients (Bearer token) and frontend (cookie)
  def token_from_request
    # First try Authorization header (for external API clients)
    token = token_from_header
    return token if token.present?

    # Fall back to signed HttpOnly cookie (for frontend with credentials: 'include')
    token_from_cookie
  end

  def token_from_cookie
    cookies.signed[:revdoku_api_key]
  end

  def set_current_context
    Principal.user_agent = request.user_agent
    Principal.ip_address = request.remote_ip
    Principal.correlation_id = request.request_id
    return unless @current_user

    # Cache account context to avoid 2-3 DB lookups per request
    ctx_cache_key = "auth_ctx:#{@api_key.id}"
    cached_ctx = Rails.cache.read(ctx_cache_key)

    if cached_ctx
      Principal.account = Account.find_by(id: cached_ctx[:account_id])
      Principal.account_member = Principal.account&.members&.find_by(id: cached_ctx[:account_member_id])
    end

    unless Principal.account && Principal.account_member
      # Set current account from API token metadata or default to personal account
      account_prefix = @api_key.metadata&.dig("account_id")
      if account_prefix.present?
        # SECURITY: Only allow access to accounts the user is a member of
        Principal.account = @current_user.accounts.find_by_prefix_id(account_prefix)
      end
      Principal.account ||= @current_user.personal_account

      if Principal.account
        Principal.account_member = Principal.account.members.find_by(user: @current_user)
      end

      # Cache for subsequent requests
      if Principal.account && Principal.account_member
        Rails.cache.write(ctx_cache_key, {
          account_id: Principal.account.id,
          account_member_id: Principal.account_member.id
        }, expires_in: 2.minutes)
      end
    end

    if Principal.account
      unless Principal.account_member
        render_api_forbidden("You are not a member of this account")
        return false
      end

      ActsAsTenant.current_tenant = Principal.account
    else
      render_api_forbidden("No valid account found")
      return false
    end
  end

  def enforce_two_factor!
    return unless current_account&.requires_2fa?
    return if current_user&.two_factor_enabled?

    # Allow profile, logout, me, auth, and 2FA setup endpoints
    allowed_paths = %w[/api/v1/account/profile /api/v1/account/logout /api/v1/account/switch_account /api/v1/me /api/v1/auth/refresh]
    return if allowed_paths.any? { |p| request.path == p }

    render_api_forbidden("Two-factor authentication is required for this account. Please set up 2FA to continue.")
    false
  end

  def append_info_to_payload(payload)
    super
    payload[:user_id] = current_user&.prefix_id
    payload[:remote_ip] = request.remote_ip
  end

  # Pundit authorization helper
  def authorize_action(record, action = nil)
    action ||= "#{action_name}?"
    authorize record, action
  rescue Pundit::NotAuthorizedError
    render_api_forbidden("You are not authorized to perform this action")
    false
  end

  def log_failed_api_auth(reason)
    retries = 0
    begin
      AuditLog.create!(
        path: request.path,
        response_code: 401,
        source_type: "API",
        user_id: nil,
        account_id: nil,
        ip: request.remote_ip,
        user_agent: request.user_agent&.truncate(100),
        request_id: request.request_id,
        request: { method: request.method, params: { reason: reason } },
        duration: request_duration_ms
      )
    rescue ActiveRecord::StatementInvalid, SQLite3::BusyException => e
      retries += 1
      if retries <= AUDIT_LOG_MAX_RETRIES
        sleep(0.1 * (2 ** retries))
        retry
      else
        Rails.logger.error("[CRITICAL] Failed auth audit log PERMANENTLY FAILED after #{AUDIT_LOG_MAX_RETRIES} retries: #{e.message}")
      end
    rescue => e
      Rails.logger.error("Failed to log API auth failure: #{e.message}")
    end
  end

  def token_from_header
    request.headers.fetch("Authorization", "").split(" ").last
  end

  # Build exception notification data enriched with account context for follow-up.
  # Safe to call even when current_user/account are nil (e.g. auth failures).
  def exception_context(extra = {})
    ctx = { path: request.path }
    ctx[:user_id] = current_user.prefix_id if current_user
    if Principal.account
      ctx[:account_id] = Principal.account.prefix_id
      ctx[:account_email] = Principal.account.owner&.email unless Principal.account.security_level_high?
    end
    ctx.merge(extra)
  end

  def record_request_start_time
    @request_start_time = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  end

  def request_duration_ms
    return nil unless @request_start_time
    ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - @request_start_time) * 1000).round(2)
  end

  def set_response_time_header
    duration = request_duration_ms
    response.headers["X-Response-Time"] = "#{duration}ms" if duration
  end

  # Maximum retries for audit log creation (HIPAA compliance requires 100% capture)
  AUDIT_LOG_MAX_RETRIES = 3

  # Endpoints to skip audit logging entirely in low-security mode.
  # These are high-frequency read-only endpoints that clutter logs without security value.
  # High-security (HIPAA) accounts always log everything — this list is ignored.
  LOW_SECURITY_AUDIT_SKIP = [
    "api/v1/notifications#unread_count",  # polled frequently via ActionCable fallback
    "api/v1/notifications#index",         # read-only notification list
    "api/v1/me#show",                     # called on every page load
    "api/v1/ai_models#index",             # static config
    "api/v1/subscription_plans#index",    # static config
    "api/v1/checklist_templates#index",   # static config
  ].to_set.freeze

  def record_audit_log
    full_logging = Principal.account&.full_audit_logging?
    is_read = request.get? || request.head?
    is_success = response.status < 400

    # Low-security: skip noisy read-only endpoints entirely
    if !full_logging && is_read && is_success
      action_key = "#{controller_path}##{action_name}"
      return if LOW_SECURITY_AUDIT_SKIP.include?(action_key)
    end

    # Casual successful reads: limited audit (no body parsing, no retries)
    if !full_logging && is_read && is_success
      begin
        AuditLog.create!(
          path: request.path,
          response_code: response.status,
          source_type: determine_source_type,
          user_id: current_user&.prefix_id,
          account_id: Principal.account&.prefix_id,
          ip: request.remote_ip,
          request_id: request.request_id,
          envelope_id: extract_envelope_id_from_path,
          duration: request_duration_ms
        )
      rescue => e
        Rails.logger.error("[AUDIT_FAILURE] path=#{request.path} user=#{current_user&.prefix_id} error=#{e.message}")
      end
      return
    end

    # Full audit log for writes, failures, or high-security accounts.
    # Request/response BODY is only captured when `full_audit_logging`
    # is on (high-security / HIPAA accounts). Other accounts still log
    # the row (path, actor, code, duration, ip, user_agent, envelope)
    # but without any user-supplied body content, so no PHI or prompt
    # text lands in the audit db.
    retries = 0
    begin
      AuditLog.create!(
        path: request.path,
        response_code: response.status,
        source_type: determine_source_type,
        user_id: current_user&.prefix_id,
        account_id: Principal.account&.prefix_id,
        ip: request.remote_ip,
        user_agent: request.user_agent,
        request: (full_logging ? build_filtered_request_metadata : nil),
        request_id: request.request_id,
        response: (full_logging ? build_response_metadata : nil),
        envelope_id: extract_envelope_id_from_path,
        duration: request_duration_ms
      )
    rescue ActiveRecord::StatementInvalid, SQLite3::BusyException => e
      retries += 1
      # High-security: retry with backoff. Casual: single attempt.
      if full_logging && retries <= AUDIT_LOG_MAX_RETRIES
        sleep(0.1 * (2 ** retries))  # Exponential backoff: 0.2s, 0.4s, 0.8s
        retry
      else
        Rails.logger.error("[CRITICAL] Audit log failed after #{retries} attempt(s): #{e.message}")
      end
    rescue => e
      Rails.logger.error("Failed to create audit log: #{e.message}")
    end
  end

  # Extract envelope prefix_id from request path for indexed audit log queries.
  # Replaces unindexable LIKE '%prefix_id%' full table scans.
  def extract_envelope_id_from_path
    match = request.path.match(%r{/envelopes/(env_[A-Za-z0-9]+)})
    match&.[](1)
  end

  SECURITY_FILTER_PARAMS = [:passw, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc].freeze

  def build_filtered_request_metadata
    if Principal.account&.hipaa_enabled?
      # HIPAA: full PHI filter — keys visible, sensitive values → [FILTERED]
      raw_params = request.filtered_parameters.dup
    else
      # Non-HIPAA: only filter security params (passwords, tokens, secrets)
      security_filter = ActiveSupport::ParameterFilter.new(SECURITY_FILTER_PARAMS)
      raw_params = security_filter.filter(request.parameters).dup
    end

    %w[controller action format].each { |key| raw_params.delete(key) }

    {
      method: request.method,
      params: truncate_large_content(raw_params).presence
    }
  end

  # Response envelope keys that are safe to surface in audit logs with
  # zero filtering. Override via prepended modules to widen the set.
  def operational_keys
    %w[success].freeze
  end

  def build_response_metadata
    content_type = response.content_type&.to_s&.split(";")&.first&.strip
    size = response.body&.bytesize || 0
    meta = { content_type: content_type, size: size }

    return meta if size == 0

    unless json_content_type?(content_type)
      meta[:content_description] = "[BINARY]"
      return meta
    end

    parsed = JSON.parse(response.body)

    # Operational fields — safe for ALL accounts, no filtering needed
    operational_keys.each do |key|
      meta[key.to_sym] = parsed[key] if parsed.key?(key)
    end

    # Error object — include with standard ParameterFilter
    # (now safe: :message removed from filter_parameters after rename)
    if parsed.key?("error") && parsed["error"].is_a?(Hash)
      filter = ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)
      meta[:error] = filter.filter(parsed["error"])
    end

    # Domain data
    if parsed.key?("data")
      if Principal.account&.hipaa_enabled?
        # HIPAA: keep full structure (keys visible for activity tracking), redact PHI values
        filter ||= ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)
        meta[:data] = truncate_large_content(filter.filter(parsed["data"]))
      else
        # Non-HIPAA: full data, only truncate large blobs (base64, file content)
        meta[:data] = truncate_large_content(parsed["data"])
      end
    end

    meta
  rescue JSON::ParserError
    meta
  rescue => e
    Rails.logger.error("Failed to build response metadata: #{e.message}")
    { content_type: content_type, size: size }
  end

  def truncate_for_audit(obj, depth: 0)
    case obj
    when Hash
      return "[...]" if depth > 3
      obj.transform_values { |v| truncate_for_audit(v, depth: depth + 1) }
    when Array
      summary = obj.first(3).map { |v| truncate_for_audit(v, depth: depth + 1) }
      summary << "(#{obj.size} total)" if obj.size > 3
      summary
    when String
      obj.length > 100 ? "#{obj[0..97]}..." : obj
    else
      obj
    end
  end

  def truncate_large_content(obj, depth: 0)
    case obj
    when Hash
      return "[...]" if depth > 5
      obj.transform_values { |v| truncate_large_content(v, depth: depth + 1) }
    when Array
      return "[#{obj.size} items]" if depth > 3 && obj.size > 10
      obj.map { |v| truncate_large_content(v, depth: depth + 1) }
    when String
      obj.bytesize > 2048 ? "[LARGE CONTENT #{obj.bytesize} bytes]" : obj
    else
      obj
    end
  end

  def json_content_type?(content_type)
    content_type.present? && content_type.include?("json")
  end

  def determine_source_type
    if @api_key&.session?
      "WEB"
    elsif @api_key&.api?
      "API"
    else
      "INTERNAL"
    end
  end

end
