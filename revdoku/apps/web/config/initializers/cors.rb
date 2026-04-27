# frozen_string_literal: true

# CORS configuration for API access
# Be sure to restart your server when you modify this file.

# Avoid CORS issues when API is called from the frontend app.
# Handle Cross-Origin Resource Sharing (CORS) in order to accept cross-origin AJAX requests.

# Read more: https://github.com/cyu/rack-cors

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    if Rails.env.development?
      origins ENV.fetch("RAILS_CORS_ORIGINS", "http://localhost:3000,https://localhost:3000,http://localhost:3036").split(",")
    else
      # In production, allow the app's own domain
      allowed = [ENV.fetch("APP_HOST", "localhost")]
      allowed += ENV.fetch("RAILS_CORS_ORIGINS", "").split(",").map(&:strip).reject(&:empty?)
      origins(*allowed.map { |h| "https://#{h}" })
    end

    resource "/api/*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head],
      credentials: true,
      max_age: 86400

    # Also allow manifest endpoint
    resource "/envelopes/manifest",
      headers: :any,
      methods: [:get, :options],
      credentials: true
  end
end
