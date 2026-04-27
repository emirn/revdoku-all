# frozen_string_literal: true

# Universal prompt enhancer for reference markers.
#
# A rule's prompt (or the checklist's `system_prompt`) may contain
# `#ref[...]` markers. Inside the brackets, the content is one of:
#
#   #ref[Upload the quote]              deferred (picked at review time)
#   #ref[file:df_xxx]                   latest revision of a library file
#   #ref[file:df_xxx|Invoice quote]     explicit + UI hint
#   #ref[file:dfrev_xxx]                specific pinned revision
#   #ref[file:dfrev_xxx|Invoice quote]  + UI hint
#
# The grammar inside the brackets:
#   - No `<scheme>:` prefix  → deferred description (free text)
#   - `<scheme>:<value>`     → typed pin (v1 scheme: `file`)
#   - `<scheme>:<value>|<label>` → typed pin with display label
#
# The resolver scans all markers across an ordered list of scoped prompts
# (rules + the checklist system_prompt) and rewrites each marker in place
# with the **stable canonical form** `#ref[file:<dfrev_prefix_id>|<label>]`
# (label kept only when the source marker supplied one). After rewriting,
# every marker references a specific DocumentFileRevision explicitly,
# regardless of which form the author originally wrote.
#
# Rails does NOT inline file content or attach images. Both text and image
# reference files travel to the doc-api on a single top-level `ref_files`
# array, each entry keyed by the same `dfrev_prefix_id` that appears in
# the pinned `#ref[file:…]` marker. The doc-api does the final prompt
# assembly — see apps/services/revdoku-doc-api/src/lib/ai.ts.
class RuleFileResolver
  # Matches a single `#ref[...]` marker. Word-boundary protected so
  # `profile#ref` / stray `]ref[` cannot match.
  MARKER_REGEX = /(?<!\w)\#ref\[(?<body>[^\]]*)\](?![A-Za-z0-9_])/x

  # Within the brackets: scheme-prefixed typed pin, optionally with a
  # `|display label` suffix. Only `file:` is honoured in v1.
  TYPED_PIN_REGEX = /\A(?<scheme>[a-z][a-z0-9_]*):(?<value>[^|]+)(?:\|(?<label>.*))?\z/

  # Sentinel scope key for markers found in `checklist.system_prompt`.
  CHECKLIST_SYSTEM_PROMPT_RULE_ID = "__checklist_system_prompt__"

  EnrichedEntry = Struct.new(:scope_key, :rewritten_prompt, :has_images, keyword_init: true)
  Reference     = Struct.new(
    :document_file_revision_id,
    :document_file_revision_prefix_id,
    :rule_id,
    :mime_type,
    :description,
    keyword_init: true
  )
  Result = Struct.new(:success, :entries, :references, :error, keyword_init: true) do
    def success? = success == true
  end

  class << self
    # Scan `prompt` for markers in order. Each entry:
    #   { kind: :deferred | :latest_df | :pinned_dfrev,
    #     prefix_id: "df_..." | "dfrev_..." | nil,
    #     description: "..." | nil,
    #     offset: <int>, length: <int> }
    def scan_markers(prompt)
      return [] if prompt.nil? || prompt.to_s.empty?

      markers = []
      offset = 0
      text = prompt.to_s
      while (match = text.match(MARKER_REGEX, offset))
        body = match[:body] || ""
        classified = classify_body(body)
        markers << classified.merge(
          offset: match.begin(0),
          length: match.end(0) - match.begin(0)
        )
        offset = match.end(0)
      end
      markers
    end

    # Fast presence check.
    def has_marker?(prompt)
      return false if prompt.nil?
      prompt =~ MARKER_REGEX ? true : false
    end

    # Universal prompt enhancer. See class docstring.
    def rewrite_with_refs(entries)
      enriched_entries = []
      refs_by_dfrev_id = {}

      entries.each do |entry|
        scope_key = entry[:scope_key] || entry["scope_key"]
        prompt = entry[:prompt] || entry["prompt"]
        # revisions is an array indexed by marker position. A `nil` entry
        # at index `i` means the marker at position `i` was not pinned
        # (optional ref the user chose to skip) — the marker stays as its
        # original `#ref[...]` text in the rewritten prompt. Extra
        # revisions beyond markers.length are a data-integrity bug.
        revisions = Array(entry[:revisions] || entry["revisions"])

        markers = scan_markers(prompt)

        if revisions.length > markers.length
          return Result.new(
            success: false,
            entries: [],
            references: [],
            error: "scope #{scope_key}: received #{revisions.length} reference file(s) for only #{markers.length} marker(s)"
          )
        end

        revisions.each_with_index do |rev, idx|
          next if rev.nil?
          unless rev.ready?
            return Result.new(
              success: false,
              entries: [],
              references: [],
              error: "scope #{scope_key}: reference file revision #{rev.prefix_id} is not ready yet"
            )
          end
        end

        has_images = false

        replacements = markers.each_with_index.map do |marker, idx|
          revision = revisions[idx]
          if revision.nil?
            # Skipped position — keep the original `#ref[...]` text so the
            # downstream AI sees the marker but without a paired file
            # block. the doc-api's token substitutor only matches the canonical
            # `#ref[file:…]` form, so raw markers pass through harmlessly.
            next prompt.to_s[marker[:offset], marker[:length]]
          end
          has_images ||= image_mime?(revision.mime_type)

          unless refs_by_dfrev_id.key?(revision.id)
            rule_id_for_scope = scope_key == CHECKLIST_SYSTEM_PROMPT_RULE_ID ? nil : scope_key
            refs_by_dfrev_id[revision.id] = Reference.new(
              document_file_revision_id: revision.id,
              document_file_revision_prefix_id: revision.prefix_id,
              rule_id: rule_id_for_scope,
              mime_type: revision.mime_type,
              description: marker[:description]
            )
          end

          format_pinned_marker(revision.prefix_id, marker[:description])
        end

        replacement_iter = replacements.each
        rewritten = prompt.to_s.gsub(MARKER_REGEX) { replacement_iter.next }

        enriched_entries << EnrichedEntry.new(
          scope_key: scope_key,
          rewritten_prompt: rewritten,
          has_images: has_images
        )
      end

      Result.new(
        success: true,
        entries: enriched_entries,
        references: refs_by_dfrev_id.values,
        error: nil
      )
    end

    # Used by the Checklist save-time validator to confirm that an
    # explicit typed pin (`#ref[file:…]`) resolves to a library file
    # the current account owns. Returns the matching revision or nil.
    def find_library_revision_for_marker(marker, account:)
      return nil if account.nil?
      return nil if marker[:prefix_id].nil?

      case marker[:kind]
      when :latest_df
        df = DocumentFile.library.where(account_id: account.id).find_by_prefix_id(marker[:prefix_id])
        return nil unless df
        df.document_file_revisions.order(revision_number: :desc).first
      when :pinned_dfrev
        rev = DocumentFileRevision.find_by_prefix_id(marker[:prefix_id])
        return nil unless rev
        return nil unless rev.account_scoped?
        return nil unless rev.document_file.library?
        return nil unless rev.account_id == account.id
        rev
      end
    end

    private

    # Classify the bracket body into a marker entry. Typed pins with
    # scheme != "file" are treated as deferred so they round-trip and
    # aren't silently dropped — they just won't trigger upload slots.
    def classify_body(body)
      pin = body.to_s.match(TYPED_PIN_REGEX)
      if pin && pin[:scheme] == "file"
        value = pin[:value]
        label = pin[:label]
        label = nil if label.to_s.empty?
        if value.start_with?("df_")
          { kind: :latest_df, prefix_id: value, description: label }
        elsif value.start_with?("dfrev_")
          { kind: :pinned_dfrev, prefix_id: value, description: label }
        else
          { kind: :deferred, prefix_id: nil, description: body }
        end
      else
        desc = body.to_s
        desc = nil if desc.empty?
        { kind: :deferred, prefix_id: nil, description: desc }
      end
    end

    # Build the canonical pinned marker source from a dfrev prefix id +
    # optional label.
    def format_pinned_marker(dfrev_prefix_id, label)
      if label.to_s.empty?
        "#ref[file:#{dfrev_prefix_id}]"
      else
        "#ref[file:#{dfrev_prefix_id}|#{label}]"
      end
    end

    def image_mime?(mime_type)
      %w[image/png image/jpeg image/tiff image/webp application/pdf].include?(mime_type)
    end
  end
end
