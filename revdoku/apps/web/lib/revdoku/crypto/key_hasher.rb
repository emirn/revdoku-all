# frozen_string_literal: true

module Revdoku
  module Crypto
    # Hashes API key secrets for constant-lookup storage. Extracted from the
    # ApiKey model so the hashing concern lives independently of the record
    # schema (allows rotation to a different algorithm without touching the
    # model's public API).
    module KeyHasher
      DIGEST = ::Digest::SHA256

      def self.digest(raw)
        DIGEST.hexdigest(raw.to_s)
      end

      def self.matches?(raw, hash)
        raw.present? && hash.present? &&
          ActiveSupport::SecurityUtils.secure_compare(digest(raw), hash)
      end
    end
  end
end
