Field Extraction

Extract the key fields from the document into a simple field,value table. Use this template to demo the user-script hook — the script below collects every extracted value and renders them in a two-column table. Customize the rule prompt to say which fields you want extracted.

- For every key field on the document (name, date, amount, reference number, party, etc.), create ONE check. Mark PASSED once you extract the field and its value. #value — save as `field,value` where field is a short snake_case name describing what was extracted (e.g., `invoice_number`, `issue_date`, `total_amount`, `customer_name`) and value is the literal value from the document with no formatting added. Examples: `invoice_number,INV-2024-0042`, `issue_date,2024-03-15`, `total_amount,1250.00`, `customer_name,Acme Corp`. Place the highlight around the field label and value on the page.

<script>
const script_template = `{{#if empty}}<em>No fields extracted yet.</em>{{else}}<table style="width:100%;font-size:13px;border-collapse:collapse">{{#each items}}<tr><td style="padding:2px 6px;color:#6b7280">{{field}}</td><td style="padding:2px 6px;font-variant-numeric:tabular-nums"><b>{{value}}</b></td></tr>{{/each}}</table>{{/if}}`;

const items = [];
checks.filter(c => c.data && c.data.val).forEach(c => {
  const parts = String(c.data.val).split(',');
  const field = (parts[0] || '').trim();
  const value = parts.slice(1).join(',').trim();
  if (field) items.push({ field, value });
});
if (items.length === 0) return { data: { empty: true } };
return { data: { items } };
</script>
