import { useMemo, forwardRef } from "react";
import { marked } from "marked";
import { computeHtmlAwareWordDiffs, isHtmlTag, isMarkdownStructural, injectImagePlaceholders, type TokenChange } from "@/lib/diff-utils";

// Null-byte marker tokens that survive markdown parsing
const ADD_START = "\x00AS\x00";
const ADD_END = "\x00AE\x00";
const DEL_START = "\x00DS\x00";
const DEL_END = "\x00DE\x00";

export const MARKDOWN_PROSE_CLASSES = `
  text-xs leading-relaxed
  [&_.md-diff-add]:bg-green-200 [&_.md-diff-add]:text-green-900 [&_.md-diff-add]:rounded-sm [&_.md-diff-add]:px-0.5
  dark:[&_.md-diff-add]:bg-green-900/50 dark:[&_.md-diff-add]:text-green-300
  [&_.md-diff-del]:bg-red-200 [&_.md-diff-del]:text-red-900 [&_.md-diff-del]:line-through [&_.md-diff-del]:rounded-sm [&_.md-diff-del]:px-0.5
  dark:[&_.md-diff-del]:bg-red-900/50 dark:[&_.md-diff-del]:text-red-300
  [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1
  [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-2.5 [&_h2]:mb-1
  [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-0.5
  [&_h4]:text-xs [&_h4]:font-semibold [&_h4]:mt-1.5 [&_h4]:mb-0.5
  [&_p]:my-1
  [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1
  [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1
  [&_li]:my-0.5
  [&_table]:w-full [&_table]:border-collapse [&_table]:my-2
  [&_th]:border [&_th]:border-gray-300 dark:[&_th]:border-gray-600 [&_th]:bg-gray-100 dark:[&_th]:bg-gray-800 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold
  [&_td]:border [&_td]:border-gray-300 dark:[&_td]:border-gray-600 [&_td]:px-2 [&_td]:py-1
  [&_code]:bg-gray-200 dark:[&_code]:bg-gray-700 [&_code]:px-1 [&_code]:rounded [&_code]:text-[11px]
  [&_pre]:bg-gray-200 dark:[&_pre]:bg-gray-700 [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-1
  [&_blockquote]:border-l-2 [&_blockquote]:border-gray-300 dark:[&_blockquote]:border-gray-600 [&_blockquote]:pl-3 [&_blockquote]:my-1 [&_blockquote]:text-gray-600 dark:[&_blockquote]:text-gray-400
  [&_hr]:my-2 [&_hr]:border-gray-300 dark:[&_hr]:border-gray-600
  [&_del]:line-through [&_del]:text-gray-500 dark:[&_del]:text-gray-400
  [&_img]:inline-block [&_img]:rounded [&_img]:border [&_img]:border-gray-300 dark:[&_img]:border-gray-600 [&_img]:my-1 [&_img]:max-w-full
`;

function wrapTextTokenInMarkers(token: string, startMarker: string, endMarker: string): string {
  // Split on newlines to avoid markers crossing block boundaries
  const lines = token.split("\n");
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0) {
      parts.push(startMarker + lines[i] + endMarker);
    }
    if (i < lines.length - 1) {
      parts.push("\n");
    }
  }
  return parts.join("");
}

/** Returns true for tokens that are structural (HTML tags, markdown heading markers, etc.) and must not be wrapped in diff markers */
function isStructural(token: string): boolean {
  return isHtmlTag(token) || isMarkdownStructural(token);
}

function buildMarkedDiffMarkdownFromTokens(segments: TokenChange[]): string {
  const parts: string[] = [];

  for (const seg of segments) {
    if (!seg.added && !seg.removed) {
      parts.push(seg.value.join(""));
      continue;
    }

    for (const token of seg.value) {
      if (seg.removed) {
        if (isStructural(token)) continue;
        if (token.trim().length === 0) continue;
        parts.push(wrapTextTokenInMarkers(token, DEL_START, DEL_END));
      } else {
        if (isStructural(token)) {
          parts.push(token);
          continue;
        }
        if (token.trim().length === 0) {
          parts.push(token);
          continue;
        }
        parts.push(wrapTextTokenInMarkers(token, ADD_START, ADD_END));
      }
    }
  }

  return parts.join("");
}

function buildSideDiffMarkdown(segments: TokenChange[], side: 'old' | 'new'): string {
  const parts: string[] = [];

  for (const seg of segments) {
    if (!seg.added && !seg.removed) {
      parts.push(seg.value.join(""));
      continue;
    }

    if (seg.removed) {
      if (side === 'new') continue;
      for (const token of seg.value) {
        if (isStructural(token)) { parts.push(token); continue; }
        if (token.trim().length === 0) { parts.push(token); continue; }
        parts.push(wrapTextTokenInMarkers(token, DEL_START, DEL_END));
      }
    }

    if (seg.added) {
      if (side === 'old') continue;
      for (const token of seg.value) {
        if (isStructural(token)) { parts.push(token); continue; }
        if (token.trim().length === 0) { parts.push(token); continue; }
        parts.push(wrapTextTokenInMarkers(token, ADD_START, ADD_END));
      }
    }
  }

  return parts.join("");
}

function replaceMarkersWithHtml(html: string): string {
  return html
    .replace(/\x00AS\x00/g, '<span class="md-diff-add">')
    .replace(/\x00AE\x00/g, "</span>")
    .replace(/\x00DS\x00/g, '<span class="md-diff-del">')
    .replace(/\x00DE\x00/g, "</span>");
}

/** Strip <div> and </div> tags so markdown inside them still gets parsed by marked */
function stripDivBlocks(text: string): string {
  return text.replace(/<\/?div[^>]*>/g, '');
}

export function renderMarkdown(text: string): string {
  const cleaned = stripDivBlocks(text);
  // Convert data-color img tags to SVG placeholders BEFORE marked.parse() to avoid & encoding issues
  const withImages = injectImagePlaceholders(cleaned);
  return marked.parse(withImages, { gfm: true, breaks: true }) as string;
}

function renderDiffMarkdown(markedSource: string): string {
  const cleaned = stripDivBlocks(markedSource);
  // Convert data-color img tags to SVG placeholders BEFORE marked.parse() to avoid & encoding issues
  const withImages = injectImagePlaceholders(cleaned);
  const rawHtml = marked.parse(withImages, { gfm: true, breaks: true }) as string;
  return replaceMarkersWithHtml(rawHtml);
}

export default function MarkdownDiffDisplay({ oldText, newText }: { oldText: string; newText: string }) {
  const html = useMemo(() => {
    const segments = computeHtmlAwareWordDiffs(oldText, newText);
    const markedSource = buildMarkedDiffMarkdownFromTokens(segments);
    return renderDiffMarkdown(markedSource);
  }, [oldText, newText]);

  return (
    <div
      className={`mt-1 p-3 bg-gray-50 dark:bg-gray-900 rounded overflow-x-auto max-h-80 overflow-y-auto ${MARKDOWN_PROSE_CLASSES}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export const MarkdownSingleSideDisplay = forwardRef<HTMLDivElement, {
  oldText: string;
  newText: string;
  side: 'old' | 'new';
  markDiffs: boolean;
  onScroll?: () => void;
}>(({ oldText, newText, side, markDiffs, onScroll }, ref) => {
  const html = useMemo(() => {
    if (!markDiffs) {
      return renderMarkdown(side === 'old' ? oldText : newText);
    }
    const segments = computeHtmlAwareWordDiffs(oldText, newText);
    const markedSource = buildSideDiffMarkdown(segments, side);
    return renderDiffMarkdown(markedSource);
  }, [oldText, newText, side, markDiffs]);

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className={`p-3 bg-gray-50 dark:bg-gray-900 overflow-x-auto overflow-y-auto flex-1 min-h-0 ${MARKDOWN_PROSE_CLASSES}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
