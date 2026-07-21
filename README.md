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

## Module Four: Sales Workspace

Module Four turns the CRM into a daily-use sales workspace on top of Modules One–Three — see `MODULE_4_REPORT.md` for the full report, schema changes, and permission matrix.

- **Pipeline board**: a drag-and-drop board (`/pipeline`) with one column per active Pipeline Stage (order and names fully admin-editable, never hardcoded), an accessible non-drag `<select>` alternative on every card, and an automatic Pipeline Change activity on every move — the same reused, permission-checked code path for drag, dropdown, and bulk stage changes alike.
- **Named work views**: My Leads, Team Leads, Unassigned Leads, Today's/Overdue/Upcoming Follow-ups, Recently Added, No Recent Activity, Won, Lost, and Archived — all tabs on `/pipeline`, all reusing the existing company-scope visibility rules (no parallel authorization system).
- **Lead assignment**: single and bulk assign/reassign/unassign, with every change recorded as an `ASSIGNMENT_CHANGE` activity (who, when, from, to) and the same team-boundary check reassignment already enforced.
- **Territories**: table-driven country/state-province/city territories (`Settings → Territories`) with an optional owning salesperson. A company's territory is computed from its location at read time, not stored — see `MODULE_4_REPORT.md` for the overlap-resolution rule (most-specific-match-wins).
- **Saved views**: reusable, named filter sets — private by default, shared with permission — validated against a strict schema on every save and load (never raw query text).
- **Bulk actions**: assign, change stage, set territory, create a follow-up, add a note, archive, restore, and export, each transactional and reporting per-row success/failure.
- **Quick sales actions**: a shortcut bar on the company detail page and on every pipeline card for logging a note/call/email/demo/trial or follow-up — reuses the existing Activity/Task models, no parallel note system.
- **Salesperson Home Page**: the Dashboard now leads with a deterministic "What should I do next?" priority list (overdue → due today → active trials → newly assigned → stale → upcoming) and personal pipeline counts.
- **Manager Workspace** (`/manager`, permission-gated): team workload, unassigned leads, overdue-by-salesperson, pipeline-stage counts, recently won/lost, and territory coverage.

Not in Module Four (by design): mapping/route-planning services, real email or calendar integration (activity is recorded only), and advanced conversion/analytics reporting — that's Module Five.

## Module Five: Reporting and Analytics

Module Five turns the CRM's data into management reporting — see `MODULE_5_REPORT.md` for the full report and `REPORT_DEFINITIONS.md` for every metric's numerator/denominator/date-field/permission-scope, and known limitations.

- **A new `/reports` section** (permission-gated) with a dashboard plus dedicated Pipeline, Salespeople, Lead Sources, AI Research, Competitors, Territories, Lead Types, and Trends reports — all built on real Postgres aggregation, never estimated or invented numbers.
- **`PipelineStageHistory`**: a new append-only table (populated going forward only, no backfill — see `REPORT_DEFINITIONS.md`'s Global Rules for why) makes time-in-stage, stalled-lead detection, stage-to-stage conversion, and win/loss-by-dimension reporting possible without ever parsing the old free-text activity log.
- **Lead source attribution**: a new `Company.source` field (Manual/AI Research/Import), set once at creation by each of the three existing creation paths — pre-Module-Five companies stay `null` ("unknown"), never guessed.
- **Report scope is a separate permission tier from lead-edit visibility** (`view_own_reports`/`view_team_reports`/`view_all_reports`) — a user's report access is independent of what leads they can edit.
- **Full filtering**: date range (Today/Week/Month/Quarter/Year/Custom, resolved against a documented `BUSINESS_TIMEZONE`), territory, lead type, pipeline stage, salesperson, source, competitor, score range, trivia status, active/archived, and won/lost — validated server-side and carried through to exports.
- **CSV/Excel export** of every report, reusing the existing formula-injection-safe export utility, with the report name, date range, active filters, and generation timestamp always included.
- **Small-sample honesty**: any rate (win rate, conversion rate) is suppressed in favor of "not enough data" below a documented minimum sample size, and the underlying count is always shown — never a bare, misleading percentage.
- **Scheduled reports** (`/reports/scheduled`, permission-gated): daily/weekly/monthly report generation on the durable worker (Module Three) — an hourly pg-boss tick finds due schedules, generates the report as its creator would see it, and freezes the result so a later download always reproduces exactly what was generated. No email yet (that needs a future communications module) — recipients see a new run via an in-app notification bell.

Not in Module Five (by design): query-performance testing at large data volumes (hundreds-of-thousands of rows) beyond what's exercised by the automated test suite, and in-place editing of a scheduled report's cadence/recipients (delete and recreate covers it for now).

## Module Six: Communications and Follow-up Automation (Phases A–C)

Module Six lets the sales team email leads from inside the CRM using their own connected mailbox — see `MODULE_6_REPORT.md` for the full phased plan, provider comparison, permission matrix, and what's still ahead in Phases D–E. **Phases A, B, and C** (connections, templates, composer, consent/compliance, scheduled sends, follow-up sequences) are built — calendar/appointments, inbound sync, and delivery-status webhooks are designed but not yet built.

- **Connect your own mailbox** (`/settings/email-connections`, `connect_mailbox`): OAuth 2.0 to Microsoft Graph or Google (Gmail), one connection per user. Access/refresh tokens are encrypted at rest (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) and never exposed to the browser — only connection status (connected/expired/error, account email) renders in the UI. A replaceable `EmailProvider` interface (`src/lib/comms/providers/`) mirrors the AI research provider pattern; `MockEmailProvider` is the only provider active under `NODE_ENV=test` and sends no real email during tests.
- **Email templates** (`/settings/email-templates`, `manage_personal_templates`/`manage_shared_templates`): personal (owner-only) or shared (team-wide) templates with `{{contact.firstName}}`-style placeholders, including a mandatory `{{unsubscribeLink}}` placeholder a template cannot be saved without. A template or send referencing an unresolved or unknown placeholder is blocked rather than delivered with a literal `{{token}}`.
- **Composer**: a Send Email panel on the company detail page — pick a contact (required — every send is tied to a tracked contact so consent can be checked; there's no free-text "To" field) and, optionally, a template, edit, and send now or schedule for later (`schedule_email`). Recorded as a structured `EmailMessage` row plus the existing free-text `EMAIL` activity; a failed send creates an in-app `Notification` (the codebase's first general-purpose notification model, separate from Module Five's report-specific bell for now) rather than failing silently.
- **Consent and compliance** (`/settings/communication-compliance`, `manage_communication_compliance`; also reachable from a contact on its company page): CASL-safe default-deny — `Contact.emailPermitted` starts `false` and every send is blocked until a `ConsentRecord` (append-only, mirroring Module One's `HistoricalScoreRecord` pattern) establishes permission for that contact. A linked contact is mandatory for every send (no free-text "To" field, no untracked-address path) — `sendEmail()` checks `Company.doNotContact` *and* `Contact.emailPermitted`/`doNotContact` plus a mandatory, working unsubscribe link, enforced once, inside `prepareSend()`/`sendEmail()` itself (re-run fresh every time a send actually happens, whether immediate, scheduled, or a sequence step), not left to each caller. The public, no-login `/unsubscribe` page records a `WITHDRAWN` consent record and flips `Contact.doNotContact` on click (idempotent). This is a compliance-support system, not legal advice.
- **Scheduled sends**: an optional "Send at" field in the composer stores the email unresolved with `status: SCHEDULED`; a worker tick (every 5 minutes) re-validates consent fresh and sends it once due, failing clearly (with a notification) rather than silently if consent was withdrawn in the meantime. Cancellable any time before it fires by whoever scheduled it.
- **Follow-up sequences** (`/settings/sequences`, `manage_sequences` to design, `enroll_in_sequences` to enroll): table-driven, explicitly-enrolled multi-step campaigns — `WAIT` (days), `EMAIL` (shared templates only), and task-reminder steps that create real `Task` rows. Every step is shown before enrollment confirms; the durable `sequence-tick` worker re-checks opt-out/pipeline-stage stop conditions before running each step, never after; duplicate-send prevention via `SequenceStepRun`'s unique constraint. Pause/resume/cancel from the company detail page.

Not yet in Module Six (Phases D–E, see `MODULE_6_REPORT.md`): calendar/appointment sync, inbound email matching (including reply-triggered sequence stopping), delivery-status webhooks, and a bulk-send UI.

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

- A company has one Lead Type, one Pipeline Stage, zero or one assigned salesperson (Module Four: a company may be unassigned), and zero or one competitor.
- A Pipeline Stage may optionally be flagged Won or Lost (`outcomeType`) — this is how "Won"/"Lost" views and reports identify outcome stages without ever hardcoding a stage name.
- A company's territory is computed from its location (country/state-province/city) against the table-driven `Territory` list, not stored — see `MODULE_4_REPORT.md`.
- Competitor location counts are calculated live from linked companies — never stored.
- Contacts are separate records, allowing multiple contacts per company.
- Deleting a company archives it by default, preserving its contacts, activities, follow-ups, and scoring history. Only an Administrator can permanently delete an already-archived company.
- Duplicate candidates are blocked before creation or edit; only an Administrator can override, with explicit confirmation.
- EOS-1.0 historical score records are append-only — a new score never overwrites a prior one. `Company.currentHistoricalScoreId` is the single source of truth for which record is "current."
- Existing customers and do-not-contact companies are excluded from active-prospect ranking queries.
- `PipelineStageHistory` is append-only and populated going forward only (from Module Five's ship date) — there is no backfill for stage changes that happened before then; see `REPORT_DEFINITIONS.md`.
- `Company.source` (Manual/AI Research/Import) is set once at creation and never changed afterward; pre-Module-Five companies are `null`, never guessed.

## Permissions

All roles and permission grants are stored in the database (`Role`, `Permission`, `RolePermission`) and editable from Settings → Roles & Permissions — nothing is hardcoded. The seeded defaults:

- **Administrator** — every permission.
- **Manager** — view/add/edit/reassign leads within their own team.
- **Salesperson** — view/add/edit leads assigned to them.

Module Two adds `run_research`, `review_research_results`, `transfer_leads`, and `view_evidence`, alongside Module One's already-seeded `manage_prompts`, `import_leads`, `export_leads`, and `restore_rejected`. Only Administrator is granted these by default — assign them to Manager/Salesperson from Settings → Roles & Permissions as needed.

Module Four adds `bulk_update_leads`, `manage_territories`, `create_shared_views`, and `view_manager_workspace`. Administrator gets all four; Manager gets `bulk_update_leads`, `create_shared_views`, and `view_manager_workspace` by default (not `manage_territories`, matching the existing pattern where other `manage_*` lookup-table permissions are Administrator-only by default); Salesperson gets none of the four (private saved views and personal pipeline access need no new grant). Assigning/reassigning a lead — including a previously-unassigned one — continues to use the existing `reassign_leads` permission; no separate `assign_leads` key was added.

Module Five adds `view_own_reports`, `view_team_reports`, `view_all_reports`, `export_reports`, `manage_scheduled_reports`, `view_ai_costs`, and `view_competitor_reports` — a permission tier independent of lead-edit visibility (see `MODULE_5_REPORT.md`). Administrator gets all seven; Manager gets `view_own_reports`, `view_team_reports`, `export_reports`, and `view_competitor_reports`; Salesperson gets `view_own_reports` only. `manage_scheduled_reports` gates the `/reports/scheduled` CRUD UI.

Module Six adds `connect_mailbox`, `send_email`, `schedule_email`, `manage_personal_templates`, `manage_shared_templates`, `manage_sequences`, `enroll_in_sequences`, `view_team_communications`, `manage_calendar_connections`, `manage_communication_compliance`, and `send_bulk_email` — see `MODULE_6_REPORT.md` for the full matrix. Administrator gets all eleven; Manager and Salesperson each get the self-service ones (`connect_mailbox`, `send_email`, `schedule_email`, `manage_personal_templates`, `enroll_in_sequences`, `manage_calendar_connections`), plus `view_team_communications` for Manager only. The admin-shaped ones (`manage_shared_templates`, `manage_sequences`, `manage_communication_compliance`, `send_bulk_email`) default to Administrator only.

## AI research provider

Set `AI_PROVIDER` in `.env`:

- `"mock"` (default) — no network calls, no cost, deterministic fixture data. Used for local dev without API keys and unconditionally by every automated test (`.env.test` forces this regardless of `.env`).
- `"anthropic"` — live AI-assisted research using Claude with its server-side web search/fetch tools. Requires `AI_API_KEY`. See `MODULE_2_REPORT.md` for cost and legal considerations, and for why this was chosen over Google Places API and Yelp Fusion for v1.

## Email provider (Module Six)

Each user connects their own mailbox from `/settings/email-connections` (OAuth) — there is no global email-provider env var, since a user connects to whichever of Microsoft or Google their employer's tenant uses. Optional env vars (`.env.example`): `TOKEN_ENCRYPTION_KEY` (required in production once any mailbox is connected), `UNSUBSCRIBE_TOKEN_SECRET` (required in production once any template is sent — signs `{{unsubscribeLink}}` tokens), `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Under `NODE_ENV=test`, `MockEmailProvider` is used unconditionally regardless of which provider a connection specifies — no automated test ever sends real email or reaches a real OAuth endpoint. Keep any provider credentials only in environment variables; never commit them.
