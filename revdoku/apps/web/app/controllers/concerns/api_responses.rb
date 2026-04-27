# frozen_string_literal: true

module ApiResponses
  extend ActiveSupport::Concern

  included do
    rescue_from StandardError, with: :handle_unexpected_error
    rescue_from RevdokuDocApiClient::ConnectionError, with: :handle_revdoku_doc_api_connection_error
    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found
    rescue_from ActionController::ParameterMissing, with: :render_parameter_missing
    rescue_from Pundit::NotAuthorizedError, with: :render_forbidden
  end

  def render_api_success(data, status: :ok)
    render json: build_success_envelope(data), status: status
  end

  def render_api_created(data)
    render json: build_success_envelope(data), status: :created
  end

  def render_api_accepted(data)
    render json: build_success_envelope(data), status: :accepted
  end

  def render_api_no_content
    head :no_content
  end

  def render_api_bad_request(message, code: nil)
    render json: build_error_envelope(message, code: code), status: :bad_request
  end

  def render_api_error(message, status: :bad_request, code: nil, details: nil)
    render json: build_error_envelope(message, code: code, details: details), status: status
  end

  def render_api_validation_error(record)
    details = record.errors.map { |e| { field: e.attribute.to_s, message: e.message } }
    render json: build_error_envelope("Validation failed", code: "VALIDATION_ERROR", details: details),
           status: :unprocessable_entity
  end

  def render_api_not_found(resource = "Resource")
    render json: build_error_envelope("#{resource} not found", code: "NOT_FOUND"), status: :not_found
  end

  def render_api_unauthorized(message = "Unauthorized")
    render json: build_error_envelope(message, code: "UNAUTHORIZED"), status: :unauthorized
  end

  def render_api_forbidden(message = "Forbidden")
    render json: build_error_envelope(message, code: "FORBIDDEN"), status: :forbidden
  end

  def render_api_internal_error(message = "Internal server error")
    render json: build_error_envelope(message, code: "INTERNAL_ERROR"), status: :internal_server_error
  end

  private

  def handle_unexpected_error(exception)
    Rails.logger.error "Unhandled exception: #{exception.class} - #{exception.message}\n#{exception.backtrace&.first(10)&.join("\n")}"


    render_api_internal_error("An unexpected error occurred. Please try again.")
  end

  def handle_revdoku_doc_api_connection_error(exception)
    Rails.logger.error "RevdokuDocApiClient connection error: #{exception.message}"


    render_api_error(
      "Document processing service is temporarily unavailable. Please try again in a few minutes.",
      status: :service_unavailable,
      code: "REVDOKU_DOC_API_UNAVAILABLE"
    )
  end

  def render_not_found
    render_api_not_found
  end

  def render_parameter_missing(exception)
    render_api_error("Missing parameter: #{exception.param}", code: "MISSING_PARAMETER")
  end

  def render_forbidden
    render_api_forbidden("You are not authorized to perform this action")
  end

  def build_success_envelope(data)
    result = { success: true, data: data }
    append_credits_info!(result)
    result
  end

  def build_error_envelope(message, code: nil, details: nil)
    error_obj = { message: message }
    error_obj[:code] = code if code
    error_obj[:details] = details if details
    error_obj[:request_id] = request.request_id if defined?(request) && request.respond_to?(:request_id)
    error_obj[:timestamp] = Time.current.iso8601
    result = { success: false, error: error_obj }
    append_credits_info!(result, success: false)
    result
  end

  # Default: no-op. Override via prepended module to attach billing
  # fields (e.g. `credits`, `credits_left`) to the response envelope.
  def append_credits_info!(_hash, success: true); end
end
