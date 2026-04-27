# frozen_string_literal: true

# Per-account AI provider API keys — encrypted JSON blob on the account.
#
# Shape of the decrypted attribute (see Account#ai_provider_keys):
#   {
#     "openai"     => { "api_key" => "...", "base_url" => nil,                 "enabled" => true },
#     "openrouter" => { "api_key" => "...", "base_url" => nil,                 "enabled" => true },
#     "custom_xyz" => { "api_key" => "...", "base_url" => "https://my-host/",  "enabled" => true },
#     # any provider key, any number — the shape intentionally accepts providers
#     # that aren't in ai_models.yml so operators can wire custom OpenAI-compatible
#     # endpoints.
#   }
#
# Encryption: `has_encrypted :ai_provider_keys, type: :json` in Account uses the
# account's per-account Lockbox key — the same key that protects checklist rules,
# check descriptions, DFR names, etc. Crypto-shredding the account wipes these
# keys transparently via the normal account-key-destruction path.
#
# Replaces the short-lived AccountAiKey row model (migration 20260422120000
# create_account_ai_keys, rolled back before this migration shipped). Consolidating
# to a single encrypted blob lets operators manage any number of providers without
# schema churn, which matters more than per-provider audit granularity in v1.
class AddAiProviderKeysToAccounts < ActiveRecord::Migration[8.1]
  def change
    add_column :accounts, :ai_provider_keys_ciphertext, :text
  end
end
