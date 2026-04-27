# frozen_string_literal: true

# Encryption-key resolver for any model that owns encrypted fields on
# behalf of an account. Encrypts with Lockbox.master_key.
module AccountEncryptable
  extend ActiveSupport::Concern

  def lockbox_encryption_key
    Lockbox.master_key
  end
end
