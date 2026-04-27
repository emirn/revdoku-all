# frozen_string_literal: true

require "ipaddr"

# Gates access to the /admin namespace by source IP.
#
# Source of truth for which IPs are allowed:
#   - If ADMIN_ALLOWED_IPS is set (comma-separated CIDRs / single IPs), the
#     request is matched against that explicit list.
#   - Otherwise the default list comes from Revdoku.admin_ip_default_cidrs,
#     defined in config/initializers/00_revdoku.rb.
#   - Non-production environments always allow access.
class AdminIpConstraint
  def matches?(request)
    return true unless Rails.env.production?

    ranges = configured_ranges
    matched = ranges.any? { |cidr| cidr.include?(request.remote_ip) }

    unless matched
      Rails.logger.info(
        "[AdminIpConstraint] denied remote_ip=#{request.remote_ip} " \
        "explicit_allowlist=#{explicit_allowlist?}"
      )
    end

    matched
  rescue IPAddr::InvalidAddressError => e
    Rails.logger.warn "[AdminIpConstraint] Invalid IP config: #{e.message}"
    false
  end

  private

  def configured_ranges
    cidrs = explicit_allowlist? ? parse_env_allowlist : Revdoku.admin_ip_default_cidrs
    cidrs.map { |c| IPAddr.new(c) }
  end

  def parse_env_allowlist
    ENV["ADMIN_ALLOWED_IPS"].to_s.split(",").map(&:strip).reject(&:blank?)
  end

  def explicit_allowlist?
    ENV["ADMIN_ALLOWED_IPS"].to_s.strip.present?
  end
end
