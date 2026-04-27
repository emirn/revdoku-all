# frozen_string_literal: true

# Parses a simple text format into checklist data:
#
#   Line 1            → name   (prefix with `*` to mark the template
#                                 as auto-seeded on every new account,
#                                 e.g. `*Invoice Review`)
#   (blank line)
#   Paragraph lines   → system_prompt
#   (blank line)
#   - rule one        → rules
#   - rule two
#
# List markers stripped: "- ", "* ", "[ ] ", "[ ] - ", "1. ", "2) ", etc.
# Multiple blank lines are treated as a single separator.
#
# Fallback: if no structure detected (no blank-line separator), all non-empty
# lines become rules, name = "Untitled".
#
# A trailing `<script>...</script>` block (if present) is extracted as
# user_scripts and mirrors the TypeScript parser's behaviour in
# `apps/web/app/frontend/src/lib/checklist-parse-utils.ts`.
#
# Scope: this parser is used to load the global template catalog. The
# catalog lives as one Markdown file per template under
# `config/checklists/templates/`. `parse` handles a single template file;
# `parse_directory` globs the directory and returns one entry per file in
# filename-sorted order. The legacy `parse_multi` (split a single text
# block on `---`) is kept for the admin "import from text" form.
# See `config/checklists/README.md` for the full file format reference.
class ChecklistTextParser
  LIST_MARKER = /\A(?:\[[ x]?\]\s*[-–]?\s*|\d+[.)]\s*|[-*]\s+)/i

  class << self
    # Parse a single checklist text block.
    # @return [Hash] { name:, system_prompt:, rules: [{ prompt:, order: }], user_scripts: [] | [{ id:, name:, code: }] }
    def parse(text)
      raw = text.to_s
      script_content = raw[/<script>\s*([\s\S]*?)\s*<\/script>/i, 1]
      user_scripts = script_content && !script_content.strip.empty? ?
        [{ id: "script_0", name: "Script 1", code: script_content.strip }] :
        []
      text_without_scripts = raw.gsub(/<script>[\s\S]*?<\/script>/i, "").strip
      lines = text_without_scripts.lines.map(&:rstrip)

      # Collapse into groups separated by blank lines
      groups = split_into_groups(lines)

      return fallback(lines).merge(user_scripts: user_scripts) if groups.size < 2

      name = groups[0].join(" ").strip
      # Leading `*` marks a template as auto-seeded on every new account
      # (consumed by ChecklistTemplate.sync! → default_for_new_account).
      # Stripped from the stored name so it never leaks into UI copy.
      default_for_new_account = name.start_with?("*")
      name = name.sub(/\A\*\s*/, "")
      name = "Untitled" if name.blank?

      # Everything between the name group and the first bullet-list group
      # is the system_prompt (supports multiple paragraphs). Joined with
      # blank-line separators to preserve paragraph structure.
      rest = groups[1..]
      rules_idx = rest.index { |g| all_list_items?(g) }

      if rules_idx.nil?
        # No bullet list found: all remaining groups are system_prompt
        system_prompt = rest.map { |g| g.join("\n") }.join("\n\n").strip
        system_prompt = nil if system_prompt.empty?
        return { name: name, system_prompt: system_prompt, rules: [], user_scripts: user_scripts, default_for_new_account: default_for_new_account }
      end

      prompt_groups = rest[0...rules_idx]
      rule_groups = rest[rules_idx..]

      system_prompt = prompt_groups.map { |g| g.join("\n") }.join("\n\n").strip
      system_prompt = nil if system_prompt.empty?

      rules = parse_rules(rule_groups.flatten)

      { name: name, system_prompt: system_prompt, rules: rules, user_scripts: user_scripts, default_for_new_account: default_for_new_account }
    end

    # Parse multiple checklists separated by "---".
    # @return [Array<Hash>]
    def parse_multi(text)
      blocks = text.to_s.split(/^---+\s*$/)
      blocks.map { |block| parse(block.strip) }.reject { |h| h[:name] == "Untitled" && h[:rules].empty? }
    end

    # Parse every `*.md` file under the given directory, in filename-sorted
    # order. Each file is one template — the same shape `parse` handles for
    # a single block. Files whose first line is empty / unparseable are
    # silently skipped (matches `parse_multi`'s "Untitled with no rules"
    # guard). Used by `ChecklistTemplate.sync!` and the rake tasks.
    # @return [Array<Hash>]
    def parse_directory(dir_path)
      pattern = File.join(dir_path.to_s, "*.md")
      Dir.glob(pattern).sort.filter_map do |path|
        entry = parse(File.read(path))
        next nil if entry[:name] == "Untitled" && entry[:rules].empty?
        entry
      end
    end

    private

    def split_into_groups(lines)
      groups = []
      current = []

      lines.each do |line|
        if line.strip.empty?
          if current.any?
            groups << current
            current = []
          end
        else
          current << line
        end
      end

      groups << current if current.any?
      groups
    end

    def all_list_items?(lines)
      non_empty = lines.select { |l| l.strip.present? }
      return false if non_empty.empty?
      non_empty.all? { |l| l.strip.match?(LIST_MARKER) }
    end

    def parse_rules(lines)
      rules = []
      lines.each do |line|
        stripped = line.strip
        next if stripped.empty?

        prompt = stripped.sub(LIST_MARKER, "").strip
        next if prompt.empty?

        rules << { prompt: prompt, order: rules.size }
      end
      rules
    end

    def fallback(lines)
      non_empty = lines.select { |l| l.strip.present? }
      rules = non_empty.map.with_index do |line, idx|
        prompt = line.strip.sub(LIST_MARKER, "").strip
        { prompt: prompt, order: idx }
      end.reject { |r| r[:prompt].empty? }

      { name: "Untitled", system_prompt: nil, rules: rules, default_for_new_account: false }
    end
  end
end
