# frozen_string_literal: true

class Api::V1::AuditLogsController < Api::BaseController
  include AuditActionHumanizable
  skip_after_action :verify_authorized # Access controlled by owner checks in each action

  DEFAULT_PER_PAGE = 50
  MAX_PER_PAGE = 200

  before_action :log_audit_access
  after_action :clear_audit_encryption_cache

  # GET /api/v1/audit_logs
  # Owner sees all account logs; non-owners see only their own
  def index
    base_scope = AuditLog.where(account_id: current_account.prefix_id)
    base_scope = base_scope.where(user_id: current_user.prefix_id) unless member_role.owner?

    # Apply filters
    if params[:start_date].present? || params[:end_date].present?
      start_dt = params[:start_date].present? ? parse_date_param(:start_date)&.beginning_of_day : nil
      return if performed?
      end_dt = params[:end_date].present? ? parse_date_param(:end_date)&.end_of_day : nil
      return if performed?
      base_scope = base_scope.where(created_at: (start_dt || Time.at(0))..(end_dt || Time.current))
    end
    base_scope = base_scope.where(user_id: params[:user_id]) if params[:user_id].present? && member_role.owner?
    base_scope = base_scope.for_envelope(params[:envelope_id]) if params[:envelope_id].present?
    base_scope = base_scope.failed_attempts if params[:failed_only] == "true"


    page = (params[:page] || 1).to_i
    per_page = [(params[:per_page] || DEFAULT_PER_PAGE).to_i, MAX_PER_PAGE].min

    total = base_scope.count
    @audit_logs = base_scope.order(created_at: :desc).offset((page - 1) * per_page).limit(per_page)

    preload_audit_encryption_keys(@audit_logs)
    users_by_prefix = batch_load_users(@audit_logs)

    render_api_success({
      audit_logs: @audit_logs.map { |log| format_audit_log(log, users_by_prefix) },
      pagination: {
        page: page,
        per_page: per_page,
        total: total,
        total_pages: (total.to_f / per_page).ceil
      }
    })
  end

  # GET /api/v1/audit_logs/export
  def export
    unless member_role.owner?
      render_api_forbidden("Only the account owner can export audit logs")
      return
    end

    start_date = params[:start_date] ? parse_date_param(:start_date) : 30.days.ago.to_date
    return if performed?
    end_date = params[:end_date] ? parse_date_param(:end_date) : Date.current
    return if performed?

    @audit_logs = AuditLog.where(account_id: current_account.prefix_id)
                          .where(created_at: start_date.beginning_of_day..end_date.end_of_day)
                          .order(created_at: :desc)

    preload_audit_encryption_keys(@audit_logs)
    users_by_prefix = batch_load_users(@audit_logs)

    if params[:format] == "csv"
      csv_data = generate_csv(@audit_logs, users_by_prefix)
      send_data csv_data,
        filename: "audit_logs_#{start_date}_#{end_date}.csv",
        type: "text/csv",
        disposition: "attachment"
    else
      logs_data = @audit_logs.map { |log| format_audit_log(log, users_by_prefix) }
      render_api_success({
        audit_logs: logs_data,
        export_date: Time.current,
        date_range: { start: start_date, end: end_date }
      })
    end
  end

  private

  def member_role
    @member_role ||= MemberRole.new
  end

  # Override to avoid logging full audit log response body (prevents recursion/bloat)
  def build_response_metadata
    { content_type: response.content_type&.to_s&.split(";")&.first&.strip, size: response.body&.bytesize || 0 }
  end

  def parse_date_param(param_name)
    Date.parse(params[param_name])
  rescue Date::Error
    render_api_bad_request("Invalid date format for #{param_name}", code: "INVALID_DATE")
    nil
  end

  def log_audit_access
    Rails.logger.warn(
      "[SECURITY] Audit log accessed: action=#{action_name} " \
      "user=#{current_user&.prefix_id} ip=#{request.remote_ip} " \
      "request_id=#{request.request_id}"
    )
  end

  # Batch-load account encryption keys to avoid N+1 lookups during decryption
  def preload_audit_encryption_keys(logs)
    acct_ids = logs.map(&:account_id).compact.uniq
    return if acct_ids.empty?
    real_ids = acct_ids.filter_map { |pid| Account.decode_prefix_id(pid) rescue nil }
    Thread.current[:audit_log_account_cache] = Account.where(id: real_ids).index_by(&:prefix_id) if real_ids.any?
  end

  def clear_audit_encryption_cache
    Thread.current[:audit_log_account_cache] = nil
  end

  # Safely read an encrypted field — returns placeholder if decryption fails
  # (e.g. account encryption key was shredded after the log was written)
  def safe_decrypt(log, attribute)
    log.public_send(attribute)
  rescue Lockbox::DecryptionError
    "[REDACTED - encryption key unavailable]"
  rescue RuntimeError => e
    raise unless e.message.include?("encryption key unavailable") || e.message.include?("not found")
    "[REDACTED - encryption key unavailable]"
  end

  def batch_load_users(logs)
    prefix_ids = logs.map(&:user_id).compact.uniq
    return {} if prefix_ids.empty?
    real_ids = prefix_ids.filter_map { |pid| User.decode_prefix_id(pid) rescue nil }
    return {} if real_ids.empty?
    User.where(id: real_ids).index_by(&:prefix_id)
  end

  def format_audit_log(log, users_by_prefix = {})
    user = users_by_prefix[log.user_id]
    request_data = safe_decrypt(log, :request)
    entry = {
      id: log.id,
      path: log.path,
      response_code: log.response_code,
      source_type: log.source_type,
      user_id: log.user_id,
      user_name: format_user_display(user, log.user_id),
      ip: safe_decrypt(log, :ip),
      user_agent: safe_decrypt(log, :user_agent),
      request: request_data,
      request_id: log.request_id,
      response: safe_decrypt(log, :response),
      duration: log.duration,
      created_at: log.created_at
    }
    entry[:human_action] = humanize_action(log, request_data) if params[:humanize] == "true"
    entry
  end

  # Returns structured human-readable description for a log entry.
  # Accepts pre-decrypted request_data to avoid double decryption.
  def humanize_action(log, request_data = nil)
    request_data = safe_decrypt(log, :request) if request_data.nil?
    result = humanize_action_structured(log, request_data)
    detail = interpolate_detail(result[:detail_template], log, request_data)
    {
      description: result[:description],
      detail: detail,
      model_type: result[:model_type],
      envelope_id: result[:envelope_id]
    }
  end

  # Interpolates %{...} placeholders in a detail template string.
  # Accepts pre-decrypted request_data to avoid double decryption.
  def interpolate_detail(template, log, request_data = nil)
    return nil if template.blank?
    request_data = safe_decrypt(log, :request) if request_data.nil?
    response_data = safe_decrypt(log, :response)

    result = template.gsub(/%\{([^}]+)\}/) do |_match|
      key = $1
      case key
      when "credits"
        response_data.is_a?(Hash) ? response_data.dig("credits") : nil
      when "envelope_id"
        log.envelope_id
      when /\Aparams\.(.+)\z/
        request_data.is_a?(Hash) ? request_data.dig("params", $1) : nil
      when /\Arequest\.(.+)\z/
        # Top-level request fields. Some writers stash data outside the
        # conventional `params` envelope (e.g. inbound-email logs put
        # sender / subject / skipped_non_pdf at the root of `request`).
        val = request_data.is_a?(Hash) ? request_data.dig($1) : nil
        val.is_a?(Array) ? val.join(", ") : val
      when /\Aresponse\.(.+)\z/
        response_data.is_a?(Hash) ? response_data.dig($1) : nil
      end
    end
    # Return nil if all placeholders resolved to blank
    result.gsub(/\s+/, " ").strip.presence
  end

  def format_user_display(user, fallback_id = nil)
    return "System" unless user || fallback_id
    return fallback_id || "System" unless user
    if user.name.present?
      "#{user.name} <#{user.email}>"
    else
      user.email
    end
  end

  def generate_csv(logs, users_by_prefix = {})
    require "csv"
    CSV.generate do |csv|
      csv << ["ID", "Timestamp", "Path", "Method", "Duration (ms)", "Response Code", "Source", "User ID", "User Name", "IP", "User Agent", "Request ID", "Response Content-Type"]
      logs.each do |log|
        user = users_by_prefix[log.user_id]
        request_data = safe_decrypt(log, :request)
        response_data = safe_decrypt(log, :response)
        csv << [
          log.id,
          log.created_at.iso8601,
          log.path,
          request_data.is_a?(Hash) ? request_data.dig("method") : nil,
          log.duration,
          log.response_code,
          log.source_type,
          log.user_id,
          format_user_display(user, log.user_id),
          safe_decrypt(log, :ip),
          safe_decrypt(log, :user_agent),
          log.request_id,
          response_data.is_a?(Hash) ? response_data.dig("content_type") : nil
        ]
      end
    end
  end
end
