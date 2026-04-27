# frozen_string_literal: true

require_relative "../lib/admin_ip_constraint"

Rails.application.routes.draw do
  # Admin dashboard (IP-restricted in production via ADMIN_ALLOWED_IPS)
  constraints AdminIpConstraint.new do
    ActiveAdmin.routes(self)
  end

  # User Authentication — shape depends on the instance's login mode.
  # See Revdoku.login_mode (otp | password | password_no_confirmation).
  devise_controllers = { registrations: "users/registrations" }
  devise_controllers[:omniauth_callbacks] = "users/omniauth_callbacks" if Revdoku.google_auth_enabled?

  if Revdoku.password_based_login?
    # Self-host: email + password sign-in. Devise's standard sessions
    # controller is wrapped so we can add audit logging + 2FA, and the
    # passwords (reset-via-email) routes only exist when SMTP is present
    # — password_no_confirmation installs have no mailer, so surfacing a
    # "forgot password" link that can't deliver would be a dead end.
    devise_controllers[:sessions] = "users/password_sessions"
    skip = [:passwords]
    skip = [] if Revdoku.email_delivery_configured? && Revdoku.login_mode_password?
    devise_for :users, controllers: devise_controllers, skip: skip
  else
    # Cloud (OTP): skip Devise's sessions + passwords entirely; our custom
    # OTP controller owns the sign-in surface.
    devise_for :users, controllers: devise_controllers, skip: [:sessions, :passwords]

    devise_scope :user do
      get  "users/sign_in",            to: "users/otp_sessions#new",               as: :new_user_session
      post "users/sign_in",            to: "users/otp_sessions#create",            as: :user_session
      post "users/sign_in/verify",     to: "users/otp_sessions#verify",            as: :verify_user_otp
      post "users/sign_in/two_factor", to: "users/otp_sessions#two_factor_verify", as: :two_factor_verify_user_otp
      delete "users/sign_out",         to: "users/sessions#destroy",               as: :destroy_user_session

      # OTP-based email confirmation after signup
      get  "users/confirm_email",        to: "users/registrations#confirm_email",       as: :users_confirm_email
      post "users/confirm_email/verify", to: "users/registrations#verify_confirmation", as: :users_verify_confirmation
      post "users/confirm_email/resend", to: "users/registrations#resend_confirmation", as: :users_resend_confirmation
    end
  end

  # Account selection (post-login)
  get "accounts/select", to: "accounts#select", as: :select_account
  post "accounts/select", to: "accounts#choose", as: :choose_account

  # Account & Team Management
  resources :accounts do
    member do
      patch :switch
    end
    resources :account_members, path: "members", only: [:edit, :update, :destroy]
  end

  # User Settings
  namespace :users do
    resource :two_factor_authentication, only: [:show, :create, :destroy]
  end

  # Frontend serving (React app)
  get "envelopes/manifest", to: "envelopes#manifest"
  get "envelopes", to: "envelopes#index"
  get "envelopes/*path", to: "envelopes#show"

  # Checklists page (served by React app)
  get "checklists", to: "envelopes#index"
  get "checklists/*path", to: "envelopes#show"

  # Logs page (served by React app)
  get "logs", to: "envelopes#index"

  # Library page (served by React app)
  get "library", to: "envelopes#index"
  get "library/*path", to: "envelopes#show"

  # Account pages (served by React app)
  get "account", to: "envelopes#index"
  get "account/*path", to: "envelopes#show"

  # API
  namespace :api do
    namespace :v1 do
      # Auth
      post "auth/refresh", to: "auth#refresh"

      # Tags
      resources :tags, only: [:index, :create, :update, :destroy]

      # Envelopes
      resources :envelopes do
        member do
          get :thumbnail
          put :thumbnail, action: :upload_thumbnail
          post :create_revision
          post :update_document_files
          post :rollback
          post :archive
          post :unarchive
          post :toggle_star
          post :duplicate
          post :edit_current_revision
          post :update_revision_comment
          get :ref_file_history
          post :debug_only_export_fixture if Rails.env.development?
          post :clear_caches if Rails.env.development?
        end
        collection do
          post :bulk_action
          post :load_fixture if Rails.env.development?
        end
        # Envelope tags
        resources :tags, controller: 'envelope_tags', only: [:create, :destroy]
        # Nested document files for envelope scoping
        resources :document_files, only: [:index]
      end

      # Envelope revisions — custom rules management
      resources :envelope_revisions, only: [] do
        member do
          get :all_revision_rules
          post :add_revision_rules
          post :update_revision_rules
          post :remove_revision_rules
        end
      end

      # Standalone document file routes (for frontend compatibility)
      resources :document_files, only: [:destroy]

      # Document file revisions (accessed via prefix_id, not nested)
      resources :document_file_revisions, only: [] do
        member do
          get :content
        end
      end

      # Account-library reference files (backing the #file / file:<id> markers).
      resources :files, only: [:index, :create, :destroy] do
        member do
          get :revisions
          post :revisions, action: :create_revision
        end
        collection do
          get "revisions/:revision_id", action: :revision_status, as: :revision_status
          get "revisions/:revision_id/page_texts", action: :revision_page_texts, as: :revision_page_texts
          post :copy_to_library
        end
      end

      # Checklist Templates (global catalog)
      resources :checklist_templates, only: [:index, :show]

      # Per-account AI provider API keys. `:provider` is the URL key (e.g.
      # "openai", "google_cloud", or a custom provider not in the YAML) rather
      # than an integer id so routes read as
      # /api/v1/account/ai_provider_keys/openai.
      namespace :account do
        resources :ai_provider_keys, only: [:index, :create, :update, :destroy], param: :provider do
          member { post :test }
        end
      end

      # Checklists
      resources :checklists do
        collection do
          post :generate
        end
        member do
          get :versions
          post :rollback
          post :add_rules
          post :remove_rules
          post :update_rules
          get :file_suggestions
        end
      end

      # Reports
      resources :reports, only: [:create, :show, :update] do
        collection do
          post :create_stub
        end
        member do
          post :export
          get :status
          get :page_texts
          post :reset
          post :cancel
          post :resume
        end
        resources :checks, only: [:create]
      end

      # Checks (standalone)
      resources :checks, only: [:update, :destroy]

      # AI Models
      resources :ai_models, only: [:index]

      # Object versions (generic audit trail)
      get "versions/:resource_type/:resource_id", to: "versions#show"

      # Audit logs
      resources :audit_logs, only: [:index] do
        collection do
          get :export
        end
      end

      # Notifications
      resources :notifications, only: [:index] do
        collection do
          get :unread_count
          post :mark_all_as_read
        end
        member do
          post :mark_as_read
        end
      end

      # Current user
      resource :me, only: [:show], controller: "me"

      # Account settings (profile, logout).
      resource :account, only: [], controller: "account" do
        get :profile
        patch :update_profile
        get :members
        patch :ai_preferences
        post :switch_account
        post :logout
        resources :members, controller: "account_members", only: [:create, :destroy]
        # Singular API key — always available. Every user has exactly one
        # "primary" key they can view + rotate. Gated UI for multi-key CRUD
        # uses the plural routes below, which 404 when api_key_management is off.
        resource :api_key, only: [:show], controller: "api_keys" do
          post :rotate, on: :collection
        end
        resources :api_keys, only: [:index, :create, :destroy]
        resources :sessions, only: [:index, :destroy] do
          collection do
            delete :revoke_all_others
          end
        end
      end

    end
  end

  # Root path
  authenticated :user do
    root to: "envelopes#index", as: :authenticated_root
  end
  root to: redirect("/users/sign_in")

  # Health checks
  get "up", to: "rails/health#show", as: :rails_health_check
  get "up/full", to: "health#full", as: :full_health_check

  # Silence Chrome DevTools' automatic workspace-folder probe.
  # On every page load Chrome (in devtools-open mode) hits
  # /.well-known/appspecific/com.chrome.devtools.json to discover a local
  # workspace mapping. We have no mapping, but letting it 404 pollutes the
  # Rails log with an ActionController::RoutingError on every reload.
  # Returning 204 No Content tells Chrome "nothing here" cleanly.
  # Scoped to /appspecific/* so real `.well-known` paths (ACME, OIDC,
  # etc.) that we might add later are not swallowed.
  match "/.well-known/appspecific/*anything",
    via: :all,
    to: proc { [204, { "Content-Type" => "text/plain" }, []] }
end
