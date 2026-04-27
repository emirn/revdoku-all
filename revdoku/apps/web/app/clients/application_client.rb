# frozen_string_literal: true

class ApplicationClient
  # A basic API client with HTTP methods
  #
  # The Authorization Bearer token header for authentication is included by default
  # You can override the `authorization_header` method to change this
  #
  # Content Type is application/json by default
  # You can override the `content_type` to
  #
  # An example API client:
  #
  #   class DigitalOceanClient < ApplicationClient
  #     BASE_URI = "https://api.digitalocean.com/v2"
  #
  #     def account
  #       get("/account").account
  #     rescue *NET_HTTP_ERRORS
  #       raise Error, "Unable to load your account"
  #     end
  #   end

  # Common HTTP Errors
  class Error < StandardError; end
  class MovedPermanently < Error; end
  class Forbidden < Error; end
  class Unauthorized < Error; end
  class UnprocessableEntity < Error; end
  class RateLimit < Error; end
  class NotFound < Error; end
  class InternalError < Error; end

  BASE_URI = "https://example.org"
  NET_HTTP_ERRORS = [Timeout::Error, Errno::EINVAL, Errno::ECONNRESET, Errno::ECONNREFUSED, EOFError, Net::HTTPBadResponse, Net::HTTPHeaderSyntaxError, Net::ProtocolError]

  attr_reader :auth, :basic_auth, :token

  def self.inherited(client)
    response = client.const_set(:Response, Class.new(Response))
    response.const_set(:PARSER, Response::PARSER.dup)
  end

  def initialize(auth: nil, basic_auth: nil, token: nil)
    @auth, @basic_auth, @token = auth, basic_auth, token
  end

  def default_headers
    {
      "Accept" => content_type,
      "Content-Type" => content_type
    }.merge(authorization_header)
  end

  def content_type = "application/json"

  def authorization_header = {"Authorization" => "Bearer #{auth&.token || token}"}

  def default_query_params = {}

  def get(path, **) = make_request(klass: Net::HTTP::Get, path: path, **)
  def post(path, **) = make_request(klass: Net::HTTP::Post, path: path, **)
  def patch(path, **) = make_request(klass: Net::HTTP::Patch, path: path, **)
  def put(path, **) = make_request(klass: Net::HTTP::Put, path: path, **)
  def delete(path, **) = make_request(klass: Net::HTTP::Delete, path: path, **)

  def base_uri = self.class::BASE_URI

  def open_timeout = nil
  def read_timeout = nil
  def write_timeout = nil

  def make_request(klass:, path:, headers: {}, body: nil, query: nil, form_data: nil, http_options: {})
    raise ArgumentError, "Cannot pass both body and form_data" if body.present? && form_data.present?

    uri = path.start_with?("http") ? URI(path) : URI("#{base_uri}#{path}")
    query_params = Rack::Utils.parse_query(uri.query).with_defaults(default_query_params)

    case query
    when String
      query_params.merge! Rack::Utils.parse_query(query)
    when Hash
      query_params.merge! query
    end

    uri.query = Rack::Utils.build_query(query_params) if query_params.present?

    Rails.logger.debug("#{klass.name.split("::").last.upcase}: #{uri}")

    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true if uri.instance_of? URI::HTTPS

    http.open_timeout = http_options[:open_timeout] || open_timeout || http.open_timeout
    http.read_timeout = http_options[:read_timeout] || read_timeout || http.read_timeout
    http.write_timeout = http_options[:write_timeout] || write_timeout || http.write_timeout

    all_headers = default_headers.merge(headers)
    all_headers.delete("Content-Type") if klass == Net::HTTP::Get

    request = klass.new(uri.request_uri, all_headers)
    request.basic_auth(basic_auth[:username], basic_auth[:password]) if basic_auth.present?

    if body.present?
      request.body = build_body(body)
    elsif form_data.present?
      request.set_form(form_data, "multipart/form-data")
    end

    handle_response self.class::Response.new(http.request(request))
  end

  def handle_response(response)
    case response.code
    when "200", "201", "202", "203", "204"
      response
    when "301"
      raise MovedPermanently, response.body
    when "401"
      raise Unauthorized, response.body
    when "403"
      raise Forbidden, response.body
    when "404"
      raise NotFound, response.body
    when "422"
      raise UnprocessableEntity, response.body
    when "429"
      raise RateLimit, response.body
    when "500"
      raise InternalError, response.body
    else
      raise Error, "#{response.code} - #{response.body}"
    end
  end

  def build_body(body)
    case body
    when String
      body
    else
      body.to_json
    end
  end

  class Response
    PARSER = {
      "application/json" => ->(response) { JSON.parse(response.body, object_class: ActiveSupport::InheritableOptions) },
      "application/xml" => ->(response) { Nokogiri::XML(response.body) }
    }
    FALLBACK_PARSER = ->(response) { response.body }

    attr_reader :original_response

    delegate :code, :body, to: :original_response
    delegate_missing_to :parsed_body

    def initialize(original_response)
      @original_response = original_response
    end

    def headers
      @headers ||= original_response.each_header.to_h.transform_keys { |k| k.underscore.to_sym }
    end

    def content_type = headers[:content_type]&.split(";")&.first

    def parsed_body
      @parsed_body ||= self.class::PARSER.fetch(content_type, FALLBACK_PARSER).call(self)
    end
  end
end
