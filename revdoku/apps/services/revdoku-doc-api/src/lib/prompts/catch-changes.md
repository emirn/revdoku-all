Compare the current document pages with the previous revision's text content provided in the "Previous Revision Page Texts" section above.

For each change you identify that is NOT already covered by the rules above, evaluate whether it introduces an error, inconsistency, or compliance issue.

IMPORTANT: Create a SEPARATE FAILED check for EACH individual change — never combine multiple changes into one check. Each check must describe exactly one change (e.g., one field value change, one added/removed line).

The description MUST follow one of these exact formats:

For CHANGED content (text/value was modified):
  With location:    <Where> changed "<previous>" to "<current>"
  Without location: Changed "<previous>" to "<current>"

For ADDED content (new content not in previous revision):
  With location:    <Where> added "<content>"
  Without location: Added "<content>"

For REMOVED content (content from previous revision is gone):
  With location:    <Where> removed "<content>"
  Without location: Removed "<content>"

Rules:
- Always double-quote values
- No trailing period
- <Where> is a short location label (e.g. "Invoice number", "Professional Fees: Rate for third line item")

Examples:
  Header text changed "INVOICE" to "REVISED INVOICE"
  Invoice number changed "GL-2026-0024" to "GL-2026-0024-R1"
  Changed "$1,575.00" to "$2,250.00"
  Professional Fees: Title for third line item changed "Associate" to "Senior Partner"
  Added "Replaces: GL-2026-0024"
  Footer added "Page 1 of 2"
  Payment terms removed "Net 30"
  Removed "Confidential Draft"

For each change: set passed=true if the change looks correct/intentional, or passed=false if it introduces an error, inconsistency, or compliance issue.

Point each check to the exact location of the change in the current document. When pointing to a specific changed word or phrase, ensure the bounding box coordinates precisely cover that text element on the page — use the grid rulers for accurate placement.

For pages that are primarily images, photos, or illustrations, also detect visual changes: layout shifts, color changes (report HEX values, e.g., Background color changed "#2563eb" to "#16a34a"), added/removed visual elements, text changes within the image, branding changes, size or position changes of elements, or any other visible differences. Describe each visual change specifically.

If all changes are already covered by the checklist rules above, or there are no meaningful changes between revisions, do NOT create any checks for this rule.

For each change check, also populate these fields:

"type" — classify the change using one or more comma-separated types: ch_text (general wording), ch_number (amounts, quantities, percentages, dosages), ch_date (dates/times), ch_name (person/company/entity names), ch_contact (phone/email/address), ch_url (links), ch_id (identifiers like policy#, invoice#, MRN, NPI, CPT codes), ch_currency (currency symbol/denomination), ch_duration (time periods/terms), ch_legal (legal clause/condition language), ch_status (status labels like Draft/Final), ch_ref (references, citations, section numbers), ch_redact (content redacted/masked), ch_typo (spelling corrections), ch_format (formatting changes), ch_size (font size, element dimensions), ch_color (color values), ch_image (visual/graphic changes), ch_added (new content), ch_removed (deleted content). Use multiple comma-separated types when applicable (e.g. "ch_number,ch_currency").

"val_p" — the exact previous text/value from the prior revision (empty string if new content).

"val" — the exact current text/value in this document (empty string if content was removed).
