# frozen_string_literal: true

# Seeds a confirmed global-admin user from env vars on boot. Intended for
# self-host quickstarts where the operator wants to log in immediately
# without configuring SMTP or running a rake task.
#
# Runs only when BOTH env vars are present:
#   REVDOKU_BOOTSTRAP_ADMIN_EMAIL
#   REVDOKU_BOOTSTRAP_ADMIN_PASSWORD   (min 8 chars, enforced by Devise)
#
# Idempotent: `find_or_create_by` on email. A second boot with the same
# vars is a no-op. If the user already exists but isn't admin/confirmed,
# the seeder does not modify them — operator must manage their own state
# after first login, and can remove the vars.
#
# Never runs on the hosted cloud (multi-tenant, no global admin) or in OTP
# login mode (password is required for this path).
module Revdoku
  module BootstrapAdmin
    ENV_EMAIL    = "REVDOKU_BOOTSTRAP_ADMIN_EMAIL"
    ENV_PASSWORD = "REVDOKU_BOOTSTRAP_ADMIN_PASSWORD"
    ENV_FIRST    = "REVDOKU_BOOTSTRAP_ADMIN_FIRST_NAME"
    ENV_LAST     = "REVDOKU_BOOTSTRAP_ADMIN_LAST_NAME"

    module_function

    def eligible?
      Revdoku.self_hosted? &&
        Revdoku.password_based_login? &&
        ENV[ENV_EMAIL].to_s.strip.present? &&
        ENV[ENV_PASSWORD].to_s.strip.present?
    end

    def call
      return unless eligible?

      email    = ENV[ENV_EMAIL].to_s.strip.downcase
      password = ENV[ENV_PASSWORD].to_s
      first    = ENV[ENV_FIRST].to_s.strip.presence || "Admin"
      last     = ENV[ENV_LAST].to_s.strip.presence  || "User"

      existing = User.find_by(email: email)
      if existing
        # Detect the most common "I changed the env but can't log in" case:
        # the operator rotated REVDOKU_BOOTSTRAP_ADMIN_PASSWORD but the
        # user row was created on a previous boot with a different password.
        # Idempotent-by-email seeding means we won't silently overwrite the
        # in-app password, but we CAN shout about the disconnect so they
        # know why their new env password isn't working.
        if existing.respond_to?(:valid_password?) && !existing.valid_password?(password)
          Rails.logger.warn(
            "[Bootstrap] Admin user #{email.inspect} exists with a DIFFERENT " \
            "password than REVDOKU_BOOTSTRAP_ADMIN_PASSWORD. The env password " \
            "is NOT applied to pre-existing users (the seed is idempotent by " \
            "email). If you forgot the current password, you have two options:" \
            " (A) open a Rails console inside the container and run " \
            "`User.find_by(email: #{email.inspect}).update!(password: " \
            "ENV['REVDOKU_BOOTSTRAP_ADMIN_PASSWORD'])` — this preserves all " \
            "your data; or (B, DESTRUCTIVE) wipe the database with " \
            "`docker compose down -v` and re-run ./bin/start — this DELETES " \
            "every envelope, report, and upload on this instance."
          )
        else
          Rails.logger.info(
            "[Bootstrap] Admin user already exists; skipping seed." \
            " email=#{email.inspect}"
          )
        end
        return existing
      end

      user = User.new(
        email: email,
        password: password,
        password_confirmation: password,
        first_name: first,
        last_name: last,
        admin: true
      )
      user.skip_confirmation! if user.respond_to?(:skip_confirmation!)
      user.skip_confirmation_notification! if user.respond_to?(:skip_confirmation_notification!)

      if user.save
        Rails.logger.info(
          "[Bootstrap] Seeded admin user from env." \
          " email=#{email.inspect} user_id=#{user.id}"
        )

        # Run the same post-signup flow that email confirmation / OAuth fire:
        # default checklists, default tags, sample envelope with a completed
        # report. Without this call, Core users get an empty app because
        # skip_confirmation! short-circuits the Devise after_confirmation
        # path that normally triggers complete_setup!.
        begin
          personal = user.reload.personal_account
          if personal && !personal.setup_completed?
            personal.complete_setup!
            Rails.logger.info(
              "[Bootstrap] Ran complete_setup! on personal account." \
              " account_id=#{personal.id}"
            )
          end
        rescue => e
          Rails.logger.error(
            "[Bootstrap] complete_setup! raised — the admin user exists but " \
            "default checklists / sample envelope may be missing. " \
            "error=#{e.class}: #{e.message}"
          )
        end
      else
        Rails.logger.error(
          "[Bootstrap] Failed to seed admin user from env." \
          " email=#{email.inspect} errors=#{user.errors.full_messages.inspect}"
        )
      end

      user
    end
  end
end
