# frozen_string_literal: true

# Lograge replaces Rails' verbose multi-line request logging with a single
# structured JSON line per request. This is the HIPAA Tier 1 operational log:
# PHI-free, safe for developer access, ships to observability platforms.
#
# See docs/HIPAA/2026feb14-hipaa-logging-requirements.md

Rails.application.configure do
  config.lograge.enabled = true
  config.lograge.formatter = Lograge::Formatters::Json.new
  config.lograge.custom_options = lambda do |event|
    {
      request_id: event.payload[:headers]&.fetch("action_dispatch.request_id", nil),
      user_id: event.payload[:user_id],
      remote_ip: event.payload[:remote_ip],
      timestamp: Time.current.iso8601
    }
  end

  # Redact prefix_ids from operational log paths. The immutable audit database
  # (separate system, separate access controls) keeps the full unredacted path
  # as required by HIPAA §164.312(b). Operational logs don't need real IDs.
  config.lograge.custom_payload do |controller|
    {
      path: controller.request.path.gsub(
        %r{/(env|rpt|clst|chk|dfrev|df|envrv|acct|user|atok|tag|splan|ord|inv|log)_[A-Za-z0-9]+},
        '/\1_[REDACTED]'
      )
    }
  end

  config.lograge.ignore_actions = ["HealthController#show"]
end
