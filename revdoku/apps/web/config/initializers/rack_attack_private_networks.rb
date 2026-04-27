# frozen_string_literal: true

# Self-host-friendly rate-limit safelist. A typical self-host runs on
# docker-compose with no reverse proxy in front of the container, so
# the browser's request arrives with req.ip set to the Docker bridge
# gateway (e.g. 192.168.x.x / 172.17.x.x / 10.x.x.x) — not 127.0.0.1.
# Without this, every authenticated page load triggers the 300/min
# /api/* throttle because the React app fires ~10 parallel requests
# on mount and each navigation adds more, all keyed on the same
# gateway IP.
#
# This file is installed ONLY in self-host builds. Deployments that
# sit behind a trusted proxy (Kamal, Cloudflare) must NOT safelist
# private networks — the throttle needs to bite on every real client.
class Rack::Attack
  PRIVATE_NETWORKS = [
    IPAddr.new("127.0.0.0/8"),
    IPAddr.new("::1/128"),
    IPAddr.new("10.0.0.0/8"),
    IPAddr.new("172.16.0.0/12"),
    IPAddr.new("192.168.0.0/16"),
    IPAddr.new("fc00::/7"),         # IPv6 unique-local
    IPAddr.new("fe80::/10")         # IPv6 link-local
  ].freeze

  safelist("allow-private-networks") do |req|
    ip = IPAddr.new(req.ip) rescue nil
    ip && PRIVATE_NETWORKS.any? { |net| net.include?(ip) }
  end
end
