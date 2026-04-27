# frozen_string_literal: true

# Aggregates per-DocumentFileRevision page data (page_texts + pages_layout_json)
# into the document-relative shape used by the frontend and export payloads.
#
# DFRs store:
#   - page_texts: array of { page: <file-relative 1-based>, text: <string> }
#   - pages_layout_json: JSON hash keyed by file-relative 0-based page index
#     under: content_bounding_boxes, page_coordinate_spaces, page_types,
#     page_statuses, page_font_scales
#
# Aggregation shifts every file-relative page key by the cumulative page
# count of prior files so the output matches the flat document-relative
# shape the doc-api used to emit and the frontend still expects.
class ReportLayoutAggregator
  LAYOUT_KEYS = %w[content_bounding_boxes page_coordinate_spaces page_types page_statuses page_font_scales].freeze

  def initialize(envelope_revision)
    @envelope_revision = envelope_revision
    @file_revisions = envelope_revision.ordered_document_file_revisions.to_a
    @offsets = compute_offsets(@file_revisions)
  end

  # Concatenated page_texts across all files, with `page` field re-numbered to
  # document-relative 1-based. Returns [] if no file has page_texts. Memoized
  # per-instance — Report memoizes the aggregator itself and invalidates via
  # Report#reset_layout_cache! after any per-DFR write, so cache freshness
  # is managed at the Report boundary.
  def aggregate_page_texts
    @aggregate_page_texts ||= begin
      result = []
      @file_revisions.each_with_index do |rev, idx|
        texts = rev.page_texts
        next unless texts.is_a?(Array) && texts.any?
        offset = @offsets[idx]
        texts.each do |entry|
          next unless entry.is_a?(Hash)
          file_rel_page = (entry["page"] || entry[:page]).to_i
          text = entry["text"] || entry[:text]
          result << { "page" => file_rel_page + offset, "text" => text }
        end
      end
      result
    end
  end

  def any_page_texts?
    @file_revisions.any? { |rev| rev.page_texts.is_a?(Array) && rev.page_texts.any? }
  end

  # Aggregated content_bounding_boxes / page_coordinate_spaces / page_types /
  # page_statuses / page_font_scales. Keys are document-relative 0-based as
  # strings. Memoized per-instance (see aggregate_page_texts for invalidation).
  def aggregate_layout
    @aggregate_layout ||= begin
      merged = {}
      LAYOUT_KEYS.each { |k| merged[k] = {} }

      @file_revisions.each_with_index do |rev, idx|
        offset = @offsets[idx]
        layout = rev.pages_layout
        LAYOUT_KEYS.each do |key|
          sub = layout[key]
          next unless sub.is_a?(Hash)
          sub.each do |file_rel_key, value|
            doc_rel_key = (file_rel_key.to_i + offset).to_s
            merged[key][doc_rel_key] = value
          end
        end
      end

      merged
    end
  end

  # The full pages_layout_json hash that the frontend used to see on `report.*`,
  # with envelope-level display settings merged at the top level for back-compat
  # with DebugPanel and any consumer that reads raw pages_layout_json.
  def legacy_pages_layout_json
    hash = aggregate_layout
    envelope = @envelope_revision.envelope
    hash["label_font_scale"] = envelope.label_font_scale
    hash["highlight_mode"] = envelope.highlight_mode
    hash["font_family"] = envelope.font_family if envelope.font_family.present?
    hash
  end

  def content_bounding_boxes
    aggregate_layout["content_bounding_boxes"]
  end

  def page_coordinate_spaces
    aggregate_layout["page_coordinate_spaces"]
  end

  def page_types
    aggregate_layout["page_types"]
  end

  def page_statuses
    aggregate_layout["page_statuses"]
  end

  def page_font_scales
    aggregate_layout["page_font_scales"]
  end

  # Lookup a file revision + its file-relative offset for a given document-relative
  # 0-based page index. Returns [rev, file_rel_index] or nil if out of range.
  def file_revision_for_doc_page(doc_page_index)
    @file_revisions.each_with_index do |rev, idx|
      start = @offsets[idx]
      count = file_page_count(rev, idx)
      next if count <= 0
      if doc_page_index >= start && doc_page_index < start + count
        return [rev, doc_page_index - start]
      end
    end
    nil
  end

  private

  # Cumulative page-count offsets for each file revision in order.
  # offsets[i] = sum of page counts of files [0..i-1].
  def compute_offsets(file_revisions)
    offsets = []
    running = 0
    file_revisions.each_with_index do |rev, idx|
      offsets << running
      running += file_page_count(rev, idx)
    end
    offsets
  end

  # Best-effort per-file page count. Checks, in order:
  #   1. Max key in pages_layout_json.page_coordinate_spaces + 1 (authoritative after inspection)
  #   2. metadata_hash["page_count"] (cheap — just reads an already-loaded text column)
  #   3. Cached rendered-pages hash size (last resort — this downloads and
  #      decompresses a multi-MB ActiveStorage blob, so only hit it if the
  #      two cheaper sources are absent)
  #   4. Fallback: 0 (computes offsets as if the file had no pages — harmless)
  def file_page_count(rev, _idx)
    layout_count = max_key_plus_one(rev.page_coordinate_spaces)
    return layout_count if layout_count.positive?

    meta_count = rev.metadata_hash["page_count"].to_i
    return meta_count if meta_count.positive?

    cached = RenderedPagesCache.fetch_pages_by_index(rev)
    return cached.keys.map(&:to_i).max.to_i + 1 if cached.is_a?(Hash) && cached.any?

    0
  end

  def max_key_plus_one(hash)
    return 0 unless hash.is_a?(Hash) && hash.any?
    hash.keys.map(&:to_i).max.to_i + 1
  end
end
