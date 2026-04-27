# frozen_string_literal: true

module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      self.current_user = find_verified_user
    end

    private

    def find_verified_user
      raw_secret = cookies.signed[:revdoku_api_key]
      reject_unauthorized_connection unless raw_secret.present?

      api_key = ApiKey.resolve(raw_secret)
      reject_unauthorized_connection unless api_key

      api_key.user
    end
  end
end
