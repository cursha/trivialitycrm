# Module Five Delivery Report

## Starting point

Modules One through Four (CRM foundation, AI-assisted lead discovery, production hardening, Sales Workspace) were complete, tested, and merged into `main` before this module started, per the approved plan's Step 0. Module Five was built on branch `module-five-reporting`.

## Scope decision made mid-module (later completed as a follow-up)

The approved plan included a table-driven scheduled-report worker and CRUD UI (§10 of the plan). Partway through initial implementation, with the 9 report areas, filtering, and exports built but scheduled reports not yet started, the remaining scope was reviewed with the user directly, who chose to ship core reporting first and defer scheduled reports. That work was merged to `main` as the first delivery of this module. **Scheduled reports were then built as a direct follow-up in the same module**, on branch `module-five-scheduled-reports`, once core reporting was confirmed working — see "Scheduled reports" below for the completed design. Nothing about the original deferral required rolling back the schema; the follow-up only added to it (see Migrations).

## Files changed

**New:**
- `prisma/migrations/20260720142234_module_five_reporting/` — schema migration (see below)
- `REPORT_DEFINITIONS.md` — every report metric's numerator/denominator/date-field/permission-scope/missing-data-handling, plus global rules (timezone, small-sample suppression, archived handling)
- `src/lib/timezone.ts` — `BUSINESS_TIMEZONE` constant and all date-range boundary math (DST-aware, via native `Intl`, no new dependency)
- `src/lib/reports/{scope,filters,metrics,export,date-range-keys}.ts` — report permission scope, validated filter schema, pure rate/duration calculators, export metadata wrapper
- `src/app/(dashboard)/reports/**` — the `/reports` shell (layout, tabs, shared filter bar, shared table/chart UI, export links) and 9 report-area subdirectories (dashboard, pipeline, salespeople, sources, ai-research, competitors, territories, lead-types, trends), each with its own `queries.ts` + `page.tsx`
- `src/app/api/reports/[reportKey]/export/route.ts` — CSV/Excel export for every report area
- `src/lib/reports/build-rows.ts` — the single source of truth for "what does report X contain," extracted from the export route so the scheduled-report worker reuses the exact same logic instead of a second copy
- `src/lib/reports/schedule.ts` — cadence math (`computeNextRunAt`, `dateRangeKeyForCadence`), reusing the already-DST-tested `zonedDayRange`/`zonedWeekRange`/`zonedMonthRange` boundary functions
- `worker/handlers/reports-tick.ts`, `worker/handlers/generate-report.ts` — the durable scheduled-report pipeline (see "Scheduled reports" below)
- `src/app/(dashboard)/reports/scheduled/**` — CRUD UI (create/pause/resume/delete a schedule, recent-runs list with downloads)
- `src/app/api/reports/generated/[id]/download/route.ts` — serves a previously-generated report's frozen payload
- `src/components/notification-bell.tsx` — header dropdown for unseen generated-report notifications
- 9 new test files (see Tests below)

**Modified:**
- `prisma/schema.prisma`, `prisma/seed.ts` — new models/enums, 7 new permissions and default grants
- `src/lib/companies/activity-log.ts` — `logPipelineChange()` now also writes a `PipelineStageHistory` row (with optional loss-reason capture); new `logInitialPipelineStage()` for creation-time history
- `src/app/(dashboard)/companies/actions.ts`, `.../leads/transfer/actions.ts`, `.../leads/import/actions.ts` — set `Company.source` (+ `importBatchId` for imports) and write the initial stage-history row at each of the three creation paths
- `src/app/(dashboard)/companies/company-form.tsx`, `new/page.tsx`, `[id]/edit/page.tsx` — conditional loss-reason field, shown only when the selected pipeline stage is a Lost-outcome stage
- `src/lib/validation/company.ts` — optional `lossReasonId` field
- `src/lib/nav.ts`, `src/components/dashboard-shell.tsx` — new "Reports" nav item, permission-gated on any of the three `view_*_reports` keys
- `tests/helpers/db.ts` — `TABLES_TO_RESET` includes the 3 new tables
- `tests/helpers/fixtures.ts` — extended `createPipelineStageFixture`/`createCompanyFixture` with `outcomeType`/`source`/`createdAt`/etc., new `createRejectionReasonFixture`, `createPipelineStageHistoryFixture`, `fetchAuthenticatedUser`
- `worker/main.ts`, `src/lib/jobs/boss-client.ts`, `src/lib/jobs/enqueue.ts` — new `reports-tick`/`generate-report` queues
- `src/app/api/reports/[reportKey]/export/route.ts` — slimmed down to call the new shared `buildReportRows()` instead of its own inline switch
- `src/app/(dashboard)/layout.tsx`, `src/components/dashboard-shell.tsx` — wired in the notification bell
- **`"server-only"` guard removed from 18 files** (`src/lib/auth/{current-user,permissions,session}.ts`, `src/lib/{dates,timezone}.ts`, `src/lib/reports/{scope,filters,build-rows,schedule}.ts`, and all 9 report `queries.ts` files) — see "Bugs found and fixed"

## Migrations created

`20260720142234_module_five_reporting` — purely additive, no drops:
- New enums: `LeadSource`, `ReportCadence`, `ReportRunStatus`
- `Company.source` (nullable), `Company.importBatchId` (nullable FK to `ImportBatch`)
- New table `PipelineStageHistory` (append-only; `fromStageId` nullable for creation-time rows; optional `lossReasonId` FK reusing the existing `RejectionReason` table)
- New tables `ScheduledReport`, `GeneratedReport`
- New indexes: `PipelineStageHistory(companyId, changedAt)`, `PipelineStageHistory(toStageId)`, `Company(source)`, plus supporting indexes on the two scheduled-report tables

`20260721122133_generated_report_payload` — added as part of building the scheduled-report worker, once it became clear `GeneratedReport` needed to store its own result rather than being re-derived live on download (see "Scheduled reports" below):
- `GeneratedReport.periodStart`/`periodEnd` (`DateTime`, required) — the exact business-timezone period a run covers
- `GeneratedReport.payload` (`Json`, required) — the frozen `{columns, rows}` result
- Both required with no default — safe because `GeneratedReport` had never received a row before this migration (confirmed before writing it)

Both applied to the dev and test databases; `npx prisma generate` re-run each time; `prisma/seed.ts` re-run against dev (30 permissions seeded, up from 23 — unchanged by the second migration, which added no new permissions).

## Packages added

None. Timezone math uses Node's built-in `Intl` (Node ≥22.12, already required); charts are hand-rolled CSS (no charting library, matching `BRAND_GUIDE.md`'s no-large-framework rule); exports reuse the existing `exceljs`/CSV utilities.

## Key design decisions

- **No backfill for `PipelineStageHistory`.** The prior audit trail (`Activity` rows of type `PIPELINE_CHANGE`) stores only human-readable stage *names* at the time of the change — names are admin-renameable, so there is no reliable way to map old free-text notes back to a specific stage's identity. Per the brief's explicit instruction not to reconstruct historical timing from unreliable data, the table is populated going forward only, starting at this module's ship date. Early pipeline-timing reports (avg days in stage, stage conversion, stalled leads) will look sparse until real data accumulates — this is flagged everywhere it matters (REPORT_DEFINITIONS.md, in-page "not tracked before Module Five shipped" messaging) rather than hidden.
- **Report scope is a separate permission tier from lead-edit visibility.** `reportScope()` (`src/lib/reports/scope.ts`) mirrors `companyScope()`'s three-tier shape (own/team/all, with the same "unassigned companies visible to Team scope" rule) but is keyed on `view_own_reports`/`view_team_reports`/`view_all_reports`, independent of `view_assigned_leads`/etc. A user's report visibility and lead-edit visibility can differ.
- **`LeadSource` as a fixed enum, not an editable lookup table** — sources are a closed, rarely-changing set (unlike admin-editable Lead Types/Pipeline Stages). Reversible later if needed.
- **Timezone via native `Intl`, no library** — `BUSINESS_TIMEZONE = "America/Toronto"` in one file; every date-range boundary (Today/Week/Month/Quarter/Year/Custom) goes through it. Verified DST-correct with unit tests spanning EDT/EST transitions.
- **One shared `ReportFiltersSchema`**, separate from Module Four's `SavedViewFiltersSchema` (company-list filtering) — report filters carry fields (date range, outcome) that don't apply to a company list, and the query code reading each is different. Both are still stored through the same `SavedView.filters` `Json` column; no duplicate storage system.
- **`GeneratedReport.seenByIds` serves both "in-app notification" and "downloadable report record"** in one model, as originally designed — the notification bell's unread badge and the "download again" link both read the same row.
- **Export routes call the exact same scoped query functions the pages render from** (`src/app/api/reports/[reportKey]/export/route.ts` imports from each area's `queries.ts` directly) — there is no separate, potentially-unscoped export code path. Verified by a test that an "own"-scope user's export contains only their own data.
- **Small-sample rate suppression**: any rate below `MIN_SAMPLE_SIZE_FOR_RATE` (5, in `src/lib/reports/metrics.ts`) renders as "not enough data" with the underlying count, never a bare percentage. A zero-denominator rate is never rendered as 0%.

## Scheduled reports

Built on the durable worker from Module Three (pg-boss on Postgres, no Redis), following the exact conventions the existing `run-search` queue and cleanup schedules already established:

- **`reports-tick`** (hourly cron, `worker/main.ts`) queries `ScheduledReport` for rows where `active` and `nextRunAt <= now`, and enqueues one `generate-report` job per due row via `enqueueGenerateReportJob(scheduledReportId, nextRunAt.toISOString())`.
- **Dedup, not new locking code**: `generate-report` is a `policy: "singleton"` queue with `singletonKey = "${scheduledReportId}:${periodKey}"` (`src/lib/jobs/boss-client.ts`) — the same idiom `run-search` already uses. A tick that fires while the previous period's job is still active is a no-op send, not a duplicate. `reports-tick` deliberately does **not** advance `nextRunAt` itself — only a successful (or permanently-failed) `generate-report` run does, so a row stays correctly "due" and gets re-offered every tick until it's actually processed.
- **`generate-report`** (`worker/handlers/generate-report.ts`) loads the schedule, resolves the report's date range from its cadence (`dateRangeKeyForCadence` — daily→today, weekly→this week, monthly→this month, not whatever range happens to be saved in a linked `SavedView`), runs the report as the *schedule's creator* would see it (their own `reportScope`, via a new `getUserById()` in `current-user.ts`), and freezes the result into `GeneratedReport.payload` (+ `periodStart`/`periodEnd`). A schedule with no linked `SavedView` runs with only the cadence-derived date range and no dimensional filters.
- **Frozen, not live, downloads**: `GeneratedReport.payload` is a snapshot at generation time. Downloading it next month reproduces exactly what was generated, not a re-resolved "this month" against different data — verified by a test that deletes the underlying company after generation and confirms the download still shows the original count.
- **Permanent vs. transient failure, handled differently**: an invalid `reportKey`, a disabled/deleted creator, or a creator who's lost report access are all recorded as a `FAILED` `GeneratedReport` row and the schedule still advances to its next period (retrying would never succeed). A genuine unexpected exception is *not* caught here — it propagates so pg-boss applies its own bounded retry (`retryLimit: 2`) against the same still-due period; `nextRunAt` only advances once the run actually resolves one way or the other.
- **Next-run math reuses already-DST-tested code**: `computeNextRunAt()` (`src/lib/reports/schedule.ts`) calls the existing `zonedDayRange`/`zonedWeekRange`/`zonedMonthRange` boundary functions rather than hand-rolled date arithmetic — "add 24 hours" is wrong across a DST transition, and this reuses code that already has DST unit-test coverage instead of adding a second, differently-tested implementation.
- **No email sent**, per the original plan — recipients see a new run via the notification bell (`src/components/notification-bell.tsx`, in the dashboard header), which reads each user's unseen `GeneratedReport` rows (`recipientIds` has them, `seenByIds` doesn't yet) and lets them download or dismiss individually, or mark all read.
- **CRUD UI** (`/reports/scheduled`, gated on `manage_scheduled_reports`): create a schedule (name, report, cadence, recipients — validated against real active users), pause/resume (`active` toggle), delete, and a "recent runs" list with CSV download links. Editing cadence/recipients in place was left out of this first cut — delete and recreate covers it — as a deliberate, documented scope trim.

## Bugs found and fixed during this module

**`src/lib/timezone.ts` had a `"server-only"` guard, but its `REPORT_DATE_RANGE_KEYS` constant was imported by a client component** (`report-filter-bar.tsx`), which crashed the dev server with a 500 the moment an authenticated user hit `/reports` — caught via a direct HTTP smoke test with a real session (not just `tsc`, which doesn't understand the server/client boundary). Fixed by extracting the plain constant into a guard-free `src/lib/reports/date-range-keys.ts`, re-exported from `timezone.ts` for server callers.

**Two broken drill-down links**, caught by manually auditing every `href` in `src/app/(dashboard)/reports/**` against the actual query-param support of their target pages: the Territories report linked to `/companies?territoryId=…` (that param is only supported on `/pipeline`, not `/companies`) and the AI Research report and dashboard both linked to a non-existent `/leads/searches` route (the real hub page is `/leads`). Both fixed before this report was written.

**18 files had a `"server-only"` guard that broke the worker at startup**, caught by actually running `npm run worker` (not `vitest`, which mocks `"server-only"` to a no-op — see `tests/setup/mock-next.ts` — so all 378 automated tests passed while the real worker process crashed immediately on import). Building the scheduled-report worker was the first time anything in `worker/` needed to import the report-query layer or `src/lib/auth/{current-user,permissions,session}.ts`; each import failure surfaced the next file in the chain one at a time (`enqueue.ts` → `current-user.ts` → `session.ts` → `permissions.ts` → `reports/{filters,build-rows,schedule,scope}.ts` → all 9 report `queries.ts` files → `dates.ts`/`timezone.ts`), fixed by removing the guard from each and replacing it with the same explanatory comment `src/lib/prisma.ts` already uses for this exact situation ("every consumer is itself a server-only context — Server Components/Actions, or the worker process"). The guard is a build-time footgun-prevention check, not a runtime security control, so removing it doesn't weaken anything — it only stops false-positive-blocking a legitimate dual web+worker consumer. Confirmed fixed by running the actual worker process to a clean "listening for jobs" startup, not just re-running the test suite.

## Permission matrix

| Permission | Administrator | Manager | Salesperson |
|---|---|---|---|
| `view_own_reports` | Yes | Yes | Yes |
| `view_team_reports` | Yes | Yes | No |
| `view_all_reports` | Yes | No | No |
| `export_reports` | Yes | Yes | No |
| `manage_scheduled_reports` | Yes | No | No |
| `view_ai_costs` | Yes | No | No |
| `view_competitor_reports` | Yes | Yes | No |

Enforced server-side in every query function (`reportScope()` returns `null` → page/export renders "no access"), in the export route (`requirePermission(user, "export_reports")`, `requirePermission` inside `getCompetitorsReport`/AI-cost gating), and now in the scheduled-report CRUD actions (`requirePermission(user, "manage_scheduled_reports")` in every action in `src/app/(dashboard)/reports/scheduled/actions.ts`) and the download route (recipient, schedule creator, or `manage_scheduled_reports` holder only — everyone else gets 403).

## Pages and routes added

| Route | Purpose |
|---|---|
| `/reports` | Dashboard — 18 summary metrics across leads, pipeline, follow-ups, AI research |
| `/reports/pipeline` | Stage counts, entries/exits, avg days in stage, stalled leads, loss reasons, stage-to-stage conversion, New→Won cohort rate, win rate by lead type/source/salesperson |
| `/reports/salespeople` | Per-salesperson activity completed / pipeline progress / won / lost / current workload (four separate columns, never one ranking score) |
| `/reports/sources` | Leads and win rate by source (Manual/AI Research/Import) |
| `/reports/ai-research` | Search/candidate/result funnel, search status, estimated AI cost (permission-gated, clearly labeled as an estimate) |
| `/reports/competitors` | Linked-lead and won/lost counts per competitor, computed live, drill-down to `/companies` (permission-gated) |
| `/reports/territories` | Active-lead and won/lost counts per territory, "no recorded leads" honesty rule, unmatched-lead count |
| `/reports/lead-types` | Active leads and win rate by lead type (never hardcoded) |
| `/reports/trends` | Weekly new-leads/won/lost/activities table, DST-correct week buckets, zero-filled quiet weeks |
| `GET /api/reports/[reportKey]/export` | CSV/XLSX export for all 9 areas above, with report name/date range/filters/generation timestamp |
| `/reports/scheduled` | Scheduled-report CRUD (gated on `manage_scheduled_reports`): create/pause/resume/delete a schedule, plus a recent-runs list with downloads |
| `GET /api/reports/generated/[id]/download` | Downloads a previously-generated report's frozen payload — recipient, schedule creator, or `manage_scheduled_reports` holder only |

Every report page has a full filter bar (date range, territory, lead type, pipeline stage, salesperson, source, competitor, status, outcome, trivia status, score range where applicable) and CSV/Excel export links, gated on `export_reports`.

## Tests

378 tests passing (296 pre-existing, unmodified, + 82 new across the 9 Module Five test files below), including:
- `tests/unit/timezone.test.ts` (12 tests) — DST-correct day/week/month/quarter/year boundaries in both EDT and EST, custom-range validation
- `tests/unit/report-metrics.test.ts` (14 tests) — rate suppression at/below the sample-size floor, stage-duration computation from constructed history sequences, stalled-lead threshold logic
- `tests/unit/report-scope.test.ts` (21 tests) — all three permission tiers for every scope helper, including the unassigned-company OR rule and the `canViewUserReport` boundary check
- `tests/unit/report-schedule.test.ts` (5 tests) — `computeNextRunAt`'s DST correctness (including the fall-back transition) and cadence-to-date-range-key mapping
- `tests/integration/pipeline-stage-history.test.ts` (5 tests) — identical-shaped history rows from single-edit, board-quick-change, and bulk stage changes; initial row at company creation; loss-reason capture only on a LOST move
- `tests/integration/lead-source-attribution.test.ts` (2 tests) — `Company.source`/`importBatchId` set correctly on AI transfer and import commit (manual creation covered in the history test above)
- `tests/integration/report-export.test.ts` (5 tests) — `export_reports` permission enforcement, export metadata block, formula-injection neutralization in exported data, cross-user scope isolation (an "own"-scope export contains only that user's data)
- `tests/integration/competitor-territory-reports.test.ts` (5 tests) — `view_competitor_reports` gating, live (never stored) competitor counts, territory specificity matching (city beats region beats country), "not yet researched" honesty for unmatched leads
- `tests/integration/scheduled-reports.test.ts` (13 tests) — `reports-tick` enqueues only due+active schedules; `generate-report` success (frozen payload + schedule advancement), permanent-failure paths (lost permission, disabled creator) still advance the schedule, and a deactivated-mid-flight schedule is a clean no-op; CRUD action permission/validation; notification ownership (`markGeneratedReportSeen` can't be used to tamper with someone else's unread state); the download route's permission boundary, 409-on-non-success, and — the strongest test in the file — that a download still reflects the exact frozen numbers after the underlying company is deleted

Every report page was also smoke-tested via direct HTTP requests with a real session across all 9 areas, with a full combination of every filter applied simultaneously — no server errors, confirmed against the dev server log. The worker process itself was started for real (`npm run worker`) and confirmed reaching a clean "listening for jobs" state with both new queues registered — this is what caught the 18-file `"server-only"` bug the test suite couldn't see.

## Build result

- `npx prisma format` / `npx prisma validate` — clean
- `npx tsc --noEmit` — clean throughout, re-checked after every batch of changes
- `npx eslint .` — clean (one unused-import warning found and fixed)
- `npm test` — 378/378 passing
- `npx next build` — succeeds; all 9 `/reports/*` routes plus `/reports/scheduled`, and both new API routes, registered as dynamic server-rendered routes, consistent with the personalized/permission-scoped data they render
- `npm run worker` — starts cleanly to "worker started, listening for jobs," with `reports-tick` (hourly) and `generate-report` both registered

## Browser walkthrough

**Not performed as an interactive click-through this session** — no browser automation tool was available (the Chrome extension connection was not completed). In its place, every report page (including the new `/reports/scheduled`) was verified via direct HTTP requests against the real dev server using an authenticated session (server-rendered HTML confirmed present, no 500s, dev server log checked for hidden errors), across default filters and a full combined-filter scenario, plus the real worker process boot described above. This caught three real bugs across the module (see "Bugs found and fixed") that `tsc`/lint/unit tests could not have caught on their own. A manual interactive pass — filter dropdown behavior, the notification bell's open/close/mark-read interactions, CSS-bar rendering, mobile layout, and a CSP console check — is still recommended before considering this module fully verified.

## Remaining limitations / known gaps

- **No query-performance testing at large volumes.** All correctness tests run against small fixture sets (a handful of rows); the "hundreds of companies" realistic-volume performance check called for in the original plan's test section was not built. Every query is Postgres-side aggregation (count/groupBy/indexed lookups), not app-side full-table scans, but this hasn't been load-tested.
- **AI Research report filters are limited.** A `LeadSearch` doesn't always produce a `Company`, so only the two filters that exist directly on `LeadSearch` (lead type, competitor) are applied there — territory/salesperson/source/score/status/outcome have no meaningful analogue and are silently not applied on that one report (documented in `src/app/(dashboard)/reports/ai-research/queries.ts`).
- **Drill-down links reuse existing pages' snapshot views**, not date-range-aware ones — e.g., the dashboard's "Won (in range)" links to `/pipeline?view=won`, which shows companies *currently* in a Won stage, not specifically those won within the selected date range (that page has no date-range filter to carry the value into). This is an inherent tradeoff of reusing existing pages per the brief's own instruction, not a bug, but worth knowing about.
- **Stage-to-stage conversion is co-occurrence, not strict sequencing** — documented in-page and in `REPORT_DEFINITIONS.md`.

## Module Six recommendations

1. **Add in-place editing for scheduled reports** (cadence, recipients, linked saved view) — the current CRUD UI only supports create/pause/resume/delete; changing a schedule's cadence today means deleting and recreating it.
2. **Send email for scheduled reports**, once a communications/email module exists — the design already separates "generate and store" (this module) from "notify," so adding an email step means enqueuing a send job after `GeneratedReport` is written, not restructuring the pipeline.
3. **Load-test report queries** against a realistic data volume (thousands of companies, tens of thousands of `PipelineStageHistory` rows) and add indexes if `EXPLAIN ANALYZE` shows anything unexpected — particularly the per-company stage-duration computation in the Pipeline report, which loads all in-scope history rows into Node for the average-days-in-stage calculation.
4. **Consider a per-salesperson report detail page** (`/reports/salespeople/[userId]`) — `canViewUserReport()` already exists in `src/lib/reports/scope.ts` for exactly this, unused today since the salespeople report is a single table.
5. **Revisit AI Research report filtering** once/if `LeadSearch` gains a territory-equivalent field, so that report's filter bar can match the others.

## Deviations from the approved plan

- Scheduled reports (plan §10) were built after the rest of the module, on a separate branch (`module-five-scheduled-reports`) once core reporting was confirmed working, rather than in the single original pass — an explicit mid-module scope/sequencing decision with the user, not a scope cut (everything in the original plan was ultimately built). Everything else in the approved plan (schema, shared logic, all 9 report areas, full filtering, exports, tests, quality gates) was built as originally planned. In-place schedule editing (cadence/recipients) was trimmed from the scheduled-reports scope itself, documented above.
