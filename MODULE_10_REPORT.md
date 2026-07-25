# Module Ten Delivery Report

Sales Experience, Production Readiness, Deployment, and Version 1 Acceptance.

**Status: local implementation and verification complete. Not committed, not
pushed, not merged, not deployed — per the governing stop point, this report
and the pre-deployment section of `VERSION_1_ACCEPTANCE.md` are presented for
review; no GitHub or Railway action has been taken.**

## Starting point

Branch `module-ten-launch`, equal to `main` at the start of this module.
Modules One through Nine complete and merged; all nine module reports present
(`MODULE_1_REPORT.md` through `MODULE_9_REPORT.md`, plus `MODULE_8A_REPORT.md`
for Module 8A specifically). Working tree was clean before this module's
changes began.

Three research passes (sales UX, security/integrity, production readiness)
done before any edit, per the plan's required startup check — findings
summarized in the approved plan and referenced throughout this report.

## Phase A: security and data-integrity fixes

Four real, pre-existing gaps found by research and fixed, each with a
regression test proving the fix:

1. **`sendComposedEmail`/`cancelComposedScheduledEmail`**
   (`src/app/(dashboard)/companies/[id]/email/actions.ts`) never verified
   `companyScope` — a salesperson holding `send_email`/`schedule_email` could
   send or schedule outbound email against any company by ID, outside their
   assignment or team. Fixed with a `requireCompanyInScope()` helper mirroring
   the pattern every sibling action file (contacts/tasks/activities) already
   used. Regression tests: `tests/integration/company-email-actions.test.ts`
   (new).
2. **`restoreCompany`** (`src/app/(dashboard)/companies/actions.ts`) had no
   scope check (unlike sibling `archiveCompany`/`bulkRestore`) and wrote no
   audit event. Fixed: scoped like its siblings, now calls
   `writeAuditEvent()`. Regression tests added to
   `tests/integration/company-crud.test.ts`.
3. **`generate-report.ts`** (`worker/handlers/generate-report.ts`) created
   `GeneratedReport` rows with no idempotency guard — a pg-boss redelivery
   after commit-but-before-ack could duplicate a report and its notification.
   Fixed with a new `@@unique([scheduledReportId, periodStart])` constraint
   (migration `20260724135913_module_ten_generated_report_idempotency`) and a
   deeper fix threading the enqueue-time `periodKey` through as the
   redelivery-stable identifier for the failure path specifically — the
   first, shallower fix (unique constraint alone) still failed its own
   regression test, which is what surfaced the real root cause (the
   permanent-failure path was deriving its period from the *already-advanced*
   `schedule.nextRunAt` on a redelivered call, not from a value fixed at
   enqueue time). Regression tests added to
   `tests/integration/scheduled-reports.test.ts`.
4. **No rate limiting** on `createCompany`/`updateCompany`, import commit,
   and both export endpoints. Fixed with `checkRateLimit()` calls following
   the existing key-naming convention. Regression tests added to
   `tests/integration/company-crud.test.ts`, `import.test.ts`,
   `export.test.ts`.

Also removed the vestigial, unused `AUTH_SECRET` line from `.env.example`
(confirmed dead — not in `env.ts`'s schema, not read anywhere).

## Phase B: sales experience

Reuse-first — the existing Salesperson Home Page priority dashboard,
`/follow-ups`, `/pipeline` named views, and Manager Workspace were extended or
linked to, never rebuilt.

- **Global search** (`src/lib/search/global-search.ts`,
  `src/components/global-search.tsx`): header search across companies,
  contacts, and competitors — debounced, min-length-gated, rate-limited,
  `companyScope`-filtered, grouped by type, keyboard-navigable. 8 tests
  including the security-critical cross-salesperson scope-isolation case.
- **Quick Add** (`src/components/quick-add.tsx`,
  `src/app/(dashboard)/quick-add/`): a modal with short forms for Company/
  Contact/Note/Activity/Follow-up, calling the existing `createCompany`/
  `createContact`/`createActivity`/`createTask` actions unchanged — reuses
  the existing duplicate-warning UI, never a new mutation path. Full-form
  escape hatch on every tab.
- **Fast quick-actions** (`src/app/(dashboard)/companies/[id]/quick-actions-bar.tsx`,
  `quick-action-context.tsx`): the existing quick-actions bar's buttons
  previously only anchor-scrolled to the activity form; they now pre-select
  the activity type and open it directly, via a small pub/sub context (not
  React state read in an effect body, to satisfy this codebase's
  `react-hooks/set-state-in-effect` lint rule) shared with the activity and
  follow-up panels. Completing an activity now offers a one-click "schedule
  the next follow-up?" prompt.
- **Next best action** (`src/lib/workspace/next-best-action.ts`,
  `next-best-action-panel.tsx`): a small, deterministic, table-driven list
  (overdue follow-up, unresolved duplicate warning, no contact on file, a
  trial with nothing scheduled to review it, no open follow-up scheduled, no
  recent activity) — each with a plain-text reason, ordered by severity,
  display-only. 12 unit tests.
- **Lead-score explanation** (AI `SearchResult` evidence panel only, per the
  confirmed scope decision — not the separate EOS company-score panel):
  `src/lib/research/result-explanation.ts` adds a confidence level derived
  from evidence verification-status mix, a "Mock data" badge detected from
  the mock providers' own literal `[Mock evidence]`/`[Mock score]` markers
  (the only reliable, already-persisted signal — `AI_PROVIDER` itself isn't
  stored per result), the evidence's last-evaluated date, and a recommended
  next action. Nothing invented — every value is derived from data already
  on the result. 15 unit tests.
- **First-login onboarding checklist** (new `UserOnboardingStep` model,
  migration `20260724161042_module_ten_onboarding_steps`,
  `src/app/(dashboard)/onboarding/`): a fixed, permission-filtered step
  catalog with per-user manual completion tracking, reachable anytime from a
  header icon (with a remaining-count badge), never blocking. 17 tests
  (5 unit + 12 integration).
- **Mobile responsive pass**: `companies-table.tsx` and the AI
  `results-table.tsx` — confirmed by research to have zero (or scroll-only)
  responsive handling — both gained a `md:hidden` stacked-card layout
  alongside the existing `hidden md:block` desktop table, sharing the same
  action controls via extracted `ResultActions`/`ResultEvidencePanel`
  sub-components rather than duplicating that markup.
- **Form/navigation safety**: a new `useUnsavedChangesWarning` hook
  (`src/hooks/`) added to the company and AI-prompt-editor forms — the two
  "longer forms" the plan named explicitly. A new `useFocusTrap` hook added
  to both new modal dialogs (Quick Add, Global Search) so Tab/Shift+Tab can't
  escape into background content while they're open. Destructive-action
  confirmation was already broadly present (20 files using
  `window.confirm`) — spot-checked, no gap found.

## Phase C: performance review

Targeted, no rewrites — reviewed the new global-search/Quick-Add-company
queries, the companies/results list queries, and the dashboard/My Day
queries for N+1s and missing indexes:

- Global search, Quick Add's company search, and the companies/results list
  queries are each a single `findMany` (with `include`/`select`, properly
  capped/paginated) plus a parallel `count` — no per-row queries anywhere.
- Next Best Action computes from data the company detail page already
  fetches, plus one new cheap `count()` — no N+1 introduced.
- The `contains`-filtered fields global search searches on (name/city/
  region/postal/phone/email/website) have no plain-btree-accelerable index
  need — a substring filter can't use one, and this app's realistic data
  volume (confirmed against the local dev database: 2 companies, 10 search
  results) gives no real query-plan evidence to justify a trigram/GIN index.
  Documented honestly rather than adding an index that wouldn't actually
  help.
- No changes were made in this phase — the review found the existing design
  already correct.

## Phase D: accessibility and brand review

- Added a real focus trap (`src/hooks/use-focus-trap.ts`) to both new modal
  dialogs — the concrete gap the plan flagged (Quick Add specifically).
  Global Search already had Escape-to-close, return-focus-on-close, and
  `aria-*`/`role="dialog"` attributes; Quick Add had the same. Neither had a
  Tab-trap before this fix, meaning a keyboard user could tab out of a modal
  that was still visually covering the screen.
- Brand palette: no off-brand colors were introduced by any new or modified
  file in this module (checked directly — no raw hex values, no
  `blue-`/`gray-`/`slate-`/`indigo-` Tailwind classes anywhere in the new
  components). Existing semantic-tone (`success`/`warning`/`neutral`) badge
  classes reused throughout rather than inventing new ones.
- Known, honest, pre-existing gap not addressed in this module: no
  `prefers-reduced-motion` handling exists anywhere in the app (confirmed by
  search). This predates Module Ten and isn't specific to any new component
  in it — the small `transition-all` used in the onboarding progress bar and
  focus-visible states match the rest of the app's existing (also
  unguarded) hover-transition patterns. Fixing this app-wide is a real,
  separate piece of work, not something to patch in only the newest files.

## Phase E: production readiness

- **Worker-heartbeat email alerting** (new `WorkerHeartbeatAlert` model,
  migration `20260724173556_module_ten_worker_heartbeat_alert`,
  `worker/handlers/worker-heartbeat-alert-tick.ts`,
  `src/lib/ops/worker-heartbeat.ts`): a new pg-boss scheduled tick, every 5
  minutes, emailing every user with `manage_background_jobs` when the
  worker's heartbeat goes stale, de-duplicated per continuous stale episode
  via a deliberately separate singleton row (never the same row as
  `WorkerHeartbeat` itself — see the real bug below for why that distinction
  mattered). Reuses the existing `sendSystemEmail()` transactional path with
  a new `SYSTEM_ALERT` purpose. **Honest, documented limitation**: this
  check runs as a pg-boss tick inside the worker process itself, so it
  cannot alert on a fully-crashed worker — only one that's alive but not
  ticking cleanly. A fully-down worker needs an external monitor outside
  this application, out of scope without separate approval (no paid
  monitoring provider).
- **A real, pre-existing production bug found and fixed while building the
  above**: `worker/handlers/worker-heartbeat-tick.ts` called
  `prisma.workerHeartbeat.upsert({ ..., update: {} })`, on the documented
  (but never tested) assumption that Prisma bumps `@updatedAt` even on a
  genuinely empty update. **Verified directly against the real database that
  this is false** — an update with no fields to set is optimized away
  entirely and never touches `updatedAt`. This means the worker's heartbeat
  had likely never advanced past its very first tick since Module 8A
  introduced it, which would make System Health's worker-healthy/stale
  signal silently wrong indefinitely, and would have made the new alert
  feature fire once and then stay silent forever (it would see the heartbeat
  as permanently stale, but with the alert-already-sent flag never clearing
  since the heartbeat never looked fresh again). Fixed by setting
  `updatedAt` explicitly; added `tests/integration/worker-heartbeat-tick.test.ts`,
  which didn't exist before this module. No test previously covered this
  handler at all.
- **A real Docker build bug found and fixed during the deployment gate**:
  `src/components/global-search.tsx` (a client component) imported a
  constant from `src/lib/search/global-search.ts`, which also does
  `import { prisma } from "../prisma"` at module scope. Because that module
  has no `import "server-only"` guard, the bundler didn't reject this at a
  clear boundary — instead `npm run build` failed with `Module not found:
  Can't resolve 'tls'`, tracing through `pg`'s Node-builtin requires, only
  once the client bundle actually tried to include the whole module. Fixed
  by splitting the client-safe constant/types into a new
  `global-search-types.ts` with zero server imports, and repointing the
  client component at it. Confirmed by a clean rebuild afterward.
- **Documentation** (all new): `RAILWAY.md`, `ENVIRONMENT_VARIABLES.md`,
  `MIGRATIONS_AND_SEEDING.md`, `BACKUP_RESTORE.md`, `INCIDENT_RESPONSE.md`,
  `ADMIN_GUIDE.md`, `SALES_QUICKSTART.md`, plus a new Module Ten section in
  `README.md`. `ENVIRONMENT_VARIABLES.md` corrects several stale/incomplete
  gaps in the old `MODULE_3_REPORT.md` checklist (missing
  `TOKEN_ENCRYPTION_KEY`, `UNSUBSCRIBE_TOKEN_SECRET`, the Microsoft/Google
  OAuth pairs, `PLACES_PROVIDER`/`GOOGLE_PLACES_API_KEY`) and corrects a
  real misconception found while writing it: `AI_DAILY_BUDGET_USD`/
  `AI_MONTHLY_BUDGET_USD` are **one-time seed values only**, not
  continuously-enforced env vars — ongoing budget control is entirely
  DB-backed via the AI Settings admin page.
- **Backup/restore drill actually performed** (not just described) against
  the local dev database on 2026-07-24: `pg_dump` (custom format) →
  `createdb` scratch database → `pg_restore` (exit code 0) → row counts
  compared across `Company` (2/2), `User` (2/2), `Role` (3/3), `Permission`
  (62/62), `SearchResult` (10/10) — all matched exactly — plus a spot-check
  that a `Company.assignedToId` relationship still resolved correctly after
  restore. Scratch database and dump file deleted immediately after. Full
  procedure in `BACKUP_RESTORE.md`.

## Schema and migrations

Three new migrations, all additive (no drops/renames):

1. `20260724135913_module_ten_generated_report_idempotency` — unique
   constraint on `GeneratedReport(scheduledReportId, periodStart)`.
2. `20260724161042_module_ten_onboarding_steps` — new `UserOnboardingStep`
   table.
3. `20260724173556_module_ten_worker_heartbeat_alert` — new
   `WorkerHeartbeatAlert` table, plus `SYSTEM_ALERT` added to the
   `TransactionalEmailPurpose` enum.

Applied cleanly to both the local dev and test databases, and to a
brand-new, empty scratch database as part of the deployment gate (see below)
— confirms the full 22-migration history is complete and correctly ordered,
not just working against a dev database that might have had a column added
by hand at some point.

## Deployment gate results

Every check actually run, results reported exactly as they came out:

| Check | Result |
|---|---|
| `prisma format` | Pass |
| `prisma validate` | Pass |
| Migration status check | Pass (22 migrations, all applied, dev + test DBs) |
| Fresh-database migration test | Pass — all 22 migrations applied cleanly to a brand-new empty database (`trivialitycrm_migration_gate_check`, dropped after) |
| Existing-database migration test | Pass — dev database already current |
| `prisma generate` | Pass |
| Seed run twice | Pass — idempotent; second run correctly skipped bootstrap-admin creation, identical counts otherwise (7 pipeline stages, 6 rejection reasons, 62 permissions, 3 roles, 16 data-quality rules) |
| `npm run lint` | Pass, clean |
| `npx tsc --noEmit` | Pass, clean |
| Full `vitest run` | See "Test results" below |
| `npm run build` | Pass — failed once (the real client/server-boundary bug above), fixed, passes cleanly on rebuild, including the new `/onboarding` route |
| `npm audit` | Reviewed — see "Dependency audit" below |
| `docker build --target web` | Pass |
| `docker build --target worker` | Pass |
| Web container smoke test | Pass — started clean; confirmed the documented env-validation behavior fires correctly for missing production secrets; once configured, `/api/health` → `200 {"status":"ok","database":"up"}`, `/login` → 200 with CSP header intact, clean SIGTERM exit (code 143) |
| Worker container smoke test | Pass — confirmed the migration-status gate ("database schema is up to date."), `/health` → `200 {"status":"ok"}`, and a real graceful-shutdown log line ("received SIGTERM, shutting down gracefully..." / "shutdown complete.") with exit code 0 |
| `git status` review | Clean — see "Files changed" below |

### Test results

Full suite run cleanly, undisturbed by any concurrent Docker/DB activity
(two earlier attempts during this module were contaminated by the author's
own concurrent `pg_dump`/`npm audit` commands sharing the same Docker
Desktop VM's I/O with the test database — those runs' failures were
diagnosed as resource contention, not code regressions, and are not counted
here; see "Known limitations" below for the honest account of that
diagnostic process):

```
 Test Files  128 passed (128)
      Tests  939 passed (939)
   Duration  884.01s (~14.7 min)
```

All green — 128 test files, 939 tests, zero failures, run start to finish with
no concurrent Docker/DB activity from this session.

One genuine regression surfaced by this run (not present in earlier partial
runs) was the `worker-heartbeat-tick`/`worker-heartbeat-alert` interaction
described under Phase E above — found, root-caused, and fixed with new
regression tests before this final run.

### Dependency audit

`npm audit --omit=dev` found 10 vulnerabilities (6 moderate, 4 high).
Applied the safe, non-breaking fix (`npm audit fix`, no `--force`): resolved
`fast-uri`'s host-confusion advisory. Reviewed and deliberately deferred the
rest, since fixing them requires a breaking change this module's time budget
didn't include dedicated regression testing for:

- **`next`/`postcss`/`sharp`** (several advisories): fix requires forcing a
  Next.js version bump beyond the currently pinned `16.2.10`. A framework
  minor-version bump deserves its own dedicated testing pass, not a
  same-session force-fix at the end of an already-large module.
- **`uuid`/`exceljs`**: fix requires *downgrading* `exceljs` to `3.4.0` — a
  breaking change to a package this app actively uses for Excel exports.
  Downgrading it risks breaking that feature outright; not safe to force.
- **`valibot`**: a transitive dependency of Prisma's own CLI dev-tooling
  (`prisma → @prisma/dev → valibot`), never reachable by any application code
  path. No fix available without an upstream Prisma dependency update.

This is a real, current gap — not resolved, only reviewed and consciously
deferred with reasoning. Recommend a dedicated future maintenance pass for
the Next.js upgrade specifically, since three of the ten findings depend on
it.

## Files changed

32 modified, 34 new (66 total) — full list in `git status`. By area:

- **Phase A fixes**: `companies/[id]/email/actions.ts`, `companies/actions.ts`,
  `audit/describe.ts`, `worker/handlers/generate-report.ts`,
  `leads/import/actions.ts`, `api/export/companies/route.ts`,
  `api/export/search-results/route.ts`, `.env.example`
- **Global search**: `lib/search/` (new), `components/global-search.tsx` (new),
  `app/(dashboard)/search/` (new)
- **Quick Add**: `components/quick-add.tsx` (new), `app/(dashboard)/quick-add/` (new)
- **Fast quick-actions / Next Best Action**: `companies/[id]/quick-actions-bar.tsx`,
  `companies/[id]/quick-action-context.tsx` (new),
  `companies/[id]/next-best-action-panel.tsx` (new),
  `companies/[id]/activities/activity-panel.tsx`,
  `companies/[id]/tasks/tasks-panel.tsx`, `companies/[id]/page.tsx`,
  `lib/workspace/next-best-action.ts` (new)
- **Lead-score explanation**: `lib/research/result-explanation.ts` (new),
  `leads/searches/[id]/results/results-table.tsx`,
  `leads/searches/[id]/results/page.tsx`
- **Onboarding checklist**: `lib/onboarding/` (new), `app/(dashboard)/onboarding/` (new),
  `app/(dashboard)/layout.tsx`, `components/dashboard-shell.tsx`
- **Mobile responsive pass**: `companies/companies-table.tsx`
- **Form/nav safety**: `hooks/` (new), `companies/company-form.tsx`,
  `leads/prompts/prompt-form.tsx`
- **Worker-heartbeat alerting + bug fix**: `worker/handlers/worker-heartbeat-alert-tick.ts` (new),
  `worker/handlers/worker-heartbeat-tick.ts`, `worker/main.ts`,
  `lib/ops/worker-heartbeat.ts` (new),
  `administration/system-health/queries.ts`
- **Schema/migrations**: `prisma/schema.prisma`, 3 new migrations
- **Docs**: 7 new top-level `.md` files, `README.md`
- **Tests**: 10 new integration test files, 4 new unit test files, plus
  updates to 6 existing test files (fixture/scope corrections) and
  `tests/helpers/db.ts` (new tables added to the reset list)

## Post-merge production incident and fixes (2026-07-24/25, after this report was first written)

Eight real issues surfaced once this module was actually deployed and
exercised live for the first time — all found and fixed within the same
incident, each with regression tests (except item 6, a data-naming issue with
no code to test):

1. **`refinePrompt` crashed the whole page on a live AI provider failure**
   (`src/app/(dashboard)/leads/prompts/actions.ts`) — it called the AI
   provider with no `try`/`catch` at all, so a real production event (the
   configured Anthropic account running out of credit) propagated as an
   uncaught exception, and Next.js showed its generic 500 page instead of
   the friendly inline error every other AI-provider call site in the app
   already produces via `classifyProviderError()`. Fixed to match that
   existing pattern. Not introduced by this module, but found and fixed
   during it.
2. **Railway cannot select a build target from a multi-stage Dockerfile** —
   a gap in this project's deployment setup since Module Three, never
   actually exercised until this module's changes made deploying a second
   (`worker`) service necessary for the first time. `MODULE_3_REPORT.md`'s
   original Railway checklist assumed a "Docker Build Target" setting that
   does not exist in Railway's current build configuration or
   config-as-code (confirmed directly against Railway's own current docs).
   Without it, Docker builds a multi-stage file's *last* stage by default —
   which is why the `web` service always worked (its last stage aliases
   `web`) but a `worker` service pointed at the same file silently built the
   web app again instead of the worker. Fixed with a new, standalone
   `Dockerfile.worker` (near-identical to the main Dockerfile's `worker`
   stage, minus the unneeded Next.js build step) that the `worker` Railway
   service points its own "Dockerfile Path" setting at directly — no target
   selection needed. `RAILWAY.md` and the main `Dockerfile`'s header comment
   were both corrected to reflect this. Verified with the same build +
   container smoke test used for the original deployment gate.
3. **Live AI research had never actually been exercised against the real
   Anthropic API before this incident** — `AnthropicCandidateDiscoveryProvider`/
   `AnthropicEvidenceVerificationProvider`'s own header comment admitted as
   much ("hasn't been exercised against the live API in this environment").
   This incident was, in effect, that first live smoke test, and it surfaced
   two further real gaps:
   - **The web_search/web_fetch tool budget (8 rounds per call) was
     hardcoded**, with no way to trade thoroughness for speed without a code
     change. Added `AiSettings.maxSearchToolUsesPerCall` (admin-configurable,
     1–8, AI Settings page) — both `discover()` and `verify()` now read it
     instead of two independently-hardcoded values (8 and 3 respectively).
     Migration `20260725153823_module_ten_max_search_tool_uses`.
   - **Candidates within one search were processed strictly one at a time**
     — discover, then for every candidate: verify (up to 5 min), then score,
     fully sequentially. For a mode using live Anthropic verification, this
     meant total wall-clock time scaled linearly with candidate count, which
     is what actually made searches feel unacceptably slow — a bigger
     contributor than the per-call tool budget alone. Fixed in
     `src/lib/research/run-search.ts`: candidates are now processed in
     batches of `CANDIDATE_CONCURRENCY = 3` via `Promise.allSettled` (not
     `Promise.all` — see below for why that distinction mattered), with each
     candidate's own verify→score sequence still fully sequential internally,
     but different candidates' sequences now overlapping within a batch.
   - **A genuine race condition found during that refactor, before it ever
     shipped**: an initial version used `Promise.all` for the batch, which
     rejects as soon as *any* candidate in it fails — abandoning sibling
     candidates that were still mid-flight as orphaned, un-awaited promises
     whose database writes would then race unpredictably against the job's
     own failure handling. Caught by `tests/integration/search-run-resume.test.ts`
     (an existing test) failing on an exact intermediate-state assertion,
     traced to the real underlying race, and fixed with `Promise.allSettled`
     instead — every candidate in a batch is now guaranteed to fully settle,
     success or failure, before the batch is judged. Two new tests added
     (`tests/integration/search-run-batching.test.ts`) specifically exercise
     the batch boundary (5 candidates spanning two batches of 3+2) and a
     mid-second-batch failure leaving the first batch fully, unambiguously
     `COMPLETED` — neither scenario the pre-existing single-batch tests could
     have caught.
   - **The mid-run AI budget recheck was initially moved to batch
     granularity** (checked once per batch of up to 3, instead of once per
     candidate) as part of the same refactor — caught immediately by
     `tests/integration/ai-budget-midrun.test.ts` failing (a budget breach on
     the second of two candidates in one batch was never caught, since the
     check only ran once before that single batch). Fixed by moving the
     budget check inside `processCandidate` itself, checked before every
     individual candidate's own paid call regardless of which batch it's
     in — restoring the original per-candidate granularity while still
     keeping the concurrency benefit.
4. **The worker Railway service had never been created at all** until this
   incident — a separate, more fundamental gap than the Dockerfile one
   above. Railway's free plan hit its service-provisioning limit, silently
   leaving the app running with no background-job processor of any kind
   (nothing tracked worker liveness or absence before Module Ten's own new
   heartbeat-alert feature — which, notably, correctly reported "no data
   yet" once checked, which is exactly what surfaced this). Resolved by the
   account holder upgrading Railway's plan; not a code change.
5. **Google Places API (New) was enabled with an API key created in a
   Google Cloud project where the API itself had not been separately
   enabled** — a Google Cloud account-setup gap, not a code issue. GENERAL-
   mode search discovery correctly, safely fell back to mock candidate data
   rather than crashing; the failure was visible and diagnosable from the
   System Health failed-jobs list (Module 8A) with Google's own actionable
   error message. Resolved on the Google Cloud side; no code change.

6. **A seeded Lead Type literally named "Mayhem" was being used as an AI
   search keyword**, since GENERAL/TRIVIA search prompts include the Lead
   Type's own name as a qualifying term. Live results included businesses
   like "Mayhem Trailers" and "Mayhem Junk Removal" — a correct search result
   for the literal term, not a code bug. No fix was possible or needed in
   code; resolved by renaming the Lead Type to "Pub Trivia" (an accurate,
   non-generic-word name), which is itself the durable fix — any Lead Type
   name doubling as a common English word will do the same thing.
7. **The AI-assisted "Draft prompt" feature (`AnthropicPromptAssistant.refine()`,
   `src/lib/research/providers/anthropic.ts`) returned generic fill-in-the-
   blank templates** (`[LOCATION]`, `[YOUR PRODUCT OR SERVICE]`-style bracket
   placeholders) instead of a ready-to-use prompt — confirmed live, twice,
   because the first fix attempt was insufficient. The original instructions
   asked the model to avoid placeholders but appended that guidance after
   the rest of the prompt, where it was easy for the model to deprioritize;
   the model also had no explicit instruction for the "improve an existing
   template" branch, so it would preserve a prior bracket-filled structure
   instead of rewriting it as concrete guidance. Fixed by rewriting
   `PROMPT_ASSIST_FORMAT_RULES` as a strict, itemized format contract placed
   **first** in the message (not appended last) in both the fresh-draft and
   improve-existing branches, explicitly forbidding location/lead-type
   placeholders (those are supplied automatically at search time) and
   requiring concrete qualifying criteria instead. Confirmed live, by the
   account holder, to now produce a genuinely usable, bracket-free prompt.
8. **A Prisma bulk-transaction timeout during search-candidate checkpointing**
   — `run-search.ts`'s discovery step checkpoints every discovered candidate
   in one `prisma.$transaction([...])` (array form) before per-candidate
   processing begins. Prisma's array-form `$transaction` defaults to a 5-
   second timeout; once the prompt-assist fix (item 7) started producing
   genuinely good, specific prompts, live searches began discovering enough
   real candidates that this bulk upsert started genuinely exceeding 5
   seconds. Found via the System Health failed-jobs list, showing Prisma's
   own exact error: *"A commit cannot be executed on an expired transaction.
   The timeout for this transaction was 5000 ms, however 5505 ms passed
   since the start of the transaction."* Fixed with an explicit
   `{ timeout: 30_000 }` second argument — comfortably above the app's own
   upper bound on candidates per search (`maxResultsPerSearch` /
   `maxCitiesPerSearch`), and appropriate for a bulk checkpoint step rather
   than a fast interactive one. A `Grep` sweep of `src/` for the same
   array-form-`$transaction`-with-`.map()` shape confirmed this was an
   isolated instance, not a systemic pattern. Regression test added
   (`tests/integration/search-run.test.ts`) asserting the checkpoint
   transaction is always called with `{ timeout: 30_000 }`, since directly
   reproducing a slow transaction in an automated test isn't practical.

None of items 3–5 were caused by code shipped in this module specifically —
they were pre-existing gaps (or, for the AI provider work, never-before-run
code) that this module's own new worker-heartbeat monitoring and stuck-search
symptoms are what actually surfaced them. Item 3's `Promise.allSettled` fix
is the one genuine, non-trivial design correction made live during this
incident, and it went through the same rigor as the rest of this module:
real root-cause tracing (not accepting the first plausible explanation),
a regression test that failed for the right reason before the fix and
passed for the right reason after, and a full clean test-suite run before
being considered done.

## Known limitations

- **No browser-automation tool available in this session** (as with Module
  Nine). Every UI-level claim in this report and in
  `VERSION_1_ACCEPTANCE.md`'s pre-deployment section is verified via
  code-level review, direct HTTP checks (curl), or the automated test suite
  — never an actual signed-in browser click-through. Stated honestly
  wherever it applies, never claimed as done when it wasn't.
- **Background-task tracking on this Windows session was unreliable for the
  final long-running test suite specifically** — it reported the run as
  "killed" three times while the underlying process was verifiably still
  alive (confirmed directly via `Get-CimInstance Win32_Process` each time,
  consistent with a pattern already established earlier in this same
  session for other long-running processes). The suite was ultimately run
  as a fully OS-detached process, polled directly, to get a trustworthy
  final result rather than relying on that notification path.
- **Worker-heartbeat alerting cannot detect a fully-crashed worker** — see
  Phase E above. This is a real, permanent architectural limitation of a
  same-process pg-boss tick, not a bug.
- **`npm audit`'s remaining findings are deferred, not resolved** — see
  "Dependency audit" above.
- **No `prefers-reduced-motion` handling anywhere in the app** — pre-existing,
  not introduced by or fixed in this module.

## Deferred / not attempted in this module

- A dedicated Next.js version-bump pass to close the remaining `npm audit`
  findings.
- App-wide `prefers-reduced-motion` support.
- An external (outside-the-app) monitor for a fully-crashed worker process.
- The live-provider Production Acceptance Walkthrough, one real controlled
  test email, and every other post-deployment section of
  `VERSION_1_ACCEPTANCE.md` — explicitly sequenced after your review and
  approval, per the stop point.
