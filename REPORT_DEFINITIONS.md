# Report Definitions

This document is the source of truth for every metric shown anywhere under
`/reports`. If a metric appears in the UI, its definition must appear here
first. If a number cannot be defined this precisely from real data, it is
not shown — labeled "not enough data" / "not tracked before [date]" /
"no recorded leads" instead, never estimated or guessed.

Each metric entry states, at minimum:

- **Numerator / Denominator** (or "Count" for a plain count)
- **Included / Excluded** records
- **Date field used** and how the selected date range applies to it
- **Timezone treatment**
- **Permission scope** — which `view_*_reports` tier can see it
- **Archived-record handling**
- **Missing-data handling**

## Global rules (apply to every metric below unless the entry says otherwise)

- **Timezone**: all date-range boundaries (Today/Week/Month/Quarter/Year and
  custom ranges) are computed against `BUSINESS_TIMEZONE` in
  `src/lib/timezone.ts`, currently `America/Toronto`. Business weeks start
  Monday. Changing the business timezone is a one-line change in that file;
  no report query hardcodes a timezone or UTC offset.
- **Archived companies**: excluded from every "current state" metric (active
  leads, current pipeline breakdown, current workload) by default, included
  only in reports explicitly scoped to archived records. This matches the
  rule Module Four established for the board/list views.
- **Small samples**: any rate (win rate, conversion rate, stage-to-stage
  conversion) is suppressed — shown as "not enough data," never a bare
  percentage — when its denominator is below `MIN_SAMPLE_SIZE_FOR_RATE`
  (currently 5, in `src/lib/reports/metrics.ts`). The underlying count is
  always shown alongside any rate that *is* displayed. A zero-denominator
  rate is never rendered as 0%.
- **Permission scope**: every report query calls `reportScope()`
  (`src/lib/reports/scope.ts`), a permission tier independent of a user's
  lead-edit visibility. `view_own_reports` → the user's own
  assigned/created records only. `view_team_reports` → the user's team plus
  currently-unassigned records (mirrors `companyScope`'s team-visibility
  rule). `view_all_reports` → every record. A user with none of the three
  gets no report access. `view_ai_costs` and `view_competitor_reports` are
  additional, separate gates on top of the base scope for those specific
  report sections.
- **Pipeline-stage history**: `PipelineStageHistory` is populated going
  forward only, starting at Module Five's ship date — there is no backfill
  for stage changes that happened before then (the prior audit log stores
  only human-readable stage *names* at the time of change, which are
  admin-renameable and cannot be reliably mapped back to stage identity).
  Any time-in-stage / stage-conversion metric for a company with no history
  rows before the ship date reports "not tracked before [ship date]" for
  the period it lacks data, rather than guessing.

## Report filters

Every `/reports/*` page shares one filter bar (`src/app/(dashboard)/reports/report-filter-bar.tsx`) and one validated schema (`ReportFiltersSchema` in `src/lib/reports/filters.ts`, `.strict()` — an unrecognized key is rejected, not silently ignored). Supported dimensions: date range (+ custom from/to), territory, lead type, pipeline stage, salesperson, source, competitor, score range (min/max), trivia status, active/archived status, and won/lost outcome. Each report page renders only the filters that make sense for it (e.g., the AI Research report only exposes lead type and competitor, since a `LeadSearch` doesn't always correspond to a `Company` — see that section below). Filters are parsed and re-validated server-side on every request (never trusted from the client), and the exact same validated filter object is used by both the on-screen query and the CSV/Excel export for that report, so an export always matches what was on screen. A malformed or tampered filter value degrades to "no filter applied" rather than a thrown error.

---

## Pipeline reporting

Source: `src/app/(dashboard)/reports/pipeline/queries.ts`. Scope = `reportStageHistoryWhere()`/`reportCompanyWhere()`.

- **Current pipeline**: active companies grouped by current `pipelineStageId`. Snapshot, not date-ranged.
- **Entries / exits into stage (in range)**: count of `PipelineStageHistory` rows with `changedAt` in range, grouped by `toStageId` (entries) / `fromStageId` (exits, excludes the null "company just created" case).
- **Average days in stage**: for every company with at least one history row, `computeStageDurations()` turns their chronological rows into per-visit durations (the still-open final stage's duration runs to "now"); averaged per stage across all companies in scope. Not date-ranged — describes the stage itself. Companies with zero history rows (created/last moved before Module Five shipped) contribute nothing and are not estimated.
- **Stalled leads**: active companies whose current stage has `outcomeType = null` and whose most recent history row (matching their current `pipelineStageId`) is older than the workspace's "no activity" threshold (`WorkspaceSettings.noActivityThresholdDays` — reused rather than adding a second threshold setting). Companies whose latest history row doesn't match their current stage (no row recorded for the current stage — pre-Module-Five) are counted separately as "not tracked," never silently folded into "stalled" or "not stalled."
- **Loss reasons (in range)**: `PipelineStageHistory` rows moving into a `LOST`-outcome stage in range, grouped by `lossReasonId` (reusing `RejectionReason`). Rows with no reason recorded show as "Not recorded" — never omitted or guessed.
- **Stage-to-stage conversion**: for each pair of adjacent *active* stages (by `sortOrder`), the share of companies that ever reached the first stage (all-time, in scope) that also ever reached the next. This is co-occurrence, not a guarantee of sequential movement — a stage skipped by an admin correction still counts as "reached both." Suppressed below the minimum sample size like any other rate.
- **New → Won (cohort)**: of companies whose first-ever history row (`fromStageId = null`) falls in the selected range, the share that have reached any `WON`-outcome stage as of now (not constrained to the same range — most deals don't open and close within one short window).
- **Win rate by lead type / source / salesperson (in range)**: among `PipelineStageHistory` rows in range that moved a company into a `WON` or `LOST` stage, WON ÷ (WON+LOST), grouped by the company's current `leadTypeId` / `source` / `assignedToId` at query time (not the value at the time of the stage change, which isn't recorded).

## Salesperson reporting

Source: `src/app/(dashboard)/reports/salespeople/queries.ts`. Rows = salespeople within `reportUserWhere()` scope. Four separate columns, never combined into one ranking score:

- **Activity completed**: count of `Activity` rows where `userId` = this salesperson, `occurredAt` in range.
- **Pipeline progress**: count of `PipelineStageHistory` rows in range on companies *assigned to* this salesperson (`company.assignedToId`) — measures movement on their book of business, not who happened to click the stage-change control (a Manager moving a rep's lead still counts as that rep's progress, not the Manager's).
- **Won / Lost**: `PipelineStageHistory` rows in range moving an assigned company into a `WON`/`LOST` stage.
- **Current workload**: count of currently `ACTIVE` companies assigned to them. Snapshot, not date-ranged.

## Lead source reporting

Source: `src/app/(dashboard)/reports/sources/queries.ts`. `Company.source` is set once at creation by each of the three creation paths (manual add, AI transfer, import commit) and is `null` for every company created before Module Five shipped — shown as its own "Unknown (created before Module Five)" row, never folded into Manual.

- **Leads by source (in range)**: `Company` count grouped by `source`, `createdAt` in range, in scope.
- **Win rate by source (in range)**: among `PipelineStageHistory` rows in range that decided a company (WON or LOST), WON ÷ (WON+LOST), grouped by the company's `source`.

## AI research reporting

Source: `src/app/(dashboard)/reports/ai-research/queries.ts`. Scope applied via the searching user (`LeadSearch.createdBy`), using `reportUserWhere()` — not a company relation, since a search doesn't always produce a company.

- **Searches run / search status**: `LeadSearch` count in range, grouped by `status` (PENDING/RUNNING/SUCCEEDED/FAILED/CANCELLED).
- **Candidates discovered / scored**: `SearchCandidate` count for searches in range; "scored" = `score IS NOT NULL`.
- **Result disposition**: `SearchResult` count grouped by `disposition` (New/Reviewed/Transferred/Rejected/Below minimum score/Duplicate). There is no separate "restored" disposition value in the schema — a restored result returns to New/Reviewed and is indistinguishable after the fact from one that started there, so a "restored" funnel stage is not shown (would require guessing).
- **Estimated AI cost (in range)**: sum of `AiUsageRecord.estimatedCostUsd` for searches in range, gated on the `view_ai_costs` permission — a user without it sees no cost figures at all, not a hidden-but-fetched number. Labeled "ESTIMATE, not a bill" in the UI. Pricing assumptions live in `src/lib/research/providers/pricing.ts` (hardcoded per-token rates, verified against the provider's published pricing page as of 2026-07-18 — see that file's header comment for the re-verification note).

## Competitor reporting

Source: `src/app/(dashboard)/reports/competitors/queries.ts`. Gated on the `view_competitor_reports` permission in addition to base report scope — a user with report access but not this permission sees a plain "you do not have this permission" message, not a hidden/greyed-out page.

- **Linked active leads**: count of active `Company` rows with `competitorId` = this competitor, in scope. Computed live from the relation every time — there is no stored per-competitor counter. The count is a link into `/companies?competitorId=…`, so every total opens its underlying records.
- **Won / Lost (in range)**: `PipelineStageHistory` rows in range moving a company linked to this competitor into a `WON`/`LOST` stage.

## Territory reporting

Source: `src/app/(dashboard)/reports/territories/queries.ts`. Every count is a live match of `Company.{country,region,city}` against `Territory` rows via the existing `matchTerritory()` specificity rule (city beats region beats country) — never a stored per-territory tally, and never double-counted across overlapping territory scopes.

- **Active leads**: companies (in scope) whose best-matching territory is this one. A territory with `0` renders as "No recorded leads," never left implying no prospects exist there — the wording is deliberate per the brief.
- **Won / Lost (in range)**: same stage-history join as other areas, attributed to each company's matched territory.
- **Not yet researched**: active companies in scope whose location doesn't match any configured territory are counted and shown separately, not silently dropped.

## Lead type reporting

Source: `src/app/(dashboard)/reports/lead-types/queries.ts`. Every label comes from the admin-editable `LeadType` table (`prisma.leadType.findMany`) — no lead-type name is ever hardcoded in a report query or page.

- **Active leads by lead type**: snapshot count, grouped by `leadTypeId`, in scope.
- **Win rate by lead type (in range)**: WON ÷ (WON+LOST) among decided leads in range, grouped by `leadTypeId`.

## Time and trend reporting

Source: `src/app/(dashboard)/reports/trends/queries.ts`. Buckets are Monday-start business weeks (`BUSINESS_TIMEZONE`) spanning the selected range — generated by repeatedly calling `zonedWeekRange()` off the previous bucket's own end boundary, so a DST week (167 or 169 hours, not a flat 168) still lands on the correct Monday. Every week in the range appears as a row, including weeks with no activity (shown as `0`, never omitted — a real zero is not "missing data").

- **New leads / Won / Lost / Activities per week**: counts bucketed by `Company.createdAt` / `PipelineStageHistory.changedAt` (WON, LOST) / `Activity.occurredAt`, all in scope. Rendered as a table (required) with a small supplementary bar per row — never chart-only.

## Dashboard summary metrics

Source: `src/app/(dashboard)/reports/queries.ts` (`getDashboardMetrics`). All metrics below share: permission scope = `reportScope()` tier (own/team/all); archived companies excluded except where noted; date range = the dashboard's Today/Week/Month/Quarter/Year/Custom selector, resolved in `BUSINESS_TIMEZONE`.

| Metric | Numerator / Count | Date field | Notes |
|---|---|---|---|
| New leads | Companies created in range, in scope | `Company.createdAt` | |
| Manual leads | Same, `source = MANUAL` | `Company.createdAt` | Pre-Module-Five companies have `source = null` and are excluded from all three source counts, not silently bucketed into Manual |
| AI-transferred leads | Same, `source = AI_RESEARCH` | `Company.createdAt` | |
| Imported leads | Same, `source = IMPORT` | `Company.createdAt` | |
| Active leads | Companies with `status = ACTIVE`, in scope | snapshot (not date-ranged) | |
| Unassigned leads | Active companies with `assignedToId = null`, in scope | snapshot | Always 0 under "own" scope by construction |
| Archived (in range) | Companies archived in range, in scope | `Company.archivedAt` | |
| Overdue follow-ups | Open tasks with `dueAt` in the past, active company, in scope | snapshot | |
| Follow-ups created | Tasks created in range, in scope | `Task.createdAt` | |
| Activities completed | Activity rows in range, in scope | `Activity.occurredAt` | Includes system-logged rows (PIPELINE_CHANGE, ASSIGNMENT_CHANGE), not just user-authored notes |
| No recent activity | Active companies, in scope, whose latest Activity (or `createdAt` if none) is older than the workspace's "no activity" threshold | snapshot | Threshold from `WorkspaceSettings.noActivityThresholdDays`, same setting the dashboard/manager-workspace priority list already uses |
| Active trials | Active companies, in scope, current stage `outcomeType = null`, whose single most recent Activity is type `TRIAL` | snapshot | Looser than the priority list's identical-sounding rule only in that it doesn't also require "no open task" — this is a reporting count, not a to-do list |
| Won (in range) | PipelineStageHistory rows in range where the target stage's `outcomeType = WON`, in scope | `PipelineStageHistory.changedAt` | Zero for any period before Module Five shipped — no backfill (see Global rules) |
| Lost (in range) | Same, `outcomeType = LOST` | `PipelineStageHistory.changedAt` | Same no-backfill caveat |
| Competitor-linked leads | Active companies with `competitorId` set, in scope | snapshot | |
| AI searches run (in range) | LeadSearch rows created in range by a user within scope | `LeadSearch.createdAt` | Scope applied via the searching user, not a company relation |
| AI candidates discovered (in range) | SearchResult rows whose parent search was created in range, scoped to the search's creator | `LeadSearch.createdAt` | |
| Current pipeline (breakdown) | Active companies grouped by current pipeline stage, in scope | snapshot | Grouped by `pipelineStageId`, never by stage name |

**Missing-data handling**: every count is a real Postgres aggregate; an empty scope/period renders as `0`, never blank or omitted.
