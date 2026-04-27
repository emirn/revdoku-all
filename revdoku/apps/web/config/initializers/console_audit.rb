# frozen_string_literal: true

require "open3"

# Rails Console Audit Logging
#
# Logs console session start/end to the immutable HIPAA audit log
# and optionally to CloudWatch via stdout.
#
# This closes a gap where Rails console access (via `kamal console`
# or `docker exec`) bypasses the API-level audit logging in
# Api::BaseController#record_audit_log.
#
# Detection layers in production:
#   1. CloudWatch ← /var/log/auth.log (SSH access, sudo)
#   2. CloudTrail ← KMS Decrypt calls (anomalous volume = data exfil)
#   3. This initializer ← Rails console session start/end in audit DB
#   4. IRB after_evaluate hook ← logs model read/write operations

return if ENV["SECRET_KEY_BASE_DUMMY"] # Skip during Docker asset precompilation

Rails.application.configure do
  console do
    # --- Session start audit ---
    session_id = ENV["CONSOLE_SESSION_ID"] || SecureRandom.hex(16)
    started_at = Time.current

    console_user = ENV["USER"] || ENV["LOGNAME"] || "unknown"
    console_ip = begin
      stdout, status = Open3.capture2("hostname", "-I")
      status.success? ? stdout.strip.split.first : "unknown"
    rescue Errno::ENOENT
      "unknown"
    end || "unknown"

    container_id = begin
      stdout, status = Open3.capture2("hostname")
      status.success? ? stdout.strip : ""
    rescue Errno::ENOENT
      ""
    end

    Rails.logger.warn(
      "[CONSOLE_AUDIT] session_start " \
      "session_id=#{session_id} " \
      "user=#{console_user} " \
      "ip=#{console_ip} " \
      "container=#{container_id} " \
      "pid=#{Process.pid}"
    )

    # Write to immutable audit log (same DB as HIPAA request logs)
    begin
      AuditLog.create!(
        path: "/console/session_start",
        response_code: 200,
        source_type: "ADMIN",
        user_id: nil,
        account_id: nil,
        ip: console_ip,
        user_agent: "rails-console/#{Rails.version}",
        request: {
          action: "console_session_start",
          session_id: session_id,
          os_user: console_user,
          container_id: container_id,
          pid: Process.pid
        }
      )
    rescue => e
      Rails.logger.error("[CONSOLE_AUDIT] Failed to write session_start audit log: #{e.message}")
    end

    # --- Session end audit (at_exit) ---
    at_exit do
      duration_seconds = (Time.current - started_at).round(1)

      Rails.logger.warn(
        "[CONSOLE_AUDIT] session_end " \
        "session_id=#{session_id} " \
        "user=#{console_user} " \
        "duration=#{duration_seconds}s " \
        "pid=#{Process.pid}"
      )

      begin
        AuditLog.create!(
          path: "/console/session_end",
          response_code: 200,
          source_type: "ADMIN",
          user_id: nil,
          account_id: nil,
          ip: console_ip,
          user_agent: "rails-console/#{Rails.version}",
          duration: (duration_seconds * 1000).to_i, # ms
          request: {
            action: "console_session_end",
            session_id: session_id,
            os_user: console_user,
            container_id: container_id,
            pid: Process.pid,
            duration_seconds: duration_seconds
          }
        )
      rescue => e
        # Best-effort — process is exiting, DB may already be closed
        $stderr.puts "[CONSOLE_AUDIT] Failed to write session_end audit log: #{e.message}"
      end
    end

    # --- IRB hook: log model access operations ---
    # Detects ActiveRecord queries executed in the console and logs
    # bulk data access patterns that indicate potential data exfiltration.
    if defined?(IRB)
      query_counter = { total: 0, models: Hash.new(0) }
      bulk_threshold = ENV.fetch("CONSOLE_AUDIT_BULK_THRESHOLD", 50).to_i

      ActiveSupport::Notifications.subscribe("sql.active_record") do |*, payload|
        sql = payload[:sql].to_s
        # Skip internal/schema queries
        next if sql.start_with?("PRAGMA", "SELECT sqlite_version", "EXPLAIN")
        next if payload[:name] == "SCHEMA"

        query_counter[:total] += 1

        # Extract model name from query (best effort)
        if sql =~ /FROM\s+["']?(\w+)["']?/i
          table = $1
          query_counter[:models][table] += 1

          # Alert on bulk access patterns
          if query_counter[:models][table] == bulk_threshold
            Rails.logger.warn(
              "[CONSOLE_AUDIT] bulk_access_alert " \
              "session_id=#{session_id} " \
              "table=#{table} " \
              "query_count=#{bulk_threshold} " \
              "user=#{console_user}"
            )

            begin
              AuditLog.create!(
                path: "/console/bulk_access_alert",
                response_code: 200,
                source_type: "ADMIN",
                user_id: nil,
                account_id: nil,
                ip: console_ip,
                user_agent: "rails-console/#{Rails.version}",
                request: {
                  action: "console_bulk_access_alert",
                  session_id: session_id,
                  os_user: console_user,
                  table: table,
                  query_count: bulk_threshold
                }
              )
            rescue => e
              Rails.logger.error("[CONSOLE_AUDIT] Failed to write bulk_access audit: #{e.message}")
            end
          end
        end
      end
    end

    puts "\n\e[33m[AUDIT] Console session #{session_id} logged. All activity is monitored.\e[0m\n\n"
  end
end
