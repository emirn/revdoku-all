# frozen_string_literal: true

class ConnectedAccount < ApplicationRecord
  belongs_to :user

  validates :provider, presence: true
  validates :uid, presence: true
  validates :uid, uniqueness: { scope: :provider }

  has_encrypted :access_token
  has_encrypted :access_token_secret
  has_encrypted :refresh_token

  def expired?
    expires_at.present? && expires_at <= Time.current
  end

  def name
    provider.titleize
  end
end
