# frozen_string_literal: true

namespace :checklist_templates do
  desc "Upsert ChecklistTemplate rows from config/checklists/templates/*.md (overwrites existing by name)"
  task sync: :environment do
    dir = Rails.root.join("config", "checklists", "templates")
    raise "Not found: #{dir}" unless Dir.exist?(dir)

    entries = ChecklistTextParser.parse_directory(dir)
    raise "No templates parsed from #{dir}" if entries.empty?

    result = ChecklistTemplate.sync!(entries)

    created = result[:created].map(&:name)
    updated = result[:updated].map(&:name)
    puts "Created (#{created.size}): #{created.empty? ? '(none)' : created.join(', ')}"
    puts "Updated (#{updated.size}): #{updated.empty? ? '(none)' : updated.join(', ')}"
  end
end
