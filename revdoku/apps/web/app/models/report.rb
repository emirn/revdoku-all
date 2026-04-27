# frozen_string_literal: true

class Report < AccountRecord
  include AccountEncryptable
  include UserTrackable

  has_prefix_id :rpt

  has_encrypted :error_message, key: :lockbox_encryption_key
  has_encrypted :inspection_context, key: :lockbox_encryption_key, type: :json
  has_encrypted :user_scripts_output, key: :lockbox_encryption_key, type: :json

  belongs_to :account
  belongs_to :envelope_revision, touch: true

  has_many :checks, dependent: :destroy
  # Reference files are pinned on the envelope_revision (not the report) so
  # re-runs reuse the same uploads. This delegation lets existing callers
  # ask for the report's reference files without thinking about the layer.
  has_many :ref_files, through: :envelope_revision

  validates :envelope_revision, presence: true

  # Automatically set account_id from envelope_revision chain
  before_validation :set_account_from_envelope, on: :create

  # Extensible JSON metadata stored as text.
  # Current fields: core_model_id, resolved_at
  # Future fields can be added without migration.
  def meta
    raw = read_attribute(:meta)
    raw.present? ? JSON.parse(raw) : {}
  rescue JSON::ParserError
    {}
  end

  def meta=(value)
    write_attribute(:meta, value.is_a?(String) ? value : value.to_json)
  end

  # Job status enum
  enum :job_status, {
    pending: 0,
    processing: 1,
    completed: 2,
    failed: 3,
    cancelled: 4,
    reset: 5
  }, default: :completed, prefix: true

  # Per-page review status values (synced from EPageReviewStatus in
  # apps/shared/js-packages/revdoku-lib/src/common-types.ts).
  # Convention: >= 0 = page was handled (OK), < 0 = page needs attention.
  module PageReviewStatus
    REVIEWED          =  0  # Processed by AI successfully
    SKIPPED_AS_BLANK  =  1  # Processed, detected blank — not an error
    FAILED            = -1  # Processing attempted but errored
    NOT_PROCESSED     = -2  # Never reached (job crashed, timeout)
    CANCELLED_BY_USER = -3  # User cancelled before this page was processed

    # Old enum values (pre-2026-04-06) — kept for backward compatibility reads
    LEGACY_SKIPPED_AS_BLANK = 98
    LEGACY_CANCELLED        = 99

    # Page was handled successfully (>= 0 in new enum, excludes legacy 98/99)
    def self.processed?(status)
      v = status.to_i
      v >= 0 && v != LEGACY_SKIPPED_AS_BLANK && v != LEGACY_CANCELLED
    end

    # Page needs attention: negative (new enum) or 98/99 (old enum)
    def self.unreviewed?(status)
      return true if status.nil?
      v = status.to_i
      v < 0 || v == LEGACY_SKIPPED_AS_BLANK || v == LEGACY_CANCELLED
    end
  end

  # ── inspection_context accessors ──────────────────────────────────────
  # inspection_context is an encrypted JSON blob frozen at inspection time.
  # Structure:
  #   { checklist: { id, name, system_prompt, ai_model, track_changes, highlight_mode, rules: [...] },
  #     previous_checks: [...],
  #     ai_model_resolved: "...",
  #     page_count: N,
  #     inspected_at: "ISO8601" }

  # Get the source template checklist prefix_id from inspection_context
  def inspection_checklist_id
    inspection_context&.dig("checklist", "id")
  end

  # Get the checklist name from inspection_context
  def inspection_checklist_name
    inspection_context&.dig("checklist", "name")
  end

  # Get the system_prompt from inspection_context
  def inspection_system_prompt
    inspection_context&.dig("checklist", "system_prompt")
  end

  # Get all rules from inspection_context
  def rules
    ctx = inspection_context
    return [] unless ctx
    rules = ctx.dig("checklist", "rules")
    rules.is_a?(Array) ? rules : []
  end

  # Get rules by origin type
  def checklist_rules
    rules.select { |r| (r[:origin] || r["origin"]) == "checklist" }
  end

  def user_rules
    rules.select { |r| r[:origin] == "user" || r["origin"] == "user" }
  end

  # Whether track_changes was active for this inspection
  def inspection_track_changes?
    inspection_context&.dig("checklist", "track_changes") == true
  end

  # The highlight_mode used for this inspection
  def inspection_highlight_mode
    inspection_context&.dig("checklist", "highlight_mode")
  end

  # The AI model recorded in inspection_context
  def inspection_ai_model
    inspection_context&.dig("checklist", "ai_model")
  end

  # ── Per-page data (delegated to DocumentFileRevision) ────────────────
  # extracted text, coordinate spaces, bounding boxes, page types/statuses
  # all live on DocumentFileRevision now. Report exposes aggregated views
  # backed by ReportLayoutAggregator so existing callers keep working.

  def layout_aggregator
    @layout_aggregator ||= ReportLayoutAggregator.new(envelope_revision)
  end

  # Invalidate the memoized aggregator. Callers that write to a
  # DocumentFileRevision's page_texts or pages_layout_json must call this on
  # the owning report so subsequent reads see the fresh data.
  def reset_layout_cache!
    @layout_aggregator = nil
  end

  def page_texts
    layout_aggregator.aggregate_page_texts
  end

  def has_page_texts?
    layout_aggregator.any_page_texts?
  end

  def content_bounding_boxes
    layout_aggregator.content_bounding_boxes
  end

  def page_coordinate_spaces
    layout_aggregator.page_coordinate_spaces
  end

  def page_types
    layout_aggregator.page_types
  end

  def page_statuses
    layout_aggregator.page_statuses
  end

  def page_font_scales
    layout_aggregator.page_font_scales
  end

  # Document-relative pages_layout_json hash (with envelope-level display
  # settings merged at the top) for frontend/export consumers that still
  # expect the old flat shape.
  def pages_layout_json_aggregated
    layout_aggregator.legacy_pages_layout_json
  end

  # Writing page_font_scales splits doc-relative keys across file revisions.
  def page_font_scales=(value)
    return unless value.is_a?(Hash)
    normalized = value.transform_values { |v| v.to_f.clamp(0.5, 3.0) }
    by_file = Hash.new { |h, k| h[k] = {} }
    normalized.each do |doc_key, scale|
      lookup = layout_aggregator.file_revision_for_doc_page(doc_key.to_i)
      next unless lookup
      rev, file_rel = lookup
      by_file[rev][file_rel.to_s] = scale
    end
    by_file.each do |rev, file_scales|
      rev.page_font_scales = file_scales
      rev.save!
    end
    reset_layout_cache!
  end

  # ── Envelope-wide display settings (persisted on Envelope#view_settings) ──
  # The report-level setters save the envelope immediately so existing API
  # update flows (`@report.save!` in PATCH /reports/:id) propagate changes.
  def envelope
    envelope_revision&.envelope
  end

  def label_font_scale
    envelope&.label_font_scale || 1.0
  end

  def label_font_scale=(value)
    return unless envelope
    envelope.label_font_scale = value
    envelope.save!
  end

  def highlight_mode
    envelope&.highlight_mode || Checklist.highlight_modes[:rectangle]
  end

  def highlight_mode=(value)
    return unless envelope
    envelope.highlight_mode = value
    envelope.save!
  end

  def font_family
    envelope&.font_family
  end

  def font_family=(value)
    return unless envelope
    envelope.font_family = value
    envelope.save!
  end

  def self.ransackable_attributes(auth_object = nil)
    %w[job_status ai_model created_at]
  end

  private

  def set_account_from_envelope
    self.account ||= envelope_revision&.envelope&.account
  end

end
