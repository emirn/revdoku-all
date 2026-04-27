# frozen_string_literal: true

class ReportCreationService
  attr_reader :envelope_revision, :checklist, :report
  attr_accessor :batch_file_context

  # ────────────────────────────────────────────────────────────────────────────
  # Class methods for finalization work that both CreateReportJob and the cancel
  # controller need to call. Keeping them at class level (no instance state
  # required) lets the controller invoke them without spinning up a full service.
  # ────────────────────────────────────────────────────────────────────────────

  # Renumber AI check indices so every check across the whole report has a
  # unique, deterministic index. doc-api emits per-batch local indices (0..N)
  # that collide across batches, so without renumbering the frontend shows
  # multiple checks labelled "4" etc. Idempotent — safe to call repeatedly.
  def self.renumber_check_indices(report)
    ai_checks = report.checks.where(source: :ai).map do |c|
      { id: c.prefix_id, passed: c.passed, page: c.page, x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 }
    end
    return if ai_checks.empty?

    reserved = report.checks.where(source: :user).pluck(:check_index).compact
    indices = RevdokuDocApiClient.client.reindex_checks(ai_checks, reserved_check_indices: reserved)
    return if indices.empty?

    # Decode prefix_ids → integer PKs and build {db_id => new_index} so we can
    # write all new indices in ONE UPDATE … CASE id WHEN … statement instead of
    # N individual update_column calls. Each update_column is its own SQLite
    # auto-commit transaction; for ~250 checks that's 250 writer-lock
    # acquisitions, which trips SQLite3::BusyException under the cancel→resume
    # race (config/queue.yml: threads: 3 → old wind-down job, new resume job
    # and the cancel controller all competing for the write lock). One CASE
    # statement holds the lock once for ~5-20ms instead of 250 times spread
    # across ~100-300ms.
    id_map = indices.each_with_object({}) do |entry, h|
      prefix_id = entry["id"] || entry[:id]
      new_idx = entry["check_index"] || entry[:check_index]
      next unless prefix_id && new_idx
      db_id = Check.decode_prefix_id(prefix_id) rescue nil
      h[db_id] = new_idx.to_i if db_id
    end
    return if id_map.empty?

    # Build the CASE expression with sanitized integer literals (to_i on both
    # the id and the new index — no user-supplied data reaches the SQL string).
    # The WHERE id IN (…) bound is load-bearing: without it, rows NOT listed
    # in any WHEN branch would fall through to the implicit ELSE NULL and have
    # their check_index nulled.
    case_pairs = id_map.map { |db_id, idx| "WHEN #{db_id.to_i} THEN #{idx.to_i}" }.join(" ")
    Check.where(id: id_map.keys).update_all("check_index = CASE id #{case_pairs} END")
  rescue => e
    Rails.logger.warn "ReportCreationService.renumber_check_indices failed: #{e.message}"
  end

  # Mark pages in [page_offset, total_pages) as CANCELLED_BY_USER in each
  # DocumentFileRevision's pages_layout_json.page_statuses so the "Continue
  # review" banner in the frontend knows which pages still need attention.
  # Does not overwrite existing entries (e.g. REVIEWED pages stay reviewed).
  def self.fill_cancelled_page_statuses(report, page_offset, total_pages)
    return if total_pages.to_i <= 0 || page_offset.to_i >= total_pages.to_i

    aggregator = ReportLayoutAggregator.new(report.envelope_revision)
    pending_by_rev = Hash.new { |h, k| h[k] = {} }

    (page_offset.to_i...total_pages.to_i).each do |doc_idx|
      lookup = aggregator.file_revision_for_doc_page(doc_idx)
      next unless lookup
      rev, file_rel = lookup
      pending_by_rev[rev.id][file_rel.to_s] = Report::PageReviewStatus::CANCELLED_BY_USER
    end

    pending_by_rev.each do |rev_id, statuses|
      rev = DocumentFileRevision.find(rev_id)
      existing_layout = rev.pages_layout
      existing_statuses = existing_layout["page_statuses"] || {}
      statuses.each { |k, v| existing_statuses[k] ||= v }
      existing_layout["page_statuses"] = existing_statuses
      rev.pages_layout = existing_layout
      rev.save!
    end
    report.reset_layout_cache!
  rescue => e
    Rails.logger.warn "ReportCreationService.fill_cancelled_page_statuses failed: #{e.message}"
  end

  # Flush a single batch's rendered_files array to the per-file-revision
  # RenderedPagesCache + PageThumbnails. Called SYNCHRONOUSLY by
  # CreateReportJob after every successful batch — running inline in the job's
  # thread keeps memory bounded (only the current batch's ~100KB is held), still
  # fills the cache progressively (cancelled/crashed runs retain completed
  # batches' pages), and avoids the queue-DB enqueue flood that caused the
  # SQLite busy_timeout crashes under the old async-per-batch job design.
  #
  # @param envelope_revision [EnvelopeRevision]
  # @param rendered_files [Array<Hash>] one entry per file revision from the
  #   current batch's doc-api response: { id: prefix_id, pages_by_index: {...} }
  def self.flush_rendered_pages_to_cache(envelope_revision, rendered_files)
    return if rendered_files.blank?

    file_revs_by_prefix = envelope_revision.ordered_document_file_revisions.index_by(&:prefix_id)

    rendered_files.each do |rf|
      file_id = rf[:id] || rf["id"]
      file_rev = file_revs_by_prefix[file_id]
      next unless file_rev

      pages_by_index = rf[:pages_by_index] || rf["pages_by_index"]
      next unless pages_by_index.is_a?(Hash) && pages_by_index.any?

      # Store full page images (filter entries that actually carry image data).
      pages_with_images = pages_by_index.select do |_idx, page|
        page.is_a?(Hash) && page["pageAsImage"].present?
      end
      if pages_with_images.any?
        RenderedPagesCache.store(file_rev, pages_with_images)
      end

      # Store per-file thumbnail from index "0" if doc-api attached one.
      thumb_source = pages_by_index["0"]
      if thumb_source.is_a?(Hash) && thumb_source["pageAsThumbnail"].present?
        thumbnail = {
          "pageAsImage" => thumb_source["pageAsThumbnail"],
          "width" => thumb_source["thumbnailWidth"],
          "height" => thumb_source["thumbnailHeight"]
        }
        PageThumbnails.store(file_rev, [thumbnail])
      end
    end
  rescue => e
    Rails.logger.warn "ReportCreationService.flush_rendered_pages_to_cache failed: #{e.message}"
  end


  # checklist parameter is the source checklist (template or previous report's snapshot)
  def initialize(envelope_revision, checklist, debug_options: nil, pages: nil, timezone: nil, page_font_scales: nil, skip_previous_checks: false, expected_job_id: nil, ai_model_override: nil, track_changes_override: nil, highlight_mode_override: nil, max_affordable_pages: nil)
    @envelope_revision = envelope_revision
    @checklist = checklist
    @debug_options = debug_options
    @pages = pages
    @timezone = timezone || "UTC"
    @page_font_scales = page_font_scales
    @skip_previous_checks = skip_previous_checks
    @expected_job_id = expected_job_id
    @ai_model_override = ai_model_override
    @track_changes_override = track_changes_override
    @highlight_mode_override = highlight_mode_override
    @max_affordable_pages = max_affordable_pages
    @report = nil
  end

  # Build file context for batch processing (file names for AI context)
  def build_batch_file_context
    envelope_revision.ordered_document_file_revisions.includes(:document_file).map { |rev| { file_name: rev.name } }
  end

  # Execute a single batch of pages for batch processing
  def call_batch(pages:, page_offset: 0, current_job_checks: [], current_job_page_texts: [])
    @pages = pages
    revdoku_doc_api_request = build_revdoku_doc_api_request
    revdoku_doc_api_request[:pageNumberOffset] = page_offset
    revdoku_doc_api_request[:batch_context] = @batch_file_context
    revdoku_doc_api_request[:current_job_checks] = current_job_checks
    revdoku_doc_api_request[:current_job_previous_page_texts] = current_job_page_texts if current_job_page_texts.any?

    # Optimization: if every page in this batch is already in the per-file cache, tell
    # doc-api not to bother building rendered_files in its response (no new pages will
    # be rendered). Saves response payload + cache-merge job overhead.
    cache_covers_full_batch = batch_fully_cached?(page_offset, parse_batch_pages(@pages))
    revdoku_doc_api_request[:skip_rendered_files_response] = true if cache_covers_full_batch

    Rails.logger.info "ReportCreationService#call_batch: pages #{pages} (offset=#{page_offset}, cache_full=#{cache_covers_full_batch})"
    revdoku_doc_api_response = RevdokuDocApiClient.client.create_report(revdoku_doc_api_request)

    # NOTE: rendered_files from the response are NOT cached here. CreateReportJob
    # accumulates them across all batches and flushes once at the end via
    # ReportCreationService.flush_rendered_pages_to_cache — this avoids the
    # per-batch CacheRenderedPagesJob flood that overwhelmed Solid Queue with
    # O(N²) primary-DB write churn.
    revdoku_doc_api_response
  rescue RevdokuDocApiClient::ConnectionError
    raise
  rescue => e
    Rails.logger.error "Batch failed for pages #{pages}: #{e.class} - #{e.message}"
    { success: false, message: RevdokuDocApiClient.sanitize_error_for_user(e.message) }
  end

  # Parse a batch's `@pages` string (e.g. "1-2", "5,7-10") into a Set of file-relative
  # 0-based page indices, given the page_offset (the absolute starting offset of the
  # batch in the document). For single-file envelopes (the common case) the document-
  # relative offset equals the file-relative offset.
  def parse_batch_pages(pages_str)
    return [] unless pages_str.is_a?(String) && pages_str.present?
    indices = []
    pages_str.split(",").each do |part|
      part = part.strip
      next if part.empty?
      if part.include?("-")
        s, e = part.split("-").map(&:to_i)
        next if s <= 0 || e <= 0 || s > e
        (s..e).each { |p| indices << (p - 1) }
      else
        n = part.to_i
        next if n <= 0
        indices << (n - 1)
      end
    end
    indices
  end

  # Check whether the file revision's cache already contains every page in the batch.
  # Multi-file envelopes: only the FIRST file is checked (the common case is single-file).
  # If the envelope has multiple files we conservatively return false so doc-api renders
  # whatever's missing.
  def batch_fully_cached?(_page_offset, batch_indices_in_doc)
    return false if batch_indices_in_doc.empty?
    revisions = envelope_revision.ordered_document_file_revisions.includes(:document_file)
    return false if revisions.size != 1
    file_rev = revisions.first
    cached = RenderedPagesCache.fetch_pages_by_index(file_rev)
    return false unless cached
    batch_indices_in_doc.all? { |idx| cached.key?(idx.to_s) }
  rescue => e
    Rails.logger.warn "batch_fully_cached? check failed: #{e.message}"
    false
  end

  # Append checks from a batch result to an existing report
  def append_batch_checks(report, revdoku_doc_api_report_json)
    create_checks_from_json(report, revdoku_doc_api_report_json["checks"] || [], source: :ai)
  end

  # Merge page layout data (coordinate spaces, bounding boxes, page_statuses)
  # from a doc-api batch response into each DocumentFileRevision's
  # pages_layout_json. doc-api keys the flat dicts by document-relative page
  # index; we split them per-file using `file_page_counts` (authoritative,
  # document-wide).
  def merge_batch_page_layout(report, revdoku_doc_api_response)
    file_page_counts = revdoku_doc_api_response[:file_page_counts] || revdoku_doc_api_response["file_page_counts"] || {}
    file_revs = envelope_revision.ordered_document_file_revisions.to_a
    offsets = compute_file_offsets(file_revs, file_page_counts)

    layout_keys = %w[content_bounding_boxes page_coordinate_spaces page_types page_statuses]
    # Use the DFR object itself as the bucket key so we don't need a
    # secondary `file_revs.find` lookup during the write phase. The inner
    # hash is a plain Hash (no default_proc) so downstream code reading with
    # both symbol and string keys via `||` doesn't silently create truthy-but-
    # empty entries that short-circuit the fallback lookup.
    buckets = file_revs.each_with_object({}) { |rev, h| h[rev] = {} }

    layout_keys.each do |key|
      new_data = revdoku_doc_api_response[key.to_sym] || revdoku_doc_api_response[key]
      next unless new_data.is_a?(Hash) && new_data.any?
      new_data.each do |doc_key, value|
        # Keys can be strings ("0"), symbols (:"0") or integers depending on
        # how the doc-api JSON was parsed/transformed upstream — Symbol has
        # no `#to_i`, so coerce via `to_s` first.
        doc_idx = doc_key.to_s.to_i
        rev_idx = file_index_for_offset(offsets, doc_idx)
        next unless rev_idx
        rev = file_revs[rev_idx]
        file_rel = doc_idx - offsets[rev_idx]
        (buckets[rev][key] ||= {})[file_rel.to_s] = value
      end
    end

    buckets.each do |rev, partial|
      next if partial.empty?
      rev.merge_pages_layout!(partial)
    end
    report.reset_layout_cache!
  rescue => e
    Rails.logger.warn "Failed to merge batch page layout: #{e.class}: #{e.message}"
  end

  # Split doc-api's flat page_texts array (document-relative) into per-file
  # arrays and write each to the corresponding DocumentFileRevision.
  def write_batch_page_texts(revdoku_doc_api_report, file_page_counts)
    page_texts = revdoku_doc_api_report["page_texts"] || revdoku_doc_api_report[:page_texts]
    return unless page_texts.is_a?(Array) && page_texts.any?

    file_revs = envelope_revision.ordered_document_file_revisions.to_a
    offsets = compute_file_offsets(file_revs, file_page_counts || {})

    # Key buckets by the DFR object itself (no secondary find lookup needed).
    buckets = file_revs.each_with_object({}) { |rev, h| h[rev] = [] }
    page_texts.each do |entry|
      next unless entry.is_a?(Hash)
      doc_page = (entry["page"] || entry[:page]).to_i  # 1-based document-relative
      doc_idx = doc_page - 1
      rev_idx = file_index_for_offset(offsets, doc_idx)
      next unless rev_idx
      file_rel_page = doc_idx - offsets[rev_idx] + 1  # 1-based file-relative
      buckets[file_revs[rev_idx]] << { "page" => file_rel_page, "text" => entry["text"] || entry[:text] }
    end

    buckets.each do |rev, texts|
      next if texts.empty?
      existing = rev.page_texts.is_a?(Array) ? rev.page_texts : []
      # O(N+M) merge: build a Set of incoming page numbers once, then filter
      # existing entries against it. The old nested-any? form was O(N*M).
      new_page_nums = texts.map { |t| (t["page"] || t[:page]).to_i }.to_set
      merged = existing.reject { |e| new_page_nums.include?((e["page"] || e[:page]).to_i) } + texts
      merged.sort_by! { |e| (e["page"] || e[:page]).to_i }
      rev.page_texts = merged
      rev.save!
    end

    # Invalidate the memoized aggregator on the owning report so subsequent
    # reads (e.g. the job's own finalization, or serializers hit in the same
    # request) see the freshly-written page_texts.
    envelope_revision.report&.reset_layout_cache!
  rescue => e
    Rails.logger.warn "Failed to write batch page texts: #{e.message}"
  end

  # Build the report attrs that the batch loop writes at finalization.
  # page_texts are now persisted per-DocumentFileRevision (see write_batch_page_texts),
  # so they're no longer included in the report attrs. The job should call
  # write_batch_page_texts separately at finalization.
  def report_update_attributes(revdoku_doc_api_report)
    {
      job_status: :completed,
      error_message: nil,
      ai_model: @resolved_model_config[:alias_id],
      meta: { "core_model_id" => revdoku_doc_api_report["ai_model"], "resolved_at" => Time.current.iso8601 },
      inspection_context: build_inspection_context
    }
  end

  # Copy checklist scripts to envelope if envelope has no scripts.
  # Called at end of successful inspection (CreateReportJob finalization) and
  # from the cancel controller when checks were created. The envelope guard
  # prevents overwriting user edits.
  def copy_checklist_scripts_to_envelope
    envelope = envelope_revision.envelope
    checklist_scripts = checklist.user_scripts
    Rails.logger.info "copy_checklist_scripts_to_envelope: checklist=#{checklist.prefix_id} scripts_present=#{checklist_scripts.present?} scripts_count=#{checklist_scripts&.length || 0} envelope=#{envelope.prefix_id} envelope_scripts_present=#{envelope.user_scripts.present?}"
    return unless checklist_scripts.present?
    return if envelope.user_scripts.present?
    envelope.update(user_scripts: checklist_scripts)
    Rails.logger.info "copy_checklist_scripts_to_envelope: copied #{checklist_scripts.length} script(s) to envelope #{envelope.prefix_id}"
  rescue => e
    Rails.logger.warn "Failed to copy checklist scripts to envelope: #{e.message}"
  end

  private

  def build_revdoku_doc_api_request
    previous_report = envelope_revision.previous_revision&.report
    previous_report_checks = if @skip_previous_checks
      []
    else
      previous_report ? previous_report.checks : []
    end

    current_report = envelope_revision&.report

    # Collect exact check_index values used by preserved user checks.
    # AI will skip these indices and fill unused slots sequentially.
    reserved_check_indices = current_report&.checks&.where(source: :user)&.pluck(:check_index)&.compact || []

    Rails.logger.info "Creating report for envelope_revision: #{envelope_revision.prefix_id}, checklist: #{checklist.prefix_id}"

    document_files_revisions = envelope_revision.ordered_document_file_revisions.includes(:document_file, file_attachment: :blob, rendered_pages_cache_attachment: :blob)

    Rails.logger.info "Building doc-api request for envelope_revision: #{envelope_revision.prefix_id}, checklist: #{checklist.prefix_id}"

    ai_model = @ai_model_override.presence || checklist.ai_model.presence || AiModelResolver.default_model_id(:inspection)
    # account: is passed so the resolver can inject per-account keys
    # (api_key + base_url) from Account#ai_provider_keys for the resolved
    # provider. Without the kwarg the resolver emits `api_key_source:
    # "env"` and doc-api falls through to the ENV-var shared key.
    model_config = AiModelResolver.resolve(ai_model, operation: :inspection, account: envelope_revision.account)
    @resolved_model_config = model_config

    # Separate cheap vision model used for text extraction:
    #   - doc-api uses it in `extractPageTexts` for track_changes
    #   - doc-api uses it in `/file/normalize` for reference file OCR
    # Account can override via /account/ai (Text Extraction Model);
    # falls back to ai_models.yml default. Not per-review — account-wide so
    # credit estimates stay predictable.
    text_extraction_model_id = envelope_revision.account.default_ai_model(:text_extraction) || ai_model
    text_extraction_model_config = AiModelResolver.resolve(
      text_extraction_model_id,
      operation: :text_extraction,
      account: envelope_revision.account
    ) rescue model_config

    # Build merged rules: template checklist rules + custom rules from envelope revisions
    @merged_rules = build_merged_rules
    @previous_checks_snapshot = serialize_checks(previous_report_checks)

    # Always regenerate thumbnails — negligible overhead, ensures margin-cropped versions
    skip_thumbnail_file_ids = []

    user_rules_count = @merged_rules.count { |r| (r[:origin] || r["origin"]) == "user" }
    checklist_rules_count = @merged_rules.length - user_rules_count
    prev_checks_count = previous_report_checks.length
    Rails.logger.info "doc-api request: #{checklist_rules_count} checklist rules, #{user_rules_count} user/custom rules, #{prev_checks_count} previous checks"
    Rails.logger.info "doc-api request: inspection_date_display=#{compute_inspection_date_display.inspect} timezone=#{@timezone.inspect}"

    # Build a virtual checklist payload for doc-api (no snapshot record needed).
    # If the checklist's system_prompt carried a #file[...] or file:<id>
    # marker that was resolved during enrichment, use the expanded text from
    # `report.enriched_rules[CHECKLIST_SYSTEM_PROMPT_RULE_ID]` instead.
    effective_system_prompt = resolve_system_prompt_with_ref_files || checklist.system_prompt

    # Ad-hoc reference files: per-inspection user attachments from the
    # Review dialog's "Add note" section. Rails resolves them up-front
    # (already envelope-scoped dfrev_prefix_ids in inspection_context),
    # so the service just appends synthetic `#ref[file:dfrev|label]`
    # markers to the system_prompt and adds the revisions to the
    # top-level ref_files payload. The doc-api service's existing token substitution
    # replaces each synthetic marker with inline text or an image
    # attachment, indistinguishable from a checklist-requested ref.
    ad_hoc_ref_file_entries = build_ad_hoc_ref_file_entries
    if ad_hoc_ref_file_entries.any?
      effective_system_prompt = append_ad_hoc_ref_markers(effective_system_prompt, ad_hoc_ref_file_entries)
    end

    revdoku_doc_api_checklist = {
      id: checklist.prefix_id,
      name: checklist.name,
      system_prompt: effective_system_prompt,
      ai_model: checklist.ai_model,
      track_changes: track_changes_active?,
      highlight_mode: effective_highlight_mode,
      rules: serialize_rules(@merged_rules)
    }

    # Per-review user context captured in the Review dialog. Stored on the
    # report's encrypted inspection_context; doc-api concatenates it with
    # the checklist's system_prompt (with a clear boundary) so the AI
    # sees it as additional context for this specific run without
    # conflating it with the checklist-author-written system_prompt.
    review_note = current_report&.inspection_context&.dig("review_note").presence

    request = {
      envelope_revision_id: envelope_revision.prefix_id,
      document_files_revisions: serialize_document_file_revisions(document_files_revisions),
      previous_report_checks: @previous_checks_snapshot,
      checklist: revdoku_doc_api_checklist,
      review_note: review_note,
      # Top-level ref_files payload for `#file` / `file:<id>` markers.
      # Each entry carries either `content` (text mimes) or `base64_pages`
      # (image/pdf mimes) keyed by `document_file_revision_id` (prefix_id).
      # The doc-api service substitutes `file:<dfrev_prefix_id>` tokens in the rule
      # prompts + system_prompt with this content during AI message build.
      # Ad-hoc refs append to the same array so doc-api treats them
      # identically to checklist-requested refs.
      ref_files: build_revdoku_doc_api_ref_files + build_revdoku_doc_api_ad_hoc_ref_files(ad_hoc_ref_file_entries),
      report_id: current_report&.prefix_id,
      model_config: model_config,
      # Secondary model config doc-api uses for text extraction:
      # extractPageTexts (track_changes) and /file/normalize (reference
      # files). Cheap vision model; see ai_models.yml :text_extraction.
      text_extraction_model_config: text_extraction_model_config,
      reserved_check_indices: reserved_check_indices,
      inspection_date_display: compute_inspection_date_display,
      skip_thumbnail_file_ids: skip_thumbnail_file_ids,
      session_id: compute_session_id
    }
    # Send previous revision's page_texts to doc-api for change tracking.
    # Aggregate from the previous revision's DFRs (each holds file-relative
    # page_texts) into a document-relative flat array.
    #
    # If any prior-rev DFR is missing `page_texts` (first time track-changes
    # is run against revisions uploaded before this feature existed, or any
    # earlier flow that never extracted text), extract + persist those
    # synchronously here so the rest of the pipeline stays on its fast path.
    # Caches the extracted text back onto each DFR; future runs are free.
    if track_changes_active? && !@skip_previous_checks
      prev_revision = envelope_revision.previous_revision
      if prev_revision
        ensure_prior_revision_page_texts!(prev_revision, text_extraction_model_config)
        prev_aggregator = ReportLayoutAggregator.new(prev_revision)
        aggregated = prev_aggregator.aggregate_page_texts
        request[:previous_page_texts] = aggregated if aggregated.any?
      end
    end

    request[:debug] = @debug_options if @debug_options.present?
    request[:pages] = @pages if @pages.present?
    request[:page_font_scales] = @page_font_scales if @page_font_scales.present?
    request[:max_affordable_pages] = @max_affordable_pages if @max_affordable_pages
    request
  end

  # Session ID for doc-api log correlation — the raw ActiveJob UUID.
  # Contains no PHI/PII, just an opaque identifier.
  def compute_session_id
    @expected_job_id
  end

  # Memoised accessor for the report attached to this envelope_revision.
  # Nil on the rare pre-create path where the report isn't yet persisted.
  def current_report
    @current_report ||= envelope_revision&.report
  end

  # Track-changes is a per-review runtime flag. The user enables it from
  # the Review dialog on revisions 2+; there is no checklist-level default
  # anymore. `nil` override means "not enabled for this run".
  def track_changes_active?
    @track_changes_override == true
  end

  # Before running a track-changes review, make sure the prior revision's
  # DocumentFileRevisions all have `page_texts` cached. For anything
  # missing, extract synchronously via the same `/file/normalize` path
  # NormalizeDocumentFileRevisionJob uses (cheap text_extraction model),
  # and persist the result back onto the DFR. The aggregator in the
  # caller then reads the now-populated cache as if nothing changed.
  #
  # Runs inline — reviews are already async jobs, so a few extra seconds
  # here is fine. Future work: move this to a separate job and re-queue
  # the review once extraction completes if latency becomes a problem.
  def ensure_prior_revision_page_texts!(prev_revision, text_extraction_model_config)
    prev_revision.ordered_document_file_revisions.includes(file_attachment: :blob).each do |dfr|
      next if dfr.page_texts.present?
      case dfr.mime_type
      when "text/csv", "text/plain"
        raw = dfr.file.download
        text = PromptSanitizer.sanitize_external_content(raw, dfr.mime_type)
        dfr.update!(page_texts: [{ "page" => 1, "text" => text }])
      when "image/png", "image/jpeg", "image/tiff", "image/webp", "application/pdf"
        response = RevdokuDocApiClient.client.normalize_file(
          name: dfr.name.to_s,
          mime_type: dfr.mime_type,
          data_base64: Base64.strict_encode64(dfr.file.download),
          text_extraction_model_config: text_extraction_model_config
        )
        unless response[:success]
          Rails.logger.warn "ensure_prior_revision_page_texts: normalize_file failed for #{dfr.prefix_id}: #{response[:message]}"
          next
        end
        dfr.update!(page_texts: Array(response[:page_texts]))
      else
        Rails.logger.warn "ensure_prior_revision_page_texts: unhandled mime #{dfr.mime_type} for #{dfr.prefix_id}"
      end
    end
  end

  def effective_highlight_mode
    @highlight_mode_override || Checklist.highlight_modes[checklist.highlight_mode]
  end

  # Merge template checklist rules with custom rules from all envelope revisions,
  # then rewrite any #file / file:<id> markers to canonical file:<dfrev_prefix_id>
  # tokens by reading ref_files pins directly (no cache).
  def build_merged_rules
    merged = self.class.preview_merged_rules(envelope_revision, checklist)
    rewrite_ref_file_markers_in_rules!(merged)
    merged
  end

  # Plain merge of template + envelope rules, no enrichment overlay. The
  # controller uses this pre-report-creation to scan for #file / file:<id>
  # markers so it can create RefFile pins on the envelope_revision
  # before the Report itself is enqueued. Intentionally free of instance
  # state so it can be called without instantiating the service.
  def self.preview_merged_rules(envelope_revision, checklist)
    template_rules = Array(checklist.rules).map do |rule|
      r = rule.is_a?(Hash) ? rule.deep_dup : rule.as_json
      r = r.to_h.symbolize_keys
      r[:origin] ||= "checklist"
      r[:source_rule_id] = r[:id]
      r
    end

    revision_rules = envelope_revision.all_revision_rules.map.with_index do |rule, idx|
      r = rule.is_a?(Hash) ? rule.deep_dup : rule.as_json
      r = r.to_h.symbolize_keys
      r[:origin] = "user"
      r[:order] = template_rules.length + idx
      r
    end

    template_rules + revision_rules
  end

  # Rewrite #file / file:<id> markers in the merged rules to canonical
  # file:<dfrev_prefix_id> tokens using ref_files pins on the
  # envelope_revision. No cache — computed fresh from the DB.
  def rewrite_ref_file_markers_in_rules!(merged)
    pins_by_rule = load_ref_file_pins_grouped
    return if pins_by_rule.empty?

    merged.each do |rule|
      rule_id = (rule[:id] || rule["id"]).to_s
      prompt = rule[:prompt] || rule["prompt"]
      next unless prompt && RuleFileResolver.has_marker?(prompt)

      revisions = build_position_aligned_revisions(prompt, pins_by_rule[rule_id])
      result = RuleFileResolver.rewrite_with_refs([{
        scope_key: rule_id, prompt: prompt, revisions: revisions
      }])
      rule[:prompt] = result.entries.first&.rewritten_prompt || prompt if result.success?
    end
  end

  # Rewrite system_prompt markers from ref_files pins (checklist-scoped
  # pins where rule_id IS NULL).
  def resolve_system_prompt_with_ref_files
    pins = load_ref_file_pins_grouped[:checklist] || []
    return nil if pins.empty?

    prompt = checklist.system_prompt
    return nil unless prompt.present? && RuleFileResolver.has_marker?(prompt)

    revisions = build_position_aligned_revisions(prompt, pins)
    result = RuleFileResolver.rewrite_with_refs([{
      scope_key: RuleFileResolver::CHECKLIST_SYSTEM_PROMPT_RULE_ID,
      prompt: prompt, revisions: revisions
    }])
    result.success? ? result.entries.first&.rewritten_prompt : nil
  end

  # Build a revisions array aligned with the marker positions found in
  # `prompt`. Each pin fills the slot at its `pin.position` index; missing
  # positions stay `nil` so RuleFileResolver.rewrite_with_refs can leave
  # those markers as raw `#ref[...]` text (user skipped that slot). Extra
  # pins past the last marker are dropped defensively — shouldn't happen
  # in practice since the controller validates position against marker
  # count, but we don't want to crash if the checklist was edited to
  # remove a marker after the pin was created.
  def build_position_aligned_revisions(prompt, pins)
    marker_count = RuleFileResolver.scan_markers(prompt).length
    out = Array.new(marker_count)
    Array(pins).each do |pin|
      next if pin.position.nil? || pin.position >= marker_count
      out[pin.position] = pin.document_file_revision
    end
    out
  end

  # Build the top-level `ref_files` array sent to doc-api. One entry per
  # pinned DocumentFileRevision on the envelope_revision, carrying the
  # extracted text content. Computed fresh from the DB — no enriched_rules
  # cache. The doc-api service substitutes file:<dfrev_prefix_id> tokens with this.
  def build_revdoku_doc_api_ref_files
    pins = envelope_revision.ref_files.includes(:document_file_revision).order(:position)
    return [] if pins.empty?

    pins.each_with_index.map do |pin, idx|
      revision = pin.document_file_revision
      next nil unless revision

      file_index = idx + 1
      {
        document_file_revision_id: revision.prefix_id,
        rule_id: pin.rule_id,
        mime_type: revision.mime_type,
        description: revision.name,
        content: build_ref_file_content(revision, file_index),
        file_index: file_index
      }
    end.compact
  end

  # Render the reference file's extracted text with per-page wrappers so the
  # AI can cite a zero-indexed page number alongside a referenced value
  # (stored back on `check.data.ref_page`). Falls back to a single unmarked
  # page when page_texts isn't structured per page.
  def build_ref_file_content(revision, file_index)
    pages = Array(revision.page_texts)
    return "" if pages.empty?

    pages.each_with_index.map do |p, pi|
      text = (p["text"] || p[:text]).to_s
      "[REFERENCE #file_#{file_index} page=#{pi}]\n#{text}\n[END OF REFERENCE PAGE]"
    end.join("\n\n")
  end

  # Resolve ad-hoc reference files stored on the report's inspection_context
  # into loaded DocumentFileRevision + label pairs. The controller already
  # validated account ownership and cloned library files into this
  # envelope, so here we just re-fetch by prefix_id.
  #
  # Returns: Array<{ revision: DocumentFileRevision, label: String }>
  def build_ad_hoc_ref_file_entries
    report = current_report
    return [] unless report

    entries = Array(report.inspection_context&.dig("ad_hoc_ref_files"))
    return [] if entries.empty?

    entries.filter_map do |e|
      dfrev_id = (e["document_file_revision_id"] || e[:document_file_revision_id]).to_s
      next nil if dfrev_id.blank?
      revision = DocumentFileRevision.find_by_prefix_id(dfrev_id)
      next nil unless revision
      label = (e["label"] || e[:label]).to_s
      label = revision.name if label.empty?
      { revision: revision, label: label }
    end
  end

  # Append synthetic `#ref[file:<dfrev>|<label>]` markers to the
  # checklist's system_prompt for each ad-hoc reference file. The doc-api service's
  # token substitutor handles these uniformly with checklist-requested
  # markers — no special code path needed.
  #
  # The preamble text lives in `config/prompts/ad_hoc_ref_preamble.md`
  # as a partial so prompt content is edited in a .md file, not inlined
  # in Ruby strings. Loaded once per process via `AD_HOC_REF_PREAMBLE`.
  def append_ad_hoc_ref_markers(prompt, ad_hoc_entries)
    return prompt if ad_hoc_entries.empty?
    lines = ad_hoc_entries.map do |entry|
      # Safe-label: scrub `]` and `|` so the marker stays well-formed.
      safe_label = entry[:label].to_s.gsub(/[\]\|]/, " ").strip.presence || "Reference"
      "#ref[file:#{entry[:revision].prefix_id}|#{safe_label}]"
    end
    [prompt.to_s, "", AD_HOC_REF_PREAMBLE, *lines].reject(&:empty?).join("\n").strip
  end

  # Prompt partial loaded from disk at boot. Mirrors doc-api's approach
  # of keeping prompt text in `.md` files — lets us iterate on wording
  # without code edits, and keeps prompt content out of Ruby heredocs
  # where it'd be hard to diff across revisions.
  AD_HOC_REF_PREAMBLE = File.read(
    Rails.root.join("config", "prompts", "ad_hoc_ref_preamble.md")
  ).strip.freeze

  # Build doc-api ref_files entries for the ad-hoc attachments. File
  # indices continue numbering after any checklist-pinned ref files so
  # doc-api's #file_N anchors stay unique.
  def build_revdoku_doc_api_ad_hoc_ref_files(ad_hoc_entries)
    return [] if ad_hoc_entries.empty?
    pinned_count = envelope_revision.ref_files.count
    ad_hoc_entries.each_with_index.map do |entry, idx|
      revision = entry[:revision]
      file_index = pinned_count + idx + 1
      {
        document_file_revision_id: revision.prefix_id,
        rule_id: nil,
        mime_type: revision.mime_type,
        description: entry[:label],
        content: build_ref_file_content(revision, file_index),
        file_index: file_index
      }
    end
  end

  # Load ref_file pins from the envelope_revision, grouped by scope.
  # Rule-scoped pins are keyed by rule_id string; checklist-scoped pins
  # (rule_id NULL) are under :checklist.
  def load_ref_file_pins_grouped
    @_ref_file_pins_grouped ||= begin
      pins = envelope_revision.ref_files.includes(:document_file_revision).order(:position)
      grouped = pins.group_by { |p| p.rule_id.nil? ? :checklist : p.rule_id }
      grouped
    end
  end

  def compute_inspection_date_display
    tz = ActiveSupport::TimeZone[@timezone] || ActiveSupport::TimeZone["UTC"]
    local_time = Time.current.in_time_zone(tz)
    iso = local_time.iso8601
    human = local_time.strftime("%A, %B %-d, %Y")
    "#{iso} (#{human}, #{@timezone})"
  end

  # Cumulative page-count offsets for each file revision in order.
  # Reads file_page_counts from the doc-api response when present (authoritative),
  # falling back to cheaper sources first and only hitting the rendered-pages
  # cache (ActiveStorage blob download) as a last resort.
  def compute_file_offsets(file_revs, file_page_counts)
    offsets = []
    running = 0
    file_revs.each do |rev|
      offsets << running
      count = file_page_counts[rev.prefix_id] || file_page_counts[rev.prefix_id.to_s]
      count = count.to_i if count
      if count.nil? || count <= 0
        # Fallback chain, cheapest first:
        #   1. existing per-file layout (just parses a text column)
        #   2. metadata_hash["page_count"] (same — text column)
        #   3. rendered-pages cache (LAST — downloads a multi-MB ActiveStorage blob)
        layout_keys = rev.page_coordinate_spaces
        count = layout_keys.any? ? layout_keys.keys.map(&:to_i).max.to_i + 1 : 0
        count = rev.metadata_hash["page_count"].to_i if count <= 0
        if count <= 0
          cached = RenderedPagesCache.fetch_pages_by_index(rev)
          count = cached.keys.map(&:to_i).max.to_i + 1 if cached.is_a?(Hash) && cached.any?
        end
      end
      running += count
    end
    offsets
  end

  # Given sorted offsets and a document-relative 0-based page index, return
  # the index into file_revs array that owns that page, or nil.
  def file_index_for_offset(offsets, doc_idx)
    return nil if doc_idx < 0
    # offsets are start indices of each file; file i owns [offsets[i], offsets[i+1])
    (offsets.length - 1).downto(0) do |i|
      return i if doc_idx >= offsets[i]
    end
    nil
  end

  # Build the immutable inspection_context JSON frozen at inspection time.
  def build_inspection_context
    # The merged rules already carry the rewritten `file:<dfrev_prefix_id>`
    # tokens (Rails normalizes markers to the canonical form; doc-api does
    # the final content substitution). No base64 image data is ever
    # attached to a rule, so the frozen snapshot stays small.
    frozen_rules = @merged_rules.map do |r|
      r.is_a?(Hash) ? r.stringify_keys : r
    end

    # system_prompt gets the same marker rewrite as rules, so the snapshot
    # captures the pinned-file references (`#ref[file:dfrev_xxx|label]`)
    # that the user actually saw the AI run against. Falls back to the
    # raw prompt when the checklist has no system-prompt markers or no
    # pins are set up yet.
    frozen_system_prompt = resolve_system_prompt_with_ref_files || checklist.system_prompt

    ctx = {
      checklist: {
        id: checklist.prefix_id,
        name: checklist.name,
        system_prompt: frozen_system_prompt,
        ai_model: checklist.ai_model,
        track_changes: track_changes_active?,
        highlight_mode: effective_highlight_mode,
        rules: frozen_rules
      },
      previous_checks: @previous_checks_snapshot,
      ai_model_resolved: @resolved_model_config[:alias_id],
      page_count: envelope_revision.page_count,
      inspected_at: Time.current.iso8601
    }
    # Freeze the checklist's user_scripts into the inspection snapshot so the
    # report is self-contained — if the envelope/checklist scripts are later
    # edited, the report still records what actually ran.
    ctx[:user_scripts] = checklist.user_scripts if checklist.user_scripts.present?

    # Preserve per-inspection user input written by the controller at
    # report creation (reports_controller#process_report_asynchronously).
    # These keys are user-supplied, not derived from checklist/AI output,
    # so they must survive the finalization write that happens through
    # this method — without it, ad-hoc ref files + the review note
    # silently disappear once the job completes.
    preserved = current_report&.inspection_context || {}
    %w[ad_hoc_ref_files review_note].each do |k|
      ctx[k.to_sym] = preserved[k] if preserved.key?(k)
    end

    ctx
  end

  def create_checks_from_json(report, checks_json, source: :ai)
    # Use the merged rules built during this inspection for rule lookups
    inspection_rules = @merged_rules || []

    checks_json.each do |check_data|
      rule_id = check_data["rule_id"].to_s

      # Step 1: Try to match against a known rule in the merged rules
      rule = inspection_rules.find do |r|
        r[:id] == rule_id || r["id"] == rule_id ||
          r[:source_rule_id] == rule_id || r["source_rule_id"] == rule_id
      end

      if rule
        # Normalize rule_id to the rule's own ID
        rule_id = (rule[:id] || rule["id"])

      # Step 2: Accept catch-changes checks (synthetic change detection rule from doc-api)
      elsif rule_id == "catch-changes"
        unless track_changes_active?
          Rails.logger.warn "Received catch-changes check but track_changes is not active — accepting anyway"
        end

      # Step 3: Everything else → catch-all bucket (never lose a check)
      else
        Rails.logger.warn "No rule found for rule_id #{check_data['rule_id']} in merged rules — assigning to catch-all"
        rule_id = "catch-all"
      end

      Rails.logger.debug "Creating check for rule #{check_data['rule_id']}, passed=#{check_data['passed']}"

      # Resolve #file_N citation tokens in the description to stable
      # #file:<dfrev_prefix_id> identifiers. The AI outputs short tokens
      # (#file_1, #file_2); Rails resolves them here using the
      # enriched_rules.__references__ mapping. doc-api never touches
      # real prefix IDs — consistent with the rule-ID simplification
      # pattern (replaceValuesToSimplified / restoreValuesFromSimplified).
      raw_description = check_data["description"].presence || check_data["rule_prompt"].presence || "Issue detected"
      resolved_description = resolve_file_citations_in_description(raw_description, report)

      check_attrs = {
        passed: check_data["passed"],
        description: resolved_description,
        page: check_data["page"],
        x1: check_data["x1"],
        y1: check_data["y1"],
        x2: check_data["x2"],
        y2: check_data["y2"],
        report: report,
        rule_key: rule_id,
        check_index: check_data["check_index"],
        source: source,
        account: report.account,
        description_position_json: check_data["description_position"]&.to_json,
        data: check_data["data"].present? ? check_data["data"].to_json : nil
      }

      Rails.logger.debug "Check created for rule_key=#{check_attrs[:rule_key]}, passed=#{check_attrs[:passed]}, page=#{check_attrs[:page]}"
      report.checks.create!(check_attrs)
    end
  end

  # Resolve AI-emitted citation tokens into the canonical `#ref[file:<id>]`
  # form so descriptions use the same marker syntax as checklist prompts.
  #
  #   - `#file_N`              (positional from AI) → `#ref[file:<dfrev>]`
  #   - `#file:<dfrev_id>`     (stable, from older AI outputs or manual
  #                             edits) → `#ref[file:<dfrev_id>]`
  #
  # Uses the ref_files pins on the envelope_revision for the positional
  # lookup. doc-api never handles real prefix IDs directly.
  def resolve_file_citations_in_description(description, _report)
    return description if description.blank?

    pins = envelope_revision.ref_files.includes(:document_file_revision).order(:position)
    index_to_id = {}
    pins.each_with_index do |pin, idx|
      index_to_id[idx + 1] = pin.document_file_revision.prefix_id
    end

    # Ad-hoc ref files continue the positional numbering after pinned
    # files — same ordering as build_revdoku_doc_api_ad_hoc_ref_files so the AI's
    # #file_N tokens resolve to the right dfrev id.
    ad_hoc_entries = build_ad_hoc_ref_file_entries
    ad_hoc_entries.each_with_index do |entry, idx|
      index_to_id[pins.size + idx + 1] = entry[:revision].prefix_id
    end

    resolved = description.to_s.dup
    # 1. Positional: `#file_N` → `#ref[file:<dfrev>]`
    resolved = resolved.gsub(/#file_(\d+)/) do |match|
      idx = $1.to_i
      dfrev_id = index_to_id[idx]
      dfrev_id ? "#ref[file:#{dfrev_id}]" : match
    end
    # 2. Promote any remaining bare `#file:<dfrev_id>` citations to the
    #    canonical `#ref[file:<dfrev_id>]` form.
    resolved = resolved.gsub(/(?<!\[)#file:(dfrev_[A-Za-z0-9]+)/) do |_match|
      "#ref[file:#{$1}]"
    end
    resolved
  end

  def serialize_document_file_revisions(document_file_revisions)
    # Always send the raw PDF data so doc-api can render any pages not in the cache.
    # Send a NARROWED sparse cached hash (file-relative 0-based keys) containing only the
    # pages doc-api actually needs for this batch:
    #   - the pages in the current batch range (so doc-api can skip re-rendering them)
    #   - index "0" (so doc-api can regenerate the per-file thumbnail from the cached first
    #     page instead of rendering it fresh)
    #
    # Without this narrowing, every batch re-ships the entire accumulated cache — by the
    # last batch of a 150-page review that's ~148 cached pages (several MB of base64 JPEGs)
    # re-sent on every request, wasting Rails→doc-api bandwidth and ballooning doc-api
    # memory as it parses and holds the full cache per request.
    #
    # Narrowing only applies to single-file envelopes (the common case). Multi-file
    # envelopes would need per-file offsets to map absolute batch indices to file-relative
    # indices; we fall back to the full cache there.
    single_file = document_file_revisions.size == 1
    batch_indices = (single_file && @pages.present?) ? parse_batch_pages(@pages) : nil
    needed_keys = nil
    if batch_indices
      needed_keys = batch_indices.map(&:to_s).to_set
      needed_keys << "0" # always include page 0 so doc-api can source the thumbnail from cache
    end

    document_file_revisions.map do |file_revision|
      serialized = change_id_to_prefix_in_object(file_revision)
      serialized[:data] = file_revision.to_base64
      cached_hash = RenderedPagesCache.fetch_pages_by_index(file_revision)
      if cached_hash.present?
        narrowed = needed_keys ? cached_hash.slice(*needed_keys) : cached_hash
        serialized[:cached_pages_by_index] = narrowed if narrowed.present?
      end
      serialized
    end
  end

  def serialize_checks(checks)
    checks.map do |c|
      change_id_to_prefix_in_object(c)
    end
  end

  def serialize_rules(rules)
    rules.map do |r|
      if r.is_a?(Hash)
        rule_id = r[:id] || r["id"]
        rule_prompt = r[:prompt] || r["prompt"]
        rule_order = r[:order] || r["order"]
        rule_origin = r[:origin] || r["origin"]
        source_envelope_revision_id = r[:source_envelope_revision_id] || r["source_envelope_revision_id"]

        if rule_id.nil? || rule_id.to_s.empty?
          Rails.logger.error "Found rule with empty ID"
          raise StandardError, "Rule must have an ID"
        end

        source_rule_id = r[:source_rule_id] || r["source_rule_id"]

        {
          id: rule_id,
          prompt: rule_prompt,
          order: rule_order,
          origin: rule_origin,
          source_rule_id: source_rule_id,
          source_envelope_revision_id: source_envelope_revision_id
        }.compact
      else
        r
      end
    end
  end

  # Note: serialize_checklist is no longer needed — doc-api receives the
  # virtual checklist hash built in build_revdoku_doc_api_request directly.

  # Helper method to change internal IDs to prefix IDs in objects
  # Uses as_json for encryption-aware serialization (no ciphertext leaks)
  def change_id_to_prefix_in_object(record)
    attributes = record.as_json
    attributes["id"] = record.prefix_id if record.respond_to?(:prefix_id)
    attributes.except("created_at", "updated_at").transform_keys(&:to_sym)
  end

end
