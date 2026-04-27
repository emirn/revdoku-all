# frozen_string_literal: true

# Populates the normalized content on a freshly-uploaded DocumentFileRevision
# attached to an account-library DocumentFile (i.e. a reference file for
# rule `#file` markers).
#
# - csv / txt: read the raw file, sanitize, store in `page_texts`. No
#   doc-api round-trip.
# - png / jpg / pdf: call the doc-api's /file/normalize endpoint which runs
#   the same render-and-extract pipeline as the main inspection (see
#   apps/services/revdoku-doc-api/src/routes/file/normalize.ts). The service
#   returns `page_texts` (OCR'd with the cheap text_extraction model) and
#   `rendered_pages` (base64 images). Rails caches both on the revision
#   so the next inspection can reuse them without re-running OCR.
class NormalizeDocumentFileRevisionJob < ApplicationJob
  queue_as :default

  retry_on ActiveRecord::RecordNotFound, wait: 5.seconds, attempts: 2
  retry_on Errno::ECONNREFUSED, wait: 10.seconds, attempts: 3
  discard_on ActiveRecord::RecordInvalid

  def perform(document_file_revision_id)
    revision = DocumentFileRevision.find_by_prefix_id!(document_file_revision_id)

    # Normalize any reference file — both envelope-scoped (uploaded during
    # Review) and account-scoped (library). The old `account_scoped?` guard
    # was wrong: it skipped envelope-scoped files, which broke normalization
    # when uploads go directly to the envelope.
    # Envelope source documents (main PDFs being inspected) are normalized
    # inline by ReportCreationService during inspection — they don't come
    # through this job.
    return if revision.ready?

    case revision.mime_type
    when "text/csv", "text/plain"
      normalize_text!(revision)
    when "image/png", "image/jpeg", "image/tiff", "image/webp", "application/pdf"
      normalize_via_revdoku_doc_api!(revision)
    else
      Rails.logger.warn "NormalizeDocumentFileRevisionJob: unhandled mime #{revision.mime_type} for #{document_file_revision_id}"
    end
  end

  private

  def normalize_text!(revision)
    raw = revision.file.download
    text = PromptSanitizer.sanitize_external_content(raw, revision.mime_type)
    revision.update!(page_texts: [{ "page" => 1, "text" => text }])
  end

  def normalize_via_revdoku_doc_api!(revision)
    # Resolve the text-extraction model config. Passing the revision's account
    # lets the resolver pick up any BYOK key the account has configured for
    # the text-extraction model's provider (text extraction uses the same
    # provider pool as the main review models).
    text_extraction_model_id = revision.account.default_ai_model(:text_extraction) || AiModelResolver.default_model_id(:text_extraction)
    model_config = AiModelResolver.resolve(
      text_extraction_model_id,
      operation: :text_extraction,
      account: revision.account
    )

    response = RevdokuDocApiClient.client.normalize_file(
      name: revision.name.to_s,
      mime_type: revision.mime_type,
      data_base64: Base64.strict_encode64(revision.file.download),
      text_extraction_model_config: model_config
    )

    unless response[:success]
      Rails.logger.error "normalize_file failed for #{revision.prefix_id}: #{response[:message]}"
      return
    end

    # Cache the rendered pages in the same gzip-compressed JSON shape
    # RenderedPagesCache uses elsewhere, so any downstream code that
    # reads rendered_pages_cache for envelope pages can reuse this file
    # without branching.
    pages = Array(response[:rendered_pages]).map { |p|
      {
        "page" => p["page"],
        "image" => p["image"],
        "mime_type" => p["mime_type"] || "image/jpeg",
        "width" => p["width"],
        "height" => p["height"]
      }
    }
    compressed = Zlib::Deflate.deflate(pages.to_json)

    ActiveRecord::Base.transaction do
      revision.rendered_pages_cache.attach(
        io: StringIO.new(compressed),
        filename: "rendered_pages_cache.json.gz",
        content_type: "application/gzip"
      )
      revision.update!(page_texts: Array(response[:page_texts]))
    end
  end
end
