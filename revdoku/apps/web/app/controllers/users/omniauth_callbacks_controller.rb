# frozen_string_literal: true

class Users::OmniauthCallbacksController < Devise::OmniauthCallbacksController
  include Devise::Controllers::Rememberable

  def google_oauth2
    unless Revdoku.google_auth_enabled?
      redirect_to root_path, alert: "Google authentication is not enabled."
      return
    end

    handle_auth "Google"
  end

  def failure
    redirect_to root_path, alert: "Authentication failed: #{failure_message}"
  end

  private

  def handle_auth(kind)
    @user = User.from_omniauth(request.env["omniauth.auth"], utm_params: session[:utm_params] || {})
    session.delete(:utm_params)

    if @user.persisted?
      if @user.has_high_security_account?
        # High-security accounts require email OTP even after OAuth.
        # This adds an extra verification layer for HIPAA-grade compliance.
        code = @user.generate_login_otp!
        UserMailer.login_otp(@user, code).deliver_later
        Rails.logger.info("[OTP] Login code sent to #{@user.email} via #{kind} OAuth flow (high-security)")

        flash[:notice] = "We sent a 6-digit code to #{@user.email}. Check your inbox."
        redirect_to new_user_session_path(email: @user.email, oauth_verified: true)
      else
        # Regular accounts: Google already verified identity, sign in directly.
        flash[:notice] = "Signed in with #{kind}."
        sign_in @user, event: :authentication
        remember_me(@user)
        redirect_to after_sign_in_path_for(@user)
      end
    else
      unless Revdoku.registration_enabled?
        redirect_to new_user_session_path, alert: "Registration is currently closed."
        return
      end
      session["devise.oauth_data"] = request.env["omniauth.auth"].except(:extra)
      redirect_to new_user_registration_url, alert: @user.errors.full_messages.join("\n")
    end
  rescue ActiveRecord::RecordInvalid
    redirect_to new_user_registration_path, alert: "This email domain is not supported."
  end
end
