# frozen_string_literal: true

class InitialSchema < ActiveRecord::Migration[8.1]
  def change
    create_table "account_members", force: :cascade do |t|
      t.bigint "account_id", null: false
      t.datetime "created_at", null: false
      t.json "permissions", default: { "perm" => { "role" => "collaborator", "scopes" => [] } }
      t.datetime "updated_at", null: false
      t.bigint "user_id", null: false
      t.bigint "scoped_to_envelope_id"
      t.datetime "last_active_on_envelope_at"
      t.index ["account_id", "user_id"], name: "index_account_members_on_account_id_and_user_id", unique: true
      t.index ["account_id"], name: "index_account_members_on_account_id"
      t.index ["user_id"], name: "index_account_members_on_user_id"
      t.index ["scoped_to_envelope_id"], name: "index_account_members_on_scoped_to_envelope_id"
    end

    create_table "accounts", force: :cascade do |t|
      t.datetime "created_at", null: false
      t.integer "credits_purchased", default: 0, null: false
      t.datetime "credits_purchased_expire_at"
      t.integer "credits_subscription", default: 0, null: false
      t.string "default_checklist_generation_model"
      t.string "default_checklist_model"
      t.string "default_font_family"
      t.float "default_font_scale"
      t.text "encrypted_kms_key"
      t.text "encryption_key_ciphertext"
      t.datetime "encryption_key_generated_at"
      t.datetime "encryption_key_shredded_at"
      t.integer "encryption_key_version", default: 1, null: false
      t.integer "security_level", default: 0, null: false
      t.boolean "hipaa_enabled", default: false, null: false
      t.integer "max_checklists", default: 10000, null: false
      t.integer "max_envelopes", default: 10000, null: false
      t.integer "max_file_size_mb", default: 50, null: false
      t.integer "max_revisions", default: 10000, null: false
      t.integer "max_team_members", default: 100, null: false
      t.json "meta", default: {}
      t.string "name", null: false
      t.bigint "owner_id", null: false
      t.boolean "personal", default: false
      t.string "prefix_id"
      t.datetime "setup_completed_at"
      t.datetime "storage_credits_charged_at"
      t.datetime "audit_access_for_support_expires_at"
      t.datetime "updated_at", null: false
      t.index ["owner_id"], name: "index_accounts_on_owner_id"
      t.index ["prefix_id"], name: "index_accounts_on_prefix_id", unique: true
    end

    create_table "active_admin_comments", force: :cascade do |t|
      t.integer "author_id"
      t.string "author_type"
      t.text "body"
      t.datetime "created_at", null: false
      t.string "namespace"
      t.integer "resource_id"
      t.string "resource_type"
      t.datetime "updated_at", null: false
      t.index ["author_type", "author_id"], name: "index_active_admin_comments_on_author"
      t.index ["namespace"], name: "index_active_admin_comments_on_namespace"
      t.index ["resource_type", "resource_id"], name: "index_active_admin_comments_on_resource"
    end

    create_table "active_storage_attachments", force: :cascade do |t|
      t.bigint "blob_id", null: false
      t.datetime "created_at", null: false
      t.string "name", null: false
      t.bigint "record_id", null: false
      t.string "record_type", null: false
      t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
      t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
    end

    create_table "active_storage_blobs", force: :cascade do |t|
      t.bigint "byte_size", null: false
      t.string "checksum"
      t.string "content_type"
      t.datetime "created_at", null: false
      t.string "filename", null: false
      t.string "key", null: false
      t.text "metadata"
      t.string "service_name", null: false
      t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
    end

    create_table "active_storage_variant_records", force: :cascade do |t|
      t.bigint "blob_id", null: false
      t.string "variation_digest", null: false
      t.index ["blob_id", "variation_digest"], name: "index_active_storage_variant_records_uniqueness", unique: true
    end

    create_table "api_keys", force: :cascade do |t|
      t.datetime "created_at", null: false
      t.json "device_info", default: {}
      t.datetime "expires_at", null: false
      t.string "ip_address"
      t.string "issued_via"
      t.string "label", null: false
      t.datetime "last_authenticated_at"
      t.json "metadata", default: {}
      t.string "prefix_id"
      t.integer "rate_limit_tier", default: 0, null: false
      t.integer "scope", default: 1, null: false
      t.string "secret_hash"
      t.integer "status", default: 0, null: false
      t.text "token_ciphertext"
      t.integer "token_type", default: 0, null: false
      t.datetime "updated_at", null: false
      t.string "user_agent_raw"
      t.bigint "user_id", null: false
      t.index ["last_authenticated_at"], name: "index_api_keys_on_last_authenticated_at"
      t.index ["prefix_id"], name: "index_api_keys_on_prefix_id", unique: true
      t.index ["secret_hash"], name: "index_api_keys_on_secret_hash", unique: true
      t.index ["user_id", "token_type", "expires_at"], name: "idx_api_keys_user_type_expires"
      t.index ["user_id", "status"], name: "index_api_keys_on_user_id_and_status"
      t.index ["user_id"], name: "index_api_keys_on_user_id"
    end

    create_table "audits", force: :cascade do |t|
      t.string "action"
      t.bigint "associated_id"
      t.string "associated_type"
      t.bigint "auditable_id"
      t.string "auditable_type"
      t.text "audited_changes_ciphertext"
      t.text "comment_ciphertext"
      t.datetime "created_at"
      t.string "remote_address"
      t.string "request_uuid"
      t.bigint "user_id"
      t.string "user_type"
      t.string "username"
      t.integer "version", default: 0
      t.index ["associated_type", "associated_id"], name: "associated_index"
      t.index ["auditable_type", "auditable_id", "version"], name: "auditable_index"
      t.index ["created_at"], name: "index_audits_on_created_at"
      t.index ["request_uuid"], name: "index_audits_on_request_uuid"
      t.index ["user_id", "user_type"], name: "user_index"
    end

    create_table "checklist_templates", force: :cascade do |t|
      t.datetime "created_at", null: false
      t.string "name", null: false
      t.json "rules", default: []
      t.integer "sort_order", default: 0
      t.text "system_prompt"
      t.datetime "updated_at", null: false
      t.boolean "visible", default: true
    end

    create_table "checklists", force: :cascade do |t|
      t.bigint "account_id", null: false
      t.string "ai_model"
      t.datetime "created_at", null: false
      t.bigint "created_by_id"
      t.integer "highlight_mode", default: 0, null: false
      t.text "name_ciphertext"
      t.string "prefix_id"
      t.integer "revision_number", default: 0, null: false
      t.text "rules_ciphertext"
      t.text "source_text_ciphertext"
      t.text "system_prompt_ciphertext"
      t.boolean "track_changes", default: false, null: false
      t.datetime "updated_at", null: false
      t.bigint "updated_by_id"
      t.index ["account_id"], name: "index_checklists_on_account_id"
      t.index ["created_by_id"], name: "index_checklists_on_created_by_id"
      t.index ["prefix_id"], name: "index_checklists_on_prefix_id", unique: true
      t.index ["updated_by_id"], name: "index_checklists_on_updated_by_id"
    end

    create_table "checks", force: :cascade do |t|
      t.bigint "account_id"
      t.integer "check_index"
      t.bigint "checklist_id"
      t.datetime "created_at", null: false
      t.bigint "created_by_id"
      t.text "data_ciphertext"
      t.text "description_ciphertext"
      t.text "description_position_json"
      t.integer "page"
      t.boolean "passed", null: false
      t.string "prefix_id"
      t.bigint "report_id"
      t.string "rule_key", null: false
      t.integer "source", default: 0, null: false
      t.datetime "updated_at", null: false
      t.bigint "updated_by_id"
      t.integer "x1"
      t.integer "x2"
      t.integer "y1"
      t.integer "y2"
      t.index ["account_id"], name: "index_checks_on_account_id"
      t.index ["checklist_id"], name: "index_checks_on_checklist_id"
      t.index ["prefix_id"], name: "index_checks_on_prefix_id", unique: true
      t.index ["report_id", "rule_key"], name: "idx_checks_report_rule"
      t.index ["report_id"], name: "index_checks_on_report_id"
      t.index ["rule_key"], name: "index_checks_on_rule_key"
      t.index ["source"], name: "index_checks_on_source"
    end

    create_table "connected_accounts", force: :cascade do |t|
      t.text "access_token_ciphertext"
      t.text "access_token_secret_ciphertext"
      t.text "auth"
      t.datetime "created_at", null: false
      t.datetime "expires_at"
      t.string "provider", null: false
      t.text "refresh_token_ciphertext"
      t.string "uid", null: false
      t.datetime "updated_at", null: false
      t.bigint "user_id", null: false
      t.index ["provider", "uid"], name: "index_connected_accounts_on_provider_and_uid", unique: true
      t.index ["user_id"], name: "index_connected_accounts_on_user_id"
    end

    create_table "credit_transactions", force: :cascade do |t|
      t.integer "account_id", null: false
      t.integer "amount", null: false
      t.integer "balance_after", null: false
      t.datetime "created_at", null: false
      t.string "note"
      t.string "reason", null: false
      t.string "reference_id"
      t.datetime "updated_at", null: false
      t.index ["account_id", "created_at"], name: "index_credit_transactions_on_account_id_and_created_at"
      t.index ["account_id"], name: "index_credit_transactions_on_account_id"
    end

    create_table "document_file_revisions", force: :cascade do |t|
      t.bigint "account_id"
      t.string "content_hash"
      t.datetime "created_at", null: false
      t.bigint "created_by_id"
      t.bigint "document_file_id", null: false
      t.text "metadata"
      t.string "mime_type", null: false
      t.text "name_ciphertext"
      t.string "prefix_id"
      t.integer "revision_number", null: false
      t.integer "size"
      t.datetime "updated_at", null: false
      t.bigint "updated_by_id"
      t.index ["account_id"], name: "index_document_file_revisions_on_account_id"
      t.index ["created_by_id"], name: "index_document_file_revisions_on_created_by_id"
      t.index ["document_file_id", "content_hash"], name: "idx_doc_file_rev_content_hash"
      t.index ["document_file_id", "revision_number"], name: "idx_doc_file_revisions_unique", unique: true
      t.index ["document_file_id"], name: "index_document_file_revisions_on_document_file_id"
      t.index ["prefix_id"], name: "index_document_file_revisions_on_prefix_id", unique: true
      t.index ["updated_by_id"], name: "index_document_file_revisions_on_updated_by_id"
    end

    create_table "document_file_revisions_envelope_revisions", id: false, force: :cascade do |t|
      t.bigint "document_file_revision_id", null: false
      t.bigint "envelope_revision_id", null: false
      t.integer "position", default: 0, null: false
      t.index ["document_file_revision_id"], name: "idx_on_document_file_revision_id_827b6f551c"
      t.index ["envelope_revision_id", "document_file_revision_id"], name: "idx_env_rev_doc_rev", unique: true
      t.index ["envelope_revision_id"], name: "idx_on_envelope_revision_id_8556ac57eb"
    end

    create_table "document_files", force: :cascade do |t|
      t.bigint "account_id"
      t.datetime "created_at", null: false
      t.bigint "created_by_id"
      t.bigint "envelope_id", null: false
      t.string "prefix_id"
      t.datetime "updated_at", null: false
      t.bigint "updated_by_id"
      t.index ["account_id"], name: "index_document_files_on_account_id"
      t.index ["created_by_id"], name: "index_document_files_on_created_by_id"
      t.index ["envelope_id"], name: "index_document_files_on_envelope_id"
      t.index ["prefix_id"], name: "index_document_files_on_prefix_id", unique: true
      t.index ["updated_by_id"], name: "index_document_files_on_updated_by_id"
    end

    create_table "envelope_revisions", force: :cascade do |t|
      t.text "comment_ciphertext"
      t.datetime "created_at", null: false
      t.bigint "created_by_id"
      t.text "revision_rules_ciphertext"
      t.bigint "envelope_id", null: false
      t.integer "page_count", default: 0, null: false
      t.string "prefix_id"
      t.integer "revision_number", null: false
      t.datetime "updated_at", null: false
      t.bigint "updated_by_id"
      t.index ["created_by_id"], name: "index_envelope_revisions_on_created_by_id"
      t.index ["envelope_id", "revision_number"], name: "index_envelope_revisions_on_envelope_id_and_revision_number", unique: true
      t.index ["envelope_id"], name: "index_envelope_revisions_on_envelope_id"
      t.index ["prefix_id"], name: "index_envelope_revisions_on_prefix_id", unique: true
      t.index ["updated_by_id"], name: "index_envelope_revisions_on_updated_by_id"
    end

    create_table "envelope_tags", force: :cascade do |t|
      t.datetime "created_at", null: false
      t.bigint "envelope_id", null: false
      t.bigint "tag_id", null: false
      t.datetime "updated_at", null: false
      t.index ["envelope_id", "tag_id"], name: "index_envelope_tags_on_envelope_id_and_tag_id", unique: true
      t.index ["tag_id"], name: "index_envelope_tags_on_tag_id"
    end

    create_table "envelopes", force: :cascade do |t|
      t.bigint "account_id", null: false
      t.datetime "archived_at"
      t.datetime "created_at", null: false
      t.bigint "created_by_id"
      t.integer "current_revision_index", default: 0
      t.datetime "last_viewed_at"
      t.string "prefix_id"
      t.text "report_settings"
      t.integer "source", default: 0, null: false
      t.boolean "starred", default: false, null: false
      t.integer "status", default: 0
      t.text "title_ciphertext"
      t.datetime "updated_at", null: false
      t.bigint "updated_by_id"
      t.text "view_settings"
      t.index ["account_id"], name: "index_envelopes_on_account_id"
      t.index ["archived_at"], name: "index_envelopes_on_archived_at"
      t.index ["created_by_id"], name: "index_envelopes_on_created_by_id"
      t.index ["prefix_id"], name: "index_envelopes_on_prefix_id", unique: true
      t.index ["source"], name: "index_envelopes_on_source"
      t.index ["starred"], name: "index_envelopes_on_starred"
      t.index ["status"], name: "index_envelopes_on_status"
      t.index ["updated_by_id"], name: "index_envelopes_on_updated_by_id"
    end

    create_table "login_histories", force: :cascade do |t|
      t.datetime "created_at", null: false
      t.string "device_fingerprint"
      t.string "ip_address"
      t.string "location"
      t.datetime "signed_in_at", null: false
      t.datetime "updated_at", null: false
      t.string "user_agent"
      t.integer "user_id", null: false
      t.index ["signed_in_at"], name: "index_login_histories_on_signed_in_at"
      t.index ["user_id", "device_fingerprint"], name: "idx_login_histories_user_device_fp"
      t.index ["user_id", "signed_in_at"], name: "index_login_histories_on_user_id_and_signed_in_at"
      t.index ["user_id"], name: "index_login_histories_on_user_id"
    end

    create_table "notifications", force: :cascade do |t|
      t.references :account, null: true, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.string :notification_type, null: false
      t.json :params, default: {}
      t.datetime :read_at
      t.timestamps
      t.index [:user_id, :account_id, :read_at, :created_at],
              name: "idx_notifications_user_account_unread"
    end

    create_table "orders", force: :cascade do |t|
      t.integer "account_id", null: false
      t.integer "amount_cents", default: 0, null: false
      t.datetime "created_at", null: false
      t.bigint "created_by_id"
      t.integer "credits"
      t.string "invoice_url"
      t.string "note"
      t.string "order_ref"
      t.datetime "ordered_at", null: false
      t.string "prefix_id"
      t.string "source", default: "internal", null: false
      t.string "status", default: "completed", null: false
      t.integer "subscription_plan_id"
      t.datetime "updated_at", null: false
      t.bigint "updated_by_id"
      t.integer "user_id"
      t.index ["account_id"], name: "index_orders_on_account_id"
      t.index ["created_by_id"], name: "index_orders_on_created_by_id"
      t.index ["ordered_at"], name: "index_orders_on_ordered_at"
      t.index ["prefix_id"], name: "index_orders_on_prefix_id", unique: true
      t.index ["status"], name: "index_orders_on_status"
      t.index ["subscription_plan_id"], name: "index_orders_on_subscription_plan_id"
      t.index ["updated_by_id"], name: "index_orders_on_updated_by_id"
      t.index ["user_id"], name: "index_orders_on_user_id"
    end

    create_table "reports", force: :cascade do |t|
      t.bigint "account_id"
      t.string "ai_model"
      t.datetime "created_at", null: false
      t.bigint "created_by_id"
      t.integer "credits_consumed"
      t.bigint "envelope_revision_id", null: false
      t.text "error_message_ciphertext"
      t.text "inspection_context_ciphertext"
      t.string "job_id"
      t.integer "job_status", default: 2, null: false
      t.text "meta"
      t.text "page_texts_ciphertext"
      t.text "pages_layout_json"
      t.string "prefix_id"
      t.datetime "updated_at", null: false
      t.bigint "updated_by_id"
      t.index ["account_id"], name: "index_reports_on_account_id"
      t.index ["created_by_id"], name: "index_reports_on_created_by_id"
      t.index ["envelope_revision_id"], name: "index_reports_on_envelope_revision_id", unique: true
      t.index ["job_id"], name: "index_reports_on_job_id"
      t.index ["job_status"], name: "index_reports_on_job_status"
      t.index ["prefix_id"], name: "index_reports_on_prefix_id", unique: true
      t.index ["updated_by_id"], name: "index_reports_on_updated_by_id"
    end

    create_table "subscription_plans", force: :cascade do |t|
      t.integer "audit_retention_days", default: 90, null: false
      t.datetime "created_at", null: false
      t.integer "credits", null: false
      t.boolean "hidden", default: false, null: false
      t.integer "interval", null: false
      t.string "name", null: false
      t.string "prefix_id"
      t.integer "price_cents", default: 0, null: false
      t.string "sku", null: false
      t.integer "sort_order", default: 0, null: false
      t.integer "max_security_level", default: 0, null: false
      t.boolean "supports_hipaa", default: false, null: false
      t.datetime "updated_at", null: false
      t.string "url"
      t.index ["prefix_id"], name: "index_subscription_plans_on_prefix_id", unique: true
      t.index ["sku"], name: "index_subscription_plans_on_sku", unique: true
    end

    create_table "subscriptions", force: :cascade do |t|
      t.integer "account_id", null: false
      t.datetime "canceled_at"
      t.datetime "created_at", null: false
      t.datetime "current_period_end"
      t.datetime "current_period_start"
      t.string "external_id"
      t.string "prefix_id"
      t.integer "previous_recurring_plan_id"
      t.integer "status", default: 0, null: false
      t.integer "subscription_plan_id", null: false
      t.datetime "updated_at", null: false
      t.index ["account_id", "status"], name: "index_subscriptions_on_account_id_and_status"
      t.index ["account_id"], name: "index_subscriptions_on_account_id"
      t.index ["external_id"], name: "index_subscriptions_on_external_id", unique: true, where: "external_id IS NOT NULL"
      t.index ["prefix_id"], name: "index_subscriptions_on_prefix_id", unique: true
      t.index ["previous_recurring_plan_id"], name: "index_subscriptions_on_previous_recurring_plan_id"
      t.index ["status"], name: "index_subscriptions_on_status"
      t.index ["subscription_plan_id"], name: "index_subscriptions_on_subscription_plan_id"
    end

    create_table "tags", force: :cascade do |t|
      t.bigint "account_id", null: false
      t.string "auto_source"
      t.string "color", default: "gray", null: false
      t.datetime "created_at", null: false
      t.text "name_ciphertext"
      t.integer "position", default: 0, null: false
      t.string "prefix_id"
      t.datetime "updated_at", null: false
      t.index ["account_id", "auto_source"], name: "index_tags_on_account_id_and_auto_source"
      t.index ["account_id", "position"], name: "index_tags_on_account_id_and_position"
      t.index ["prefix_id"], name: "index_tags_on_prefix_id", unique: true
    end

    create_table "users", force: :cascade do |t|
      t.boolean "admin", default: false
      t.datetime "confirmation_sent_at"
      t.string "confirmation_token"
      t.datetime "confirmed_at"
      t.datetime "created_at", null: false
      t.datetime "current_sign_in_at"
      t.string "current_sign_in_ip"
      t.string "email", default: "", null: false
      t.string "email_canonical", null: false
      t.string "encrypted_password", default: "", null: false
      t.integer "failed_attempts", default: 0, null: false
      t.string "first_name"
      t.string "last_name"
      t.datetime "last_sign_in_at"
      t.string "last_sign_in_ip"
      t.datetime "locked_at"
      t.integer "login_otp_attempts", default: 0
      t.string "login_otp_digest"
      t.datetime "login_otp_sent_at"
      t.text "otp_backup_codes"
      t.boolean "otp_required_for_login", default: false
      t.text "otp_secret_ciphertext"
      t.string "prefix_id"
      t.string "provider"
      t.datetime "remember_created_at"
      t.datetime "reset_password_sent_at"
      t.string "reset_password_token"
      t.integer "sign_in_count", default: 0, null: false
      t.string "time_zone"
      t.string "uid"
      t.string "unconfirmed_email"
      t.string "unlock_token"
      t.datetime "updated_at", null: false
      t.string "utm_campaign"
      t.string "utm_content"
      t.string "utm_medium"
      t.string "utm_source"
      t.string "utm_term"
      t.index ["confirmation_token"], name: "index_users_on_confirmation_token", unique: true
      t.index ["email"], name: "index_users_on_email", unique: true
      t.index ["email_canonical"], name: "index_users_on_email_canonical", unique: true
      t.index ["prefix_id"], name: "index_users_on_prefix_id", unique: true
      t.index ["reset_password_token"], name: "index_users_on_reset_password_token", unique: true
      t.index ["unlock_token"], name: "index_users_on_unlock_token", unique: true
      t.index ["utm_campaign"], name: "index_users_on_utm_campaign"
      t.index ["utm_source"], name: "index_users_on_utm_source"
    end

    add_foreign_key "account_members", "accounts", on_delete: :cascade
    add_foreign_key "account_members", "users", on_delete: :cascade
    add_foreign_key "accounts", "users", column: "owner_id", on_delete: :cascade
    add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
    add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
    add_foreign_key "api_keys", "users", on_delete: :cascade
    add_foreign_key "checklists", "accounts", on_delete: :cascade
    add_foreign_key "checks", "accounts", on_delete: :cascade
    add_foreign_key "checks", "checklists", on_delete: :nullify
    add_foreign_key "checks", "reports", on_delete: :cascade
    add_foreign_key "connected_accounts", "users", on_delete: :cascade
    add_foreign_key "credit_transactions", "accounts"
    add_foreign_key "document_file_revisions", "accounts", on_delete: :cascade
    add_foreign_key "document_file_revisions", "document_files", on_delete: :cascade
    add_foreign_key "document_files", "accounts", on_delete: :cascade
    add_foreign_key "document_files", "envelopes", on_delete: :cascade
    add_foreign_key "envelope_revisions", "envelopes", on_delete: :cascade
    add_foreign_key "envelope_tags", "envelopes", on_delete: :cascade
    add_foreign_key "envelope_tags", "tags", on_delete: :cascade
    add_foreign_key "envelopes", "accounts", on_delete: :cascade
    add_foreign_key "login_histories", "users", on_delete: :cascade
    add_foreign_key "orders", "accounts", on_delete: :cascade
    add_foreign_key "orders", "subscription_plans"
    add_foreign_key "orders", "users", on_delete: :nullify
    add_foreign_key "reports", "accounts", on_delete: :cascade
    add_foreign_key "reports", "envelope_revisions", on_delete: :cascade
    add_foreign_key "subscriptions", "accounts", on_delete: :cascade
    add_foreign_key "subscriptions", "subscription_plans"
    add_foreign_key "tags", "accounts", on_delete: :cascade
  end
end
