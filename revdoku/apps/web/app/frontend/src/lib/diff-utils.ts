import { createPatch, diffWords, diffArrays, type ChangeObject } from 'diff';
import type { IPageDiff, IPageText } from '@revdoku/lib';

export interface WordDiffSegment {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export type TokenChange = ChangeObject<string[]>;

export function computePageDiffs(previous: IPageText[], current: IPageText[]): IPageDiff[] {
  const prevMap = new Map(previous.map(p => [p.page, p.text]));
  const allPages = new Set([...previous.map(p => p.page), ...current.map(p => p.page)]);

  return Array.from(allPages).sort((a, b) => a - b).map(page => {
    const oldText = prevMap.get(page) || '';
    const newText = current.find(p => p.page === page)?.text || '';
    const diff = createPatch(`page-${page}`, oldText, newText, 'previous', 'current');
    const has_changes = oldText !== newText;
    return { page, diff, has_changes };
  });
}

export function computeWordDiffs(oldText: string, newText: string): WordDiffSegment[] {
  return diffWords(oldText, newText);
}

function splitWordsAndWhitespace(text: string): string[] {
  const result: string[] = [];
  const re = /(\s+)|(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    result.push(m[0]);
  }
  return result;
}

function tokenizeHtmlAware(text: string): string[] {
  const tagRegex = /<\/?[a-zA-Z][^>]*\/?>/g;
  const tokens: string[] = [];
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(...splitWordsAndWhitespace(text.slice(lastIndex, match.index)));
    }
    tokens.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push(...splitWordsAndWhitespace(text.slice(lastIndex)));
  }

  return tokens;
}

export function isHtmlTag(token: string): boolean {
  return /^<\/?[a-zA-Z][^>]*\/?>$/.test(token);
}

/** Markdown structural tokens that must not be wrapped in diff markers or marked.parse() breaks */
export function isMarkdownStructural(token: string): boolean {
  return /^#{1,6}$/.test(token) || token === '>' || token === '---' || token === '***';
}

export function computeHtmlAwareWordDiffs(oldText: string, newText: string): TokenChange[] {
  const oldTokens = tokenizeHtmlAware(oldText);
  const newTokens = tokenizeHtmlAware(newText);
  return diffArrays(oldTokens, newTokens);
}

/**
 * Word-wraps text into SVG <tspan> elements that fit within given pixel dimensions.
 * Returns the <tspan> markup string and the total block height for vertical centering.
 */
function svgWrapText(text: string, width: number, height: number, fontSize: number): { tspans: string; blockHeight: number } {
  const charWidth = fontSize * 0.55;
  const lineHeight = fontSize + 2;
  const padding = 4;
  const maxCharsPerLine = Math.max(4, Math.floor((width - padding * 2) / charWidth));
  const maxLines = Math.max(1, Math.floor((height - padding * 2) / lineHeight));

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      if (lines.length >= maxLines) break;
      current = word.length > maxCharsPerLine ? word.slice(0, maxCharsPerLine - 1) + '\u2026' : word;
    } else if (candidate.length > maxCharsPerLine) {
      lines.push(candidate.slice(0, maxCharsPerLine - 1) + '\u2026');
      current = '';
      if (lines.length >= maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  const blockHeight = lines.length * lineHeight;
  const startY = Math.max(padding, (height - blockHeight) / 2 + fontSize * 0.8);
  const tspans = lines.map((line, i) =>
    `<tspan x='50%' dy='${i === 0 ? 0 : lineHeight}'>${line}</tspan>`
  ).join('');

  return {
    tspans: `<text y='${startY}' text-anchor='middle' font-size='${fontSize}' font-family='sans-serif' opacity='0.7'>${tspans}</text>`,
    blockHeight,
  };
}

/**
 * Converts <img data-color="..." width="..." height="..." alt="..." /> tags in page_text HTML
 * into visual SVG placeholders at render time. Only used in the diff viewer — never modifies stored data.
 * Handles attributes in any order since AI may produce them differently.
 */
export function injectImagePlaceholders(html: string): string {
  return html.replace(
    /<img\s+([^>]*data-color="[^"]*"[^>]*?)\s*\/?>/g,
    (match, attrs: string) => {
      const color = attrs.match(/data-color="(#[0-9a-fA-F]{6})"/)?.[1];
      const w = attrs.match(/width="(\d+)"/)?.[1];
      const h = attrs.match(/height="(\d+)"/)?.[1];
      const alt = attrs.match(/alt="([^"]*)"/)?.[1] || '';
      if (!color || !w || !h) return match; // can't convert, leave as-is
      const wNum = Number(w);
      const hNum = Number(h);
      const hex = color.replace('#', '%23');
      // Pick contrasting text color based on perceived brightness
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const textFill = luminance > 0.5 ? '%23000000' : '%23ffffff';
      // Encode for SVG XML inside a data URI inside an HTML src attribute (3 encoding layers):
      // 1. HTML parser decodes entities in attribute values (&amp; → &)
      // 2. Data URI URL-decodes percent sequences (%26 → &)
      // 3. SVG/XML parser interprets entities (&amp; → &)
      // So & must become %26amp; → URL-decode to &amp; → XML-parse to &
      const escapedAlt = alt
        .replace(/&/g, '%26amp;')
        .replace(/</g, '%26lt;')
        .replace(/>/g, '%26gt;')
        .replace(/#/g, '%23');
      const { tspans: textMarkup } = svgWrapText(escapedAlt, wNum, hNum, 7);
      // Inject fill color into the generated <text> element
      const coloredText = textMarkup.replace('<text ', `<text fill='${textFill}' `);
      const src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='${hex}'/>${coloredText}</svg>`;
      return `<img src="${src}" width="${w}" height="${h}" alt="${alt}" title="${alt}" />`;
    }
  );
}
