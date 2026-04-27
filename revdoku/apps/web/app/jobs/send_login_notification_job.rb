# frozen_string_literal: true

class SendLoginNotificationJob < ApplicationJob
  queue_as :default

  def perform(login_history_id, new_device = true)
    login_history = LoginHistory.find_by(id: login_history_id)
    return unless login_history

    UserMailer.login_notification(login_history.user, login_history, new_device: new_device).deliver_now
  end
end
