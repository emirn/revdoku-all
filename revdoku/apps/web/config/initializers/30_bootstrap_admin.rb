# frozen_string_literal: true

# Self-host quickstart: when REVDOKU_BOOTSTRAP_ADMIN_EMAIL + _PASSWORD are
# both set, seed a confirmed global-admin user on boot so the operator can
# log in without configuring SMTP or running a rake task.
#
# Also emits a single warning at boot if the instance is configured for
# `password` mode without reachable SMTP — in that state signups can't
# confirm, so the operator needs to either configure SMTP, use the
# bootstrap vars above, or explicitly opt into `password_no_confirmation`.

require "revdoku/bootstrap_admin"

Rails.application.config.after_initialize do
  # Skip when the schema isn't loaded yet — happens on first boot, where
  # docker-entrypoint runs `rails db:prepare` before tables exist. The
  # bootstrap admin seed will run on the NEXT boot after migrations land,
  # which matches the operator's expectation of "set env vars, restart".
  # Also covers asset:precompile (SECRET_KEY_BASE_DUMMY) and any rake task
  # that loads the env before migrations.
  users_ready = ActiveRecord::Base.connection.data_source_exists?("users") rescue false

  Revdoku::BootstrapAdmin.call if users_ready && Revdoku::BootstrapAdmin.eligible?

  # Post-login security nag. Companion to the generic "remove after first
  # login" warning in bin/preflight-env (which has no DB access). When the
  # bootstrap user has actually signed in at least once AND the env vars
  # are still set, log a targeted reminder every boot until the operator
  # removes them. The text names the user and last sign-in time so it's
  # actionable rather than just noise.
  if users_ready && ENV["REVDOKU_BOOTSTRAP_ADMIN_EMAIL"].to_s.strip.present? && ENV["REVDOKU_BOOTSTRAP_ADMIN_PASSWORD"].to_s.strip.present?
    email = ENV["REVDOKU_BOOTSTRAP_ADMIN_EMAIL"].to_s.strip.downcase
    user = User.find_by(email: email) rescue nil
    if user && ((user.respond_to?(:sign_in_count) && user.sign_in_count.to_i > 0) || (user.respond_to?(:last_sign_in_at) && user.last_sign_in_at.present?))
      last_at = user.respond_to?(:last_sign_in_at) ? user.last_sign_in_at&.iso8601 : nil
      msg = "[Revdoku] REVDOKU_BOOTSTRAP_ADMIN_PASSWORD is still set in .env.local but #{email} has already signed in" \
            "#{last_at ? " (last sign-in: #{last_at})" : ""}. Remove both " \
            "REVDOKU_BOOTSTRAP_ADMIN_EMAIL and REVDOKU_BOOTSTRAP_ADMIN_PASSWORD from .env.local and restart " \
            "— the user persists in the database."
      $stderr.puts msg
      Rails.logger.warn msg
    end
  end

  if Revdoku.login_mode_password? && !Revdoku.email_delivery_configured?
    Rails.logger.warn(
      "[Revdoku] REVDOKU_LOGIN_MODE=password but no SMTP is configured. " \
      "New signups cannot confirm their email address. Options: " \
      "(1) configure SMTP (SMTP_SERVER / SMTP_USER / SMTP_PASSWORD), " \
      "(2) seed an admin with REVDOKU_BOOTSTRAP_ADMIN_EMAIL + REVDOKU_BOOTSTRAP_ADMIN_PASSWORD, " \
      "or (3) set REVDOKU_LOGIN_MODE=password_no_confirmation for airgapped / single-user installs."
    )
  end
end
