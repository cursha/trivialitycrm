# Module Four Delivery Report

Sales Workspace — implemented on the `module-four-sales-workspace` branch per the approved plan. **Nothing has been committed, pushed, or merged. No Railway resources were touched, no DNS was changed.**

## Starting point

Modules One through Three plus the Mayhem brand redesign existed only on `module-three-production`, unmerged into `main`. Per your explicit instruction, Step 0 of this module was merging `module-three-production` into `main` (clean, no conflicts) and branching `module-four-sales-workspace` from the updated `main`.

The CRM was a record-keeping tool: a searchable company list, a detail page with activity/task/evidence panels, and a basic dashboard of counts. Nothing told a salesperson what to do next, nothing organized leads by territory, there was no way to act on more than one company at a time, and pipeline-stage/reassignment changes required opening the full edit form. Module Four adds all of this by reusing the existing `companyScope()`/`taskScope()` visibility system, the existing `Activity`/`Task` models, and the existing brand UI primitives throughout — no parallel authorization, note-taking, or filtering system was introduced.

## Files changed

**New (representative — see `git status` for the full list):**
- `prisma/migrations/<timestamp>_module_four_sales_workspace/` — schema migration
- `src/lib/dates.ts`, `src/lib/workspace/{priority,territory-match,saved-view-filters}.ts` — shared pure logic
- `src/lib/companies/activity-log.ts` — `logPipelineChange`/`logAssignmentChange`, factored out of the previously-inline pattern
- `src/lib/validation/territory.ts`
- `src/components/ui/menu.tsx` — the one new UI primitive this module needed
- `src/app/(dashboard)/pipeline/**` — board, list view, filter bar, view tabs, bulk toolbar, saved-views panel, queries, actions
- `src/app/(dashboard)/manager/**` — Manager Workspace page + queries
- `src/app/(dashboard)/settings/territories/**` — Territory CRUD page
- `src/app/(dashboard)/companies/bulk-actions.ts`, `companies-table.tsx`
- `src/app/(dashboard)/companies/[id]/quick-actions-bar.tsx`
- `src/app/(dashboard)/dashboard/priority-data.ts`, `priority-list.tsx`
- `src/app/(dashboard)/settings/actions.ts`, `workspace-settings-form.tsx`
- 8 new test files (see Tests below)

**Modified:** `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/companies/scope.ts` (added `canAssignTo`), `src/app/(dashboard)/companies/{actions,queries,page}.tsx`, `src/app/(dashboard)/companies/[id]/page.tsx`, `src/app/(dashboard)/companies/companies-filters.tsx`, `src/app/(dashboard)/dashboard/{page,queries}.tsx`, `src/app/(dashboard)/follow-ups/queries.ts` (archived-company exclusion fix), `src/app/(dashboard)/settings/page.tsx`, `src/app/api/export/companies/route.ts` (added `ids`/`status` params), `src/lib/nav.ts`, `src/components/dashboard-shell.tsx`, `src/lib/validation/company.ts` (optional `assignedToId`), `tests/helpers/db.ts`.

## Migration created

One migration: `assignedToId` on `Company` made nullable (backward-compatible — existing rows keep their value); new `PipelineStageOutcome` enum + `PipelineStage.outcomeType`; `ActivityType` gained `ASSIGNMENT_CHANGE`; new `Territory` model (`@@unique([country, region, city])`); new `SavedView` model + `SavedViewVisibility` enum; new `WorkspaceSettings` single-row table. Applied to both the dev and test databases. `prisma/seed.ts` updated with 4 new permission rows and Administrator/Manager grants, plus `outcomeType: WON/LOST` backfilled onto the seeded "Won"/"Lost" pipeline stages — this surfaced and fixed a real pre-existing seed bug (the `update: {}` clause in `seedPipelineStages` never applied field changes to already-seeded rows on re-run; fixed to sync `outcomeType` specifically, matching the existing pattern for permission labels).

## Packages added

| Package | Why |
|---|---|
| `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | Drag-and-drop for the pipeline board — headless interaction logic only, no styling/components, so it does not conflict with the "no large UI framework" brand rule. React-19-compatible and actively maintained (unlike `react-beautiful-dnd`, which is not). |

`npm audit` reports the same pre-existing moderate findings as Module Three (Prisma's own dev tooling, Next's bundled PostCSS, exceljs's transitive `uuid`) — already investigated and documented as not exploitable. None of `@dnd-kit`'s packages introduced any new finding.

## Key design decisions

- **Territory membership is computed, not stored.** No `territoryId` FK on `Company` — a query helper (`territory-match.ts`) resolves the best-matching active territory from a company's location at read time. This avoids staleness whenever a territory's scope is edited and avoids any mechanism that could silently overwrite `assignedToId`. Overlap is prevented for exact duplicates by a DB unique constraint and resolved for hierarchical overlaps (city vs. region vs. country) by a deterministic most-specific-wins rule.
- **"Set territory" (bulk action) assigns to the territory's owner.** There is no `territoryId` field to "set" on a company (see above), so this bulk action reassigns the selected companies to whichever salesperson/manager owns the target territory, reusing `bulkAssignCompanies`'s permission check, team-boundary check, and audit trail rather than duplicating any of it. Flagging this interpretation explicitly since it's a pragmatic reconciliation of the original wording with the computed-matching design, not a literal field-setting operation.
- **No new `assign_leads` permission.** Assigning a previously-unassigned company and reassigning an already-assigned one are the same operation (`assignedToId` changing) and both reuse the existing `reassign_leads` permission.
- **Won/Lost identification never hardcodes a stage name.** `PipelineStage.outcomeType` (optional `WON`/`LOST`) is the only thing "Won"/"Lost" views and the Manager Workspace's "recently won/lost" panel key off — the pre-existing dashboard's `countForStageName("Won")` string-matching was not extended to any new code.
- **The "What should I do next?" priority order is a pure, unit-tested function** (`src/lib/workspace/priority.ts`), not AI-generated: overdue follow-ups → due today → active trials → newly assigned, not yet contacted → no recent activity → upcoming follow-ups (next 7 days). Thresholds for "newly assigned" and "no recent activity" are configurable from Settings (`WorkspaceSettings`, defaults 3 and 14 days).
- **No true modal/dialog primitive was added.** Bulk-action confirmation is an inline expandable panel (matching the existing duplicate-warning pattern already in `company-form.tsx`), not a new modal component.

## Bug found and fixed: `companyScope()` couldn't see unassigned companies

Testing surfaced a real, pre-existing-shape bug introduced by this module's own schema change. `companyScope()`'s `view_team_leads` branch (Manager-level visibility) was `{ assignedTo: { teamId: user.teamId } }` — a Prisma **relation** filter. A relation filter can never match a row whose foreign key is `null` (there's no related `User` row to check `teamId` against), so once `Company.assignedToId` became nullable for the Unassigned Leads feature, **every unassigned company became invisible to every Manager**, silently breaking the Unassigned Leads view, the Manager Workspace's unassigned count, and the ability to triage/assign the unassigned pool at all — the opposite of "show unassigned leads clearly."

Fixed by explicitly OR-ing in `{ assignedToId: null }` in `src/lib/companies/scope.ts`, so a team-scoped Manager sees their team's assigned companies *and* the unassigned pool (unassigned companies aren't tied to any team, so this is intentionally not further team-restricted — any Manager can see and claim one). `taskScope()` needed no equivalent change since `Task.assignedToId` stayed non-nullable. Caught by a new integration test (`manager-workspace.test.ts`) and covered going forward by a dedicated pure unit test (`tests/unit/company-scope.test.ts`) that asserts the exact WHERE clause for every permission tier.

## Permission matrix

| Permission | Administrator | Manager | Salesperson |
|---|---|---|---|
| `bulk_update_leads` (new) | Yes | Yes | No |
| `manage_territories` (new) | Yes | No | No |
| `create_shared_views` (new) | Yes | Yes | No |
| `view_manager_workspace` (new) | Yes | Yes | No |
| `reassign_leads` (existing, now also used for initial assignment) | Yes | Yes | No |

Everything else (board/work-view visibility, private saved views, quick actions, drag-and-drop) requires only permissions every role already had.

## Pages and routes added or extended

| Route | Status |
|---|---|
| `/pipeline` | New — board (default) + 11 named-view tabs + Saved Views tab |
| `/manager` | New — permission-gated Manager Workspace |
| `/settings/territories` | New — Territory CRUD |
| `/dashboard` | Extended — "What should I do next?" priority list, personal pipeline counts |
| `/companies` | Extended — Archived status filter, bulk-selection + bulk-action toolbar |
| `/companies/[id]` | Extended — Quick Sales Actions bar (stage change + jump-to-panel shortcuts) |
| `/settings` | Extended — Territories card, Sales Workspace threshold settings |

Nav: added **Pipeline** and **Manager Workspace** (permission-gated) as new top-level items. **Leads** (the existing AI-research hub) was left completely untouched — no label was renamed anywhere.

## Tests

New: 4 unit test files (`priority.test.ts`, `territory-match.test.ts`, `saved-view-filters.test.ts`, `company-scope.test.ts` — the last added after the scope bug fix above, to lock in the correct WHERE clause per permission tier) and 6 integration test files (`pipeline-actions.test.ts`, `bulk-actions.test.ts`, `territories.test.ts`, `saved-views.test.ts`, `follow-ups-archived.test.ts`, `manager-workspace.test.ts`) — 69 new tests total, covering stage-change activity logging, the accessible-dropdown/drag-and-drop shared code path, assignment permissions and the team-boundary check, bulk-action transactions and partial-permission scoping, territory uniqueness and specificity matching, saved-view ownership and shared-view permission gating, the archived-company follow-up exclusion fix, and Manager Workspace team isolation (including the corrected unassigned-visibility behavior).

**Full suite result: 296/296 tests passed, 43/43 test files, 0 failures** — every pre-existing test (227) still passes unmodified, plus all 69 new ones. One transient failure was seen mid-development in a pre-existing, untouched Module Three test (`rate-limit.test.ts`'s timing-window test) under heavy concurrent load from running multiple test processes at once; confirmed unrelated to this module and passing cleanly in isolation and in the final clean run.

## Build result

`npm run build` (production, Turbopack) compiles successfully; all 30 routes generated, including the 3 new ones (`/pipeline`, `/manager`, `/settings/territories`). `npx prisma format`/`validate` both clean.

## Browser walkthrough

Same limitation as prior modules: no browser automation tool is available in this environment. What was verified instead against a real running production server: CSP and security headers present and unchanged on `/login` (`Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`), every new/changed route smoke-tested (redirects cleanly to `/login` when unauthenticated with a 307, `/login` itself returns 200, no 500s anywhere), and the full typecheck/lint/test/build pipeline passing. **A manual browser pass through `/pipeline` (drag-and-drop, the mobile stage-switcher, all 12 tabs), `/manager`, `/settings/territories`, and the extended `/dashboard`/`/companies` is recommended before considering this module visually verified** — this is a large new interactive surface (real drag-and-drop, several new forms) that only a real browser session can fully confirm.

## Remaining limitations / known gaps

- `restoreCompany` (the pre-existing single-record action) does not check `companyScope` at all — a role with `restore_archived_leads` could restore any archived company regardless of team. This was discovered during this module's audit but is **existing Module One behavior, not changed here** — flagging for a possible follow-up fix rather than silently altering it outside this module's approved scope. The new `bulkRestore` action, by contrast, is correctly scope-checked.
- The Pipeline board's "days since last activity" and contact-method fields are computed with straightforward, not highly-optimized queries (one related-record fetch per company) — fine at this app's expected scale, worth revisiting if the company count grows large.
- The bulk-action toolbar's "preview" is a plain count-and-confirm, not a detailed per-row preview table — meets the letter of "preview the action before confirming" but could be more informative for a very large selection.

## Module Five recommendations

- Advanced conversion/analytics reporting (explicitly out of scope for Module Four per your brief) — win-rate by territory/salesperson/lead-type, pipeline-stage velocity, AI-lead-to-CRM conversion tracking.
- Consider fixing the `restoreCompany` scope gap noted above.
- Consider a stored `territoryId` on `Company` if computed matching proves too slow or too surprising in practice once real data volume exists — the plan's "Risks and unresolved decisions" section flagged this tradeoff explicitly for future reconsideration.

## Deviations from the approved plan

None substantive — "Set territory" bulk action's interpretation (assign to territory owner, see above) is the one genuine judgment call made during implementation rather than pre-specified in the plan, since the plan's computed-matching decision left "what does 'set territory' mean" slightly open; documented above rather than left implicit.
