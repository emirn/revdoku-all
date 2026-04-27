# frozen_string_literal: true

module Api
  module V1
    # Two authentication surfaces, one controller:
    #
    # 1. Singular key (`show` + `rotate`) — always available. Every user has
    #    exactly one "primary" API key visible in the /account/api page on CE.
    #    `show` returns the current one (auto-created on first call); `rotate`
    #    revokes all existing keys and issues a fresh one, returning the
    #    plaintext value once so the caller can copy it.
    #
    # 2. Multi-key management (`index` + `create` + `destroy`) — gated on the
    #    `api_key_management` feature flag. 404s when the flag is off so the
    #    endpoint is undetectable; active on commercial deployments for users
    #    who need per-integration labelled keys with independent expiration.
    class ApiKeysController < Api::BaseController
      skip_after_action :verify_authorized
      before_action :ensure_multi_key_management!, only: %i[index create destroy]
      before_action :require_session_key!

      EXPIRATION_OPTIONS = {
        "30d" => 30.days,
        "90d" => 90.days,
        "1y" => 1.year,
        "3y" => 3.years,
        "5y" => 5.years
      }.freeze

      DEFAULT_SINGLE_KEY_LABEL = "API Key"
      DEFAULT_SINGLE_KEY_EXPIRATION = 5.years

      # ─── Singular: always-on ──────────────────────────────────────────

      # GET /api/v1/account/api_key
      # Returns the user's single primary key without plaintext, or
      # { token: null } when no key exists. Never auto-creates — the UI
      # shows a "Generate API key" button that POSTs to #rotate when the
      # user wants one. Auto-minting a key just because the Account → API
      # page was loaded created "Your API key" rows for admins who never
      # asked for one and have no integration to hand it to, which is a
      # small but real credential-exposure footgun.
      def show
        key = primary_key_without_creating
        render_api_success({ token: key ? format_key(key) : nil })
      end

      # POST /api/v1/account/api_key/rotate
      # Revokes every existing key for the user on this account and issues
      # one fresh key. Doubles as the "generate my first key" action —
      # revoking zero existing keys is a no-op, so the first call on an
      # account that has none just mints the first one. Returns the
      # plaintext value so the caller can copy it.
      def rotate
        revoke_all_user_keys_on_account!
        key = create_primary_key!
        render_api_created({ token: format_key(key).merge(plaintext_token: key.token) })
      end

      # ─── Multi-key: gated on api_key_management ───────────────────────

      # GET /api/v1/account/api_keys
      def index
        keys = ApiKey.for_account(current_account.prefix_id).api_keys_only.usable_and_live
        render_api_success({ tokens: keys.map { |k| format_key(k) } })
      end

      # POST /api/v1/account/api_keys
      def create
        duration = EXPIRATION_OPTIONS[params[:expires_in] || "90d"]
        unless duration
          render_api_bad_request("Invalid expiration. Options: 30d, 90d, 1y, 3y, 5y")
          return
        end

        key = ApiKey.new(
          user: current_user,
          label: params[:name].presence || "API Key",
          token_type: :api,
          expires_at: duration.from_now,
          metadata: { account_id: current_account.prefix_id }
        )
        key.save!

        render_api_created({
          token: format_key(key).merge(plaintext_token: key.token)
        })
      end

      # DELETE /api/v1/account/api_keys/:id
      def destroy
        key = ApiKey.for_account(current_account.prefix_id)
                    .api_keys_only
                    .find_by_prefix_id!(params[:id])
        key.update!(status: :revoked, expires_at: Time.current)
        render_api_success({ message: "Key revoked" })
      end

      private

      def ensure_multi_key_management!
        render_api_not_found unless Revdoku.feature_enabled?(:api_key_management)
      end

      def require_session_key!
        unless @api_key&.session?
          render_api_forbidden("API key management requires web session authentication")
        end
      end

      # Renamed from primary_key_or_create! — #show must be a pure read and
      # never mint a key as a side effect of loading the settings page.
      def primary_key_without_creating
        ApiKey.for_account(current_account.prefix_id)
              .api_keys_only
              .usable_and_live
              .where(user_id: current_user.id)
              .order(created_at: :asc)
              .first
      end

      def create_primary_key!
        ApiKey.create!(
          user: current_user,
          label: DEFAULT_SINGLE_KEY_LABEL,
          token_type: :api,
          expires_at: DEFAULT_SINGLE_KEY_EXPIRATION.from_now,
          metadata: { account_id: current_account.prefix_id }
        )
      end

      def revoke_all_user_keys_on_account!
        ApiKey.for_account(current_account.prefix_id)
              .api_keys_only
              .where(user_id: current_user.id)
              .update_all(status: ApiKey.statuses[:revoked], expires_at: Time.current)
      end

      def format_key(key)
        {
          id: key.prefix_id,
          name: key.label,
          masked_hint: key.masked_hint,
          created_at: key.created_at,
          last_used_at: key.last_authenticated_at,
          expires_at: key.expires_at
        }
      end
    end
  end
end
