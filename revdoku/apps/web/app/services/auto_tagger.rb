# frozen_string_literal: true

# Auto-tags an envelope based on the checklist used for its report.
# Finds or creates a tag linked to the source checklist, nested under a
# system-managed "Checklists" root label, then assigns it to the envelope.
#
# The parent is set ONLY when a checklist tag is first created — subsequent
# re-inspections respect any manual re-parenting the user has done.
class AutoTagger
  CHECKLIST_ROOT_AUTO_SOURCE = "checklist_root"
  CHECKLIST_ROOT_DEFAULT_NAME = "Checklists"
  CHECKLIST_ROOT_COLOR = "gray"

  # Color cycle for auto-created checklist tags (skips gray — reserved for root/default)
  COLOR_CYCLE = %w[red orange yellow green blue purple].freeze

  class << self
    def tag_from_report(envelope, report)
      checklist_id = report&.inspection_checklist_id
      return unless checklist_id

      # Look up the template checklist to get its name for the tag
      account = envelope.account
      checklist = account.checklists.find_by_prefix_id(checklist_id)
      return unless checklist

      tag_from_checklist(envelope, checklist)
    rescue => e
      Rails.logger.error("AutoTagger failed for envelope #{envelope&.id}: #{e.class} - #{e.message}")
    end

    def tag_from_checklist(envelope, checklist)
      return unless envelope && checklist

      account = envelope.account
      auto_key = "checklist:#{checklist.prefix_id}"

      tag = account.tags.find_by(auto_source: auto_key)

      unless tag
        checklists_root = find_or_create_checklists_root(account)
        next_color = pick_next_color(account)
        next_position = (account.tags.maximum(:position) || -1) + 1
        tag = account.tags.create!(
          name: checklist.name,
          color: next_color,
          position: next_position,
          auto_source: auto_key,
          parent_tag: checklists_root
        )
      end

      # Idempotent: skip if already tagged
      EnvelopeTag.find_or_create_by!(envelope: envelope, tag: tag)
    rescue => e
      Rails.logger.error("AutoTagger failed for envelope #{envelope&.id}: #{e.class} - #{e.message}")
    end

    # Attach a nested tag path like "Source/Email" to an envelope, walking the
    # account's tag tree and auto-creating every missing level. Each level is
    # keyed by `auto_source: "path:<full-path>"` so subsequent calls reuse the
    # existing tag rows (and respect any user-driven rename/re-parent).
    def tag_by_path!(envelope, path)
      return if envelope.nil? || path.to_s.strip.empty?

      account = envelope.account
      parts = path.to_s.split("/").map(&:strip).reject(&:empty?)
      return if parts.empty?

      parent = nil
      tag = nil
      parts.each_with_index do |name, i|
        full_path = parts[0..i].join("/")
        auto_key = "path:#{full_path}"
        tag = account.tags.find_by(auto_source: auto_key)

        unless tag
          next_color = parent.nil? ? "gray" : pick_next_color(account)
          next_position = (account.tags.maximum(:position) || -1) + 1
          tag = account.tags.create!(
            name: name,
            color: next_color,
            position: next_position,
            auto_source: auto_key,
            parent_tag: parent
          )
        end

        parent = tag
      end

      EnvelopeTag.find_or_create_by!(envelope: envelope, tag: tag) if tag
    rescue => e
      Rails.logger.error("AutoTagger.tag_by_path! failed for envelope=#{envelope&.id} path=#{path.inspect}: #{e.class} - #{e.message}")
    end

    private

    def find_or_create_checklists_root(account)
      existing = account.tags.find_by(auto_source: CHECKLIST_ROOT_AUTO_SOURCE)
      return existing if existing

      account.tags.create!(
        name: CHECKLIST_ROOT_DEFAULT_NAME,
        color: CHECKLIST_ROOT_COLOR,
        position: (account.tags.maximum(:position) || -1) + 1,
        auto_source: CHECKLIST_ROOT_AUTO_SOURCE
      )
    end

    def pick_next_color(account)
      auto_count = account.tags
        .where.not(auto_source: nil)
        .where.not(auto_source: CHECKLIST_ROOT_AUTO_SOURCE)
        .count
      COLOR_CYCLE[auto_count % COLOR_CYCLE.size]
    end
  end
end
