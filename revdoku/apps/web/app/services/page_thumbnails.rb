# frozen_string_literal: true

# Lightweight thumbnail cache for document pages, stored on DocumentFileRevision.
#
# Mirrors the RenderedPagesCache pattern but stores only small JPEG thumbnails
# (~2-4 KB total) instead of full-size page images (~100+ KB each).
# The thumbnail endpoint uses this to avoid downloading the heavy rendered pages cache.
class PageThumbnails
  CACHE_VERSION = 2

  # Store thumbnails for a document file revision.
  # @param document_file_revision [DocumentFileRevision]
  # @param thumbnails_data [Array<Hash>] Array of { "pageAsImage" => base64, "width" => N, "height" => N }
  def self.store(document_file_revision, thumbnails_data)
    cache_data = {
      cache_version: CACHE_VERSION,
      pages: thumbnails_data
    }

    compressed = ActiveSupport::Gzip.compress(cache_data.to_json)

    document_file_revision.page_thumbnails.attach(
      io: StringIO.new(compressed),
      filename: "page_thumbnails_v#{CACHE_VERSION}.json.gz",
      content_type: "application/gzip"
    )
  end

  # Retrieve cached thumbnails, or nil if not cached or stale.
  # @param document_file_revision [DocumentFileRevision]
  # @return [Array<Hash>, nil]
  def self.fetch(document_file_revision)
    return nil unless document_file_revision.page_thumbnails.attached?

    compressed = document_file_revision.page_thumbnails.download
    json = ActiveSupport::Gzip.decompress(compressed)
    data = JSON.parse(json)

    return nil if data["cache_version"] != CACHE_VERSION

    data["pages"]
  rescue => e
    Rails.logger.warn "PageThumbnails: failed to read cache for #{document_file_revision.prefix_id}: #{e.message}"
    nil
  end

  # Check if thumbnails are cached.
  # @param document_file_revision [DocumentFileRevision]
  # @return [Boolean]
  def self.cached?(document_file_revision)
    document_file_revision.page_thumbnails.attached?
  end
end
