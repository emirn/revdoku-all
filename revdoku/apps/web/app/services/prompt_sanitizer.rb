# frozen_string_literal: true

# Ruby mirror of the doc-api's apps/services/revdoku-doc-api/src/lib/prompt-sanitizer.ts,
# plus an `sanitize_external_content` helper for content fetched/read from
# reference files before it is spliced into a rule prompt.
#
# Applied at upload time when populating DocumentFileRevision#page_texts for
# text-shaped reference files.
module PromptSanitizer
  # Template variable patterns like {{CHECKLIST}}, {{TEXT}} — reserved for
  # internal prompt placeholders; strip if users smuggle them into rule text
  # or reference content.
  TEMPLATE_VAR_RE = /\{\{[^}]+\}\}/

  # XML-style prompt delimiters used by the inspection prompt scaffold
  # (<user_*>, <system>). Strip to prevent boundary-escape attacks.
  XML_TAG_RE = %r{</?(?:user_\w+|system)\b[^>]*>}i

  # Max single content blob (must match the DocumentFileRevision library cap).
  MAX_FILE_BYTES = 2 * 1024 * 1024

  module_function

  # 1:1 mirror of the doc-api's sanitizeUserInput. Used on both rule prompts (if
  # the caller wants Ruby-side sanitization) and on fetched reference content.
  def sanitize_user_input(text)
    return text if text.nil? || text.empty?

    text.gsub(TEMPLATE_VAR_RE, "").gsub(XML_TAG_RE, "")
  end

  # Sanitize content read from a reference file before splicing it into a
  # rule prompt. Strips control characters (except \n \t), runs the
  # template/XML guardrails, collapses runs of 4+ newlines, and hard-caps
  # the output length.
  def sanitize_external_content(text, _mime_type = nil)
    return "" if text.nil?

    cleaned = text.dup
    cleaned = cleaned.force_encoding("UTF-8")
    cleaned = cleaned.scrub("")
    cleaned = cleaned.gsub(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/, "")
    cleaned = sanitize_user_input(cleaned)
    cleaned = cleaned.gsub(/\n{4,}/, "\n\n\n")
    cleaned = cleaned.byteslice(0, MAX_FILE_BYTES).to_s.scrub("")
    cleaned
  end
end
