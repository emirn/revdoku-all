# frozen_string_literal: true

class DocumentFileRevision < AccountRecord
  include FileSizeLimits
  include UserTrackable

  has_prefix_id :dfrev

  belongs_to :account
  belongs_to :document_file
  has_and_belongs_to_many :envelope_revisions,
                          join_table: :document_file_revisions_envelope_revisions

  # Per-account encryption for file attachments
  include AccountEncryptable

  has_encrypted :name, key: :lockbox_encryption_key

  # Extracted text per page, array of { page: <file-relative 1-based>, text: <string> }.
  # Populated by ReportCreationService after doc-api inspection; used by change detection.
  has_encrypted :page_texts, key: :lockbox_encryption_key, type: :json

  # Auto-set account from document_file on create (similar to Report and Check models)
  before_validation :set_account_from_document_file, on: :create

  # ActiveStorage attachment
  has_one_attached :file
  encrypts_attached :file, key: :lockbox_encryption_key

  # Cached rendered page images (gzip-compressed JSON with base64 JPEG pages).
  # Populated asynchronously after first report creation to avoid re-rendering
  # PDFs on subsequent inspections and exports.
  has_one_attached :rendered_pages_cache
  encrypts_attached :rendered_pages_cache, key: :lockbox_encryption_key

  # Lightweight page thumbnails (gzip-compressed JSON with small JPEG thumbnails).
  # Used by the thumbnail endpoint to avoid downloading the heavy rendered pages cache.
  has_one_attached :page_thumbnails
  encrypts_attached :page_thumbnails, key: :lockbox_encryption_key

  ALLOWED_MIME_TYPES = %w[
    application/pdf
    image/png
    image/jpeg
    image/tiff
    image/webp
  ].freeze

  # Reference files (DocumentFile#reference? — library or envelope-scoped)
  # accept a wider mime set including text formats; source documents keep the
  # stricter set above.
  REFERENCE_ALLOWED_MIME_TYPES = (ALLOWED_MIME_TYPES + %w[text/csv text/plain text/markdown]).freeze

  # Max size for reference file revisions, tighter than the default envelope
  # source-document upload limit.
  REFERENCE_MAX_FILE_BYTES = 2 * 1024 * 1024

  validates :revision_number, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :name, presence: true
  validates :mime_type, presence: true
  validate :validate_mime_type_by_role
  validate :validate_reference_file_size_limit

  # Convert file content to base64 for API compatibility
  def to_base64
    return nil unless file.attached?

    Base64.strict_encode64(file.download)
  end

  # Create from base64 data
  def attach_from_base64(base64_data)
    decoded_data = Base64.decode64(base64_data)
    io = StringIO.new(decoded_data)
    sanitized = sanitized_blob_filename
    io.class.class_eval { attr_accessor :original_filename, :content_type }
    io.original_filename = sanitized
    io.content_type = mime_type

    file.attach(io: io, filename: sanitized, content_type: mime_type)
  end

  def file_size
    file.attached? ? file.byte_size : size
  end

  def metadata_hash
    JSON.parse(metadata || "{}")
  rescue JSON::ParserError
    {}
  end

  def metadata_hash=(hash)
    self.metadata = hash.to_json
  end

  def as_json(options = {})
    base = super(options)
    base["name"] = name
    base.except("name_ciphertext", "page_texts_ciphertext", "pages_layout_json")
  end

  # ── Per-file page layout data ─────────────────────────────────────────
  # pages_layout_json is a text column holding a JSON object with keys:
  #   content_bounding_boxes, page_coordinate_spaces, page_types,
  #   page_statuses, page_font_scales
  # All sub-hashes are keyed by file-relative 0-based page index as a string.

  def pages_layout
    raw = read_attribute(:pages_layout_json)
    raw.present? ? JSON.parse(raw) : {}
  rescue JSON::ParserError
    {}
  end

  def pages_layout=(hash)
    write_attribute(:pages_layout_json, hash.is_a?(String) ? hash : hash.to_json)
  end

  def content_bounding_boxes
    pages_layout["content_bounding_boxes"] || {}
  end

  def page_coordinate_spaces
    pages_layout["page_coordinate_spaces"] || {}
  end

  def page_types
    pages_layout["page_types"] || {}
  end

  def page_statuses
    pages_layout["page_statuses"] || {}
  end

  def page_font_scales
    pages_layout["page_font_scales"] || {}
  end

  def page_font_scales=(value)
    parsed = pages_layout
    parsed["page_font_scales"] = value.transform_values { |v| v.to_f.clamp(0.5, 3.0) }
    self.pages_layout = parsed
  end

  # Merge a batch of file-relative keyed per-page data into pages_layout_json.
  # @param partial [Hash] keys among content_bounding_boxes, page_coordinate_spaces, page_types, page_statuses
  def merge_pages_layout!(partial)
    existing = pages_layout
    %w[content_bounding_boxes page_coordinate_spaces page_types page_statuses page_font_scales].each do |key|
      # `partial.fetch(..., nil)` avoids triggering a default_proc if the
      # caller passed a Hash.new { ... } (which would otherwise mutate partial
      # and return an empty hash that short-circuits `||`).
      new_data = partial.fetch(key, nil) || partial.fetch(key.to_sym, nil)
      next if new_data.blank?
      existing[key] ||= {}
      existing[key].merge!(new_data.transform_keys(&:to_s))
    end
    self.pages_layout = existing
    save!
  end

  # Returns a generic filename for ActiveStorage blobs to avoid storing
  # the real filename in plaintext. The real name lives in the encrypted
  # `name` column only.
  def sanitized_blob_filename
    ext = File.extname(name.to_s)
    "document_#{SecureRandom.hex(8)}#{ext}"
  end

  # True for revisions owned by an account-library DocumentFile (envelope_id: nil).
  # Used by mime + size validators and by the attachment pipeline to choose
  # library-specific rules.
  def account_scoped?
    document_file && document_file.envelope_id.nil?
  end

  # True when a library-scoped revision in the same account already points at
  # this revision's blob. Covers both flows:
  #   - the file was copied INTO this envelope from the library
  #     (envelope-scoped clone shares the blob with its library source)
  #   - the file was previously SAVED FROM some envelope to the library
  #     (library copy shares the blob with the original envelope upload)
  # Returns false when the file isn't attached yet (normalization still pending).
  def in_account_library?
    return true if document_file&.library? && document_file.envelope_id.nil?
    return false unless file.attached? && account_id

    DocumentFileRevision
      .joins(:document_file, :file_attachment)
      .where(account_id: account_id)
      .where(document_files: { reference: true, envelope_id: nil })
      .where(active_storage_attachments: { blob_id: file.blob.id })
      .where.not(id: id)
      .exists?
  end

  # A revision is considered ready when its raw file is attached and — for mimes
  # that need normalization — its normalized content is present. csv/txt store
  # their normalized content in `page_texts`; png/jpg/pdf store it in
  # `rendered_pages_cache`.
  def ready?
    return false unless file.attached?

    case mime_type
    when "text/csv", "text/plain"
      page_texts.present?
    when "image/png", "image/jpeg", "image/tiff", "image/webp", "application/pdf"
      rendered_pages_cache.attached?
    else
      true
    end
  end

  private

  def set_account_from_document_file
    self.account ||= document_file&.account || document_file&.envelope&.account
  end

  def validate_mime_type_by_role
    allowed = document_file&.reference? ? REFERENCE_ALLOWED_MIME_TYPES : ALLOWED_MIME_TYPES
    return if allowed.include?(mime_type)

    errors.add(:mime_type, "is not an allowed file type (#{allowed.join(", ")})")
  end

  def validate_reference_file_size_limit
    return unless document_file&.reference?
    return unless file.attached?
    return if file.blob.byte_size <= REFERENCE_MAX_FILE_BYTES

    limit_mb = (REFERENCE_MAX_FILE_BYTES / 1.megabyte.to_f).round(1)
    errors.add(:file, "size exceeds the reference file limit of #{limit_mb}MB")
  end
end
