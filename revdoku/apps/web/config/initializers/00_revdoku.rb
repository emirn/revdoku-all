# frozen_string_literal: true

module Revdoku
  # Admin notification email — the address that receives signup alerts,
  # subscription cancellations, etc. Operators may set one via the
  # initializer if they want signup alerts on self-host.
  mattr_accessor :admin_notification_email, default: nil
  mattr_accessor :notify_on_signup_sign_in, default: false

  # Default per-account limits applied to every account. Admin can
  # override per-account via ActiveAdmin. max_checklists = 12 gives 9
  # slots of headroom above the 3 templates auto-seeded by
  # DefaultChecklistLoader; the rest of the catalog is reachable via
  # AddChecklistDialog's template picker and each import consumes one
  # slot.
  DEFAULT_LIMITS = {
    max_envelopes: 10,
    max_revisions: 12,
    max_checklists: 12,
    max_file_size_mb: 20,
    max_team_members: 1
  }.freeze

  # Maximum number of ad-hoc reference files a user can attach to a
  # single review (on top of any #ref[...] slots the checklist already
  # defines). Ad-hoc refs are per-inspection, stored on the report's
  # encrypted inspection_context. Rails synthesises `#ref[file:…]`
  # markers for each ad-hoc ref so doc-api's existing token
  # substitution handles them uniformly — no special doc-api code path.
  # Kept low in v1 to bound prompt size and UI complexity; lift later
  # once we have signal on real usage.
  MAX_AD_HOC_REF_FILES = 1

  # Audit log retention floor, in days. Override at deploy time with
  # REVDOKU_AUDIT_RETENTION_DAYS; defaults to 14.
  AUDIT_RETENTION_DAYS_DEFAULT = (ENV["REVDOKU_AUDIT_RETENTION_DAYS"].presence || "14").to_i

  # Content Security Policy extension hook. Called by
  # config/initializers/content_security_policy.rb after the base policy
  # is built so deployments can append additional source domains.
  def self.extend_content_security_policy(_policy); end

  SUPPORTED_EDITIONS = %w[core].freeze
  EE_DIR = Rails.root.join("ee")

  def self.edition
    EE_DIR.exist? ? "ee" : "core"
  end

  def self.core_edition? = edition == "core"

  # Default IP allowlist for /admin access, consulted by AdminIpConstraint
  # when ADMIN_ALLOWED_IPS is not set. Returned as a list of CIDR strings
  # so the initializer has no runtime dependency on IPAddr. Self-host
  # default reaches /admin from any IP; operators can tighten via
  # ADMIN_ALLOWED_IPS.
  def self.admin_ip_default_cidrs
    ["0.0.0.0/0", "::/0"]
  end

  def self.hosted_cloud? = false
  def self.self_hosted? = !hosted_cloud?

  def self.google_auth_enabled?
    ENV.fetch("REVDOKU_GOOGLE_AUTH_ENABLED", "false").downcase.in?(%w[true 1 yes])
  end

  def self.registration_enabled?
    ENV.fetch("REVDOKU_REGISTRATION_ENABLED", "true").downcase.in?(%w[true 1 yes])
  end

  # Sign-in mode. One install uses exactly one method.
  #   otp                       — Email-OTP magic codes (requires SMTP).
  #   password                  — Email + password with Devise confirmation email
  #                                after signup (requires SMTP).
  #   password_no_confirmation  — Email + password, no confirmation email
  #                                (works offline / without SMTP).
  #
  # Default is password_no_confirmation so a freshly-copied env.example
  # works on localhost without SMTP. `default_login_mode` is a method (not
  # a constant) so deployments can redefine it from a later-loaded
  # initializer if a different default fits their posture.
  SUPPORTED_LOGIN_MODES = %w[otp password password_no_confirmation].freeze

  def self.default_login_mode
    "password_no_confirmation"
  end

  def self.login_mode
    raw = ENV["REVDOKU_LOGIN_MODE"].to_s.downcase.strip
    return raw if SUPPORTED_LOGIN_MODES.include?(raw)
    default_login_mode
  end

  # Legal / policy URLs shown in the footer. Each deployment is expected
  # to point these at its own hosted policies. When both are blank, the
  # footer renders a neutral open-source attribution to the GitHub
  # source tree instead of placeholder links. These are methods (not
  # mattr_accessor) so a later-loaded initializer can redefine them to
  # hard-code a deployment's URLs without touching ENV.
  def self.terms_url   = ENV["REVDOKU_TERMS_URL"].to_s.strip.presence
  def self.privacy_url = ENV["REVDOKU_PRIVACY_URL"].to_s.strip.presence

  # Instance-level AI data-residency region. When set (e.g. "us", "eu"),
  # high-security accounts have their alias resolution filtered to that
  # region's providers only.
  def self.data_residency_region = ENV["REVDOKU_DATA_RESIDENCY_REGION"].to_s.strip.downcase.presence

  # Support contact for end-user-facing error messages. Returning nil
  # suppresses the "contact ..." suffix in error strings.
  def self.support_email = nil

  def self.legal_urls_configured?
    [terms_url, privacy_url].any?
  end

  # Public source URL, shown as the footer fallback when no legal URLs
  # are configured (self-hosters who haven't filled in their own policies
  # get a clear "this is the open-source build" signal instead of broken
  # Terms/Privacy links).
  def self.source_code_url
    ENV.fetch("REVDOKU_SOURCE_CODE_URL", "https://github.com/revdoku/revdoku")
  end

  def self.login_mode_otp?                      = login_mode == "otp"
  def self.login_mode_password?                 = login_mode == "password"
  def self.login_mode_password_no_confirmation? = login_mode == "password_no_confirmation"
  def self.password_based_login?                = login_mode.start_with?("password")

  # True when we have an outbound SMTP setup able to deliver email. Used to
  # decide whether to expose Devise's `:recoverable` (password reset) and
  # `:confirmable` flows that depend on mailer delivery. SMTP_SERVER is set
  # in production via Kamal; in development the dev mailer delivers to a
  # file so we treat non-production as always-capable.
  def self.email_delivery_configured?
    return true unless Rails.env.production?
    ENV["SMTP_SERVER"].to_s.strip.present?
  end

  # Back-compat shim — old callers ask "is email-based auth enabled?" In the
  # new model "email auth" means OTP specifically, so map to that. Remove
  # after every call site migrates to the new predicates.
  def self.email_auth_enabled?
    login_mode_otp?
  end

  # Feature flag defaults live in config/features.yml. See that file for
  # per-flag documentation. Unknown flags resolve to false.
  #
  # No runtime env var overrides — flags are configuration, not deployment toggles.

  FEATURES_YAML_BASE = Rails.root.join("config", "features.yml")

  def self.load_features_config
    base = safe_load_features_yaml(FEATURES_YAML_BASE)
    baseline = (base["core"] || {}).dup
    # Symbolize keys so feature_enabled? calls match whatever the caller
    # passes (config sections come in as strings from YAML).
    baseline.transform_keys(&:to_sym).freeze
  end

  def self.safe_load_features_yaml(path)
    return {} unless File.exist?(path)
    raw = ERB.new(path.read).result
    YAML.safe_load(raw, aliases: true, permitted_classes: [Symbol]) || {}
  rescue => e
    Rails.logger.warn("[Revdoku] Failed to load features YAML at #{path}: #{e.class}: #{e.message}")
    {}
  end

  FEATURE_DEFAULTS = load_features_config

  def self.feature_enabled?(flag)
    !!FEATURE_DEFAULTS[flag.to_sym]
  end

  def self.feature_flags
    FEATURE_DEFAULTS.keys.each_with_object({}) do |flag, hash|
      hash[flag] = feature_enabled?(flag)
    end
  end

  # Thin wrappers around feature_enabled?. Kept as explicit methods so callers
  # can find gates by name and so we have a single site to extend semantics
  # later (e.g. owner-role-only, region-based allowlists).
  def self.byok_enabled?              = feature_enabled?(:byok_enabled)
  def self.byok_customizable_enabled? = feature_enabled?(:byok_customizable)
  def self.hipaa_mode_enabled?        = feature_enabled?(:hipaa_mode)

  # Deployment-wide AI catalog region. The catalog has a
  # `shared.regions.<name>` tree; this is the single region all model
  # resolution locks to.
  #
  # Resolution:
  #   1. REVDOKU_DEFAULT_REGION env var (operator override; must exist
  #      as a key under `shared.regions` in the active catalog).
  #   2. "any" — public providers + tenant-controlled Custom LLMs.
  DEFAULT_REGION = "any"

  def self.default_region
    env = ENV["REVDOKU_DEFAULT_REGION"].to_s.strip.presence
    return env if env
    return "us" if hosted_cloud?
    DEFAULT_REGION
  end

  # === App version ============================================================
  # Reads /VERSION at the monorepo root (one source of truth, bumped on each
  # release tag) and the current git short-SHA at boot. Production Docker
  # images bake the SHA into VERSION_COMMIT env so the git lookup works even
  # without a .git directory in the running container.
  #
  # Replaces the rails_app_version gem (license unverified — blocks AGPL
  # redistribution). Inline because the gem's full Version-class API was not
  # in use here; only `.to_s` / `.revision` / `.full` were called.

  def self.app_version_string
    @_app_version_string ||= begin
      candidates = [
        Rails.root.join("..", "..", "VERSION"),
        Rails.root.join("VERSION"),
      ]
      file = candidates.find(&:file?)
      (file ? file.read.strip : "0.0.0").presence || "0.0.0"
    end
  end

  def self.app_revision
    @_app_revision ||= begin
      env_sha = ENV["VERSION_COMMIT"].to_s.strip
      if env_sha.length >= 7
        env_sha.slice(0, 8)
      else
        git_sha = `git -C #{Rails.root.parent.parent.to_s.shellescape} rev-parse --short HEAD 2>/dev/null`.strip
        git_sha.presence || "unknown"
      end
    end
  end

  def self.app_version_full
    rev = app_revision
    rev == "unknown" ? app_version_string : "#{app_version_string} (#{rev})"
  end
end
