# Triviality CRM

AI-assisted North American lead research and sales CRM for Triviality.

## Module One: CRM foundation with EOS-1.0 data structure

Module One turns the original interface mockup into a working, database-backed CRM:

- PostgreSQL/Prisma data model for companies, multiple contacts, editable Lead Types, Pipeline Stages, competitors, users, roles and permissions
- Custom, DB-backed session authentication (no public registration; Administrators create accounts) with account lockout, forced password change for admin-created users, and full server-side authorization on every page and action
- Table-driven roles and permissions, editable from Settings
- Company CRUD with search, sort, filter, pagination, archive/restore, and admin-only permanent delete
- Duplicate-matching service (name, address, website domain, phone, email) that blocks silent duplicates and lets an Administrator override with confirmation
- Sales activity timeline, with an automatic "Pipeline Change" activity whenever a company's stage changes
- Follow-up tasks with Due Today / Upcoming / Overdue / Completed / No-Follow-Up views, and a combined complete-and-create-next flow
- EOS-1.0 database structure: per-company summary fields, category-scored historical score records (append-only), and evidence records — manual entry only; no AI scoring engine yet
- Database-driven dashboard totals

Not in Module One (by design): live AI research, AI score generation, web search, spreadsheet import, email integration, production hosting.

## Module Two: AI-assisted lead discovery, review, and CRM transfer

Module Two adds the AI-assisted research workflow on top of Module One's foundation (the underlying database tables for prompts, searches, and results already existed from Module One's schema — Module Two is almost entirely the application layer):

- Reusable, AI-assisted research prompts (save, edit, duplicate, archive) — independent of any one search's location or Lead Type
- Structured search setup (country, state/province, optional cities, one Lead Type, editable minimum quality score) with four research modes: general, "offers events but not trivia," "currently offers trivia," and competitor research — the trivia-gap and trivia-confirmed modes are mutually exclusive by construction (`src/lib/research/exclusivity.ts`)
- Evidence-based results: every candidate stores address/contact fields, trivia status (confirmed/absent/uncertain — uncertain is never silently promoted to confirmed), evidence notes with source citations, quality score and explanation, and which search/prompt produced it
- Ranked, filterable, paginated review with select-all-on-page and bulk selection, an evidence drawer, and reject/restore actions
- Rejection memory: a location rejected in one search is auto-flagged if it resurfaces in a later search, while staying visible and restorable by an authorized user (`restore_rejected` permission) — never confused with archived CRM companies
- Edit-before-transfer with duplicate-blocking reuse of Module One's duplicate-matching service, transactional bulk transfer into the CRM `Company`/`Contact` models, and an automatic `LEAD_TRANSFERRED` activity
- CSV/Excel spreadsheet import with a user-defined column-mapping screen, saved mapping templates, and a validated preview before commit — uploaded files and parsed rows are held only in memory for the length of the upload session and are never written to disk, Postgres, or Git
- CSV/Excel export of research results and CRM companies, respecting the caller's permissions and active filters
- A replaceable AI/research provider layer (`src/lib/research/providers/`) with a full mock/demo provider used by every automated test, and an Anthropic Claude implementation as the live default — see `MODULE_2_REPORT.md` for the provider comparison (costs, legal/ToS considerations, and why Google Places and Yelp Fusion were not used by default)
- A single-process background job runner for long-running searches (`after()` + status polling), appropriate for the current self-hosted single-instance deployment — see `MODULE_2_REPORT.md` for the scaling limitation this implies

Not in Module Two (by design): a second real AI provider (OpenAI is documented but not built), multi-instance/horizontally-scaled job processing, structured-data providers like Google Places or Yelp Fusion.

## Module Three: production hardening and Railway deployment

Module Three replaces every single-process/in-memory assumption from Modules One and Two with something that survives a restart or a redeploy, adds production security controls, and packages the app for Railway — see `MODULE_3_REPORT.md` for the full report, a step-by-step Railway deployment checklist, and an incident/recovery runbook.

- **Durable background jobs**: the AI research runner moved out of the web process entirely, into a separate `worker` service (`worker/index.ts`) consuming a Postgres-backed job queue ([pg-boss](https://github.com/timgit/pg-boss) — no Redis). Jobs are checkpointed per-candidate (`SearchCandidate`) so a crash mid-search resumes safely with no duplicate results, and pg-boss provides bounded exponential-backoff retries, per-job timeouts, and duplicate-job prevention.
- **Durable spreadsheet imports**: the in-memory upload preview store was replaced with a database-backed `ImportBatch` table with a configurable expiry (`IMPORT_BATCH_TTL_HOURS`, default 4h) and automatic cleanup, plus magic-byte file validation and formula-injection protection on both import (flagged) and export (neutralized).
- **Security**: production security headers (CSP, HSTS, etc.), a documented trusted-proxy IP design for rate limiting (Railway-specific — see the report), Postgres-backed rate limiting that survives restarts, a fix for a bug where a user with `mustChangePassword` set could bypass the forced password change via a direct action call, and AI provider cost tracking with an optional daily/monthly budget cap.
- **Deployment**: a `Dockerfile` with `web` and `worker` targets, both built and run end-to-end against a real database during this module (not just theoretically — see the report for several real bugs this caught, including a proxy misconfiguration that would have broken Railway's health check and an `npm`/`npx`-as-PID-1 issue that silently broke graceful shutdown).

Not in Module Three (by design, or not yet done): actually creating any Railway resources, changing DNS, or making a live Anthropic API call — all documented as manual next steps in `MODULE_3_REPORT.md`. A nonce-based CSP (stronger than the current static one) and horizontally-scaling the web service to multiple instances are both possible follow-ups, not required for this module's scope.

## Installation

1. Install [Node.js 20+](https://nodejs.org/), [Docker](https://www.docker.com/) (for local Postgres), and Git.
2. Run `npm install`.
3. Copy `.env.example` to `.env`. The default values match `docker-compose.yml`'s local dev database — only change them if you're pointing at a different Postgres instance. Leave `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` blank for now.
4. Start local Postgres: `docker compose up -d postgres-dev`.
5. Run `npx prisma generate`.
6. Run `npx prisma migrate dev`.
7. Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in your `.env` to create your own bootstrap Administrator account (choose your own password — nothing here generates one for you).
8. Run `npx prisma db seed`. This creates Pipeline Stages, Rejection Reasons, Roles, Permissions, the default Role→Permission grants, and your bootstrap Administrator. It's safe to re-run — it skips anything that already exists.
9. Run `npm run dev` for local use, or `npm run build && npm start` for production.
10. In a second terminal, run `npm run worker` to start the background job processor (Module Three) — AI research searches and scheduled cleanup only run if this is running. Not required just to browse the CRM.
11. Sign in with the email/password you set in step 7. No Lead Types or Competitors are seeded — create them from Settings once you're in.

## Running tests

Tests run against a **separate** database from your dev data — never your `DATABASE_URL`.

1. Start the test database: `docker compose up -d postgres-test`.
2. Copy `.env.test`'s `TEST_DATABASE_URL` value (see `.env.example` for the default matching `docker-compose.yml`) into a local `.env.test` file if you haven't already.
3. Apply migrations to it: `DATABASE_URL="<value of TEST_DATABASE_URL>" npx prisma migrate deploy`.
4. Run `npm test`.

A safety guard (`tests/setup/test-db-guard.ts`) refuses to run any destructive test setup unless the resolved database is unambiguously named as a test database and is separate from your dev `DATABASE_URL` — misconfiguring this fails loudly instead of touching the wrong data.

## Core data rules

- A company has one Lead Type, one Pipeline Stage, one assigned salesperson, and zero or one competitor.
- Competitor location counts are calculated live from linked companies — never stored.
- Contacts are separate records, allowing multiple contacts per company.
- Deleting a company archives it by default, preserving its contacts, activities, follow-ups, and scoring history. Only an Administrator can permanently delete an already-archived company.
- Duplicate candidates are blocked before creation or edit; only an Administrator can override, with explicit confirmation.
- EOS-1.0 historical score records are append-only — a new score never overwrites a prior one. `Company.currentHistoricalScoreId` is the single source of truth for which record is "current."
- Existing customers and do-not-contact companies are excluded from active-prospect ranking queries.

## Permissions

All roles and permission grants are stored in the database (`Role`, `Permission`, `RolePermission`) and editable from Settings → Roles & Permissions — nothing is hardcoded. The seeded defaults:

- **Administrator** — every permission.
- **Manager** — view/add/edit/reassign leads within their own team.
- **Salesperson** — view/add/edit leads assigned to them.

Module Two adds `run_research`, `review_research_results`, `transfer_leads`, and `view_evidence`, alongside Module One's already-seeded `manage_prompts`, `import_leads`, `export_leads`, and `restore_rejected`. Only Administrator is granted these by default — assign them to Manager/Salesperson from Settings → Roles & Permissions as needed.

## AI research provider

Set `AI_PROVIDER` in `.env`:

- `"mock"` (default) — no network calls, no cost, deterministic fixture data. Used for local dev without API keys and unconditionally by every automated test (`.env.test` forces this regardless of `.env`).
- `"anthropic"` — live AI-assisted research using Claude with its server-side web search/fetch tools. Requires `AI_API_KEY`. See `MODULE_2_REPORT.md` for cost and legal considerations, and for why this was chosen over Google Places API and Yelp Fusion for v1.

Email delivery is **not implemented** and must be connected in a future module. Keep any provider credentials only in environment variables; never commit them.
