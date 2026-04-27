# frozen_string_literal: true

class LoginHistory < ApplicationRecord
  include UserAgentParseable

  belongs_to :user

  validates :signed_in_at, presence: true

  before_create :compute_device_fingerprint

  scope :recent, -> { order(signed_in_at: :desc) }
  scope :last_n, ->(n) { recent.limit(n) }
  scope :unique_ips, ->(n) { recent.select(:ip_address).distinct.limit(n) }

  DEVICE_SUMMARY_MAP = {
    "macOS" => "Mac",
    "Windows" => "Windows",
    "iOS" => "iPhone",
    "iPadOS" => "iPad",
    "Android" => "Android",
    "Linux" => "Linux"
  }.freeze

  def self.ransackable_attributes(auth_object = nil)
    %w[signed_in_at ip_address]
  end

  def parsed_user_agent
    info = self.class.parse_user_agent(user_agent)
    "#{info['browser']} on #{info['os']}"
  end

  # Uppercase "BROWSER - OS" format for email notifications (e.g., "SAFARI - MACOS")
  def device_display
    info = self.class.parse_user_agent(user_agent)
    "#{info['browser'].upcase} - #{info['os'].upcase}"
  end

  # Short device name (e.g., "Mac", "iPhone") from parsed OS
  def device_summary
    info = self.class.parse_user_agent(user_agent)
    DEVICE_SUMMARY_MAP[info["os"]] || "Unknown device"
  end

  # Returns true if user has previously logged in with this fingerprint
  def self.known_device?(user, fingerprint)
    where(user: user, device_fingerprint: fingerprint).exists?
  end

  # Compute a fingerprint from the user agent string (browser + OS)
  def self.compute_fingerprint(user_agent_string)
    info = parse_user_agent(user_agent_string)
    Digest::SHA256.hexdigest("#{info['browser']}|#{info['os']}")
  end

  # Class method to record a login
  def self.record_login(user, request)
    create!(
      user: user,
      ip_address: request.remote_ip,
      user_agent: request.user_agent&.truncate(500),
      signed_in_at: Time.current
    )
  end

  private

  def compute_device_fingerprint
    self.device_fingerprint = self.class.compute_fingerprint(user_agent)
  end
end
