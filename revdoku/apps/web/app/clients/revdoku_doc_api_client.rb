# frozen_string_literal: true

class RevdokuDocApiClient < ApplicationClient
  class ConnectionError < StandardError; end

  # An API client for the Revdoku Doc API service.
  # This client is used to interact with the internal Fastify doc-api service.
  # The service lives in apps/services/revdoku-doc-api.
  #
  # Usage:
  #     client = RevdokuDocApiClient.client
  #     client.create_report(request_body)

  BASE_URI = ENV.fetch("REVDOKU_DOC_API_URL", "http://localhost:4001")

  def self.client
    new
  end

  # Create a report by calling the doc-api service
  # @param request_body [Hash] The request body containing document, checklist, and other data
  # @return [Hash] Response with success status and report data
  def create_report(request_body)
    attempts = 0
    begin
      attempts += 1
      response = post("/api/v1/report/create", body: request_body, http_options: { open_timeout: 5, read_timeout: 300 })
      parsed = response.parsed_body
      log_revdoku_doc_api_response("create_report", parsed) if Rails.env.development?
      # Defensive: a 200 with empty/malformed body means the doc-api returned
      # without actually running the inspection. Treat as a hard error so the
      # report shows "failed" instead of silently completing with 0 checks.
      unless parsed.is_a?(Hash) && parsed["success"] == true && parsed["report"].is_a?(Hash)
        msg = "doc-api returned 200 but the response body is missing a report payload " \
              "(parsed=#{parsed.inspect.truncate(200)})"
        Rails.logger.error "[RevdokuDocApiClient] #{msg}"
        return { success: false, message: "Document inspection failed: empty response from inspection service" }
      end
      {
        success: true,
        report: parsed["report"],
        rendered_files: parsed["rendered_files"],
        content_bounding_boxes: parsed["content_bounding_boxes"],
        page_coordinate_spaces: parsed["page_coordinate_spaces"],
        page_types: parsed["page_types"],
        page_statuses: parsed["page_statuses"],
        total_page_count: parsed["total_page_count"]&.to_i,
        pages_processed: parsed["pages_processed"]&.to_i,
        revdoku_doc_api_elapsed_ms: parsed["elapsed_time"]
      }
    rescue *NET_HTTP_ERRORS => e
      Rails.logger.error "RevdokuDocApiClient network error in create_report (attempt #{attempts}): #{e.class} - #{e.message}"
      $stdout.puts "[RevdokuDocApiClient] create_report network error (attempt #{attempts}): #{e.class} - #{e.message}" if Rails.env.development?
      if attempts < 2
        sleep 3
        retry
      end
      raise ConnectionError, "doc-api connection failed after #{attempts} attempts (create_report): #{e.class} - #{e.message}"
    rescue ApplicationClient::Unauthorized, ApplicationClient::Forbidden => e
      # doc-api authored a user-safe message in friendlyAIErrorMessage
      # ("Provider rejected the API key (HTTP 401)…") — pass it through
      # verbatim. Skipping parse_error_message → sanitize_error_for_user is
      # deliberate: that pipeline matches the `api.key` pattern in
      # SENSITIVE_PATTERNS and would collapse this to the generic error.
      notify_revdoku_doc_api_error(e, method: "create_report")
      { success: false, message: extract_json_message(e) }
    rescue ApplicationClient::Error => e
      notify_revdoku_doc_api_error(e, method: "create_report")
      { success: false, message: parse_error_message(e) }
    end
  end

  # Normalize a reference file (png / jpg / pdf) at upload time. The doc-api
  # runs the same render-and-extract pipeline it uses for the main
  # inspection, but on a single uploaded file, and returns the extracted
  # page texts + rendered page images for Rails to cache on the
  # DocumentFileRevision.
  #
  # @param name [String] original filename
  # @param mime_type [String]
  # @param data_base64 [String] the raw file, base64-encoded
  # @param text_extraction_model_config [Hash] resolved :text_extraction model
  # @return [Hash] { success:, page_texts:, rendered_pages:, ... }
  def normalize_file(name:, mime_type:, data_base64:, text_extraction_model_config:)
    body = {
      name: name,
      mime_type: mime_type,
      data: data_base64,
      text_extraction_model_config: text_extraction_model_config
    }
    begin
      response = post("/api/v1/file/normalize", body: body, http_options: { open_timeout: 5, read_timeout: 300 })
      parsed = response.parsed_body
      {
        success: parsed["success"] == true,
        message: parsed["message"],
        page_texts: parsed["page_texts"] || [],
        rendered_pages: parsed["rendered_pages"] || [],
        pages_processed: parsed["pages_processed"]&.to_i
      }
    rescue *NET_HTTP_ERRORS => e
      Rails.logger.error "RevdokuDocApiClient network error in normalize_file: #{e.class} - #{e.message}"
      raise ConnectionError, "doc-api connection failed (normalize_file): #{e.class} - #{e.message}"
    rescue ApplicationClient::Unauthorized, ApplicationClient::Forbidden => e
      notify_revdoku_doc_api_error(e, method: "normalize_file")
      { success: false, message: extract_json_message(e) }
    rescue ApplicationClient::Error => e
      notify_revdoku_doc_api_error(e, method: "normalize_file")
      { success: false, message: parse_error_message(e) }
    end
  end

  class Error < StandardError; end

  # Export a report to PDF or other formats
  # @param request_body [Hash] The request body containing report data and export format
  # @return [Hash] Response with success status and exported data
  def export_report(request_body)
    attempts = 0
    begin
      attempts += 1
      response = post("/api/v1/report/export", body: request_body, http_options: { open_timeout: 5, read_timeout: 90 })

      parsed_response = response.parsed_body
      log_revdoku_doc_api_response("export_report", parsed_response) if Rails.env.development?

      if parsed_response["success"] && parsed_response["report"] && parsed_response["report"]["export"]
        file_data = parsed_response["report"]["export"]["file"]

        data = file_data["data"]

        {
          success: true,
          data: data,
          content_type: file_data["mime_type"],
          format: determine_format_from_mime_type(file_data["mime_type"])
        }
      else
        {
          success: false,
          message: parsed_response["message"] || "Export failed"
        }
      end
    rescue *NET_HTTP_ERRORS => e
      Rails.logger.error "RevdokuDocApiClient network error in export_report (attempt #{attempts}): #{e.class} - #{e.message}"
      $stdout.puts "[RevdokuDocApiClient] export_report network error (attempt #{attempts}): #{e.class} - #{e.message}" if Rails.env.development?
      if attempts < 2
        sleep 3
        retry
      end
      raise ConnectionError, "doc-api connection failed after #{attempts} attempts (export_report): #{e.class} - #{e.message}"
    rescue ApplicationClient::Unauthorized, ApplicationClient::Forbidden => e
      notify_revdoku_doc_api_error(e, method: "export_report")
      { success: false, message: extract_json_message(e) }
    rescue ApplicationClient::Error => e
      notify_revdoku_doc_api_error(e, method: "export_report")
      {
        success: false,
        message: parse_error_message(e)
      }
    end
  end

  # Generate a checklist from source text
  # @param source_text [String] The source text to generate checklist from
  # @param system_prompt [String] Optional existing checklist context
  # @param existing_rules [Array] Optional rules to avoid duplicating
  # @param checklist_name [String] Optional topic context
  # @return [Hash] Response with success status and checklist data
  def generate_checklist(source_text, system_prompt: nil, existing_rules: nil, checklist_name: nil, ai_model: nil)
    attempts = 0
    begin
      attempts += 1
      model_config = AiModelResolver.resolve(ai_model, operation: :checklist_generation, account: (Principal.account rescue nil))

      body = { text: source_text, model_config: model_config }
      body[:system_prompt] = system_prompt if system_prompt.present?
      body[:existing_rules] = existing_rules if existing_rules.present?
      body[:checklist_name] = checklist_name if checklist_name.present?

      response = post("/api/v1/checklist/generate", body: body, http_options: { open_timeout: 5, read_timeout: 60 })
      log_revdoku_doc_api_response("generate_checklist", response.parsed_body) if Rails.env.development?

      if response.parsed_body["success"] && response.parsed_body["checklist"]
        {
          success: true,
          checklist: response.parsed_body["checklist"]
        }
      else
        {
          success: false,
          message: response.parsed_body["error"] || "Generation failed"
        }
      end
    rescue *NET_HTTP_ERRORS => e
      Rails.logger.error "RevdokuDocApiClient network error in generate_checklist (attempt #{attempts}): #{e.class} - #{e.message}"
      $stdout.puts "[RevdokuDocApiClient] generate_checklist network error (attempt #{attempts}): #{e.class} - #{e.message}" if Rails.env.development?
      if attempts < 2
        sleep 3
        retry
      end
      raise ConnectionError, "doc-api connection failed after #{attempts} attempts (generate_checklist): #{e.class} - #{e.message}"
    rescue ApplicationClient::Unauthorized, ApplicationClient::Forbidden => e
      notify_revdoku_doc_api_error(e, method: "generate_checklist")
      { success: false, message: extract_json_message(e) }
    rescue ApplicationClient::Error => e
      notify_revdoku_doc_api_error(e, method: "generate_checklist")
      {
        success: false,
        message: parse_error_message(e)
      }
    end
  end

  # Verify a provider's API key + model by firing a single 1-token AI call
  # via doc-api's /api/v1/ai/test-key endpoint. Backs the per-provider
  # "Test" button on /account/ai. Same SDK call shape a real review uses,
  # so success here means a real review against this model_config will
  # also pass auth.
  # @param model_config [Hash] resolved model config from AiModelResolver.resolve
  # @return [Hash] { ok: Boolean, served_model: String?, message: String? }
  def test_key(model_config)
    response = post("/api/v1/ai/test-key", body: { model_config: model_config }, http_options: { open_timeout: 5, read_timeout: 20 })
    parsed = response.parsed_body
    { ok: parsed["success"] == true, served_model: parsed["served_model"], message: parsed["message"] }
  rescue *NET_HTTP_ERRORS => e
    Rails.logger.warn "RevdokuDocApiClient test_key network error: #{e.class} - #{e.message}"
    { ok: false, message: "Could not reach the AI service. Try again in a moment." }
  rescue ApplicationClient::Unauthorized, ApplicationClient::Forbidden => e
    { ok: false, message: extract_json_message(e) }
  rescue ApplicationClient::Error => e
    { ok: false, message: parse_error_message(e) }
  end

  # Reindex checks — sort by visual position and assign sequential check_index values
  # @param checks [Array<Hash>] checks with :id, :passed, :page, :x1, :y1, :x2, :y2
  # @param reserved_check_indices [Array<Integer>] indices to skip (user checks)
  # @return [Array<Hash>] array of { "id" => ..., "check_index" => ... }
  def reindex_checks(checks, reserved_check_indices: [])
    response = post("/api/v1/checks/reindex", body: { checks: checks, reserved_check_indices: reserved_check_indices })
    parsed = response.parsed_body
    parsed["indices"] || []
  rescue ApplicationClient::Error => e
    Rails.logger.warn "RevdokuDocApiClient reindex_checks failed: #{e.message}"
    []
  rescue *NET_HTTP_ERRORS => e
    Rails.logger.warn "RevdokuDocApiClient reindex_checks network error: #{e.message}"
    []
  end

  private

  def log_revdoku_doc_api_response(method, parsed_body)
    Rails.logger.debug "[RevdokuDocApiClient] #{method} response: #{parsed_body.to_json.truncate(10_000)}"
  end

  # Authenticate to the doc-api via shared secret (HIPAA inter-service auth)
  def authorization_header
    secret = ENV["REVDOKU_DOC_API_KEY"]
    return {} if secret.blank?
    { "X-Revdoku-Doc-Api-Auth" => secret }
  end

  def notify_revdoku_doc_api_error(exception, method:)
  end

  # Extract the `message` field from a JSON-bodied doc-api error response
  # WITHOUT running it through sanitize_error_for_user. Used for 401/403
  # where the doc-api already authored a user-safe message via
  # friendlyAIErrorMessage; sanitisation would otherwise match the
  # `api.key` pattern in SENSITIVE_PATTERNS and collapse the message to
  # the generic "AI processing failed" string.
  def extract_json_message(exception)
    body = exception.message.to_s
    JSON.parse(body)["message"].to_s.presence || self.class.generic_error
  rescue JSON::ParserError
    self.class.generic_error
  end

  def parse_error_message(exception)
    raw = begin
      error_data = JSON.parse(exception.message)
      error_data["message"] || error_data["error"] || exception.message
    rescue JSON::ParserError
      # Handle "STATUS_CODE - JSON" format from ApplicationClient (e.g. "402 - {\"message\":\"...\"}")
      if (json_start = exception.message.index("{"))
        begin
          error_data = JSON.parse(exception.message[json_start..])
          error_data["message"] || error_data["error"] || exception.message
        rescue JSON::ParserError
          exception.message
        end
      else
        exception.message
      end
    end
    sanitize_error_for_user(raw)
  end

  SENSITIVE_PATTERNS = /
    environment.variable |
    api.key |
    _API_KEY |
    _SECRET |
    REVDOKU_DOC_API_ |
    ENOENT|EACCES|EPERM |
    \/app\/|\/usr\/|\/tmp\/ |
    node_modules|\.ts\b|\.js\b |
    Errno::|Timeout::Error |
    at\s+\S+\s+\( |
    puppeteer|chromium|browser.process |
    TROUBLESHOOTING |
    pptr\.dev |
    spawn\b|ECONNREFUSED|SIGTERM|SIGKILL|SIGABRT |
    heap|out.of.memory|OOM\b|segfault |
    Failed\s+to\s+launch
  /ix.freeze

  # Generic user-facing error. Appends a support contact when one is
  # configured (Revdoku.support_email returns nil → suffix omitted).
  def self.generic_error
    @generic_error ||= begin
      email = Revdoku.support_email.to_s.presence
      email ? "AI processing failed. Please try again or contact #{email}" : "AI processing failed. Please try again."
    end.freeze
  end

  def self.sanitize_error_for_user(raw_message)
    return generic_error if raw_message.blank?
    return generic_error if raw_message.match?(SENSITIVE_PATTERNS)
    raw_message.truncate(200)
  end

  def sanitize_error_for_user(raw_message)
    self.class.sanitize_error_for_user(raw_message)
  end

  def determine_format_from_mime_type(mime_type)
    case mime_type
    when "application/pdf" then "pdf"
    when "application/json" then "json"
    when "text/html" then "html"
    else "pdf"
    end
  end
end
