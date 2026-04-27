# CLAUDE.md — Revdoku Rails App (`apps/web`)

## Overview

Rails 8.1.2 app. SQLite3 with multi-database setup. React frontend integrated via Vite Ruby. HIPAA-compliant with per-account encryption and immutable audit logging.

**Databases** (all SQLite3, see `config/database.yml`):
- `primary` — main app data (`storage/{env}.sqlite3`)
- `cache` — Solid Cache (`db/cache_migrate`)
- `queue` — Solid Queue (`db/queue_migrate`)
- `cable` — Solid Cable (`db/cable_migrate`)
- `audit` — HIPAA audit logs, immutable via SQLite triggers (`db/audit_migrate`)

## Key Commands

```bash
bin/dev                    # Rails (3000) + Vite (3036) + Tailwind
rails db:migrate           # Run migrations (all databases)
bundle exec rspec          # Run specs
npm run build              # Vite production build
source ~/.rvm/scripts/rvm && rvm use 3.4.5  # If Ruby version issues
```

Dev credentials: `admin@gmail.com` / `1234512345`, API token: `devtoken_a1b2c3d4e5f6g7h8i9j0k1l2m3n4`

## Architecture Patterns

### Soft References (prefix_id)
All public APIs use `prefix_id` (e.g. `env_abc123`), never raw database IDs. The [`prefixed_ids`](https://github.com/excid3/prefixed_ids) gem provides `has_prefix_id :prefix`.

**How prefix_id works**: The gem adds a `prefix_id` column to each table, but the column is **always empty** — the prefix_id is computed dynamically from the record's integer `id` using a hashid. This means:

- `Model.find("env_abc123")` — works (gem overrides `find` via `override_find: true`)
- `Model.find_by_prefix_id("env_abc123")` — works (gem-provided class method)
- `scope.find_by_prefix_id("env_abc123")` — works on associations too
- `Model.decode_prefix_id("env_abc123")` — returns the raw integer ID
- `Model.where(prefix_id: "env_abc123")` — **BROKEN, always returns empty** (queries the empty column)
- `Model.find_by(prefix_id: "env_abc123")` — **BROKEN, same reason**

For batch lookups by prefix_id, decode to real IDs first: `Model.where(id: ids.filter_map { |pid| Model.decode_prefix_id(pid) rescue nil }).index_by(&:prefix_id)`

| Model | Prefix |
|---|---|
| Account | `acct_` |
| Envelope | `env_` |
| EnvelopeRevision | `envrv_` |
| Checklist | `clst_` |
| Report | `rpt_` |
| Check | `chk_` |
| DocumentFile | `df_` |
| DocumentFileRevision | `dfrev_` |
| SubscriptionPlan | `splan_` |

### Encryption (Lockbox)
Per-account encryption keys, encrypted by Lockbox master key. Encrypted fields have `_ciphertext` columns in the DB. Always access via the model attribute (e.g. `envelope.title`), never the `_ciphertext` column directly.

Encrypted fields: `Account#encryption_key`, `Envelope#title`, `Checklist#name/system_prompt/rules`, `Check#description`, `EnvelopeRevision#comment`, `DocumentFileRevision#name`.

ActiveStorage files are also encrypted: `encrypts_attached :file, key: :lockbox_encryption_key`.

The `AccountEncryptable` concern provides `lockbox_encryption_key` — resolves the owning account's key. The concern prefers `Current.account` when the record's `account_id` matches, which lets `kms_encrypted`'s per-instance DEK cache span all encrypted reads in a request/job (1 KMS call instead of N).

### Multi-tenancy
`acts_as_tenant :account` on `AccountRecord` base class. `Current.account` set by `Api::BaseController#set_current_context`. All tenant-scoped models inherit from `AccountRecord`. Background jobs receive tenant context automatically via `acts_as_tenant`'s built-in ActiveJob integration and Rails `CurrentAttributes` restoration.

### Authentication
Devise + OTP login (passwordless) + optional TOTP 2FA. API auth via Bearer token header OR signed HttpOnly cookie (`revdoku_api_token`). Token lookup uses SHA256 digest: `ApiToken.active.find_by(token_digest: ...)`. Token + account context cached in Rails.cache for 2 minutes.

### Account Security Levels
`Account#security_level` is an integer enum: `low` (0, default) and `high` (99). All security behavior is driven by `Account::SECURITY_SETTINGS[level]`:
- **Low (B2C)**: 366-day session TTL, 14-day idle timeout, audit logging for writes/failures only
- **High (HIPAA/SOC2)**: 15-min session TTL, 10-min idle timeout, requires 2FA, 100% request audit logging

Security level can only be raised, never lowered (`enforce_security_mode_lock`). Helper methods: `security_level_high?`, `security_level_low?`, `requires_2fa?`, `full_audit_logging?` — all delegate to `security_settings`.

### Credit System
Two-pool: subscription credits (reset each billing cycle) + purchased credits (expire at `credits_purchased_expire_at`). `Account#deduct_credits!(amount)` uses `with_lock` (SQLite `BEGIN EXCLUSIVE TRANSACTION`), drains subscription pool first, then purchased. Raises `InsufficientCreditsError` if insufficient.

### Checklist Snapshots
Reports always reference a **snapshot** checklist (type: `report_snapshot`), never the template directly. `Checklist#create_snapshot` deep-copies rules with new IDs, sets `source_checklist` reference. Snapshot rules track `source_rule_id` pointing back to template.

Rules are encrypted JSON arrays. Each rule: `{id, prompt, order, title, origin}`. Origin is `"checklist"` or `"user"`. Rule IDs follow `{checklist_prefix_id}_rule_{seq}` pattern, auto-assigned by `RulesNormalization` module on save.

### Audit Logging
Two systems: `audited` gem for model-level change tracking + custom `AuditLog` model for request-level HIPAA audit (stored in separate `audit` database). `Api::BaseController#record_audit_log` runs after every qualifying request. Immutable via SQLite triggers.

## Model Relationships

```
Account (acct_)
├── has_many :envelopes
├── has_many :checklists
├── has_many :users (through :account_users)
└── has_one :active_subscription

Envelope (env_) < AccountRecord
├── has_many :document_files
├── has_many :envelope_revisions
├── has_many :reports (through :envelope_revisions)
├── archive!/unarchive! — archive makes envelope read-only
└── user_permissions(user) — returns permission hash

EnvelopeRevision (envrv_) < AccountRecord
├── belongs_to :envelope
├── has_and_belongs_to_many :document_file_revisions
├── has_one :report
└── previous_revision — finds revision_number - 1

DocumentFile (df_) < AccountRecord
└── has_many :document_file_revisions

DocumentFileRevision (dfrev_) < AccountRecord
├── belongs_to :document_file
├── has_one_attached :file (encrypted)
├── to_base64 / attach_from_base64
└── has_and_belongs_to_many :envelope_revisions

Checklist (clst_) < AccountRecord
├── rules — encrypted JSON array of rule hashes
├── checklist_type: template(0) | report_snapshot(1)
├── has_many :snapshots
├── create_snapshot — deep copy with new IDs
└── add_manual_rule(prompt:, title:, ...)

Report (rpt_) < AccountRecord
├── belongs_to :envelope_revision (unique constraint!)
├── belongs_to :checklist (always a snapshot)
├── has_many :checks
├── job_status: pending(0) | processing(1) | completed(2) | failed(3) | cancelled(4) | reset(5)
└── checklist_rules / user_rules — filtered by origin

Check (chk_) < AccountRecord
├── belongs_to :report
├── rule_key — string referencing rule ID in checklist.rules JSON
├── source: ai(0) | user(1)
├── passed (boolean), description (encrypted)
└── page, x1, y1, x2, y2 — highlight coordinates
```

## Controller Patterns

**`Api::BaseController`** — all API controllers inherit from this:
- Token auth (`authenticate_api_token!`), account context (`set_current_context`), 2FA enforcement, audit logging
- Includes: `ApiResponses`, `PrefixIdSerialization`, `Pundit::Authorization`

**Response helpers** (from `ApiResponses`): `render_api_success`, `render_api_created`, `render_api_bad_request`, `render_api_not_found`, `render_api_unauthorized`, `render_api_forbidden`

**Controller concerns**:
- `EnvelopeArchivable` — `ensure_envelope_not_archived!` before action
- `CreditChargeable` — `charge_credits_for :action, amount: N` DSL
- `CreditAdjustable` — `adjust_credits_for_usage(total_cost:)` for page-based billing

**16 API v1 controllers** in `app/controllers/api/v1/`: account, account_invitations, account_members, audit_logs, auth, checklists, checks, document_file_revisions, document_files, envelopes, me, models, orders, reports, subscription_plans, versions.

All revdoku-doc-api calls are proxied through Rails — frontend never calls revdoku-doc-api directly.

## Key Services

- **`ReportCreationService`** — orchestrates report creation: builds revdoku-doc-api request (base64 files, checklist rules, AI model config), calls `RevdokuDocApiClient.client.create_report`, saves result. On re-run: destroys AI checks, preserves user checks.
- **`AiModelResolver`** — resolves model config from `config/ai_models.yml`. Default: `openrouter:google/gemini-3-flash-preview`. `credits_per_page` defaults to 10.
- **`DefaultChecklistLoader`** — creates account's initial checklists on `after_create`.

## Background Jobs

- `CreateReportJob` — async report creation
- `CleanupExpiredTokensJob` — purge old API tokens
- `DataRetentionCleanupJob` — enforce data retention policy
- `ExpirePurchasedCreditsJob` — handle credit expiry
- `ResetMonthlyCreditsJob` — billing cycle credit reset

## Testing

RSpec Rails with FactoryBot, Faker, Shoulda Matchers, database_cleaner. Specs in `spec/models/` and `spec/factories/`. Run: `bundle exec rspec`.

## Important Gotchas

1. **One report per envelope revision** — unique constraint on `envelope_revision_id`. Creating a second report for the same revision will fail.
2. **Checklist `rules` is encrypted JSON** — use `checklist.rules` (returns array of hashes), never access `rules_ciphertext` directly.
3. **`RulesNormalization` auto-assigns rule IDs** — don't manually set rule `id` or `order` fields; they're computed on `rules=`.
4. **EnvelopeRevision unique constraint** — `(envelope_id, revision_number)` must be unique.
5. **ActiveStorage files are encrypted** — use `to_base64` / `attach_from_base64` methods, not raw ActiveStorage download.
6. **SQLite3 has no `FOR UPDATE`** — `with_lock` uses `BEGIN EXCLUSIVE TRANSACTION` instead.
7. **Check references rules by `rule_key` string** — not a polymorphic AR association. The key matches a rule's `id` in the checklist's rules JSON array.
8. **Encryption key shredding** — `Account#shred_encryption_key!` makes all encrypted data permanently inaccessible. Check `encryption_key_shredded?` before operations.
