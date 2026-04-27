# frozen_string_literal: true

ActiveAdmin.setup do |config|

  config.site_title = "Revdoku Admin"
  config.authentication_method = :authenticate_admin_user!
  config.current_user_method = :current_user
  config.logout_link_path = :destroy_user_session_path
  config.comments = false
  config.batch_actions = true
  config.filter_attributes = [:password, :password_confirmation]
  config.localize_format = :long

  # Bypass acts_as_tenant in admin controllers so all records are visible
  config.before_action do
    ActsAsTenant.current_tenant = nil
  end

  # Audit all admin panel access (HIPAA 164.312(b) / SOC2 CC7.2)
  config.after_action do
    next if request.path.start_with?("/admin/assets")

    AuditLog.create(
      path: request.path,
      response_code: response.status,
      source_type: "ADMIN",
      user_id: current_user&.prefix_id,
      ip: request.remote_ip,
      user_agent: request.user_agent&.truncate(100),
      request_id: request.request_id,
      request: { method: request.method, params: request.query_parameters.except(:controller, :action, :commit, :utf8, :authenticity_token) },
      response: { content_type: response.content_type, size: response.body.bytesize }
    )
  rescue => e
    Rails.logger.warn("Admin audit log failed: #{e.message}")
  end
end
