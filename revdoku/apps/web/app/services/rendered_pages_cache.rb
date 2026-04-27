# frozen_string_literal: true

# Service for caching rendered PDF page images on DocumentFileRevision records.
#
# After doc-api renders a PDF into JPEG page images, this service stores them
# as a gzip-compressed JSON file via ActiveStorage (encrypted, HIPAA-complete).
# On subsequent requests, Rails includes the cached pages in the doc-api payload
# so doc-api can skip the expensive PDF rendering step for pages already cached.
#
# Cache key: DocumentFileRevision (immutable content = immutable rendered output).
# Cache versioning: bump CACHE_VERSION when the storage shape or rendering options change.
#
# Storage format (CACHE_VERSION 6):
#   { cache_version: 6, pages_by_index: { "0" => {pageAsImage,...}, "1" => {...}, ... } }
#
# Pages are stored in a hash keyed by FILE-RELATIVE 0-based page index. The hash
# format supports incremental population: each batch run merges its freshly-rendered
# pages into the cache without overwriting other batches' contributions. Earlier
# CACHE_VERSION 5 also used this shape but the API took (pages_array, page_offset:);
# v6 takes a hash directly so callers can't accidentally pass wrong offsets.
class RenderedPagesCache
  CACHE_VERSION = 6

  # Merge rendered pages into the cache.
  # @param document_file_revision [DocumentFileRevision]
  # @param pages_by_index [Hash{String=>Hash}] sparse hash of file-relative
  #   0-based page index (as a string) → page hash with keys: pageAsImage, width,
  #   height, original_width, original_height, scaling_factor, crop_offset_x,
  #   crop_offset_y. Only the keys present here are written; existing keys for
  #   other pages are preserved.
  def self.store(document_file_revision, pages_by_index)
    return if pages_by_index.blank?

    existing = read_raw(document_file_revision) || {}
    existing_pages = existing["pages_by_index"].is_a?(Hash) ? existing["pages_by_index"] : {}
    merged = existing_pages.merge(pages_by_index.transform_keys(&:to_s))

    cache_data = {
      cache_version: CACHE_VERSION,
      pages_by_index: merged
    }

    compressed = ActiveSupport::Gzip.compress(cache_data.to_json)

    # Detach existing attachment first so attach() replaces cleanly (avoids stale blob
    # accumulation in ActiveStorage).
    document_file_revision.rendered_pages_cache.purge if document_file_revision.rendered_pages_cache.attached?
    document_file_revision.rendered_pages_cache.attach(
      io: StringIO.new(compressed),
      filename: "rendered_pages_v#{CACHE_VERSION}.json.gz",
      content_type: "application/gzip"
    )
  end

  # Retrieve cached rendered pages as a hash keyed by file-relative 0-based page index.
  # Returns nil if not cached or cache is from an older version.
  # @param document_file_revision [DocumentFileRevision]
  # @return [Hash{String=>Hash}, nil]
  def self.fetch_pages_by_index(document_file_revision)
    data = read_raw(document_file_revision)
    return nil unless data
    return nil if data["cache_version"] != CACHE_VERSION
    pages = data["pages_by_index"]
    pages.is_a?(Hash) && pages.any? ? pages : nil
  end

  # Check if the cache covers every page in [0, expected_total_pages).
  # @param document_file_revision [DocumentFileRevision]
  # @param expected_total_pages [Integer]
  # @return [Boolean]
  def self.complete?(document_file_revision, expected_total_pages)
    return false if expected_total_pages.to_i <= 0
    pages_by_index = fetch_pages_by_index(document_file_revision)
    return false unless pages_by_index
    return false if pages_by_index.size < expected_total_pages
    expected_total_pages.times.all? { |i| pages_by_index.key?(i.to_s) }
  end

  # Check if a specific page range (file-relative 0-based, inclusive on both ends)
  # is fully covered by the cache.
  # @return [Boolean]
  def self.covers_range?(document_file_revision, first_index, last_index)
    return false if first_index.to_i > last_index.to_i
    pages_by_index = fetch_pages_by_index(document_file_revision)
    return false unless pages_by_index
    (first_index.to_i..last_index.to_i).all? { |i| pages_by_index.key?(i.to_s) }
  end

  # Check if the cache attachment exists at all (does not validate version).
  # @return [Boolean]
  def self.cached?(document_file_revision)
    document_file_revision.rendered_pages_cache.attached?
  end

  # Internal: read and parse the cache attachment without version filtering.
  def self.read_raw(document_file_revision)
    return nil unless document_file_revision.rendered_pages_cache.attached?

    compressed = document_file_revision.rendered_pages_cache.download
    json = ActiveSupport::Gzip.decompress(compressed)
    JSON.parse(json)
  rescue => e
    Rails.logger.warn "RenderedPagesCache: failed to read cache for #{document_file_revision.prefix_id}: #{e.message}"
    nil
  end
end
