# frozen_string_literal: true

# Imports a fixture JSON hash into an account, creating an envelope with
# files, a checklist snapshot, a report, and checks.
#
# The fixture must contain a report with checks and either an embedded
# checklist_snapshot or a checklist_name referencing an existing template.
#
#   result = EnvelopeFixtureImporter.call(account, fixture_hash)
#   # => { success: true, envelope: <Envelope> }
#   # => { success: false, message: "..." }
#
class EnvelopeFixtureImporter
  class << self
    def call(account, fixture)
      validate!(fixture)

      # Phase 1 — envelope + revision (no attachments).
      # Kept in a transaction so a failure here rolls the skeleton back.
      envelope = nil
      revision = nil
      ActiveRecord::Base.transaction do
        title     = fixture["title"] || "Imported Fixture"
        envelope  = create_envelope(account, title)
        rev_data  = fixture.fetch("revisions", []).first || {}
        revision  = create_revision(envelope, rev_data)
      end

      # Phase 2 — attach files OUTSIDE any DB transaction.
      #
      # Rails 7.1+ defers ActiveStorage uploads until the enclosing
      # transaction's after_commit. When that transaction then does another
      # `rev.save!` on a RELOADED copy of the same DocumentFileRevision (as
      # write_per_file_page_data does), the deferred upload attached to the
      # original instance is lost — the blob row commits but the disk file
      # never gets written. Doing the attach in its own un-transactioned
      # scope lets the upload run synchronously and avoids that interaction.
      rev_data = fixture.fetch("revisions", []).first || {}
      attach_files(account, envelope, revision, rev_data.fetch("files", []))

      # Phase 3 — report + checks + page data.
      # Separate transaction, attachments already persisted.
      ActiveRecord::Base.transaction do
        write_per_file_page_data(revision, fixture["report"])
        snapshot = build_snapshot(account, fixture)
        report   = create_report(account, revision, snapshot, fixture["report"])
        create_checks(account, report, snapshot, fixture.dig("report", "checks") || [])
      end

      { success: true, envelope: envelope }
    rescue => e
      Rails.logger.error "EnvelopeFixtureImporter error: #{e.message}\n#{e.backtrace.first(5).join("\n")}"
      { success: false, message: e.message }
    end

    private

    # ------- validation -------

    def validate!(fixture)
      raise "Fixture must be a Hash" unless fixture.is_a?(Hash)

      report = fixture["report"]
      raise "Fixture must contain a report with checks" unless report.is_a?(Hash) && report["checks"].is_a?(Array) && report["checks"].any?
      raise "Fixture report must contain pages_layout" unless report["pages_layout"].is_a?(Hash) && report["pages_layout"].any?
      raise "Fixture report must contain page_texts" unless report["page_texts"].is_a?(Array) && report["page_texts"].any?

      has_checklist = fixture["checklist_snapshot"].is_a?(Hash) || fixture["checklist_name"].present?
      raise "Fixture must contain checklist_snapshot or checklist_name" unless has_checklist
    end

    # ------- envelope + revision -------

    def create_envelope(account, title)
      Envelope.create!(
        account: account,
        title: title,
        status: :working
      )
    end

    def create_revision(envelope, rev_data)
      EnvelopeRevision.create!(
        envelope: envelope,
        revision_number: rev_data["revision_number"] || 0,
        comment: rev_data["comment"]
      )
    end

    def attach_files(account, envelope, revision, files_data)
      files_data.each do |file_info|
        doc_file = DocumentFile.create!(
          envelope: envelope,
          account: account
        )

        file_rev = DocumentFileRevision.create!(
          document_file: doc_file,
          account: account,
          revision_number: 0,
          name: file_info["filename"],
          mime_type: file_info["mime_type"]
        )
        file_rev.attach_from_base64(file_info["data_base64"])
        revision.add_document_file_revision(file_rev)

        if file_info["page_thumbnails"].is_a?(Array) && file_info["page_thumbnails"].any?
          PageThumbnails.store(file_rev, file_info["page_thumbnails"])
        end
      end
    end

    # ------- checklist resolution -------

    def build_snapshot(account, fixture)
      if fixture["checklist_snapshot"].is_a?(Hash)
        build_checklist_data_from_fixture(fixture["checklist_snapshot"])
      else
        build_checklist_data_from_template(account, fixture["checklist_name"])
      end
    end

    # Returns a hash (not a record) with checklist data for inspection_context
    def build_checklist_data_from_fixture(snapshot_data)
      rules = (snapshot_data["rules"] || []).map.with_index do |r, idx|
        {
          "id" => "fixture_rule_#{idx}",
          "prompt" => r["prompt"],
          "title" => r["title"],
          "order" => r["order"] || idx,
          "origin" => r["origin"] || "checklist"
        }.compact
      end

      {
        "id" => "fixture_#{SecureRandom.hex(8)}",
        "name" => snapshot_data["name"] || "Imported Checklist",
        "system_prompt" => snapshot_data["system_prompt"],
        "ai_model" => snapshot_data["ai_model"],
        "highlight_mode" => snapshot_data["highlight_mode"] || 0,
        "track_changes" => snapshot_data["track_changes"] || false,
        "rules" => rules
      }
    end

    def build_checklist_data_from_template(account, name)
      checklist = account.checklists.templates.find { |c| c.name&.downcase == name.to_s.downcase }
      raise "Checklist template '#{name}' not found" unless checklist

      {
        "id" => checklist.prefix_id,
        "name" => checklist.name,
        "system_prompt" => checklist.system_prompt,
        "ai_model" => checklist.ai_model,
        "highlight_mode" => Checklist.highlight_modes[checklist.highlight_mode],
        "rules" => checklist.rules.map.with_index do |r, idx|
          {
            "id" => r[:id] || r["id"],
            "prompt" => r[:prompt] || r["prompt"],
            "title" => r[:title] || r["title"],
            "order" => r[:order] || r["order"] || idx,
            "origin" => r[:origin] || r["origin"] || "checklist"
          }.compact
        end
      }
    end

    # ------- report + checks -------

    def create_report(account, revision, checklist_data, report_data = {})
      report_data ||= {}
      ai_model = report_data["ai_model"] || checklist_data["ai_model"]

      inspection_context = {
        "checklist" => checklist_data,
        "inspected_at" => Time.current.iso8601
      }

      Report.create!(
        account: account,
        envelope_revision: revision,
        job_status: :completed,
        ai_model: ai_model,
        inspection_context: inspection_context
      )
    end

    # Persist pages_layout + page_texts onto the revision's single DocumentFileRevision.
    # Fixtures are currently single-file; for multi-file support extend this to split
    # by file using file_page_counts like ReportCreationService.merge_batch_page_layout.
    def write_per_file_page_data(revision, report_data)
      file_revs = revision.document_file_revisions.to_a
      return if file_revs.empty?
      raise "Fixture import supports single-file revisions only (got #{file_revs.size})" if file_revs.size > 1

      rev = file_revs.first
      pages_layout = report_data["pages_layout"]
      raise "Fixture report is missing pages_layout" unless pages_layout.is_a?(Hash) && pages_layout.any?

      page_texts = report_data["page_texts"]
      raise "Fixture report is missing page_texts" unless page_texts.is_a?(Array) && page_texts.any?

      rev.pages_layout = pages_layout
      rev.page_texts = page_texts
      rev.save!
    end

    def create_checks(account, report, checklist_data, checks_data)
      rules = checklist_data["rules"] || []
      checks_data.each do |cd|
        rule_order = cd["rule_order"]
        rule = rules.find { |r| (r["order"] || r[:order]) == rule_order }
        next unless rule

        rule_key = rule["id"] || rule[:id]
        Check.create!(
          account: account,
          report: report,
          rule_key: rule_key,
          passed: cd["passed"],
          description: cd["description"],
          description_position_json: cd["description_position"]&.to_json,
          source: :ai,
          page: cd["page"],
          x1: cd["x1"],
          y1: cd["y1"],
          x2: cd["x2"],
          y2: cd["y2"],
          check_index: rule_order
        )
      end
    end
  end
end
