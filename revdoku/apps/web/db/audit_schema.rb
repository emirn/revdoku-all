# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_03_22_010000) do
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
