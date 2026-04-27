# frozen_string_literal: true

namespace :users do
  desc "Set a user's password. Usage: rails 'users:set_password[user@example.com]' (prompts for password)"
  task :set_password, [:email] => :environment do |_t, args|
    email = args[:email]
    abort "Usage: rails 'users:set_password[user@example.com]'" if email.blank?

    unless Revdoku.password_based_login?
      abort "REVDOKU_LOGIN_MODE is '#{Revdoku.login_mode}'. Password auth is disabled — this task only applies to `password` or `password_no_confirmation` installs."
    end

    user = User.find_by(email: email.downcase.strip)
    abort "No user found with email #{email}" unless user

    require "io/console"
    print "New password for #{user.email}: "
    new_password = $stdin.noecho(&:gets).to_s.chomp
    puts ""
    abort "Password must be at least 8 characters" if new_password.length < 8

    print "Confirm password: "
    confirm = $stdin.noecho(&:gets).to_s.chomp
    puts ""
    abort "Passwords don't match" unless new_password == confirm

    user.password = new_password
    user.password_confirmation = new_password
    user.confirm if user.respond_to?(:confirm) && !user.confirmed?
    user.unlock_access! if user.respond_to?(:unlock_access!) && user.access_locked?

    if user.save
      puts "Password updated for #{user.email}."
    else
      abort "Failed to save user: #{user.errors.full_messages.to_sentence}"
    end
  end
end
