# frozen_string_literal: true

# Reference-files feature + nested tags, shipped April 15–16:
#
#   1. Page data (page_texts, pages_layout) moves from reports to
#      document_file_revisions — it's a property of the file, not of
#      the inspection report.
#   2. document_files gains a `reference` boolean and allows NULL
#      envelope_id, so files can live in the reference library
#      independent of any envelope.
#   3. New `ref_files` table pins (envelope_revision, rule|checklist) →
#      document_file_revision. Indexes enforce one pin per rule
#      position (or one per checklist position when rule_id is NULL).
#   4. reports gains `inspection_enqueued_at` so the overlay can
#      distinguish "queued" from "processing".
#   5. tags gains `parent_tag_id` for Gmail-style nested labels.
class DocumentFilesRefFilesAndParentTags < ActiveRecord::Migration[8.1]
  def change
    # 1. Page data moves from reports → document_file_revisions.
    add_column :document_file_revisions, :page_texts_ciphertext, :text
    add_column :document_file_revisions, :pages_layout_json, :text
    remove_column :reports, :page_texts_ciphertext, :text
    remove_column :reports, :pages_layout_json, :text

    # 2. document_files can live in the reference library (envelope_id NULL).
    change_column_null :document_files, :envelope_id, true
    add_column :document_files, :reference, :boolean, default: false, null: false
    add_index :document_files, [:account_id, :reference]

    # 3. Pinned reference files.
    create_table :ref_files do |t|
      t.bigint :account_id, null: false
      t.bigint :envelope_revision_id, null: false
      t.string :rule_id                              # NULL = checklist-scoped
      t.bigint :document_file_revision_id, null: false
      t.bigint :checklist_id                         # nullable, plaintext FK for suggestions query
      t.integer :position, default: 0, null: false
      t.boolean :save_to_library, default: false, null: false
      t.string :prefix_id
      t.timestamps
    end

    add_index :ref_files, :account_id
    add_index :ref_files, :envelope_revision_id
    add_index :ref_files, :document_file_revision_id
    add_index :ref_files, [:envelope_revision_id, :rule_id, :position],
              unique: true, where: "rule_id IS NOT NULL", name: :idx_ref_files_rule_unique
    add_index :ref_files, [:envelope_revision_id, :position],
              unique: true, where: "rule_id IS NULL", name: :idx_ref_files_checklist_unique
    add_index :ref_files, [:account_id, :checklist_id, :rule_id],
              name: :idx_ref_files_account_checklist_rule
    add_index :ref_files, :prefix_id, unique: true

    # 4. Enqueue timestamp on reports.
    add_column :reports, :inspection_enqueued_at, :datetime

    # 5. Nested tag labels.
    add_reference :tags, :parent_tag, foreign_key: { to_table: :tags }, null: true
    add_index :tags, [:account_id, :parent_tag_id]
  end
end
