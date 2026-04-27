# frozen_string_literal: true

class HealthController < ActionController::Base
  # GET /up/full — combined health check for app + api-1 (doc-api)
  #
  # Always returns 200 (won't cause Kamal to mark container unhealthy).
  # Reports status in JSON for debugging:
  #   { app: "ok", api_1: "ok" }       — both healthy
  #   { app: "ok", api_1: "down" }     — doc-api unreachable
  def full
    api_1_status = check_api_1
    unless api_1_status == "ok"
      Rails.logger.warn("[HealthCheck] api-1 is down: #{api_1_status}")
    end

    render json: { app: "ok", api_1: api_1_status }
  end

  private

  def check_api_1
    uri = URI("#{RevdokuDocApiClient::BASE_URI}/api/v1/health")
    http = Net::HTTP.new(uri.host, uri.port)
    http.open_timeout = 2
    http.read_timeout = 2
    response = http.get(uri.request_uri)
    response.code == "200" ? "ok" : "error (#{response.code})"
  rescue StandardError => e
    "down (#{e.class})"
  end
end
