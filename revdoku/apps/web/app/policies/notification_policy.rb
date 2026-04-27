# frozen_string_literal: true

class NotificationPolicy < ApplicationPolicy
  def index?
    true
  end

  def unread_count?
    true
  end

  def mark_as_read?
    record.user_id == user.id
  end

  def mark_all_as_read?
    true
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      Notification.visible_to(user, Principal.account)
    end
  end
end
