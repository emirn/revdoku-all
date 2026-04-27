import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText } from 'lucide-react';
import {
  scanRuleFileMarkers,
  type RuleFileMarker,
} from '@/lib/rule-file-markers';
import { ApiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Inline editor for prompts that may contain `#file[description]` or
 * `file:dfrev_xxx` markers. Markers render as non-editable chips INSIDE
 * the editable surface. UX:
 *
 *   - **Type** `#file[desc]` and hit space/`]`/newline → chip appears.
 *   - **×** on a chip → removes the marker in one click.
 *   - **Double-click** a chip → chip expands to raw text (`#file[...]` /
 *     `file:dfrev_xxx[...]`) in place so the user can edit freely.
 *   - **Blur** (click outside, tab away) → plain text → chips again.
 *   - Typing `ref:` inside a marker's `[...]` brackets pops up a
 *     library-file autocomplete; selecting an entry rewrites the
 *     marker to canonical `file:dfrev_xxx[filename]` form.
 *   - **Backspace / Delete** adjacent to a chip removes the whole chip
 *     atomically (prevents Chrome from spilling chip innards into
 *     sibling text — the previous "multiplying chips" bug).
 *
 * Implementation: contenteditable <div>. React does the initial render
 * and responds to external `value` changes; otherwise the browser
 * owns the DOM. We serialize back to a plain string on every input,
 * driving `onChange`. The stored value is always a flat string — no
 * schema/backend changes.
 */

export interface FileDescriptor {
  document_file_revision_prefix_id?: string;
  document_file_prefix_id?: string;
  filename?: string | null;
  description?: string | null;
  mime_type?: string | null;
}

export interface FilePromptEditorProps {
  value: string;
  onChange: (v: string) => void;
  /** Map of `prefix_id` → descriptor, for displaying pinned chip labels. */
  fileLookup?: Map<string, FileDescriptor>;
  readOnly?: boolean;
  placeholder?: string;
  minHeightPx?: number;
  className?: string;
  id?: string;
  onFocus?: (e: React.FocusEvent<HTMLDivElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
}

const ZWSP = '\u200b';

// Chip styling follows the shared ref-file theme (blue) so chips match
// the `ref:filename` citation links elsewhere in the app.
const CHIP_CLASSES =
  'ref-chip inline-flex items-center gap-1 align-baseline px-1.5 py-0 rounded border border-blue-200 bg-blue-50 text-blue-700 text-[13px] font-medium whitespace-nowrap cursor-pointer select-none hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900';

/* ----------------------------- DOM helpers ----------------------------- */

function stripZwsp(s: string): string { return s.replace(/\u200b/g, ''); }
function lengthNoZwsp(s: string): number { return stripZwsp(s).length; }

/** Serialize the contenteditable DOM to the plain-text value. */
function serializeDom(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += stripZwsp(node.textContent || '');
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.matches('span.ref-chip')) {
      out += node.getAttribute('data-raw') || '';
      return;
    }
    if (node.tagName === 'BR') { out += '\n'; return; }
    if ((node.tagName === 'DIV' || node.tagName === 'P') && node.previousSibling) {
      if (!out.endsWith('\n')) out += '\n';
    }
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out;
}

/** Plain-text offset of the collapsed selection caret inside `root`, or
 *  null when selection isn't in `root`. */
function getCursorOffset(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;

  let offset = 0;
  let found: number | null = null;

  const walk = (node: Node): boolean => {
    if (found != null) return true;
    if (node === range.endContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += stripZwsp((node.textContent || '').slice(0, range.endOffset)).length;
      }
      found = offset;
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += lengthNoZwsp(node.textContent || '');
      return false;
    }
    if (!(node instanceof HTMLElement)) return false;
    if (node.matches('span.ref-chip')) {
      if (node.contains(range.endContainer)) {
        offset += (node.getAttribute('data-raw') || '').length;
        found = offset;
        return true;
      }
      offset += (node.getAttribute('data-raw') || '').length;
      return false;
    }
    if (node.tagName === 'BR') { offset += 1; return false; }
    if ((node.tagName === 'DIV' || node.tagName === 'P') && node.previousSibling) offset += 1;
    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) return true;
    }
    return false;
  };

  root.childNodes.forEach(n => walk(n));
  return found ?? offset;
}

/** Place the caret at plain-text offset `targetOffset` inside `root`. */
function setCursorOffset(root: HTMLElement, targetOffset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  let remaining = Math.max(0, targetOffset);
  let placed = false;
  let lastTextNode: Text | null = null;

  const place = (node: Node, offset: number) => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    placed = true;
  };

  const walk = (node: Node): void => {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = (node as Text).data;
      const len = lengthNoZwsp(raw);
      if (remaining <= len) {
        // Locate the character index accounting for zwsp.
        let consumed = 0;
        let idx = 0;
        for (; idx < raw.length; idx++) {
          if (raw[idx] === ZWSP) continue;
          if (consumed === remaining) break;
          consumed++;
        }
        place(node, idx);
        return;
      }
      remaining -= len;
      lastTextNode = node as Text;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.matches('span.ref-chip')) {
      const chipLen = (node.getAttribute('data-raw') || '').length;
      if (remaining <= chipLen) {
        // Snap to just after the chip (its trailing zwsp text node).
        const after = node.nextSibling;
        if (after && after.nodeType === Node.TEXT_NODE) {
          place(after, Math.min(1, after.textContent?.length || 0));
        } else {
          const range = document.createRange();
          range.setStartAfter(node);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          placed = true;
        }
        return;
      }
      remaining -= chipLen;
      return;
    }
    if (node.tagName === 'BR') { remaining = Math.max(0, remaining - 1); return; }
    if ((node.tagName === 'DIV' || node.tagName === 'P') && node.previousSibling) remaining = Math.max(0, remaining - 1);
    for (const child of Array.from(node.childNodes)) walk(child);
  };

  root.childNodes.forEach(walk);

  if (!placed) {
    const ln = lastTextNode as Text | null;
    if (ln) place(ln, ln.length);
    else {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

/* --------------------------- Chip DOM builder --------------------------- */

/** Chip inner text: human-readable label only (filename for pinned
 *  files, description for deferred). The `#ref[...]` wrapper is NOT
 *  shown — the visual chip (icon + pill) IS the syntax indicator. */
function chipLabel(marker: RuleFileMarker, lookup?: Map<string, FileDescriptor>): string {
  if (marker.prefix_id) {
    return lookup?.get(marker.prefix_id)?.filename || marker.description || marker.prefix_id;
  }
  return marker.description || 'reference';
}

function appendPlain(root: HTMLElement, text: string) {
  const parts = text.split('\n');
  parts.forEach((part, i) => {
    if (part.length > 0) root.appendChild(document.createTextNode(part));
    if (i < parts.length - 1) root.appendChild(document.createElement('br'));
  });
}

function appendChip(root: HTMLElement, raw: string, marker: RuleFileMarker, lookup?: Map<string, FileDescriptor>) {
  // Leading zwsp so the caret can land immediately before the chip.
  root.appendChild(document.createTextNode(ZWSP));
  const chip = document.createElement('span');
  chip.className = CHIP_CLASSES;
  chip.contentEditable = 'false';
  chip.setAttribute('data-raw', raw);
  chip.setAttribute('data-marker-kind', marker.kind);
  if (marker.prefix_id) chip.setAttribute('data-prefix-id', marker.prefix_id);
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.title = 'Double-click to edit, click × to remove';

  // File icon (document glyph) — `contentEditable=false` explicitly so
  // Chrome doesn't spill text from the chip on Backspace.
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('width', '11');
  icon.setAttribute('height', '11');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  (icon as any).contentEditable = 'false';
  icon.innerHTML =
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>' +
    '<polyline points="14 2 14 8 20 8"></polyline>';
  chip.appendChild(icon);

  // "ref:" prefix — muted so the filename / description stays the visual
  // anchor while the prefix names the chip's kind.
  const prefix = document.createElement('span');
  prefix.contentEditable = 'false';
  prefix.textContent = 'ref:';
  prefix.style.opacity = '0.65';
  prefix.style.fontWeight = '500';
  prefix.style.marginRight = '2px';
  chip.appendChild(prefix);

  const label = document.createElement('span');
  label.contentEditable = 'false';
  label.textContent = chipLabel(marker, lookup);
  chip.appendChild(label);

  // `×` remove button — glyph lives in CSS ::after so there's no text
  // node Chrome can harvest on backspace. Click → data-chip-remove
  // detection in handleRootClick.
  const rm = document.createElement('span');
  rm.className = 'ref-chip-x';
  rm.setAttribute('data-chip-remove', 'true');
  rm.setAttribute('role', 'button');
  rm.setAttribute('aria-label', 'Remove reference');
  rm.contentEditable = 'false';
  rm.title = 'Remove reference';
  chip.appendChild(rm);

  root.appendChild(chip);
  root.appendChild(document.createTextNode(ZWSP));
}

/** Build the editor DOM from a plain value. */
function renderDom(root: HTMLElement, value: string, lookup?: Map<string, FileDescriptor>) {
  root.innerHTML = '';
  const markers = scanRuleFileMarkers(value);
  if (markers.length === 0) { appendPlain(root, value); return; }
  let cursor = 0;
  for (const m of markers) {
    if (m.offset > cursor) appendPlain(root, value.slice(cursor, m.offset));
    appendChip(root, value.slice(m.offset, m.offset + m.length), m, lookup);
    cursor = m.offset + m.length;
  }
  if (cursor < value.length) appendPlain(root, value.slice(cursor));
}

/** Like `renderDom` but keeps ONE marker as plain text (so the user can
 *  edit it inline after double-clicking the chip). */
function renderDomWithPlainMarker(
  root: HTMLElement,
  value: string,
  plainMarkerIndex: number,
  lookup?: Map<string, FileDescriptor>,
) {
  root.innerHTML = '';
  const markers = scanRuleFileMarkers(value);
  if (markers.length === 0) { appendPlain(root, value); return; }
  let cursor = 0;
  markers.forEach((m, i) => {
    if (m.offset > cursor) appendPlain(root, value.slice(cursor, m.offset));
    if (i === plainMarkerIndex) {
      appendPlain(root, value.slice(m.offset, m.offset + m.length));
    } else {
      appendChip(root, value.slice(m.offset, m.offset + m.length), m, lookup);
    }
    cursor = m.offset + m.length;
  });
  if (cursor < value.length) appendPlain(root, value.slice(cursor));
}

function rebuildWithCursor(root: HTMLElement, value: string, lookup?: Map<string, FileDescriptor>) {
  const offset = getCursorOffset(root);
  renderDom(root, value, lookup);
  if (offset != null) setCursorOffset(root, offset);
}

/** Returns true when `text.slice(0, caret)` contains a `#ref[`
 *  opening that has NOT been closed by `]` before `caret`. Used to
 *  suppress chip-ification while the user is still typing the body. */
function hasUnclosedMarkerBracket(text: string, caret: number): boolean {
  const pre = text.slice(0, caret);
  const re = /(?<!\w)#ref\[/g;
  let m: RegExpExecArray | null;
  let lastBracket = -1;
  while ((m = re.exec(pre)) !== null) {
    lastBracket = m.index + m[0].length - 1; // position of the `[`
  }
  if (lastBracket < 0) return false;
  return pre.indexOf(']', lastBracket + 1) === -1;
}

/* ---------------------------- Main component ---------------------------- */

interface LibraryFileEntry {
  prefix_id: string;
  filename: string;
  mime_type: string;
}

interface AutocompleteState {
  /** Caret position at the time the dropdown was opened. */
  anchorRect: { x: number; y: number };
  /** Index (into scanRuleFileMarkers(value)) of the marker we're inside. */
  markerIndex: number;
  /** Text after `ref:` up to caret — used as search query. */
  query: string;
  /** Highlighted dropdown row. */
  selectedIdx: number;
}

export default function FilePromptEditor({
  value,
  onChange,
  fileLookup,
  readOnly,
  placeholder,
  minHeightPx,
  className,
  id,
  onFocus,
  onBlur: onBlurProp,
  onKeyDown: onKeyDownProp,
  onPaste: onPasteProp,
}: FilePromptEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastSerializedRef = useRef<string>(value);

  // Library autocomplete state
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [libFiles, setLibFiles] = useState<LibraryFileEntry[] | null>(null);
  const libLoadRequested = useRef(false);

  useEffect(() => {
    // Lazy-load the library file list once; re-used across autocomplete sessions.
    if (libLoadRequested.current) return;
    libLoadRequested.current = true;
    ApiClient.listLibraryFiles()
      .then((res) => {
        setLibFiles(res.files.map(f => ({
          prefix_id: f.latest_revision.prefix_id,
          filename: f.latest_revision.name,
          mime_type: f.latest_revision.mime_type,
        })));
      })
      .catch(() => setLibFiles([]));
  }, []);

  // Initial mount — render initial DOM.
  useLayoutEffect(() => {
    if (!rootRef.current) return;
    renderDom(rootRef.current, value, fileLookup);
    lastSerializedRef.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value update — rebuild if `value` diverges from our last
  // serialized string (handleInput pre-sets lastSerializedRef before
  // calling onChange, so our own echo doesn't trigger this).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (value === lastSerializedRef.current) return;
    rebuildWithCursor(el, value, fileLookup);
    lastSerializedRef.current = value;
  }, [value, fileLookup]);

  /* ---------- autocomplete detection ---------- */

  const detectAutocomplete = useCallback((plain: string) => {
    const el = rootRef.current;
    if (!el) return null;
    if (document.activeElement !== el) return null;
    const caret = getCursorOffset(el);
    if (caret == null) return null;

    // We need an OPEN `#ref[` before the caret that hasn't been closed.
    // scanRuleFileMarkers won't see an unclosed marker, so find the
    // opener manually.
    const pre = plain.slice(0, caret);
    const openerRe = /(?<!\w)#ref\[/g;
    let lastOpener = -1;
    let opMatch: RegExpExecArray | null;
    while ((opMatch = openerRe.exec(pre)) !== null) {
      lastOpener = opMatch.index + opMatch[0].length; // position AFTER the `[`
    }
    if (lastOpener < 0) return null;
    // An unclosed opener → everything from `[` up to caret is the body.
    if (pre.indexOf(']', lastOpener) !== -1) return null;
    const inBracket = pre.slice(lastOpener);
    // Find the LAST `file:` scheme prefix before caret inside the body.
    const schemeIdx = inBracket.lastIndexOf('file:');
    if (schemeIdx === -1) return null;
    const query = inBracket.slice(schemeIdx + 'file:'.length);
    if (query.includes(']') || query.includes('|')) return null;
    // The "marker index" we care about is the index this marker WILL
    // occupy once it closes. Count already-complete markers before it.
    const existingMarkers = scanRuleFileMarkers(pre);
    const idx = existingMarkers.length;

    // Anchor rect — use the caret position from selection.
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const rect = range?.getClientRects?.()?.[0];
    const anchor = rect
      ? { x: rect.left, y: rect.bottom + 4 }
      : (() => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; })();

    return { anchorRect: anchor, markerIndex: idx, query, selectedIdx: 0 };
  }, []);

  const filteredFiles = useMemo(() => {
    if (!autocomplete || !libFiles) return [];
    const q = autocomplete.query.trim().toLowerCase();
    return (q ? libFiles.filter(f => f.filename.toLowerCase().includes(q)) : libFiles).slice(0, 20);
  }, [autocomplete, libFiles]);

  /* ---------- event handlers ---------- */

  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el) return;
    const plain = serializeDom(el);
    if (plain === lastSerializedRef.current) return;

    const prevCount = scanRuleFileMarkers(lastSerializedRef.current).length;
    lastSerializedRef.current = plain;
    onChange(plain);

    const ne = e.nativeEvent as InputEvent;
    const inserted = ne?.data || '';
    const isTerminator = inserted === ' ' || inserted === '\n' || inserted === ']' || inserted === '\t';
    const newCount = scanRuleFileMarkers(plain).length;

    // If the caret sits inside an OPEN marker bracket (i.e. a `#file[` or
    // `file:<id>[` has been typed but no matching `]` yet appears before
    // the caret), treat whitespace/newline/tab as ordinary characters.
    // The user is still composing the description — do NOT chip-ify.
    // Once the `]` lands, `insideOpenBracket` flips to false and a
    // rebuild fires as normal.
    const caret = (getCursorOffset(el) ?? plain.length);
    const insideOpenBracket = hasUnclosedMarkerBracket(plain, caret);

    const shouldRebuild = !insideOpenBracket && (isTerminator || newCount < prevCount);
    if (shouldRebuild) {
      // Rebuild DOM in next frame so the current input event's effects
      // are committed first; the rebuild keeps the caret near where it was.
      requestAnimationFrame(() => {
        if (!rootRef.current) return;
        if (document.activeElement !== rootRef.current) return;
        rebuildWithCursor(rootRef.current, plain, fileLookup);
      });
    }

    // Update `ref:` autocomplete anchor + query.
    setAutocomplete(detectAutocomplete(plain));
  }, [onChange, fileLookup, detectAutocomplete]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (el) {
      const plain = serializeDom(el);
      renderDom(el, plain, fileLookup);
      lastSerializedRef.current = plain;
    }
    setAutocomplete(null);
    onBlurProp?.(e);
  }, [fileLookup, onBlurProp]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    onPasteProp?.(e);
    if (e.defaultPrevented) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, [onPasteProp]);

  /** Find a chip immediately adjacent to `node`/`offset` in the given
   *  direction, skipping zwsp-only text nodes. Returns the chip element
   *  or null when the caret has real text to delete. */
  const findAdjacentChip = useCallback((node: Node, offset: number, lookLeft: boolean): HTMLElement | null => {
    // Only when caret is at a boundary within a text node.
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = (node as Text).data;
      const lenNoZwsp = lengthNoZwsp(raw);
      if (lookLeft) {
        // count "how many non-zwsp chars are to the LEFT of offset" — if >0, there's real text to delete
        const leftSlice = raw.slice(0, offset);
        if (lengthNoZwsp(leftSlice) > 0) return null;
      } else {
        const rightSlice = raw.slice(offset);
        if (lengthNoZwsp(rightSlice) > 0) return null;
        // also guard against nothing-remaining-case
        if (offset > raw.length - 1 && lenNoZwsp > 0 && rightSlice.length === 0) return null;
      }
    } else if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    let cursor: Node | null = lookLeft ? (node.previousSibling || node.parentNode?.previousSibling || null)
                                       : (node.nextSibling || node.parentNode?.nextSibling || null);
    // Walk siblings in the chosen direction, skipping zwsp-only text nodes.
    while (cursor) {
      if (cursor.nodeType === Node.TEXT_NODE) {
        if (lengthNoZwsp((cursor as Text).data) === 0) {
          cursor = lookLeft ? cursor.previousSibling : cursor.nextSibling;
          continue;
        }
        return null;
      }
      if (cursor instanceof HTMLElement && cursor.matches('span.ref-chip')) return cursor;
      return null;
    }
    return null;
  }, []);

  /** Replace the N-th marker in `value` with a new source string (or
   *  delete it if `newSource` is null). */
  const replaceNthMarker = useCallback((chipIndex: number, newSource: string | null) => {
    const markers = scanRuleFileMarkers(value);
    const m = markers[chipIndex];
    if (!m) return;
    const before = value.slice(0, m.offset);
    const after = value.slice(m.offset + m.length);
    let replaced: string;
    if (newSource === null) {
      const merged = before.replace(/[ \t]$/, '') + (before && after && !before.endsWith(' ') && !after.startsWith(' ') ? ' ' : '') + after.replace(/^[ \t]/, '');
      replaced = merged;
    } else {
      replaced = before + newSource + after;
    }
    onChange(replaced);
  }, [value, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDownProp?.(e);
    if (e.defaultPrevented) return;

    // Autocomplete navigation takes priority when open.
    if (autocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocomplete(s => s ? { ...s, selectedIdx: Math.min(filteredFiles.length - 1, s.selectedIdx + 1) } : s);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocomplete(s => s ? { ...s, selectedIdx: Math.max(0, s.selectedIdx - 1) } : s);
        return;
      }
      if (e.key === 'Enter') {
        const pick = filteredFiles[autocomplete.selectedIdx];
        if (pick) {
          e.preventDefault();
          applyAutocompletePick(autocomplete.markerIndex, pick);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAutocomplete(null);
        return;
      }
    }

    // Whole-chip deletion on Backspace/Delete adjacent to a chip.
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (range.collapsed) {
          const chip = findAdjacentChip(range.endContainer, range.endOffset, e.key === 'Backspace');
          if (chip) {
            e.preventDefault();
            const allChips = Array.from(rootRef.current!.querySelectorAll('span.ref-chip'));
            const idx = allChips.indexOf(chip);
            if (idx >= 0) replaceNthMarker(idx, null);
            return;
          }
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
    }
  }, [onKeyDownProp, autocomplete, filteredFiles, findAdjacentChip, replaceNthMarker]);

  const applyAutocompletePick = useCallback((_markerIndex: number, pick: LibraryFileEntry) => {
    const el = rootRef.current;
    if (!el) return;
    // Autocomplete only fires mid-typing inside an unclosed `#ref[`.
    // The marker being composed is not yet visible to
    // `scanRuleFileMarkers`, so locate its opener manually and replace
    // the span `#ref[ … (caret|next ])` with a full canonical pin.
    const caret = getCursorOffset(el);
    if (caret == null) return;
    const pre = value.slice(0, caret);
    const openerRe = /(?<!\w)#ref\[/g;
    let openerStart = -1;
    let m: RegExpExecArray | null;
    while ((m = openerRe.exec(pre)) !== null) {
      openerStart = m.index;
    }
    if (openerStart < 0) return;
    const tail = value.slice(openerStart);
    const closeRel = tail.indexOf(']');
    const replaceEnd = closeRel === -1 ? caret : openerStart + closeRel + 1;
    const newSource = `#ref[file:${pick.prefix_id}|${pick.filename}]`;
    const next = value.slice(0, openerStart) + newSource + value.slice(replaceEnd);
    onChange(next);
    setAutocomplete(null);
    requestAnimationFrame(() => {
      if (!rootRef.current) return;
      rootRef.current.focus();
      setCursorOffset(rootRef.current, openerStart + newSource.length);
    });
  }, [value, onChange]);

  /* ---------- click / double-click routing ---------- */

  const handleRootClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const root = rootRef.current;
    if (!root) return;
    const chip = target.closest('span.ref-chip') as HTMLElement | null;

    // Click on the × of a chip → remove the marker.
    if (chip && target.closest('[data-chip-remove]')) {
      e.preventDefault();
      e.stopPropagation();
      const allChips = Array.from(root.querySelectorAll('span.ref-chip'));
      const idx = allChips.indexOf(chip);
      if (idx >= 0) replaceNthMarker(idx, null);
      return;
    }
    // Chip body click is a no-op (double-click expands for editing).
    if (chip) return;

    // Click on text OUTSIDE any chip: re-chipify any raw-text markers
    // (markers that are currently shown as plain text because the user
    // just double-clicked them). Skip if the caret lands inside such a
    // marker — user is positioning to edit it.
    const plain = serializeDom(root);
    const markers = scanRuleFileMarkers(plain);
    const chipCount = root.querySelectorAll('span.ref-chip').length;
    if (chipCount >= markers.length) return;
    const caret = getCursorOffset(root);
    if (caret != null && markers.some(m => caret > m.offset && caret <= m.offset + m.length)) return;
    rebuildWithCursor(root, plain, fileLookup);
    lastSerializedRef.current = plain;
  }, [readOnly, replaceNthMarker, fileLookup]);

  const handleRootDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const chip = target.closest('span.ref-chip') as HTMLElement | null;
    if (!chip || !rootRef.current?.contains(chip)) return;
    if (target.closest('[data-chip-remove]')) return;

    e.preventDefault();
    e.stopPropagation();

    const allChips = Array.from(rootRef.current.querySelectorAll('span.ref-chip'));
    const chipIndex = allChips.indexOf(chip);
    const markers = scanRuleFileMarkers(value);
    const m = markers[chipIndex];
    if (!m) return;

    renderDomWithPlainMarker(rootRef.current, value, chipIndex, fileLookup);
    lastSerializedRef.current = value;
    rootRef.current.focus();
    // Place caret just BEFORE the closing `]` so the user is inside the
    // description ready to edit. If there's no `]`, place at end of marker.
    const rawMarker = value.slice(m.offset, m.offset + m.length);
    const closingRelative = rawMarker.lastIndexOf(']');
    const caret = closingRelative >= 0 ? m.offset + closingRelative : m.offset + m.length;
    setCursorOffset(rootRef.current, caret);
  }, [value, fileLookup, readOnly]);

  /* ---------- render ---------- */

  const editorStyle = useMemo<React.CSSProperties>(() => ({ minHeight: minHeightPx ?? 40 }), [minHeightPx]);

  return (
    <div className="relative">
      <div
        id={id}
        ref={rootRef}
        data-file-prompt-root="true"
        role="textbox"
        aria-multiline="true"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={handleInput}
        onFocus={onFocus}
        onBlur={handleBlur}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onClick={handleRootClick}
        onDoubleClick={handleRootDoubleClick}
        data-placeholder={placeholder || ''}
        className={cn(
          'file-prompt-editor w-full text-sm leading-relaxed rounded-md border border-input bg-background px-3 py-2 outline-none whitespace-pre-wrap break-words',
          'focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-foreground/40',
          readOnly && 'bg-muted cursor-not-allowed opacity-80',
          className,
        )}
        style={editorStyle}
      />

      {autocomplete && filteredFiles.length > 0 && createPortal(
        <RefAutocomplete
          anchorRect={autocomplete.anchorRect}
          items={filteredFiles}
          selectedIdx={autocomplete.selectedIdx}
          onPick={(pick) => applyAutocompletePick(autocomplete.markerIndex, pick)}
          onHover={(idx) => setAutocomplete(s => s ? { ...s, selectedIdx: idx } : s)}
        />,
        document.body,
      )}

      <style>{`
        .file-prompt-editor:empty::before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground));
          pointer-events: none;
        }
        .file-prompt-editor span.ref-chip { vertical-align: baseline; }
        .file-prompt-editor .ref-chip-x {
          display: inline-block;
          margin-left: 2px;
          margin-right: -2px;
          padding: 0 3px;
          line-height: 1;
          border-radius: 3px;
          cursor: pointer;
          user-select: none;
        }
        .file-prompt-editor .ref-chip-x::after {
          content: '\u00d7';
          font-size: 14px;
          font-weight: 600;
          color: currentColor;
          opacity: .55;
        }
        .file-prompt-editor .ref-chip-x:hover::after { opacity: 1; }
      `}</style>
    </div>
  );
}

/* -------------------------- Autocomplete panel -------------------------- */

interface RefAutocompleteProps {
  anchorRect: { x: number; y: number };
  items: LibraryFileEntry[];
  selectedIdx: number;
  onPick: (pick: LibraryFileEntry) => void;
  onHover: (idx: number) => void;
}

function RefAutocomplete({ anchorRect, items, selectedIdx, onPick, onHover }: RefAutocompleteProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Block pointerdown from bubbling to Radix Dialog's dismissable layer.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const block = (e: Event) => {
      if (el.contains(e.target as Node)) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('mousedown', block, true);
    return () => {
      document.removeEventListener('pointerdown', block, true);
      document.removeEventListener('mousedown', block, true);
    };
  }, []);

  const W = 320;
  const MAX_H = 260;
  const x = Math.min(Math.max(8, anchorRect.x), window.innerWidth - W - 8);
  const y = Math.min(anchorRect.y, window.innerHeight - MAX_H - 8);

  return (
    <div
      ref={ref}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        position: 'fixed', left: x, top: y,
        width: W, maxHeight: MAX_H,
        zIndex: 10002,
        borderRadius: 6,
        display: 'flex', flexDirection: 'column',
        overflow: 'auto',
      }}
      className={cn(
        'bg-white text-foreground shadow-lg ring-1 ring-black/5',
        'dark:bg-neutral-900 dark:ring-white/10 dark:shadow-none',
      )}
    >
      {items.map((f, i) => (
        <button
          key={f.prefix_id}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onPick(f); }}
          onMouseEnter={() => onHover(i)}
          className={cn(
            'flex items-center gap-2 px-2 py-1.5 text-left text-[12px] text-foreground',
            i === selectedIdx
              ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-900 dark:text-indigo-100'
              : 'hover:bg-muted',
          )}
        >
          <FileText className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />
          <span className="truncate flex-1">{f.filename}</span>
          <span className="text-[10px] text-muted-foreground">{f.mime_type.split('/').pop()}</span>
        </button>
      ))}
    </div>
  );
}
