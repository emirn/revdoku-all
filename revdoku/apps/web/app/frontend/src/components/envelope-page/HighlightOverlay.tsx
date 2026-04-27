import React, { useLayoutEffect, useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2, GitCompareArrows, ClipboardCheck, Mail, List, GripVertical } from 'lucide-react';

// Inline rectangular-magnifier icon: a small lozenge with a handle, more
// faithful to the rectangular bar magnifier than lucide's circular Search.
// size controls both width/height; color inherits via currentColor.
const RectMagnifierIcon = ({ size = 12, off = false }: { size?: number; off?: boolean }) => (
  <svg width={size * 1.35} height={size} viewBox="0 0 22 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <rect x="1" y="2" width="13" height="9" rx="2" />
    <line x1="12" y1="11" x2="20" y2="15" />
    {off && <line x1="2" y1="14" x2="20" y2="2" strokeWidth="1.6" />}
  </svg>
);
import { Document, Page } from 'react-pdf';
// react-pdf ships the TextLayer positioning rules as a plain CSS file. Without
// this import, the text-layer spans render inline below the canvas instead of
// being absolutely overlaid on top of each page — exactly what we saw as
// "text version appearing below the PDF" in the ref viewer.
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { ApiClient } from '@/lib/api-client';
import { REF_FILE_THEME } from '@/lib/ref-file-theme';
import InlineCheckEditor from '@/components/envelope-page/InlineCheckEditor';
import { renderMarkdown, MARKDOWN_PROSE_CLASSES } from '@/components/envelope-page/MarkdownDiffDisplay';
import { CATCH_CHANGES_RULE_DISPLAY, CATCH_ALL_RULE_DISPLAY } from '@/lib/rule-utils';
import { useTheme } from '@/context/ThemeContext';
import {
  HighlightMode,
  getHighlightModeConfig,
  getConnectionLineEndpoint,
  ICoordinates,
  IReport,
  IRule,
  ICheck,
  ICheckForDisplay,
  IEnvelopeRevision,
  IEnvelope,
  getWidth,
  getHeight,
  calculateCornerRadius,
  HintPlacementResultExtended,
  REVDOKU_LEADER_OPACITY,
  REVDOKU_LEADER_LINE_WIDTH_V2,
  REVDOKU_LEADER_DASH_PATTERN,
  REVDOKU_HIGHLIGHT_FILL_ENABLED,
  REVDOKU_MARGIN_LABEL_LINE_HEIGHT,
  REVDOKU_LABEL_BADGE_FONT_SCALE,
  REVDOKU_LABEL_DRAW_FULL_RECTANGLE,
  REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING,
  getFontFamilyCss,
  LabelFontFamily,
  PlacementSide,
  getMainBorderForSide,
  computeStraightConnectionLine,
  getCheckDataTypeLabels,
  REVDOKU_CATCH_CHANGES_RULE_ID,
  REVDOKU_CATCH_ALL_RULE_ID,
  CheckType,
  getCheckTypes,
  REVDOKU_TYPE_BADGE_CHANGES_BORDER,
  REVDOKU_TYPE_BADGE_CHANGES_BG,
  REVDOKU_TYPE_BADGE_CHANGES_TEXT,
  REVDOKU_TYPE_BADGE_RECHECK_BORDER,
  REVDOKU_TYPE_BADGE_RECHECK_BG,
  REVDOKU_TYPE_BADGE_RECHECK_TEXT,
  REVDOKU_ICON_COLOR_CHANGES,
  REVDOKU_ICON_COLOR_RECHECK,
  REVDOKU_RECHECK_ICON_SVG_PATHS,
  REVDOKU_CHANGES_ICON_SVG_PATHS,
  REVDOKU_TYPE_BADGE_FONT_SCALE,
  REVDOKU_TYPE_BADGE_FONT_WEIGHT,
  REVDOKU_TYPE_BADGE_PADDING_H,
  REVDOKU_TYPE_BADGE_BORDER_RADIUS,
  REVDOKU_TYPE_BADGE_GAP,
  REVDOKU_VAL_DISPLAY_OPACITY,
  REVDOKU_VAL_DISPLAY_FONT_SCALE,
  formatValDisplay,
  // Shared SVG drawing primitives — visual parity with doc-api export
  svgLeaderLine,
  svgBadge,
  calculateLabelBadgeSpec,
} from '@revdoku/lib';

/** Inline SVG icon component using shared path data (font-independent, renders on all platforms) */
const CheckIcon = ({ type, size, color, style }: { type: 'recheck' | 'changes'; size: string | number; color: string; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: 'middle', flexShrink: 0, ...style }} dangerouslySetInnerHTML={{ __html: type === 'recheck' ? REVDOKU_RECHECK_ICON_SVG_PATHS : REVDOKU_CHANGES_ICON_SVG_PATHS }} />
);

/**
 * Numbered circle badge using shared SVG primitive (visual parity with doc-api export).
 * Renders the same svgBadge() function that the export uses.
 */
const SharedNumberBadge = ({ number, fontSize, fillColor, fontFamily, style }: {
  number: number | string;
  fontSize: number;
  fillColor: string;
  fontFamily?: string;
  style?: React.CSSProperties;
}) => {
  const spec = calculateLabelBadgeSpec(fontSize);
  const diam = spec.radius * 2;
  const html = svgBadge(spec.radius, spec.radius, spec.radius, spec.fontSize, fillColor, number, fontFamily || 'system-ui, sans-serif');
  return (
    <svg width={diam} height={diam} viewBox={`0 0 ${diam} ${diam}`}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: html }} />
  );
};

/**
 * Splits check description text on `#file_N` citation tokens and returns
 * React elements — plain text for non-matching parts, styled clickable
 * spans for the tokens. The actual viewer is wired as a follow-up; for
 * now the click handler is a visual-only affordance (tooltip + distinct
 * color) so the user knows it's a reference.
 */
/**
 * Renders check description text with `#file_N` citation tokens replaced
 * by clickable links showing the reference filename (e.g. "ref:quote.pdf").
 * `refs` is the `__references__` array from `report.enriched_rules` —
 * used to resolve file_index → display name. Falls back to the raw token
 * if the reference metadata isn't available.
 */
/**
 * Renders check description text with file citation tokens as clickable links.
 *
 * Supports three formats:
 *   - `#file:dfrev_abc123` — AI-output stable citation (clickable → viewer)
 *   - `#file_1` — AI-output positional citation (legacy)
 *   - `#ref[...]` — the generic checklist-syntax marker embedded in a
 *     description (rendered read-only as a chip). Either deferred
 *     (`#ref[description]`), pinned (`#ref[file:dfrev_xxx|label]`), or
 *     display-only (`#ref[file:filename.pdf]` — used on export where
 *     the dfrev id isn't exposed to the viewer).
 *
 * The link text shows the actual filename (e.g. "ref:quote.pdf").
 */
function renderDescriptionWithFileCitations(
  text: string,
  onFileClick?: (dfrevId: string, anchorEl: HTMLElement | null) => void,
  refs?: Array<{ description?: string | null; filename?: string | null; document_file_revision_prefix_id?: string }>,
  // Identifier (typically the check id) used to build a stable, queryable
  // data attribute on each citation span so the popup's beam can re-anchor
  // itself to the DOM position of the actual span on scroll / re-layout.
  scopeId?: string,
  // Handler for intra-document page pointers (`#pg_N` / `#pg_N[x1=...,y1=...,x2=...,y2=...]`).
  // Caller scrolls the viewer to the target page and, if coords are present, draws a beam.
  onPageClick?: (target: { page: number; x1?: number; y1?: number; x2?: number; y2?: number }, anchorEl: HTMLElement | null) => void,
): React.ReactNode {
  // Match #file:dfrev_xxx (clickable citation), #file_N (legacy citation),
  // #ref[...] (the generic marker) and #pg_N / #pg_N[...] (intra-doc page
  // pointer). The bracket-containing alternatives use non-greedy [^\]]* so
  // they stop at the first `]`.
  const parts = text.split(/(#file:dfrev_[A-Za-z0-9]+|#file_\d+|#ref\[[^\]]*\]|#pg_\d+(?:\[[^\]]*\])?)/g);
  if (parts.length === 1) return text;

  // Build a quick lookup: dfrev_prefix_id → ref entry
  const byId = new Map<string, { description?: string | null; filename?: string | null; document_file_revision_prefix_id?: string }>();
  refs?.forEach(r => { if (r.document_file_revision_prefix_id) byId.set(r.document_file_revision_prefix_id, r); });

  // Chip visual: simple "📎 filename" pill. Underlying syntax is still
  // `#ref[...]`, but the rendered chip shows only the human-readable
  // label (filename for file refs, description for deferred).
  const chipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    verticalAlign: 'baseline',
    padding: '0 6px', borderRadius: '4px',
    border: '1px solid rgba(37, 99, 235, 0.3)',
    background: 'rgba(37, 99, 235, 0.08)',
    color: REF_FILE_THEME.accentColor, fontWeight: 600, fontSize: '0.9em',
    whiteSpace: 'nowrap',
  };
  const FileGlyph = () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
  // Muted "ref:" prefix names the chip's kind without overpowering the
  // filename/description that follows it.
  const RefPrefix = () => (
    <span style={{ opacity: 0.65, fontWeight: 500, marginRight: 2 }}>ref:</span>
  );

  // Intra-doc page-pointer pill — teal hue to distinguish from blue
  // ref-file pills; same pill geometry so they sit comfortably alongside.
  const pgChipStyle: React.CSSProperties = {
    border: '1px solid rgba(13, 148, 136, 0.35)',
    background: 'rgba(13, 148, 136, 0.1)',
    color: '#0f766e',
  };
  const PageGlyph = () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </svg>
  );

  return parts.map((part, i) => {
    // AI-emitted stable citation: #file:dfrev_abc123
    const idMatch = part.match(/^#file:(dfrev_[A-Za-z0-9]+)$/);
    if (idMatch) {
      const dfrevId = idMatch[1];
      const ref = byId.get(dfrevId);
      const friendly = ref?.filename || ref?.description || dfrevId;
      return (
        <span
          key={i}
          data-ref-citation={scopeId ? `${scopeId}|${dfrevId}` : undefined}
          onClick={onFileClick ? (e) => { e.stopPropagation(); e.preventDefault(); onFileClick(dfrevId, e.currentTarget as HTMLElement); } : undefined}
          style={{ ...chipStyle, cursor: onFileClick ? 'pointer' : 'default' }}
        >
          <FileGlyph />
          <RefPrefix />
          {friendly}
        </span>
      );
    }
    // AI-emitted positional citation: #file_N
    const numMatch = part.match(/^#file_(\d+)$/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10);
      const ref = refs?.[idx - 1];
      const dfrevId = ref?.document_file_revision_prefix_id || '';
      const friendly = ref?.filename || ref?.description || `file_${idx}`;
      return (
        <span
          key={i}
          data-ref-citation={scopeId && dfrevId ? `${scopeId}|${dfrevId}` : undefined}
          onClick={onFileClick && dfrevId ? (e) => { e.stopPropagation(); e.preventDefault(); onFileClick(dfrevId, e.currentTarget as HTMLElement); } : undefined}
          style={{ ...chipStyle, cursor: onFileClick && dfrevId ? 'pointer' : 'default' }}
        >
          <FileGlyph />
          <RefPrefix />
          {friendly}
        </span>
      );
    }
    // Canonical `#ref[...]` marker — classify body and pick the label.
    const refMatch = part.match(/^#ref\[([^\]]*)\]$/);
    if (refMatch) {
      const body = refMatch[1] || '';
      let label = body;
      let dfrevId: string | null = null;
      const pin = body.match(/^([a-z][a-z0-9_]*):([^|]+)(?:\|(.*))?$/);
      if (pin) {
        const scheme = pin[1];
        const value = pin[2];
        const pinLabel = pin[3] || null;
        if (scheme === 'file' && /^dfrev_|^df_/.test(value)) {
          dfrevId = value;
          const refEntry = byId.get(value);
          label = refEntry?.filename || pinLabel || value;
        } else {
          // Non-file scheme, or the filename-only export form (no df_/dfrev_ prefix).
          label = pinLabel || value;
        }
      }
      return (
        <span
          key={i}
          data-ref-citation={scopeId && dfrevId ? `${scopeId}|${dfrevId}` : undefined}
          style={{ ...chipStyle, cursor: dfrevId && onFileClick ? 'pointer' : 'default' }}
          onClick={dfrevId && onFileClick ? (e) => { e.stopPropagation(); e.preventDefault(); onFileClick(dfrevId!, e.currentTarget as HTMLElement); } : undefined}
        >
          <FileGlyph />
          <RefPrefix />
          {label}
        </span>
      );
    }
    // Intra-document page pointer: `#pg_N` or `#pg_N[x1=...,y1=...,x2=...,y2=...]`
    const pgMatch = part.match(/^#pg_(\d+)(?:\[([^\]]*)\])?$/);
    if (pgMatch) {
      const page = parseInt(pgMatch[1], 10);
      const body = pgMatch[2] || '';
      const coords: Record<string, number> = {};
      body.split(',').forEach(kv => {
        const [k, v] = kv.split('=').map(s => s?.trim() ?? '');
        const n = parseFloat(v);
        if (k && Number.isFinite(n)) coords[k] = n;
      });
      const hasCoords = ['x1', 'y1', 'x2', 'y2'].every(k => k in coords);
      const target = hasCoords
        ? { page, x1: coords.x1, y1: coords.y1, x2: coords.x2, y2: coords.y2 }
        : { page };
      return (
        <span
          key={i}
          style={{ ...chipStyle, ...pgChipStyle, cursor: onPageClick ? 'pointer' : 'default' }}
          onClick={onPageClick ? (e) => { e.stopPropagation(); e.preventDefault(); onPageClick(target, e.currentTarget as HTMLElement); } : undefined}
          title={hasCoords ? `Jump to page ${page} (highlighted region)` : `Jump to page ${page}`}
        >
          <PageGlyph />
          p.{page}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/**
 * Scrollable, vertically-stacked PDF preview using react-pdf.
 * `file` must be a stable string reference (e.g. cached dataUrl) so react-pdf
 * does not re-parse on unrelated re-renders.
 *
 * `highlightValue` (optional): every occurrence inside the PDF text layer is
 * wrapped in a `<mark>` by `customTextRenderer`. After render the first mark
 * is scrolled into view. Text layer is enabled only when we have a value.
 */
function PdfPreview({
  file,
  width,
  highlightValue,
  initialPage,
}: {
  file: string;
  width: number;
  highlightValue?: string | null;
  // 0-indexed page to scroll to on mount. Used for `check.data.ref_page`
  // navigation so the ref viewer opens at the page the AI actually cited,
  // not the top of the document. Overridden by `highlightValue` scroll
  // when both are present (value-targeted scroll wins — it's more specific).
  initialPage?: number | null;
}) {
  const [numPages, setNumPages] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // react-pdf is sensitive to the identity AND shape of `file`. Passing a
  // raw base64 data URL string means every re-render where the string
  // identity looks different triggers Document to re-parse the PDF from
  // scratch. We keep Document's input as a memoized `{ data: Uint8Array }`
  // object keyed on the payload, so:
  //   - identity is stable across zoom/drag/resize/highlight changes
  //   - PDF.js receives the binary directly (no base64 re-decode per load)
  //   - loading completes once and stays done even under React StrictMode
  //     double-invocation in dev (a common cause of the "Rendering PDF…"
  //     perma-spinner seen in the viewer).
  const pdfSource = useMemo(() => {
    if (!file) return null;
    const comma = file.indexOf(',');
    const b64 = comma >= 0 ? file.slice(comma + 1) : file;
    try {
      const bin = atob(b64);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return { data: bytes };
    } catch (e) {
      console.error('[PdfPreview] failed to decode base64 PDF payload:', e);
      return null;
    }
  }, [file]);

  // Reset error and page count whenever the source actually changes.
  // Without this, if the first load failed and the viewer is reopened
  // with a different file, the stale error state blocks rendering.
  useLayoutEffect(() => {
    setLoadError(null);
    setNumPages(0);
  }, [pdfSource]);

  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c]);

  // Per-item progressive matching: the incoming `highlightValue` is already
  // the variant that appears in the combined text content, but PDF.js text
  // layer splits strings across `item.str` boundaries. A value like
  // `SLD-Q-2026-0221` may be joined in text content yet rendered as separate
  // spans (`SLD-Q-2026-` | `0221`). For each item we walk variants from
  // longest to shortest and use the first that matches that specific item.
  const customTextRenderer = useMemo(() => {
    const variants = buildHighlightVariants(highlightValue);
    if (variants.length === 0) return undefined;
    return (item: { str: string }) => {
      for (const variant of variants) {
        const pattern = new RegExp(`(${escapeRegExp(variant)})`, 'gi');
        if (!pattern.test(item.str)) continue;
        const p = new RegExp(`(${escapeRegExp(variant)})`, 'gi');
        const parts = item.str.split(p);
        return parts.map((part, i) => (i % 2 === 1
          ? `<mark class="ref-hl">${escapeHtml(part)}</mark>`
          : escapeHtml(part))).join('');
      }
      return escapeHtml(item.str);
    };
  }, [highlightValue]);

  // After pages render and a highlightValue exists, scroll first mark into view.
  useLayoutEffect(() => {
    if (!highlightValue) return;
    // Poll briefly — react-pdf renders text layers async per page.
    let tries = 0;
    const timer = window.setInterval(() => {
      tries++;
      const el = containerRef.current?.querySelector('mark.ref-hl') as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.clearInterval(timer);
      } else if (tries > 20) {
        window.clearInterval(timer);
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [highlightValue, numPages, file]);

  // If `initialPage` is set and there's no highlightValue to scroll to,
  // scroll to the requested page. Uses data-page-number attribute that
  // react-pdf writes on each page wrapper. 0-indexed in, 1-indexed
  // attribute.
  useLayoutEffect(() => {
    if (highlightValue) return; // value-targeted scroll takes precedence
    if (initialPage == null || initialPage < 0 || numPages === 0) return;
    const pageNum = initialPage + 1;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries++;
      const el = containerRef.current?.querySelector(`[data-page-number="${pageNum}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.clearInterval(timer);
      } else if (tries > 30) {
        window.clearInterval(timer);
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [initialPage, numPages, file, highlightValue]);

  return (
    <div ref={containerRef}>
      <style>{`
        /* The PDF text layer sits OVER the canvas with transparent text, so
           the highlight background must be translucent for the printed text
           below to remain legible. Semi-transparent rgba works everywhere.
           The outline reuses the ref-file theme accent so the highlight
           matches citation links, chips, and the viewer tab. */
        .ref-pdf-preview .textLayer mark.ref-hl {
          background: ${REF_FILE_THEME.markBgTranslucent};
          color: transparent;
          border-radius: 2px;
          padding: 0;
          box-shadow: 0 0 0 1px ${REF_FILE_THEME.markOutline};
        }
        .ref-md-wrap mark.ref-hl { background: ${REF_FILE_THEME.markBgSolid}; color: #111; border-radius: 2px; padding: 0 2px; }
        /* Give each PDF page a subtle card so multi-page refs have a
           visible boundary between pages (requested UX). Border + soft
           shadow mimic a sheet of paper on a neutral background. */
        .ref-pdf-preview .react-pdf__Page {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 3px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
          overflow: hidden;
          margin: 0 auto;
        }
      `}</style>
      <div className="ref-pdf-preview" style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: '#f3f4f6', padding: '8px' }}>
        {loadError && (
          <div style={{ color: '#b91c1c', fontSize: '12px', padding: '1rem' }}>
            PDF failed to render: {loadError}
          </div>
        )}
        {pdfSource && !loadError && (
        <Document
          file={pdfSource}
          loading={<div style={{ padding: '1rem', color: '#888' }}>Rendering PDF…</div>}
          error={<div style={{ color: '#b91c1c', fontSize: '12px', padding: '1rem' }}>PDF failed to render.</div>}
          onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
          onLoadError={(err) => setLoadError(err?.message || String(err))}
          onSourceError={(err) => setLoadError(err?.message || String(err))}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <React.Fragment key={i}>
              <Page
                pageNumber={i + 1}
                width={width}
                renderTextLayer={!!highlightValue}
                renderAnnotationLayer={false}
                customTextRenderer={customTextRenderer}
              />
              {/* Separator label between pages — sits in the gap rather than
                  as an on-page watermark so it doesn't overlap content. */}
              {numPages > 1 && i < numPages - 1 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '2px 4px',
                  fontSize: '10px',
                  fontFamily: 'ui-monospace, monospace',
                  color: '#9ca3af',
                  userSelect: 'none',
                }}>
                  <div style={{ flex: 1, height: 1, background: '#d1d5db' }} />
                  <span>Page {i + 2} / {numPages}</span>
                  <div style={{ flex: 1, height: 1, background: '#d1d5db' }} />
                </div>
              )}
            </React.Fragment>
          ))}
        </Document>
        )}
      </div>
    </div>
  );
}

/**
 * Post-processes `marked` HTML to wrap occurrences of `value` in
 * `<mark class="ref-hl">`. Uses the same variant ladder as the PDF path:
 * longest-first, falls through to shorter tokens so a `data.ref` of
 * `"Quote SLD-Q-2026-0221"` still highlights the bare identifier when
 * the leading word isn't present. Matches are applied only inside text
 * nodes — HTML tag content is skipped so attribute values aren't broken.
 */
function highlightValueInHtml(html: string, value: string | null | undefined): string {
  const variants = buildHighlightVariants(value);
  if (variants.length === 0) return html;
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.split(/(<[^>]+>)/g).map((chunk, i) => {
    if (i % 2 !== 0) return chunk;
    for (const v of variants) {
      const pat = new RegExp(`(${escapeRegExp(v)})`, 'gi');
      if (!pat.test(chunk)) continue;
      return chunk.replace(
        new RegExp(`(${escapeRegExp(v)})`, 'gi'),
        '<mark class="ref-hl">$1</mark>',
      );
    }
    return chunk;
  }).join('');
}

/**
 * Build a list of highlight candidates derived from `raw`, longest first.
 *
 * Two strategies combined:
 *  - **Whitespace tokens** — AI `data.ref` often arrives with leading/
 *    trailing context words (`"Quote SLD-Q-2026-0221"`). Each token of
 *    length ≥ 4 is seeded so we can still match the bare identifier
 *    when the surrounding words aren't in the ref PDF.
 *  - **Tail-shorten each seed** — identifiers that wrap across PDF
 *    text runs (`SLD-Q-2026-` on one line, `0221` on the next) are
 *    emitted as separate items by PDF.js. Dropping the trailing
 *    `[non-alnum][alnum]` pair lets the longer prefix still match in
 *    the first run.
 *
 * Longest-first ordering is what keeps the per-item matcher from
 * falling through to a short substring when a specific match exists.
 */
function buildHighlightVariants(raw: string | null | undefined, maxVariants = 12): string[] {
  if (!raw || !raw.trim()) return [];
  const trimmed = raw.trim();
  const seeds = new Set<string>([trimmed]);
  trimmed.split(/\s+/).forEach((w) => { if (w.length >= 4) seeds.add(w); });

  // Clause-level seeds: when the AI emits a long verbatim sentence like
  // "No charges for administrative tasks, including: filing, copying, …",
  // the full string rarely survives PDF.js text-run splitting (line wraps,
  // column breaks). Any single clause between separators usually does.
  // Splitting on , ; : — – plus parenthesis/bracket boundaries gives us
  // those clauses as extra seeds; we also try pairs of adjacent clauses
  // to catch "tasks, including" style phrases that straddle one comma.
  const CLAUSE_SPLIT = /\s*[,;:()\[\]—–‒·]\s*|\s+[-–—]\s+/;
  const clauses = trimmed.split(CLAUSE_SPLIT).map((c) => c.trim()).filter((c) => c.length >= 8);
  for (const clause of clauses) seeds.add(clause);
  for (let i = 0; i < clauses.length - 1; i++) {
    const pair = `${clauses[i]}, ${clauses[i + 1]}`;
    if (pair.length <= 120) seeds.add(pair);
  }

  const out = new Set<string>();
  for (const seed of seeds) {
    out.add(seed);
    const parts = seed.split(/([^a-zA-Z0-9]+)/);
    let working = parts.slice();
    while (working.length >= 3) {
      working = working.slice(0, -2);
      const cand = working.join('').trim();
      if (cand.length >= 3) out.add(cand);
    }
  }

  return Array.from(out).sort((a, b) => b.length - a.length).slice(0, maxVariants);
}

/**
 * Pick the most specific variant of `raw` that appears in `textContent`,
 * falling back to progressively shorter variants (dropping the trailing
 * alphanumeric segment each time). Max 3 variants.
 *
 * Motivation: checks cite values like `SLD-Q-2026-0221` that can wrap across
 * two PDF text-layer spans (e.g. `SLD-Q-2026-` | `0221`). The joined
 * textContent may also have a line break between them. If the full value
 * isn't in textContent, we try `SLD-Q-2026`, then `SLD-Q`. The returned
 * variant is used as the ONLY pattern for highlighting — never OR-ed with
 * the longer ones, so we don't over-match shorter substrings everywhere
 * when the full value was found.
 *
 * Returns `raw.trim()` when textContent is empty (can't decide) or when no
 * variant matches (will simply produce no highlights, which is the correct
 * "value not found in file" state).
 */
function pickEffectiveHighlightValue(
  raw: string | null | undefined,
  textContent: string | null | undefined,
): string | null {
  const variants = buildHighlightVariants(raw);
  if (variants.length === 0) return null;
  const trimmed = variants[0];
  if (!textContent) return trimmed;
  const lower = textContent.toLowerCase();
  for (const variant of variants) {
    if (lower.includes(variant.toLowerCase())) return variant;
  }
  return trimmed;
}

/**
 * Beam endpoint shape. Carries the center AND the size so the beam renderer
 * can exit/enter a rectangle at its EDGE (the side facing the other anchor)
 * instead of diving straight into the center.
 */
type BeamAnchor = { cx: number; cy: number; w: number; h: number };

/** Build a BeamAnchor from a DOMRect. */
function anchorFromRect(r: DOMRect): BeamAnchor {
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
}

/**
 * Project a line from `rect`'s center toward `from` and return the point
 * where it exits `rect`'s edge. For zero-sized anchors (fallback dot) just
 * returns the center. Used to make beams terminate on the side of a chip /
 * highlight mark nearest to the source, rather than in the middle.
 */
function edgePointToward(rect: BeamAnchor, from: { cx: number; cy: number }): { cx: number; cy: number } {
  const w = Math.max(0, rect.w);
  const h = Math.max(0, rect.h);
  if (w < 4 && h < 4) return { cx: rect.cx, cy: rect.cy };
  const dx = from.cx - rect.cx;
  const dy = from.cy - rect.cy;
  if (dx === 0 && dy === 0) return { cx: rect.cx, cy: rect.cy };
  const halfW = w / 2;
  const halfH = h / 2;
  // Parametric: point on edge where |dx|*t = halfW OR |dy|*t = halfH, whichever smaller.
  const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { cx: rect.cx + dx * t, cy: rect.cy + dy * t };
}

/**
 * The floating reference-file viewer. Extracted from HighlightOverlay so we
 * can keep its internals (tab state derived from props, DOM refs for
 * auto-scroll, etc.) tidy. Rendered only when state is non-null.
 */
interface RefFileViewerProps {
  state: {
    dfrevId: string;
    name: string;
    mimeType: string;
    originalBase64: string | null;
    textContent: string;
    activeTab: 'original' | 'text';
    scopeLabel: string;
    loading: boolean;
    loadError: string | null;
    x: number; y: number;
    highlightValue: string | null;
    refPage: number | null;
    anchor: BeamAnchor | null;
    highlightAnchor: BeamAnchor | null;
    sourceCheckId: string | null;
    citationKey: string | null;
    savingToLibrary: boolean;
    savedToLibrary: boolean;
    width: number;
    height: number;
    visible: boolean;
  };
  minWidth: number;
  minHeight: number;
  overlayContainer: HTMLElement | null;
  suppressBeams?: boolean;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, corner: 'se' | 'sw' | 'ne' | 'nw') => void;
  onClose: () => void;
  onTabChange: (tab: 'original' | 'text') => void;
  onSaveToLibrary: (customName: string) => void;
  // Initial zoom to seed the viewer's local zoom state on mount. Passed
  // through from the shared pose cache / backend view_settings so the
  // viewer reopens at the zoom level the user last left it at.
  initialZoom?: number;
  // Fires whenever zoom changes (on Ctrl/Cmd-wheel or the zoom buttons)
  // so the parent can persist it to view_settings. Debounced at the call
  // site; here we just call on every change.
  onZoomChange?: (zoom: number) => void;
  // Source check's highlight colour (red for failed, green for passed, etc.)
  // Used to tint the beam that originates from the highlight rectangle so it
  // matches what the user sees on the document. Falls back to the ref-file
  // theme accent when unknown (e.g. no current check).
  checkHighlightColor?: string | null;
}

export function RefFileViewer({ state: v, minWidth, minHeight, overlayContainer, suppressBeams, onDragStart, onResizeStart, onClose, onTabChange, onSaveToLibrary, initialZoom, onZoomChange, checkHighlightColor }: RefFileViewerProps) {
  // Portaled to document.body so Tailwind's `dark:` variant inside wouldn't
  // apply from an ancestor — read the resolved theme via context and branch
  // inline styles so the viewer matches the app's day/night mode.
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const theme = {
    panelBg: isDark ? '#111827' : 'white',            // gray-900 / white
    panelBorder: isDark ? 'rgba(253, 230, 138, 0.22)' : 'rgba(180, 83, 9, 0.18)',
    headerBg: isDark ? '#1f2937' : '#eff6ff',         // gray-800 / blue-50
    headerBorder: isDark ? '#374151' : REF_FILE_THEME.markBgSolid,
    textPrimary: isDark ? '#f3f4f6' : '#111',         // gray-100 / gray-900
    textSecondary: isDark ? '#9ca3af' : '#6b7280',    // gray-400 / gray-500
    textTertiary: isDark ? '#9ca3af' : '#374151',     // gray-400 / gray-700
    controlBg: isDark ? '#111827' : 'white',
    controlBorder: isDark ? '#374151' : '#e5e7eb',
    inputBg: isDark ? '#0f172a' : 'white',            // slate-900 / white
    inputBorder: isDark ? '#374151' : '#d1d5db',
    magnifierOnBg: isDark ? '#312e81' : '#eef2ff',    // indigo-900 / indigo-50
    magnifierOnText: isDark ? '#c7d2fe' : '#4338ca',  // indigo-200 / indigo-700
    savedBg: isDark ? '#064e3b' : '#ecfdf5',          // emerald-900 / emerald-50
    savedText: isDark ? '#6ee7b7' : '#047857',        // emerald-300 / emerald-700
    overlay: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)',
  };
  // Sticky "last-good" center of the originating check highlight rectangle.
  // The recompute effect refreshes this on scroll / zoom; if the element
  // isn't found or has zero size, we INTENTIONALLY keep the last known
  // value rather than snap to the frozen click-time `v.highlightAnchor`,
  // which becomes stale the moment the user scrolls. Initial seed is the
  // click-time anchor so the first frame draws a beam.
  const [liveHighlightAnchor, setLiveHighlightAnchor] = useState<BeamAnchor | null>(v.highlightAnchor);
  const effectiveHighlightAnchor = liveHighlightAnchor;
  const isPdf = v.mimeType === 'application/pdf';
  const isImage = v.mimeType.startsWith('image/');
  const hasPreview = v.originalBase64 != null && (isPdf || isImage);
  // Memoize dataUrl so react-pdf sees a stable file prop across re-renders
  // while the same ref file is open (beam animation, tab switch, etc.).
  const dataUrl = useMemo(
    () => (v.originalBase64 ? `data:${v.mimeType};base64,${v.originalBase64}` : null),
    [v.originalBase64, v.mimeType],
  );
  const innerPdfWidth = v.width - 32;
  const textRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Effective value to actually highlight: the longest variant of
  // v.highlightValue that appears in v.textContent. Falls back through
  // progressively shorter variants only when the full value isn't present.
  // Unlike OR-ing variants into one regex, this guarantees exactly one
  // variant is highlighted — no spurious matches from short prefixes.
  // Base (prefilled) value derived from the incoming highlight request.
  const baseHighlightValue = useMemo(
    () => pickEffectiveHighlightValue(v.highlightValue, v.textContent),
    [v.highlightValue, v.textContent],
  );
  // User-editable override of the highlight search. Reset on every new
  // citation click (a fresh `v.citationKey` or base value) so clicking
  // a different ref pill always starts from that check's `data.ref`
  // and ignores the previous session's typed edits.
  const [highlightOverride, setHighlightOverride] = useState<string | null>(null);
  useLayoutEffect(() => {
    setHighlightOverride(null);
  }, [v.citationKey, baseHighlightValue]);
  const effectiveHighlightValue = (highlightOverride ?? baseHighlightValue) || null;

  // Center (in viewport coords) of the first `mark.ref-hl` rendered inside
  // the viewer. When present, beams terminate at this point instead of the
  // popup's edge — so the line visually connects the label directly to the
  // matched value inside the reference file.
  const [markAnchor, setMarkAnchor] = useState<BeamAnchor | null>(null);

  // "Keep last-good" strategy — same as liveLabelAnchor / liveHighlightAnchor.
  // react-pdf destroys + recreates the text layer on zoom / width changes
  // (and sometimes on scroll), during which `mark.ref-hl` briefly vanishes.
  // If we nulled `markAnchor` on every miss, the beam would snap to the
  // lens center for a frame, then back — visible as "beam stops pointing at
  // the value when I drag the lens" because the poll timing overlaps with
  // layout churn. Keeping the last-known position keeps the beam locked on
  // the value through transient DOM flicker.
  const recomputeMarkAnchor = React.useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;                           // keep last-good
    // `buildHighlightVariants` produces multiple match seeds (full sentence +
    // single clauses + individual words) so a long `data.ref` often produces
    // SEVERAL `mark.ref-hl` elements on the page. `querySelector` returns the
    // FIRST in DOM order, which is usually the earliest short-word match
    // (e.g. "No charges for" at the admin-tasks bullet) rather than the
    // complete verbatim sentence the AI actually cited (e.g. "No charges
    // for training or supervising junior attorneys on routine tasks." at
    // the next bullet). Pick the element whose text content is LONGEST —
    // that's the most specific match and the one the beam should target.
    const marks = Array.from(panel.querySelectorAll('mark.ref-hl')) as HTMLElement[];
    if (marks.length === 0) return;                // keep last-good
    let el = marks[0];
    let bestLen = (el.textContent || '').trim().length;
    for (let i = 1; i < marks.length; i++) {
      const m = marks[i];
      const mr0 = m.getBoundingClientRect();
      // Skip invisible/off-layout marks (text-layer transient state during
      // re-render) so they don't win by length when they're not painted.
      if (mr0.width === 0 && mr0.height === 0) continue;
      const len = (m.textContent || '').trim().length;
      if (len > bestLen) { el = m; bestLen = len; }
    }
    const mr = el.getBoundingClientRect();
    if (mr.width === 0 && mr.height === 0) return; // keep last-good
    const pr = panel.getBoundingClientRect();
    // Clip CENTER to the panel bounds so the beam doesn't dive off-screen
    // when the mark has scrolled outside the visible area; keep the mark's
    // OWN width/height so beams still enter at the correct side.
    const cx = Math.min(Math.max(mr.left + mr.width / 2, pr.left), pr.right);
    const cy = Math.min(Math.max(mr.top + mr.height / 2, pr.top), pr.bottom);
    setMarkAnchor({ cx, cy, w: mr.width, h: mr.height });
  }, []);

  // Reset markAnchor ONLY when the context actually changes (new file, new
  // search value, new tab). Polling/scroll never nulls — it only updates.
  useLayoutEffect(() => {
    setMarkAnchor(null);
  }, [v.dfrevId, v.highlightValue, v.activeTab]);

  // Zoom level for the Original tab PDF and the Text tab font scaling.
  // 1.0 = default; range 0.5–3.0. Declared ahead of the polling effect
  // below so the effect can depend on zoom without a TDZ error.
  const [zoom, setZoom] = useState<number>(typeof initialZoom === 'number' ? Math.max(0.5, Math.min(3.0, initialZoom)) : 1.0);
  const zoomIn = () => setZoom(z => Math.min(3.0, +(z + 0.1).toFixed(2)));
  const zoomOut = () => setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(2)));
  const zoomReset = () => setZoom(1.0);
  // Notify the parent whenever zoom changes so it can persist. Use an
  // effect so wheel-zoom + button zooms + programmatic sets all funnel
  // through one call. The parent debounces internally via its save path.
  useEffect(() => {
    if (onZoomChange) onZoomChange(zoom);
  }, [zoom, onZoomChange]);

  // Poll briefly after open / tab switch / new highlight — the PDF text
  // layer is rendered asynchronously so the mark may not exist yet.
  // On zoom change the mark re-renders at a different position (and may
  // fall off-screen horizontally); once we find it, scroll the inner
  // content container so the mark is centered in view. Without this the
  // lens hovers over a clamped panel-edge coordinate while the real
  // value has scrolled out of the viewer — user sees magnified labels
  // with empty value columns.
  useLayoutEffect(() => {
    if (!v.highlightValue) return;
    let tries = 0;
    let scrolled = false;
    const t = window.setInterval(() => {
      tries++;
      recomputeMarkAnchor();
      if (!scrolled) {
        const panel = panelRef.current;
        const container = contentRef.current;
        const el = panel?.querySelector('mark.ref-hl') as HTMLElement | null;
        if (el && container) {
          const mr = el.getBoundingClientRect();
          const cr = container.getBoundingClientRect();
          if (mr.width > 0 && mr.height > 0) {
            const outsideX = mr.left < cr.left || mr.right > cr.right;
            const outsideY = mr.top < cr.top || mr.bottom > cr.bottom;
            if (outsideX || outsideY) {
              const dx = (mr.left + mr.width / 2) - (cr.left + cr.width / 2);
              const dy = (mr.top + mr.height / 2) - (cr.top + cr.height / 2);
              container.scrollLeft += dx;
              container.scrollTop += dy;
            }
            scrolled = true;
          }
        }
      }
      if (tries > 30) window.clearInterval(t);
    }, 120);
    return () => window.clearInterval(t);
  }, [v.highlightValue, v.activeTab, v.originalBase64, v.textContent, zoom, recomputeMarkAnchor]);

  // Keep `markAnchor` in sync with content scroll / viewport resize / zoom —
  // any of these shift the mark's viewport position without mutating the DOM,
  // so the MutationObserver below wouldn't catch them. Window-level capture
  // scroll picks up scroll events on ANY descendant element (including the
  // ref viewer's inner content div), so a zoom/pan inside the viewer updates
  // the mark anchor too. Low-frequency interval is the safety net for
  // anything the event listeners miss (e.g. programmatic scrollIntoView).
  useLayoutEffect(() => {
    if (!v.highlightValue) return;
    const onChange = () => recomputeMarkAnchor();
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    const i = window.setInterval(onChange, 200);
    return () => {
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
      window.clearInterval(i);
    };
  }, [v.highlightValue, recomputeMarkAnchor]);

  // Recompute on popup drag / resize (state x/y/w/h) — the mark moves with
  // the popup so the beam endpoint must follow.
  useLayoutEffect(() => {
    recomputeMarkAnchor();
  }, [v.x, v.y, v.width, v.height, recomputeMarkAnchor]);

  // Sticky "last-good" center of the clicked citation label span. Same
  // rationale as `liveHighlightAnchor` — DOM misses keep the last position
  // instead of falling back to stale click-time coords.
  const [liveLabelAnchor, setLiveLabelAnchor] = useState<BeamAnchor | null>(v.anchor);
  const effectiveLabelAnchor = liveLabelAnchor;
  useLayoutEffect(() => {
    if (!v.citationKey) return;
    const recompute = () => {
      const el = document.querySelector(`[data-ref-citation="${CSS.escape(v.citationKey || '')}"]`) as HTMLElement | null;
      if (!el) return; // keep last-good
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return; // keep last-good
      setLiveLabelAnchor(anchorFromRect(r));
    };
    recompute();
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    const i = window.setInterval(recompute, 200);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
      window.clearInterval(i);
    };
  }, [v.citationKey, v.x, v.y, v.width, v.height]);

  // Live-track the originating check highlight rectangle (same sticky
  // strategy as liveLabelAnchor — keep last-good on temporary miss).
  useLayoutEffect(() => {
    if (!v.sourceCheckId || !overlayContainer) return;
    const recompute = () => {
      const el = overlayContainer.querySelector(`[data-check-id="${v.sourceCheckId}"]`) as HTMLElement | null;
      if (!el) return; // keep last-good
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return; // keep last-good
      setLiveHighlightAnchor(anchorFromRect(r));
    };
    recompute();
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    const i = window.setInterval(recompute, 200);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
      window.clearInterval(i);
    };
  }, [v.sourceCheckId, overlayContainer, v.x, v.y, v.width, v.height]);

  // Catch async text-layer / markdown mutations so the mark anchor updates
  // as soon as the highlight actually enters the DOM. Polling alone misses
  // cases where react-pdf replaces the text layer after our polls stop.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const obs = new MutationObserver(() => recomputeMarkAnchor());
    obs.observe(panel, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [recomputeMarkAnchor]);

  // Magnifier lens — a circular canvas that samples the PDF page's rasterized
  // canvas beneath the lens and draws it back at ~2× scale. Two modes:
  //   1. Value found → lens starts centered on the match, so the user sees
  //      the matched value enlarged in-place. Draggable afterwards.
  //   2. Value NOT found → lens starts at the viewer's center (replaces the
  //      old fallback dot). The user drags it to any spot in the ref doc
  //      they want to inspect up close.
  // PDF-only; the Text tab already shows the value at legible size.
  const lensCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [lensPos, setLensPos] = useState<{ x: number; y: number } | null>(null);
  // Session-level toggle for the magnifier lens. Defaults OFF; user can
  // click the Magnifier button in the viewer header to enable it for
  // the current tab session (persists across viewer opens + component
  // remounts in this tab). Resets to OFF on browser refresh.
  const [magnifierEnabled, setMagnifierEnabledState] = useState<boolean>(sharedMagnifierEnabled.value);
  const setMagnifierEnabled = React.useCallback((updater: boolean | ((prev: boolean) => boolean)) => {
    setMagnifierEnabledState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      sharedMagnifierEnabled.value = next;
      return next;
    });
  }, []);
  // Once the user drags the lens, stop auto-snapping it back on each mark
  // recompute / scroll. Reset when the viewer context (file or search value)
  // changes so each new ref click starts fresh.
  const userMovedLensRef = useRef(false);
  // Rectangular magnifier bar. Spans the viewer's full width and moves
  // vertically only — mirrors a physical rectangular magnifying glass
  // and is easier to position over a specific line than the old circle.
  // Width tracks the panel; height stays fixed so the visible strip
  // stays predictable on resize. Reacts to panel resizes via observer.
  const [lensDims, setLensDims] = useState<{ w: number; h: number }>({ w: 320, h: 120 });
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const recompute = () => {
      const rect = panel.getBoundingClientRect();
      const w = Math.max(200, Math.round(rect.width - 16));
      const h = 180; // fixed bar height; taller for better readability while still leaving room to drag above/below
      setLensDims({ w, h });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(panel);
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, []);
  const LENS_W = lensDims.w;
  const LENS_H = lensDims.h;
  // Legacy square-size reference kept because beam targeting + sampling
  // math was written against a single "LENS_SIZE". For the rectangular
  // bar we give each axis its own size.
  const LENS_SIZE = LENS_H; // vertical extent — used in lens-inside-beam guards
  const LENS_MAGNIFICATION = 2.2;

  // Reset the user-moved flag whenever a new ref file is opened or the
  // highlighted value changes (different check clicked → different target).
  useLayoutEffect(() => {
    userMovedLensRef.current = false;
  }, [v.dfrevId, v.highlightValue, v.activeTab]);

  // Keep the lens entirely inside the ref-viewer panel. The lens magnifies
  // the ref doc, so it shouldn't be draggable outside the viewer bounds.
  // Handles the edge case where the panel is narrower than the lens by
  // flooring the max at the min (otherwise Math.min/max would produce NaN).
  const clampLensToPanel = React.useCallback((pos: { x: number; y: number }, panelRect: DOMRect) => {
    const margin = 8;
    // Horizontal position is fixed — bar spans the panel width so `x` is
    // always the panel's left edge plus margin. Only `y` is user-movable.
    const x = panelRect.left + margin;
    const minY = panelRect.top + margin;
    const maxY = Math.max(minY, panelRect.bottom - LENS_H - margin);
    return {
      x,
      y: Math.min(Math.max(pos.y, minY), maxY),
    };
  }, [LENS_H]);

  // Auto-position the lens: on mark → center on mark; no mark → center on
  // viewer. Skipped once the user has dragged the lens so manual placement
  // sticks. Shown for ANY PDF ref view (no highlightValue required) — the
  // lens is a manual inspection tool too, useful even when the AI didn't
  // extract a specific value to match.
  useLayoutEffect(() => {
    if (v.mimeType !== 'application/pdf') { setLensPos(null); return; }
    if (userMovedLensRef.current) return;
    const panel = panelRef.current;
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    // Bar x is always clamped to the panel; y centers on the mark (if
    // found) or the panel center (fallback).
    const raw = markAnchor
      ? { x: panelRect.left, y: markAnchor.cy - LENS_H / 2 }
      : { x: panelRect.left, y: panelRect.top + panelRect.height / 2 - LENS_H / 2 };
    setLensPos(clampLensToPanel(raw, panelRect));
  }, [markAnchor, v.mimeType, clampLensToPanel, LENS_H]);

  // Keep the lens glued to the ref-viewer panel when the user drags the
  // panel around. Without this, the panel moves but the lens stays at the
  // old viewport position — making it look detached from the document
  // it's meant to magnify. We track the previous panel origin and apply
  // the same delta to `lensPos`, regardless of whether the lens is in
  // auto-position mode or the user has manually placed it (offset is
  // preserved either way). Resize also re-clamps so the lens can't fall
  // outside the panel when the user shrinks the viewer.
  const prevPanelBoundsRef = useRef({ x: v.x, y: v.y, w: v.width, h: v.height });
  useLayoutEffect(() => {
    const prev = prevPanelBoundsRef.current;
    const dx = v.x - prev.x;
    const dy = v.y - prev.y;
    const resized = prev.w !== v.width || prev.h !== v.height;
    prevPanelBoundsRef.current = { x: v.x, y: v.y, w: v.width, h: v.height };
    if (dx === 0 && dy === 0 && !resized) return;
    setLensPos(current => {
      if (!current) return current;
      const panel = panelRef.current;
      const moved = { x: current.x + dx, y: current.y + dy };
      return panel ? clampLensToPanel(moved, panel.getBoundingClientRect()) : moved;
    });
  }, [v.x, v.y, v.width, v.height, clampLensToPanel]);

  // Paint the lens: sample whatever is currently under the lens on the PDF
  // page canvas. Shows blank when the lens is dragged off the canvas area.
  const redrawLens = React.useCallback(() => {
    if (!lensPos) return;
    if (v.mimeType !== 'application/pdf') return;
    const panel = panelRef.current;
    if (!panel) return;
    // Pick the canvas that actually sits under the lens center — not the
    // first page canvas. With a multi-page PDF, scrolling to page 2 leaves
    // page 1's canvas off-screen; naively sampling from it produces an
    // empty / blank lens. We iterate all page canvases and choose the
    // one whose screen rect contains the lens center; fall back to the
    // nearest visible canvas if nothing strictly contains the center.
    const lensCx_ = lensPos.x + LENS_W / 2;
    const lensCy_ = lensPos.y + LENS_H / 2;
    const allCanvases = Array.from(panel.querySelectorAll('.react-pdf__Page canvas')) as HTMLCanvasElement[];
    let sourceCanvas: HTMLCanvasElement | null = null;
    let bestDist = Infinity;
    for (const c of allCanvases) {
      if (!c || c.width === 0) continue;
      const r = c.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (lensCx_ >= r.left && lensCx_ <= r.right && lensCy_ >= r.top && lensCy_ <= r.bottom) {
        sourceCanvas = c;
        break;
      }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.abs(cx - lensCx_) + Math.abs(cy - lensCy_);
      if (d < bestDist) { bestDist = d; sourceCanvas = c; }
    }
    if (!sourceCanvas || sourceCanvas.width === 0) return;
    const canvasRect = sourceCanvas.getBoundingClientRect();
    if (canvasRect.width === 0 || canvasRect.height === 0) return;

    const pxPerCssX = sourceCanvas.width / canvasRect.width;
    const pxPerCssY = sourceCanvas.height / canvasRect.height;
    // Rectangular bar: source region is the bar's axes divided by the
    // magnification so the drawn patch appears at LENS_MAGNIFICATION×.
    const cssSrcW = LENS_W / LENS_MAGNIFICATION;
    const cssSrcH = LENS_H / LENS_MAGNIFICATION;
    const lensCx = lensPos.x + LENS_W / 2;
    const lensCy = lensPos.y + LENS_H / 2;
    const cssCxInCanvas = lensCx - canvasRect.left;
    const cssCyInCanvas = lensCy - canvasRect.top;

    const sx = Math.max(0, (cssCxInCanvas - cssSrcW / 2) * pxPerCssX);
    const sy = Math.max(0, (cssCyInCanvas - cssSrcH / 2) * pxPerCssY);
    const sw = Math.min(sourceCanvas.width - sx, cssSrcW * pxPerCssX);
    const sh = Math.min(sourceCanvas.height - sy, cssSrcH * pxPerCssY);

    const lens = lensCanvasRef.current;
    if (!lens) return;
    const lctx = lens.getContext('2d');
    if (!lctx) return;
    lctx.save();
    lctx.clearRect(0, 0, LENS_W, LENS_H);
    // Rounded-rect clip so the lens body looks like a magnifier bar
    // (matches the DOM wrapper's borderRadius below).
    const radius = Math.min(16, LENS_H / 2);
    lctx.beginPath();
    lctx.moveTo(radius, 0);
    lctx.lineTo(LENS_W - radius, 0);
    lctx.arcTo(LENS_W, 0, LENS_W, radius, radius);
    lctx.lineTo(LENS_W, LENS_H - radius);
    lctx.arcTo(LENS_W, LENS_H, LENS_W - radius, LENS_H, radius);
    lctx.lineTo(radius, LENS_H);
    lctx.arcTo(0, LENS_H, 0, LENS_H - radius, radius);
    lctx.lineTo(0, radius);
    lctx.arcTo(0, 0, radius, 0, radius);
    lctx.closePath();
    lctx.clip();
    lctx.fillStyle = '#f9fafb';
    lctx.fillRect(0, 0, LENS_W, LENS_H);
    if (sw > 0 && sh > 0) {
      lctx.imageSmoothingEnabled = true;
      lctx.imageSmoothingQuality = 'high';
      lctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, LENS_W, LENS_H);
    }
    // Composite the `<mark.ref-hl>` overlays on top of the sampled PDF
    // canvas. The PDF canvas only contains the rendered page pixels —
    // the highlight itself lives in a separate text-layer `<mark>` DOM
    // element, so without this pass the blue highlight vanishes whenever
    // the lens is dragged over the matched value.
    //
    // Viewport→lens coord transform (CSS pixels):
    //   localX = (cssX - lensCx) * LENS_MAGNIFICATION + LENS_SIZE/2
    // because the lens magnifies a `cssSrcSize = LENS_SIZE / MAG` region
    // centred on `lensCx, lensCy`.
    const marks = panel.querySelectorAll('mark.ref-hl');
    if (marks.length > 0) {
      marks.forEach((markEl) => {
        const mr = (markEl as HTMLElement).getBoundingClientRect();
        if (mr.width === 0 && mr.height === 0) return;
        const localX = (mr.left - lensCx) * LENS_MAGNIFICATION + LENS_W / 2;
        const localY = (mr.top - lensCy) * LENS_MAGNIFICATION + LENS_H / 2;
        const localW = mr.width * LENS_MAGNIFICATION;
        const localH = mr.height * LENS_MAGNIFICATION;
        if (localX + localW < 0 || localX > LENS_W) return;
        if (localY + localH < 0 || localY > LENS_H) return;
        lctx.fillStyle = REF_FILE_THEME.markBgTranslucent;
        lctx.fillRect(localX, localY, localW, localH);
        lctx.strokeStyle = REF_FILE_THEME.markOutline;
        lctx.lineWidth = 1.5;
        lctx.strokeRect(localX, localY, localW, localH);
      });
    }
    lctx.restore();
  }, [v.mimeType, lensPos]);

  // Redraw whenever the lens moves, the PDF re-renders, or the viewer
  // scrolls/resizes. Cheap because only the small lens canvas is repainted.
  useLayoutEffect(() => {
    if (!lensPos) return;
    redrawLens();
    const id = window.setInterval(redrawLens, 200);
    const onScroll = () => redrawLens();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [lensPos, redrawLens]);

  // Drag the lens: user clicks the lens → tracks mouse until mouseup. Marks
  // userMovedLensRef so subsequent auto-positioning passes skip.
  const handleLensMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    userMovedLensRef.current = true;
    const startY = e.clientY;
    const origin = lensPos || { x: 0, y: 0 };
    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const panel = panelRef.current;
      // Only vertical movement — x is clamped to the panel width by
      // clampLensToPanel below.
      const raw = { x: origin.x, y: origin.y + (ev.clientY - startY) };
      setLensPos(panel ? clampLensToPanel(raw, panel.getBoundingClientRect()) : raw);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [lensPos, clampLensToPanel]);

  // Block native wheel propagation so Ctrl/Cmd+scroll doesn't reach the main
  // document viewer's zoom handler (which is attached to an ancestor scroll
  // container). React's SyntheticEvent stopPropagation fires at the root and
  // cannot stop native listeners attached to intermediate DOM ancestors.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.stopPropagation();
      // Ctrl/Cmd + wheel → zoom the ref viewer (instead of the browser or
      // the main doc viewer behind us). Uses the state updater form so this
      // handler doesn't close over stale `zoom` values.
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) setZoom(z => Math.min(3.0, +(z + 0.1).toFixed(2)));
        else if (e.deltaY > 0) setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(2)));
      }
    };
    panel.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => panel.removeEventListener('wheel', onNativeWheel);
  }, []);

  // Click-and-drag to pan the PDF / image content area. Native vertical
  // scrolling still works via wheel/trackpad; this adds the "hand tool"
  // behavior users expect from PDF viewers (Acrobat, Chrome's built-in
  // viewer) so they can scroll a zoomed-in preview with the mouse.
  //
  // Only applied to the Original tab when the content is a PDF or image —
  // the text/csv tabs let users select text normally.
  // We disable user-select on the container during pan so the PDF text
  // layer (which has `user-select: text` for copy support) doesn't start a
  // drag-selection when the user intends to pan.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const pannable = (isPdf || isImage) && (v.activeTab === 'original' || !REF_TEXT_TAB_ENABLED);
    if (!pannable) {
      el.style.cursor = '';
      el.style.userSelect = '';
      (el.style as any).webkitUserSelect = '';
      return;
    }
    el.style.cursor = 'grab';
    el.style.userSelect = 'none';
    (el.style as any).webkitUserSelect = 'none';

    let startX = 0, startY = 0, startScrollL = 0, startScrollT = 0;
    let pressed = false;
    let panning = false;
    const THRESHOLD = 4;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      pressed = true;
      panning = false;
      startX = e.clientX; startY = e.clientY;
      startScrollL = el.scrollLeft; startScrollT = el.scrollTop;
    };
    const onMove = (e: MouseEvent) => {
      if (!pressed) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!panning && Math.abs(dx) + Math.abs(dy) < THRESHOLD) return;
      if (!panning) {
        panning = true;
        el.style.cursor = 'grabbing';
      }
      el.scrollLeft = startScrollL - dx;
      el.scrollTop = startScrollT - dy;
      e.preventDefault();
    };
    const onUp = () => {
      pressed = false;
      panning = false;
      el.style.cursor = 'grab';
    };

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      el.style.cursor = '';
      el.style.userSelect = '';
      (el.style as any).webkitUserSelect = '';
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPdf, isImage, v.activeTab]);

  // Auto-scroll first highlight into view inside text tab.
  useLayoutEffect(() => {
    if (v.activeTab !== 'text' || !v.highlightValue) return;
    const el = textRef.current?.querySelector('mark.ref-hl') as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [v.activeTab, v.highlightValue, v.textContent]);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  // Auto-close the Save-to-Library dialog if the viewer gets hidden while it
  // was open. Otherwise the dialog would pop up stranded the next time the
  // viewer is shown again, confusing the flow.
  useEffect(() => {
    if (!v.visible && saveDialogOpen) setSaveDialogOpen(false);
  }, [v.visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saveName, setSaveName] = useState(v.name);

  // Esc closes the save-to-library dialog. Mounted only while the dialog is
  // open; capture-phase so we intercept before the viewer's own Esc-closes
  // logic fires (otherwise Esc would close BOTH dialog and viewer in one
  // keypress, dismissing unintended UI).
  useEffect(() => {
    if (!saveDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSaveDialogOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [saveDialogOpen]);

  const tabStyleBase: React.CSSProperties = {
    border: 'none', background: 'none', padding: '6px 10px', cursor: 'pointer',
    fontSize: '12px', fontWeight: 600, color: theme.textSecondary,
    borderBottom: '2px solid transparent',
  };
  const tabActive: React.CSSProperties = { color: theme.textPrimary, borderBottomColor: REF_FILE_THEME.accentColor };

  const renderOriginal = () => {
    if (v.loading) return <div style={{ textAlign: 'center', color: theme.textSecondary, padding: '2rem' }}>Loading preview…</div>;
    if (v.loadError && !dataUrl) return (
      <div style={{ color: isDark ? '#fca5a5' : '#b91c1c', fontSize: '12px', padding: '1rem' }}>
        Failed to load original file: {v.loadError}
      </div>
    );
    if (isPdf && dataUrl) {
      return <PdfPreview file={dataUrl} width={Math.round(innerPdfWidth * zoom)} highlightValue={effectiveHighlightValue} initialPage={v.refPage} />;
    }
    if (isImage && dataUrl) {
      return <img src={dataUrl} alt={v.name} style={{ width: `${100 * zoom}%`, height: 'auto', display: 'block' }} />;
    }
    // Markdown → render rich HTML with val-highlight support.
    if (v.mimeType === 'text/markdown' && v.textContent) {
      const html = highlightValueInHtml(renderMarkdown(v.textContent), effectiveHighlightValue);
      return (
        <div
          ref={textRef}
          className={`ref-md-wrap ${MARKDOWN_PROSE_CLASSES}`}
          style={{ fontSize: `${zoom}em` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
    // Plain text → show as preformatted monospace with val-highlight.
    if (v.mimeType === 'text/plain' && v.textContent) {
      const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      } as Record<string, string>)[c]);
      const withMarks = highlightValueInHtml(escapeHtml(v.textContent), effectiveHighlightValue);
      return (
        <pre
          ref={textRef as any}
          className="ref-md-wrap"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: `${12 * zoom}px`, fontFamily: 'ui-monospace, monospace', color: theme.textPrimary, margin: 0, lineHeight: 1.5, padding: '0.75rem' }}
          dangerouslySetInnerHTML={{ __html: withMarks }}
        />
      );
    }
    // CSV → render as bordered HTML table. Reuses MARKDOWN_PROSE_CLASSES
    // for the table/th/td styling so look matches the rest of the app.
    // val-highlight (`highlightValueInHtml`) is applied per cell so a
    // clicked check's `ref` value lights up the matching CSV cell.
    if (v.mimeType === 'text/csv' && v.textContent) {
      const rows = parseCsv(v.textContent);
      if (rows.length === 0) {
        return <div style={{ color: theme.textSecondary, fontSize: '12px', padding: '1rem' }}>(Empty CSV file.)</div>;
      }
      const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      } as Record<string, string>)[c]);
      const cell = (raw: string) => highlightValueInHtml(escapeHtml(raw), effectiveHighlightValue);
      const [head, ...body] = rows.length > 1 ? [rows[0], ...rows.slice(1)] : [null as any, ...rows];
      return (
        <div
          ref={textRef}
          className={`ref-md-wrap ${MARKDOWN_PROSE_CLASSES}`}
          style={{ fontSize: `${zoom}em` }}
        >
          <table>
            {head && (
              <thead>
                <tr>
                  {head.map((h: string, i: number) => (
                    <th key={i} dangerouslySetInnerHTML={{ __html: cell(h) }} />
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((r: string[], ri: number) => (
                <tr key={ri}>
                  {r.map((c: string, ci: number) => (
                    <td key={ci} dangerouslySetInnerHTML={{ __html: cell(c) }} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return (
      <div style={{ color: theme.textSecondary, fontSize: '12px', padding: '1rem' }}>
        No visual preview for this file type ({v.mimeType}).
      </div>
    );
  };

  const renderText = () => {
    if (!v.textContent) return <div style={{ color: theme.textSecondary, fontSize: '12px', padding: '1rem' }}>(No text content available for this file.)</div>;
    const isMarkdownMime = v.mimeType === 'application/pdf' || v.mimeType.startsWith('image/');
    if (isMarkdownMime) {
      const html = highlightValueInHtml(renderMarkdown(v.textContent), effectiveHighlightValue);
      return (
        <div
          ref={textRef}
          className={`ref-md-wrap ${MARKDOWN_PROSE_CLASSES}`}
          style={{ fontSize: `${zoom}em` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
    // Plain text / csv — escape + inject marks.
    const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    } as Record<string, string>)[c]);
    const escaped = escapeHtml(v.textContent);
    const withMarks = highlightValueInHtml(escaped, effectiveHighlightValue);
    return (
      <pre
        ref={textRef as any}
        className="ref-md-wrap"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: `${12 * zoom}px`, fontFamily: 'ui-monospace, monospace', color: '#333', margin: 0, lineHeight: 1.5 }}
        dangerouslySetInnerHTML={{ __html: withMarks }}
      />
    );
  };

  // Popup rectangle (for beam targeting) — driven by state width/height.
  const popupRect = { x: v.x, y: v.y, w: v.width, h: v.height };

  // When the check's highlightValue isn't present in the ref file (e.g. an
  // invoice line item that doesn't exist on the referenced quote), markAnchor
  // is null. Give the beams a visible terminus INSIDE the viewer body so they
  // don't appear to disappear at the viewer edge. Offset slightly below the
  // geometric center to stay clear of the header strip.
  const fallbackMarkAnchor: BeamAnchor = {
    cx: popupRect.x + popupRect.w / 2,
    cy: popupRect.y + popupRect.h / 2 + 16,
    w: 0, h: 0,
  };

  // Beam endpoint rules:
  //  - Matched value exists in the ref doc → aim at the mark's facing edge.
  //  - No match → aim at the fixed `fallbackMarkAnchor` inside the viewer
  //    panel; a small amber dot is drawn there as a visible terminus.
  //  - Lens correction: when the natural endpoint falls INSIDE the lens,
  //    the magnifier is blowing the mark up ~2.2× so the visible mark
  //    extends far past the tiny real mark coord. Pointing at the real
  //    coord makes the arrow tip land in the middle of the magnified
  //    text, overlaying it. Re-project the target using the MAGNIFIED
  //    mark rect instead, so the arrow tip sits on the visible edge of
  //    the magnified value (at the lens rim).
  const beamTarget = (from: { cx: number; cy: number }) => {
    if (!markAnchor) return edgePointToward(fallbackMarkAnchor, from);
    const raw = edgePointToward(markAnchor, from);
    if (!lensPos) return raw;
    // Rectangular lens containment test — the bar is axis-aligned so an
    // inside/outside check is just bounding-box math (not a circle).
    const lx = lensPos.x;
    const ly = lensPos.y;
    const insideLens = raw.cx >= lx && raw.cx <= lx + LENS_W && raw.cy >= ly && raw.cy <= ly + LENS_H;
    if (!insideLens) return raw;
    const lcx = lx + LENS_W / 2;
    const lcy = ly + LENS_H / 2;
    const magMark: BeamAnchor = {
      cx: lcx + (markAnchor.cx - lcx) * LENS_MAGNIFICATION,
      cy: lcy + (markAnchor.cy - lcy) * LENS_MAGNIFICATION,
      w: markAnchor.w * LENS_MAGNIFICATION,
      h: markAnchor.h * LENS_MAGNIFICATION,
    };
    return edgePointToward(magMark, from);
  };

  return (
    <>
      {/* Beams: fixed full-viewport SVG overlay (non-interactive). zIndex
          sits ABOVE the popup so the lines remain visible when terminating
          on the `<mark>` inside the ref viewer. `pointerEvents: none` keeps
          the popup fully clickable through the SVG. */}
      {v.visible && !suppressBeams && !saveDialogOpen && (effectiveLabelAnchor || effectiveHighlightAnchor) && createPortal(
        // Portaled into document.body so an ancestor transform/filter/opacity
        // on HighlightOverlay's parent tree can't trap the SVG below the
        // popup. Without this, beams sometimes render UNDER the popup even
        // with zIndex 10001.
        <svg
          style={{
            position: 'fixed', top: 0, left: 0,
            width: '100vw', height: '100vh',
            // One level above the lens so the beam/arrow paint OVER the lens
            // face, making it visibly terminate at the value inside the lens
            // instead of being clipped at the lens rim.
            zIndex: 2147483647, pointerEvents: 'none',
          }}
        >
          <defs>
            {/* Arrow markers pinned to the beam's stroke colour so the
                tip fills in cleanly at ~32% opacity. `refX` at the tip
                so the apex sits exactly on the line end (i.e. on the
                target's edge). Beam colours now mirror what the user
                sees on-screen:
                  - label-originating beam → REF_FILE_THEME accent
                    (same colour as the `ref: filename` pill chip)
                  - highlight-originating beam → the check's highlight
                    colour (red for failed, green for passed), passed
                    through from the overlay as `checkHighlightColor`
                Both render semi-transparent (opacity 0.32 on the line,
                0.85 on the arrowhead) so the target text remains
                readable under the beam. */}
            <marker id="beam-arrow-label" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 Z" fill={REF_FILE_THEME.accentColor} opacity="0.85" />
            </marker>
            <marker id="beam-arrow-highlight" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 Z" fill={checkHighlightColor || REF_FILE_THEME.accentColor} opacity="0.85" />
            </marker>
          </defs>
          {(() => {
            const onScreen = (p: BeamAnchor | null): p is BeamAnchor =>
              !!p && p.cx > -20 && p.cx < window.innerWidth + 20 && p.cy > -20 && p.cy < window.innerHeight + 20;
            const targetCenter = markAnchor ?? fallbackMarkAnchor;
            const labelBeamStroke = REF_FILE_THEME.accentColor;
            const highlightBeamStroke = checkHighlightColor || REF_FILE_THEME.accentColor;
            return (
              <>
                {onScreen(effectiveLabelAnchor) && (() => {
                  const from = edgePointToward(effectiveLabelAnchor, targetCenter);
                  const to = beamTarget(from);
                  return (
                    <line
                      x1={from.cx} y1={from.cy}
                      x2={to.cx} y2={to.cy}
                      stroke={labelBeamStroke} strokeWidth={8} strokeLinecap="butt" opacity={0.32}
                      markerEnd="url(#beam-arrow-label)"
                    />
                  );
                })()}
                {onScreen(effectiveHighlightAnchor) && (() => {
                  const from = edgePointToward(effectiveHighlightAnchor, targetCenter);
                  const to = beamTarget(from);
                  return (
                    <line
                      x1={from.cx} y1={from.cy}
                      x2={to.cx} y2={to.cy}
                      stroke={highlightBeamStroke} strokeWidth={8} strokeLinecap="butt" opacity={0.32}
                      markerEnd="url(#beam-arrow-highlight)"
                    />
                  );
                })()}
                {/* No fallback dot — when the value isn't found in the ref
                    doc, the beam arrow alone is enough. The old amber dot
                    looked like a misleading "target" inside the lens. */}
              </>
            );
          })()}
        </svg>,
        document.body,
      )}

      {/* Magnifier bar — rounded rectangle that spans the viewer width and
          samples the PDF page beneath at ~2× scale. User drags it
          vertically only (like a physical rectangular magnifier sliding
          up/down a page). Horizontal position is pinned to the panel so
          it always frames the same slice of the document. */}
      {v.visible && !suppressBeams && !saveDialogOpen && magnifierEnabled && lensPos && createPortal(
        <div
          data-ref-magnifier-lens
          style={{
            position: 'fixed',
            left: lensPos.x,
            top: lensPos.y,
            width: LENS_W,
            height: LENS_H,
            // Stays BELOW the beams SVG (2147483647) so the beam's arrow
            // appears drawn over the lens face, landing at the value
            // visible inside.
            zIndex: 2147483645,
            cursor: 'ns-resize',
            pointerEvents: 'auto',
          }}
          onMouseDown={handleLensMouseDown}
          title="Drag up/down to move the magnifier"
        >
          <canvas
            ref={lensCanvasRef}
            width={LENS_W}
            height={LENS_H}
            style={{
              width: LENS_W,
              height: LENS_H,
              borderRadius: `${Math.min(16, LENS_H / 2)}px`,
              border: '2px solid rgba(217, 119, 6, 0.85)',
              boxShadow: '0 8px 20px rgba(0,0,0,0.22), inset 0 0 12px rgba(255,255,255,0.35)',
              background: '#fff',
              pointerEvents: 'none',
              display: 'block',
            }}
          />
        </div>,
        document.body,
      )}

      {createPortal(
        // Portaled to document.body for the same reason as the beams SVG
        // above: any ancestor in the HighlightOverlay tree that creates a
        // stacking context (transform / filter / will-change / isolation /
        // contain / perspective / mix-blend-mode / positioned with explicit
        // z-index) would nest the popup's `zIndex: 9999` inside that
        // context, making it paint above the body-level SVG even though
        // 2147483646 > 9999. Portaling puts the popup and the SVG as
        // siblings of <body> so z-index compares in the root stacking
        // context and the beams always render on top.
      <div
        ref={panelRef}
        data-ref-viewer-root
        style={{
          position: 'fixed',
          left: v.x,
          top: v.y,
          zIndex: 9999,
          width: `${v.width}px`,
          minWidth: `${minWidth}px`,
          maxWidth: 'calc(100vw - 32px)',
          height: `${v.height}px`,
          minHeight: `${minHeight}px`,
          maxHeight: 'calc(100vh - 32px)',
          // When hidden, keep the subtree mounted (so react-pdf's <Document>
          // stays alive and the next reopen skips the parse) but collapse it
          // out of layout and pointer-events so the user sees nothing.
          display: v.visible ? 'flex' : 'none',
          flexDirection: 'column',
          background: theme.panelBg,
          borderRadius: '10px',
          boxShadow: `0 8px 30px rgba(0,0,0,0.25), 0 0 0 1px ${theme.panelBorder}`,
          pointerEvents: v.visible ? 'auto' : 'none',
          color: theme.textPrimary,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
      >
        {/* Header: three stacked rows so a narrow viewer (default 20% viewport
            width) doesn't force the title, scope label, controls, and close
            button to compete for space on a single line. */}
        <div
          onMouseDown={onDragStart}
          style={{
            display: 'flex', flexDirection: 'column', gap: '6px',
            padding: '8px 8px 8px 6px', borderBottom: `1px solid ${theme.headerBorder}`,
            userSelect: 'none', borderRadius: '10px 10px 0 0',
            background: theme.headerBg, cursor: 'grab',
          }}
        >
          {/* Row 1 — grip · filename · close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <div
              title="Drag to move"
              style={{ padding: '2px', color: theme.textSecondary, display: 'flex', alignItems: 'center', flexShrink: 0, position: 'relative', zIndex: 2 }}
            >
              <GripVertical size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 600, color: theme.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              📎 {v.name}
            </div>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              title="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: theme.textSecondary, padding: '2px 6px', lineHeight: 1, flexShrink: 0, position: 'relative', zIndex: 2 }}
            >
              ✕
            </button>
          </div>

          {/* Row 2 — scope label · zoom · save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: '11px', color: theme.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {v.scopeLabel}
            </div>
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', border: `1px solid ${theme.controlBorder}`, borderRadius: '6px', padding: '2px', background: theme.controlBg, flexShrink: 0 }}
            >
              <button
                onClick={(e) => { e.stopPropagation(); zoomOut(); }}
                disabled={zoom <= 0.5}
                title="Zoom out"
                style={{ background: 'none', border: 'none', cursor: zoom <= 0.5 ? 'default' : 'pointer', fontSize: '13px', color: theme.textTertiary, width: '20px', height: '20px', lineHeight: 1, padding: 0 }}
              >
                −
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); zoomReset(); }}
                title="Reset zoom"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', color: theme.textSecondary, minWidth: '36px', padding: 0, fontWeight: 600 }}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); zoomIn(); }}
                disabled={zoom >= 3.0}
                title="Zoom in"
                style={{ background: 'none', border: 'none', cursor: zoom >= 3.0 ? 'default' : 'pointer', fontSize: '13px', color: theme.textTertiary, width: '20px', height: '20px', lineHeight: 1, padding: 0 }}
              >
                +
              </button>
            </div>
            {/* Magnifier toggle — session-only (resets on page refresh).
                Only shown for PDF/image refs where the lens has something
                to magnify. Labeled button so the action is discoverable
                without relying on icon guess. */}
            {(v.mimeType === 'application/pdf' || v.mimeType.startsWith('image/')) && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setMagnifierEnabled(m => !m); }}
                title={magnifierEnabled ? 'Hide magnifier' : 'Show magnifier'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: magnifierEnabled ? theme.magnifierOnBg : theme.controlBg,
                  border: `1px solid ${theme.controlBorder}`, borderRadius: '6px',
                  cursor: 'pointer', padding: '3px 8px',
                  fontSize: '11px', fontWeight: 600,
                  color: magnifierEnabled ? theme.magnifierOnText : theme.textSecondary,
                  flexShrink: 0, whiteSpace: 'nowrap',
                }}
              >
                <RectMagnifierIcon size={12} off={!magnifierEnabled} />
                Magnifier
              </button>
            )}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); if (!v.savedToLibrary) setSaveDialogOpen(true); }}
              disabled={v.savingToLibrary || v.savedToLibrary}
              title={v.savedToLibrary ? 'Saved to library' : 'Save to library'}
              style={{
                background: v.savedToLibrary ? theme.savedBg : theme.controlBg,
                border: `1px solid ${theme.controlBorder}`, borderRadius: '6px',
                cursor: v.savedToLibrary || v.savingToLibrary ? 'default' : 'pointer',
                fontSize: '11px', fontWeight: 600, color: v.savedToLibrary ? theme.savedText : theme.textTertiary,
                padding: '4px 8px', lineHeight: 1, whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {v.savingToLibrary ? 'Saving…' : v.savedToLibrary ? 'Saved to library' : 'Save to library'}
            </button>
          </div>

          {/* Row 3 — always-visible editable highlight search. Prefilled
              from the AI's `data.ref` for this citation when present;
              empty (with a placeholder) when the check had no verbatim
              locator. Shown for every file type (PDF, image, text,
              markdown). Clicking a different citation resets the
              override so that check's prefill shows again. Standard
              neutral styling — the amber highlight band belongs to the
              matched text inside the ref doc, not to this input. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <input
              type="text"
              value={highlightOverride ?? baseHighlightValue ?? ''}
              onChange={(e) => setHighlightOverride(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              placeholder="Type text to highlight in this reference…"
              spellCheck={false}
              style={{
                flex: 1, minWidth: 0,
                fontSize: '13px', fontWeight: 500,
                color: theme.textPrimary,
                background: theme.inputBg,
                padding: '3px 8px',
                borderRadius: 4,
                border: `1px solid ${theme.inputBorder}`,
                outline: 'none',
              }}
            />
          </div>
        </div>

        {REF_TEXT_TAB_ENABLED && (hasPreview || v.loading) && (
          <div style={{ display: 'flex', borderBottom: `1px solid ${theme.headerBorder}`, background: theme.panelBg }}>
            <button
              onClick={(e) => { e.stopPropagation(); onTabChange('original'); }}
              style={{ ...tabStyleBase, ...(v.activeTab === 'original' ? tabActive : {}) }}
            >
              Original
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onTabChange('text'); }}
              style={{ ...tabStyleBase, ...(v.activeTab === 'text' ? tabActive : {}) }}
            >
              Text
            </button>
          </div>
        )}

        <div
          ref={contentRef}
          onScroll={recomputeMarkAnchor}
          style={{ flex: 1, overflow: 'auto', padding: '12px' }}
        >
          {!REF_TEXT_TAB_ENABLED || v.activeTab === 'original' ? renderOriginal() : renderText()}
        </div>

        {/* Resize handles — one per corner. Bottom-right keeps the
            diagonal-stripe visual affordance; the other three are
            transparent hit-areas (same size) so corners look clean but
            every corner works. Each uses the directionally-correct
            cursor (nwse for BR/TL, nesw for BL/TR). */}
        <div
          onMouseDown={(e) => onResizeStart(e, 'se')}
          title="Resize"
          style={{
            position: 'absolute', right: 0, bottom: 0, width: '14px', height: '14px',
            cursor: 'nwse-resize', borderRadius: '0 0 10px 0',
            background: 'linear-gradient(135deg, transparent 0 45%, #9ca3af 45% 55%, transparent 55% 70%, #9ca3af 70% 80%, transparent 80%)',
          }}
        />
        <div
          onMouseDown={(e) => onResizeStart(e, 'sw')}
          title="Resize"
          style={{
            position: 'absolute', left: 0, bottom: 0, width: '14px', height: '14px',
            cursor: 'nesw-resize', borderRadius: '0 0 0 10px',
          }}
        />
        <div
          onMouseDown={(e) => onResizeStart(e, 'ne')}
          title="Resize"
          style={{
            position: 'absolute', right: 0, top: 0, width: '14px', height: '14px',
            cursor: 'nesw-resize', borderRadius: '0 10px 0 0',
          }}
        />
        <div
          onMouseDown={(e) => onResizeStart(e, 'nw')}
          title="Resize"
          style={{
            position: 'absolute', left: 0, top: 0, width: '14px', height: '14px',
            cursor: 'nwse-resize', borderRadius: '10px 0 0 0',
          }}
        />

      </div>,
        document.body,
      )}

      {/* Save-to-library dialog — portaled to body and given a z-index
          above the beams SVG so nothing inside the viewer overlay tree
          intercepts its clicks. Previously rendered inside the viewer
          panel: SVG/lens portals with higher z-index ate pointer events
          on the OK/Cancel buttons. */}
      {v.visible && saveDialogOpen && createPortal(
        <div
          data-ref-viewer-root
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', inset: 0,
            background: theme.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
            // Above the beams SVG (2147483647 in the lens block). Max
            // 32-bit signed so we sit on top of every other portal.
            zIndex: 2147483647,
            pointerEvents: 'auto',
          }}
        >
          <div style={{ background: theme.panelBg, borderRadius: '8px', padding: '16px', width: '100%', maxWidth: '360px', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', border: `1px solid ${theme.controlBorder}` }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: theme.textPrimary, marginBottom: '4px' }}>Save to library</div>
            <div style={{ fontSize: '12px', color: theme.textSecondary, marginBottom: '10px' }}>This will copy the file into your account library so other envelopes can reference it.</div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: theme.textTertiary, display: 'block', marginBottom: '4px' }}>Name</label>
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', fontSize: '13px', background: theme.inputBg, color: theme.textPrimary, outline: 'none' }}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button
                onClick={() => setSaveDialogOpen(false)}
                style={{ padding: '6px 12px', border: `1px solid ${theme.controlBorder}`, borderRadius: '6px', background: theme.controlBg, cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: theme.textTertiary }}
              >
                Cancel
              </button>
              <button
                onClick={() => { onSaveToLibrary(saveName.trim() || v.name); setSaveDialogOpen(false); }}
                style={{ padding: '6px 12px', border: 'none', borderRadius: '6px', background: '#4f46e5', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: 'white' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Delay (seconds) before rule-hint tooltips fade in on hover — generous
 *  so the hint doesn't flash open from incidental mouseovers during
 *  scanning or reading. Users who actually want the rule details will
 *  settle on the label for more than a moment. */
const RULE_HINT_SHOW_DELAY = '2.5s';

// Module-level in-session cache of the last ref-viewer pose + zoom the user
// placed. Shared across ALL HighlightOverlay instances so closing the viewer
// on one page and reopening on another still restores the pose. Written by
// persistRefViewerPose on drag/resize/zoom end; read by handleRefFileClick
// and the initial zoom state. Backend envelope.view_settings is the
// cross-session fallback once this is null (e.g. after a page reload).
const sharedRefViewerPose: { ref: { x: number; y: number; w: number; h: number; zoom: number } | null } = { ref: null };

// Session-level magnifier toggle. Defaults OFF (user needs to opt in
// per tab session). Persists across viewer opens + HighlightOverlay
// remounts in the same tab, but resets to OFF on browser refresh —
// matches the user's "turn on only when I need it" mental model.
const sharedMagnifierEnabled: { value: boolean } = { value: false };

/**
 * Text tab in the ref file viewer shows a markdown reconstruction of the
 * original file. The reconstruction is best-effort (OCR + layout guess) and
 * can be inaccurate, which confuses users. Suppressed for now — flip to
 * true once the extraction quality is reliable enough for end-user display.
 */
const REF_TEXT_TAB_ENABLED = false;

/**
 * Minimal RFC-4180-lite CSV parser. Handles quoted fields, doubled quotes
 * inside quoted fields (`""`), `\r\n` / `\n` line breaks, trailing newline.
 * No external dependency.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else { field += c; }
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Max words to show before truncating rule text in hint */
const RULE_HINT_TRUNCATE_WORDS = 15;

/** Truncatable rule text with "more"/"less" toggle */
function RuleHintText({ ruleOrder, ruleText }: { ruleOrder: number; ruleText: string }) {
  const [expanded, setExpanded] = useState(false);
  const words = ruleText.split(' ');
  const needsTruncation = words.length > RULE_HINT_TRUNCATE_WORDS;
  const displayText = !expanded && needsTruncation
    ? words.slice(0, RULE_HINT_TRUNCATE_WORDS).join(' ') + '…'
    : ruleText;
  return (
    <span>
      Rule {ruleOrder + 1}: {displayText}
      {needsTruncation && (
        <span
          style={{ cursor: 'pointer', color: '#92610a', textDecoration: 'underline', marginLeft: '4px' }}
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          {expanded ? 'less' : 'more'}
        </span>
      )}
    </span>
  );
}

export interface HighlightOverlayProps {
  // From labelGeometry
  pageHighlights: ICheckForDisplay[];
  labelPlacements: HintPlacementResultExtended[];
  useAdjacentLabels: boolean;
  renderedPageWidth: number;
  renderedPageHeight: number;
  effectiveFontSize: number;
  effectivePadding: number;
  overhangTop: number;
  overhangRight: number;
  overhangBottom: number;
  overhangLeft: number;
  // State
  selectedCheckId: string | null;
  hoveredCheckId: string | null;
  hoveredElementType: 'highlight' | 'label' | null;
  currentPageIndex: number;
  currentReport: IReport | null;
  pendingNewCheck: ICheckForDisplay | null;
  inlineEditCheckId: string | null;
  inlineEditorSize: { width: number; height: number } | null;
  overlappingHighlights: string[];
  currentOverlapIndex: number;
  labelFontScale: number;
  fontFamily?: string;
  highlightMode?: HighlightMode;
  // Drag/resize state
  isDraggingHighlight: boolean;
  isResizingHighlight: boolean;
  draggingLabelId: string | null;
  isResizingLabel: boolean;
  resizeLabelCheckId: string | null;
  resizeLabelHandle: string | null;
  // Flags
  isEditingDisabled: boolean;
  // Functions
  scaleCoordinatesToCurrentViewer: (coordinates: ICoordinates, pageIndex: number) => ICoordinates;
  doRectanglesIntersect: (rect1: ICoordinates, rect2: ICoordinates) => boolean;
  findHighlightsAtPoint: (clickPoint: { x: number; y: number }, pageIndex: number) => ICheckForDisplay[];
  getCheckRuleId: (check: any) => string | null;
  handleHighlightMouseDown: (e: React.MouseEvent, checkId: string, coords: ICoordinates) => void;
  handleHighlightTouchStart: (e: React.TouchEvent, checkId: string, coords: ICoordinates) => void;
  handleResizeMouseDown: (e: React.MouseEvent, checkId: string, handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w') => void;
  handleResizeTouchStart: (e: React.TouchEvent, checkId: string, handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w') => void;
  handleHighlightClick: (e: React.MouseEvent, checkId: string) => void;
  handleLabelDragStart: (e: React.MouseEvent, checkId: string, labelX: number, labelY: number) => void;
  handleLabelTouchDragStart: (e: React.TouchEvent, checkId: string, labelX: number, labelY: number) => void;
  handleLabelResizeMouseDown: (e: React.MouseEvent, checkId: string, handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w') => void;
  handleLabelResizeTouchStart: (e: React.TouchEvent, checkId: string, handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w') => void;
  handleInlineEditorResizeStart: (e: React.MouseEvent, w: number, h: number, corner: 'nw' | 'ne' | 'sw' | 'se') => void;
  openInlineEditor: (check: ICheck) => void;
  closeInlineEditor: () => void;
  handleSaveCheck: (checkId: string, updates: { message?: string; rule_key?: string; passed?: boolean; rule_prompt?: string }) => Promise<void>;
  handleCreateCheck: (data: any) => Promise<void>;
  handleDeleteCheckFromInline: (id: string) => Promise<void>;
  setHoveredCheckId: (id: string | null) => void;
  setHoveredElementType: (type: 'highlight' | 'label' | null) => void;
  // From envelope
  currentEnvelopeRevision: IEnvelopeRevision | null;
  currentEnvelope: IEnvelope | null;
  onEditRule?: (ruleId: string) => void;
  /** Jump to the rule inside the SOURCE checklist (not the report snapshot). */
  onEditChecklistRule?: (ruleId: string) => void;
  onViewRevisionChanges?: () => void;
  onViewChecklistRules?: () => void;
  onViewEnvelopeRules?: () => void;
  onToggleCheckPassed?: (checkId: string, currentPassed: boolean) => void;
  draggedLabelPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number }>>;
  /** Jump the viewer to the given 0-indexed page — powers `#pg_N` pill clicks. */
  onScrollToPage?: (pageIndex: number) => void;
}

export default function HighlightOverlay({
  pageHighlights,
  labelPlacements,
  useAdjacentLabels,
  renderedPageWidth,
  renderedPageHeight,
  effectiveFontSize,
  effectivePadding,
  overhangTop,
  overhangRight,
  overhangBottom,
  overhangLeft,
  selectedCheckId,
  hoveredCheckId,
  hoveredElementType,
  currentPageIndex,
  currentReport,
  pendingNewCheck,
  inlineEditCheckId,
  inlineEditorSize,
  overlappingHighlights,
  currentOverlapIndex,
  labelFontScale,
  fontFamily,
  highlightMode,
  isDraggingHighlight,
  isResizingHighlight,
  draggingLabelId,
  isResizingLabel,
  resizeLabelCheckId,
  resizeLabelHandle,
  isEditingDisabled,
  scaleCoordinatesToCurrentViewer,
  doRectanglesIntersect,
  findHighlightsAtPoint,
  getCheckRuleId,
  handleHighlightMouseDown,
  handleHighlightTouchStart,
  handleResizeMouseDown,
  handleResizeTouchStart,
  handleHighlightClick,
  handleLabelDragStart,
  handleLabelTouchDragStart,
  handleLabelResizeMouseDown,
  handleLabelResizeTouchStart,
  handleInlineEditorResizeStart,
  openInlineEditor,
  closeInlineEditor,
  handleSaveCheck,
  handleCreateCheck,
  handleDeleteCheckFromInline,
  setHoveredCheckId,
  setHoveredElementType,
  currentEnvelopeRevision,
  currentEnvelope,
  onEditRule,
  onEditChecklistRule,
  onViewRevisionChanges,
  onViewChecklistRules,
  onViewEnvelopeRules,
  onToggleCheckPassed,
  draggedLabelPositionsRef,
  onScrollToPage,
}: HighlightOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevMarginLabelKeyRef = useRef<string>('');
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  // Intra-document page-pointer beam. When the user clicks a `#pg_N[x1=...]`
  // pill, we record the click origin (viewport coords) + the target spec,
  // wait for scrollToPage's smooth-scroll to settle, then resolve the
  // target's viewport rect via the page's DOM `[data-page-index]` node
  // and render a brief dashed beam + pulse-rect overlay.
  type PageBeamState = {
    page: number; // 1-indexed (matches the token)
    coords: { x1: number; y1: number; x2: number; y2: number };
    origin: { x: number; y: number }; // viewport-absolute click origin
    resolved: { x: number; y: number; w: number; h: number } | null; // viewport-absolute target rect
    expiresAt: number; // timestamp ms
  };
  const [pageBeam, setPageBeam] = useState<PageBeamState | null>(null);

  const handlePageClick = useCallback(
    (
      target: { page: number; x1?: number; y1?: number; x2?: number; y2?: number },
      anchorEl: HTMLElement | null,
    ) => {
      const pageIndex = target.page - 1;
      if (pageIndex < 0) return;
      onScrollToPage?.(pageIndex);
      if (target.x1 != null && target.y1 != null && target.x2 != null && target.y2 != null && anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        setPageBeam({
          page: target.page,
          coords: { x1: target.x1, y1: target.y1, x2: target.x2, y2: target.y2 },
          origin: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          resolved: null,
          expiresAt: Date.now() + 2200,
        });
      }
    },
    [onScrollToPage],
  );

  // Phase 1: after scrollToPage's ~500 ms smooth-scroll, resolve the
  // target page's screen position and compute the beam endpoint.
  useEffect(() => {
    if (!pageBeam || pageBeam.resolved) return;
    const resolveTimer = setTimeout(() => {
      setPageBeam(prev => {
        if (!prev || prev.resolved) return prev;
        const pageEl = document.querySelector(
          `[data-page-index="${prev.page - 1}"]`,
        ) as HTMLElement | null;
        if (!pageEl) return null;
        const pageRect = pageEl.getBoundingClientRect();
        const scaled = scaleCoordinatesToCurrentViewer(prev.coords as ICoordinates, prev.page - 1);
        const sx1 = (scaled as any).x1 ?? 0;
        const sy1 = (scaled as any).y1 ?? 0;
        const sx2 = (scaled as any).x2 ?? 0;
        const sy2 = (scaled as any).y2 ?? 0;
        return {
          ...prev,
          resolved: {
            x: pageRect.left + Math.min(sx1, sx2),
            y: pageRect.top + Math.min(sy1, sy2),
            w: Math.abs(sx2 - sx1),
            h: Math.abs(sy2 - sy1),
          },
        };
      });
    }, 550);
    return () => clearTimeout(resolveTimer);
  }, [pageBeam, scaleCoordinatesToCurrentViewer]);

  // Phase 2: auto-dismiss after the lifetime window.
  useEffect(() => {
    if (!pageBeam) return;
    const remaining = Math.max(0, pageBeam.expiresAt - Date.now());
    const t = setTimeout(() => setPageBeam(null), remaining);
    return () => clearTimeout(t);
  }, [pageBeam]);

  // `val=... vs ref:...` values under the check label are only meaningful
  // when the envelope has a user script consuming them. Without a script
  // they're internal noise, so suppress.
  const hasEnvelopeScript = !!((currentEnvelope as any)?.user_scripts?.[0]?.code?.trim());

  // Reference file metadata from the current report — used by
  // renderDescriptionWithFileCitations to resolve #file_N → filename.
  // The backend emits `ref_files_meta` as a unified list that already
  // includes both checklist-pinned `#ref[...]` markers AND ad-hoc refs
  // attached via the Review dialog's "Add note" section, deduped by
  // dfrev prefix_id. No client-side merge needed.
  const refFileRefs: Array<{ description?: string | null; filename?: string | null; document_file_revision_prefix_id?: string; text_content?: string | null; mime_type?: string | null; rule_id?: string | null }> = useMemo(() => {
    return (currentReport as any)?.ref_files_meta || [];
  }, [(currentReport as any)?.ref_files_meta]);

  // prefix_id → descriptor map used by the inline check editor so `#ref[...]`
  // chips inside the check's message render the filename instead of the raw
  // dfrev_xxx id. Built once per report to avoid per-render allocation.
  const refFileLookup = useMemo(() => {
    const m = new Map<string, { filename?: string | null; description?: string | null; document_file_revision_prefix_id?: string; mime_type?: string | null }>();
    for (const r of refFileRefs) {
      if (r.document_file_revision_prefix_id) m.set(r.document_file_revision_prefix_id, r);
    }
    return m;
  }, [refFileRefs]);

  // Reference file viewer state — opens when user clicks a #file_N link.
  // The panel is a movable, non-modal floating window (no backdrop blur)
  // so the user can drag it aside and visually compare with the document.
  // highlightValue is `check.data.ref` from the clicked check — used to highlight
  // the referenced value inside the ref file (mark tags in text + PDF).
  // anchor is the clicked label's bounding rect in viewport coords — used
  // to draw a connector "beam" from the label to the viewer.
  type ViewerState = {
    dfrevId: string;
    name: string;
    mimeType: string;
    originalBase64: string | null;
    textContent: string;
    activeTab: 'original' | 'text';
    scopeLabel: string;
    loading: boolean;
    loadError: string | null;
    x: number;
    y: number;
    highlightValue: string | null;
    // 0-indexed page within the ref file that the AI cited via
    // `check.data.ref_page`. Scroll target on open. Null when not set.
    refPage: number | null;
    anchor: BeamAnchor | null;         // clicked label's rect (captured at click time — fallback)
    highlightAnchor: BeamAnchor | null; // originating highlight rect
    sourceCheckId: string | null;                       // id of the check the click originated from (for live re-query of its highlight rect)
    citationKey: string | null;                         // `${checkId}|${dfrevId}` — used to re-query the clicked label span on scroll
    savingToLibrary: boolean;
    savedToLibrary: boolean;
    width: number;
    height: number;
    // When false, the viewer subtree stays mounted but hidden (display:none).
    // Keeps react-pdf's <Document> alive so reopening the same ref does not
    // re-parse the PDF. Close/Esc/click-outside flip this to false; reopening
    // the same dfrev flips it back to true (instant show). Opening a
    // DIFFERENT dfrev swaps state entirely and will re-parse, which is
    // expected — it's a different file.
    visible: boolean;
  };
  // Default opens narrow (20% of viewport) so the ref viewer doesn't
  // dominate the document being reviewed. User can drag the bottom-right
  // corner to resize any time; min width keeps it usable.
  const REF_VIEWER_MIN_WIDTH = 280;
  const REF_VIEWER_MIN_HEIGHT = 240;
  const REF_VIEWER_DEFAULT_WIDTH = () => Math.max(
    REF_VIEWER_MIN_WIDTH,
    Math.round(window.innerWidth * 0.2),
  );
  const REF_VIEWER_DEFAULT_HEIGHT = () => Math.min(
    560,
    Math.round(window.innerHeight * 0.7),
    window.innerHeight - 48,
  );
  const [viewingRefFile, setViewingRefFile] = useState<ViewerState | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  // Points at the module-level shared pose ref so closing the viewer on one
  // PDF page (HighlightOverlay instance A) and reopening it on another
  // (instance B) still restores the just-placed pose + zoom. Each instance
  // has its own useRef, so we can't use a per-component ref here.
  const lastRefViewerPoseRef = sharedRefViewerPose;
  // Client-side cache of fetched ref file contents. Keyed by dfrev prefix_id.
  // Hitting the same ref file a second time skips the network round-trip and
  // the PDF re-download — we just swap state and update highlightValue.
  const refFileCacheRef = useRef<Map<string, { originalBase64: string; mimeType: string; name: string; savedToLibrary?: boolean }>>(new Map());

  // HighlightOverlay is rendered once per PDF page. Each instance owns its
  // own `viewingRefFile` state, which means a ref chip click on check-A
  // (page 1) AND another on check-B (page 2) can open the viewer + lens
  // in BOTH instances, producing two overlapping lenses. To guarantee
  // at most one ref viewer across ALL instances, each instance gets a
  // random id and we broadcast a `revdoku:ref-viewer-claim` event when
  // opening; any other instance receiving a claim with a different id
  // closes its own viewer.
  const instanceIdRef = useRef<string>(`ho_${Math.random().toString(36).slice(2, 10)}`);
  useLayoutEffect(() => {
    const onClaim = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.instanceId && detail.instanceId !== instanceIdRef.current) {
        setViewingRefFile(null);
      }
    };
    window.addEventListener('revdoku:ref-viewer-claim', onClaim);
    return () => window.removeEventListener('revdoku:ref-viewer-claim', onClaim);
  }, []);

  const handleRefFileClick = (
    dfrevId: string,
    highlightValue?: string | null,
    anchorEl?: HTMLElement | null,
    sourceCheckId?: string | null,
    refPage?: number | null,
  ) => {
    // Toggle behavior: clicking the same citation chip while its viewer is
    // already OPEN (visible) closes the viewer — set visible=false rather
    // than nulling state, so the mounted react-pdf <Document> stays alive
    // and the next reopen of the same dfrev skips the PDF re-parse.
    const clickedCitationKey =
      anchorEl?.getAttribute('data-ref-citation') ||
      (sourceCheckId ? `${sourceCheckId}|${dfrevId}` : null);
    if (viewingRefFile && viewingRefFile.visible && clickedCitationKey && viewingRefFile.citationKey === clickedCitationKey) {
      setViewingRefFile(prev => prev ? { ...prev, visible: false } : prev);
      return;
    }

    // Fast path: clicking a citation for the SAME ref file that's currently
    // hidden (closed without discarding state) → just un-hide and refresh
    // the per-click context (anchor, highlight value, source check, ref
    // page). No state swap, no remount, no PDF re-parse.
    if (viewingRefFile && viewingRefFile.dfrevId === dfrevId) {
      let anchorRefresh: BeamAnchor | null = null;
      if (anchorEl) {
        const r = anchorEl.getBoundingClientRect();
        anchorRefresh = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
      }
      let hlAnchorRefresh: BeamAnchor | null = null;
      if (sourceCheckId) {
        const hlEl = containerRef.current?.querySelector(`[data-check-id="${sourceCheckId}"]`) as HTMLElement | null;
        if (hlEl) {
          const r = hlEl.getBoundingClientRect();
          hlAnchorRefresh = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
        }
      }
      setViewingRefFile(prev => prev ? {
        ...prev,
        visible: true,
        highlightValue: highlightValue || null,
        refPage: refPage ?? null,
        anchor: anchorRefresh,
        highlightAnchor: hlAnchorRefresh,
        sourceCheckId: sourceCheckId || null,
        citationKey: clickedCitationKey,
      } : prev);
      // Still claim ownership so other overlay instances close their viewers.
      window.dispatchEvent(new CustomEvent('revdoku:ref-viewer-claim', {
        detail: { instanceId: instanceIdRef.current },
      }));
      return;
    }

    // Tell sibling HighlightOverlay instances (one per PDF page) to close
    // their viewers — only one ref viewer / lens can be active at a time.
    window.dispatchEvent(new CustomEvent('revdoku:ref-viewer-claim', {
      detail: { instanceId: instanceIdRef.current },
    }));

    const ref = (refFileRefs as any[]).find((r: any) => r.document_file_revision_prefix_id === dfrevId);
    const defaultW = REF_VIEWER_DEFAULT_WIDTH();
    const defaultH = REF_VIEWER_DEFAULT_HEIGHT();
    const centerX = Math.max(16, Math.round((window.innerWidth - defaultW) / 2));
    const centerY = Math.max(16, Math.round((window.innerHeight - defaultH) / 2));

    // Compute anchor rect (label) and the originating highlight rect.
    // Size is carried along so beams can terminate on the chip/highlight's
    // facing edge instead of its center.
    let anchor: BeamAnchor | null = null;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      anchor = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
    }
    let highlightAnchor: BeamAnchor | null = null;
    if (sourceCheckId) {
      const hlEl = containerRef.current?.querySelector(`[data-check-id="${sourceCheckId}"]`) as HTMLElement | null;
      if (hlEl) {
        const r = hlEl.getBoundingClientRect();
        highlightAnchor = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
      }
    }

    const preserved = viewingRefFile; // reuse width/height if viewer already open
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Pose priority on cold open: in-session ref (just-placed pose) >
    // backend `view_settings` (cross-session) > auto-position heuristic.
    // When the viewer is already open (another chip clicked) keep live
    // dimensions so a mid-session drag doesn't snap back to stored coords.
    const session = !preserved ? lastRefViewerPoseRef.ref : null;
    const stored = !preserved && !session ? (currentEnvelope?.view_settings as any) : null;
    const hasStoredPose = !!stored
      && typeof stored.ref_viewer_x === 'number'
      && typeof stored.ref_viewer_y === 'number'
      && typeof stored.ref_viewer_width === 'number'
      && typeof stored.ref_viewer_height === 'number';

    let baseW: number;
    let baseH: number;
    let baseX: number;
    let baseY: number;
    if (session) {
      baseW = Math.max(REF_VIEWER_MIN_WIDTH, Math.min(vw - 32, session.w));
      baseH = Math.max(REF_VIEWER_MIN_HEIGHT, Math.min(vh - 32, session.h));
      baseX = Math.max(16, Math.min(vw - baseW - 16, session.x));
      baseY = Math.max(16, Math.min(vh - baseH - 16, session.y));
    } else if (hasStoredPose) {
      baseW = Math.max(REF_VIEWER_MIN_WIDTH, Math.min(vw - 32, stored.ref_viewer_width));
      baseH = Math.max(REF_VIEWER_MIN_HEIGHT, Math.min(vh - 32, stored.ref_viewer_height));
      baseX = Math.max(16, Math.min(vw - baseW - 16, stored.ref_viewer_x));
      baseY = Math.max(16, Math.min(vh - baseH - 16, stored.ref_viewer_y));
    } else {
      baseW = preserved?.width ?? defaultW;
      baseH = preserved?.height ?? defaultH;
      // Auto-position: put the popup on the viewport half opposite the
      // anchors so the check highlight and label stay visible and the
      // beams have clear space to span between them and the viewer.
      const refCx = anchor?.cx ?? highlightAnchor?.cx ?? vw / 2;
      const refCy = anchor?.cy ?? highlightAnchor?.cy ?? vh / 2;
      const placeLeft = refCx > vw / 2;
      baseX = placeLeft ? 16 : Math.max(16, vw - baseW - 16);
      baseY = Math.max(16, Math.min(vh - baseH - 16, Math.round(refCy - baseH / 2)));
    }
    const sourceIdVal: string | null = sourceCheckId || null;
    // Prefer the clicked element's own data-ref-citation — the citation span
    // appears in multiple render contexts (inline overlay + right panel) and
    // a raw `${checkId}|${dfrevId}` composition would let querySelector
    // resolve to the wrong DOM node on re-anchor, causing the label beam to
    // drift to the other rendering.
    const citationKeyVal: string | null =
      anchorEl?.getAttribute('data-ref-citation') ||
      (sourceIdVal ? `${sourceIdVal}|${dfrevId}` : null);

    if (!ref) {
      setViewingRefFile({
        dfrevId, name: dfrevId, mimeType: 'text/plain', originalBase64: null,
        textContent: `Reference file ${dfrevId} not found in this report.`,
        activeTab: 'text', scopeLabel: 'Reference', loading: false, loadError: null,
        x: baseX, y: baseY,
        highlightValue: highlightValue || null, refPage: refPage ?? null, anchor, highlightAnchor,
        sourceCheckId: sourceIdVal, citationKey: citationKeyVal,
        savingToLibrary: false, savedToLibrary: false,
        width: baseW, height: baseH,
        visible: true,
      });
      return;
    }

    const name = ref.filename || ref.description || dfrevId;
    const mimeType = ref.mime_type || 'application/octet-stream';
    const textContent = ref.text_content || '';

    let scopeLabel = 'Checklist-wide reference';
    if (ref.rule_id) {
      const rules = currentReport?.checklist?.rules || [];
      const idx = rules.findIndex((r: IRule) => r.id === ref.rule_id);
      scopeLabel = idx >= 0 ? `Rule ${idx + 1} reference` : 'Rule reference';
    }

    // "Already in library" is authoritative from the server — it's true when
    // the file arrived via "take from library" OR was saved from a prior
    // session/envelope (blob-shared library copy). Seed savedToLibrary from
    // it so the button doesn't suggest a redundant save.
    const alreadyInLibrary = !!(ref as any)?.already_in_library;

    // Cache hit → instant open, no spinner, no refetch.
    const cached = refFileCacheRef.current.get(dfrevId);
    if (cached) {
      setViewingRefFile({
        dfrevId,
        name: cached.name || name,
        mimeType: cached.mimeType || mimeType,
        originalBase64: cached.originalBase64,
        textContent,
        activeTab: preserved?.dfrevId === dfrevId ? (preserved.activeTab) : 'original',
        scopeLabel,
        loading: false,
        loadError: null,
        x: baseX, y: baseY,
        highlightValue: highlightValue || null, refPage: refPage ?? null, anchor, highlightAnchor,
        sourceCheckId: sourceIdVal, citationKey: citationKeyVal,
        savingToLibrary: false,
        // Persist "already saved" state via the per-dfrev cache so the button
        // stays disabled + labelled "Saved to library" across viewer re-opens.
        savedToLibrary: alreadyInLibrary || !!cached.savedToLibrary || !!preserved?.savedToLibrary,
        width: baseW, height: baseH,
        visible: true,
      });
      return;
    }

    setViewingRefFile({
      dfrevId, name, mimeType, originalBase64: null, textContent,
      activeTab: 'original', scopeLabel, loading: true, loadError: null,
      x: baseX, y: baseY,
      highlightValue: highlightValue || null, refPage: refPage ?? null, anchor, highlightAnchor,
      sourceCheckId: sourceIdVal, citationKey: citationKeyVal,
      savingToLibrary: false, savedToLibrary: alreadyInLibrary,
      width: baseW, height: baseH,
      visible: true,
    });

    ApiClient.getDocumentFileRevisionContent(dfrevId)
      .then((res) => {
        refFileCacheRef.current.set(dfrevId, {
          originalBase64: res.content,
          mimeType: res.mime_type || mimeType,
          name: res.name || name,
        });
        setViewingRefFile(prev => (prev && prev.dfrevId === dfrevId) ? {
          ...prev,
          originalBase64: res.content,
          mimeType: res.mime_type || prev.mimeType,
          name: res.name || prev.name,
          loading: false,
        } : prev);
      })
      .catch((err) => {
        setViewingRefFile(prev => (prev && prev.dfrevId === dfrevId) ? {
          ...prev,
          originalBase64: null,
          loading: false,
          loadError: String(err?.message || err),
          activeTab: prev.textContent ? 'text' : 'original',
        } : prev);
      });
  };

  // Bridge for outside-of-overlay ref-file click sources (e.g. toolbar chips).
  // `detail` must include `dfrevId`; `anchorEl` optional for the beam.
  useLayoutEffect(() => {
    const onExternal = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const dfrevId: string | undefined = detail.dfrevId;
      if (!dfrevId) return;
      handleRefFileClick(dfrevId, null, detail.anchorEl || null, null);
    };
    window.addEventListener('revdoku:open-ref-file', onExternal);
    return () => window.removeEventListener('revdoku:open-ref-file', onExternal);
  }, [refFileRefs, currentReport]);

  // Keyboard shortcuts for the ref viewer:
  //  - Escape: close if open (lets the user dismiss without reaching for the mouse)
  //  - r / R : toggle — if open, close; if closed and the selected check has
  //            a ref citation in its description, open it. Matches the
  //            "click again to close" semantics of the chip itself.
  // Skipped while typing in inputs, inline-editing a check, or inside a
  // modal dialog so we never swallow keys meant for other UI.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      const isDialog = !!target?.closest('[role="dialog"]');
      if (isInput || isDialog || inlineEditCheckId) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape' && viewingRefFile && viewingRefFile.visible) {
        e.preventDefault();
        e.stopPropagation();
        // Hide (keep state + mounted Document) so reopening is instant.
        setViewingRefFile(prev => prev ? { ...prev, visible: false } : prev);
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        if (viewingRefFile && viewingRefFile.visible) {
          e.preventDefault();
          setViewingRefFile(prev => prev ? { ...prev, visible: false } : prev);
          return;
        }
        if (!selectedCheckId || !currentReport?.checks) return;
        const check = currentReport.checks.find((c: any) => c.id === selectedCheckId) as any;
        if (!check) return;
        const desc: string = check.description || '';
        let dfrevId: string | null = null;
        const m1 = desc.match(/#ref\[file:(dfrev_[A-Za-z0-9]+)/);
        if (m1) dfrevId = m1[1];
        if (!dfrevId) {
          const m2 = desc.match(/#file:(dfrev_[A-Za-z0-9]+)/);
          if (m2) dfrevId = m2[1];
        }
        if (!dfrevId) {
          const m3 = desc.match(/#file_(\d+)/);
          if (m3) {
            const idx = parseInt(m3[1], 10) - 1;
            dfrevId = refFileRefs[idx]?.document_file_revision_prefix_id || null;
          }
        }
        if (!dfrevId) return;
        e.preventDefault();
        const citationSel = `[data-ref-citation="${CSS.escape(`panel_${selectedCheckId}|${dfrevId}`)}"], [data-ref-citation="${CSS.escape(`${selectedCheckId}|${dfrevId}`)}"]`;
        const anchorEl = document.querySelector(citationSel) as HTMLElement | null;
        handleRefFileClick(dfrevId, check.data?.ref, anchorEl, selectedCheckId, check.data?.ref_page ?? null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewingRefFile, selectedCheckId, currentReport, refFileRefs, inlineEditCheckId]);

  // Snapshot the current viewer pose to both the in-session ref and the
  // backend so the next open restores it. Fire-and-forget — a failed save
  // logs but shouldn't surface; pose persistence is a convenience feature.
  const persistRefViewerPose = React.useCallback((pose: { x: number; y: number; width: number; height: number; zoom?: number }) => {
    const prev = lastRefViewerPoseRef.ref;
    const rounded = {
      x: Math.round(pose.x),
      y: Math.round(pose.y),
      w: Math.round(pose.width),
      h: Math.round(pose.height),
      zoom: typeof pose.zoom === 'number' ? +pose.zoom.toFixed(2) : (prev?.zoom ?? 1),
    };
    lastRefViewerPoseRef.ref = rounded;
    const envId = currentEnvelope?.id;
    if (!envId) return;
    ApiClient.updateEnvelope(envId, {
      view_settings: {
        ...(currentEnvelope?.view_settings || {}),
        ref_viewer_x: rounded.x,
        ref_viewer_y: rounded.y,
        ref_viewer_width: rounded.w,
        ref_viewer_height: rounded.h,
        ref_viewer_zoom: rounded.zoom,
      },
    } as any).catch((err: unknown) => {
      console.warn('Failed to persist ref viewer pose:', err);
    });
  }, [currentEnvelope?.id, currentEnvelope?.view_settings]);

  // `corner` determines which sides move: 'se' (default) drags right+bottom
  // edges; 'sw' drags left+bottom (and translates x); 'ne' drags right+top
  // (translates y); 'nw' drags both origins. Width/height are always clamped
  // to [REF_VIEWER_MIN_WIDTH, viewport - 32] and the origin is clamped so
  // the panel stays on-screen.
  const handleRefViewerResizeStart = (e: React.MouseEvent, corner: 'se' | 'sw' | 'ne' | 'nw' = 'se') => {
    if (!viewingRefFile) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = viewingRefFile.width;
    const startH = viewingRefFile.height;
    const startPosX = viewingRefFile.x;
    const startPosY = viewingRefFile.y;
    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const maxW = window.innerWidth - 32;
      const maxH = window.innerHeight - 32;
      setViewingRefFile(prev => {
        if (!prev) return null;
        let nextW = startW;
        let nextH = startH;
        let nextX = startPosX;
        let nextY = startPosY;
        if (corner === 'se' || corner === 'ne') {
          nextW = Math.max(REF_VIEWER_MIN_WIDTH, Math.min(maxW, startW + dx));
        } else {
          // west edge: pull origin with the mouse; width grows as x shrinks
          nextW = Math.max(REF_VIEWER_MIN_WIDTH, Math.min(maxW, startW - dx));
          nextX = Math.max(0, startPosX + (startW - nextW));
        }
        if (corner === 'se' || corner === 'sw') {
          nextH = Math.max(REF_VIEWER_MIN_HEIGHT, Math.min(maxH, startH + dy));
        } else {
          nextH = Math.max(REF_VIEWER_MIN_HEIGHT, Math.min(maxH, startH - dy));
          nextY = Math.max(0, startPosY + (startH - nextH));
        }
        return { ...prev, width: nextW, height: nextH, x: nextX, y: nextY };
      });
    };
    const onUp = (ev: MouseEvent) => {
      ev.preventDefault();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setViewingRefFile(prev => {
        if (prev) persistRefViewerPose({ x: prev.x, y: prev.y, width: prev.width, height: prev.height });
        return prev;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleRefViewerDragStart = (e: React.MouseEvent) => {
    if (!viewingRefFile) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: viewingRefFile.x, origY: viewingRefFile.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      ev.preventDefault();
      setViewingRefFile(prev => prev ? {
        ...prev,
        x: dragRef.current!.origX + (ev.clientX - dragRef.current!.startX),
        y: dragRef.current!.origY + (ev.clientY - dragRef.current!.startY),
      } : null);
    };
    const onUp = (ev: MouseEvent) => {
      ev.preventDefault();
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setViewingRefFile(prev => {
        if (prev) persistRefViewerPose({ x: prev.x, y: prev.y, width: prev.width, height: prev.height });
        return prev;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Helper to get border color for a check by ID
  const getCheckBorderColor = (checkId: string): string => {
    const check = pageHighlights.find(h => h.id === checkId);
    return check?.colors?.border_color || '#888';
  };

  // When the inline check editor is open, or the ref-file viewer is tied to
  // a specific originating check, every OTHER check/label is dimmed so the
  // user focuses on the one check the action is about. Returns true when
  // the given check id should be dimmed.
  const isCheckDimmed = (checkId: string): boolean => {
    if (inlineEditCheckId) return inlineEditCheckId !== checkId;
    if (viewingRefFile?.visible && viewingRefFile.sourceCheckId) return viewingRefFile.sourceCheckId !== checkId;
    return false;
  };

  // Close the ref viewer only when the user ACTIVELY changes selection to
  // a different check AFTER the viewer opened. The previous version closed
  // the viewer on every initial render where selectedCheckId !== sourceCheckId
  // — which happened whenever the user clicked a ref chip without first
  // selecting that check, producing a 1-second "flash then close" bug.
  //
  // Using a ref to track the last seen selectedCheckId, we distinguish a
  // genuine selection transition from an initial observation.
  const lastSeenSelectedRef = useRef<string | null>(selectedCheckId ?? null);
  useEffect(() => {
    const prev = lastSeenSelectedRef.current;
    const curr = selectedCheckId ?? null;
    lastSeenSelectedRef.current = curr;
    if (!viewingRefFile?.sourceCheckId || !viewingRefFile.visible) return;
    if (curr === prev) return;                                  // no real change → ignore
    if (curr && curr !== viewingRefFile.sourceCheckId) {
      setViewingRefFile(p => p ? { ...p, visible: false } : p);
    }
  }, [selectedCheckId, viewingRefFile?.sourceCheckId, viewingRefFile?.visible]);

  // Close the ref viewer on any click outside of it (except clicks on the
  // source citation/label for the currently-open check, or on the magnifier
  // lens which floats above the document). Lets users dismiss by clicking
  // into the document, sidebar, or toolbar — not only by clicking another
  // ref chip.
  useEffect(() => {
    if (!viewingRefFile || !viewingRefFile.visible) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Click inside the viewer itself (dialog, save popup, etc.) → keep open
      if (target.closest('[data-ref-viewer-root]')) return;
      if (target.closest('[data-ref-magnifier-lens]')) return;
      // Click on the source check's citation chip or label → let those
      // handlers run (they toggle the viewer themselves).
      const src = viewingRefFile.sourceCheckId;
      if (src) {
        const citationChip = target.closest('[data-ref-citation]');
        if (citationChip) {
          const key = (citationChip as HTMLElement).getAttribute('data-ref-citation') || '';
          if (key.includes(src)) return;
        }
        const labelEl = target.closest('[data-label-id]');
        if (labelEl && (labelEl as HTMLElement).getAttribute('data-label-id') === src) return;
      }
      // Click on a DIFFERENT ref citation → hide this viewer; that chip's
      // own click handler will open (or re-use) its own viewer. Hide, don't
      // null, so the parsed PDF stays cached for later reopens.
      setViewingRefFile(prev => prev ? { ...prev, visible: false } : prev);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [viewingRefFile]);

  const getCheckHintTextColor = (checkId: string): string => {
    const check = pageHighlights.find(h => h.id === checkId);
    return check?.colors?.hint_text_color || check?.colors?.border_color || '#888';
  };

  // Resolve connection line behavior from the highlight mode config
  const highlightModeConfig = getHighlightModeConfig(highlightMode);

  // Pre-compute selected highlight once (avoid O(n) lookup per highlight)
  const selectedHighlight = selectedCheckId
    ? pageHighlights.find(h => h.id === selectedCheckId)
    : null;

  // Build effective rules list: snapshot rules + synthetic rules if any check references them
  const effectiveRules = useMemo(() => {
    const snapshotRules = currentReport?.checklist?.rules || [];
    const rules = [...snapshotRules];
    // Add catch-changes display rule if any check uses it
    const hasCatchChanges = pageHighlights.some(h => getCheckTypes(h).has(CheckType.CHANGE));
    if (hasCatchChanges && !rules.some((r: IRule) => r.id === REVDOKU_CATCH_CHANGES_RULE_ID)) {
      rules.push(CATCH_CHANGES_RULE_DISPLAY);
    }
    // Add catch-all display rule if any check uses it
    const hasCatchAll = pageHighlights.some(h => h.rule_id === REVDOKU_CATCH_ALL_RULE_ID);
    if (hasCatchAll && !rules.some((r: IRule) => r.id === REVDOKU_CATCH_ALL_RULE_ID)) {
      rules.push(CATCH_ALL_RULE_DISPLAY);
    }
    return rules;
  }, [currentReport?.checklist?.rules, pageHighlights, getCheckRuleId]);

  // Collect unique data.val values from all checks for autocomplete dropdown
  const existingValValues = useMemo(() => {
    const vals = new Set<string>();
    for (const c of currentReport?.checks || []) {
      if (c.data?.val) vals.add(c.data.val);
    }
    return [...vals].sort();
  }, [currentReport?.checks]);

  // Post-render correction: re-stack margin labels using actual DOM heights, then fix leaders.
  // Only restacks when the set of visible margin labels changes (page load, filter change,
  // check add/delete). Skips on zoom, drag, and resize to avoid fighting with user positions.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !useAdjacentLabels || labelPlacements.length === 0) return;

    // Compute label set key — includes renderedPageWidth so restacking
    // runs on zoom change to maintain fixed pixel gap between labels
    const marginLabelIds = labelPlacements
      .filter(lp => lp.side !== PlacementSide.INSIDE)
      .map(lp => lp.id)
      .sort()
      .join(',') + `@${Math.round(renderedPageWidth)}`;
    const hasDraggedLabels = draggedLabelPositionsRef?.current && draggedLabelPositionsRef.current.size > 0;

    // Only restack when the label set changed (not on zoom/drag/resize)
    const shouldRestack = marginLabelIds !== prevMarginLabelKeyRef.current && !hasDraggedLabels;
    if (shouldRestack) {
      prevMarginLabelKeyRef.current = marginLabelIds;
      if (import.meta.env.DEV) console.debug('[LabelRestack] restacking — label set changed');
    } else if (marginLabelIds !== prevMarginLabelKeyRef.current && hasDraggedLabels) {
      // Label set changed but drag in progress — update key but skip restacking
      prevMarginLabelKeyRef.current = marginLabelIds;
      if (import.meta.env.DEV) console.debug('[LabelRestack] skipped — drag in progress');
    } else {
      if (import.meta.env.DEV) console.debug('[LabelRestack] skipped — same label set');
    }

    if (shouldRestack) {
      const marginEntries: { lp: typeof labelPlacements[0]; el: HTMLElement }[] = [];
      for (const lp of labelPlacements) {
        if (lp.side === PlacementSide.INSIDE) continue;
        const el = container.querySelector(`[data-label-id="${lp.id}"]`) as HTMLElement | null;
        if (!el) continue;
        marginEntries.push({ lp, el });
      }

      // Split left and right margin labels into independent groups for restacking
      const rightEntries = marginEntries.filter(e => e.lp.side !== PlacementSide.LEFT);
      const leftEntries = marginEntries.filter(e => e.lp.side === PlacementSide.LEFT);

      // Re-stack labels using actual DOM heights to eliminate cumulative error
      const gap = 8; // REVDOKU_MARGIN_LABEL_VERTICAL_GAP
      const restackGroup = (entries: typeof marginEntries) => {
        // Use labelBox.y positions from Step 11 (spread toward highlights).
        // Only adjust for actual DOM height differences to prevent overlap.
        entries.sort((a, b) => a.lp.labelBox.y - b.lp.labelBox.y);
        let nextMinY = gap;
        for (const { lp, el } of entries) {
          const actualHeight = el.offsetHeight;
          // Use the spread position from Step 11, but ensure no overlap with previous label
          const targetY = Math.max(lp.labelBox.y, nextMinY);
          if (Math.abs(el.offsetTop - targetY) > 1) {
            el.style.top = `${targetY}px`;
          }
          nextMinY = targetY + actualHeight + gap;
        }
      };
      restackGroup(rightEntries);
      restackGroup(leftEntries);
    }

    // Update ALL connection line endpoints (runs on every effect trigger, not just restack).
    // This ensures switching highlight mode immediately recalculates where lines terminate.
    for (const lp of labelPlacements) {
      const lineEl = container.querySelector(`[data-line-id="${lp.id}"]`) as SVGLineElement | null;
      if (!lineEl) continue;
      const el = container.querySelector(`[data-label-id="${lp.id}"]`) as HTMLElement | null;
      if (!el) continue;
      const hlEl = container.querySelector(`[data-check-id="${lp.id}"]`) as HTMLElement | null;
      if (!hlEl) continue;
      const labelBox = { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
      const highlightBox = { x: hlEl.offsetLeft, y: hlEl.offsetTop, width: hlEl.offsetWidth, height: hlEl.offsetHeight };
      const { start, end } = computeStraightConnectionLine(labelBox, highlightBox, lp.side);
      const effectiveEnd = getConnectionLineEndpoint(highlightModeConfig.connectionMode, highlightBox, labelBox) ?? end;
      lineEl.setAttribute('x1', String(start.x));
      lineEl.setAttribute('y1', String(start.y));
      lineEl.setAttribute('x2', String(effectiveEnd.x));
      lineEl.setAttribute('y2', String(effectiveEnd.y));
    }
  }, [labelPlacements, useAdjacentLabels, highlightModeConfig]);

  return (<div ref={containerRef} style={{ display: 'contents' }}>
    {/* Highlight boxes */}
    {pageHighlights.map(
      (
        highlightedCheck: ICheckForDisplay,
        index: number,
      ) => {
        // Use current page index consistently
        const pageIndex = currentPageIndex;

        // Get base screen coordinates from PDF coordinates
        let scaledCoords = scaleCoordinatesToCurrentViewer(
          highlightedCheck as ICoordinates,
          currentPageIndex,
        );

        // Drag/resize visual offset is now handled by CSS transform on the DOM element directly
        // (no re-render needed during drag/resize)
        const isSelected =
          selectedCheckId === highlightedCheck.id;

        const isIntersecting =
          selectedHighlight &&
            !isSelected &&
            highlightedCheck &&
            selectedHighlight
            ? doRectanglesIntersect(
              highlightedCheck as ICoordinates,
              selectedHighlight as ICoordinates,
            )
            : false;

        const highlightMatchedRule = (() => {
          const ruleId = getCheckRuleId(highlightedCheck);
          if (!ruleId) return null;
          return effectiveRules.find((r: IRule) => r.id === ruleId || (r as any).source_rule_id === ruleId) || null;
        })();
        const highlightRuleText = highlightMatchedRule?.prompt || null;

        const isHovered = hoveredCheckId === highlightedCheck.id;

        return (
          <div
            key={`highlight-container-${index}-${highlightedCheck.id}`}
          >
            <div
              key={`highlight-${index}-${highlightedCheck.id}`}
              data-check-id={highlightedCheck.id}
              data-base-width={getWidth(scaledCoords)}
              data-base-height={getHeight(scaledCoords)}
              className={`absolute transition-all duration-300 ease-in-out group ${isSelected
                ? "z-90 scale-120 animate-pulse-gentle"
                : ""
                }`}
              style={{
                left: `${scaledCoords.x1}px`,
                top: `${scaledCoords.y1}px`,
                width: `${getWidth(scaledCoords)}px`,
                height: `${getHeight(scaledCoords)}px`,
                pointerEvents: "auto",
                cursor:
                  isDraggingHighlight
                    ? "grabbing"
                    : isResizingHighlight
                      ? "nwse-resize"
                      : "grab",
                opacity: isCheckDimmed(highlightedCheck.id) ? 0.25 : undefined,
                // Mode-specific highlight styling
                ...(() => {
                  const bc = highlightedCheck.colors.border_color;
                  const hmConfig = getHighlightModeConfig(highlightMode);
                  const bw = isSelected ? hmConfig.lineWidth + 1.5 : (isHovered ? hmConfig.lineWidth + 1 : hmConfig.lineWidth);
                  const selectedShadow = isSelected && isHovered
                    ? `0 0 14px 5px ${bc}60, 0 0 0 4px ${bc}70`
                    : isSelected ? `0 0 12px 4px ${bc}50, 0 0 0 3px ${bc}60`
                      : isHovered ? `0 0 8px 3px ${bc}40` : 'none';

                  if (highlightMode === HighlightMode.DOT) {
                    // Dot mode: invisible container (dot rendered as child element)
                    return { backgroundColor: 'transparent', border: 'none', outline: 'none', borderRadius: '0px', boxShadow: 'none' };
                  }
                  if (highlightMode === HighlightMode.UNDERLINE) {
                    // Underline mode: only bottom border visible
                    return {
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: `${bw}px solid ${bc}`,
                      outline: 'none',
                      borderRadius: '0px',
                      boxShadow: isSelected ? `0 2px 6px 0 ${bc}50` : isHovered ? `0 1px 4px 0 ${bc}30` : 'none',
                    };
                  }
                  if (highlightMode === HighlightMode.BRACKET) {
                    // Bracket mode: corner-only markers (like Figma selection handles)
                    // Config-driven hover border for bracket/dot modes
                    const hbw = hmConfig.hoverBorderWidth;
                    const hbo = hmConfig.hoverBorderOpacity;
                    let hoverBorder = 'none';
                    if (hbw > 0 && (isSelected || isHovered)) {
                      const w = isSelected ? hbw * 1.5 : hbw;
                      const a = Math.round(Math.min(1, isSelected ? hbo * 1.5 : hbo) * 255).toString(16).padStart(2, '0');
                      hoverBorder = `${w}px solid ${bc}${a}`;
                    }
                    return {
                      backgroundColor: 'transparent',
                      border: hoverBorder,
                      outline: 'none',
                      borderRadius: '0px',
                      boxShadow: isSelected ? `0 0 8px 2px ${bc}40` : isHovered ? `0 0 4px 1px ${bc}25` : 'none',
                    };
                  }
                  // Rectangle mode (default): traditional bordered highlight
                  return {
                    backgroundColor: REVDOKU_HIGHLIGHT_FILL_ENABLED ? highlightedCheck.colors.highlight_color : 'transparent',
                    border: `${bw}px solid ${bc}`,
                    outline: isSelected ? `2.5px solid ${bc}` : (isHovered ? `2px solid ${bc}` : 'none'),
                    outlineOffset: '-1px',
                    borderRadius: `${calculateCornerRadius(getWidth(scaledCoords), getHeight(scaledCoords))}px`,
                    boxShadow: selectedShadow,
                  };
                })(),
                zIndex: (isHovered && hoveredElementType === 'highlight')
                  ? 95
                  : isSelected
                    ? 60
                    : isHovered
                      ? 58
                      : isIntersecting
                        ? 40
                        : 30,
                transition:
                  "background-color 0.2s, border-color 0.2s, outline 0.15s, box-shadow 0.2s",
                touchAction: isDraggingHighlight ? "none" : "auto", // Allow scrolling; long-press initiates drag
              }}
              onMouseDown={isEditingDisabled ? undefined : (e) => {
                e.stopPropagation();
                handleHighlightMouseDown(
                  e,
                  highlightedCheck.id,
                  highlightedCheck as ICoordinates,
                );
              }}
              onTouchStart={isEditingDisabled ? undefined : (e) => {
                e.stopPropagation();
                handleHighlightTouchStart(
                  e,
                  highlightedCheck.id,
                  highlightedCheck as ICoordinates,
                );
              }}
              onMouseEnter={() => {
                if (!isDraggingHighlight && !isResizingHighlight) {
                  if (hoverLeaveTimerRef.current) { clearTimeout(hoverLeaveTimerRef.current); hoverLeaveTimerRef.current = null; }
                  setHoveredCheckId(highlightedCheck.id);
                  setHoveredElementType('highlight');
                }
              }}
              onMouseLeave={() => {
                if (!isDraggingHighlight && !isResizingHighlight) {
                  if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current);
                  hoverLeaveTimerRef.current = setTimeout(() => { setHoveredCheckId(null); setHoveredElementType(null); hoverLeaveTimerRef.current = null; }, 300);
                }
              }}
              onClick={(e) =>
                handleHighlightClick(
                  e,
                  highlightedCheck.id,
                )
              }
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isEditingDisabled) openInlineEditor(highlightedCheck as ICheck);
              }}
            >
              {/* Dot mode: small filled dot at center */}
              {highlightMode === HighlightMode.DOT && (() => {
                const dotSize = isSelected ? 12 : (isHovered ? 10 : 8);
                const bc = highlightedCheck.colors.border_color;
                return (
                  <div style={{
                    position: 'absolute', left: '50%', top: '50%',
                    width: `${dotSize}px`, height: `${dotSize}px`,
                    transform: 'translate(-50%, -50%)', borderRadius: '50%',
                    backgroundColor: bc, pointerEvents: 'none', zIndex: 55,
                    boxShadow: isSelected ? `0 0 8px 3px ${bc}60` : isHovered ? `0 0 6px 2px ${bc}40` : `0 0 3px 1px ${bc}30`,
                    transition: 'width 0.2s, height 0.2s, box-shadow 0.2s',
                  }} />
                );
              })()}

              {/* Bracket mode: corner-only L-shaped markers */}
              {highlightMode === HighlightMode.BRACKET && (() => {
                const bc = highlightedCheck.colors.border_color;
                const hmCfg = getHighlightModeConfig(HighlightMode.BRACKET);
                const bw = isSelected ? hmCfg.lineWidth + 1 : (isHovered ? hmCfg.lineWidth + 0.5 : hmCfg.lineWidth);
                const armLen = Math.min(12, Math.min(getWidth(scaledCoords), getHeight(scaledCoords)) * 0.25);
                const cornerStyle = (top: boolean, left: boolean): React.CSSProperties => ({
                  position: 'absolute',
                  ...(top ? { top: 0 } : { bottom: 0 }),
                  ...(left ? { left: 0 } : { right: 0 }),
                  width: `${armLen}px`, height: `${armLen}px`,
                  borderColor: bc, borderStyle: 'solid', borderWidth: 0,
                  ...(top ? { borderTopWidth: `${bw}px` } : { borderBottomWidth: `${bw}px` }),
                  ...(left ? { borderLeftWidth: `${bw}px` } : { borderRightWidth: `${bw}px` }),
                  pointerEvents: 'none', zIndex: 55,
                });
                return (<>
                  <div style={cornerStyle(true, true)} />
                  <div style={cornerStyle(true, false)} />
                  <div style={cornerStyle(false, true)} />
                  <div style={cornerStyle(false, false)} />
                </>);
              })()}

              {/* Overlap indicator for selected highlight when there are multiple overlapping */}
              {isSelected &&
                overlappingHighlights.length > 1 &&
                overlappingHighlights.includes(
                  highlightedCheck.id,
                ) && (
                  <div
                    className="absolute -top-2 -right-2 bg-indigo-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-lg"
                    style={{
                      pointerEvents: "none",
                      zIndex: 70,
                    }}
                  >
                    {currentOverlapIndex + 1}/
                    {overlappingHighlights.length}
                  </div>
                )}

              {/* Overlapping highlight indicator disabled — too noisy across all highlight modes */}

              {/* Hover icons — top-right outside highlight, stacked vertically (disabled for highlights — tools shown on labels only) */}
              {false && ((hoveredCheckId === highlightedCheck.id && hoveredElementType === 'highlight') || isSelected) && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: '100%',
                  marginLeft: '2px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '2px',
                  pointerEvents: 'none',
                  zIndex: 31,
                }}>
                  {/* Toggle pass/fail checkbox */}
                  {!isEditingDisabled && onToggleCheckPassed && (
                    <label
                      style={{
                        pointerEvents: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        cursor: 'pointer',
                        fontSize: `${Math.max(effectiveFontSize * 0.8, 10)}px`,
                        color: highlightedCheck.colors.border_color,
                        whiteSpace: 'nowrap',
                        padding: '2px 3px',
                        borderRadius: '3px',
                        transition: 'color 0.15s',
                      }}
                      title={highlightedCheck.passed ? 'Mark as failed' : 'Mark as passed'}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={highlightedCheck.passed}
                        onChange={(e) => { e.stopPropagation(); onToggleCheckPassed?.(highlightedCheck.id, highlightedCheck.passed); }}
                        style={{ cursor: 'pointer', width: `${Math.max(effectiveFontSize * 0.95, 12)}px`, height: `${Math.max(effectiveFontSize * 0.95, 12)}px`, accentColor: highlightedCheck.colors.border_color, margin: 0 }}
                      />
                      mark as passed
                    </label>
                  )}
                  {/* Pencil edit button */}
                  {!isEditingDisabled && (
                    <button
                      style={{ pointerEvents: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                      onClick={(e) => { e.stopPropagation(); openInlineEditor(highlightedCheck as ICheck); }}
                    >
                      <Pencil className="text-gray-500 hover:text-gray-800 transition-colors"
                        style={{ width: `${Math.max(effectiveFontSize * 1.2, 14)}px`, height: `${Math.max(effectiveFontSize * 1.2, 14)}px` }} />
                    </button>
                  )}
                </div>
              )}
              {/* Trash — pinned to bottom-right of highlight (disabled for highlights — tools shown on labels only) */}
              {false && !isEditingDisabled && ((hoveredCheckId === highlightedCheck.id && hoveredElementType === 'highlight') || isSelected) && (
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '100%',
                  marginLeft: '2px',
                  pointerEvents: 'none',
                  zIndex: 31,
                }}>
                  <button
                    style={{ pointerEvents: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                    onClick={(e) => { e.stopPropagation(); handleDeleteCheckFromInline(highlightedCheck.id); }}
                    title="Delete check"
                  >
                    <Trash2 className="text-red-400 hover:text-red-600 transition-colors"
                      style={{ width: `${Math.max(effectiveFontSize * 1.2, 14)}px`, height: `${Math.max(effectiveFontSize * 1.2, 14)}px` }} />
                  </button>
                </div>
              )}

              {/* Resize handles for highlights */}
              {isSelected && !isEditingDisabled && (
                <>
                  {/* Corner resize handles */}
                  <div
                    className="absolute w-2 h-2 bg-blue-400/80 border border-white/80 rounded-full cursor-nw-resize hover:bg-blue-500 transition-colors"
                    style={{
                      top: "-4px",
                      left: "-4px",
                      zIndex: 80,
                      touchAction: 'none',
                    }}
                    onMouseDown={(e) =>
                      !isEditingDisabled &&
                      handleResizeMouseDown(e, highlightedCheck.id, "nw")
                    }
                    onTouchStart={(e) =>
                      !isEditingDisabled &&
                      handleResizeTouchStart(e, highlightedCheck.id, "nw")
                    }
                    title="Resize from top-left"
                  />
                  <div
                    className="absolute w-2 h-2 bg-blue-400/80 border border-white/80 rounded-full cursor-ne-resize hover:bg-blue-500 transition-colors"
                    style={{
                      top: "-4px",
                      right: "-4px",
                      zIndex: 80,
                      touchAction: 'none',
                    }}
                    onMouseDown={(e) =>
                      !isEditingDisabled &&
                      handleResizeMouseDown(e, highlightedCheck.id, "ne")
                    }
                    onTouchStart={(e) =>
                      !isEditingDisabled &&
                      handleResizeTouchStart(e, highlightedCheck.id, "ne")
                    }
                    title="Resize from top-right"
                  />
                  <div
                    className="absolute w-2 h-2 bg-blue-400/80 border border-white/80 rounded-full cursor-sw-resize hover:bg-blue-500 transition-colors"
                    style={{
                      bottom: "-4px",
                      left: "-4px",
                      zIndex: 80,
                      touchAction: 'none',
                    }}
                    onMouseDown={(e) =>
                      !isEditingDisabled &&
                      handleResizeMouseDown(e, highlightedCheck.id, "sw")
                    }
                    onTouchStart={(e) =>
                      !isEditingDisabled &&
                      handleResizeTouchStart(e, highlightedCheck.id, "sw")
                    }
                    title="Resize from bottom-left"
                  />
                  <div
                    className="absolute w-2 h-2 bg-blue-400/80 border border-white/80 rounded-full cursor-se-resize hover:bg-blue-500 transition-colors"
                    style={{
                      bottom: "-4px",
                      right: "-4px",
                      zIndex: 80,
                      touchAction: 'none',
                    }}
                    onMouseDown={(e) =>
                      !isEditingDisabled &&
                      handleResizeMouseDown(e, highlightedCheck.id, "se")
                    }
                    onTouchStart={(e) =>
                      !isEditingDisabled &&
                      handleResizeTouchStart(e, highlightedCheck.id, "se")
                    }
                    title="Resize from bottom-right"
                  />

                  {/* Edge resize handles */}
                  <div
                    className="absolute w-2 h-1.5 bg-blue-400/80 border border-white/80 rounded cursor-n-resize hover:bg-blue-500 transition-colors"
                    style={{
                      top: "-3px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      zIndex: 80,
                      touchAction: 'none',
                    }}
                    onMouseDown={(e) =>
                      !isEditingDisabled &&
                      handleResizeMouseDown(e, highlightedCheck.id, "n")
                    }
                    onTouchStart={(e) =>
                      !isEditingDisabled &&
                      handleResizeTouchStart(e, highlightedCheck.id, "n")
                    }
                    title="Resize from top"
                  />
                  <div
                    className="absolute w-2 h-1.5 bg-blue-400/80 border border-white/80 rounded cursor-s-resize hover:bg-blue-500 transition-colors"
                    style={{
                      bottom: "-3px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      zIndex: 80,
                      touchAction: 'none',
                    }}
                    onMouseDown={(e) =>
                      !isEditingDisabled &&
                      handleResizeMouseDown(e, highlightedCheck.id, "s")
                    }
                    onTouchStart={(e) =>
                      !isEditingDisabled &&
                      handleResizeTouchStart(e, highlightedCheck.id, "s")
                    }
                    title="Resize from bottom"
                  />
                  <div
                    className="absolute w-1.5 h-2 bg-blue-400/80 border border-white/80 rounded cursor-w-resize hover:bg-blue-500 transition-colors"
                    style={{
                      top: "50%",
                      left: "-3px",
                      transform: "translateY(-50%)",
                      zIndex: 80,
                      touchAction: 'none',
                    }}
                    onMouseDown={(e) =>
                      !isEditingDisabled &&
                      handleResizeMouseDown(e, highlightedCheck.id, "w")
                    }
                    onTouchStart={(e) =>
                      !isEditingDisabled &&
                      handleResizeTouchStart(e, highlightedCheck.id, "w")
                    }
                    title="Resize from left"
                  />
                  <div
                    className="absolute w-1.5 h-2 bg-blue-400/80 border border-white/80 rounded cursor-e-resize hover:bg-blue-500 transition-colors"
                    style={{
                      top: "50%",
                      right: "-3px",
                      transform: "translateY(-50%)",
                      zIndex: 80,
                      touchAction: 'none',
                    }}
                    onMouseDown={(e) =>
                      !isEditingDisabled &&
                      handleResizeMouseDown(e, highlightedCheck.id, "e")
                    }
                    onTouchStart={(e) =>
                      !isEditingDisabled &&
                      handleResizeTouchStart(e, highlightedCheck.id, "e")
                    }
                    title="Resize from right"
                  />
                </>
              )}

              {/* Source badge removed - matching doc-api clean style */}

              {(highlightRuleText || (getCheckTypes(highlightedCheck).has(CheckType.CHANGE) && onViewRevisionChanges)) && !isDraggingHighlight && !isResizingHighlight && !isTouchDevice && (
                <div
                  style={{
                    ...(() => {
                      const visible = hoveredCheckId === highlightedCheck.id && hoveredElementType === 'highlight';
                      return {
                        opacity: visible ? 1 : 0,
                        transition: 'opacity 0.2s',
                        transitionDelay: visible ? RULE_HINT_SHOW_DELAY : '0s',
                        pointerEvents: visible ? 'auto' as const : 'none' as const,
                      };
                    })(),
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '2px',
                    minWidth: '250px',
                    width: 'max-content',
                    maxWidth: '400px',
                    padding: `${effectivePadding * 0.75}px`,
                    backgroundColor: 'rgba(255, 249, 219, 0.97)',
                    border: '1px solid rgba(200, 180, 100, 0.4)',
                    borderRadius: '3px',
                    fontSize: `${effectiveFontSize * 0.85}px`,
                    lineHeight: '1.3',
                    color: '#665500',
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    zIndex: 100,
                  }}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {getCheckTypes(highlightedCheck).has(CheckType.CHANGE) && onViewRevisionChanges ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <SharedNumberBadge
                        number={highlightedCheck.check_index ?? ((highlightedCheck.rule_order ?? 0) + 1)}
                        fontSize={effectiveFontSize}
                        fillColor={highlightedCheck.colors?.border_color || '#888'}
                      />
                      <span title="Cross-revision change detected"><CheckIcon type="changes" size={effectiveFontSize * 0.85} color={REVDOKU_ICON_COLOR_CHANGES} /></span>
                      <span
                        style={{ textDecoration: 'underline', cursor: 'pointer', color: '#92610a', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        onClick={(e) => { e.stopPropagation(); onViewRevisionChanges(); }}
                      >
                        <GitCompareArrows style={{ width: `${effectiveFontSize * 0.85}px`, height: `${effectiveFontSize * 0.85}px`, flexShrink: 0 }} />
                        Compare revisions
                      </span>
                    </span>
                  ) : (
                    <span style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {/* Check description — what AI found at this location.
                          #file_N tokens are rendered as clickable indigo links
                          so the user can cross-reference against the original
                          reference file (quote, ledger, etc.). */}
                      {highlightedCheck.description && (
                        <span style={{ userSelect: 'text', cursor: 'text', color: '#443300', fontWeight: 500 }}>
                          {renderDescriptionWithFileCitations(
                            highlightedCheck.description.startsWith('#recheck ')
                              ? highlightedCheck.description.slice('#recheck '.length)
                              : highlightedCheck.description,
                            (dfrevId, anchorEl) => handleRefFileClick(dfrevId, highlightedCheck.data?.ref, anchorEl, highlightedCheck.id, highlightedCheck.data?.ref_page ?? null),
                            refFileRefs,
                            `overlay_${highlightedCheck.id}`,
                            handlePageClick,
                          )}
                        </span>
                      )}
                      {/* Rule text — which rule this check belongs to */}
                      <span style={{ userSelect: 'text', cursor: 'text', display: 'inline-flex', alignItems: 'flex-start', gap: '4px', opacity: 0.7, fontSize: `${effectiveFontSize * 0.75}px` }}>
                        <SharedNumberBadge
                          number={highlightedCheck.check_index ?? ((highlightedCheck.rule_order ?? 0) + 1)}
                          fontSize={effectiveFontSize}
                          fillColor={highlightedCheck.colors?.border_color || '#888'}
                          style={{ marginTop: '1px' }}
                        />
                        {highlightedCheck.description?.startsWith('#recheck ')
                          ? <span title="Re-verification of previously failed check"><CheckIcon type="recheck" size={effectiveFontSize * 0.85} color={highlightedCheck.colors?.border_color || '#888'} style={{ marginTop: '1px' }} /></span>
                          : null
                        }
                        {highlightMatchedRule?.origin === 'user'
                          ? <Mail style={{ width: `${effectiveFontSize * 0.85}px`, height: `${effectiveFontSize * 0.85}px`, flexShrink: 0, marginTop: '1px' }} />
                          : <ClipboardCheck style={{ width: `${effectiveFontSize * 0.85}px`, height: `${effectiveFontSize * 0.85}px`, flexShrink: 0, marginTop: '1px' }} />
                        }
                        <RuleHintText ruleOrder={(highlightedCheck.rule_order ?? 0)} ruleText={highlightRuleText ?? ''} />
                      </span>
                      {highlightMatchedRule?.origin === 'user' && onViewEnvelopeRules ? (
                        <span
                          style={{ textDecoration: 'underline', cursor: 'pointer', color: '#92610a', display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: `${effectiveFontSize * REVDOKU_LABEL_BADGE_FONT_SCALE * 1.275 + 4}px` }}
                          onClick={(e) => { e.stopPropagation(); onViewEnvelopeRules(); }}
                        >
                          <List style={{ width: `${effectiveFontSize * 0.85}px`, height: `${effectiveFontSize * 0.85}px`, flexShrink: 0 }} />
                          View envelope rules
                        </span>
                      ) : onViewChecklistRules ? (
                        <span
                          style={{ textDecoration: 'underline', cursor: 'pointer', color: '#92610a', display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: `${effectiveFontSize * REVDOKU_LABEL_BADGE_FONT_SCALE * 1.275 + 4}px` }}
                          onClick={(e) => { e.stopPropagation(); onViewChecklistRules(); }}
                        >
                          <List style={{ width: `${effectiveFontSize * 0.85}px`, height: `${effectiveFontSize * 0.85}px`, flexShrink: 0 }} />
                          View rules
                        </span>
                      ) : null}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Selected-check message popup removed - hints serve as primary message display */}
          </div>
        );
      },
    )}

    {/* SVG leader line overlay for adjacent labels */}
    {useAdjacentLabels && labelPlacements.length > 0 && (() => {
      const svgWidth = overhangLeft + renderedPageWidth + overhangRight;
      const svgHeight = overhangTop + renderedPageHeight + overhangBottom;

      return (
        <svg
          style={{
            position: 'absolute',
            top: -overhangTop,
            left: -overhangLeft,
            width: `${svgWidth}px`,
            height: `${svgHeight}px`,
            pointerEvents: 'none',
            overflow: 'visible',
            zIndex: 57,
          }}
          viewBox={`${-overhangLeft} ${-overhangTop} ${svgWidth} ${svgHeight}`}
        >
          {labelPlacements.map(lp => {
            if (lp.arrowPath.length < 2) return null;
            const start = lp.arrowPath[0];
            const end = lp.arrowPath[lp.arrowPath.length - 1];
            const color = getCheckBorderColor(lp.id);
            const op = isCheckDimmed(lp.id) ? REVDOKU_LEADER_OPACITY * 0.25 : REVDOKU_LEADER_OPACITY;
            const leaderSvg = svgLeaderLine(start.x, start.y, end.x, end.y, color, {
              strokeWidth: REVDOKU_LEADER_LINE_WIDTH_V2,
              opacity: op,
              dashArray: lp.side !== PlacementSide.INSIDE ? REVDOKU_LEADER_DASH_PATTERN.join(',') : undefined,
              endpointDot: highlightModeConfig.connectionEndpointDot,
            });
            if (!leaderSvg) return null;
            return (
              <g key={`leader-${lp.id}`} data-line-id={lp.id}
                dangerouslySetInnerHTML={{ __html: leaderSvg }} />
            );
          })}
        </svg>
      );
    })()}

    {/* Adjacent labels (inside page, next to highlights) */}
    {useAdjacentLabels && labelPlacements.map(lp => {
      const borderColor = getCheckBorderColor(lp.id);
      const textColor = getCheckHintTextColor(lp.id);
      const check = pageHighlights.find(h => h.id === lp.id);
      const isLpSelected = selectedCheckId === lp.id;
      const isInlineEditing = inlineEditCheckId === lp.id;
      if (!check?.description && !isInlineEditing) return null;
      if (!check) return null;
      const ruleOrder = check.rule_order ?? 0;
      const matchedRule = (() => {
        const ruleId = getCheckRuleId(check);
        if (!ruleId) return null;
        return effectiveRules.find((r: IRule) => r.id === ruleId || (r as any).source_rule_id === ruleId) || null;
      })();
      const ruleText = matchedRule?.prompt || null;
      const isLabelHovered = hoveredCheckId === lp.id;
      const showLabelIcons = isLabelHovered && hoveredElementType === 'label';
      const borderWidth = '2.5px';
      // val/ref fields are raw inputs for user_scripts. When the envelope has
      // no script consuming them, they're noise — don't surface in the inline
      // badges, and don't surface in the hover tooltip either.
      const dataHoverText = (hasEnvelopeScript && check.data && typeof check.data === 'object')
        ? Object.entries(check.data as unknown as Record<string, unknown>)
            .filter(([, v]) => v != null && String(v).trim() !== '')
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')
        : '';
      return (
        <div
          key={`label-${lp.id}`}
          data-label-id={lp.id}
          className="group"
          style={{
            position: 'absolute',
            left: `${lp.labelBox.x - ((!isInlineEditing && (showLabelIcons || isLpSelected) && lp.side === PlacementSide.LEFT) ? 30 : 0)}px`,
            top: lp.side === PlacementSide.TOP
              ? `${-REVDOKU_MARGIN_LABEL_HORIZONTAL_PADDING}px`  // anchor bottom edge at gap distance from page top
              : `${lp.labelBox.y}px`,
            transform: lp.side === PlacementSide.TOP ? 'translateY(-100%)' : undefined,
            width: `${lp.labelBox.width}px`,
            boxSizing: 'content-box',
            paddingRight: (!isInlineEditing && (showLabelIcons || isLpSelected) && lp.side !== PlacementSide.LEFT) ? '30px' : '0px',
            paddingLeft: (!isInlineEditing && (showLabelIcons || isLpSelected) && lp.side === PlacementSide.LEFT) ? '30px' : '0px',
            zIndex: isInlineEditing ? 100 : (isLabelHovered || isLpSelected) ? 90 : 56,
            opacity: isCheckDimmed(lp.id) ? 0.25 : undefined,
            pointerEvents: 'auto',
            cursor: isInlineEditing
              ? 'default'
              : (isResizingLabel && resizeLabelCheckId === lp.id)
                ? `${resizeLabelHandle}-resize`
                : draggingLabelId === lp.id ? 'grabbing' : 'grab',
            touchAction: draggingLabelId === lp.id ? 'none' : 'auto',
            transition: 'box-shadow 0.2s',
          }}
          onMouseEnter={() => {
            if (hoverLeaveTimerRef.current) { clearTimeout(hoverLeaveTimerRef.current); hoverLeaveTimerRef.current = null; }
            setHoveredCheckId(lp.id); setHoveredElementType('label');
          }}
          onMouseLeave={() => {
            if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current);
            hoverLeaveTimerRef.current = setTimeout(() => { setHoveredCheckId(null); setHoveredElementType(null); hoverLeaveTimerRef.current = null; }, 300);
          }}
          onMouseDown={(e) => {
            if (isInlineEditing || e.button !== 0) return;
            handleLabelDragStart(e, lp.id, lp.labelBox.x, lp.labelBox.y);
          }}
          onTouchStart={(e) => {
            if (isInlineEditing) return;
            handleLabelTouchDragStart(e, lp.id, lp.labelBox.x, lp.labelBox.y);
          }}
          onClick={(e) => { e.stopPropagation(); if (!isInlineEditing) handleHighlightClick(e, lp.id); }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (!isInlineEditing && !isEditingDisabled && check) openInlineEditor(check as ICheck);
          }}
        >
          {/* Text content / Inline editor */}
          <div style={{
            position: 'relative',
            color: textColor,
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            ...(() => {
              const mainBorder = `${borderWidth} solid ${borderColor}`;
              const p = `${effectivePadding}px`;
              if (REVDOKU_LABEL_DRAW_FULL_RECTANGLE) {
                return { borderTop: mainBorder, borderRight: mainBorder, borderBottom: mainBorder, borderLeft: mainBorder, borderRadius: '3px', padding: p };
              }
              if (lp.side === PlacementSide.LEFT) return {
                borderTop: 'none', borderRight: mainBorder, borderBottom: 'none', borderLeft: 'none',
                borderRadius: '0px', padding: p,
              };
              if (lp.side === PlacementSide.TOP) return {
                borderTop: 'none', borderRight: 'none', borderBottom: mainBorder, borderLeft: 'none',
                borderRadius: '0px', padding: p,
              };
              if (lp.side === PlacementSide.BOTTOM) return {
                borderTop: mainBorder, borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
                borderRadius: '0px', padding: p,
              };
              return {
                borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: mainBorder,
                borderRadius: '0px', padding: p,
              };
            })(),
            fontSize: `${effectiveFontSize}px`,
            fontFamily: fontFamily ? getFontFamilyCss(fontFamily as LabelFontFamily, 'browser') : undefined,
            lineHeight: `${REVDOKU_MARGIN_LABEL_LINE_HEIGHT}`,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            textAlign: lp.side === PlacementSide.LEFT ? 'right' : undefined,
            boxShadow: (() => {
              if (!isLabelHovered && !isLpSelected) return 'none';
              if (REVDOKU_LABEL_DRAW_FULL_RECTANGLE) return 'none';
              const s = isLpSelected ? 2.5 : 2;
              if (lp.side === PlacementSide.LEFT) return `${s}px 0 0 0 ${borderColor}`;
              if (lp.side === PlacementSide.TOP) return `0 ${s}px 0 0 ${borderColor}`;
              if (lp.side === PlacementSide.BOTTOM) return `0 -${s}px 0 0 ${borderColor}`;
              return `-${s}px 0 0 0 ${borderColor}`;
            })(),
            transition: 'color 0.2s, border-color 0.2s, box-shadow 0.2s',
          }}>
            {/* Icon column — stacked vertically inside text box (hover only) */}
            {!isInlineEditing && (hoveredCheckId === lp.id && hoveredElementType === 'label') && (() => {
              const isLeftLabel = lp.side === PlacementSide.LEFT;
              return (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  ...(isLeftLabel ? { right: '100%', marginRight: '2px' } : { left: '100%', marginLeft: '2px' }),
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  alignItems: isLeftLabel ? 'flex-end' : 'flex-start',
                  pointerEvents: 'none',
                  zIndex: 57,
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}>
                  {/* Top icons group */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: isLeftLabel ? 'flex-end' : 'flex-start', gap: '2px', pointerEvents: 'auto' }}>
                    {/* Toggle pass/fail checkbox */}
                    {!isEditingDisabled && onToggleCheckPassed && (
                      <label
                        style={{
                          pointerEvents: 'auto',
                          display: 'flex',
                          flexDirection: isLeftLabel ? 'row-reverse' : 'row',
                          alignItems: 'center',
                          gap: '3px',
                          cursor: 'pointer',
                          fontSize: `${Math.max(effectiveFontSize * 0.8, 10)}px`,
                          color: borderColor,
                          whiteSpace: 'nowrap',
                          padding: '2px 3px',
                          borderRadius: '3px',
                          transition: 'color 0.15s',
                        }}
                        title={check.passed ? 'Mark as failed' : 'Mark as passed'}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={check.passed}
                          onChange={(e) => { e.stopPropagation(); onToggleCheckPassed(check.id, check.passed); }}
                          style={{ cursor: 'pointer', width: `${Math.max(effectiveFontSize * 0.95, 12)}px`, height: `${Math.max(effectiveFontSize * 0.95, 12)}px`, accentColor: borderColor, margin: 0 }}
                        />
                        mark as passed
                      </label>
                    )}
                    {/* Pencil edit button */}
                    {!isEditingDisabled && (
                      <button
                        style={{ pointerEvents: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                        onClick={(e) => { e.stopPropagation(); openInlineEditor(check as ICheck); }}
                      >
                        <Pencil className="text-gray-500 hover:text-gray-800 transition-colors"
                          style={{ width: `${Math.max(effectiveFontSize * 1.2, 14)}px`, height: `${Math.max(effectiveFontSize * 1.2, 14)}px` }} />
                      </button>
                    )}
                    {/* Compare Changes button — change-review checks only */}
                    {getCheckTypes(check).has(CheckType.CHANGE) && onViewRevisionChanges && (
                      <button
                        style={{ pointerEvents: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: '3px' }}
                        onClick={(e) => { e.stopPropagation(); onViewRevisionChanges(); }}
                        title="Compare revision changes"
                      >
                        <GitCompareArrows className="text-amber-500 hover:text-amber-700 transition-colors"
                          style={{ width: `${Math.max(effectiveFontSize * 1.2, 14)}px`, height: `${Math.max(effectiveFontSize * 1.2, 14)}px` }} />
                      </button>
                    )}
                  </div>
                  {/* Trash delete button — pinned to bottom */}
                  {!isEditingDisabled && (
                    <button
                      style={{ pointerEvents: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                      onClick={(e) => { e.stopPropagation(); handleDeleteCheckFromInline(check.id); }}
                      title="Delete check"
                    >
                      <Trash2 className="text-red-400 hover:text-red-600 transition-colors"
                        style={{ width: `${Math.max(effectiveFontSize * 1.2, 14)}px`, height: `${Math.max(effectiveFontSize * 1.2, 14)}px` }} />
                    </button>
                  )}
                </div>
              );
            })()}
            {isInlineEditing && createPortal(
              <div
                style={{
                  position: 'fixed',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 'min(500px, 90vw)',
                  zIndex: 10000,
                  backgroundColor: 'hsl(var(--card))',
                  border: `2px solid ${borderColor}`,
                  borderRadius: '6px',
                  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <InlineCheckEditor
                  check={check as ICheck}
                  checkNumber={check.check_index ?? (ruleOrder + 1)}
                  mode={pendingNewCheck?.id === check.id ? 'create' : 'edit'}
                  rules={effectiveRules}
                  isReadOnly={isEditingDisabled}
                  getCheckRuleId={getCheckRuleId}
                  currentRevisionId={currentEnvelopeRevision?.id}
                  envelopeRevisions={currentEnvelope?.envelope_revisions}
                  onSave={handleSaveCheck}
                  onCancel={closeInlineEditor}
                  onDelete={handleDeleteCheckFromInline}
                  onCreateSave={handleCreateCheck}
                  onEditRule={onEditRule}
                  onEditChecklistRule={onEditChecklistRule}
                  onViewRevisionChanges={onViewRevisionChanges}
                  checkColor={textColor}
                  existingValValues={existingValValues}
                  fileLookup={refFileLookup}
                />
              </div>,
              document.body
            )}
            <>
              <SharedNumberBadge
                number={pendingNewCheck?.id === check.id ? 'New' : (check.check_index ?? (ruleOrder + 1))}
                fontSize={effectiveFontSize}
                fillColor={borderColor}
                fontFamily={fontFamily ? getFontFamilyCss(fontFamily as LabelFontFamily, 'browser') : undefined}
                style={{
                  float: lp.side === PlacementSide.LEFT ? 'right' : 'left',
                  opacity: 0.85,
                  ...(lp.side === PlacementSide.LEFT
                    ? { marginLeft: `${Math.max(3, effectiveFontSize * 0.25)}px` }
                    : { marginRight: `${Math.max(3, effectiveFontSize * 0.25)}px` }),
                  marginTop: `${effectiveFontSize * 0.05}px`,
                }}
              />
              {check.description?.startsWith('#recheck ')
                ? <>
                  <span title="Re-verification of previously failed check"><CheckIcon type="recheck" size="1.1em" color={textColor} style={{ marginRight: '0.25em' }} /></span>
                  {getCheckDataTypeLabels(check).filter(l => l !== 'recheck').map(label => (
                    <span key={label} style={{ display: 'inline-flex', alignItems: 'center', padding: `0 ${REVDOKU_TYPE_BADGE_PADDING_H}px`, fontSize: `${REVDOKU_TYPE_BADGE_FONT_SCALE}em`, fontWeight: REVDOKU_TYPE_BADGE_FONT_WEIGHT, borderRadius: REVDOKU_TYPE_BADGE_BORDER_RADIUS, border: `1px solid ${REVDOKU_TYPE_BADGE_RECHECK_BORDER}`, background: REVDOKU_TYPE_BADGE_RECHECK_BG, color: REVDOKU_TYPE_BADGE_RECHECK_TEXT, marginRight: REVDOKU_TYPE_BADGE_GAP, whiteSpace: 'nowrap' }}>{label}</span>
                  ))}
                  {renderDescriptionWithFileCitations(check.description.slice('#recheck '.length), (dfrevId, anchorEl) => handleRefFileClick(dfrevId, check.data?.ref, anchorEl, check.id, check.data?.ref_page ?? null), refFileRefs, `panel_${check.id}`, handlePageClick)}
                </>
                : <>
                  {getCheckTypes(check).has(CheckType.CHANGE) && (
                    <span title="Cross-revision change detected"><CheckIcon type="changes" size="1.1em" color={REVDOKU_ICON_COLOR_CHANGES} style={{ marginRight: '0.25em' }} /> </span>
                  )}
                  {getCheckDataTypeLabels(check).map(label => (
                    <span key={label} style={{ display: 'inline-flex', alignItems: 'center', padding: `0 ${REVDOKU_TYPE_BADGE_PADDING_H}px`, fontSize: `${REVDOKU_TYPE_BADGE_FONT_SCALE}em`, fontWeight: REVDOKU_TYPE_BADGE_FONT_WEIGHT, borderRadius: REVDOKU_TYPE_BADGE_BORDER_RADIUS, border: `1px solid ${REVDOKU_TYPE_BADGE_CHANGES_BORDER}`, background: REVDOKU_TYPE_BADGE_CHANGES_BG, color: REVDOKU_TYPE_BADGE_CHANGES_TEXT, marginRight: REVDOKU_TYPE_BADGE_GAP, whiteSpace: 'nowrap' }}>{label}</span>
                  ))}
                  {renderDescriptionWithFileCitations(check.description || '', (dfrevId, anchorEl) => handleRefFileClick(dfrevId, check.data?.ref, anchorEl, check.id, check.data?.ref_page ?? null), refFileRefs, `panel_${check.id}`, handlePageClick)}
                </>}
              {/* val / vs ref values only surface under the label when the
                  envelope has a user script defined — the values are raw
                  inputs to user scripts, not end-user-facing content. */}
              {hasEnvelopeScript && (check.data?.val || check.data?.ref) && (
                <span style={{
                  opacity: REVDOKU_VAL_DISPLAY_OPACITY,
                  fontSize: `${REVDOKU_VAL_DISPLAY_FONT_SCALE}em`,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}>
                  {check.data?.val && <>{' '}{formatValDisplay(check.data.val)}</>}
                  {check.data?.ref && (
                    <span style={{ color: '#2563eb', marginLeft: '4px' }} title="Value from reference file">
                      vs ref:{check.data.ref}
                    </span>
                  )}
                </span>
              )}
            </>
          </div>
          {/* Rule hint below label */}
          {!isInlineEditing && !isTouchDevice && (
            (getCheckTypes(check).has(CheckType.CHANGE) ? onViewRevisionChanges : ruleText)
          ) && (() => {
            const hintW = Math.max(lp.labelBox.width, 300, renderedPageWidth * 0.3);
            if (import.meta.env.DEV) console.debug('[hint-width]', { hintW, labelW: lp.labelBox.width, renderedPageWidth, pct: renderedPageWidth * 0.3 });
            return (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  width: `${hintW}px`,
                  boxSizing: 'border-box',
                  marginTop: '2px',
                  padding: `${effectivePadding * 0.75}px`,
                  backgroundColor: 'rgba(255, 249, 219, 0.97)',
                  border: '1px solid rgba(200, 180, 100, 0.4)',
                  borderRadius: '3px',
                  fontSize: `${effectiveFontSize * 0.85}px`,
                  lineHeight: '1.3',
                  color: '#665500',
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  opacity: showLabelIcons ? 1 : 0,
                  transition: 'opacity 0.2s',
                  transitionDelay: showLabelIcons ? RULE_HINT_SHOW_DELAY : '0s',
                  pointerEvents: showLabelIcons ? 'auto' : 'none',
                  zIndex: 59,
                }}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                {/* Rule hint card: no check-index badge — the label already
                    carries that number. Showing it twice is noise. */}
                {getCheckTypes(check).has(CheckType.CHANGE) ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span title="Cross-revision change detected"><CheckIcon type="changes" size={effectiveFontSize * 0.85} color={REVDOKU_ICON_COLOR_CHANGES} /></span>
                    <span
                      style={{ textDecoration: 'underline', cursor: 'pointer', color: '#92610a', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      onClick={(e) => { e.stopPropagation(); onViewRevisionChanges?.(); }}
                    >
                      <GitCompareArrows style={{ width: `${effectiveFontSize * 0.85}px`, height: `${effectiveFontSize * 0.85}px`, flexShrink: 0 }} />
                      Compare revisions
                    </span>
                  </span>
                ) : (
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ userSelect: 'text', cursor: 'text', display: 'inline-flex', alignItems: 'flex-start', gap: '4px' }}>
                      {check.description?.startsWith('#recheck ')
                        ? <span title="Re-verification of previously failed check"><CheckIcon type="recheck" size={effectiveFontSize * 0.85} color={borderColor} style={{ marginTop: '1px' }} /></span>
                        : null
                      }
                      {matchedRule?.origin === 'user'
                        ? <Mail style={{ width: `${effectiveFontSize * 0.85}px`, height: `${effectiveFontSize * 0.85}px`, flexShrink: 0, marginTop: '1px' }} />
                        : <ClipboardCheck style={{ width: `${effectiveFontSize * 0.85}px`, height: `${effectiveFontSize * 0.85}px`, flexShrink: 0, marginTop: '1px' }} />
                      }
                      <RuleHintText ruleOrder={ruleOrder} ruleText={ruleText ?? ''} />
                    </span>
                    {matchedRule?.origin === 'user' && onViewEnvelopeRules ? (
                      <span
                        style={{ textDecoration: 'underline', cursor: 'pointer', color: '#92610a', display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: `${effectiveFontSize * REVDOKU_LABEL_BADGE_FONT_SCALE * 1.275 + 4}px` }}
                        onClick={(e) => { e.stopPropagation(); onViewEnvelopeRules(); }}
                      >
                        <List style={{ width: `${effectiveFontSize * 0.85}px`, height: `${effectiveFontSize * 0.85}px`, flexShrink: 0 }} />
                        View envelope rules
                      </span>
                    ) : onViewChecklistRules ? (
                      <span
                        style={{ textDecoration: 'underline', cursor: 'pointer', color: '#92610a', display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: `${effectiveFontSize * REVDOKU_LABEL_BADGE_FONT_SCALE * 1.275 + 4}px` }}
                        onClick={(e) => { e.stopPropagation(); onViewChecklistRules(); }}
                      >
                        <List style={{ width: `${effectiveFontSize * 0.85}px`, height: `${effectiveFontSize * 0.85}px`, flexShrink: 0 }} />
                        View rules
                      </span>
                    ) : null}
                  </span>
                )}
                {/* Extracted check.data.* attributes appended at the bottom
                    of the hint. Only surfaces when the envelope has NO user
                    script — when a script exists, the values render inline
                    below the label (line above) so the hint would duplicate
                    them. */}
                {dataHoverText && (
                  <span style={{
                    display: 'block',
                    marginTop: '4px',
                    paddingTop: '4px',
                    borderTop: '1px dashed rgba(200, 180, 100, 0.5)',
                    fontFamily: 'monospace',
                    fontSize: '0.9em',
                    opacity: 0.85,
                    whiteSpace: 'pre-line',
                  }}>
                    {dataHoverText}
                  </span>
                )}
              </div>
            );
          })()}
          {/* Resize handles — 4 corners + 4 edges, matching highlight style */}
          {false && isLpSelected && !isEditingDisabled && !isInlineEditing && (
            <>
              {/* Corner handles (circular) */}
              <div
                className="absolute w-2 h-2 bg-blue-400/80 border border-white/80 rounded-full cursor-nw-resize hover:bg-blue-500 transition-colors"
                style={{ top: '-4px', left: '-4px', zIndex: 80, touchAction: 'none' }}
                onMouseDown={(e) => handleLabelResizeMouseDown(e, lp.id, 'nw')}
                onTouchStart={(e) => handleLabelResizeTouchStart(e, lp.id, 'nw')}
              />
              <div
                className="absolute w-2 h-2 bg-blue-400/80 border border-white/80 rounded-full cursor-ne-resize hover:bg-blue-500 transition-colors"
                style={{ top: '-4px', right: '-4px', zIndex: 80, touchAction: 'none' }}
                onMouseDown={(e) => handleLabelResizeMouseDown(e, lp.id, 'ne')}
                onTouchStart={(e) => handleLabelResizeTouchStart(e, lp.id, 'ne')}
              />
              <div
                className="absolute w-2 h-2 bg-blue-400/80 border border-white/80 rounded-full cursor-sw-resize hover:bg-blue-500 transition-colors"
                style={{ bottom: '-4px', left: '-4px', zIndex: 80, touchAction: 'none' }}
                onMouseDown={(e) => handleLabelResizeMouseDown(e, lp.id, 'sw')}
                onTouchStart={(e) => handleLabelResizeTouchStart(e, lp.id, 'sw')}
              />
              <div
                className="absolute w-2 h-2 bg-blue-400/80 border border-white/80 rounded-full cursor-se-resize hover:bg-blue-500 transition-colors"
                style={{ bottom: '-4px', right: '-4px', zIndex: 80, touchAction: 'none' }}
                onMouseDown={(e) => handleLabelResizeMouseDown(e, lp.id, 'se')}
                onTouchStart={(e) => handleLabelResizeTouchStart(e, lp.id, 'se')}
              />
              {/* Edge handles (slightly rectangular) */}
              <div
                className="absolute w-2 h-1.5 bg-blue-400/80 border border-white/80 rounded cursor-n-resize hover:bg-blue-500 transition-colors"
                style={{ top: '-3px', left: '50%', transform: 'translateX(-50%)', zIndex: 80, touchAction: 'none' }}
                onMouseDown={(e) => handleLabelResizeMouseDown(e, lp.id, 'n')}
                onTouchStart={(e) => handleLabelResizeTouchStart(e, lp.id, 'n')}
              />
              <div
                className="absolute w-2 h-1.5 bg-blue-400/80 border border-white/80 rounded cursor-s-resize hover:bg-blue-500 transition-colors"
                style={{ bottom: '-3px', left: '50%', transform: 'translateX(-50%)', zIndex: 80, touchAction: 'none' }}
                onMouseDown={(e) => handleLabelResizeMouseDown(e, lp.id, 's')}
                onTouchStart={(e) => handleLabelResizeTouchStart(e, lp.id, 's')}
              />
              <div
                className="absolute w-1.5 h-2 bg-blue-400/80 border border-white/80 rounded cursor-e-resize hover:bg-blue-500 transition-colors"
                style={{ right: '-3px', top: '50%', transform: 'translateY(-50%)', zIndex: 80, touchAction: 'none' }}
                onMouseDown={(e) => handleLabelResizeMouseDown(e, lp.id, 'e')}
                onTouchStart={(e) => handleLabelResizeTouchStart(e, lp.id, 'e')}
              />
              <div
                className="absolute w-1.5 h-2 bg-blue-400/80 border border-white/80 rounded cursor-w-resize hover:bg-blue-500 transition-colors"
                style={{ left: '-3px', top: '50%', transform: 'translateY(-50%)', zIndex: 80, touchAction: 'none' }}
                onMouseDown={(e) => handleLabelResizeMouseDown(e, lp.id, 'w')}
                onTouchStart={(e) => handleLabelResizeTouchStart(e, lp.id, 'w')}
              />
            </>
          )}
        </div>
      );
    })}

    {viewingRefFile && (
      <RefFileViewer
        state={viewingRefFile}
        minWidth={REF_VIEWER_MIN_WIDTH}
        minHeight={REF_VIEWER_MIN_HEIGHT}
        overlayContainer={containerRef.current}
        suppressBeams={!!inlineEditCheckId}
        checkHighlightColor={(() => {
          // Pick the beam colour for the source-check beam from the
          // actual check's highlight colour (red for failed, green for
          // passed, amber for change-detection, etc.) so the beam and
          // the rectangle on the document are visually connected.
          const srcId = viewingRefFile.sourceCheckId;
          if (!srcId) return null;
          const ck = pageHighlights.find(h => h.id === srcId);
          return (ck?.colors?.border_color as string | undefined) || null;
        })()}
        onDragStart={handleRefViewerDragStart}
        onResizeStart={handleRefViewerResizeStart}
        initialZoom={
          lastRefViewerPoseRef.ref?.zoom
          ?? (typeof (currentEnvelope?.view_settings as any)?.ref_viewer_zoom === 'number'
            ? (currentEnvelope?.view_settings as any).ref_viewer_zoom
            : 1.0)
        }
        onZoomChange={(z) => {
          if (viewingRefFile) persistRefViewerPose({ x: viewingRefFile.x, y: viewingRefFile.y, width: viewingRefFile.width, height: viewingRefFile.height, zoom: z });
        }}
        onClose={() => setViewingRefFile(prev => prev ? { ...prev, visible: false } : prev)}
        onTabChange={(tab) => setViewingRefFile(prev => prev ? { ...prev, activeTab: tab } : prev)}
        onSaveToLibrary={(customName) => {
          if (!viewingRefFile) return;
          const dfrevId = viewingRefFile.dfrevId;
          setViewingRefFile(prev => prev ? { ...prev, savingToLibrary: true } : prev);
          const markSaved = () => {
            // Remember in the per-dfrev cache so subsequent opens skip the
            // save button and show "Saved to library" immediately.
            const cached = refFileCacheRef.current.get(dfrevId);
            if (cached) refFileCacheRef.current.set(dfrevId, { ...cached, savedToLibrary: true });
            setViewingRefFile(prev => prev ? { ...prev, savingToLibrary: false, savedToLibrary: true } : prev);
          };
          ApiClient.copyRefFileToLibrary(dfrevId, customName)
            .then(markSaved)
            .catch((err) => {
              if (err?.code === 'ALREADY_IN_LIBRARY') { markSaved(); return; }
              setViewingRefFile(prev => prev ? { ...prev, savingToLibrary: false, loadError: String(err?.message || err) } : prev);
            });
        }}
      />
    )}
    {/* Intra-document page-pointer beam + flash-rect overlay. Rendered via
        portal so it spans the full viewport and sits above all page UI. */}
    {pageBeam && pageBeam.resolved && typeof document !== 'undefined' && createPortal(
      (() => {
        const { origin, resolved } = pageBeam;
        const cx = resolved.x + resolved.w / 2;
        const cy = resolved.y + resolved.h / 2;
        const teal = '#0f766e';
        return (
          <svg
            style={{
              position: 'fixed', inset: 0, width: '100vw', height: '100vh',
              pointerEvents: 'none', zIndex: 9999,
            }}
          >
            <style>{`
              @keyframes pgBeamFadeIn { from { opacity: 0 } to { opacity: 1 } }
              @keyframes pgRectPulse {
                0%, 100% { stroke-opacity: 0.9; stroke-width: 3 }
                50% { stroke-opacity: 0.4; stroke-width: 5 }
              }
            `}</style>
            <g style={{ animation: 'pgBeamFadeIn 180ms ease-out' }}>
              <line
                x1={origin.x} y1={origin.y} x2={cx} y2={cy}
                stroke={teal} strokeWidth={2} strokeDasharray="6 4"
                strokeLinecap="round" opacity={0.8}
              />
              <circle cx={origin.x} cy={origin.y} r={4} fill={teal} opacity={0.85} />
              <rect
                x={resolved.x - 2} y={resolved.y - 2}
                width={resolved.w + 4} height={resolved.h + 4}
                fill="none" stroke={teal} strokeWidth={3}
                rx={3} ry={3}
                style={{ animation: 'pgRectPulse 900ms ease-in-out infinite' }}
              />
            </g>
          </svg>
        );
      })(),
      document.body,
    )}
  </div>);
}
