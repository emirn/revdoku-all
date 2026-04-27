# frozen_string_literal: true

class ApplicationController < ActionController::Base
  include Pundit::Authorization

  UTM_KEYS = %w[utm_source utm_medium utm_campaign utm_content utm_term].freeze

  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  layout :layout_by_resource

  before_action :set_security_headers
  before_action :capture_utm_params
  before_action :configure_permitted_parameters, if: :devise_controller?
  before_action :set_current_context

  def authenticate_admin_user!
    authenticate_user!
    redirect_to root_path, alert: "Unauthorized" unless current_user&.admin?
  end

  protected

  def capture_utm_params
    utm = params.slice(*UTM_KEYS).permit(*UTM_KEYS).to_h.compact_blank
    session[:utm_params] = utm if utm.present?
  end

  def configure_permitted_parameters
    devise_parameter_sanitizer.permit(:sign_up, keys: [:first_name, :last_name, *UTM_KEYS.map(&:to_sym)])
    devise_parameter_sanitizer.permit(:account_update, keys: [:first_name, :last_name, :avatar])
  end

  def set_current_context
    return unless user_signed_in?

    Principal.user = current_user
    Principal.account = current_account
    Principal.account_member = current_account&.members&.find_by(user: current_user)

    ActsAsTenant.current_tenant = Principal.account if Principal.account
  end

  def current_account
    @current_account ||= begin
      account_id = session[:current_account_id]
      if account_id
        current_user.accounts.find_by(id: account_id)
      end || current_user.personal_account
    end
  end
  helper_method :current_account

  def after_sign_in_path_for(resource)
    if resource.is_a?(User) && resource.accounts.count > 1 && !session[:current_account_id]
      select_account_path
    else
      stored_location_for(resource) || authenticated_root_path
    end
  end

  def after_sign_out_path_for(_resource_or_scope)
    new_user_session_path
  end

  private

  def set_security_headers
    response.set_header("Referrer-Policy", "strict-origin-when-cross-origin")
    response.set_header("X-Content-Type-Options", "nosniff")
    response.set_header("X-Frame-Options", "DENY")
  end

  def layout_by_resource
    if devise_controller?
      "devise"
    else
      "application"
    end
  end
end
