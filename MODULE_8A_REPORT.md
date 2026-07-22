# Module 8A Delivery Report

Essential Version 1 Administration — implemented on branch `module-eight-v1-admin`, following the approved phased plan (`reactive-questing-spring.md`) presented and confirmed before any code was written. **Nothing has been committed, pushed, merged, or deployed. No Railway resources were touched.** Modules One through Seven remain untouched in substance — every change to their existing files is additive or a targeted, deliberate fix, never a rewrite.

## Startup verification

Before any edit: confirmed the branch was `module-eight-v1-admin`, the working tree was clean, and Module Seven was present (`git log`, `MODULE_7_REPORT.md` on disk). Read the README, all seven prior module reports, the full Prisma schema, the migration history, the existing `/settings/users` and `/settings/roles` pages and their actions, the permission-enforcement code, Module Seven's `DataQualityAuditEvent` (the only existing audit-log precedent), the worker and job-queue code, and the relevant test files — before designing anything, per the module's explicit startup rules.

## Purpose and scope

Only what a safe V1 launch needs. Explicitly deferred (per the brief, and confirmed again here): custom fields, a full notification centre, an advanced retention-policy editor, a large feature-flag system, calendar integrations, webhooks, accounting integrations, arbitrary provider integrations, multi-tenancy, and full Module Eight configuration consolidation.

## Features delivered

- **Administration home** (`/administration`, `view_administration`): links to every section below the current user has permission for (hidden, not just disabled, when absent), plus safe summary cards — active/inactive user counts, role count, the last 5 audit events (human-readable), failed/retrying job counts, and AI provider mode + budget status. Nothing here ever renders a credential, connection string, raw job payload, or stack trace.
- **Organization Settings** (`/administration/organization`, `manage_organization_settings`): one singleton record (name, default country/region/timezone/currency/date format, default pipeline stage/lead type, business phone/email/website/address). Every field is validated server-side (including a real IANA-timezone check via `Intl.DateTimeFormat`, the same technique Module Six's appointment timezone field already uses); every change is recorded with actor, timestamp, and full before/after values in the new audit log. No multi-tenancy, no domain/DNS management.
- **User safety and account administration** (extends the existing `/settings/users`, `manage_users`): search/filter by name, email, role, and status; last-login and lockout visibility; a dedicated **unlock account** action; a dedicated **revoke all sessions** action (the underlying `invalidateAllSessionsForUser()` already existed from Module One — this is the first time it's exposed as its own explicit admin action); a transactional **ownership-transfer** tool (active companies + open tasks) with a live before-transfer summary, surfaced directly in the same panel where deactivation happens. The final active Administrator can never be demoted or deactivated by anyone — including themselves — and a blocked attempt is still recorded in the audit log with `success: false`.
- **Roles and Permissions** (extends the existing `/settings/roles`, now gated by a new `manage_roles` permission instead of `manage_users`): permissions grouped by module (Leads & Companies, Sales Workspace, Reporting, Communications, Data Quality, Administration) with a real, specific one-line description for all 57 permission keys; a per-role active-user count with a confirmation warning before changing a permission on a role with active users; an effective-permissions preview per role; a **duplicate-role** function (copies a role's full grant set — `createRole` previously always started from zero grants); and a guard preventing the Administrator role's own `manage_users`/`manage_roles` grants from ever being revoked while no other active role would still grant them.
- **AI Settings and budget controls** (`/administration/ai-settings`, `manage_ai_settings`): research enabled/disabled, an approved-model allowlist (real and enforced — `src/lib/research/providers/anthropic.ts` now reads it instead of a hardcoded constant), default minimum lead score, max cities/results per search, daily/monthly/warning budget thresholds, and an optional per-user daily search limit. Provider mode and API-key-configured status are shown read-only, clearly labeled ("Mock — test data only" vs. "Anthropic — live"), never editable here and never exposing the raw key. **Budget enforcement genuinely did not exist before this module** — `AI_DAILY_BUDGET_USD`/`AI_MONTHLY_BUDGET_USD` were declared and Zod-validated since Module Three but never read by any code path; `startSearch()` now calls `checkAiBudget()` before creating a new `LeadSearch`, refusing the request with a clear message once a configured hard budget is met — mock mode is never blocked.
- **Audit Log viewer** (`/administration/audit-log`, `view_audit_log`/`export_audit_log`): filterable by date range, actor, module, action, entity type/id, success/failure, and correlation id; human-readable one-line summaries; a redacted before/after diff view; a rate-limited (one per user per 5 minutes), redacted, 5,000-row-capped CSV export reusing the existing formula-injection-safe `buildCsv()` utility. No update or delete action exists for the audit model anywhere in the codebase.
- **System Health** (`/administration/system-health`, `view_system_health`/`manage_background_jobs`): web/database/worker/migration status, a genuine worker heartbeat, per-queue job totals (created/retry/active/completed/cancelled/failed), a failed-jobs list with idempotent retry/cancel, scheduled-cleanup visibility, app version, and AI/email provider configuration status (including a live connected-mailbox count). Retry and cancel are rate-limited, permission-gated, and audited.

## Existing features reused (not duplicated)

- **Session revocation**: `invalidateAllSessionsForUser()` (Module One) — now also exposed as its own admin action, not reimplemented.
- **Rate limiting**: `checkRateLimit()` (Module Three) — reused for AI-search-per-user limits, audit export, and job retry/cancel.
- **Validation conventions**: named Zod schemas under `src/lib/validation/`, the exact `optionalText()`/form-error-surfacing idiom every prior module uses.
- **Export**: `buildCsv()` (Module Five) — reused as-is for the audit CSV export, not reimplemented.
- **Timezone math**: `zonedDayRange()`/`zonedMonthRange()` (Module Five) — reused for "today"/"this month" AI spend boundaries, the same business-timezone convention every other report already uses.
- **Worker/job patterns**: the exact `createQueue`/`boss.schedule`/`boss.work` tick idiom (7 prior examples) for the new heartbeat tick; pg-boss's own `retry()`/`cancel()` client methods (verified against the installed package's actual source before use, not assumed) rather than hand-rolled job-state mutation.
- **Provider pattern precedent**: the AI-settings/budget module follows the same "singleton settings row, upsert by id 1" idiom `WorkspaceSettings` already established — no new pattern invented.
- **Formula-injection-safe export, brand primitives, permission enforcement (`requireUser`/`requirePermission`)**: all reused exactly as-is throughout every new page and action.

## Architectural conflicts and decisions (confirmed before/while writing code)

1. **Audit log design** (confirmed with the user): a **new, dedicated `AuditEvent` model** — genuinely generic (`entityType`/`entityId` strings, an open `action` string, not a closed enum) — rather than generalizing Module Seven's `DataQualityAuditEvent`, which has real FKs into `Company`/`Contact` and a fixed 18-value enum baked into ~10 already-shipped call sites. `DataQualityAuditEvent` is completely untouched by this module.
2. **`/settings/roles` regated from `manage_users` to a new `manage_roles`.** A real, intentional tightening — role/permission editing is more sensitive than day-to-day user administration. Administrator holds both by default; a team that had granted only `manage_users` to a Manager no longer gets role-editing access as a side effect.
3. **`AI_DAILY_BUDGET_USD`/`AI_MONTHLY_BUDGET_USD` env vars become seed-only.** The new DB-backed `AiSettings` row is the runtime source of truth; the env vars, if set, only seed its initial value the first time `prisma db seed` runs against a fresh database.
4. **"Approved model selection" has exactly one real option today** (`claude-sonnet-5`) because that's the only model `src/lib/research/providers/pricing.ts` can actually price. The setting is real and enforced (`anthropic.ts` reads it), not decorative — the schema and UI are ready for more entries without another migration.
5. **"Company, contact, lead, and task ownership" transfer** concretely means `Company.assignedToId` (which carries every contact on that company along with it — `Contact` has no independent owner field) and `Task.assignedToId`. "Lead" and "company" are the same underlying model in this schema (no separate Lead entity survives past Module Two). ~10 other "created by"-style `User` relations (searches, templates, reports, etc.) are provenance, not active ownership, and are deliberately left pointing at a deactivated user, exactly like every other historical record in this app.
6. **Deactivation is never hard-blocked by outstanding ownership.** The UI surfaces live counts and the transfer tool right there; a hard gate risked an unrecoverable dead end if no eligible transfer target exists yet on a small team.
7. **A genuine worker heartbeat was added** (`WorkerHeartbeat`, a new 2-minute tick) rather than inferring liveness from indirect job activity — confirmed no code read pg-boss's internal tables before this module.
8. **"Migration readiness" is a cheap, safe query** against Prisma's own `_prisma_migrations` table (`finished_at IS NULL` means incomplete/failed) rather than shelling out to the Prisma CLI per page load — that pattern already exists once, at worker startup, and isn't safe to repeat per HTTP request.

## Real bug found and fixed during verification (not assumed away)

`npx next build` failed with `Module not found: Can't resolve 'fs'/'net'/'tls'` — the client component `ai-settings-form.tsx` imported `APPROVED_MODEL_OPTIONS` from `src/lib/ai/budget.ts`, which also contains Prisma-touching code with **no** `import "server-only"` guard (deliberately, since `anthropic.ts` needs `getAiSettings()` from inside the worker). With nothing stopping the client bundler, it tried to pull `pg`/Node built-ins into the browser bundle. Fixed by extracting the pure constant into its own file, `src/lib/ai/models.ts`, and repointing every client-reachable import (the form component and the Zod validation schema) at it directly — `budget.ts` keeps a re-export for other server-only consumers. Caught by actually running the production build, not assumed safe.

## Database additions

Migration `20260722150443_module_eight_a_administration` — purely additive, applied to both dev and test databases:

- **`AuditEvent`** (new) — the generic cross-module audit log (see "Architectural conflicts" #1). `actorId` (FK→User, SetNull), `module`, `action`, `entityType?`, `entityId?`, `success` (default true), `correlationId?` (shared across multi-row operations like ownership transfer), `beforeData`/`afterData`/`metadata` (Json), `occurredAt`. Indexed on `occurredAt`, `actorId`, `[module, action]`, `[entityType, entityId]`, `correlationId`, `success`.
- **`OrganizationSettings`** (new singleton, `id Int @id @default(1)`) — org identity/locale-default fields, `defaultPipelineStageId?`/`defaultLeadTypeId?` (FKs, SetNull), business contact fields, `updatedAt`/`updatedById` (FK→User, SetNull).
- **`AiSettings`** (new singleton, same idiom) — `researchEnabled`, `approvedModel`, `defaultMinimumScore`, `maxCitiesPerSearch`, `maxResultsPerSearch?`, `dailyBudgetUsd?`/`monthlyBudgetUsd?`/`warningThresholdUsd?` (`Decimal?`), `perUserDailySearchLimit?`, `updatedAt`/`updatedById`.
- **`WorkerHeartbeat`** (new singleton, `id Int @id @default(1)`) — `updatedAt` only, touched by the new tick.
- **`User`** gains `lastLoginAt DateTime?`, set by `recordSuccessfulLogin()`.
- **`Permission`** gains `category String?` and `description String?` — backfilled for all 57 permission keys (49 pre-existing + 8 new) in `prisma/seed.ts`, synced on every re-run.

## Permissions

8 new keys (a 9th, `manage_users`, already existed from Module One): `view_administration`, `manage_organization_settings`, `manage_roles`, `manage_ai_settings`, `view_audit_log`, `export_audit_log`, `view_system_health`, `manage_background_jobs`. All seeded Administrator-only by default (Manager/Salesperson get none automatically), matching Module Seven's precedent. Every page, server action, and query enforces its permission server-side via `requireUser()` + `requirePermission()` — hiding a nav link or a button is never the only protection.

## Security protections

- **Server-side validation everywhere**: Zod schemas for organization settings, AI settings; no client-trusted input reaches a database write unvalidated.
- **ID tampering / mass assignment**: every action re-fetches by id and writes only an explicit field set — no raw client object is ever spread into a Prisma write.
- **Rate limiting**: AI-search-per-user limit (when configured), audit export (1/5min), job retry/cancel (20/min) — all via the existing `checkRateLimit`.
- **Audit coverage**: every user/role/organization/AI-settings mutation, every ownership transfer, every job retry/cancel, and every audit export is recorded — successes and blocked attempts alike.
- **Redaction**: `src/lib/audit/redact.ts` strips password/hash/token/API-key/secret/connection-string/cookie/authorization-shaped keys from every before/after/metadata blob before it's ever rendered or exported — one function, used by both paths, so redaction can't be forgotten in one but not the other.
- **CSP, authentication, consent/suppression, and session protections**: untouched. No new external resource, no new script source — every new page uses the existing `'self'`-scoped headers.
- **No environment-variable editor, no arbitrary SQL/script/formula/HTML execution, no permanent-delete for users or audit records** — none of these exist anywhere in the new code, by design.
- **The Anthropic API key is never stored, logged, or rendered** — `isAiApiKeyConfigured()` is the one sanctioned way any UI-facing code may ever ask about it; it returns a boolean only.

## Tests and verification

**69 new tests across 18 new files.** Full suite: **737/737 passing** (668 baseline + 69 new), zero regressions to Modules 1–7.

Unit (`tests/unit/`): `redact.test.ts` (5 — nested/array redaction, case-insensitivity, non-sensitive values untouched), `describe-audit-event.test.ts` (4 — including the exact module/action-concatenation bug this test caught and the subsequent fix), `ai-budget.test.ts` (6 — pure `evaluateAiBudget()` threshold math, mock always allowed, null budget = unlimited).

Integration (`tests/integration/`): `organization-settings.test.ts` (5), `final-administrator-protection.test.ts` (4 — role-change block, deactivation block by a different actor with `manage_users`, self-deactivation block, audited-when-blocked), `account-unlock.test.ts` (2), `session-revocation.test.ts` (2), `ownership-transfer.test.ts` (6 — transactional reassignment, excludes archived companies/completed tasks, rejects a disabled target, rejects self-transfer, live summary), `roles-management.test.ts` (5 — regate enforcement, duplicate-role, essential-capability guard both directions), `ai-settings.test.ts` (7 — model allowlist, city-cap validation, mock-mode-needs-no-key, anthropic-mode-requires-a-key via `getEnv()` itself refusing to boot, key-value-never-exposed), `ai-budget-enforcement.test.ts` (5 — mock never blocked, daily cap, monthly cap, research-disabled block, city-limit rejection, exercised through the real `startSearch()` action), `audit-redaction-and-export.test.ts` (5 — permission gate, actual redaction in exported CSV, rate limiting, module filtering, self-referential export logging), `system-health-authorization.test.ts` (5 — permission gate, no raw payload/stack anywhere in the returned shape, honest "unknown" worker status with no heartbeat, real DB connectivity, graceful handling when pg-boss's schema has no data), `job-retry-cancel.test.ts` (5 — real pg-boss mechanics: a genuinely failed job is retried, an ineligible retry/cancel is a safe idempotent no-op, both audited), `administration-permissions.test.ts` (3 — `view_administration`/`view_audit_log` independence from their sibling `manage_*`/`export_*` permissions).

Seed idempotency: `npx prisma db seed` run twice consecutively — identical counts both times (57 permissions, one `OrganizationSettings` row, one `AiSettings` row) — verified manually rather than in an automated test, matching every prior module's own verification convention for the seed script itself.

## Build result

- `npx prisma format` / `npx prisma validate` — clean
- Migrations applied to dev and test databases — clean
- `npx prisma generate` — clean
- `npx prisma db seed` run twice consecutively — idempotent
- `npm run lint` — clean, no warnings
- `npx tsc --noEmit` — clean
- `npm test` — **737/737 passing**, 105 test files
- `npx next build` — clean after the client-bundle fix described above; all 5 new `/administration*` routes registered as dynamic (server-rendered, confirming `requireUser()` actually gates them)
- `npm audit` — identical to the pre-existing baseline (Prisma dev tooling, Next's bundled PostCSS/sharp, exceljs's transitive uuid); zero new packages added, zero new findings
- `npm run worker` — reached "database schema is up to date," loaded every handler including the new `worker-heartbeat-tick`, then hit the same pre-existing local port-8080 conflict every prior module's report also notes
- `git status` — nothing committed; branch `module-eight-v1-admin`, 45 files changed/added, all unstaged

## Manual browser/HTTP walkthrough

No browser automation tool is available in this environment, matching every prior module's report. A real production server was started and smoke-tested directly instead. **One unrelated, pre-existing local-environment gap was found and worked around, not silently ignored**: this machine's `.env` has never had `TOKEN_ENCRYPTION_KEY`/`UNSUBSCRIBE_TOKEN_SECRET` set (both required by `env.ts` since Module Six once `NODE_ENV=production`, which `next start` always sets) — unrelated to any Module 8A code. Supplied as throwaway, process-scoped values for this one verification run only (never written to any file, never logged, discarded when the process exited) rather than editing `.env` or generating real credentials on the user's behalf.

With that resolved: every new route (`/administration`, `/administration/organization`, `/administration/ai-settings`, `/administration/audit-log`, `/administration/system-health`, plus the now-regated `/settings/users`, `/settings/roles`) returned a clean 307 redirect to `/login` when unauthenticated, `/login` itself returned 200, `/api/health` returned 200, no route returned a 500, and CSP/HSTS/security headers were present and unchanged.

**A manual click-through as an authenticated Administrator is still owed** — creating an organization settings record, unlocking a locked account, transferring ownership between two real users, duplicating a role, watching an AI search get refused once a budget is set to $0, filtering/exporting the audit log, and retrying a real failed job have only been exercised through the integration test suite (which drives the real server actions and, for job retry/cancel, real pg-boss mechanics against a real database) — not through an actual browser session.

## Deferred (full Module Eight, not built here)

Custom fields, a full notification centre, an advanced retention-policy editor, a large feature-flag system, calendar integrations, webhooks, accounting integrations, arbitrary provider integrations, multi-tenancy, and full Module Eight configuration consolidation — all explicitly out of scope for this "essential V1" module, per the brief.

## Known limitations

- **`defaultDateFormat` is stored and validated but not yet applied** to how dates render elsewhere in the app — wiring every date display to this setting would be a much larger, riskier change than "V1 essential" scope justifies; documented rather than silently half-done.
- **No per-session (only per-user, all-sessions) revocation** — the `Session` model carries no device/IP/user-agent metadata to distinguish one session from another; "revoke all sessions for a user" (the spec's literal ask) is fully implemented, a more granular per-device view is a natural follow-up.
- **The approved-model allowlist has exactly one entry.** Real and enforced, but not yet meaningfully "a choice" until a second model is added to both the allowlist and `pricing.ts`'s cost table.
- **"Migration readiness" checks for incomplete/failed migration rows, not full schema drift** — a deliberate, documented scope (see Architectural conflicts #8), not a gap that was missed.
- **The worker heartbeat is new** — a database that has never run the worker at all shows "no data yet," honestly, rather than guessing.
- **No automated seed-idempotency test** — verified manually (twice, identical output) rather than scripted, consistent with how every prior module's own seed script has been verified.
