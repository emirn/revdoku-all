# frozen_string_literal: true

# ActsAsTenant configuration
# This gem provides multi-tenancy support by automatically scoping queries to the current tenant

ActsAsTenant.configure do |config|
  # Require a tenant to be set when accessing tenant-scoped models
  # This helps prevent data leakage between accounts
  config.require_tenant = true
end
