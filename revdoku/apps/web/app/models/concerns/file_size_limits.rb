# frozen_string_literal: true

# File size limits configuration and validation
# Limits are configurable via environment variables:
#   - MAX_FILE_SIZE_BYTES: Maximum size per file (default: 5MB)
#   - MAX_ENVELOPE_SIZE_BYTES: Maximum total size per envelope (default: 20MB)
#
# Usage in models:
#   include FileSizeLimits
#
# Usage in controllers:
#   FileSizeLimits.max_file_size      # => 5242880
#   FileSizeLimits.max_envelope_size  # => 20971520
#   FileSizeLimits.validate_file_size(file) # => true/false
#   FileSizeLimits.validate_envelope_size(envelope, new_file_size) # => true/false
#
module FileSizeLimits
  extend ActiveSupport::Concern

  # Default limits (can be overridden via environment variables)
  DEFAULT_MAX_FILE_SIZE = 5.megabytes       # 5MB per file
  DEFAULT_MAX_ENVELOPE_SIZE = 20.megabytes  # 20MB total per envelope
  ABSOLUTE_MAX_FILE_SIZE = 50.megabytes     # Hard cap regardless of account settings

  class << self
    # Maximum file size in bytes
    def max_file_size
      ENV.fetch("MAX_FILE_SIZE_BYTES", DEFAULT_MAX_FILE_SIZE).to_i
    end

    # Maximum envelope total size in bytes
    def max_envelope_size
      ENV.fetch("MAX_ENVELOPE_SIZE_BYTES", DEFAULT_MAX_ENVELOPE_SIZE).to_i
    end

    # Human-readable max file size
    def max_file_size_mb
      (max_file_size / 1.megabyte.to_f).round(1)
    end

    # Human-readable max envelope size
    def max_envelope_size_mb
      (max_envelope_size / 1.megabyte.to_f).round(1)
    end

    # Validate a single file size
    # @param file [ActionDispatch::Http::UploadedFile, ActiveStorage::Blob] file to validate
    # @return [Boolean] true if valid
    def validate_file_size(file)
      return true if file.nil?

      file_size = extract_file_size(file)
      file_size <= max_file_size
    end

    # Validate envelope total size including a new file
    # @param envelope [Envelope] the envelope
    # @param new_file_size [Integer] size of new file being added (optional)
    # @return [Boolean] true if valid
    def validate_envelope_size(envelope, new_file_size = 0)
      current_size = calculate_envelope_size(envelope)
      (current_size + new_file_size) <= max_envelope_size
    end

    # Calculate current total size of all files in an envelope
    # @param envelope [Envelope] the envelope
    # @return [Integer] total size in bytes
    def calculate_envelope_size(envelope)
      envelope.document_files.includes(document_file_revisions: :file_attachment).sum do |doc_file|
        doc_file.document_file_revisions.sum do |revision|
          revision.file_size || 0
        end
      end
    end

    # Extract file size from various file types
    # @param file [ActionDispatch::Http::UploadedFile, ActiveStorage::Blob, Integer] file or size
    # @return [Integer] size in bytes
    def extract_file_size(file)
      case file
      when ActionDispatch::Http::UploadedFile
        file.size
      when ActiveStorage::Blob
        file.byte_size
      when Integer
        file
      else
        file.respond_to?(:size) ? file.size : 0
      end
    end

    # Account-aware maximum file size in bytes (capped at ABSOLUTE_MAX_FILE_SIZE)
    def max_file_size_for_account(account)
      account_limit = account&.max_file_size_mb ? account.max_file_size_mb.megabytes : max_file_size
      [account_limit, ABSOLUTE_MAX_FILE_SIZE].min
    end

    # Error message for file too large
    def file_too_large_message(limit_mb = nil)
      limit = limit_mb || max_file_size_mb
      "File size exceeds the maximum allowed size of #{limit}MB. Check your account settings for details."
    end

    # Error message for envelope too large
    def envelope_too_large_message
      "Total envelope size would exceed the maximum allowed size of #{max_envelope_size_mb}MB"
    end
  end

  included do
    # Add validation for file size if the model has a file attachment
    validate :file_size_within_limit, if: -> { respond_to?(:file) && file.attached? }
  end

  private

  def file_size_within_limit
    return unless file.attached?

    acct = respond_to?(:encryption_account) ? encryption_account : (respond_to?(:account) ? account : nil)
    limit = acct ? FileSizeLimits.max_file_size_for_account(acct) : FileSizeLimits.max_file_size
    if file.blob.byte_size > limit
      limit_mb = (limit / 1.megabyte.to_f).round(1)
      errors.add(:file, FileSizeLimits.file_too_large_message(limit_mb))
    end
  end
end
