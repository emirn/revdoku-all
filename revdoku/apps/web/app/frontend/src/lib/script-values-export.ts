export interface ScriptValuesExportContext {
  envelopeTitle?: string;
  scriptName?: string;
  executedAt?: string;
}

type Scalar = string | number | boolean | null;
type ScriptRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is ScriptRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArrayOfPlainObjects(value: unknown): value is ScriptRecord[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPlainObject);
}

function stringifyCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Pick the tabular array to emit as CSV rows. Prefers a key literally named
 * `items` (the convention in envelope-script-templates.md); otherwise falls
 * back to the first key whose value is a non-empty array of plain objects.
 */
function pickTabularArray(data: ScriptRecord): { key: string; rows: ScriptRecord[] } | null {
  if (isArrayOfPlainObjects(data.items)) return { key: 'items', rows: data.items };
  for (const key of Object.keys(data)) {
    const v = data[key];
    if (isArrayOfPlainObjects(v)) return { key, rows: v };
  }
  return null;
}

function collectColumns(rows: ScriptRecord[]): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

function buildMetadataLines(ctx?: ScriptValuesExportContext): string[] {
  const lines: string[] = [];
  if (ctx?.envelopeTitle) lines.push('# Envelope: ' + ctx.envelopeTitle);
  if (ctx?.scriptName) lines.push('# Script: ' + ctx.scriptName);
  if (ctx?.executedAt) lines.push('# Executed: ' + ctx.executedAt);
  return lines;
}

/**
 * Generate CSV from a script's `data` object.
 *
 * - If `data` contains a tabular array (prefers `items`), emit one row per
 *   record with columns = union of record keys. All scalar keys on `data`
 *   are emitted as `# key: value` comment lines alongside the metadata header.
 * - If `data` has no tabular array, emit a 2-column `key,value` CSV of all
 *   scalar entries.
 */
export function generateScriptValuesCsv(data: ScriptRecord, ctx?: ScriptValuesExportContext): string {
  const lines: string[] = [];
  const metaLines = buildMetadataLines(ctx);
  lines.push(...metaLines);

  const tabular = pickTabularArray(data);

  if (tabular) {
    // Emit scalar summary fields as comment lines before the table.
    for (const key of Object.keys(data)) {
      if (key === tabular.key) continue;
      const v = data[key];
      if (v == null || typeof v === 'object') continue;
      lines.push('# ' + key + ': ' + stringifyCell(v));
    }
    if (lines.length > 0) lines.push('');

    const columns = collectColumns(tabular.rows);
    lines.push(columns.map(escapeCsv).join(','));
    for (const row of tabular.rows) {
      lines.push(columns.map(c => escapeCsv(stringifyCell(row[c]))).join(','));
    }
  } else {
    if (lines.length > 0) lines.push('');
    lines.push('key,value');
    for (const key of Object.keys(data)) {
      const v = data[key];
      lines.push(escapeCsv(key) + ',' + escapeCsv(stringifyCell(v)));
    }
  }

  return lines.join('\n');
}

function openBlobInTab(content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function openScriptValuesCsvInTab(data: ScriptRecord, ctx?: ScriptValuesExportContext) {
  const csv = generateScriptValuesCsv(data, ctx);
  // text/plain (not text/csv) so browsers render inline instead of forcing a
  // download — matches the pattern used by checks-csv-export.ts.
  openBlobInTab(csv, 'text/plain;charset=utf-8');
}

export function openScriptValuesJsonInTab(data: ScriptRecord, ctx?: ScriptValuesExportContext) {
  const meta: Record<string, Scalar | undefined> = {
    envelope_title: ctx?.envelopeTitle,
    script_name: ctx?.scriptName,
    executed_at: ctx?.executedAt,
  };
  const payload = { _meta: meta, data };
  openBlobInTab(JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
}
