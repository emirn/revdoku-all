# frozen_string_literal: true

class Users::OtpSessionsController < DeviseController
  include Devise::Controllers::Rememberable
  include RateLimitedEmailCache

  layout "devise"

  before_action :ensure_email_auth_enabled!, only: [:create]

  # GET /users/sign_in
  def new
    return redirect_to after_sign_in_path_for(current_user) if user_signed_in?

    # When redirected from Google OAuth, show the OTP verify page directly
    if params[:oauth_verified].present? && params[:email].present?
      @email = params[:email]
      return render :verify
    end
  end

  # POST /users/sign_in
  def create
    email = params[:email]&.downcase&.strip
    @email = email

    if email.blank?
      flash.now[:alert] = "Please enter your email address."
      return render :new, status: :unprocessable_entity
    end

    user = User.find_by(email: email)

    if user
      # Rate limit: max 3 OTP sends per email per 5 minutes
      sent_count = otp_send_count(email)
      if sent_count >= 3
        flash.now[:alert] = "Too many code requests. Please wait a few minutes."
        return render :new, status: :too_many_requests
      end

      code = user.generate_login_otp!
      increment_otp_send_count(email)
      UserMailer.login_otp(user, code).deliver_later
      Rails.logger.info("[OTP] Login code sent to #{email}")
    else
      Rails.logger.info("[OTP] Login code requested for unknown email #{email}")
    end

    # Paranoid mode: always show "code sent" regardless of email existence
    flash.now[:notice] = "If this email is registered, a 6-digit code was sent to #{email}."
    render :verify, status: :unprocessable_entity
  end

  # POST /users/sign_in/verify
  def verify
    email = params[:email]&.downcase&.strip
    code = params[:code]&.strip
    @email = email

    if email.blank? || code.blank?
      flash.now[:alert] = "Please enter your email and verification code."
      return render :verify, status: :unprocessable_entity
    end

    user = User.find_by(email: email)

    if user&.verify_login_otp(code)
      Rails.logger.info("[OTP] Login code verified for #{email}")

      # OTP verification proves email ownership — confirm if not yet confirmed
      unless user.confirmed?
        user.confirm
        user.personal_account&.complete_setup!
      end

      if user.two_factor_enabled?
        # Store user ID in session for 2FA verification step
        session[:otp_pending_user_id] = user.id
        return render :two_factor
      end

      sign_in(:user, user, event: :authentication)
      remember_me(user)
      redirect_to post_login_path(user)
    else
      Rails.logger.warn("[OTP] Failed login code verification for #{email}")
      flash.now[:alert] = "Invalid or expired code. Please try again."
      render :verify, status: :unprocessable_entity
    end
  end

  # POST /users/sign_in/two_factor
  def two_factor_verify
    user = User.find_by(id: session[:otp_pending_user_id])

    unless user
      redirect_to new_user_session_path, alert: "Session expired. Please sign in again."
      return
    end

    if user.verify_otp(params[:otp_attempt])
      session.delete(:otp_pending_user_id)
      sign_in(:user, user, event: :authentication)
      remember_me(user)
      redirect_to post_login_path(user)
    else
      flash.now[:alert] = "Invalid verification code. Please try again."
      render :two_factor, status: :unprocessable_entity
    end
  end

  private

  # Redirect to 2FA setup if any of user's accounts require it and they haven't set it up
  def post_login_path(user)
    if user.has_high_security_account? && !user.two_factor_enabled?
      flash[:alert] = "Your account requires two-factor authentication. Please set it up to continue."
      users_two_factor_authentication_path
    else
      after_sign_in_path_for(user)
    end
  end

  def ensure_email_auth_enabled!
    unless Revdoku.login_mode_otp?
      redirect_to new_user_session_path, alert: "Email OTP sign-in is not available on this instance."
    end
  end

end
