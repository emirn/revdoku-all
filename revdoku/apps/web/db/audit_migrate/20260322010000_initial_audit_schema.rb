# frozen_string_literal: true

class InitialAuditSchema < ActiveRecord::Migration[8.1]
  def change
    create_table "audit_logs", force: :cascade do |t|
      t.string "account_id"
      t.datetime "created_at", null: false
      t.float "duration"
      t.string "envelope_id"
      t.text "ip_ciphertext"
      t.string "path", null: false
      t.string "prefix_id"
      t.text "request_ciphertext"
      t.string "request_id"
      t.text "response_ciphertext"
      t.integer "response_code", null: false
      t.integer "source_type", default: 0, null: false
      t.datetime "updated_at", null: false
      t.text "user_agent_ciphertext"
      t.string "user_id"
      t.index ["account_id"], name: "index_audit_logs_on_account_id"
      t.index ["created_at"], name: "index_audit_logs_on_created_at"
      t.index ["envelope_id"], name: "index_audit_logs_on_envelope_id"
      t.index ["user_id"], name: "index_audit_logs_on_user_id"
    end
  end
end
