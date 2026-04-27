# frozen_string_literal: true

namespace :checklists do
  # Seeds the invoice catalog from config/checklists/templates/*.md into the
  # global ChecklistTemplate table. Idempotent by name — existing templates
  # are skipped, never updated in place. Use `checklist_templates:sync` (in
  # checklist_templates.rake) when you want to overwrite existing rows.
  desc "Seed ChecklistTemplate rows from config/checklists/templates/*.md"
  task seed_invoice_catalog: :environment do
    dir = Rails.root.join("config", "checklists", "templates")
    unless Dir.exist?(dir)
      puts "Template directory not found: #{dir}"
      exit 1
    end

    puts "Seeding ChecklistTemplate from #{dir}..."
    result = ChecklistTemplate.import_from_directory(dir)

    puts "  Imported: #{result[:imported].size}"
    result[:imported].each { |t| puts "    + #{t.name}" }

    if result[:skipped].any?
      puts "  Skipped (already present by name): #{result[:skipped].size}"
      result[:skipped].each { |n| puts "    - #{n}" }
    end

    total = ChecklistTemplate.visible.count
    puts "Visible ChecklistTemplate rows now: #{total}"
  end

  desc "Validate default_checklists.json structure"
  task validate: :environment do
    puts "Validating default_checklists.json..."
    puts "-" * 50

    result = DefaultChecklistLoader.validate_templates

    if result[:valid]
      puts "Valid! Found #{result[:template_count]} templates."
      puts

      templates = DefaultChecklistLoader.load_templates
      templates.each_with_index do |template, idx|
        puts "  #{idx + 1}. #{template[:name]}"
        puts "     System prompt: #{template[:system_prompt]&.truncate(60) || '(none)'}"
        puts "     Rules: #{template[:rules]&.count || 0}"
        template[:rules]&.each_with_index do |rule, rule_idx|
          puts "       #{rule_idx + 1}. #{rule[:prompt].truncate(70)}"
        end
        puts
      end
    else
      puts "Validation FAILED!"
      puts
      result[:errors].each do |error|
        puts "  - #{error}"
      end
      exit 1
    end
  end

  desc "List all default checklist templates"
  task list: :environment do
    templates = DefaultChecklistLoader.load_templates

    if templates.empty?
      puts "No templates found in default_checklists.json"
      exit 0
    end

    puts "Default Checklist Templates"
    puts "=" * 50

    templates.each_with_index do |template, idx|
      puts
      puts "#{idx + 1}. #{template[:name]}"
      puts "   Sort Order: #{template[:sort_order] || 'unset'}"
      puts "   System Prompt: #{template[:system_prompt]&.truncate(80) || '(none)'}"
      puts "   Rules (#{template[:rules]&.count || 0}):"
      template[:rules]&.each_with_index do |rule, rule_idx|
        puts "     #{rule_idx + 1}. #{rule[:prompt]}"
      end
    end

    puts
    puts "=" * 50
    puts "Total: #{templates.count} templates"
  end

  desc "Show statistics about default checklist templates"
  task stats: :environment do
    templates = DefaultChecklistLoader.load_templates

    if templates.empty?
      puts "No templates found"
      exit 0
    end

    total_rules = templates.sum { |t| t[:rules]&.count || 0 }
    avg_rules = total_rules.to_f / templates.count

    puts "Default Checklist Statistics"
    puts "-" * 30
    puts "Total templates: #{templates.count}"
    puts "Total rules: #{total_rules}"
    puts "Average rules per template: #{avg_rules.round(1)}"
    puts
    puts "Rules per template:"
    templates.sort_by { |t| -(t[:rules]&.count || 0) }.each do |template|
      puts "  #{template[:name]}: #{template[:rules]&.count || 0} rules"
    end
  end
end
