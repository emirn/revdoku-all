# frozen_string_literal: true

class Api::V1::VersionsController < Api::BaseController
  skip_after_action :verify_authorized # Read-only audit trail, access scoped by account_id check
  skip_after_action :record_audit_log

  RESOURCE_TYPES = {
    "envelope" => Envelope,
    "checklist" => Checklist,
    "check" => Check,
    "report" => Report
  }.freeze

  # GET /api/v1/versions/:resource_type/:resource_id
  # Version tracking is handled via API audit logs (AuditLog).
  # This endpoint is preserved for API compatibility.
  def show
    model_class = RESOURCE_TYPES[params[:resource_type]]
    unless model_class
      render_api_error("Unknown resource type", code: "INVALID_RESOURCE_TYPE")
      return
    end

    record = model_class.find_by_prefix_id(params[:resource_id])
    unless record
      render_api_not_found("Resource not found")
      return
    end

    # Scope check: only allow access to records in the current account
    if record.respond_to?(:account_id) && record.account_id != current_account.id
      render_api_not_found("Resource not found")
      return
    end

    render_api_success({ versions: [] })
  end
end
