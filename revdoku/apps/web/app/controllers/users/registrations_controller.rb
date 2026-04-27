# frozen_string_literal: true

class Users::RegistrationsController < Devise::RegistrationsController
  include Devise::Controllers::Rememberable
  include RateLimitedEmailCache

  layout "devise"

  before_action :ensure_registration_enabled!, only: [:new, :create]

  # POST /users
  def create
    build_resource(sign_up_params)


    if Revdoku.login_mode_password_no_confirmation?
      # Local / offline self-host: no mailer, no confirmation step.
      resource.skip_confirmation! if resource.respond_to?(:skip_confirmation!)
      resource.save

      if resource.persisted?
        resource.personal_account&.complete_setup!
        sign_in(:user, resource, event: :authentication)
        remember_me(resource)
        return redirect_to after_sign_in_path_for(resource)
      end
    elsif Revdoku.login_mode_password?
      # Self-host with SMTP: Devise sends its standard confirmation email and
      # the user signs in with password after clicking the link.
      resource.save

      if resource.persisted?
        if resource.confirmed? || !resource.respond_to?(:confirmation_required?) || !resource.confirmation_required?
          sign_in(:user, resource, event: :authentication)
          remember_me(resource)
          return redirect_to after_sign_in_path_for(resource)
        end
        flash[:notice] = "A confirmation email has been sent. Please check your inbox to finish signing up."
        return redirect_to new_user_session_path
      end
    else
      # OTP mode (cloud). Save unconfirmed user and send the OTP code.
      resource.skip_confirmation_notification! if resource.respond_to?(:skip_confirmation_notification!)
      resource.save

      if resource.persisted?
        code = resource.generate_login_otp!
        UserMailer.confirmation_otp(resource, code).deliver_later
        Rails.logger.info("[OTP] Confirmation code sent to #{resource.email}")

        session[:confirmation_email] = resource.email
        return redirect_to users_confirm_email_path
      end
    end

    # Persist failed — either duplicate email (handled separately) or
    # validation errors surfaced back to the form.
    existing = find_existing_user(resource.email)
    if existing && Revdoku.login_mode_otp?
      handle_email_conflict(resource, existing)
    else
      clean_up_passwords resource
      respond_with resource
    end
  end

  # GET /users/confirm_email
  def confirm_email
    @email = session[:confirmation_email]
    unless @email
      redirect_to new_user_registration_path, alert: "Please sign up first."
      return
    end
  end

  # POST /users/confirm_email/verify
  def verify_confirmation
    email = params[:email]&.downcase&.strip
    code = params[:code]&.strip
    @email = email

    if email.blank? || code.blank?
      flash.now[:alert] = "Please enter your verification code."
      return render :confirm_email, status: :unprocessable_entity
    end

    user = User.find_by(email: email)

    if user&.verify_login_otp(code)
      Rails.logger.info("[OTP] Confirmation code verified for #{email}")

      user.confirm unless user.confirmed?
      user.personal_account&.complete_setup!

      session.delete(:confirmation_email)
      session.delete(:utm_params)
      sign_in(:user, user, event: :authentication)
      remember_me(user)
      redirect_to after_sign_in_path_for(user)
    else
      Rails.logger.warn("[OTP] Failed confirmation code verification for #{email}")
      flash.now[:alert] = "Invalid or expired code. Please try again."
      render :confirm_email, status: :unprocessable_entity
    end
  end

  # POST /users/confirm_email/resend
  def resend_confirmation
    @email = session[:confirmation_email]

    unless @email
      redirect_to new_user_registration_path, alert: "Please sign up first."
      return
    end

    user = User.find_by(email: @email)

    if user
      sent_count = otp_send_count(@email)
      if sent_count >= 3
        flash.now[:alert] = "Too many code requests. Please wait a few minutes."
        return render :confirm_email, status: :too_many_requests
      end

      code = user.generate_login_otp!
      increment_otp_send_count(@email)
      UserMailer.confirmation_otp(user, code).deliver_later
      Rails.logger.info("[OTP] Confirmation code resent to #{@email}")
    end

    flash.now[:notice] = "A new code has been sent to #{@email}."
    render :confirm_email
  end

  protected

  def build_resource(hash = {})
    if session[:utm_params].present?
      hash.merge!(session[:utm_params].slice(*ApplicationController::UTM_KEYS))
    end

    super(hash)
  end

  def update_resource(resource, params)
    params.delete(:current_password)
    resource.update(params)
  end

  def after_sign_up_path_for(resource)
    session.delete(:utm_params)
    stored_location_for(resource) || root_path
  end

  def after_inactive_sign_up_path_for(resource)
    session.delete(:utm_params)
    stored_location_for(resource) || root_path
  end

  private

  def ensure_registration_enabled!
    unless Revdoku.registration_enabled?
      redirect_to new_user_session_path, alert: "Registration is currently closed."
    end
  end


  def find_existing_user(email)
    return nil if email.blank?
    canonical = User.canonicalize_email(email)
    User.find_by(email_canonical: canonical) if canonical
  end

  # Redirect to confirm page without revealing whether the email exists.
  # If an existing account is found, notify the real owner via rate-limited email.
  def handle_email_conflict(resource, existing_user)
    email = resource.email&.downcase&.strip

    cache_key = hashed_email_cache_key("signup_conflict", email)
    sent_count = Rails.cache.read(cache_key) || 0
    if sent_count < 2
      UserMailer.account_exists(existing_user, request.user_agent).deliver_later
      Rails.cache.write(cache_key, sent_count + 1, expires_in: 15.minutes)
      Rails.logger.info("[SIGNUP] Account-exists email sent for #{email}")
    else
      Rails.logger.info("[SIGNUP] Rate-limited account-exists email for #{email}")
    end

    session[:confirmation_email] = email
    redirect_to users_confirm_email_path
  end
end
