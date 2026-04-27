# frozen_string_literal: true

class NotificationService
  # Generic entry point — any code can call this
  # account: is optional — nil = user-level notification
  def self.notify!(user:, type:, account: nil, params: {})
    return unless user

    notification = Notification.create!(
      account: account, user: user, notification_type: type, params: params
    )

    # Broadcast minimal payload (no PHI)
    NotificationChannel.broadcast_to(user, {
      id: notification.prefix_id,
      type: type,
      account_id: account&.prefix_id,
      params: params,
      created_at: notification.created_at.iso8601
    })

    notification
  end

  # Convenience: notify about report completion/failure. Only fires for
  # terminal states — if a non-terminal status (processing / pending /
  # reset) somehow reaches this method, we bail silently instead of
  # emitting a misleading "report_failed" toast (e.g. when a duplicate
  # job raced and the losing job tried to notify while the winning job
  # was still running).
  def self.report_finished!(report, user)
    return unless user && report.account

    type = if report.job_status_completed?
             "report_completed"
           elsif report.job_status_failed? || report.job_status_cancelled?
             "report_failed"
           else
             Rails.logger.info "NotificationService: skipping report_finished! for non-terminal status #{report.job_status}"
             return
           end

    envelope = report.envelope_revision&.envelope
    params = {
      report_id: report.prefix_id,
      envelope_id: envelope&.prefix_id,
      job_status: report.job_status
    }
    params[:error_message] = report.error_message if report.job_status_failed? && report.error_message.present?

    notify!(user: user, account: report.account, type: type, params: params)
  end
end
