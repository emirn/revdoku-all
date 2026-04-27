import type { ICheck } from '@revdoku/lib';

export interface CsvExportContext {
  envelopeTitle?: string;
  fileNames?: string[];
  checklistName?: string;
  reportDatetime?: string;
}

/** CSV column definitions — order matches script API field names */
function buildCsvColumns(ctx?: CsvExportContext) {
  const datetime = ctx?.reportDatetime || '';
  return [
    { header: 'index', value: (c: ICheck) => String(c.check_index ?? '') },
    { header: 'datetime', value: () => datetime },
    { header: 'passed', value: (c: ICheck) => c.passed ? '1' : '0' },
    { header: 'page', value: (c: ICheck) => String(c.page ?? '') },
    { header: 'description', value: (c: ICheck) => c.description ?? '' },
    { header: 'data.val', value: (c: ICheck) => c.data?.val ?? '' },
    { header: 'data.val_p', value: (c: ICheck) => c.data?.val_p ?? '' },
    { header: 'area_x', value: (c: ICheck) => String(c.x1 ?? '') },
    { header: 'area_y', value: (c: ICheck) => String(c.y1 ?? '') },
    { header: 'width', value: (c: ICheck) => c.x2 != null && c.x1 != null ? String(c.x2 - c.x1) : '' },
    { header: 'height', value: (c: ICheck) => c.y2 != null && c.y1 != null ? String(c.y2 - c.y1) : '' },
  ];
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/** Generate CSV string from checks array with optional context metadata */
export function generateChecksCsv(checks: ICheck[], context?: CsvExportContext): string {
  const lines: string[] = [];

  // Metadata header
  if (context?.envelopeTitle) {
    lines.push('# Envelope: ' + context.envelopeTitle);
  }
  if (context?.checklistName) {
    lines.push('# Checklist: ' + context.checklistName);
  }
  if (context?.fileNames?.length) {
    lines.push('# Files: ' + context.fileNames.join(', '));
  }
  if (lines.length > 0) {
    lines.push('# Exported: ' + new Date().toISOString());
    lines.push('');
  }

  // Column headers + data rows
  const columns = buildCsvColumns(context);
  lines.push(columns.map(c => c.header).join(','));
  for (const check of checks) {
    lines.push(columns.map(col => escapeCsv(col.value(check))).join(','));
  }

  return lines.join('\n');
}

/**
 * Open CSV content in a new browser tab for inline viewing.
 *
 * Uses `text/plain` MIME rather than `text/csv` so browsers render the content
 * inline in a new tab instead of forcing a download (Chrome/Edge download any
 * `text/csv` blob URL; `text/plain` reliably renders in all major browsers).
 * The user can then select + copy or use the browser's Save As… to persist the
 * file locally if they want to keep it.
 */
export function openChecksCsvInTab(checks: ICheck[], context?: CsvExportContext) {
  const csv = generateChecksCsv(checks, context);
  const blob = new Blob([csv], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  // Revoke after a minute so the tab has time to finish loading; once the tab
  // has the data, revoking the blob URL is harmless.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
