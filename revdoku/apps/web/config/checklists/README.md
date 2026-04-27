# Default Checklist Templates

This directory holds the catalog of **default checklist templates** that ship with Revdoku.

Each template is a single Markdown file under `templates/`. The format is plain text with a small set of conventions parsed by `app/services/checklist_text_parser.rb`. The Rails side syncs them into the global `checklist_templates` table on deploy via:

- `bin/rails checklist_templates:sync` — upsert all templates from this directory by name (overwrites in place).
- `bin/rails checklists:seed_invoice_catalog` — first-time seed (idempotent; skips templates already present by name).

Templates flagged as **default for new accounts** (see below) are auto-created as a fresh `Checklist` for every newly-signed-up account by `DefaultChecklistLoader`.

## Directory layout

```
config/checklists/
├── README.md                         ← this file
└── templates/
    ├── 01-invoice-review.md          ← `*` prefix in title → default for new accounts
    ├── 02-invoice-arithmetic-check.md
    ├── …
    ├── 07-blank-custom-checklist.md
    ├── 08-receipt-check.md           ← no `*` prefix → catalog-only template
    └── …
```

The numeric prefix on each filename (e.g. `01-`, `02-`) controls the order they appear in the catalog (lower number = higher in the picker). The slug after the prefix is the kebab-cased template name; pick whatever sorts cleanly when you add a new file.

The same name MUST NOT appear in two files. Names are matched case-insensitively when upserting.

## Template file format

Each `.md` file represents one checklist template. The format (parsed by `ChecklistTextParser.parse`):

```markdown
*Invoice Review

You are an accounts payable reviewer. Do a fast, essentials-only review …
(this paragraph + any following paragraphs become the system prompt)

If a reference document is attached, verify every line matches.
(blank lines separate paragraphs, all are joined into the system prompt)

- The invoice includes a unique invoice number and an invoice date
- The vendor's full legal name and the buyer / bill-to name are present
- Every line item includes a description, quantity, unit price, and extended amount
(every bullet becomes one Rule — order is preserved)

<script>
// optional: a user_script block, copy/paste-evaluated when the report renders.
// Has access to `checks` (array of inspection results). Returns { data: ... }
// to feed the Handlebars template at the top.
const items = checks.filter(c => c.data && c.data.val);
return { data: { items } };
</script>
```

### The pieces

| Piece | What it is | Required? |
|------|------------|-----------|
| **First non-blank line** | Template `name`. Prefix with `*` to mark it as a default for new accounts (see below). The `*` is stripped from the stored name. | yes |
| **Blank line** | Separates the name from the system prompt. | yes |
| **Paragraph(s)** | The `system_prompt`. Multiple blank-line-separated paragraphs are joined with blank lines preserved. | optional — leave out for a rules-only template |
| **Bullet list** | Each bullet becomes one rule. List markers `- `, `* `, `[ ] `, `1. `, `2) ` etc. are all stripped. Order is preserved as the rule's `order` field. | optional — but most templates have rules |
| **`<script>…</script>`** | A user-script block (a fragment of JavaScript / Handlebars rendering logic) that is stored verbatim on the template's `user_scripts[0].code` field. The Rails frontend evaluates it when rendering the report to compute custom totals / aggregations. | optional |

### The `*` prefix on the name

A leading `*` on the title line marks the template as **default for new accounts** — the `DefaultChecklistLoader` auto-creates it as a new `Checklist` for every newly-signed-up account. Without the `*`, the template lives in the catalog (browsable from the user's checklist picker) but is not auto-created.

```markdown
*Invoice Review        ← will be auto-created on every new account
Receipt Check          ← catalog-only; user picks it from the template browser
```

The `*` is consumed by the parser (`ChecklistTextParser.parse`) and never reaches the UI.

### Reference documents and value extraction

Two special markers can appear inside a rule's prompt; the parser leaves them as-is and the AI / frontend handle them at runtime:

- `#ref[Upload the reference]` — tells the UI to require the user to upload a reference document at review time. The AI then has both the document under review and the reference available to compare against.
- `#value — save as field,value` — tells the AI to extract a structured value into the check's `data.val` field. A user-script block (above) can then aggregate these.

See `07-blank-custom-checklist.md` and `25-field-extraction.md` for live examples.

## Adding a new template

1. Pick a number that fits the order you want. Renumbering existing files is fine — the prefix only drives sort order, nothing references the number.
2. Create `config/checklists/templates/NN-your-template-name.md`.
3. Write the title line, system prompt, and rules following the format above.
4. If it should auto-seed on new accounts, add a `*` prefix to the title line.
5. Run `bin/rails checklist_templates:sync` to upsert into the global table. (Production deploys run this automatically.)

## Editing an existing template

Just edit the `.md` file and re-run `bin/rails checklist_templates:sync`. The sync upserts by name, so prompt / rule edits land in place — existing user-created checklists derived from the template are NOT touched (templates are copied at account-creation time, not linked).

## Removing a template

Delete the file. `sync!` does NOT auto-delete rows — you'll also need to remove the corresponding `ChecklistTemplate` row from `/admin/checklist_templates` if you want it gone from the catalog. Templates already copied into user accounts are unaffected.

## Why this layout

A single file (`default_checklist_templates.txt`) used to hold all templates separated by `---`. That worked but made diffs noisy whenever a single template changed, and discouraged precise per-template review. Splitting into one file per template:

- gives each template its own diff history
- makes PRs touching one template tiny and reviewable
- makes the catalog naturally browseable via filesystem listing

The parser stayed identical — each `.md` file is exactly what one block of the old `---`-separated file used to be.
