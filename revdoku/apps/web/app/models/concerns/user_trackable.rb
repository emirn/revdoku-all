# frozen_string_literal: true

module UserTrackable
  extend ActiveSupport::Concern

  included do
    belongs_to :created_by, class_name: "User", optional: true
    belongs_to :updated_by, class_name: "User", optional: true

    before_create :set_created_by
    before_save :set_updated_by
  end

  # Users who created or last updated this record.
  def editors
    users = [created_by, updated_by].compact.uniq(&:id)
    users.map do |user|
      {
        user_id: user.prefix_id,
        user_name: user.name.presence || user.email
      }
    end
  end

  private

  def set_created_by
    self.created_by_id ||= Principal.user&.id
  end

  def set_updated_by
    self.updated_by_id = Principal.user&.id if Principal.user
  end
end
