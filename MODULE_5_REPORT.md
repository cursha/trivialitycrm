# Module Five Delivery Report

## Starting point

Modules One through Four (CRM foundation, AI-assisted lead discovery, production hardening, Sales Workspace) were complete, tested, and merged into `main` before this module started, per the approved plan's Step 0. Module Five was built on branch `module-five-reporting`.

## Scope decision made mid-module

The approved plan included a table-driven scheduled-report worker and CRUD UI (§10 of the plan). Partway through implementation, with the 9 report areas, filtering, and exports built but scheduled reports not yet started, the remaining scope was reviewed with the user directly. **The user chose to defer scheduled reports to Module Six** and ship core reporting (all 9 report areas, full filtering, CSV/Excel export, and tests) now. The `ScheduledReport`/`GeneratedReport` schema and the `manage_scheduled_reports` permission are still migrated and seeded — nothing about that decision required rolling back the schema — but no worker handler, tick schedule, or UI was built. See "Known limitations" below.

## Files changed

**New:**
- `prisma/migrations/20260720142234_module_five_reporting/` — schema migration (see below)
- `REPORT_DEFINITIONS.md` — every report metric's numerator/denominator/date-field/permission-scope/missing-data-handling, plus global rules (timezone, small-sample suppression, archived handling)
- `src/lib/timezone.ts` — `BUSINESS_TIMEZONE` constant and all date-range boundary math (DST-aware, via native `Intl`, no new dependency)
- `src/lib/reports/{scope,filters,metrics,export,date-range-keys}.ts` — report permission scope, validated filter schema, pure rate/duration calculators, export metadata wrapper
- `src/app/(dashboard)/reports/**` — the `/reports` shell (layout, tabs, shared filter bar, shared table/chart UI, export links) and 9 report-area subdirectories (dashboard, pipeline, salespeople, sources, ai-research, competitors, territories, lead-types, trends), each with its own `queries.ts` + `page.tsx`
- `src/app/api/reports/[reportKey]/export/route.ts` — CSV/Excel export for every report area
- 6 new test files (see Tests below)

**Modified:**
- `prisma/schema.prisma`, `prisma/seed.ts` — new models/enums, 7 new permissions and default grants
- `src/lib/companies/activity-log.ts` — `logPipelineChange()` now also writes a `PipelineStageHistory` row (with optional loss-reason capture); new `logInitialPipelineStage()` for creation-time history
- `src/app/(dashboard)/companies/actions.ts`, `.../leads/transfer/actions.ts`, `.../leads/import/actions.ts` — set `Company.source` (+ `importBatchId` for imports) and write the initial stage-history row at each of the three creation paths
- `src/app/(dashboard)/companies/company-form.tsx`, `new/page.tsx`, `[id]/edit/page.tsx` — conditional loss-reason field, shown only when the selected pipeline stage is a Lost-outcome stage
- `src/lib/validation/company.ts` — optional `lossReasonId` field
- `src/lib/nav.ts`, `src/components/dashboard-shell.tsx` — new "Reports" nav item, permission-gated on any of the three `view_*_reports` keys
- `tests/helpers/db.ts` — `TABLES_TO_RESET` includes the 3 new tables
- `tests/helpers/fixtures.ts` — extended `createPipelineStageFixture`/`createCompanyFixture` with `outcomeType`/`source`/`createdAt`/etc., new `createRejectionReasonFixture`, `createPipelineStageHistoryFixture`, `fetchAuthenticatedUser`

## Migration created

`20260720142234_module_five_reporting` — purely additive, no drops:
- New enums: `LeadSource`, `ReportCadence`, `ReportRunStatus`
- `Company.source` (nullable), `Company.importBatchId` (nullable FK to `ImportBatch`)
- New table `PipelineStageHistory` (append-only; `fromStageId` nullable for creation-time rows; optional `lossReasonId` FK reusing the existing `RejectionReason` table)
- New tables `ScheduledReport`, `GeneratedReport` (schema only — no worker/UI yet, see Known limitations)
- New indexes: `PipelineStageHistory(companyId, changedAt)`, `PipelineStageHistory(toStageId)`, `Company(source)`, plus supporting indexes on the two scheduled-report tables

Applied to both the dev and test databases; `npx prisma generate` re-run; `prisma/seed.ts` re-run against dev (30 permissions seeded, up from 23).

## Packages added

None. Timezone math uses Node's built-in `Intl` (Node ≥22.12, already required); charts are hand-rolled CSS (no charting library, matching `BRAND_GUIDE.md`'s no-large-framework rule); exports reuse the existing `exceljs`/CSV utilities.

## Key design decisions

- **No backfill for `PipelineStageHistory`.** The prior audit trail (`Activity` rows of type `PIPELINE_CHANGE`) stores only human-readable stage *names* at the time of the change — names are admin-renameable, so there is no reliable way to map old free-text notes back to a specific stage's identity. Per the brief's explicit instruction not to reconstruct historical timing from unreliable data, the table is populated going forward only, starting at this module's ship date. Early pipeline-timing reports (avg days in stage, stage conversion, stalled leads) will look sparse until real data accumulates — this is flagged everywhere it matters (REPORT_DEFINITIONS.md, in-page "not tracked before Module Five shipped" messaging) rather than hidden.
- **Report scope is a separate permission tier from lead-edit visibility.** `reportScope()` (`src/lib/reports/scope.ts`) mirrors `companyScope()`'s three-tier shape (own/team/all, with the same "unassigned companies visible to Team scope" rule) but is keyed on `view_own_reports`/`view_team_reports`/`view_all_reports`, independent of `view_assigned_leads`/etc. A user's report visibility and lead-edit visibility can differ.
- **`LeadSource` as a fixed enum, not an editable lookup table** — sources are a closed, rarely-changing set (unlike admin-editable Lead Types/Pipeline Stages). Reversible later if needed.
- **Timezone via native `Intl`, no library** — `BUSINESS_TIMEZONE = "America/Toronto"` in one file; every date-range boundary (Today/Week/Month/Quarter/Year/Custom) goes through it. Verified DST-correct with unit tests spanning EDT/EST transitions.
- **One shared `ReportFiltersSchema`**, separate from Module Four's `SavedViewFiltersSchema` (company-list filtering) — report filters carry fields (date range, outcome) that don't apply to a company list, and the query code reading each is different. Both are still stored through the same `SavedView.filters` `Json` column; no duplicate storage system.
- **`GeneratedReport.seenByIds` was designed to serve both "in-app notification" and "downloadable report record"** in one model — moot for this module since the worker/UI consuming it wasn't built, but the schema is ready for Module Six.
- **Export routes call the exact same scoped query functions the pages render from** (`src/app/api/reports/[reportKey]/export/route.ts` imports from each area's `queries.ts` directly) — there is no separate, potentially-unscoped export code path. Verified by a test that an "own"-scope user's export contains only their own data.
- **Small-sample rate suppression**: any rate below `MIN_SAMPLE_SIZE_FOR_RATE` (5, in `src/lib/reports/metrics.ts`) renders as "not enough data" with the underlying count, never a bare percentage. A zero-denominator rate is never rendered as 0%.

## Bug found and fixed during this module

**`src/lib/timezone.ts` had a `"server-only"` guard, but its `REPORT_DATE_RANGE_KEYS` constant was imported by a client component** (`report-filter-bar.tsx`), which crashed the dev server with a 500 the moment an authenticated user hit `/reports` — caught via a direct HTTP smoke test with a real session (not just `tsc`, which doesn't understand the server/client boundary). Fixed by extracting the plain constant into a guard-free `src/lib/reports/date-range-keys.ts`, re-exported from `timezone.ts` for server callers.

**Two broken drill-down links**, caught by manually auditing every `href` in `src/app/(dashboard)/reports/**` against the actual query-param support of their target pages: the Territories report linked to `/companies?territoryId=…` (that param is only supported on `/pipeline`, not `/companies`) and the AI Research report and dashboard both linked to a non-existent `/leads/searches` route (the real hub page is `/leads`). Both fixed before this report was written.

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

Enforced server-side in every query function (`reportScope()` returns `null` → page/export renders "no access") and in the export route (`requirePermission(user, "export_reports")`, `requirePermission` inside `getCompetitorsReport`/AI-cost gating). `manage_scheduled_reports` is seeded and assignable but has no UI to gate yet.

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

Every report page has a full filter bar (date range, territory, lead type, pipeline stage, salesperson, source, competitor, status, outcome, trivia status, score range where applicable) and CSV/Excel export links, gated on `export_reports`.

## Tests

360 tests passing (322 pre-existing, unmodified, + 38 new), including:
- `tests/unit/timezone.test.ts` (12 tests) — DST-correct day/week/month/quarter/year boundaries in both EDT and EST, custom-range validation
- `tests/unit/report-metrics.test.ts` (14 tests) — rate suppression at/below the sample-size floor, stage-duration computation from constructed history sequences, stalled-lead threshold logic
- `tests/unit/report-scope.test.ts` (21 tests) — all three permission tiers for every scope helper, including the unassigned-company OR rule and the `canViewUserReport` boundary check
- `tests/integration/pipeline-stage-history.test.ts` (5 tests) — identical-shaped history rows from single-edit, board-quick-change, and bulk stage changes; initial row at company creation; loss-reason capture only on a LOST move
- `tests/integration/lead-source-attribution.test.ts` (2 tests) — `Company.source`/`importBatchId` set correctly on AI transfer and import commit (manual creation covered in the history test above)
- `tests/integration/report-export.test.ts` (5 tests) — `export_reports` permission enforcement, export metadata block, formula-injection neutralization in exported data, cross-user scope isolation (an "own"-scope export contains only that user's data)
- `tests/integration/competitor-territory-reports.test.ts` (5 tests) — `view_competitor_reports` gating, live (never stored) competitor counts, territory specificity matching (city beats region beats country), "not yet researched" honesty for unmatched leads

Every report page was also smoke-tested via direct HTTP requests with a real session across all 9 areas, with a full combination of every filter applied simultaneously — no server errors, confirmed against the dev server log.

## Build result

- `npx prisma format` / `npx prisma validate` — clean
- `npx tsc --noEmit` — clean throughout, re-checked after every batch of changes
- `npx eslint .` — clean (one unused-import warning found and fixed)
- `npm test` — 360/360 passing
- `npx next build` — succeeds; all 9 `/reports/*` routes plus the export API route registered as dynamic server-rendered routes, consistent with the personalized/permission-scoped data they render

## Browser walkthrough

**Not performed as an interactive click-through this session** — no browser automation tool was available (the Chrome extension connection was not completed). In its place, every report page was verified via direct HTTP requests against the real dev server using an authenticated session (server-rendered HTML confirmed present, no 500s, dev server log checked for hidden errors), across default filters and a full combined-filter scenario. This caught two real bugs (see above) that `tsc`/lint/unit tests could not have caught. A manual interactive pass — filter dropdown behavior, CSS-bar rendering, mobile layout, and a CSP console check — is still recommended before considering this module fully verified.

## Remaining limitations / known gaps

- **Scheduled reports are schema-only.** `ScheduledReport`/`GeneratedReport` are migrated and seeded (`manage_scheduled_reports`), but no worker handler, tick schedule, or CRUD UI exists — deferred to Module Six by explicit decision (see "Scope decision" above).
- **No query-performance testing at large volumes.** All correctness tests run against small fixture sets (a handful of rows); the "hundreds of companies" realistic-volume performance check called for in the original plan's test section was not built. Every query is Postgres-side aggregation (count/groupBy/indexed lookups), not app-side full-table scans, but this hasn't been load-tested.
- **AI Research report filters are limited.** A `LeadSearch` doesn't always produce a `Company`, so only the two filters that exist directly on `LeadSearch` (lead type, competitor) are applied there — territory/salesperson/source/score/status/outcome have no meaningful analogue and are silently not applied on that one report (documented in `src/app/(dashboard)/reports/ai-research/queries.ts`).
- **Drill-down links reuse existing pages' snapshot views**, not date-range-aware ones — e.g., the dashboard's "Won (in range)" links to `/pipeline?view=won`, which shows companies *currently* in a Won stage, not specifically those won within the selected date range (that page has no date-range filter to carry the value into). This is an inherent tradeoff of reusing existing pages per the brief's own instruction, not a bug, but worth knowing about.
- **Stage-to-stage conversion is co-occurrence, not strict sequencing** — documented in-page and in `REPORT_DEFINITIONS.md`.

## Module Six recommendations

1. **Build the scheduled-reports worker + UI** on the existing `ScheduledReport`/`GeneratedReport` schema: a fixed hourly pg-boss tick (mirroring the two existing cleanup schedules in `worker/main.ts`), a `singletonKey`-based dedup pattern, and a small CRUD UI plus notification-bell driven by `GeneratedReport.seenByIds`.
2. **Load-test report queries** against a realistic data volume (thousands of companies, tens of thousands of `PipelineStageHistory` rows) and add indexes if `EXPLAIN ANALYZE` shows anything unexpected — particularly the per-company stage-duration computation in the Pipeline report, which loads all in-scope history rows into Node for the average-days-in-stage calculation.
3. **Consider a per-salesperson report detail page** (`/reports/salespeople/[userId]`) — `canViewUserReport()` already exists in `src/lib/reports/scope.ts` for exactly this, unused today since the salespeople report is a single table.
4. **Revisit AI Research report filtering** once/if `LeadSearch` gains a territory-equivalent field, so that report's filter bar can match the others.

## Deviations from the approved plan

- Scheduled reports (plan §10) deferred to Module Six, per an explicit mid-module scope decision with the user — see above. Everything else in the approved plan (schema, shared logic, all 9 report areas, full filtering, exports, tests, quality gates) was built as planned.
