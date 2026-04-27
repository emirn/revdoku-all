# frozen_string_literal: true

class CreateReportJob < ApplicationJob
  class InspectionTimeoutError < StandardError; end
  class NonRetryableAIError < StandardError; end

  INSPECTION_TIMEOUT_SECONDS = ENV.fetch("INSPECTION_TIMEOUT_SECONDS", 738).to_i
  MAX_CHECKS_FROM_PREVIOUS_BATCHES = 250
  MAX_PREVIOUS_PAGES_TO_INCLUDE = 5
  DEFAULT_BATCH_PAGE_SIZE = 100

  queue_as :default

  retry_on StandardError, wait: :polynomially_longer, attempts: 2
  discard_on ActiveRecord::RecordNotFound
  discard_on ActiveRecord::InvalidForeignKey
  discard_on NonRetryableAIError
  # Note: InspectionTimeoutError is handled explicitly in the rescue block (not discarded)
  # so that credits can be refunded and report status updated to :failed.

  def perform(placeholder_report_id, envelope_revision_id, checklist_id, user_id: nil, debug_options: nil, timezone: nil, skip_previous_checks: false, ai_model_override: nil, track_changes_override: nil, highlight_mode_override: nil, max_affordable_pages: nil)
    Rails.logger.info "CreateReportJob started for placeholder report: #{placeholder_report_id}"

    user = user_id ? User.find_by(id: user_id) : nil

    job_logic = -> {
      # Find the placeholder report by prefix_id
      placeholder_report = Report.find_by_prefix_id!(placeholder_report_id)

      # Check if report was cancelled before we started processing
      if placeholder_report.job_status_cancelled?
        Rails.logger.info "CreateReportJob: Report #{placeholder_report_id} was cancelled, exiting early"
        return
      end

      # Guard: if another job already completed this report, don't re-process
      if placeholder_report.job_status_completed?
        Rails.logger.info "CreateReportJob: Report #{placeholder_report_id} already completed, exiting"
        return
      end

      # Update status to processing and claim ownership. Resume flows null out
      # job_id in the controller so any still-winding-down prior job will see
      # job_id != self and skip its ensure-block finalization. We install our
      # own job_id here so subsequent ownership checks (loop header and
      # adjust_credits) correctly identify this job as the current owner.
      placeholder_report.update!(job_status: :processing, job_id: job_id)

      # Find envelope revision and checklist
      envelope_revision = EnvelopeRevision.find_by_prefix_id!(envelope_revision_id)
      checklist = Checklist.find_by_prefix_id!(checklist_id)

      # Phase 0: Wait for any pinned reference files to finish their
      # background normalization (OCR for PDFs / images). The upload
      # path enqueues NormalizeDocumentFileRevisionJob async so the
      # user can click Run Review immediately; we block here until
      # every referenced revision is ready, updating report.meta with
      # live progress so the inspection overlay can render a
      # "Preparing reference files..." phase.
      wait_for_ref_files_ready!(placeholder_report, envelope_revision)

      # No enrichment cache step — ReportCreationService computes marker
      # rewrites and reference file content on-the-fly from ref_files pins.

      # Use the service to create the complete report
      service = ReportCreationService.new(envelope_revision, checklist, debug_options: debug_options, timezone: timezone, skip_previous_checks: skip_previous_checks, expected_job_id: job_id, ai_model_override: ai_model_override, track_changes_override: track_changes_override, highlight_mode_override: highlight_mode_override, max_affordable_pages: max_affordable_pages)

      # Determine batch page size from model config
      ai_model = ai_model_override.presence || checklist.ai_model.presence || AiModelResolver.default_model_id(:inspection)
      batch_page_size = resolve_batch_page_size(ai_model, account: envelope_revision.account)

      # Single unified path: everything goes through the batch loop.
      # Small docs complete in 1 iteration, large docs iterate. First batch discovers
      # total_page_count from doc-api when envelope_revision.page_count is 0 (unknown).
      run_inspection_loop(
        placeholder_report, envelope_revision, checklist,
        service: service, user: user,
        batch_page_size: batch_page_size,
        total_pages: envelope_revision.page_count,
        max_affordable_pages: max_affordable_pages,
        ai_model_alias: ai_model
      )
    }

    if user
      Principal.set(user: user) { job_logic.call }
    else
      job_logic.call
    end
  rescue InspectionTimeoutError => e
    Rails.logger.error "CreateReportJob timed out for report: #{placeholder_report_id}"
    handle_job_failure(placeholder_report_id, e, user_id: user_id)
  rescue NonRetryableAIError => e
    Rails.logger.error "CreateReportJob non-retryable AI error for report: #{placeholder_report_id}, error: #{e.message}"
    handle_job_failure(placeholder_report_id, e, user_id: user_id)
  rescue => e
    Rails.logger.error "CreateReportJob failed with exception for report: #{placeholder_report_id}, error: #{e.message}"
    handle_job_failure(placeholder_report_id, e, user_id: user_id)
    raise e # re-raise for retry_on
  end

  private

  # How long to wait for reference-file normalization to finish before
  # aborting the review. PDF OCR via Gemini Lite typically finishes in
  # under a minute per 100 pages; 5 minutes is a generous ceiling.
  REFERENCE_FILE_WAIT_MAX_SECONDS = 300
  REFERENCE_FILE_WAIT_POLL_SECONDS = 1.0

  # Block until every RefFile pinned on the envelope_revision AND every
  # ad-hoc ref file attached via the Review dialog has a ready
  # DocumentFileRevision (raw file attached + normalized content
  # cached). Writes live progress to report.meta so the frontend
  # inspection overlay can show a "Preparing reference files (1/3)"
  # phase instead of a silent wait. Ad-hoc files must be included —
  # otherwise doc-api sees empty `content` for them and the AI cites by
  # id but the inspector never actually read the file.
  def wait_for_ref_files_ready!(report, envelope_revision)
    pinned_revs = envelope_revision.ref_files.includes(:document_file_revision).map(&:document_file_revision)
    ad_hoc_revs = load_ad_hoc_ref_revisions(report)

    # Dedupe by id (same revision could in theory be both pinned and ad-hoc).
    revisions = (pinned_revs + ad_hoc_revs).uniq { |r| r.id }
    return if revisions.empty?

    total = revisions.length
    start = Time.current
    retrigger_at = 30 # seconds — re-enqueue normalize if still not ready

    loop do
      ready = revisions.count(&:ready?)
      update_report_phase(report, phase: "preparing_references", ready: ready, total: total)

      return if ready == total

      elapsed = Time.current - start

      if elapsed > REFERENCE_FILE_WAIT_MAX_SECONDS
        raise NonRetryableAIError,
          "reference file normalization timed out after #{REFERENCE_FILE_WAIT_MAX_SECONDS}s " \
          "(#{ready}/#{total} ready)"
      end

      # Re-enqueue normalize jobs for stuck revisions. Handles the case
      # where the original job failed silently or the queue was backed up.
      if elapsed > retrigger_at
        revisions.each do |rev|
          next if rev.ready?
          Rails.logger.warn "CreateReportJob: re-triggering normalization for #{rev.prefix_id} (stuck after #{elapsed.round}s)"
          NormalizeDocumentFileRevisionJob.perform_later(rev.prefix_id)
        end
        retrigger_at += 60 # don't retrigger again for another minute
      end

      sleep REFERENCE_FILE_WAIT_POLL_SECONDS
      revisions.each(&:reload)
    end
  ensure
    # Clear the phase marker once we're either ready to proceed or
    # bubbling up an error. The inspection loop sets its own phase.
    update_report_phase(report, phase: nil, ready: nil, total: nil)
  end

  # Load DocumentFileRevision objects for the ad-hoc ref files stored on
  # this report's inspection_context. Silently skips entries whose
  # revision has been deleted (shouldn't happen in practice, but we
  # don't want Phase 0 to crash on a stale pointer).
  def load_ad_hoc_ref_revisions(report)
    ctx = report.inspection_context || {}
    Array(ctx["ad_hoc_ref_files"]).filter_map do |entry|
      dfrev_id = (entry["document_file_revision_id"] || entry[:document_file_revision_id]).to_s
      next nil if dfrev_id.blank?
      DocumentFileRevision.find_by_prefix_id(dfrev_id)
    end
  end

  # Update the report's meta JSON with a small "preparing phase" hint
  # the frontend overlay reads. Non-destructive — merges into whatever
  # else is in meta.
  def update_report_phase(report, phase:, ready:, total:)
    current = report.meta.is_a?(Hash) ? report.meta.dup : {}
    if phase.nil?
      current.delete("phase")
      current.delete("phase_ready")
      current.delete("phase_total")
    else
      current["phase"] = phase
      current["phase_ready"] = ready
      current["phase_total"] = total
    end
    report.update_columns(meta: current.to_json, updated_at: Time.current)
  end

  def run_inspection_loop(placeholder_report, envelope_revision, checklist, service:, user:, batch_page_size:, total_pages:, max_affordable_pages:, ai_model_alias:)
    service.batch_file_context = service.build_batch_file_context

    page_offset = 0
    batch_num = 0
    total_pages_processed = 0
    current_job_checks = []
    current_job_page_texts = []
    last_ai_model = nil
    remaining_affordable = max_affordable_pages # may be nil (unlimited)
    # total_pages may be 0 on first run (unknown until doc-api reports it after batch 1).
    # All break/range computations below guard on `total_pages > 0`.
    estimated_batches = total_pages > 0 ? (total_pages.to_f / batch_page_size).ceil : 1

    # Check for resume state (flat meta schema: meta.resume + meta.page_offset)
    is_resume = placeholder_report.meta.is_a?(Hash) && placeholder_report.meta["resume"] == true
    saved_offset = placeholder_report.meta.is_a?(Hash) && placeholder_report.meta["page_offset"]
    if is_resume && saved_offset.to_i > 0 && (total_pages == 0 || saved_offset.to_i < total_pages)
      page_offset = saved_offset.to_i
      current_job_checks = placeholder_report.checks.where(source: :ai).map { |c|
        { page: c.page, passed: c.passed, description: c.description, rule_key: c.rule_key }
      }
      Rails.logger.info "CreateReportJob: resuming from page_offset=#{page_offset}"
    end

    # Clean restart safety: if not resuming and stale AI checks exist from a prior
    # partial run (e.g. job retry after crash), clear them to prevent duplicates.
    # Also clear per-DFR pages_layout_json + page_texts so stale page_statuses from
    # a previous run don't show "pages X-Y not reviewed" banners after a fresh start.
    if page_offset == 0
      stale_ai_checks = placeholder_report.checks.where(source: :ai)
      if stale_ai_checks.any?
        Rails.logger.info "CreateReportJob: clearing #{stale_ai_checks.count} stale AI checks from prior partial run"
        stale_ai_checks.destroy_all
      end
      envelope_revision.ordered_document_file_revisions.each do |rev|
        rev.update_columns(pages_layout_json: nil, page_texts_ciphertext: nil)
      end
      placeholder_report.reset_layout_cache!
    end

    Rails.logger.info "CreateReportJob: starting batch loop total_pages=#{total_pages}, batch_size=#{batch_page_size}, estimated_batches=#{estimated_batches}"

    # Rendered pages are flushed to RenderedPagesCache + PageThumbnails
    # synchronously inside this job after each successful batch (see call to
    # ReportCreationService.flush_rendered_pages_to_cache below). We used to fire
    # a separate async CacheRenderedPagesJob per batch, which produced queue-DB
    # enqueue floods + parallel ActiveStorage purge+attach transactions that
    # tripped SQLite's 5s busy_timeout. Running the flush inline keeps memory
    # bounded to the current batch (~100KB), writes serially (no lock contention
    # between parallel cache jobs), and still fills the cache progressively so a
    # cancelled run retains the pages from completed batches.

    begin
      loop do
        # Check cancellation
        placeholder_report.reload
        unless placeholder_report.job_status_processing? && placeholder_report.job_id == job_id
          Rails.logger.info "CreateReportJob: report no longer owned by this job, stopping batch loop"
          break
        end

        # Guarded: only break when total is known (first iteration runs even when total_pages=0)
        break if total_pages > 0 && page_offset >= total_pages

        # Budget check
        if remaining_affordable && remaining_affordable <= 0
          Rails.logger.info "CreateReportJob: budget exhausted at page_offset=#{page_offset}"
          break
        end

        # Compute batch range — open-ended upper bound when total is unknown
        effective_batch_size = batch_page_size
        effective_batch_size = [effective_batch_size, remaining_affordable].min if remaining_affordable
        batch_end = total_pages > 0 ? [page_offset + effective_batch_size, total_pages].min : (page_offset + effective_batch_size)
        pages_str = "#{page_offset + 1}-#{batch_end}"
        batch_num += 1

        # Update progress meta
        update_batch_progress(placeholder_report, page_offset, total_pages, batch_num, estimated_batches, batch_page_size, ai_model_alias)

        Rails.logger.info "CreateReportJob: batch #{batch_num} pages #{pages_str} (offset=#{page_offset}, total=#{total_pages > 0 ? total_pages : '?'})"

        result = Timeout.timeout(INSPECTION_TIMEOUT_SECONDS, InspectionTimeoutError) {
          service.call_batch(
            pages: pages_str,
            page_offset: page_offset,
            current_job_checks: current_job_checks.last(MAX_CHECKS_FROM_PREVIOUS_BATCHES),
            current_job_page_texts: current_job_page_texts.last(MAX_PREVIOUS_PAGES_TO_INCLUDE)
          )
        }

        unless result[:success]
          Rails.logger.error "CreateReportJob: batch #{batch_num} failed: #{result[:message]}"
          placeholder_report.update!(job_status: :failed, error_message: result[:message])
          if non_transient_ai_error?(result[:message])
            raise NonRetryableAIError, result[:message]
          end
          raise StandardError, result[:message]
        end

        pages_in_batch = result[:pages_processed].to_i
        pages_in_batch = batch_end - page_offset if pages_in_batch == 0

        # Discover total_page_count from first batch response and persist to envelope_revision
        # so subsequent reviews skip the discovery round-trip.
        if total_pages == 0 && result[:total_page_count].to_i > 0
          total_pages = result[:total_page_count].to_i
          envelope_revision.update_column(:page_count, total_pages)
          estimated_batches = (total_pages.to_f / batch_page_size).ceil
          Rails.logger.info "CreateReportJob: discovered total_page_count=#{total_pages}"
        end

        total_pages_processed += pages_in_batch
        remaining_affordable -= pages_in_batch if remaining_affordable

        # Append checks from this batch
        revdoku_doc_api_report = result[:report]
        if revdoku_doc_api_report
          last_ai_model = revdoku_doc_api_report["ai_model"] if revdoku_doc_api_report["ai_model"].present?
          service.append_batch_checks(placeholder_report, revdoku_doc_api_report)
          service.merge_batch_page_layout(placeholder_report, result)
          # Split page_texts per-DFR (file-relative) using file_page_counts.
          file_page_counts = result[:file_page_counts] || result["file_page_counts"] || {}
          service.write_batch_page_texts(revdoku_doc_api_report, file_page_counts)

          # Accumulate context for next batch
          new_checks = (revdoku_doc_api_report["checks"] || []).map { |c|
            { page: c["page"], passed: c["passed"], description: c["description"], rule_key: c["rule_id"] }
          }
          current_job_checks.concat(new_checks)

          # Accumulate page texts
          page_texts = revdoku_doc_api_report["page_texts"]
          if page_texts.is_a?(Array)
            current_job_page_texts.concat(page_texts)
          end
        end

        # Flush freshly rendered pages to the per-file cache SYNCHRONOUSLY in
        # this job's thread, right after each successful batch. Bounded memory
        # (only the current batch's ~100KB is held before flush), progressive
        # cache fill (a cancelled run retains completed batches' pages), and no
        # queue-DB enqueue churn (the old CacheRenderedPagesJob per-batch path
        # flooded Solid Queue and crashed workers with SQLite busy_timeout).
        if result[:rendered_files].is_a?(Array) && result[:rendered_files].any?
          ReportCreationService.flush_rendered_pages_to_cache(envelope_revision, result[:rendered_files])
        end

        page_offset += pages_in_batch

        # Defensive exit: if doc-api didn't return a total and didn't advance the offset,
        # break to avoid an infinite loop.
        break if total_pages == 0 && pages_in_batch == 0
      end
    ensure
      # ──────────────────────────────────────────────────────────────────────
      # ALWAYS run finalization, even on exceptions, cancellations, or early
      # exits. Without this, a mid-run cancel or InspectionTimeoutError leaves
      # the report with un-renumbered duplicate check indices (doc-api emits
      # per-batch 0..N labels that collide across batches) and unprocessed
      # pages with no status entry (so the "Continue review" banner can't tell
      # what's left to review).
      # ──────────────────────────────────────────────────────────────────────
      # Ownership check: only finalize if we still own the report. When a
      # cancel → resume sequence fires fast, the resume controller enqueues a
      # new CreateReportJob on another Solid Queue thread (config/queue.yml:
      # threads: 3) and nulls job_id on the report. If we no longer own the
      # row, skipping these writes avoids racing with the new job's startup
      # UPDATE and eliminates the SQLite3::BusyException seen in that path.
      begin
        placeholder_report.reload
        still_owns = placeholder_report.job_id.blank? || placeholder_report.job_id == job_id
      rescue => e
        Rails.logger.warn "CreateReportJob: ownership check failed in ensure: #{e.message}"
        still_owns = true # fail-open: attempt the finalization writes
      end

      if still_owns
        begin
          ReportCreationService.renumber_check_indices(placeholder_report)
        rescue => e
          Rails.logger.warn "CreateReportJob: renumber_check_indices failed in ensure: #{e.message}"
        end
        begin
          if total_pages > 0
            ReportCreationService.fill_cancelled_page_statuses(placeholder_report, page_offset, total_pages)
          end
        rescue => e
          Rails.logger.warn "CreateReportJob: fill_cancelled_page_statuses failed in ensure: #{e.message}"
        end
      else
        Rails.logger.info "CreateReportJob: skipping ensure-block finalization for #{placeholder_report.prefix_id} — report is owned by another job now"
      end
      # NOTE: rendered pages cache is flushed per-batch inline inside the loop
      # body, not here. No end-of-job flush needed — if the job dies mid-batch
      # we simply lose the uncompleted batch's pages (never had them persisted).
    end

    placeholder_report.reload
    if placeholder_report.job_status_processing? && placeholder_report.job_id == job_id
      # Reuse the service's report_update_attributes helper so batch finalization has
      # full parity with what the deleted single-batch path used to write
      # (ai_model, inspection_context). page_texts are written per-DFR inline
      # after each batch (see service.write_batch_page_texts). Meta is overridden
      # with the batch-specific structure from build_final_meta.
      synthetic_report = { "ai_model" => last_ai_model }
      base_attrs = service.report_update_attributes(synthetic_report)
      placeholder_report.update!(
        base_attrs.merge(
          meta: build_final_meta(placeholder_report, page_offset, total_pages, estimated_batches, batch_page_size, ai_model_alias)
        )
      )

      # Propagate checklist's user_scripts onto the envelope on successful completion.
      # The service guards against overwriting an envelope that already has user_scripts.
      # (The cancel controller applies the same copy when checks were created.)
      service.copy_checklist_scripts_to_envelope
    end

    final_report = placeholder_report
    Rails.logger.info "CreateReportJob: batch loop completed. #{batch_num} batches, #{total_pages_processed} pages processed"

    adjust_credits(placeholder_report, final_report, envelope_revision, total_pages_processed)
    post_inspection_tasks(final_report, envelope_revision, user)
  end

  def resolve_batch_page_size(ai_model_id, account: nil)
    # max_pages is a per-concrete-model attribute (the AI provider's per-request
    # page cap). When the caller hands us an alias id, resolve to its first-
    # available target and read max_pages from there; when it's a concrete id,
    # look it up directly. account: is threaded so user-defined custom-provider
    # ids (e.g. "::custom_llm_1:mymodel") resolve through Account#provider_models.
    # Falls back to DEFAULT_BATCH_PAGE_SIZE when neither resolves.
    resolved = if AiModelResolver.alias_id?(ai_model_id)
      AiModelResolver.resolve_alias(ai_model_id)
    else
      AiModelResolver.find_model(ai_model_id, account: account)
    end
    resolved&.dig(:max_pages) || DEFAULT_BATCH_PAGE_SIZE
  end

  # NOTE: renumber_check_indices and fill_cancelled_page_statuses moved to
  # ReportCreationService class methods so the cancel controller can call them too.

  # Flat meta schema (shared with the resume endpoint in reports_controller.rb).
  # Keys: pages_processed, total_pages, total_batches, batch_size, batch_number,
  #       page_offset, resume, core_model_id, resolved_at, callback_url.
  # callback_url is written by the controller before the job starts and must
  # survive every rewrite in here so the terminal-status callback can fire.
  def update_batch_progress(report, page_offset, total_pages, batch_num, estimated_batches, batch_page_size, ai_model_alias)
    meta = {
      "pages_processed" => page_offset,
      "total_pages" => total_pages,
      "total_batches" => estimated_batches,
      "batch_size" => batch_page_size,
      "batch_number" => batch_num,
      "page_offset" => page_offset,
      "resume" => false,
      "core_model_id" => ai_model_alias,
      "resolved_at" => Time.current.iso8601
    }
    existing = report.meta
    meta["callback_url"] = existing["callback_url"] if existing.is_a?(Hash) && existing["callback_url"].present?
    report.update_columns(meta: meta.to_json)
  rescue => e
    Rails.logger.warn "CreateReportJob: update_batch_progress failed: #{e.message}"
  end

  def build_final_meta(report, page_offset, total_pages, estimated_batches, batch_page_size, ai_model_alias)
    meta = {
      "pages_processed" => page_offset,
      "total_pages" => total_pages,
      "total_batches" => estimated_batches,
      "batch_size" => batch_page_size,
      "batch_number" => estimated_batches,
      "page_offset" => page_offset,
      "resume" => false,
      "core_model_id" => ai_model_alias,
      "resolved_at" => Time.current.iso8601
    }
    existing = report.meta
    meta["callback_url"] = existing["callback_url"] if existing.is_a?(Hash) && existing["callback_url"].present?
    meta
  end

  def adjust_credits(placeholder_report, final_report, envelope_revision, pages_processed)
    # Defense-in-depth: verify this job still owns the report before adjusting credits
    placeholder_report.reload
    if placeholder_report.job_id.present? && placeholder_report.job_id != job_id
      Rails.logger.info "CreateReportJob: Report #{placeholder_report.prefix_id} reassigned after save, skipping credit adjustment"
      return
    end

    begin
      page_count = if pages_processed.present? && pages_processed > 0
                      pages_processed
                    elsif envelope_revision.page_count > 0
                      envelope_revision.page_count
                    else
                      1
                    end
    rescue => credit_error
      Rails.logger.error "CreateReportJob: credit adjustment failed for report #{final_report.prefix_id}: #{credit_error.message}"
    end
  end

  def post_inspection_tasks(final_report, envelope_revision, user)
    # Ownership guard — if another job already took over this report (double
    # enqueue → second job updated job_id after we started), skip everything
    # here. Running post-inspection tasks in the losing job otherwise
    # double-tags the envelope AND sends a spurious "report_failed"
    # notification while the winning job is still processing.
    final_report.reload
    if final_report.job_id.present? && final_report.job_id != job_id
      Rails.logger.info "CreateReportJob: Report #{final_report.prefix_id} reassigned, skipping post-inspection tasks"
      return
    end

    # Copy reference files flagged "Save to Library" from the envelope
    # into the account library. Runs after review completion so the file
    # is fully normalized (page_texts, rendered_pages_cache populated).
    begin
      copy_ref_files_to_library(envelope_revision)
    rescue => e
      Rails.logger.error "CreateReportJob: copy to library failed: #{e.message}"
    end

    # Auto-tag the envelope based on the checklist used
    begin
      AutoTagger.tag_from_report(envelope_revision.envelope, final_report)
    rescue => tag_error
      Rails.logger.error "CreateReportJob: auto-tagging failed for report #{final_report.prefix_id}: #{tag_error.message}"
    end

    # Notify user that report is ready
    begin
      NotificationService.report_finished!(final_report, user)
    rescue => e
      Rails.logger.error "CreateReportJob: notification failed: #{e.message}"
    end

    # Fire webhook callback (Zapier and friends) if configured. Only fires on
    # actual completion — failure/cancellation paths fire their own callbacks
    # from handle_job_failure / the cancel controller.
    enqueue_terminal_callback(final_report, "completed") if final_report.job_status_completed?
  end

  # After review, copy each envelope-scoped reference file flagged with
  # `save_to_library: true` into the account library. Shares the same
  # ActiveStorage blob (no byte duplication) and copies all normalized
  # content.
  def copy_ref_files_to_library(envelope_revision)
    pins = envelope_revision.ref_files.where(save_to_library: true).includes(:document_file_revision)
    pins.each do |pin|
      source = pin.document_file_revision
      next unless source

      # Skip if already in library (shouldn't happen, but defensive)
      next if source.document_file.library?

      lib_file = DocumentFile.create!(
        account_id: envelope_revision.account_id,
        envelope: nil,
        reference: true
      )
      lib_rev = DocumentFileRevision.new(
        document_file: lib_file,
        account_id: envelope_revision.account_id,
        name: source.name,
        mime_type: source.mime_type,
        size: source.size,
        revision_number: 0
      )
      lib_rev.file.attach(source.file.blob) if source.file.attached?
      lib_rev.page_texts = source.page_texts if source.page_texts.present?
      lib_rev.pages_layout = source.pages_layout if source.pages_layout.present?
      lib_rev.rendered_pages_cache.attach(source.rendered_pages_cache.blob) if source.rendered_pages_cache.attached?
      lib_rev.save!
      Rails.logger.info "CreateReportJob: copied ref file #{source.prefix_id} to library as #{lib_rev.prefix_id}"
    end
  end

  def enqueue_terminal_callback(report, status)
    meta = report.meta
    return unless meta.is_a?(Hash) && meta["callback_url"].present?

    ReportCallbackJob.perform_later(report.prefix_id, status)
  rescue => e
    Rails.logger.error "CreateReportJob: failed to enqueue callback for #{report.prefix_id}: #{e.message}"
  end

  def handle_job_failure(placeholder_report_id, error, user_id: nil)
    begin
      report = Report.find_by_prefix_id(placeholder_report_id)
      return unless report

      # Update status to failed — but :cancelled and :completed always win.
      # If the user cancelled mid-batch and that batch then raised (e.g.
      # InspectionTimeoutError), flipping the report from :cancelled to
      # :failed would show the user a failure dialog instead of the
      # resume-oriented interrupted UX.
      unless report.job_status_completed? || report.job_status_cancelled?
        report.update!(
          job_status: :failed,
          error_message: sanitize_job_error(error.message)
        )
      end


      # Notify user of failure (skip if another job already completed — it would have notified)
      if report.job_status_failed?
        begin
          NotificationService.report_finished!(report, User.find_by(id: user_id))
        rescue => e
          Rails.logger.error "CreateReportJob: failure notification failed: #{e.message}"
        end

        enqueue_terminal_callback(report, "failed")
      end
    rescue => update_error
      Rails.logger.error "Failed to handle job failure for #{placeholder_report_id}: #{update_error.message}"
    end
  end

  # Reads the count of pages successfully processed before a failure.
  # `update_batch_progress` stores `page_offset` (pages completed before current batch)
  # into meta["pages_processed"] at the start of each batch, so on mid-loop failure
  # this value reflects exactly the pages from successfully completed prior batches.
  def partial_pages_processed_from_meta(report)
    meta = report.meta
    return 0 unless meta.is_a?(Hash)
    value = meta["pages_processed"] || meta.dig("internal", "page_offset")
    value.to_i
  rescue
    0
  end

  def non_transient_ai_error?(message)
    return false if message.blank?
    message.match?(/\b40[0-3]\b|rejected by provider|invalid.*request|credit balance allows only/i)
  end

  def sanitize_job_error(message)
    return RevdokuDocApiClient::GENERIC_ERROR if message.match?(RevdokuDocApiClient::SENSITIVE_PATTERNS)
    message.truncate(200)
  end
end
