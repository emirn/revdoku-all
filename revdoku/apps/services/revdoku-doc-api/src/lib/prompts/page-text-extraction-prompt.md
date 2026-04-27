## Page Text Extraction
For EACH page in the document, extract the full visible text content as constrained markdown. Return this in the `page_texts` array with one entry per page (page numbers are 1-based).

Formatting rules (follow EXACTLY for consistency):
- # for main headings, ## for subheadings, ### for sub-subheadings
- | col1 | col2 | for tables (always include header row and separator). Prefer tables when content is arranged in rows or columns (e.g., menus with prices, line-item lists, schedules, comparison grids)
- - for unordered lists (never use * or +)
- 1. for ordered lists
- > for quoted or indented blocks
- --- for horizontal lines or visual separators (on its own line, blank lines above and below)
- ~~text~~ for visually struck-through text in the source document
- Plain paragraphs for body text, separated by blank lines
- NEVER use **bold**, *italic*, or any other inline markdown formatting — use <span style="font-weight:bold"> for bold text instead
- Preserve the reading order exactly as it appears on the page{{PAGE_LABEL_INSTRUCTION}}

Visual element formatting (use HTML tags when color, size, or font styling matters):
- For styled text (color, size, or weight differs from body text): <span style="color:#HEX; font-size:SIZE; font-weight:bold">text</span>
  - color: always include as #HEX when text has a notable color (e.g., color:#dc2626)
  - font-size: use em values — 0.7em (fine print), 0.85em (small), 1.25em (large), 1.5em (x-large), 2em (very large). Only include when size differs from surrounding body text
  - font-weight: only include "bold" when text is bold; omit for normal weight
  - font-style: only include "italic" when text is italic; omit for normal
  - text-decoration: only include "underline" when text is underlined; omit for normal
  - Always order style properties: color, font-size, font-weight, font-style, text-decoration, border, padding, background (omit properties that don't apply)
  - Example: <span style="color:#dc2626; font-size:2em; font-weight:bold">SALE 50% OFF</span>
  - For body text with no special styling, use plain markdown (no HTML needed)
- For stamped or boxed text (text with a visible border/outline around it): add border and padding to the span style
  - Example: <span style="color:#dc2626; font-weight:bold; border:2px solid #dc2626; padding:2px 6px">UNPAID</span>
- For styled headings: <h2 style="color:#HEX">heading text</h2> (only when heading has a notable color)
- Do NOT wrap content in <div> tags — markdown (tables, headings, lists) inside HTML block elements will not render correctly
- For images, logos, illustrations, and other non-text visual elements: <img data-color="#HEX" width="W" height="H" alt="type:description" />
  - data-color: dominant/foreground color as #HEX
  - width/height: approximate pixel dimensions
  - alt: type prefix followed by colon and concise description (up to 100 words)
  - Allowed types: logo, photo, chart, diagram, signature, icon, decoration, stamp, barcode, illustration
  - Example: <img data-color="#1e40af" width="200" height="80" alt="logo:Company ABC" />
  - Example: <img data-color="#f97316" width="400" height="300" alt="photo:Sunset over ocean, orange sky and blue water" />
  - Example: <img data-color="#000000" width="100" height="20" alt="barcode:Code 128" />

For pages that are primarily images, photos, or illustrations (e.g., advertisements, posters, product photos), provide a DETAILED structured description:
- Overall layout and composition (what is where, relative positions)
- ALL visible text content with exact wording, wrapped in <span style="color:#HEX; font-size:SIZE"> with color and size
- Colors and color schemes as HEX values in the HTML attributes
- Every distinct visual element as a separate <img data-color="#HEX" width="W" height="H" alt="type:description" /> tag
- Branding elements (logos, taglines), people, objects, and decorative elements
- Background colors noted as: <!-- background:#HEX --> above the relevant section
