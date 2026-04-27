# frozen_string_literal: true

# Global checklist template — not per-account, not encrypted.
# When a user creates a checklist FROM a template, the copy becomes
# a regular Checklist record which IS encrypted with the account's key.
class ChecklistTemplate < ApplicationRecord
  has_prefix_id :ctpl

  validates :name, presence: true

  scope :visible, -> { where(visible: true) }
  scope :sorted, -> { order(sort_order: :asc, name: :asc) }

  TEMPLATE_DIR = Rails.root.join("config", "checklists", "templates").freeze

  # Self-heal an empty catalog from the on-disk markdown files. db:seed
  # runs the same sync, but only on a freshly-created DB; resets, schema
  # reloads, or boots that skipped seeds for any reason all leave the
  # picker dropdown empty AND silently disable the "default checklists
  # for new accounts" flow. Calling this from the two real entry points
  # (the picker controller + DefaultChecklistLoader) makes both paths
  # self-healing without touching boot scripts. Idempotent — a no-op
  # once any row exists.
  #
  # No rescue: if the seed fails (corrupted YAML, missing parser, stale
  # bootsnap bytecode), the caller's response should surface the real
  # error. Swallowing it produced exactly the symptom we're trying to
  # fix — a silently-empty picker dropdown with no operator-visible cause.
  def self.ensure_catalog_seeded!
    # NOT `exists?` — prefixed_ids 1.8.1+ overrides exists? to require a
    # prefix-id argument ("does this prefix_id exist?") and raises
    # ArgumentError on the bare zero-arg call we want here. `any?` and
    # `none?` go through the relation's standard ActiveRecord path
    # untouched by the gem and answer "are there any rows?" cleanly.
    return if any?
    return unless Dir.exist?(TEMPLATE_DIR)
    entries = ChecklistTextParser.parse_directory(TEMPLATE_DIR)
    return if entries.empty?
    Rails.logger.info("[ChecklistTemplate] empty catalog — syncing #{entries.size} templates from #{TEMPLATE_DIR}")
    sync!(entries)
  end

  # Upsert templates from an array of already-parsed entries (see
  # ChecklistTextParser.parse_multi). Matches on name; updates in place when
  # a record with that name exists, creates a new one otherwise. `sort_order`
  # is reassigned to the entry's position in the input array so catalog order
  # follows the source. Records whose names are not in `entries` are left
  # alone (admin-created templates survive).
  # Returns { created: [...], updated: [...] }
  def self.sync!(entries)
    created = []
    updated = []

    entries.each_with_index do |entry, idx|
      template = find_or_initialize_by(name: entry[:name])
      was_new = template.new_record?
      template.assign_attributes(
        system_prompt: entry[:system_prompt],
        rules: entry[:rules] || [],
        user_scripts: entry[:user_scripts] || [],
        sort_order: idx,
        visible: true,
        default_for_new_account: entry[:default_for_new_account] == true
      )
      template.save!
      (was_new ? created : updated) << template
    end

    { created: created, updated: updated }
  end

  # Import templates from a multi-checklist text block. Used by the admin
  # "Import from text" form. For the on-disk catalog, prefer
  # `import_from_directory` / `sync!`.
  # Skips duplicates by name (case-insensitive). Use `sync!` instead when you
  # want to overwrite existing records (deploys / rake tasks).
  # Returns { imported: [...], skipped: [...] }
  def self.import_from_text(text)
    create_from_entries(ChecklistTextParser.parse_multi(text))
  end

  # Import templates from a directory of one-template-per-file `.md`
  # entries (the on-disk catalog at config/checklists/templates/). Same
  # name-skipping semantics as `import_from_text`.
  # Returns { imported: [...], skipped: [...] }
  def self.import_from_directory(dir_path)
    create_from_entries(ChecklistTextParser.parse_directory(dir_path))
  end

  def self.create_from_entries(parsed)
    existing_names = pluck(:name).map(&:downcase)

    imported = []
    skipped = []

    parsed.each do |entry|
      if existing_names.include?(entry[:name].downcase)
        skipped << entry[:name]
        next
      end

      template = create!(
        name: entry[:name],
        system_prompt: entry[:system_prompt],
        rules: entry[:rules],
        user_scripts: entry[:user_scripts] || [],
        sort_order: imported.size,
        default_for_new_account: entry[:default_for_new_account] == true
      )
      imported << template
      existing_names << entry[:name].downcase
    end

    { imported: imported, skipped: skipped }
  end
  private_class_method :create_from_entries

  def self.ransackable_attributes(_auth_object = nil)
    %w[name visible sort_order created_at default_for_new_account]
  end

  def self.ransackable_associations(_auth_object = nil)
    []
  end
end
