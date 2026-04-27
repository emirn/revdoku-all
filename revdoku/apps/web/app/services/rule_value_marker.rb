# frozen_string_literal: true

# Ruby mirror of the TypeScript `hasValueMarker` / `stripValueMarker` helpers
# defined in `apps/shared/js-packages/revdoku-lib/src/common-types.ts`.
#
# A checklist rule whose `prompt` contains `#value` (case-insensitive,
# word-bounded) opts into value extraction: the doc-api injects a strong
# "SAVE VALUE REQUIRED" directive into the AI prompt for that rule, and
# the frontend / exported labels show `check.data.val` inline next to the
# check description. Rules without the marker produce no `val`.
#
# Rails itself doesn't currently need to introspect the marker — the
# marker lives inside `Checklist#rules` as a substring of each rule's
# prompt and is forwarded to the doc-api verbatim. This module exists so any
# future Rails-side logic (e.g. admin reporting, backfill scripts, policy
# checks) can use the identical regex instead of reinventing it.
module RuleValueMarker
  MARKER_RE = /#value\b/i
  MARKER_RE_GLOBAL = /#value\b/i # gsub is global by default — kept for symmetry with JS

  def self.present?(prompt)
    prompt.is_a?(String) && prompt.match?(MARKER_RE)
  end

  def self.strip(prompt)
    return "" unless prompt.is_a?(String)
    prompt.gsub(MARKER_RE_GLOBAL, "").gsub(/\s{2,}/, " ").strip
  end
end
