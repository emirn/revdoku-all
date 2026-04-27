*Line-Item Extraction & Totals

Extract every leaf-level amount on the document, tag each with a short category derived from the line's own description, and let the user script total per category and overall. Works on invoices, receipts, expense reports, statements, bills, and any itemized document where you want a "where the money went" breakdown.

HOW TO CHOOSE THE CATEGORY

Default behaviour: derive the category from the product, service, or item name on the line itself, normalized to a short snake_case token. This is the primary rule, not a fallback. When the line has a clear description, USE THAT as the category.

Examples of correct per-line categorisation:
- "Consulting — strategy workshop" → `consulting`
- "Airfare — NYC to LAX" → `airfare`
- "Hotel — 3 nights" → `hotel`
- "Sales tax 8.875%" → `sales_tax`
- "Shipping — ground" → `shipping`
- "Raw steel, 500 kg" → `materials`

Group related charges for the same item under the same token so they sum together: a product's base charge and its matching tax line both belong to the product category, not split across the item and a generic "taxes" bucket.

Exceptions (and ONLY these):
- If a category reference document is attached AND it applies to this document, use categories from that list verbatim.
- If a line has no identifying name (generic "Miscellaneous", "Other charges", untagged row), fall back to one of the generic buckets: `labor`, `materials`, `travel`, `equipment`, `services`, `fees`, `taxes`, `shipping`, `discounts`, `other`. Use a generic bucket only for truly unlabelled lines, NEVER as a default for lines that have a clear product name.

- For every leaf-level financial amount on the document, create ONE check. Mark PASSED when you extract the amount and assign a category. Mark FAILED only when the amount is unreadable — zero amounts (0, 0.00) are valid and MUST still be extracted. When a row shows multiple amount columns, extract the final customer-facing amount (typically the Total, Charges, or Amount column), never unit rates or usage metrics. #value — save as `category,amount` where category follows the rule above and amount is a plain decimal number with no currency symbol, no thousands separator, no trailing text. Examples: `consulting,1250.00`, `airfare,482.50`, `hotel,847.00`, `sales_tax,106.50`, `shipping,25.00`. Place the highlight around the amount and its description.

<script>
const script_template = `{{#if empty}}<em>No categorized values extracted yet.</em>{{else}}<div style="font-size:14px;margin-bottom:6px"><b>Total \${{total}}</b> — {{summary}}</div><table style="width:100%;font-size:13px;border-collapse:collapse">{{#each items}}<tr><td style="padding:2px 6px"><b>{{name}}</b></td><td style="text-align:right;padding:2px 6px;font-variant-numeric:tabular-nums">\${{value}}</td><td style="text-align:right;padding:2px 6px;color:#6b7280">{{count}}×</td></tr>{{/each}}</table>{{/if}}`;

const groups = {};
const counts = {};
let totalCount = 0;
checks.filter(c => c.data && c.data.val).forEach(c => {
  const parts = String(c.data.val).split(',');
  const cat = (parts[0] || '').trim().toLowerCase() || 'other';
  const amt = parseFloat((parts[1] || '').trim().replace(/[^0-9.\-]/g, ''));
  if (!isNaN(amt)) {
    groups[cat] = (groups[cat] || 0) + amt;
    counts[cat] = (counts[cat] || 0) + 1;
    totalCount += 1;
  }
});
const keys = Object.keys(groups);
if (keys.length === 0) return { data: { empty: true } };
const sortedKeys = keys.sort((a, b) => groups[b] - groups[a]);
const totalNum = sortedKeys.reduce((s, k) => s + groups[k], 0);
const items = sortedKeys.map(k => ({
  name: k,
  value: groups[k].toFixed(2),
  count: counts[k],
}));
const summary = totalCount + ' item' + (totalCount === 1 ? '' : 's') + ' in ' + keys.length + ' categor' + (keys.length === 1 ? 'y' : 'ies');
return { data: { total: totalNum.toFixed(2), summary, items } };
</script>
