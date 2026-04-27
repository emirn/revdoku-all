# frozen_string_literal: true

class Api::V1::NotificationsController < Api::BaseController
  # GET /api/v1/notifications
  def index
    authorize Notification

    notifications = policy_scope(Notification)
                      .newest_first
                      .limit(50)
                      .map { |n| serialize_notification(n) }

    render_api_success({ notifications: notifications })
  end

  # GET /api/v1/notifications/unread_count
  def unread_count
    authorize Notification

    count = policy_scope(Notification).unread.count
    render_api_success({ unread_count: count })
  end

  # POST /api/v1/notifications/:id/mark_as_read
  def mark_as_read
    notification = current_user.notifications.find_by_prefix_id!(params[:id])
    authorize notification

    notification.mark_as_read!
    render_api_success({ notification: serialize_notification(notification) })
  end

  # POST /api/v1/notifications/mark_all_as_read
  def mark_all_as_read
    authorize Notification

    policy_scope(Notification).unread.update_all(read_at: Time.current)
    render_api_success({ message: "All notifications marked as read" })
  end

  private

  def serialize_notification(notification)
    {
      id: notification.prefix_id,
      type: notification.notification_type,
      params: notification.params,
      account_id: notification.account&.prefix_id,
      read_at: notification.read_at&.iso8601,
      created_at: notification.created_at.iso8601
    }
  end
end
