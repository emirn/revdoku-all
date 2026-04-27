# frozen_string_literal: true

# Database seed file.
#
# The bootstrap admin is created by
# apps/web/config/initializers/30_bootstrap_admin.rb from the env vars
# REVDOKU_BOOTSTRAP_ADMIN_EMAIL + REVDOKU_BOOTSTRAP_ADMIN_PASSWORD on
# Rails boot — there is intentionally no hardcoded user in this file.

puts "=" * 60
puts "Seeding Revdoku database..."
puts "=" * 60


# Sync global checklist templates from the shared text file. Idempotent
# and production-safe.
puts "\nSyncing checklist templates..."
Rake::Task['checklist_templates:sync'].invoke

# Beyond this point: development/test only. Production self-host installs
# get their first user from the bootstrap admin initializer.
if Rails.env.production?
  puts "Skipping demo seed in production environment."
  puts "First user is created from REVDOKU_BOOTSTRAP_ADMIN_EMAIL +"
  puts "REVDOKU_BOOTSTRAP_ADMIN_PASSWORD on Rails boot."
  puts "=" * 60
  return
end


puts "\nFirst admin will be created on Rails boot from"
puts "REVDOKU_BOOTSTRAP_ADMIN_EMAIL + REVDOKU_BOOTSTRAP_ADMIN_PASSWORD."

puts "\nSeeding completed."
