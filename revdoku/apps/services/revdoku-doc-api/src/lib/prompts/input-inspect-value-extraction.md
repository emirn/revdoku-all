## VALUE EXTRACTION — enumeration rules with `#value`

This checklist contains at least one rule with a `#value` marker. Treat those as **enumeration/extraction** rules: you emit one check per matching item found in the document, you populate `val` with the rule's requested format, and the downstream script aggregates those values. Accuracy here matters more than prose — a missed or duplicated extraction directly corrupts the user's report.

### No duplicates across pages

Extract each item EXACTLY ONCE across the whole document. Many multi-page documents (AWS bills, utility bills, telecom invoices, consolidated statements, progress reports with an executive summary, bank statements with a cover summary) show the **same per-item entries on two pages**: a front/summary page that rolls up the detail, and a later detail page that lists the leaf items again. Both views are the SAME data — if you extract from both, you double-count and the grand total doubles.

Detection heuristics to catch rollup duplication before emitting a check:
- Same item label + same amount appears on two pages → one is a rollup, one is detail. **Extract from the detail page only.**
- A page is titled "Summary", "Invoice Summary", "Account Summary", "Statement Summary", or shows a list of services/items with their totals and then the same list is broken down later → that page is a rollup.
- A page marked "Detail", "Detail Charges", "Line Items", "Itemized", or similar is usually the detail source — prefer it.
- If both pages are equally detailed, pick whichever was laid out FIRST and skip later duplicates.

### No duplicates across BATCHES — honour `<prior_batch_findings>`

When the system message contains a `<prior_batch_findings>` block, it is a list of the SAME physical items that were ALREADY extracted on earlier pages of THIS SAME document. They are not hypothetical — they were emitted as real checks in the last AI call, are now saved in the report, and will be merged with your output. **If the same item (same label + same amount) also appears on the pages you are inspecting now, do NOT extract it again. Skip it completely. Assume that each physical row in the document ends up as exactly ONE check across the final merged report, no matter which batch sees it first.**

This is especially important when batches split a document into a summary page (batch 1) and a detail page (batch 2): you will see the same services on both. The first batch extracts; the second batch must NOT re-extract anything that already appears in `<prior_batch_findings>`. If every single item on the pages you see is already in `<prior_batch_findings>`, emit zero extraction checks for those rules — that's correct behaviour, not an error.

Matching logic:
- Same service/item name (allow minor whitespace / case differences).
- Same numeric amount (to the cent).
- If both match a prior finding → skip.

### No duplicates within a page

Inside a single page, the same item should also only be extracted once. If a page shows a subtotal line that aggregates items above it, extract the leaf items, NOT the subtotal. If the same item appears twice in a single page (e.g. a continuation line and a reprise at the bottom), extract it once.

### Extraction completeness

For pages that DO contain extractable items, you MUST produce a check for every leaf item — do not stop at a few representative samples. If a page has 40 line items, emit 40 checks with that page's `page` number.

### Value format

`val` must exactly match the shape the rule asks for. If the rule says `save as 'category,amount'`, the value MUST be the two-field comma-joined string (no spaces after comma, no quotes, no trailing punctuation, no currency symbol). If the rule asks for a single number, emit just the number. Do NOT invent additional fields the rule did not request.

### Include the value in the description

As covered in the OUTPUT STYLE section above: whenever `val` is populated, the description MUST end with the extracted value in parentheses using the same format as `val` (e.g. `"... for Amazon RDS Service VAT. (taxes, 17.64)"`). Readers should not need to look at the `data` payload to see what was extracted.
