require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Settings specified here will take precedence over those in config/application.rb.

  # Code is not reloaded between requests.
  config.enable_reloading = false

  # Eager load code on boot for better performance and memory savings (ignored by Rake tasks).
  config.eager_load = true

  # Full error reports are disabled.
  config.consider_all_requests_local = false

  # Turn on fragment caching in view templates.
  config.action_controller.perform_caching = true

  # Cache assets for far-future expiry since they are all digest stamped.
  config.public_file_server.headers = { "cache-control" => "public, max-age=#{1.year.to_i}" }

  # Enable serving of images, stylesheets, and JavaScripts from an asset server.
  # config.asset_host = "http://assets.example.com"

  # ActiveStorage backend. Defaults to :local (persistent Docker volume
  # at /rails/storage). Operators can switch to :amazon by setting
  # ACTIVE_STORAGE_SERVICE=amazon and providing AWS credentials.
  config.active_storage.service = ENV.fetch("ACTIVE_STORAGE_SERVICE", "local").to_sym

  # HTTPS redirect: OFF by default — docker-compose has no TLS proxy in
  # front. Operators who put the container behind an SSL-terminating
  # reverse proxy (nginx / Caddy / Cloudflare / traefik) can turn this on
  # by setting REVDOKU_FORCE_SSL=true in their .env.
  config.force_ssl = ENV.fetch("REVDOKU_FORCE_SSL", "false").downcase.in?(%w[true 1 yes])

  # ActiveStorage variant processor — the image_processing gem was removed
  # (no code path calls `.variant(…)`). Tell Rails not to warn about it.
  config.active_storage.variant_processor = :disabled

  # Skip http-to-https redirect for the default health check endpoint.
  # config.ssl_options = { redirect: { exclude: ->(request) { request.path == "/up" } } }

  # Log to STDOUT with the current request id as a default log tag.
  config.log_tags = [ :request_id ]
  config.logger   = ActiveSupport::TaggedLogging.logger(STDOUT)

  # Change to "debug" to log everything (including potentially personally-identifiable information!)
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")

  # Prevent health checks from clogging up the logs.
  config.silence_healthcheck_path = "/up"

  # Don't log any deprecations.
  config.active_support.report_deprecations = false

  # Replace the default in-process memory cache store with a durable alternative.
  config.cache_store = :solid_cache_store

  # Replace the default in-process and non-durable queuing backend for Active Job.
  config.active_job.queue_adapter = :solid_queue
  config.solid_queue.connects_to = { database: { writing: :queue } }

  # Raise delivery errors only when SMTP is actually wired up. A self-host
  # instance without a mailer should fail silently on Devise emails etc.
  # instead of 500ing every request that touches the mailer.
  config.action_mailer.raise_delivery_errors = ENV["SMTP_SERVER"].present?

  # Email via SMTP. Configured only when SMTP_SERVER is set (hosted cloud always
  # sets it via Kamal secrets). Skip during Docker builds (SECRET_KEY_BASE_DUMMY
  # is present during asset precompilation).
  if ENV["SECRET_KEY_BASE_DUMMY"].blank? && ENV["SMTP_SERVER"].present?
    config.action_mailer.delivery_method = :smtp
    config.action_mailer.smtp_settings = {
      address: ENV.fetch("SMTP_SERVER"),
      port: ENV.fetch("SMTP_PORT", 587).to_i,
      domain: ENV.fetch("SMTP_DOMAIN") { ENV.fetch("APP_HOST", "localhost") },
      user_name: ENV.fetch("SMTP_USERNAME"),
      password: ENV.fetch("SMTP_PASSWORD"),
      authentication: :plain,
      enable_starttls_auto: true
    }
  end
  # Mailer URL host/protocol read from env. Defaults to plain HTTP on
  # localhost; deployments set APP_HOST + APP_PROTOCOL via env to their
  # real domain + https.
  config.action_mailer.default_url_options = {
    host:     ENV.fetch("APP_HOST", "localhost"),
    protocol: ENV.fetch("APP_PROTOCOL", "http")
  }

  # Enable locale fallbacks for I18n (makes lookups for any locale fall back to
  # the I18n.default_locale when a translation cannot be found).
  config.i18n.fallbacks = true

  # Do not dump schema after migrations.
  config.active_record.dump_schema_after_migration = false

  # Only use :id for inspections in production.
  config.active_record.attributes_for_inspect = [ :id ]

end
