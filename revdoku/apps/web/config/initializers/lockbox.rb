# frozen_string_literal: true

# Lockbox initializer. Encrypts every account's data with
# Lockbox.master_key. Fails fast at boot if LOCKBOX_MASTER_KEY isn't set
# so operators get a clear error instead of a cryptic "Missing master
# key" ArgumentError on the first encrypted write.

# Docker asset precompilation — no real secrets available, no encryption needed.
return if ENV["SECRET_KEY_BASE_DUMMY"]

if ENV["LOCKBOX_MASTER_KEY"].present?
  Lockbox.master_key = ENV["LOCKBOX_MASTER_KEY"]
else
  raise "LOCKBOX_MASTER_KEY must be set to run the app!"
end

# Master-key rotation support. Set LOCKBOX_PREVIOUS_MASTER_KEY to decrypt
# data written with the old key during a cutover.
if ENV["LOCKBOX_PREVIOUS_MASTER_KEY"].present?
  Lockbox.default_options[:previous_versions] = [
    { master_key: ENV["LOCKBOX_PREVIOUS_MASTER_KEY"] }
  ]
end
