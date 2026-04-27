# frozen_string_literal: true

class UserMailer < ApplicationMailer
  def login_otp(user, code)
    @user = user
    @code = code
    mail(to: user.email, subject: "Your Revdoku login code")
  end

  def confirmation_otp(user, code)
    @user = user
    @code = code
    mail(to: user.email, subject: "Confirm your Revdoku email")
  end

  def login_notification(user, login_history, new_device: true)
    @user = user
    @login_history = login_history
    @signed_in_at = login_history.signed_in_at
    @new_device = new_device
    @show_ip = user.has_high_security_account?
    @ip_address = login_history.ip_address
    @user_email = user.email
    @device_summary = login_history.device_display

    subject = @new_device ? "New device sign-in to your Revdoku account" : "New sign-in to your Revdoku account"
    mail(to: user.email, subject: subject)
  end

  def account_exists(user, user_agent = nil)
    @user = user
    @sign_in_url = new_user_session_url
    if user_agent.present?
      info = LoginHistory.parse_user_agent(user_agent)
      @device_summary = "#{info['browser']} on #{info['os']}"
    end
    mail(to: user.email, subject: "Sign in to your Revdoku account")
  end

  def signup_notification(user)
    # No admin email configured (core default) → nothing to notify.
    return if Revdoku.admin_notification_email.blank?

    @user = user
    mail(
      to: Revdoku.admin_notification_email,
      subject: "[Revdoku] New Signup",
      reply_to: user.email
    )
  end

end
