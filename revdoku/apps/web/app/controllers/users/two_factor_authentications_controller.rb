# frozen_string_literal: true

class Users::TwoFactorAuthenticationsController < ApplicationController
  layout "devise"
  before_action :authenticate_user!

  def show
    if current_user.two_factor_enabled?
      # Show management page (enabled status + disable option)
    else
      # Setup flow: generate secret, show QR + verify form
      setup_two_factor
    end
  end

  def create
    if current_user.verify_otp(params[:otp_attempt])
      current_user.enable_two_factor!
      @backup_codes = current_user.generate_otp_backup_codes!
      flash.now[:notice] = "Two-factor authentication enabled successfully."
      render :backup_codes
    else
      setup_two_factor
      flash.now[:alert] = "Invalid verification code. Please try again."
      render :show, status: :unprocessable_entity
    end
  end

  def destroy
    if current_user.verify_otp(params[:otp_attempt])
      current_user.disable_two_factor!
      redirect_to users_two_factor_authentication_path, notice: "Two-factor authentication disabled."
    else
      flash.now[:alert] = "Invalid verification code."
      render :show, status: :unprocessable_entity
    end
  end

  private

  def setup_two_factor
    current_user.otp_secret ||= ROTP::Base32.random
    current_user.save!
    @qr_code = generate_qr_code
  end

  def generate_qr_code
    RQRCode::QRCode.new(current_user.provisioning_uri).as_svg(
      color: "000",
      shape_rendering: "crispEdges",
      module_size: 4,
      standalone: true,
      use_path: true
    )
  end
end
