# frozen_string_literal: true

# Allowlist for outbound report-completion webhooks (callback_url param on
# POST /api/v1/reports). The Rails app will only POST to URLs whose host
# matches (or is a subdomain of) one of the entries below. Non-HTTPS URLs
# are always rejected.
#
# v1 scope: Zapier only. Add Make.com (hook.us1.make.com, hook.eu1.make.com,
# hook.us2.make.com, ...) and other integrations here as we ship them — no
# code changes needed elsewhere.

require "uri"

module Revdoku
  module CallbackUrlAllowlist
    ALLOWED_HOSTS = %w[
      hooks.zapier.com
    ].freeze

    # Returns true if `url` is a valid HTTPS URL whose host exactly matches
    # or is a subdomain of an allowlisted host.
    def self.allowed?(url)
      return false if url.blank?

      uri = URI.parse(url.to_s)
      return false unless uri.is_a?(URI::HTTPS)
      return false if uri.host.blank?

      host = uri.host.downcase
      ALLOWED_HOSTS.any? { |allowed| host == allowed || host.end_with?(".#{allowed}") }
    rescue URI::InvalidURIError
      false
    end
  end
end
