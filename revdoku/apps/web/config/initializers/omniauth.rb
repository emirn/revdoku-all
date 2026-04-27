# frozen_string_literal: true

# OmniAuth is configured through Devise in config/initializers/devise.rb
# The middleware below is not needed when using Devise's config.omniauth

OmniAuth.config.allowed_request_methods = [:post]
OmniAuth.config.silence_get_warning = true
