# frozen_string_literal: true

class Notification < ApplicationRecord
  has_prefix_id :notif

  belongs_to :user
  belongs_to :account, optional: true

  validates :notification_type, presence: true

  scope :unread, -> { where(read_at: nil) }
  scope :newest_first, -> { order(created_at: :desc) }
  scope :visible_to, ->(user, account) {
    where(user: user, account_id: [account&.id, nil])
  }

  def read?
    read_at.present?
  end

  def mark_as_read!
    update!(read_at: Time.current) unless read?
  end
end
