# frozen_string_literal: true

# Adds two informational response headers to every HTTP response:
#
#   X-App-Version       — "<version> (<short-sha>)" e.g. "1.0.77 (457e793)"
#   X-App-Environment   — Rails.env value
#
# Used by the frontend (apps/web/app/frontend/src/app/layout.tsx) to display
# the running version in the footer, and by ops to confirm at-a-glance which
# build is deployed when reading server access logs.
#
# Replaces RailsAppVersion::AppInfoMiddleware from the rails_app_version gem
# whose distribution licence is unstated — see config/initializers/40_app_version.rb.
module Revdoku
  class AppInfoMiddleware
    def initialize(app)
      @app = app
    end

    def call(env)
      status, headers, response = @app.call(env)
      headers["X-App-Version"]     = Revdoku.app_version_full
      headers["X-App-Environment"] = Rails.env.to_s
      [status, headers, response]
    end
  end
end
