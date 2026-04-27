class ApplicationMailer < ActionMailer::Base
  # Default from-address. Override by setting MAILER_SENDER in the environment.
  default from: ENV.fetch("MAILER_SENDER", "noreply@localhost")
  layout "mailer"
end
