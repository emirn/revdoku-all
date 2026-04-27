# frozen_string_literal: true

# Rack::Attack configuration for rate limiting and request throttling
# Documentation: https://github.com/rack/rack-attack

class Rack::Attack
  # Use Rails cache for throttle data (Solid Cache in production)
  Rack::Attack.cache.store = Rails.cache

  # ============================================================================
  # SAFELISTS
  # ============================================================================

  # Allow all requests from localhost in development
  safelist("allow-localhost") do |req|
    req.ip == "127.0.0.1" || req.ip == "::1"
  end

  # Allow health check endpoint
  safelist("allow-health-check") do |req|
    req.path == "/up"
  end

  # ============================================================================
  # THROTTLES
  # ============================================================================

  # ----------------------------------------------------------------------------
  # Login throttling
  # ----------------------------------------------------------------------------

  # Throttle login attempts by IP address (5 requests per 20 seconds)
  throttle("logins/ip", limit: 5, period: 20.seconds) do |req|
    if req.path == "/users/sign_in" && req.post?
      req.ip
    end
  end

  # Throttle login attempts by email address (5 requests per minute)
  throttle("logins/email", limit: 5, period: 60.seconds) do |req|
    if req.path == "/users/sign_in" && req.post?
      (req.params.dig("user", "email") || req.params["email"])&.downcase&.gsub(/\s+/, "")
    end
  end

  # Throttle OTP verification attempts (5 per minute per IP)
  throttle("otp_verify/ip", limit: 5, period: 60.seconds) do |req|
    if req.path == "/users/sign_in/verify" && req.post?
      req.ip
    end
  end

  # ----------------------------------------------------------------------------
  # Registration throttling (prevent mass account creation)
  # ----------------------------------------------------------------------------

  # 5 registration attempts per 15 minutes per IP
  throttle("registrations/ip", limit: 5, period: 15.minutes) do |req|
    if req.path == "/users" && req.post?
      req.ip
    end
  end

  # 3 registration attempts per 30 minutes per email
  throttle("registrations/email", limit: 3, period: 30.minutes) do |req|
    if req.path == "/users" && req.post?
      (req.params.dig("user", "email") || req.params["email"])&.downcase&.gsub(/\s+/, "")
    end
  end

  # OTP confirmation verification: 10 per 15 minutes per IP
  throttle("confirm_verify/ip", limit: 10, period: 15.minutes) do |req|
    if req.path == "/users/confirm_email/verify" && req.post?
      req.ip
    end
  end

  # ----------------------------------------------------------------------------
  # API throttling
  # ----------------------------------------------------------------------------

  # General API rate limit: 300 requests per minute per IP
  throttle("api/ip", limit: 300, period: 1.minute) do |req|
    if req.path.start_with?("/api/")
      req.ip
    end
  end

  # Authenticated API rate limit: 600 requests per minute per user
  # Uses Bearer token to identify the user
  throttle("api/token", limit: 600, period: 1.minute) do |req|
    if req.path.start_with?("/api/")
      auth_header = req.env["HTTP_AUTHORIZATION"]
      if auth_header&.start_with?("Bearer ")
        auth_header[7..-1]  # Extract token for rate limiting key
      end
    end
  end

  # ----------------------------------------------------------------------------
  # Expensive operations (AI-powered endpoints)
  # ----------------------------------------------------------------------------

  # Report creation (AI inspection): 10 per minute per IP
  throttle("reports/create/ip", limit: 10, period: 1.minute) do |req|
    if req.path =~ %r{^/api/v1/reports/?$} && req.post?
      req.ip
    end
  end

  # Checklist generation (AI): 5 per minute per IP
  throttle("checklists/generate/ip", limit: 5, period: 1.minute) do |req|
    if req.path =~ %r{^/api/v1/checklists/generate/?$} && req.post?
      req.ip
    end
  end

  # Report status polling: 60 per minute per IP (1 per second)
  throttle("reports/status/ip", limit: 60, period: 1.minute) do |req|
    if req.path =~ %r{^/api/v1/reports/[\w-]+/status/?$} && req.get?
      req.ip
    end
  end

  # Report status polling: 120 per minute per token
  throttle("reports/status/token", limit: 120, period: 1.minute) do |req|
    if req.path =~ %r{^/api/v1/reports/[\w-]+/status/?$} && req.get?
      auth_header = req.env["HTTP_AUTHORIZATION"]
      auth_header[7..-1] if auth_header&.start_with?("Bearer ")
    end
  end

  # Report export: 20 per minute per IP
  throttle("reports/export/ip", limit: 20, period: 1.minute) do |req|
    if req.path =~ %r{^/api/v1/reports/[\w-]+/export/?$} && req.post?
      req.ip
    end
  end

  # ----------------------------------------------------------------------------
  # Invitation throttling
  # ----------------------------------------------------------------------------

  # View invitation page: 15 per minute per IP
  throttle("invitations/show/ip", limit: 15, period: 1.minute) do |req|
    if req.path =~ %r{^/invitations/} && req.get?
      req.ip
    end
  end

  # Accept invitation: 5 per minute per IP
  throttle("invitations/accept/ip", limit: 5, period: 1.minute) do |req|
    if req.path =~ %r{^/invitations/.+/accept} && req.post?
      req.ip
    end
  end

  # ----------------------------------------------------------------------------
  # File upload throttling
  # ----------------------------------------------------------------------------

  # File uploads: 30 per minute per IP
  throttle("uploads/ip", limit: 30, period: 1.minute) do |req|
    if (req.path =~ %r{^/api/v1/envelopes/[\w-]+/files} ||
        req.path =~ %r{^/api/v1/document_file_revisions}) && req.post?
      req.ip
    end
  end

  # ============================================================================
  # BLOCKLISTS
  # ============================================================================

  # Block suspicious requests (commonly probed paths)
  blocklist("block-suspicious-paths") do |req|
    Rack::Attack::Fail2Ban.filter("suspicious-paths-#{req.ip}", maxretry: 3, findtime: 10.minutes, bantime: 1.hour) do
      # Block requests to common attack vectors
      req.path.include?("wp-admin") ||
        req.path.include?("wp-login") ||
        req.path.include?(".php") ||
        req.path.include?(".asp") ||
        req.path.include?(".env") ||
        req.path.include?("/.git")
    end
  end

  # ============================================================================
  # RESPONSE CUSTOMIZATION
  # ============================================================================

  # Return a JSON response for API requests
  self.throttled_responder = lambda do |request|
    match_data = request.env["rack.attack.match_data"]
    now = Time.current

    headers = {
      "Content-Type" => "application/json",
      "Retry-After" => (match_data[:period] - (now.to_i % match_data[:period])).to_s,
      "X-RateLimit-Limit" => match_data[:limit].to_s,
      "X-RateLimit-Remaining" => "0",
      "X-RateLimit-Reset" => (now + (match_data[:period] - (now.to_i % match_data[:period]))).iso8601
    }

    body = {
      error: "Rate limit exceeded",
      retry_after: headers["Retry-After"].to_i
    }.to_json

    [ 429, headers, [body] ]
  end

  # Custom blocked response
  self.blocklisted_responder = lambda do |request|
    [ 403, { "Content-Type" => "application/json" }, [{ error: "Forbidden" }.to_json] ]
  end
end

# ============================================================================
# LOGGING (ActiveSupport Notifications)
# ============================================================================

# Redact prefix_ids from paths in operational logs. The audit database keeps
# full unredacted paths as required by HIPAA §164.312(b).
RACK_ATTACK_PREFIX_ID_PATTERN = %r{/(env|rpt|clst|chk|dfrev|df|envrv|acct|user|atok|tag|splan|ord|inv|log)_[A-Za-z0-9]+}

# Log throttled requests
ActiveSupport::Notifications.subscribe("throttle.rack_attack") do |_name, _start, _finish, _id, payload|
  req = payload[:request]
  redacted_path = req.path.gsub(RACK_ATTACK_PREFIX_ID_PATTERN, '/\1_[REDACTED]')
  Rails.logger.warn(
    "[Rack::Attack] Throttled #{req.env['rack.attack.match_discriminator']} " \
    "#{req.request_method} #{redacted_path} from #{req.ip}"
  )
end

# Log blocked requests
ActiveSupport::Notifications.subscribe("blocklist.rack_attack") do |_name, _start, _finish, _id, payload|
  req = payload[:request]
  redacted_path = req.path.gsub(RACK_ATTACK_PREFIX_ID_PATTERN, '/\1_[REDACTED]')
  Rails.logger.warn(
    "[Rack::Attack] Blocked #{req.request_method} #{redacted_path} from #{req.ip}"
  )
end
