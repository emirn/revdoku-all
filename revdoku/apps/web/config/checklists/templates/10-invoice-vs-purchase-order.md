Invoice vs. Purchase Order

Cross-check an invoice against the purchase order that authorized it. Flag every deviation from the PO. #ref[Upload the purchase order] — the PO is required for this review.

- The invoice references the PO by PO number
- Every line item on the invoice matches a line item on the PO (description, part / SKU if present)
- Every line item unit price on the invoice matches the PO unit price exactly
- Every line item quantity on the invoice is equal to or less than the PO quantity (flag overages)
- Any line item on the invoice that is NOT on the PO is flagged as an unauthorized addition
- The ship-to, bill-to, and remit-to on the invoice match the PO
- Payment terms on the invoice match the PO
- The tax rate, shipping method, and freight terms match the PO
- The invoice total is plausible given the PO total and the actual quantities delivered
