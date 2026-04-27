// JS mirror of Ruby's RuleFileResolver.scan_markers
// (apps/web/app/services/rule_file_resolver.rb).
//
// Scans a prompt string for `#ref[...]` reference markers and returns
// them in prompt order. Grammar inside the brackets:
//
//   No `<scheme>:` prefix       → deferred description (free text)
//   `<scheme>:<value>`          → typed pin (v1 scheme: `file`)
//   `<scheme>:<value>|<label>`  → typed pin with display label
//
// Keep the regexes in lockstep with the Ruby side — no drift possible.

export type MarkerKind = "deferred" | "latest_df" | "pinned_dfrev";

export interface RuleFileMarker {
  kind: MarkerKind;
  /** "df_xxx" / "dfrev_xxx" for pinned markers, null for deferred. */
  prefix_id: string | null;
  /** Display label (typed pin) or free-text description (deferred). */
  description: string | null;
  /** Byte offset of the match within the prompt. */
  offset: number;
  /** Length of the full match including `#ref[` and `]`. */
  length: number;
}

// Matches a single `#ref[...]`. Word-boundary protected so `profile#ref`
// does not match.
const MARKER_REGEX = /(?<!\w)#ref\[(?<body>[^\]]*)\](?![A-Za-z0-9_])/g;

// Within the brackets: scheme-prefixed typed pin, optionally with a
// `|display label` suffix. Only `file:` is honoured in v1.
const TYPED_PIN_REGEX = /^(?<scheme>[a-z][a-z0-9_]*):(?<value>[^|]+)(?:\|(?<label>.*))?$/;

function classifyBody(body: string): { kind: MarkerKind; prefix_id: string | null; description: string | null } {
  const pin = body.match(TYPED_PIN_REGEX);
  if (pin && pin.groups?.scheme === "file") {
    const value = pin.groups.value || "";
    const label = pin.groups.label || "";
    const desc = label.length > 0 ? label : null;
    if (value.startsWith("df_")) return { kind: "latest_df", prefix_id: value, description: desc };
    if (value.startsWith("dfrev_")) return { kind: "pinned_dfrev", prefix_id: value, description: desc };
    return { kind: "deferred", prefix_id: null, description: body };
  }
  return { kind: "deferred", prefix_id: null, description: body.length > 0 ? body : null };
}

export function scanRuleFileMarkers(prompt: string | null | undefined): RuleFileMarker[] {
  if (!prompt) return [];
  const markers: RuleFileMarker[] = [];
  const re = new RegExp(MARKER_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt)) !== null) {
    const body = match.groups?.body ?? "";
    const classified = classifyBody(body);
    markers.push({
      ...classified,
      offset: match.index,
      length: match[0].length,
    });
  }
  return markers;
}

export function hasRuleFileMarker(prompt: string | null | undefined): boolean {
  if (!prompt) return false;
  return new RegExp(MARKER_REGEX.source).test(prompt);
}

/** Sentinel scope key used for checklist.system_prompt markers. Mirrors
 *  RuleFileResolver::CHECKLIST_SYSTEM_PROMPT_RULE_ID on the Rails side. */
export const CHECKLIST_SYSTEM_PROMPT_SCOPE = "__checklist_system_prompt__";

/** Where a scanned marker lives in the checklist — drives the UI label
 *  prefix in the Review dialog. */
export type ScopeKind = "checklist_prompt" | "checklist_rule" | "envelope_rule";

export interface ScopedPromptMarker {
  scope_key: string;
  scope_kind: ScopeKind;
  /** Main human label, e.g. "Checklist Prompt — 1",
   *  "Checklist Rule 3 — 1", "Envelope Rule 2 — 1". */
  scope_label: string;
  /** Optional rule-excerpt detail (null for system_prompt). */
  scope_detail: string | null;
  position: number;
  marker: RuleFileMarker;
}

export function scanChecklistForMarkers(args: {
  rules: Array<{ id?: string; prompt?: string; origin?: string; order?: number }> | null | undefined;
  system_prompt?: string | null;
}): ScopedPromptMarker[] {
  const out: ScopedPromptMarker[] = [];

  if (args.system_prompt) {
    const markers = scanRuleFileMarkers(args.system_prompt);
    markers.forEach((marker, position) => {
      out.push({
        scope_key: CHECKLIST_SYSTEM_PROMPT_SCOPE,
        scope_kind: "checklist_prompt",
        // Attribution phrase rendered next to the slot description in the
        // Review dialog: "(from checklist main prompt)". Multiple
        // system-prompt markers share this label because the `#ref[...]`
        // description text is what tells them apart.
        scope_label: "from checklist main prompt",
        scope_detail: null,
        position,
        marker,
      });
    });
  }

  const rules = args.rules || [];
  const checklistRules: Array<{ rule: typeof rules[number]; displayOrder: number }> = [];
  const envelopeRules: Array<{ rule: typeof rules[number]; displayOrder: number }> = [];
  let checklistOrder = 0;
  let envelopeOrder = 0;
  rules.forEach((rule) => {
    if (rule.origin === "user") {
      envelopeOrder += 1;
      envelopeRules.push({ rule, displayOrder: envelopeOrder });
    } else {
      checklistOrder += 1;
      checklistRules.push({ rule, displayOrder: checklistOrder });
    }
  });

  const pushRule = (kind: ScopeKind, attributionPrefix: string, entries: typeof checklistRules) => {
    entries.forEach(({ rule, displayOrder }) => {
      const id = (rule.id || "").toString();
      const markers = scanRuleFileMarkers(rule.prompt);
      if (markers.length === 0) return;
      const excerpt = (rule.prompt || "").slice(0, 60).trim();
      markers.forEach((marker, position) => {
        out.push({
          scope_key: id,
          scope_kind: kind,
          // Attribution phrase rendered next to the slot description:
          // "(from rule #3)" / "(from envelope rule #2)". Position suffix
          // is omitted — multi-marker rules are disambiguated by the
          // `#ref[...]` description text in the Review dialog.
          scope_label: `${attributionPrefix} #${displayOrder}`,
          scope_detail: excerpt ? `${excerpt}${excerpt.length === 60 ? "…" : ""}` : null,
          position,
          marker,
        });
      });
    });
  };

  pushRule("checklist_rule", "from rule", checklistRules);
  pushRule("envelope_rule", "from envelope rule", envelopeRules);

  return out;
}

/** Token yielded by `splitOnFileMarkers` — either a plain text run or
 *  a marker. Concatenating `t.value` / `t.raw` reproduces the input. */
export type MarkerToken =
  | { type: "text"; value: string }
  | { type: "marker"; raw: string; marker: RuleFileMarker };

export function splitOnFileMarkers(prompt: string | null | undefined): MarkerToken[] {
  if (!prompt) return [];
  const markers = scanRuleFileMarkers(prompt);
  if (markers.length === 0) return [{ type: "text", value: prompt }];
  const tokens: MarkerToken[] = [];
  let cursor = 0;
  for (const m of markers) {
    if (m.offset > cursor) tokens.push({ type: "text", value: prompt.slice(cursor, m.offset) });
    tokens.push({ type: "marker", raw: prompt.slice(m.offset, m.offset + m.length), marker: m });
    cursor = m.offset + m.length;
  }
  if (cursor < prompt.length) tokens.push({ type: "text", value: prompt.slice(cursor) });
  return tokens;
}

/** Build canonical marker source text from a marker shape. */
export function formatMarkerSource(marker: {
  kind: MarkerKind;
  prefix_id: string | null;
  description: string | null;
}): string {
  const desc = marker.description?.trim();
  if (marker.kind === "deferred") return `#ref[${desc ?? ""}]`;
  if (marker.prefix_id) {
    const label = desc ? `|${desc}` : "";
    return `#ref[file:${marker.prefix_id}${label}]`;
  }
  // Fallback: treat as deferred if kind/id combo is inconsistent.
  return `#ref[${desc ?? ""}]`;
}
