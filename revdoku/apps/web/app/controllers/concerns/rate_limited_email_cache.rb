# frozen_string_literal: true

# Provides helpers for rate-limiting cache keys that contain email addresses.
# Hashes emails with SHA256 so plain-text addresses are never stored in cache.
module RateLimitedEmailCache
  extend ActiveSupport::Concern

  private

  def hashed_email_cache_key(prefix, email)
    "#{prefix}:#{Digest::SHA256.hexdigest(email.to_s.downcase.strip)}"
  end

  def otp_send_count(email)
    Rails.cache.read(hashed_email_cache_key("otp_send_count", email)) || 0
  end

  def increment_otp_send_count(email)
    key = hashed_email_cache_key("otp_send_count", email)
    count = Rails.cache.read(key) || 0
    Rails.cache.write(key, count + 1, expires_in: 5.minutes)
  end
end
