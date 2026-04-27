# Sum of all values
Sum all extracted numeric values (data.val) across every check into a single total.

<script>
const script_template = `{{#if empty}}<em>No extracted values found.</em>{{else}}<b>Total: {{total}}</b> ({{count}} values){{/if}}`;

// Rule example: "Count all items on each page. Save value of the count."
const vals = checks
  .filter(c => c.data?.val)
  .map(c => parseFloat(c.data.val))
  .filter(v => !isNaN(v));

if (vals.length === 0) return { data: { empty: true } };

const total = vals.reduce((sum, v) => sum + v, 0);
return { data: { total, count: vals.length } };
</script>

# Sum per page
Show per-page breakdown with navigation links and a grand total at the bottom.

<script>
const script_template = `{{#if empty}}<em>No extracted values found.</em>{{else}}{{#each items}}<a href="#page_{{page}}">Page {{page}}</a>: <b>{{value}}</b><br/>{{/each}}<b>Total: {{total}}</b>{{/if}}`;

// Rule example: "For each page, count all visible items. Save value of the count."
const byPage = {};
checks.filter(c => c.data?.val).forEach(c => {
  const p = Math.max(1, c.page || 1);
  const v = parseFloat(c.data.val);
  if (!isNaN(v)) byPage[p] = (byPage[p] || 0) + v;
});

const pages = Object.keys(byPage).sort((a, b) => a - b);
if (pages.length === 0) return { data: { empty: true } };

const total = pages.reduce((sum, p) => sum + byPage[p], 0);
const items = pages.map(p => ({ page: p, value: byPage[p] }));
return { data: { total, items } };
</script>

# Total, per page, and average
Per-page values, grand total, and average — all with page navigation links.

<script>
const script_template = `{{#if empty}}<em>No extracted values found.</em>{{else}}{{#each items}}<a href="#page_{{page}}">Page {{page}}</a>: {{value}}<br/>{{/each}}<b>Total: {{total}}</b> · Avg: {{avg}}{{/if}}`;

// Rule example: "For each page, count all visible items. Save value of the count."
const entries = checks
  .filter(c => c.data?.val)
  .map(c => ({ page: Math.max(1, c.page || 1), v: parseFloat(c.data.val) }))
  .filter(x => !isNaN(x.v));

if (entries.length === 0) return { data: { empty: true } };

const total = entries.reduce((sum, x) => sum + x.v, 0);
const avg = (total / entries.length).toFixed(1);
const byPage = {};
entries.forEach(x => { byPage[x.page] = (byPage[x.page] || 0) + x.v; });
const items = Object.keys(byPage).sort((a, b) => a - b).map(p => ({ page: p, value: byPage[p] }));
return { data: { total, avg, count: entries.length, items } };
</script>

# Count by value
Count occurrences of each unique extracted value (e.g. colors, types, categories).

<script>
const script_template = `{{#if empty}}<em>No values found.</em>{{else}}{{#each items}}<b>{{name}}</b>: {{count}}<br/>{{/each}}<b>Total: {{total}}</b> ({{categories}} categories){{/if}}`;

// Rule example: "For each apple, save value of dominant color (e.g. 'Red', 'Green')."
const counts = {};
checks.filter(c => c.data?.val).forEach(c => {
  const key = c.data.val.trim();
  counts[key] = (counts[key] || 0) + 1;
});

const keys = Object.keys(counts).sort();
if (keys.length === 0) return { data: { empty: true } };

const total = keys.reduce((sum, k) => sum + counts[k], 0);
const items = keys.map(k => ({ name: k, count: counts[k] }));
return { data: { total, categories: keys.length, items } };
</script>

# Group by category and sum
Parse "category,number" values, group by category, and sum the numbers.

<script>
const script_template = `{{#if empty}}<em>No categorized values found.</em>{{else}}{{#each items}}<b>{{name}}</b>: {{value}}<br/>{{/each}}<b>Total: {{total}}</b>{{/if}}`;

// Rule example: "For each item, save value of 'type,count' (e.g. 'red,2', 'defect,3')."
const groups = {};
checks.filter(c => c.data?.val).forEach(c => {
  const parts = c.data.val.split(',');
  const category = parts[0]?.trim() || 'other';
  const count = parseFloat(parts[1]?.trim()) || 1;
  groups[category] = (groups[category] || 0) + count;
});

const keys = Object.keys(groups).sort();
if (keys.length === 0) return { data: { empty: true } };

const total = keys.reduce((sum, k) => sum + groups[k], 0);
const items = keys.map(k => ({ name: k, value: groups[k] }));
return { data: { total, items } };
</script>

# Failed checks summary
List all failed checks with page links and failure count.

<script>
const script_template = `{{#if all_passed}}<b>All checks passed!</b>{{else}}{{#each items}}<a href="#page_{{page}}">Page {{page}}</a>: {{description}}<br/>{{/each}}<b>{{failed_count}} of {{total}} failed</b>{{/if}}`;

// Works with any checklist rule — no special val format needed
const failed = checks.filter(c => !c.passed);
if (failed.length === 0) return { data: { all_passed: true } };

const items = failed.map(c => ({ page: Math.max(1, c.page || 1), description: c.description }));
return { data: { failed_count: failed.length, total: checks.length, items } };
</script>

# Checks with extracted values
List all checks that have data.val, grouped by rule with page links.

<script>
const script_template = `{{#if empty}}<em>No checks with extracted values.</em>{{else}}{{#each rules}}<b>{{rule_id}}</b>: {{#each items}}<a href="#page_{{page}}">p{{page}}</a>:{{val}} {{/each}}<br/>{{/each}}<b>{{count}} values extracted</b>{{/if}}`;

// Rule example: any rule that uses "save value of" or "extract value"
const withVal = checks.filter(c => c.data?.val);
if (withVal.length === 0) return { data: { empty: true } };

const byRule = {};
withVal.forEach(c => {
  const key = c.rule_id || 'unknown';
  if (!byRule[key]) byRule[key] = [];
  byRule[key].push({ page: Math.max(1, c.page || 1), val: c.data.val });
});

const rules = Object.entries(byRule).map(([id, items]) => ({ rule_id: id, items }));
return { data: { count: withVal.length, rules } };
</script>

# Keyword search in descriptions
Search check descriptions for configurable keywords and list matches with page links.

<script>
const script_template = `{{#if no_matches}}No matches for: {{#each keywords}}{{.}} {{/each}}{{else}}{{#each items}}<a href="#page_{{page}}">Page {{page}}</a>: {{description}}<br/>{{/each}}<b>{{match_count}} matches</b>{{/if}}`;

// Works with any checklist rule — edit keywords below
const keywords = ['error', 'missing', 'incorrect', 'violation'];

const matches = checks.filter(c =>
  keywords.some(kw => c.description?.toLowerCase().includes(kw.toLowerCase()))
);

if (matches.length === 0) return { data: { no_matches: true, keywords } };

const items = matches.map(c => ({ page: Math.max(1, c.page || 1), description: c.description }));
return { data: { match_count: matches.length, keywords, items } };
</script>

# Pass rate per rule
Show pass/fail percentage for each rule in the checklist.

<script>
const script_template = `{{#each rules}}<b>{{pct}}%</b> ({{passed}}/{{total}}) {{label}}<br/>{{/each}}`;

// Works with any checklist rule — no special val format needed
const byRule = {};
checks.forEach(c => {
  const key = c.rule_id || 'unknown';
  if (!byRule[key]) byRule[key] = { passed: 0, failed: 0, prompt: c.rule_prompt || key };
  c.passed ? byRule[key].passed++ : byRule[key].failed++;
});

const items = Object.entries(byRule).map(([id, r]) => {
  const total = r.passed + r.failed;
  const pct = Math.round((r.passed / total) * 100);
  const label = r.prompt.length > 60 ? r.prompt.slice(0, 57) + '...' : r.prompt;
  return { pct, passed: r.passed, total, label };
});

return { data: { rules: items } };
</script>

# Amount comparison
Extract dollar amounts from checks and calculate the total sum.

<script>
const script_template = `{{#if empty}}<em>No amounts found.</em>{{else}}{{#each items}}<a href="#page_{{page}}">p{{page}}</a>: ${{amount}} — {{desc}}<br/>{{/each}}<b>Calculated sum: ${{calculated}}</b> ({{count}} items){{/if}}`;

// Rule example: "For each amount, save value of the dollar figure (e.g. '1500.00')."
const vals = checks
  .filter(c => c.data?.val)
  .map(c => ({ page: Math.max(1, c.page || 1), amount: parseFloat(c.data.val), desc: c.description }))
  .filter(x => !isNaN(x.amount));

if (vals.length === 0) return { data: { empty: true } };

const calculated = vals.reduce((sum, x) => sum + x.amount, 0);
const items = vals.map(x => ({ page: x.page, amount: x.amount.toFixed(2), desc: x.desc }));
return { data: { calculated: calculated.toFixed(2), count: vals.length, items } };
</script>

# Present vs missing
Show which required items are present and which are missing from the document.

<script>
const script_template = `{{#if empty}}<em>No data found.</em>{{else}}{{#if has_missing}}<b>Missing ({{missing_count}}):</b> {{#each missing}}{{.}}, {{/each}}<br/>{{/if}}{{#if has_present}}<b>Present ({{present_count}}):</b> {{#each present}}{{.}}, {{/each}}{{/if}}{{/if}}`;

// Rule example: "For each required clause, save value of 'name,present' or 'name,missing'."
const present = [];
const missing = [];
checks.filter(c => c.data?.val).forEach(c => {
  const parts = c.data.val.split(',');
  const name = parts[0]?.trim() || 'unknown';
  const status = parts[1]?.trim()?.toLowerCase() || 'unknown';
  (status === 'present' ? present : missing).push(name);
});

if (present.length === 0 && missing.length === 0) return { data: { empty: true } };
return { data: { present_count: present.length, missing_count: missing.length, present, missing, has_missing: missing.length > 0, has_present: present.length > 0 } };
</script>

# Unique values list
Deduplicate extracted values and list them alphabetically with mention counts.

<script>
const script_template = `{{#if empty}}<em>No values found.</em>{{else}}{{#each items}}<b>{{term}}</b><br/>{{/each}}<b>{{count}} unique</b> ({{total_mentions}} mentions){{/if}}`;

// Rule example: "For each defined term, save value of the term name."
const raw = checks.filter(c => c.data?.val).map(c => c.data.val.trim());
const unique = [...new Set(raw)].sort();
if (unique.length === 0) return { data: { empty: true } };

const items = unique.map(t => ({ term: t }));
return { data: { count: unique.length, total_mentions: raw.length, items } };
</script>

# Reference count
Count how many times each entity is referenced, sorted by frequency.

<script>
const script_template = `{{#if empty}}<em>No references found.</em>{{else}}{{#each items}}<b>{{name}}</b>: {{count}} mentions<br/>{{/each}}<b>{{total}} total</b> ({{unique}} unique){{/if}}`;

// Rule example: "For each mention of a party, save value of 'name,1'."
const groups = {};
checks.filter(c => c.data?.val).forEach(c => {
  const parts = c.data.val.split(',');
  const name = parts[0]?.trim() || 'unknown';
  groups[name] = (groups[name] || 0) + 1;
});

const keys = Object.keys(groups).sort((a, b) => groups[b] - groups[a]);
if (keys.length === 0) return { data: { empty: true } };

const total = keys.reduce((sum, k) => sum + groups[k], 0);
const items = keys.map(k => ({ name: k, count: groups[k] }));
return { data: { total, unique: keys.length, items } };
</script>
