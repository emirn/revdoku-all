# frozen_string_literal: true

# Insert the X-App-Version / X-App-Environment response-header middleware
# into the stack. Placed BEFORE Rails::Rack::Logger so the headers are set
# even on requests that error out before reaching a controller.
#
# Companion to Revdoku.app_version_string / app_revision / app_version_full
# defined in 00_revdoku.rb. Replaces the rails_app_version gem (unverified
# licence; blocks AGPL redistribution).

require "revdoku/app_info_middleware"

Rails.application.config.middleware.insert_before(
  Rails::Rack::Logger,
  Revdoku::AppInfoMiddleware
)
