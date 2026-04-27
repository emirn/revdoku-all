# frozen_string_literal: true

module Api
  module V1
    class SessionsController < Api::BaseController
      skip_after_action :verify_authorized
      before_action :ensure_sessions_management_enabled!
      before_action :require_session_key!

      # GET /api/v1/account/sessions
      def index
        keys = current_user.api_keys
                           .sessions
                           .usable_and_live
                           .for_account(current_account.prefix_id)
                           .order(last_authenticated_at: :desc)

        render_api_success({ sessions: keys.map { |k| format_session(k) } })
      end

      # DELETE /api/v1/account/sessions/:id
      def destroy
        key = current_user.api_keys
                          .sessions
                          .usable_and_live
                          .for_account(current_account.prefix_id)
                          .find_by_prefix_id!(params[:id])

        revoked_current = key.id == @api_key.id
        key.revoke!

        render_api_success({ message: "Session revoked", revoked_current: revoked_current })
      end

      # DELETE /api/v1/account/sessions/revoke_all_others
      def revoke_all_others
        other_keys = current_user.api_keys
                                 .sessions
                                 .usable_and_live
                                 .for_account(current_account.prefix_id)
                                 .where.not(id: @api_key.id)

        # Delete cache keys for immediate invalidation
        other_keys.find_each do |key|
          Rails.cache.delete("auth_token:#{key.secret_hash}")
        end

        count = other_keys.update_all(status: ApiKey.statuses[:revoked], expires_at: Time.current)

        render_api_success({ message: "#{count} other session(s) revoked", revoked_count: count })
      end

      private

      # 404 every action when sessions_management is off (CE posture). The
      # endpoint's existence is undetectable on self-host community builds.
      def ensure_sessions_management_enabled!
        render_api_not_found unless Revdoku.feature_enabled?(:sessions_management)
      end

      def require_session_key!
        unless @api_key&.session?
          render_api_forbidden("Session management requires web session authentication")
        end
      end

      def format_session(key)
        session = {
          id: key.prefix_id,
          device_info: key.device_info.presence || {},
          display_device: key.display_device,
          last_used_at: key.last_authenticated_at,
          created_at: key.created_at,
          is_current: key.id == @api_key.id
        }
        session[:ip_address] = key.ip_address if current_account.security_level_high?
        session
      end
    end
  end
end
