# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## You are editing the source of truth

This repo (`revdoku-ee`) holds the actual code for **both** editions. The open-source repo at `../revdoku/` is **generated** from this tree by `ee/scripts/build-core.sh` and is effectively read-only — direct edits there are overwritten on the next build. Always edit files under `revdoku-ee/`, then re-run `bash ee/scripts/build-core.sh` to publish into `../revdoku/`. See "Editions — EE vs Core" below for the full mechanism (paired `ee/` + `core/` folders, marker syntax, decision tree, verification).

The `revdoku-ee/core/` overlay tree mirrors the Core filesystem and **wins** over the shared version at the same relative path during the build's rsync step. Files that need to be different in Core (Dockerfile, docker-compose.yml, env.example, README) live there.

## IMPORTANT Rules

- **NEVER run `push-pr.sh`, create pull requests, push code, or merge code unless the user explicitly asks or confirms it for that specific push.** Always wait for explicit user approval before pushing or merging. After completing work, describe what was done and wait — do NOT auto-push. "do push-pr.sh" from the user is explicit approval. Completing a task is NOT approval to push.

## Editions — EE vs Core

This repo (**revdoku-ee**) is the **Enterprise / commercial** tree and the single source of truth for ALL code. The public **Core** edition (open source, AGPL-3.0, repo `revdoku/revdoku`, runs at `../revdoku/`) is **generated from this tree** by `ee/scripts/build-core.sh`. Never edit `../revdoku/` directly — changes would be clobbered on the next build.

### Core principle — no stubs, no edition-aware conditionals

The separation is **purely file-layout driven**. Two paired folders carry the edition-specific code:

- `ee/…` — EE-only source. Pruned entirely by `build-core.sh` when producing Core.
- `core/…` — Core-specific source. Used as-is by Core builds; overrides the shared version in the EE build's publish pipeline at the same relative path.

The **filesystem is the switch**. Shared code never asks "which edition?" There are:

- **no** `if ee?` / `File.directory?("ee")` / runtime edition checks;
- **no** "stub" directories (`ee-stubs/`, `shims/`, etc.) — the word is misleading, since a `core/` file is a real first-class implementation for that edition, not a placeholder;
- **no** edition-aware wiring in shared code.

Shared code imports from a single well-known path (e.g. `@ee/components/Foo`) and the build's alias table resolves that path to either the `ee/` copy (in EE) or the `core/` copy (in Core). When a feature is simply absent in Core, its `core/` file is a tiny module that exports a no-op (e.g. a React component returning `null`, an empty array, a method that returns a sensible default). That's the **Core implementation**, not a "stub".

### What must NOT appear in Core builds

- Commercial / hosted-cloud features (billing & credits, seller integrations, HIPAA mode, BYOK, Cloudflare Turnstile captcha, Kamal deployment, SES mail ingress, Litestream backups, AWS KMS, data-region registry, exception notifier, anything that requires AWS / Cloudflare / Stripe / FastSpring accounts).
- Any file, constant, env var, view fragment, or dependency whose sole reason to exist is the commercial offering.
- Anything labelled `_ee.rb` / `.ee.*` in a filename, or any block between `# @ifdef EE` / `# @endif` markers — those are stripped at build time.

### Mechanisms (prefer in this order)

1. **Paired `ee/` + `core/` folders (default).** When a module has to exist in both editions with different content, write the EE version under `ee/…` and the Core version at the sibling `core/…` path. This is the go-to pattern for anything non-trivial: whole Rails initializers, controllers, helpers, concerns, React components, routes, tabs, hooks.

   - **Rails:** `apps/web/ee/config/initializers/NN_foo.rb` vs `apps/web/core/config/initializers/NN_foo.rb` (Core overlay rsync'd in by `build-core.sh`). `config/application.rb` already appends `ee/config/initializers` and `ee/app/{views,controllers,models,helpers,lib}` to the appropriate load paths when the `ee/` directory exists.
   - **Frontend:** `apps/web/ee/app/frontend/src/components/Foo.tsx` vs `apps/web/app/frontend/src/core/components/Foo.tsx`. Vite (`vite.config.ts`) and TS (`app/frontend/tsconfig.json`) both expose the alias `@ee`, which resolves to `ee/app/frontend/src` when that directory exists on disk, otherwise to `app/frontend/src/core`. Shared files import from `@ee/components/Foo` unconditionally. Already live for `AccountBilling`, `HighSecurityModeCard`, `InboundEmailHint`, `app/account/tabs`, `app/routes`.
   - **The Core file is a real implementation.** If the feature is absent in Core, the `core/` file's body is whatever "absent" means — a React component that returns `null`, an empty array, a method that returns a Core-safe default. Do **not** call these "stubs"; they are the Core implementation of that interface.

2. **Directory-based strip (`ee/` only, no Core counterpart).** For EE-only additions where Core genuinely needs nothing — e.g. a new EE controller concern, an EE-only Rails engine, an EE-specific view partial that's never referenced from shared code — just create the file under `ee/…` with no `core/` sibling. The `build-core.sh` pipeline prunes the directory and nothing else is needed.

3. **Core overlay files at `revdoku-ee/core/…`.** The top-level `revdoku-ee/core/` tree mirrors the published Core filesystem. Every file under it is rsync'd on top of the stripped Core tree at the same relative path and WINS over the shared version. Use this for files that need to be **completely different** in Core (not just missing bits):
   - `core/Dockerfile`, `core/docker-compose.yml` — Core's simpler single-container deployment.
   - `core/env.example` — Core-oriented env template (EE uses `revdoku-ee/.env.example`).
   - `core/README.md`, `core/LICENSE` — AGPL-facing docs.
   - `core/bin/start` — Core preflight wrapper.
   - `core/apps/web/config/initializers/rack_attack_private_networks.rb` — Core-only rate-limit safelist for Docker bridge networks.
   - `core/.github/workflows/docker-publish.yml` — Publishing pipeline that lives only in Core.

4. **Method-override pattern.** When a shared Ruby file needs a value that differs per edition, define a method with the Core value in the shared file and redefine it in an EE-only initializer under `ee/config/initializers/` with a numeric prefix that sorts AFTER the shared one (the EE redefinition wins at load time). Example: `Revdoku.default_login_mode` returns `"password_no_confirmation"` in shared code, overridden to `"otp"` by `ee/config/initializers/01_login_mode_ee.rb`. No conditional, no stub — just two definitions that the load order picks between.

5. **Filename-based strip (`_ee.` / `.ee.` suffix).** Files whose name contains `_ee.` or `.ee.` are pruned by `build-core.sh` even outside `ee/` directories. Useful when relocating to an `ee/` folder would break a colocated convention. Prefer the paired-folder pattern for anything non-trivial.

6. **Inline `# @ifdef EE … # @endif` markers (last resort).** For **genuinely small, tightly-coupled** excisions inside an otherwise-shared file — one gem line in `Gemfile`, one `before_action` + `rescue_from` pair in a shared controller, a short TypeScript type augmentation, a lib method whose signature must live in the shared file. Processors: `ee/scripts/strip-ee-ruby-blocks.mjs` (`.rb`, `.yml`, `.yaml`, `.sh`, `Gemfile`, `Rakefile`, `Procfile*`); TS/TSX via `// @ifdef EE`. **Does NOT process `.erb` views** — for ERB, extract the EE call behind a helper (e.g. `TurnstileHelper#turnstile_widget`) that has a core/ implementation returning `""`.

   **Reach for markers only when folder-split is actively harmful.** If you find yourself writing 5+ lines of JSX inside a marker block, stop and split it into `@ee/…` paired with `core/…`.

   **⚠️ No `else` branch.** The strippers (`ee/scripts/strip-ee-blocks.mjs`, `ee/scripts/strip-ee-ruby-blocks.mjs`) only support `@ifdef EE … @endif`. They have **no `//#else` / `# #else` branch**: anything between the markers is deleted wholesale. Do **not** write:
   ```ts
   // @ifdef EE
   return runWithDebugContext(ctx, run);
   //#else
   return run();        // ← also deleted in Core, leaves the function with no return
   // @endif
   ```
   This bug shipped once already — `apps/services/revdoku-doc-api/src/routes/report/create.ts` had the pattern above; Core's report endpoint silently returned 200 with an empty body, and every review completed with zero checks. Instead, write the Core default unconditionally, then mutate inside the EE block:
   ```ts
   let wrapped: () => Promise<void> = run;
   // @ifdef EE
   wrapped = () => runWithDebugContext(ctx, run);
   // @endif
   return wrapped();
   ```
   When in doubt, run `bash ee/scripts/build-core.sh` and read the stripped file in `tmp/<timestamp>-core-build/` to confirm the Core control flow is intact.

### Adding a new EE-only feature — decision tree

- Whole new file with no Core counterpart? → `ee/…` only (mechanism 2).
- Feature present in both editions but rendered differently (or absent in Core)? → paired `ee/…` + `core/…` folders with an `@ee` import (mechanism 1). **This is the default for UI / React components.**
- Whole file must be **different** (not absent) in Core — e.g. a simpler Dockerfile? → `revdoku-ee/core/…` overlay (mechanism 3).
- Default value differs per edition? → method override in Ruby (mechanism 4).
- One gem, one `before_action`, a 2-line block inside a shared file? → `# @ifdef EE` markers (mechanism 6).

### Verification

After editing, run `./ee/scripts/build-core.sh` and confirm:

- No `ifdef EE` / `@ifdef` markers leak into the output tree (`build-core.sh` greps for these and fails the build if found).
- Core's `Gemfile.lock` regenerates cleanly without EE-only gems.
- No references to stripped constants (e.g. `RailsCloudflareTurnstile`) remain in Core.
- For each `@ee/…` import in shared frontend code, both a `core/…` file (in `app/frontend/src/core/…`) and an `ee/…` file (in `ee/app/frontend/src/…`) exist at the mirrored path.

## Project Overview

Revdoku is a document inspection and auditing system that uses AI to analyze documents against compliance rules. It processes PDFs and images, applies rule-based checks, and generates visual reports with highlighted issues. User can upload revised document and the app can check against rules + rules defined by the user. User can always generate a visual report to share with others. The project is HIPAA compliant and SOC2 ready so it employs best info security practices. Rails uses revdoku-doc-api which is data processing server used internally for processing images, pdf, text with or without AI.

# Included Projects

All apps and services used by the project are located in /apps subfolder.

- /apps/web - contains the main Ruby on Rails app. See /apps/web/CLAUDE.md for the details.
- /apps/services/revdoku-doc-api - contains revdoku-doc-api server that runs on port 4001 and used by the apps/web app internally for converting, reading and processing images, pdf, and making calls to AI. It uses Typescript and Fastify and works as pure API-only statless server. See /apps/services/revdoku-doc-api/CLAUDE.md for the details.
- /apps/shared/js-packages/revdoku-lib - contains typescript/js package defining interfaces and types used in both /apps/web in its frontend (in /apps/web/frontend and other places) and in revdoku-doc-api.

## Common Commands

### Development
```bash
# build all
./build-all.sh

# Start all services (recommended)
bin/dev

# Individual services
cd apps/shared/js-packages/revdoku-lib && npm run build # shared typescript/js package
cd services/revdoku-doc-api && npm run dev   # AI service (port 4001)
cd apps/web && bin/dev             # Rails with Vite (port 3000, Vite on 3036)

# If you have Ruby version issues, use:
cd apps/web && source ~/.rvm/scripts/rvm && rvm use 3.4.5 && bin/dev
```

The `bin/dev` script provides a development environment:
- Starts Rails with `bin/dev` which includes:
  - Rails server on port 3000
  - Vite dev server on port 3036 (via Procfile.dev)
  - Background job workers
- Starts revdoku-doc-api on port 4001
- Access the React frontend at `http://localhost:3000/envelopes`
- Vite provides hot module replacement (HMR) for React components

#### Production-mode verification (`bin/start`, EE-only)
```bash
./bin/start              # rebuild assets only when stale, runs on port 3001
./bin/start --rebuild    # force `npm run build`
```
Boots Rails in `RAILS_ENV=production` against the dev SQLite databases
(`apps/web/storage/development*.sqlite3`). Real CSP, real Cloudflare
Turnstile (defaults to the always-pass test sitekey
`1x00000000000000000000AA`), real asset digests, no Vite dev server, no
mock helpers. The dev data — `admin@gmail.com`, existing envelopes — is
preserved because we point `DATABASE_PATH` etc. at the dev files.

Use this when reproducing a bug that only shows up in production mode
(e.g. a third-party script that the dev mocks bypass, an asset-pipeline
issue, or a CSP nonce/hash mismatch). It is **not** a deployment surface
— actual production goes via Kamal / CI. The Core overlay's
`core/bin/start` (Docker compose wrapper) wins during `build-core.sh`,
so this EE script is naturally edition-scoped.

### Frontend Development (Integrated with Rails)
```bash
cd apps/web
npm install                  # Install frontend dependencies
bin/vite dev                 # Start Vite dev server only
npm run build                # Build for production
```

### Linting
```bash
cd apps/web && npm run lint        # Lint React frontend (if configured)
cd services/revdoku-doc-api && npm run lint  # Lint revdoku-doc-api
```

### Building
```bash
cd apps/web && npm run build       # Build frontend with Vite
cd services/revdoku-doc-api && npm run build # Build revdoku-doc-api
```

### Database Management
Database is now handled entirely by Rails. See Rails documentation for database commands:
```bash
cd apps/web
rails db:create      # Create database
rails db:migrate     # Run migrations
rails db:seed        # Seed database
rails db:reset       # Reset database
```

### Testing main app

The main app is running with `bin/dev` which starts all services.

**Development credentials (NOT for production):**
- Default user: `admin@gmail.com` with password `1234512345`
- Default API token: `devtoken_a1b2c3d4e5f6g7h8i9j0k1l2m3n4`

Note: These credentials are only created in development/test environments. Production users must be created manually via Rails console.

### Testing frontend

The frontend is running with `bin/dev` which starts all services.

**Development credentials (NOT for production):**
- Default user: `admin@gmail.com` with password `1234512345`
- Default API token: `devtoken_a1b2c3d4e5f6g7h8i9j0k1l2m3n4`

Note: These credentials are only created in development/test environments. Production users must be created manually via Rails console.

### Testing internal data processing server (revdoku-doc-api)
```bash
cd services/revdoku-doc-api && npm run test  # Limited tests available
```

### Shared Scripts (Git Submodule)
The `ee/scripts-common/` directory contains reusable automation scripts. Pull latest with:
```bash
./ee/scripts-common/update-submodules.sh --pull
```

#### Push and Merge PRs
```bash
# From project root (must be on main branch)
./ee/scripts-common/push-pr.sh "Your commit message here"
```
Automatically creates branch, commits, pushes, creates PR, and auto-merges.

#### Create Worktree for Parallel Development
```bash
# Create worktree and launch Claude Code for parallel AI development
./ee/scripts-common/worktree.sh "feature description"

# Options
./ee/scripts-common/worktree.sh --no-claude "description"  # Don't launch Claude
./ee/scripts-common/worktree.sh --dir /path/to/repo "description"
```
Creates a git worktree at `../<repo>-<branch>` based on main, useful for running multiple Claude sessions.

#### Spin Up Plan Implementation in Worktree
```bash
# After creating a plan in Claude Code, spin it up in a separate worktree + iTerm tab:
./ee/scripts-common/worktree.sh --plan <plan-file-path> --tab "description"

# Plan files are stored at ~/.claude/plans/<name>.md
# Example:
./ee/scripts-common/worktree.sh --plan ~/.claude/plans/streamed-enchanting-kazoo.md --tab "audit-log-fix"
```

#### Update Git Submodules
```bash
./ee/scripts-common/update-submodules.sh          # Sync to recorded commits
./ee/scripts-common/update-submodules.sh --pull   # Also pull latest for each submodule
```

### Production Deployment
```bash
# Tag and deploy to production (triggers GitHub Actions)
git tag production-v1.0.X  # Use next version number
git push origin production-v1.0.X

# Check existing tags
git tag -l "production-v*"
```

The `production-v*` tag pattern triggers the deploy-full-stack GitHub Actions workflow which:
1. Builds Rails and revdoku-doc-api Docker images
2. Pushes to GitHub Container Registry (ghcr.io)
3. Deploys to AWS EC2 via Kamal
4. Verifies deployment health

**Version numbering**: Follow semantic versioning (production-v{major}.{minor}.{patch})

## Architecture Overview

### Core Concepts
- **Envelopes**: Container for document revisions being inspected, supports multiple files and versioning. Each envelope belongs to an account.
- **Document Revisions**: Version history for documents within an envelope. Each revision can contain multiple source file revisions.
- **Source Files & Source File Revisions**: Files uploaded to an envelope. Each file can have multiple revisions tracking changes over time.
- **Checklists**: Templates containing rules for document inspection. Checklists belong to an account and can have revisions for tracking changes.
- **ChecklistRule**: Individual inspection criteria within a checklist. Belongs to a specific checklist.
- **EnvelopeRule**: Rules created from manually added checks by users. These belong to both an envelope and a specific document revision.
- **Checks**: Individual inspection results with pass/fail status, page coordinates, and failure messages. Uses polymorphic association to reference either ChecklistRule or EnvelopeRule.
- **Reports**: Each document revision has exactly ONE report. Reports reference a checklist and contain all checks from the inspection.

### Model Relationships

The Rails models follow these key relationships:
- **Account** → has_many **Envelopes** and **Checklists**
- **Envelope** → has_many **Document Revisions**, **Source Files**, and **Envelope Rules**
- **Document Revision** → has_one **Report**, has_and_belongs_to_many **Source File Revisions**
- **Source File** → has_many **Source File Revisions**, belongs_to **Envelope**
- **Report** → belongs_to **Document Revision** and **Checklist**, has_many **Checks**
- **Checklist** → has_many **Checklist Rules**, belongs_to **Account**
- **Check** → belongs_to **Report**, belongs_to **Rule** (polymorphic: ChecklistRule or EnvelopeRule)

Important: Each Document Revision can have exactly ONE Report due to unique constraint on envelope_revision_id.

### Service Architecture

#### Monorepo Structure
The project uses npm workspaces pattern with file references for the shared schemas package.

- **Frontend**: React 18 with TypeScript (integrated in `/apps/web/app/frontend`)
  - Integrated into Rails via Vite Ruby plugin
  - Uses shadcn/ui components with Tailwind CSS
  - PDF.js for client-side PDF rendering
  - React hooks for state management
  - Communicates with Rails backend via API
  - Served directly by Rails at `/envelopes` routes
  - Hot Module Replacement (HMR) in development via Vite
- **Backend**: Ruby on Rails (`/apps/web`)
  - Handles authentication, user management, subscriptions
  - Provides API endpoints at `/api/v1/*`
  - Uses SQLite3 (see config/initializers/sqlite_config.rb)
  - Serves React frontend via EnvelopesController and Vite Ruby
  - Generates temporary API tokens for frontend authentication
  - Includes integrated React app in `app/frontend/`
- **AI and data processing API service**: Fastify server for document processing (`/services/revdoku-doc-api`)
  - Separate microservice running on port 4001
  - Called by backend API for heavy document processing tasks
  - Supports multiple AI providers (OpenAI, Anthropic, Google Cloud, OpenRouter)
  - Handles PDF and image processing (puppeteer for server-side rendering)
  - Development-only caching with 7-day TTL
- **Shared Types**: Common schemas package (`/apps/shared/js-packages/revdoku-lib`)
  - TypeScript interfaces and types
  - Utility functions for checklists and rules
  - Color constants and styling utilities
  - Used by Rails frontend, standalone frontend (legacy), and revdoku-doc-api via file references
  - Designed to match Rails model structure for seamless JSON serialization
- **Database**: SQLite3
  - Rails ActiveRecord ORM with multi-database support (primary, cache, queue, cable)
  - Database files stored in `storage/` directory
  - Configuration in `config/database.yml` and `config/initializers/sqlite_config.rb`
  - Performance optimizations: WAL mode, mmap, cache size tuning

### Key Patterns
1. **Soft References**: Uses `prefix_id` ([prefixed_ids gem](https://github.com/excid3/prefixed_ids)) instead of database IDs for public APIs. Use `find_by_prefix_id()` or `Model.find(prefix_id)` to look up records. **NEVER use `where(prefix_id:)` or `find_by(prefix_id:)`** — the DB column is always empty; the value is computed from the record's integer ID.
2. **Reference-Based Architecture**: Reports reference checklists via foreign key; checks use polymorphic association to reference either ChecklistRule or EnvelopeRule
3. **File Storage**: Rails ActiveStorage handles file uploads and storage
   - Files are stored on disk (local storage in development)
   - API provides base64 conversion endpoints for frontend/revdoku-doc-api compatibility
   - Source files managed through envelope endpoints
4. **File Processing**: Converts all inputs to PDF for uniform display, preserves coordinates
5. **Highlight System**: Maps AI-detected issues to page coordinates with color-coded status
6. **Continuous Inspection**: Rules track previous revision checks to ensure no issues are missed across document versions

### API Flow
1. User authentication → Rails Devise → Generate API token for frontend
   - Frontend served via EnvelopesController at `/envelopes/*`
   - Uses Vite Ruby to serve React application
   - Token passed via cookie (production and development)
2. Create envelope → `POST /api/v1/envelopes` → returns envelope with prefix_id
3. Upload files → `POST /api/v1/envelopes/:id/files`
   - Creates DocumentFile and DocumentFileRevision records
   - Files stored via Rails ActiveStorage
4. View source files → `GET /api/v1/envelopes/:id/document_files`
5. Create document revision → `POST /api/v1/envelopes/:id/create_revision`
6. Select checklist → `GET /api/v1/checklists` (fetch available checklists)
7. Generate checklist → `POST /api/v1/checklists/generate` → revdoku-doc-api `/api/v1/checklist/generate`
8. Run inspection → `POST /api/v1/reports` → revdoku-doc-api `/api/v1/report/create`
   - Rails API sends document and checklist to revdoku-doc-api
   - revdoku-doc-api processes document using configured AI provider
   - Returns inspection results with checks and coordinates
9. Export report → `POST /api/v1/reports/:id/export` → revdoku-doc-api `/api/v1/report/export`
10. Manage manual checks:
    - Create: `POST /api/v1/reports/:report_id/checks`
    - Update: `PUT /api/v1/checks/:id`
    - Delete: `DELETE /api/v1/checks/:id`
11. Display results → Frontend renders highlights with coordinates on PDF viewer

IMPORTANT: All revdoku-doc-api calls are proxied through Rails - the frontend never calls revdoku-doc-api directly.

### State Management
- React hooks for local state
- Custom domain hooks (e.g., `useChecklistManager`)
- Custom domain hooks (e.g., `useChecklistManager`)

### Important Files

#### Rails Models
- `/apps/web/app/models/envelope.rb` - Envelope model with document management
- `/apps/web/app/models/envelope_revision.rb` - Document revision tracking
- `/apps/web/app/models/document_file.rb` & `document_file_revision.rb` - File version management
- `/apps/web/app/models/report.rb` - Inspection report model
- `/apps/web/app/models/checklist.rb` & `checklist_rule.rb` - Checklist templates
- `/apps/web/app/models/envelope_rule.rb` - Manual check rules
- `/apps/web/app/models/check.rb` - Polymorphic check results

#### Rails Controllers
- `/apps/web/app/controllers/api/v1/envelopes_controller.rb` - Envelope and file management endpoints
- `/apps/web/app/controllers/api/v1/checklists_controller.rb` - Checklist API (includes generate)
- `/apps/web/app/controllers/api/v1/reports_controller.rb` - Report creation and export (proxies to revdoku-doc-api)
- `/apps/web/app/controllers/api/v1/checks_controller.rb` - Manual check management
- `/apps/web/app/controllers/api/v1/document_files_controller.rb` - Source file operations
- `/apps/web/app/controllers/frontend_controller.rb` - Frontend serving and API token generation
- `/apps/web/app/controllers/envelopes_controller.rb` - Frontend route handling

#### Frontend Components (Rails Integrated)
- `/apps/web/app/frontend/src/config/api.ts` - Frontend API configuration
- `/apps/web/app/frontend/src/lib/api-client.ts` - API client (all revdoku-doc-api calls go through Rails)
- `/apps/web/app/frontend/src/components/envelope-page/EnvelopePage.tsx` - Main inspection UI component
- `/apps/web/app/frontend/src/app/envelopes/view/page.tsx` - Envelope viewing page
- `/apps/web/app/frontend/src/components/DragDropFileArea.tsx` - File upload component
- `/apps/web/app/frontend/entrypoints/application.js` - Vite entry point wrapper
- `/apps/web/app/frontend/entrypoints/application.tsx` - React application entry

#### Legacy Frontend Components (Standalone - Deprecated)
- `/apps/frontend/` - Original Next.js standalone frontend (being phased out)

#### The revdoku-doc-api Routes
- `/apps/services/revdoku-doc-api/src/routes/report/create.ts` - AI inspection processing
- `/apps/services/revdoku-doc-api/src/routes/report/export.ts` - Report export generation
- `/apps/services/revdoku-doc-api/src/routes/checklist/generate.ts` - AI checklist generation
- `/apps/services/revdoku-doc-api/src/lib/checklist-utils.ts` - Checklist utilities

#### Shared Schemas
- `/apps/shared/js-packages/revdoku-lib/src/common.ts` - Core TypeScript interfaces
- `/apps/shared/js-packages/revdoku-lib/src/index.ts` - Main export file

## Known Issues and Naming Mismatches

### Naming Inconsistencies
1. **Missing TypeScript fields**:
   - Rails `Checklist` model may have fields not present in the TypeScript interface
   - Verify field alignment between Rails models and TypeScript interfaces for API compatibility

### Database Considerations
- Rails models use `has_prefix_id` from the [`prefixed_ids`](https://github.com/excid3/prefixed_ids) gem. The `prefix_id` DB column exists but is always **empty** — the value is computed from the record's integer `id`. Use `find_by_prefix_id()` or `Model.find(prefix_id)`, never `where(prefix_id:)` or `find_by(prefix_id:)`. For batch lookups, decode first: `Model.decode_prefix_id(pid)` returns the integer ID.

## Logs

- **Rails app log**: `apps/web/log/development.log` — all HTTP requests, SQL queries, job output, unhandled exceptions
- **Rails console output**: visible in the `bin/dev` terminal prefixed with `web |`
- **revdoku-doc-api log**: visible in the `bin/dev` terminal prefixed with `revdoku-doc-api |` — Fastify request/response, AI call timings, errors
- **revdoku-doc-api AI session logs**: `apps/services/revdoku-doc-api/ai-sessions/` — when `REVDOKU_DOC_API_DEBUG_AI=true` is set in `.env.local`, revdoku-doc-api dumps the full request/response JSON for every AI call into timestamped subfolders here. Each subfolder contains `revdoku-doc-api-request.json`, model responses, and debug artifacts. Useful for diagnosing prompt issues, token usage, and AI output quality.
- **Solid Queue (background jobs)**: job failures appear in `apps/web/log/development.log` and in the `bin/dev` terminal. For detailed queue state: `rails runner 'pp SolidQueue::Job.where(finished_at: nil).count'`

## Development Tips

1. **Environment Setup**: Copy `.env.example` to `.env.local` and configure as needed
2. **Port Conflicts**: The `bin/dev` script kills processes on ports 3000, 3036 (Vite), and 4001
3. **Schema Changes**: Build shared schemas with `cd apps/shared/js-packages/revdoku-lib && npm run build`
4. **Logging**: Enable detailed logging with `ENABLE_LOGGING=true` and `LOG_LEVEL=debug`
6. **AI Provider Configuration** (Rails `ai_models.yml` is single source of truth).
   ENV var name = `<PROVIDER_KEY_UPCASE>_API_KEY` (matches the catalog row):
   - Set `OPENAI_API_KEY` for OpenAI models
   - Set `ANTHROPIC_API_KEY` for Claude models (direct)
   - Set `AWS_BEDROCK_API_KEY` for Bedrock (via Mantle)
   - Set `OPENROUTER_API_KEY` for OpenRouter models (Gemini, Claude via OpenRouter)
   - Set `GOOGLE_CLOUD_API_KEY` for Google Cloud Gemini (HIPAA)
   - Default model: `openrouter:google/gemini-3-flash-preview` (configured in `ai_models.yml`)

## Frontend Integration with Vite Ruby
The React frontend is now integrated directly into Rails using Vite Ruby:
- **Vite Config**: `apps/web/vite.config.ts` configures the build
- **Development**: Vite dev server runs on port 3036 with HMR
- **Entry Points**: Located in `apps/web/app/frontend/entrypoints/`
- **Components**: React components in `apps/web/app/frontend/src/`
- **Authentication**: Handled via temporary API tokens from Rails
- **Access**: Frontend available at `http://localhost:3000/envelopes`
- **Production Build**: `cd apps/web && npm run build`

# Report and checklist workflow

0. User creates new envelope
1. User uploads one or more files → creates DocumentFile and DocumentFileRevision records
2. User creates first document revision using the uploaded files
3. User selects a checklist
4. User runs an inspection → creates a Report for the document revision
5. Inspection results are displayed on the document in viewer
6. User can view the inspection results with AI-generated checks
7. User can export the inspection results as PDF or HTML
8. User can add manual checks → creates EnvelopeRule records from manual checks
9. User runs inspection again (on the same document revision):
   - System preserves manual checks
   - Re-runs AI inspection for checklist rules
   - Updates the existing report with new results
10. User creates new document revision and uploads updated files:
    - Creates new EnvelopeRevision record
    - Links new DocumentFileRevision records to the document revision
11. User runs inspection on the new revision. The system:
    - Creates a new Report for the new document revision
    - Includes checklist rules in the inspection
    - Includes EnvelopeRules (from previous manual checks) in the inspection
    - AI checks both checklist rules and envelope rules
    - May use context from previous revision's failed checks
12. The new report contains:
    - Checks from the original checklist rules (polymorphic reference to ChecklistRule)
    - Checks from envelope rules (polymorphic reference to EnvelopeRule)
    - All checks stored in the same checks table with polymorphic association
13. User adds more manual checks → creates more EnvelopeRule records
14. User uploads 3rd revision:
    - Creates new EnvelopeRevision
    - NOTE: Previous revisions cannot be edited, but user can rollback
15. App checks all rules from the checklist and all envelope rules in new inspection

This way we achieve continuous inspection of the files and their further revisions. Our goal is not to miss any checks.

## Additional Project Components

### Tools Directory (`/tools`)
- **MCP Browser Tools** (`/tools/mcp/browser-tools/`): Model Context Protocol browser automation tools for testing and development

### Documentation (`/docs`)
- **[Highlight Coordinate Pipeline](/docs/HIGHLIGHT_COORDINATE_PIPELINE.md)** — end-to-end flow of check coordinates from AI output through revdoku-doc-api reverse mapping, Rails persistence, to frontend screen rendering. Covers margin cropping, `page_coordinate_spaces`, and why uniform scaling is required.
- Research documents on Rails and Next.js integration strategies
- Product Requirements Document (PRD) for the Revdoku system
- Architecture decision records

## API Flow Architecture

### Report Creation Flow
1. **Frontend**: `POST /api/v1/reports`
   - Sends: `envelope_revision_id`, `checklist_id`, `previous_report_id` (optional), `ai_mode` (optional)
   - Handled by: `Api::V1::ReportsController#create`
2. **Rails**: Builds revdoku-doc-api request with full document data
   - Fetches document revision, file revisions, and checklist from database
   - Includes previous report data if specified
3. **Rails → revdoku-doc-api**: `POST http://localhost:4001/report/create`
   - Sends complete document structure with file data as base64
4. **Rails**: Saves report and checks to database
   - Creates Report record with all metadata
   - Creates Check records for each inspection result
5. **Rails → Frontend**: Returns report JSON with all checks

### Report Export Flow
1. **Frontend**: `POST /api/v1/reports/:id/export`
   - Sends: `format` (pdf or json)
   - Handled by: `Api::V1::ReportsController#export`
2. **Rails**: Fetches report data with all checks
3. **Rails → revdoku-doc-api**: `POST http://localhost:4001/api/v1/report/export`
   - Sends complete report structure
4. **Rails → Frontend**: Returns exported file as binary data

### Checklist Generation Flow
1. **Frontend**: `POST /api/v1/checklists/generate`
   - Sends: `source_text`
   - Handled by: `Api::V1::ChecklistsController#generate`
2. **Rails → revdoku-doc-api**: `POST http://localhost:4001/api/v1/checklist/generate`
   - Sends source text for AI processing
3. **Rails**: Saves generated checklist
   - Creates Checklist record
   - Creates Rule records for each generated rule
4. **Rails → Frontend**: Returns checklist JSON with rules

### Manual Check Management
1. **Create Check**: `POST /api/v1/reports/:report_id/checks`
   - Creates manual check for a report
2. **Update Check**: `PUT /api/v1/checks/:id`
   - Updates existing check
3. **Delete Check**: `DELETE /api/v1/checks/:id`
   - Removes manual check

### Authentication Flow
1. User logs in via Rails Devise
2. Rails generates temporary API token (24-hour expiry in dev, 15 min in prod) via ApiToken model
3. EnvelopesController serves the React app via Vite:
   - Handles routes matching `/envelopes/*`
   - Generates temporary API token for authenticated users
   - Sets token in cookie (`revdoku_api_token`)
4. Frontend receives token from cookie
5. All API requests include `Authorization: Bearer <token>` header
6. Token validation happens in Rails API controllers via `authenticate_user_from_token!`

### Google OAuth Configuration
- **Provider**: `google_oauth2` via `omniauth-google-oauth2` gem
- **Production callback URI** (for Google Cloud Console): `https://app.revdoku.com/users/auth/google_oauth2/callback`
- **Dev callback URI**: `http://localhost:3000/users/auth/google_oauth2/callback`
- **Env vars**: `REVDOKU_GOOGLE_AUTH_ENABLED` (GitHub **variable**, not secret), `GOOGLE_CLIENT_ID` (secret), `GOOGLE_CLIENT_SECRET` (secret)
- **Feature flag**: `Revdoku.google_auth_enabled?` in `config/initializers/00_revdoku.rb`
- **Config**: `config/initializers/devise.rb` (scope: email, profile; prompt: select_account)
- **HIPAA note**: High-security accounts require additional email OTP after OAuth

### Frontend Serving Architecture
- **EnvelopesController** (`/apps/web/app/controllers/envelopes_controller.rb`):
  - Serves React app via Vite Ruby helpers
  - Handles authentication token generation
  - Routes: `/envelopes`, `/envelopes/*`
  - Provides manifest endpoint at `/envelopes/manifest`
- **Vite Integration**:
  - Development: Vite dev server on port 3036 with HMR
  - Production: Built assets served by Rails
  - Layout: `app/views/layouts/envelope.html.erb`
  - Entry point: `app/frontend/entrypoints/application.js`

### Checklist Merging Utilities

The system uses several utilities to merge checklists with previous revision checks:

- `mergeChecklistWithChecks()`: Merges a checklist with checks from a previous revision, adding `previousChecks` to rules
- `mergeRulePromptWithPreviousChecks()`: Enhances rule prompts with context about previously failed/passed locations
- Template system adds context like:
  - "Previously failed at: [locations]" for failed checks
  - "Previously passed at: [locations]" for passed checks with new failures
  - This helps AI understand the history and focus on problematic areas

