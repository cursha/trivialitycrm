# Module Two Delivery Report

AI-Assisted Lead Discovery, Scoring, Review, and CRM Transfer — implemented on the `module-two-ai-leads` branch per the approved plan (`splendid-conjuring-rabbit.md`). **Nothing has been committed, pushed, or merged.** Module Three has not been started.

## Starting point

Module One's schema already contained `PromptTemplate`, `LeadSearch`, `SearchResult`, `RejectionReason`, `ImportTemplate`, `EvidenceRecord`, `HistoricalScoreRecord`, `Competitor`, and the `TriviaStatus`/`SearchResultDisposition` enums — built in anticipation of this module, but with **no application code** and not even present in `tests/helpers/db.ts`'s truncate list. Module Two is almost entirely an application-layer build on top of that foundation, plus the specific schema gaps found by mapping the 13 requirements against what already existed.

## Files changed

**Modified:**
- `prisma/schema.prisma` — job-tracking, evidence, and trivia/competitor fields (see Migrations below)
- `prisma/seed.ts` — four new permissions (`run_research`, `review_research_results`, `transfer_leads`, `view_evidence`)
- `src/lib/duplicates/match.ts` — added `findPriorRejectedMatches` (cross-search rejection memory), reusing the existing `computeNormalizedFields`
- `src/lib/nav.ts`, `src/components/dashboard-shell.tsx` — new "Leads" nav item
- `src/app/(dashboard)/companies/page.tsx` — added an Export CSV link
- `src/app/(dashboard)/settings/page.tsx` — added Rejection Reasons and Import Mapping Templates cards
- `tests/helpers/db.ts` — added `SearchResult`, `LeadSearch`, `PromptTemplate`, `ImportTemplate` to the test-database truncate list (a latent gap — these tables existed but nothing reset them between tests)
- `tests/helpers/fixtures.ts` — new fixtures for the above models
- `.env.example`, `.env` — `AI_PROVIDER` default changed from the Module-One placeholder `"openai"` to `"mock"`; removed the unused `SEARCH_PROVIDER`/`SEARCH_API_KEY` placeholders (no separate search provider is used — see Provider architecture)
- `README.md` — Module Two section, updated permissions and provider setup docs

**New:**
- `src/lib/research/providers/` — `types.ts` (interfaces), `mock.ts`, `anthropic.ts`, `factory.ts`, `http.ts` (rate limit/timeout wrapper)
- `src/lib/research/run-search.ts`, `src/lib/research/exclusivity.ts`
- `src/lib/import/parse.ts`, `src/lib/import/preview-store.ts`
- `src/lib/export/serialize.ts`
- `src/lib/validation/prompt.ts`, `search.ts`, `transfer.ts`, `import.ts`
- `src/instrumentation.ts` — stale-job sweep on process boot
- `src/app/(dashboard)/leads/**` — prompts, searches (setup/status/results), transfer, import (+ saved templates) pages and actions
- `src/app/(dashboard)/settings/rejection-reasons/**`
- `src/app/api/searches/[id]/status/route.ts`, `src/app/api/export/search-results/route.ts`, `src/app/api/export/companies/route.ts`
- 13 new test files under `tests/unit/` and `tests/integration/`

## Migrations created

One migration, applied to both the dev and test databases:

1. `20260718112848_module_two_job_tracking_and_evidence` — `PromptTemplate.archived`; `LeadSearch` job-status fields (`status`, `mode`, `startedAt`, `completedAt`, `heartbeatAt`, `errorMessage`, `candidatesFound`) plus the `SearchJobStatus`/`LeadSearchMode` enums; `SearchResult` trivia/competitor/normalized-match fields (`triviaStatus`, `competitorId`, `normalizedName`, `normalizedPhone`, `normalizedEmail`, `websiteDomain`) plus indexes; `ImportTemplate.createdById`; `ActivityType.LEAD_TRANSFERRED`.

## Packages added

| Package | Why |
|---|---|
| `@anthropic-ai/sdk` | Live research provider (Claude, with server-side web search/fetch tools) |
| `exceljs` | `.xlsx` read (import) and write (export). Chosen over `xlsx`/SheetJS specifically to avoid that package's history of prototype-pollution CVEs. |
| `papaparse` (+ `@types/papaparse`) | `.csv` parsing |

**Dependency audit note:** `npm audit` flags `uuid@8.3.2` (a transitive dependency of `exceljs`) under a moderate advisory (missing buffer-bounds check when a caller supplies `buf`). Checked the actual call site (`exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`) — it calls `uuidv4()` with no arguments, which is not the vulnerable pattern (the advisory requires the caller to pass its own buffer). Not exploitable through our usage; not fixed, since the only fix path is downgrading `exceljs` to 3.x. The two other `npm audit` findings (`@hono/node-server`, `postcss`) are pre-existing, inside Prisma's and Next's own dev tooling, unrelated to this module.

## Provider architecture

Per requirement 12, no provider was assumed without presenting options:

| Option | Cost | Legal/ToS | Verdict |
|---|---|---|---|
| **Anthropic Claude (Sonnet 5) + server-side web search/fetch** | $3/$15 per MTok ($2/$10 intro through 2026-08-31); web-search tool has its own small per-call charge — verify current rate at platform.claude.com/pricing before enabling in production | Stores only extracted facts + source URL + a short note, not bulk page content | **Built as the live default.** One provider covers discovery, evidence-gathering, and citations without a separate paid Maps/SERP dependency. |
| OpenAI (GPT-4.1/5 family) | Was the Module-One placeholder | — | Documented as an implementable alternative behind the same `ResearchProviders` interface; not built in this pass. |
| Google Places API (Text Search) | Verified: ~$32/1,000 for the first 100K Pro-tier calls, more with rating/review fields | Standard Maps Platform ToS | Not used — expensive per-record for bulk discovery. |
| Yelp Fusion API | Free to 150K calls/month | **Verified: Yelp's API Terms forbid caching/storing content longer than 24 hours** | **Excluded** — directly conflicts with requirement 5's permanent evidence storage. |
| Mock/demo provider | Free | N/A | Built alongside the real provider; used for all local dev without keys and for **every** automated test. |

`AI_PROVIDER` selects the implementation (`src/lib/research/providers/factory.ts`); an unrecognized value throws rather than silently falling back to a different provider (or none). All credentials are read only inside `server-only`-guarded provider files.

## Background jobs

Single-process design (`after()` + `LeadSearch.status`/`heartbeatAt` polling, no queue), matching the confirmed self-hosted single-instance deployment (`docker-compose.yml` is Postgres-only; the app runs as one long-lived `next start` process). `src/instrumentation.ts` sweeps any job left `RUNNING` after a restart and marks it `FAILED`. **Documented limitation:** this does not coordinate across multiple app instances — a future horizontally-scaled deployment would need a real job queue or `SELECT ... FOR UPDATE SKIP LOCKED` claiming.

## Spreadsheet import structure (requirement 9)

v1 supports one company + at most one contact per row. Multiple contacts per company are supported by letting the same company appear across multiple rows — the existing duplicate-matching service catches the repeat and attaches the new row's contact to the already-matched company instead of creating a second one. Uploaded files and parsed rows are **never** written to Postgres or disk — they live in an in-memory, TTL'd session store (`src/lib/import/preview-store.ts`) for the length of the upload → map → preview → confirm flow.

## Tests run and results

`npm test` (Vitest, against the isolated test database):

```
Test Files  19 passed (19)
     Tests  124 passed (124)
```

All 65 Module One tests still pass unchanged. The 59 new tests cover: provider factory/mock behavior, trivia-mode exclusivity (pure unit tests), spreadsheet parsing (CSV and a real round-tripped `.xlsx` workbook) and row-mapping validation, CSV/XLSX export serialization, permission gating on every new action, prompt CRUD/archive/duplicate/AI-assist, end-to-end mock-driven search runs (geographic scoping, minimum-score disposition, competitor linking, trivia-mode exclusivity enforcement, provider-failure handling), rejection memory (cross-search matching, auto-suppression, authorized restore), results review actions, transactional bulk transfer (including a deliberate rollback-on-partial-failure test proving no companies/contacts/activities are left behind when a transfer fails partway through), spreadsheet import preview/commit/dedup-to-existing-company, and export filtering/permission/scope enforcement.

No automated test makes a real provider call — `.env.test` forces `AI_PROVIDER="mock"` regardless of `.env`.

## Build result

- `npx prisma format && npx prisma validate` — clean
- `npx prisma migrate status` — up to date (dev and test databases)
- `npx prisma db seed` run twice consecutively — idempotent (identical counts both times: 19 permissions, 3 roles, 7 pipeline stages, 6 rejection reasons)
- `npm run lint` — clean, no warnings
- `npx tsc --noEmit` — clean
- `npm run build` — clean production build; every protected route (including all new `/leads/**` and `/api/**` routes) renders dynamically, confirming `requireUser()`/`requirePermission()` gating is active

## Remaining installation requirements

1. **A real login/click-through smoke test in a browser.** As with Module One, every server action and route handler was exercised through the Vitest integration suite against a real database, but no browser tool was available to click through the actual prompt/search/results/transfer/import UI. To do this yourself: `npm run dev`, sign in, create a Lead Type and a prompt, run a search (it will use the mock provider unless `AI_API_KEY`/`AI_PROVIDER=anthropic` is set), and walk through review → transfer and the spreadsheet import flow.
2. To use live AI research instead of the mock provider: set `AI_PROVIDER="anthropic"` and `AI_API_KEY` in your `.env`. The Anthropic provider (`src/lib/research/providers/anthropic.ts`) has not been exercised against the live API in this environment — verify it with a small real search before relying on it in production.
3. No permissions beyond Administrator were granted the four new Module Two permissions by default — assign `run_research`/`review_research_results`/`transfer_leads`/`view_evidence` to Manager/Salesperson roles from Settings → Roles & Permissions as appropriate for your team.

## Deviations from the approved plan

- Changed `.env.example`'s `AI_PROVIDER` default from Module One's `"openai"` placeholder to `"mock"` (a safe out-of-the-box default, since no OpenAI provider was built) — flagged explicitly in the approved plan as a proposed deviation.
- Removed the `SEARCH_PROVIDER`/`SEARCH_API_KEY` placeholders — unused, since the chosen Anthropic provider's built-in web search/fetch tools removed the need for a separate search/Maps API.
- Everything else matches the approved plan; no changes to the provider interface design, background-job approach, or spreadsheet-import structure as approved.
