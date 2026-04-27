# frozen_string_literal: true

class Users::SessionsController < Devise::SessionsController
  def destroy
    if current_user
      current_user.api_keys.sessions.destroy_all
    end
    cookies.delete(:revdoku_api_key)
    super
  end
end
