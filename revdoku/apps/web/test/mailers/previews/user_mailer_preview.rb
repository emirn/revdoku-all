# frozen_string_literal: true

class UserMailerPreview < ActionMailer::Preview
  def login_notification
    user = User.first
    login_history = user.login_histories.last || LoginHistory.new(
      user: user,
      ip_address: "192.168.1.1",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      signed_in_at: Time.current
    )
    UserMailer.login_notification(user, login_history)
  end
end
