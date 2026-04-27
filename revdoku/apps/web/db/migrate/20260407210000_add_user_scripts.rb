# frozen_string_literal: true

# Adds the three encrypted user_scripts columns used by the envelope-level
# scripting feature. Scripts live alongside their owning record:
#   - envelopes      — the authoritative script for an envelope
#   - checklists     — script bundled with a checklist template
#   - reports        — cached output of the last run
# All three are encrypted via Lockbox; the underlying column is `_ciphertext`.
#
# Idempotency note:
# This migration consolidated two earlier migrations that already shipped in
# production-v1.0.111:
#   - 20260407212510 (envelopes + reports user_scripts columns)
#   - 20260407222657 (checklists user_scripts column)
# When this consolidated file is first applied to an existing production DB,
# those columns already exist. `if_not_exists: true` makes each add_column a
# safe no-op in that case; on a fresh install it still creates the column.
class AddUserScripts < ActiveRecord::Migration[8.1]
  def change
    add_column :envelopes,  :user_scripts_ciphertext,        :text, if_not_exists: true
    add_column :reports,    :user_scripts_output_ciphertext, :text, if_not_exists: true
    add_column :checklists, :user_scripts_ciphertext,        :text, if_not_exists: true
  end
end
