# frozen_string_literal: true

# Boot-time audit of AI-provider env keys.
#
# Walks every catalog row in AiModelResolver.providers_hash and inspects
# ENV[<PROVIDER>_API_KEY]. Three states matter:
#
#   - present + non-empty → reachable via env (BYOK keys still layer on top).
#   - present + empty ("")  → almost certainly an oversight: the operator
#                              left the line in but forgot to fill it. .present?
#                              treats this as "not configured" (correct), but
#                              silently — so we log a warning here so the user
#                              can see why their provider stayed disabled.
#   - absent (no key)        → silently skipped; this is the documented
#                              BYOK-only path in Core.
#
# Skip in tests to keep the test log quiet.
Rails.application.config.after_initialize do
  next if Rails.env.test?
  # bin/dev's pre-foreman invocations (db:migrate + secondary-schema runner)
  # set this so the audit only prints once — from the foreman-launched web
  # process operators actually watch. Unset everywhere else, so production
  # boots and standalone `bin/rails console` still emit the audit.
  next if ENV["REVDOKU_SKIP_BOOT_BANNERS"] == "1"

  # Use STDERR (always tty-visible in dev / always captured by foreman in
  # production) in addition to Rails.logger. In dev, Rails.logger writes to
  # log/development.log unless RAILS_LOG_TO_STDOUT=true is set, which means
  # boot-time audit lines would be invisible on the bin/dev console — exactly
  # the place an operator looks first to see whether their config worked.
  emit = ->(level, msg) {
    $stderr.puts("[Revdoku] #{msg}")
    Rails.logger.public_send(level, "[Revdoku] #{msg}")
  }

  available = []
  unavailable = []

  AiModelResolver.providers_hash.each do |provider_key, _provider|
    name = AiModelResolver.api_key_env_var(provider_key)
    raw  = ENV[name]

    if raw.is_a?(String) && raw.strip.empty? && ENV.key?(name)
      emit.call(:warn,
        "#{name} is set to an empty string in the environment; provider " \
        "'#{provider_key}' is reported as unavailable. Either fill in a " \
        "real key or remove the line from .env.local. Per-account BYOK " \
        "keys (Account → AI → Providers) still work independently."
      )
      unavailable << provider_key.to_s
    elsif raw.to_s.strip.empty?
      unavailable << provider_key.to_s
    else
      available << provider_key.to_s
    end
  end

  emit.call(:info,
    "AI providers from ENV — reachable: " \
    "#{available.empty? ? '(none)' : available.join(', ')}; " \
    "missing: #{unavailable.empty? ? '(none)' : unavailable.join(', ')}. " \
    "Per-account BYOK keys, if any, layer on top per-request."
  )
rescue StandardError => e
  # Never let an audit failure break boot — the catalog file may be malformed
  # in some odd dev state, but we still want the app to come up.
  $stderr.puts("[Revdoku] AI provider key audit skipped: #{e.class}: #{e.message}")
  Rails.logger.warn("[Revdoku] AI provider key audit skipped: #{e.class}: #{e.message}")
end
