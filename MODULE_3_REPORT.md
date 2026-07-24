# Module Three Delivery Report

Production Hardening & Railway Deployment — implemented on the `module-three-production` branch per the approved plan. **Nothing has been committed, pushed, or merged. No Railway resources were created, no DNS was changed, no live Anthropic calls were made.** Module Four has not been started.

## Starting point

Modules One and Two were built as a single-process, self-hosted design with two explicit, documented durability gaps: the AI research job runner executed inline via Next's `after()` hook in the same process serving the request, and the spreadsheet import preview store was a bare in-memory `Map`. Both were correct tradeoffs for "one long-lived `next start` process on a box you control" and both are wrong on Railway, where deploys restart the process. This module removes every single-process/in-memory assumption, adds the security controls a production CRM needs, and packages the app for Railway — without deploying anything.

The approved plan itself went through one revision before implementation started: the first draft proposed `retryLimit: 0` (manual-only crash recovery), both web and worker containers independently running `prisma migrate deploy`, an unverified "trust X-Forwarded-For" rate-limit design, a 24h import-batch TTL, and a CSP verified only by a unit test. All five were rejected during review and replaced with the idempotent-job design, single-designated-migration-step design, documented trusted-proxy IP design, 4h TTL, and (as detailed below) a CSP that was actually verified by building and running the production container — which is exactly where it turned out the first CSP draft would have broken the app.

## Files changed

**New:**
- `src/lib/env.ts` — zod-validated environment configuration, shared by both entrypoints
- `src/lib/jobs/boss-client.ts`, `src/lib/jobs/enqueue.ts` — pg-boss integration
- `worker/` — `index.ts` (entrypoint, migration gate, graceful shutdown), `handlers/run-search.ts`, `handlers/cleanup.ts`, `shutdown.ts`
- `src/lib/import/batch-store.ts` — replaces `src/lib/import/preview-store.ts` (deleted)
- `src/lib/security/formula-injection.ts`, `src/lib/security/headers.ts`
- `src/lib/rate-limit/client-ip.ts`, `src/lib/rate-limit/postgres-bucket.ts`
- `src/lib/logger.ts`, `src/lib/error-reporting.ts`
- `src/lib/research/providers/pricing.ts` — Anthropic usage-cost estimation
- `src/app/api/health/route.ts`
- `Dockerfile`, `.dockerignore`
- 12 new test files (see Tests below)

**Modified (selected — see `git status` for the full list):** `prisma/schema.prisma`, `next.config.ts`, `src/proxy.ts`, `src/instrumentation.ts`, `src/lib/auth/current-user.ts`, `src/lib/research/run-search.ts` and all of `src/lib/research/providers/*.ts`, `src/lib/export/serialize.ts`, `src/lib/import/parse.ts`, `src/lib/validation/import.ts`, `src/app/login/actions.ts`, `src/app/(dashboard)/leads/searches/actions.ts` and its status UI, `src/app/(dashboard)/leads/import/actions.ts` and its wizard UI, `src/app/(dashboard)/leads/prompts/actions.ts`, `src/app/change-password/*`, `src/app/(dashboard)/layout.tsx`, `.env.example`, `package.json`, `tests/helpers/db.ts`.

## Migrations created

One migration, applied to both the dev and test databases: `20260718182843_module_three_durability` — new models `SearchCandidate` (idempotent-job checkpointing), `ImportBatch` (durable import staging), `AiUsageRecord` (cost tracking), `RateLimitBucket` (durable rate limiting); `LeadSearch.providerJobId`; `SearchResult.candidateId` (unique, nullable).

## Packages added

| Package | Why |
|---|---|
| `pg-boss` | Postgres-native durable job queue — see Architecture below |
| `pino` (+ `pino-pretty`, dev only) | Structured logging with redaction |
| `file-type` | Magic-byte spreadsheet validation |
| `prisma`, `tsx` | Moved from devDependencies to dependencies — both now run in production (the worker's migration-status gate shells out to the Prisma CLI; `tsx` runs the worker itself) |

**Explicitly not added:** any Redis client (pg-boss and rate limiting are both Postgres-backed — no second stateful service), `@sentry/*` (the error-reporting interface is log-only by default and only forwards to Sentry if `SENTRY_DSN` is set *and* the package happens to be installed later — never a forced dependency), `helmet` (Next's own `headers()` covers this app's needs).

**Dependency audit:** `npm audit` reports the same 7 pre-existing moderate findings as Module Two (Prisma's own dev tooling, Next's bundled PostCSS, exceljs's transitive `uuid`) — already investigated and documented as not exploitable in `MODULE_2_REPORT.md`. None of this module's new packages introduced any new finding.

## Architecture: durable jobs

**Queue: pg-boss (Postgres-backed), not Redis.** The app already runs one Postgres instance; a second stateful Redis service isn't justified by this app's job volume (one internal sales team, one job type). pg-boss manages its own `pgboss` Postgres schema, invisible to Prisma (no `multiSchema` preview feature enabled), so it never conflicts with `prisma migrate deploy`.

**Idempotent, resumable jobs — not `retryLimit: 0`.** The rejected first draft avoided duplicate `SearchResult` rows by disabling automatic retries entirely. The shipped design instead makes the job resumable: a new `SearchCandidate` table checkpoints every discovered candidate through `PENDING → VERIFIED → SCORED → COMPLETED`, `SearchResult` rows are `upsert`ed by `candidateId` (never `create`d), and the discovery step (`discover()`, the one truly non-idempotent, non-deterministic external call) only ever runs once per search — a resumed job skips straight to per-candidate processing once `SearchCandidate` rows exist. `pg-boss` is configured with `retryLimit: 3, retryBackoff: true` (bounded exponential backoff). DB-side effects are fully idempotent; provider billing is *bounded* (at most `retryLimit` extra calls in the worst repeated-crash case), not perfectly exactly-once — true exactly-once across a non-idempotent paid API boundary isn't achievable by any design, a constraint stated plainly rather than glossed over. Verified with a test that simulates a crash after candidate 1 of 2 completes and confirms the resumed run produces no duplicate `SearchResult` and never re-verifies candidate 1 (`tests/integration/search-run-resume.test.ts`).

**Migrations — one designated step, not two independent ones.** Verified live against Railway's own docs: Railway's Pre-Deploy Command runs once per service, blocks the start command, but has no cross-service sharing mechanism. The web service's Pre-Deploy Command is `npx prisma migrate deploy` — the only place migrations are applied. The worker never runs `migrate deploy`; instead `worker/index.ts` blocks on `npx prisma migrate status` (exit code 0 = current, verified empirically for this Prisma 7.8.0 build by deliberately creating and then removing an unapplied migration and observing exit codes 0 and 1) in a bounded poll loop before it ever calls `boss.work()`. The worker cannot begin consuming jobs against a schema it hasn't confirmed is current.

**Rate limiting — a documented trusted-proxy design, not a blind header read.** Verified against Railway's own edge-networking behavior (station.railway.com support content, since Railway's primary docs don't cover header handling directly — flagged as the one open item worth a live-header-log check on first real deploy): Railway strips and rebuilds `X-Forwarded-For` at its edge, a client cannot inject a fake leftmost entry, and `X-Real-IP` is Railway's own single-source-of-truth header. `src/lib/rate-limit/client-ip.ts` checks `Cf-Connecting-IP` (for a future Cloudflare-fronted domain) → `X-Real-IP` → leftmost `X-Forwarded-For` → `null` (IP unknown — skip the IP-based check rather than trust an unverifiable value; the existing per-account DB-backed lockout still applies regardless).

## Import batch durability

`src/lib/import/preview-store.ts` (in-memory `Map`) replaced by `src/lib/import/batch-store.ts` (`ImportBatch` table). Default TTL is **4 hours**, not the rejected 24h, via a configurable `IMPORT_BATCH_TTL_HOURS` env var. `payload` (the staged spreadsheet rows) is wiped in two places, both verified by tests: immediately on a successful commit (same transaction as the `Company`/`Contact` writes — `markImported`) and by the worker's cleanup cron for anything nobody ever committed. Stored as plain `Json`, not application-layer encrypted — `Company`/`Contact`, the destination this data becomes seconds later, already store the same PII as plain columns with no app-layer encryption, so encrypting only the staging table would be inconsistent and wouldn't close a distinct attack surface; protection is Postgres TLS in transit, disk encryption at rest, and the existing `uploadedById` ownership check.

**Malicious-file hardening**, verified by tests (`tests/unit/import-parse.test.ts`): magic-byte sniffing via `file-type` rejects a `.csv`-named file containing actual binary content, a `.xlsx`-named file containing plain text, and outright rejects `.xls`/`.xlsm` regardless of content; a 15-second parse timeout guards against a zip-bomb-style malicious workbook; a real bug was found and fixed where an XLSX formula cell serialized to the literal string `"[object Object]"` instead of its computed value. Formula-injection values are *flagged* on import (a warning, surfaced in the import wizard UI) rather than silently blocked or mangled — a business legitimately named "-24 Grill" shouldn't be corrupted; the actual protection is unconditional neutralization at export time.

## Security hardening

- **CSV/Excel formula-injection**: confirmed zero protection existed in `src/lib/export/serialize.ts` before this module. Every exported cell value now passes through `neutralizeForExport` (OWASP guidance — a leading `=+-@`/tab/CR gets a `'` prefix).
- **`mustChangePassword` bypass, fixed**: previously enforced only at the login redirect — a user with an already-valid session cookie could reach any of the ~119 `requireUser()` call sites directly and never complete the forced change. Now enforced inside `requireUser()` itself, with an explicit `allowMustChangePassword` opt-out for the change-password page/action only.
- **Rate limiting**: per-IP login throttling (additive to the existing, unchanged, already-durable per-account lockout) and a Postgres-backed replacement for the AI provider's in-process token bucket (previously explicitly documented as "not a distributed limiter").
- **Security headers**: CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and production-only HSTS via `next.config.ts` `headers()`. `X-Frame-Options` intentionally omitted (superseded by the CSP's `frame-ancestors`).
- **Trusted origin**: `experimental.serverActions.allowedOrigins` set from `APP_URL`'s hostname.
- **`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`** — a genuinely new finding from reading Next's own Server Actions docs (not something the original plan anticipated): self-hosted/multi-instance deployments must pin this to a stable value, or each instance/restart may generate its own closure-encryption key. Added to `src/lib/env.ts` (required once `NODE_ENV=production`) and `.env.example`.
- **A correctness/cost bug in the Anthropic provider**: `callProvider()`'s timeout armed an `AbortController` whose signal was never actually passed into `client().messages.create()` — a timeout threw locally while the real Anthropic request kept running (and being billed) server-side. Fixed by threading `{ signal }` through every call site and setting `maxRetries: 2` explicitly on client construction (the SDK's own default was previously relied on implicitly, contradicting a code comment that claimed no retries occurred).
- **AI cost tracking**: every provider call now writes an `AiUsageRecord` (tokens, server-tool-use counts, an estimated USD cost via a small pricing table verified against `platform.claude.com/pricing` on 2026-07-18). Optional `AI_DAILY_BUDGET_USD`/`AI_MONTHLY_BUDGET_USD` caps.

## Observability

`src/lib/logger.ts` (pino, redacts `passwordHash`/`tokenHash`/`apiKey`/auth headers, structured JSON in production and pretty-printed in dev), wired into both entrypoints. `src/lib/error-reporting.ts` — `captureException()` logs by default; forwards to Sentry only if `SENTRY_DSN` is set *and* `@sentry/node` happens to be installed later (a dynamic, string-built import specifier so the Next build itself doesn't fail over an absent optional package) — verified with a test that this falls back cleanly rather than crashing when the DSN is set but the package isn't installed.

## Deployment packaging — what building and running the actual containers found

The Dockerfile was not just written — it was built and run, twice per fix, against this machine's real dev Postgres, specifically because the earlier plan review's lesson ("verify platform mechanisms via real docs, not assumption") applies just as much to Docker/Next runtime behavior as to Railway's product docs. Six real, non-theoretical bugs were found and fixed this way, none of which would have been caught by code review alone:

1. **`prisma generate` needs `DATABASE_URL` resolvable at build time** (Prisma 7's config loader validates it eagerly, even though `generate` never connects to a live database) — fixed with a placeholder value set only in the `builder` stage, which does not carry into the final `web`/`worker` stages.
2. **Next's `output: "standalone"` pruned trace doesn't reliably include the Prisma CLI** — the CLI is invoked as a subprocess (Railway's Pre-Deploy Command), never imported by app code, so Next's import/require-based file tracing omits it. A surgical copy of just the CLI's files still broke (missing `prisma_schema_build_bg.wasm`, which npm's packaging places somewhere the pruned trace doesn't preserve). Resolved by abandoning `output: "standalone"` for a full-`node_modules` image instead — a deliberate size-for-robustness tradeoff, not an oversight.
3. **`node:22-slim` lacks OpenSSL**, which Prisma's query engine needs to detect the right binary target — it was silently falling back to a guessed version. Fixed by installing `openssl` explicitly in the base stage.
4. **`next start` re-reads `next.config.ts` at runtime, not just at build time** — the image failed with `MODULE_NOT_FOUND` on `next.config.ts`'s import of `./src/lib/security/headers` until `src/` was copied into the final image too.
5. **`/api/health` was being redirected to `/login`** by the existing auth proxy (`src/proxy.ts`), which had no exemption for anything outside `/login` — Railway's health check would never have seen a clean 200. Fixed with an explicit public-prefix exemption, covered by new tests.
6. **`npm`/`npx` as PID 1 does not forward `SIGTERM` reliably** — confirmed with an actual `docker stop`: the worker's graceful-shutdown handler never ran; npm reported "command failed / signal SIGTERM" and killed the process outright. Fixed by invoking the local binaries directly (`node_modules/.bin/next start`, `node_modules/.bin/tsx worker/index.ts`) as the container's actual PID 1. Re-verified afterward: `docker stop` now produces the worker's own `"received SIGTERM, shutting down gracefully..."` / `"shutdown complete."` log lines and a clean exit code.
7. **The CSP's `script-src 'self'` (no `unsafe-inline`) would have broken the app's own hydration in a real browser** — Next's streaming RSC bootstrap ships as inline `<script>` tags with no `src` attribute (6 of them on `/login` alone, confirmed by inspecting the actual built page's HTML). This matches Next's own "Without Nonces" reference CSP, which includes `'unsafe-inline'` on `script-src`, not only `style-src` — an error in the original plan's CSP that only surfaced by actually building and inspecting the production page. A nonce-based CSP would avoid this tradeoff but requires forcing every page (including the currently-static `/login`) into dynamic rendering; not undertaken here, noted as a stronger option for later.

After all seven fixes: both `web` and `worker` images build cleanly, `prisma migrate status` and `prisma migrate deploy` both run correctly from inside the built `web` image against a real Postgres instance, the worker's migration gate/pg-boss startup/health listener all boot correctly and in the right order, `/api/health` returns a clean unauthenticated `200 {"status":"ok","database":"up"}` with every security header present, and both services shut down gracefully on `SIGTERM` with a clean exit code.

## Tests run and results

```
Test Files  31 passed (31)
     Tests  209 passed (209)
```

All 124 Module One + Module Two tests still pass unchanged (the search-run tests specifically — `runSearchJob` was substantially rewritten for idempotency but its external contract, including "never throws, always resolves and records the outcome in `LeadSearch`," was deliberately preserved so those tests needed no changes). The 85 new tests cover the 8 required categories: durable job claiming/singleton-key duplicate prevention/retry-backoff/expiry-recovery (`tests/integration/job-queue.test.ts`, exercising real pg-boss mechanics against the test database, not a mock); idempotent-resume with no duplicate rows (`search-run-resume.test.ts`); import-batch expiry/cleanup/ownership (`import-batch-cleanup.test.ts`); production config validation without echoing secret values (`env.test.ts`); rate limiting that persists across a simulated process restart (`rate-limit.test.ts`, `client-ip.test.ts`); security headers, health-endpoint safety, and the `/api/health` proxy-exemption fix (`security-headers.test.ts`, `health.test.ts`, `proxy.test.ts`); CSV/Excel formula-injection neutralization and malicious-file rejection (`formula-injection.test.ts`, extended `export-serialize.test.ts` and `import-parse.test.ts`); worker graceful shutdown (`worker-shutdown.test.ts`, unit-level with fake timers — the real, live `docker stop` verification described above is what actually proves this end-to-end). Plus `mustChangePassword` enforcement and session cleanup (`auth.test.ts`) and error-reporting fallback behavior.

No automated test makes a real Anthropic API call — `.env.test` still forces `AI_PROVIDER="mock"`.

## Build result

- `npx prisma format && npx prisma validate` — clean
- `npx prisma migrate status` — up to date (dev and test databases)
- `npm run lint` — clean, no warnings
- `npx tsc --noEmit` — clean
- `npm run build` — clean production build; every protected route (including `/api/health`) renders dynamically
- `npm audit` — 7 pre-existing moderate findings, all previously investigated in Module Two, none introduced by this module
- `docker build --target web` and `--target worker` — both succeed; both verified running end-to-end against the real dev database as described above

## Railway deployment checklist (for the technical installer — not performed in this module)

1. **Prerequisites**: a Railway account with billing configured; this repo pushed to a private GitHub repo Railway can access.
2. **Create the Postgres service** from the Railway dashboard (managed plugin). Note its private `DATABASE_URL` reference variable.
3. **Create the `web` service**: connect the GitHub repo. Settings → Build: Builder = Dockerfile, Docker Build Target = `web`. Settings → Deploy: Start Command left as the image default (`node_modules/.bin/next start`), Pre-Deploy Command = `npx prisma migrate deploy`, Healthcheck Path = `/api/health`, Restart Policy = `ON_FAILURE` (or `ALWAYS`, operator preference). Enable public networking; attach the custom domain per WHC-subdomain notes below once ready.
4. **Create the `worker` service** from the same repo: Docker Build Target = `worker`. **No Pre-Deploy Command** — the worker's own migration-status gate (see Architecture above) is the safety net; do not add `migrate deploy` here, it would be redundant with the web service's step and isn't needed. Internal networking only (no public domain needed).
5. **Environment variables** — set on the indicated service(s), values never committed anywhere in this repo:

   | Variable | Service(s) | Notes |
   |---|---|---|
   | `DATABASE_URL` | both | Railway auto-injects from the Postgres plugin reference |
   | `NODE_ENV` | both | `production` |
   | `APP_URL` | both | the final public URL, e.g. `https://crm.triviality.example.com` |
   | `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | web (worker doesn't run Next) | generate with `openssl rand -base64 32`; must be identical if `web` is ever scaled to multiple instances |
   | `AI_PROVIDER` | worker | `"anthropic"` for live research, `"mock"` to keep it disabled for now |
   | `AI_API_KEY` | worker only | your Anthropic key — never set on `web` |
   | `AI_DAILY_BUDGET_USD` / `AI_MONTHLY_BUDGET_USD` | worker | optional spend caps |
   | `IMPORT_BATCH_TTL_HOURS` | both | optional, defaults to 4 |
   | `SENTRY_DSN` | both | optional |
   | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | web | set only for the very first deploy (the Pre-Deploy Command's `migrate deploy` runs the seed step — confirm this against `prisma.config.ts`'s `migrations.seed` behavior before relying on it for a fresh database), then **unset both** so later redeploys don't attempt bootstrap-admin creation again. Choose the password yourself — this module generates nothing.
   | `EMAIL_PROVIDER` | both | `"resend"` for live transactional email, `"mock"` to keep it disabled for now (Module Nine) |
   | `RESEND_API_KEY` | both — see note | your Resend key. The actual send call only ever happens from `worker` (`sendSystemEmail`'s queued job), but `src/lib/env.ts` validates every `EMAIL_PROVIDER=resend`-dependent var together via one shared check that runs in both processes — `web` needs the value present too or its own env parsing throws on boot (it's only ever read there to answer "is this configured?" for the Integrations page, never sent anywhere) |
   | `RESEND_FROM_ADDRESS` | both — same note as `RESEND_API_KEY` | the verified Resend sender address |
   | `RESEND_WEBHOOK_SECRET` | both — same note; only actually **used** on `web` | verifies the delivery-events webhook's signature, received by the `web` service's `/api/transactional-email/webhooks/resend` route |

6. **First deploy**: push to the branch Railway watches, or trigger a manual deploy on both services. Watch the `web` service's Pre-Deploy Command logs for `prisma migrate deploy` succeeding, then watch the `worker` service's logs for `"database schema is up to date."` / `"worker started, listening for jobs."`.
7. **Verify**: hit `https://<web-domain>/api/health` — expect `{"status":"ok","database":"up"}`. Sign in with the seeded admin. Confirm the worker is reachable via Railway's private networking if you need to check its `/health` manually.
8. **Custom domain (WHC-managed)**: in Railway, add the custom domain under the `web` service's Settings → Networking, and add the CNAME record Railway provides to your DNS provider. This only adds a `CNAME` for the CRM subdomain (e.g. `crm.yourdomain.com`) — it does not touch any existing `MX`/mail records at WHC, so email hosting is unaffected. Do not modify any other DNS records.
9. **Backups**: confirm what backup tier your Railway Postgres plan includes (varies by plan — do not assume). If automated backups aren't included or you want an independent copy, schedule a periodic `pg_dump` (e.g. a small scheduled job outside this app) and **actually restore it once to a scratch database to verify it works** — an unverified backup is not a backup.

## Manual actions required from you (not performed in this module)

- Railway account creation and billing confirmation
- Creating the Postgres, `web`, and `worker` services on Railway
- Setting every environment variable listed above with real values (private, never in this repo)
- Choosing and setting the production administrator's password (bootstrap seed step)
- Obtaining and setting a real `AI_API_KEY` if you want live AI research
- The WHC DNS CNAME record for the custom domain
- Verifying a real backup/restore cycle
- The manual live-provider acceptance test below
- A manual browser click-through of the deployed app (CSP correctness was verified by inspecting the built page's HTML and confirming Next's own inline-script requirement — not by an actual browser's console, which no tool in this environment can drive)

## Manual live-provider acceptance procedure (for later — not run in this module)

1. In a non-production Railway environment (or a local `.env` you don't commit), set `AI_PROVIDER=anthropic` and a real `AI_API_KEY`.
2. Run one deliberately small search: one city, a narrow prompt, `minimumScore` left at default.
3. Confirm results include evidence with real source URLs, and that the search reaches `SUCCEEDED`.
4. Query `AiUsageRecord` for that search — confirm token counts and `estimatedCostUsd` look plausible.
5. Cross-check against the actual usage shown at platform.claude.com's console.
6. Revert to `AI_PROVIDER=mock` (or remove `AI_API_KEY`) once satisfied — do not leave a real key set in an environment you don't intend to keep paying for.

## Incident/recovery runbook

- **Failed job retry**: automatic — pg-boss retries a failed `run-search` job up to 3 times with exponential backoff. A search that reaches `FAILED` after exhausting retries needs a human to review `LeadSearch.errorMessage` and, if appropriate, use the UI's cancel-and-restart flow (creates a fresh search) — a `FAILED` search is never silently retried again on its own.
- **Database restore**: restore your verified backup to a fresh Railway Postgres instance (or the same one, if starting over), point `DATABASE_URL` at it, run `npx prisma migrate deploy` to bring the schema current, redeploy both services.
- **API outage (Anthropic)**: the worker's `AnthropicCandidateDiscoveryProvider` etc. will throw; `runSearchJob` catches this, marks the search `FAILED` with the error message, and does not corrupt any already-checkpointed `SearchCandidate`/`SearchResult` rows. No action needed beyond waiting for the outage to clear and manually restarting affected searches.
- **Rollback**: redeploy the previous Railway deployment (Railway keeps deploy history per service) for both `web` and `worker`. If the rolled-back version's schema is older than the current database schema, this is only safe if the migration between them was purely additive (true for this module's one migration — no columns were dropped or renamed) — verify this for any future migration before relying on a schema rollback path, since Prisma has no automatic down-migration.

## Operating cost considerations

- One new always-on Railway compute service (the worker) beyond what Module Two implied — modest additional cost, avoids the alternative of running the job loop inside the stateless web process.
- `pg-boss`, `pino`, `file-type` are free, zero-infra libraries; no Redis, no forced Sentry subscription.
- Primary variable cost is live Anthropic usage once enabled — mitigated by the concurrency limit (one `run-search` job at a time), the fixed timeout-cancellation bug fix (no more paying for a cancelled-but-still-running call), and the optional daily/monthly budget cap.

## Deviations from the approved plan

- The plan's original CSP (`script-src 'self'`, no `unsafe-inline`) was corrected to include `'unsafe-inline'` on `script-src` after live container testing showed it would break Next's own inline hydration scripts — see Deployment packaging above. This is a *more* permissive CSP than planned, not less; a nonce-based CSP remains available as a stronger follow-up.
- `next.config.ts`'s `output: "standalone"` was dropped in favor of a full-`node_modules` Docker image, for the Prisma-CLI-availability reasons discovered during build testing (see above) — not part of the original plan, which assumed standalone output without having verified it against this app's specific Pre-Deploy-Command-needs-the-CLI requirement.
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` was added to the env schema and deployment checklist — not anticipated in the original plan, found while reading Next's own Server Actions security documentation during implementation.
- Everything else matches the approved (and revised) plan: pg-boss as the queue, the idempotent `SearchCandidate` checkpoint design, the single-designated-migration-step approach, the documented trusted-proxy IP design, the 4-hour import-batch TTL, and no Redis/forced Sentry dependency.
