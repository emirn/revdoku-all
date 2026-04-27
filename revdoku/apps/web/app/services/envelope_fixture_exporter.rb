# frozen_string_literal: true

# Exports an envelope (with its report and checks) into the JSON format
# consumed by EnvelopeFixtureImporter / SampleEnvelopeCreator.
#
#   result = EnvelopeFixtureExporter.call(envelope)
#   result = EnvelopeFixtureExporter.call(envelope, revision: specific_rev)
#   EnvelopeFixtureExporter.call(envelope, save_to: Rails.root.join("config/sample_data/sample_envelope_fixture.json"))
#
class EnvelopeFixtureExporter
  class << self
    def call(envelope, revision: nil, save_to: nil)
      revision ||= find_revision_with_report(envelope)
      return error("No revision with a completed report found") unless revision

      report = revision.report
      return error("No report for revision #{revision.revision_number}") unless report
      return error("Report is not completed (status: #{report.job_status})") unless report.job_status_completed?

      ctx = report.inspection_context
      return error("Report has no inspection context") unless ctx && ctx["checklist"]

      checklist_data = ctx["checklist"]
      checklist_name = checklist_data["name"]
      warnings = validate_data(revision)

      fixture = build_fixture(envelope, revision, report, checklist_name, checklist_data)
      json = JSON.pretty_generate(fixture)

      File.write(save_to, json) if save_to && warnings.empty?

      { success: true, fixture: fixture, json: json, warnings: warnings }
    rescue => e
      Rails.logger.error "EnvelopeFixtureExporter error: #{e.message}\n#{e.backtrace.join("\n")}"
      { success: false, message: e.message }
    end

    private

    def error(message)
      { success: false, message: message }
    end

    def find_revision_with_report(envelope)
      envelope.envelope_revisions
        .includes(:report, :document_file_revisions)
        .order(revision_number: :desc)
        .detect { |rev| rev.report&.job_status_completed? }
    end

    def build_fixture(envelope, revision, report, checklist_name, checklist_data)
      rules = (checklist_data["rules"] || []).map do |rule|
        {
          "order" => rule["order"] || rule[:order],
          "prompt" => rule["prompt"] || rule[:prompt],
          "origin" => rule["origin"] || rule[:origin]
        }.compact
      end

      checklist_snapshot = {
        "name" => checklist_data["name"],
        "system_prompt" => checklist_data["system_prompt"],
        "ai_model" => checklist_data["ai_model"],
        "rules" => rules
      }

      fixture = {
        "title" => envelope.title,
        "checklist_name" => checklist_name,
        "checklist_snapshot" => checklist_snapshot,
        "revisions" => [build_revision(revision)],
        "report" => build_report(report)
      }
      fixture.delete("checklist_name") unless checklist_name
      fixture
    end

    def validate_data(revision)
      revision.document_file_revisions.each do |file_rev|
        raise "File '#{file_rev.name}' is missing page thumbnails. Re-run the inspection to generate them." unless PageThumbnails.cached?(file_rev)
      end
      []
    end

    def build_revision(revision)
      files = revision.document_file_revisions.map do |file_rev|
        file_hash = {
          "filename" => file_rev.name,
          "mime_type" => file_rev.mime_type,
          "data_base64" => file_rev.to_base64
        }
        if PageThumbnails.cached?(file_rev)
          thumbs = PageThumbnails.fetch(file_rev)
          file_hash["page_thumbnails"] = thumbs if thumbs
        end
        file_hash
      end

      data = {
        "revision_number" => revision.revision_number,
        "files" => files
      }
      data["comment"] = revision.comment if revision.comment.present?
      data
    end

    def build_report(report)
      checks = report.checks.order(:check_index).map do |check|
        check_hash = {
          "check_index" => check.check_index,
          "passed" => check.passed,
          "description" => check.description,
          "page" => check.page,
          "x1" => check.x1,
          "y1" => check.y1,
          "x2" => check.x2,
          "y2" => check.y2
        }
        if check.description_position_json.present?
          check_hash["description_position"] = JSON.parse(check.description_position_json)
        end
        check_hash
      end

      pages_layout = report.pages_layout_json_aggregated
      raise "Report is missing page_coordinate_spaces" if pages_layout["page_coordinate_spaces"].blank?
      raise "Report is missing content_bounding_boxes" if pages_layout["content_bounding_boxes"].blank?

      page_texts = report.page_texts
      raise "Report is missing page_texts" if page_texts.blank?

      {
        "ai_model" => report.ai_model,
        "pages_layout" => pages_layout,
        "page_texts" => page_texts,
        "checks" => checks
      }
    end
  end
end
