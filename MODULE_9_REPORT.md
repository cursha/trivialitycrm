# Module Nine: Essential Version 1 Integrations — Report

## Startup verification

Confirmed before any edit: branch `module-nine-integrations` (equal to `main` at commit `5571967`, working tree clean), Modules 1–8A present (`MODULE_1_REPORT.md` through `MODULE_8A_REPORT.md` all exist), full repository read (Prisma schema, migrations, README, `.env.example`, Dockerfile, worker, AI provider code, Module Six communications, Module 8A administration, permissions, auditing, rate limiting, tests) via three parallel research passes before writing a phased plan and getting explicit approval — including two follow-up scope decisions (email integration scope, ESP choice) confirmed with the user before implementation began.

## Purpose and scope

Connect only the two external services Version 1 needs — live AI lead research and transactional/system email — with real cost/usage tracking, safe admin visibility, and controlled test actions. Explicitly not built: calendar/accounting/Zapier integrations, generic webhooks, multi-tenancy, or anything else Module 8A already deferred.

## Key finding that shaped the whole module

Research before writing any code found the starting state was **not** what a literal reading of "connect live AI + email" would suggest:

- **AI research was already live-capable.** `AnthropicCandidateDiscoveryProvider`/`VerificationProvider`/`ScoringProvider` (`src/lib/research/providers/anthropic.ts`) already made real, structured-output `messages.create()` calls with server-side web tools — built in Module Two, never exercised against the live API in this environment. Module Nine's AI work is hardening (mid-run budget recheck, error taxonomy, admin visibility) and closing real gaps, not building a live provider from scratch.
- **No transactional ESP existed.** Module Six's real, working email model is per-user OAuth mailbox sending (Microsoft Graph/Gmail) for CRM outreach — genuinely live, but structurally incapable of delivery/bounce/complaint webhooks for a delegated mailbox (documented as a permanent gap in `MODULE_6_REPORT.md`'s Phase E notes). Meanwhile `forgot-password` (built earlier this session) sent no email at all.

This is why Module Nine adds a **new, deliberately narrow transactional provider (Resend)** for system/account email only (password-reset links, an admin test send) rather than either duplicating the AI provider or trying to bolt delivery webhooks onto a mailbox model that can't support them. **Module Six's CRM-outreach OAuth sending is completely untouched.** Both scope decisions (narrow-ESP vs. replace-CRM-outreach; Resend vs. Postmark) were presented to and confirmed by the user before any code was written — see the plan file's "Scope decisions" section.

## Features delivered

1. **AI integration hardening** (`src/lib/ai/budget.ts`, `src/lib/research/run-search.ts`): a mid-run budget recheck (`checkMidRunAiBudget()`) between candidates — not just once at search start — so a search crossing the daily/monthly budget, or a new optional `maxCostPerSearchUsd` ceiling, stops immediately and audits the block (`ai_search.budget_blocked`). This directly targets the class of runaway-cost incident from earlier in this project's history (a discovery-retry cost spike): the earlier fix capped *retries*; this caps a *single long-running search* that starts within budget and drifts over it.
2. **Shared provider-error taxonomy** (`src/lib/integrations/provider-errors.ts`): one `classifyProviderError()` mapping every known failure shape (the app's own rate-limit/timeout errors, real Anthropic SDK error classes confirmed against the installed `@anthropic-ai/sdk@0.112.3` type defs, real Resend SDK error codes confirmed against the installed `resend@6.18.0` type defs) to a safe category + static, reviewed user-facing message — never the raw error text.
3. **Transactional email (Resend)** (`src/lib/transactional/`): a provider-neutral interface (mock + Resend), `sendSystemEmail()`/`processQueuedSystemEmail()` queued through a new durable worker queue (`QUEUE_SEND_SYSTEM_EMAIL`), idempotency enforced three ways (DB-unique `idempotencyKey`, the queue's own `singletonKey`, and Resend's native `Idempotency-Key` header — confirmed supported in the installed SDK's types). Sending stays **off by default** (`IntegrationSettings.emailSendingEnabled`) even once `RESEND_API_KEY` is configured.
4. **Password-reset email wiring** (`src/lib/auth/password-reset.ts`): `generatePasswordResetLink()` now also emails the link when live sending is enabled — best-effort, never blocking or changing the existing admin-mediated-link fallback.
5. **Delivery-events webhook** (`src/app/api/transactional-email/webhooks/resend/route.ts`): Svix-HMAC-verified (confirmed against the installed `svix@1.99.1` package), idempotent via a new `EmailDeliveryEvent` ledger, updates `TransactionalEmailMessage` status, and auto-suppresses an address on a **permanent** bounce or any complaint (`EmailSuppression`, audited).
6. **Quiet hours** (`src/lib/comms/quiet-hours.ts`, `WorkspaceSettings.quietHoursStartHour`/`EndHour`, edited from `/settings`): one business-wide window blocking an immediate CRM-outreach send and deferring a scheduled/sequence one — genuinely new, nothing like it existed before this module. Transactional/system email is exempt.
7. **Integrations admin page** (`/administration/integrations`): AI + email provider mode/configured/enabled status, budget/usage totals, last-successful-request timestamps, a redacted recent-failure summary, queue health, and four controlled actions (enable/disable live AI, enable/disable live email, test AI connection, send one test email) — all permission-gated, rate-limited, and audited.

## Existing features reused (not duplicated)

- `checkRateLimit()` (Postgres-backed bucket) for every new rate limit — no new limiter abstraction.
- `writeAuditEvent()`/`describeAuditEvent()` for every new audit action, following the established `<module>` / `<entity_snake>.<verb_past_tense>` convention exactly.
- The seed-driven permission catalog (`prisma/seed.ts`'s idempotent upsert pattern) for the 5 new permission keys — no new mechanism.
- `callEmailProvider()` (`src/lib/comms/providers/http.ts`) reused as-is for the Resend provider's own rate-limit/timeout wrapper, under its own `"transactional-email"` bucket namespace so it never shares budget with Module Six's CRM-send buckets.
- `zonedDayRange()`/`BUSINESS_TIMEZONE` (`src/lib/timezone.ts`) reused for quiet-hours math — one small `zonedHour()` export added, not a parallel timezone system.
- The `administration/<section>/{page,queries,actions}.tsx` structure and `system-health`'s job-action client-component pattern, mirrored exactly for the new Integrations page.
- `validateEmailAddress()`/`validateSubject()` (`src/lib/comms/validate.ts`) and `textToSafeHtml()` reused for the transactional send path — no second validation/sanitization implementation.
- The existing `WebhookEvent` idempotency *pattern* (two-layer: fast DB dedup before any further processing) was followed, but implemented as a new `EmailDeliveryEvent` model rather than widening `WebhookEvent.provider`'s `ProviderKind` enum — see "Architectural decisions" below.

## Architectural decisions (confirmed before/while writing code)

- **Email scope fork** (system/account email only vs. replacing CRM outreach): confirmed with the user — narrow scope, CRM outreach untouched.
- **ESP choice**: Resend, per the user's request for a recommendation, over Postmark (weaker free tier) and SES/SendGrid (more setup complexity for this app's realistic volume).
- **`EmailDeliveryEvent` as a new model, not a widened `WebhookEvent`**: `WebhookEvent.provider` is typed `ProviderKind` (`MICROSOFT | GOOGLE` — Module Six's OAuth-mailbox-kind enum). Reusing it for `"resend"` would conflate two unrelated concepts (OAuth mailbox kind vs. ESP delivery-webhook source); a small new model with a plain `provider: String` (matching `AiUsageRecord.provider`'s own plain-string precedent) keeps the two idempotency ledgers conceptually separate.
- **`IntegrationSettings.emailSendingEnabled` as a DB kill switch, `EMAIL_PROVIDER` as an env-only provider selector**: mirrors `AI_PROVIDER`'s existing division of labor exactly — the env var picks *which* provider would be used (a real infra credential, not live-editable), the DB flag is the safe, redeploy-free on/off switch. AI's equivalent DB flag reuses the *existing* `AiSettings.researchEnabled` rather than adding a duplicate field.
- **`server-only` dropped from `src/lib/audit/log.ts`**: `run-search.ts` (worker-executed) needed to write an audit event for a mid-run budget block — the first time the worker itself, not just a Server Action, needed to audit something. Confirmed no `"use client"` file imports `writeAuditEvent` before removing the guard; same reasoning already applied to `prisma.ts`, `ai/budget.ts`, and every other worker-reachable module in this codebase.
- **No email fan-out for the existing in-app `Notification` model**: the spec's §4 lists "system notifications" as something to support; the in-app notification center already covers that need, and adding an email channel for it is a materially separate feature not required by any of the 13 numbered sections. Flagged explicitly rather than silently built or silently skipped.
- **Quiet hours live on `WorkspaceSettings` (`/settings`), not `OrganizationSettings` (`/administration/organization`)**: the plan initially assumed these were the same settings page — research corrected this before writing code. `WorkspaceSettings` already owns Module Six's other CAN-SPAM-adjacent field (`mailingAddress`) and Module Four/Six's threshold fields; quiet hours is the same category of workspace-wide outreach policy, not organization identity/locale config.

## Real bug found and fixed during verification (not assumed away)

A manual HTTP smoke test of the new Resend webhook route (`curl -X POST /api/transactional-email/webhooks/resend`) returned a `307` redirect to `/login` instead of reaching the route handler at all. Investigating `src/proxy.ts` found the actual cause: its public-path allowlist (`PUBLIC_PREFIXES`) only ever exempted `/api/health` — **Module Six's existing inbound comms webhook** (`/api/comms/webhooks/[provider]`) had never been added either. Confirmed by testing the existing route the identical way: same `307`. This means a real, unauthenticated webhook POST from Microsoft Graph (or now Resend) would have been silently redirected to `/login` and never processed, in any deployed environment — a genuine pre-existing gap, not something introduced by this module, but one this module's own testing surfaced. `MODULE_6_REPORT.md`'s own known-gaps section already noted "no real Microsoft Graph subscription has ever been exercised against a live tenant," which is exactly why this had never been caught.

Fixed in `src/proxy.ts` by adding both webhook prefixes to `PUBLIC_PREFIXES`. Re-verified directly: both webhook routes now correctly reach their handlers (`404`/`400` from actual route logic instead of a `307`), while every genuinely protected page (`/administration/integrations`, `/administration/ai-settings`, etc.) still correctly redirects an unauthenticated request to `/login`. Added two regression tests to `tests/unit/proxy.test.ts` (which already existed and directly unit-tests `proxy()` — the right place, since HTTP-level middleware isn't exercised by the route-handler-level integration tests that already covered these routes' internal logic, which is exactly why this had a blind spot).

## Database additions

New models: `IntegrationSettings` (singleton), `TransactionalEmailMessage`, `EmailSuppression`, `EmailDeliveryEvent`. New enums: `TransactionalEmailPurpose`, `TransactionalEmailStatus`. New fields: `AiSettings.maxCostPerSearchUsd`, `WorkspaceSettings.quietHoursStartHour`/`quietHoursEndHour`. Two migrations (`module_nine_integrations`, `module_nine_transactional_email_body` — the second fixing a same-session oversight, the send-body field needed by the worker between enqueue and actual send, caught immediately by the first test run rather than shipped broken).

## Permissions

`view_integrations`, `manage_ai_integration`, `manage_email_integration`, `send_test_email`, `view_provider_usage` — all Administrator-only by default (omitted from Manager/Salesperson's seed grant arrays, matching every prior module's admin-permission precedent). Deliberately separate from `manage_ai_settings`: `manage_ai_integration` covers only the research enable/disable toggle and the connection test, so an Integrations admin doesn't need full AI-Settings edit rights.

## Security protections

- API keys (`AI_API_KEY`, `RESEND_API_KEY`) never read outside `getEnv()`/the provider modules that need them; every UI surface (Integrations page, System Health, AI Settings) calls only boolean `isXConfigured()` helpers, never the raw value.
- No API key, secret, or connection string is ever passed into `writeAuditEvent()`'s before/after payloads for any new action — confirmed by a dedicated test (`integrations-admin.test.ts`'s secret-safety spec) asserting the *returned* status/usage shapes never match a key-like or connection-string-like pattern, on top of the pre-existing display/export-time redaction (`redactSensitiveData`).
- The Resend webhook verifies a real HMAC signature (Svix) with built-in timestamp-based replay protection; every failure path (bad signature, missing headers, malformed payload, unconfigured provider) returns a generic response, never a detail an attacker could use to fingerprint configuration.
- Every new permission is enforced server-side only (Server Actions, the webhook route, and the queries feeding the page) — the page itself never renders a control the user lacks permission for, but the actions independently re-check regardless.
- Rate limits on every new mutating surface: AI connection test (3/min/user), test email send (3/min/user), transactional send overall (30/min), the webhook route (120/min).
- `npm audit`: pre-existing findings (next, postcss, prisma-dev-tooling, sharp, fast-uri, uuid, exceljs) — confirmed none introduced by `resend`/`svix`, the only two packages this module added.

## Tests and verification

New test files (9): `tests/unit/provider-errors.test.ts`, `tests/unit/transactional-providers.test.ts`, `tests/unit/quiet-hours.test.ts`, `tests/integration/transactional-email.test.ts`, `tests/integration/password-reset-email.test.ts`, `tests/integration/resend-webhook.test.ts`, `tests/integration/quiet-hours.test.ts`, `tests/integration/ai-budget-midrun.test.ts`, `tests/integration/integrations-admin.test.ts`. Extended: `tests/unit/env.test.ts` (EMAIL_PROVIDER/RESEND_* validation, mirroring the existing AI_PROVIDER blank-value regression case), `tests/unit/proxy.test.ts` (the webhook-auth regression above), `tests/helpers/db.ts` (see below).

No automated test makes a real Anthropic or Resend API call — `.env.test` now also pins `EMAIL_PROVIDER=mock`, and `getTransactionalProvider()`/`getEmailProvider()` both force mock unconditionally under `NODE_ENV=test` regardless of what's configured.

**A second real bug found during testing itself**: `tests/helpers/db.ts`'s `resetDatabase()` truncates a manually-maintained table list every `beforeEach` — the 4 new Module Nine tables were never added to it. Two of the four (`TransactionalEmailMessage`, `IntegrationSettings`) happened to get cascade-truncated anyway because they have a foreign key to `User`, which *is* in the list — Postgres's `TRUNCATE ... CASCADE` follows FKs automatically. The other two (`EmailSuppression`, `EmailDeliveryEvent`) have no FK at all, so their rows leaked across every test run, causing real, reproducible failures (a unique-constraint violation on a suppressed address, and a suppression audit event that silently didn't fire because the address was "already" suppressed from a stale row). Fixed by adding all four to the list explicitly, and confirmed by a completely clean re-run afterward — never left to "probably fine."

**Final verification status**: one complete, uninterrupted full-suite run passed cleanly at **862/862 tests across all 118 files** (after the `resetDatabase()` fix above, before the `proxy.ts` fix). The `proxy.ts` fix made after that run was verified independently and thoroughly rather than by re-running the entire suite again: its own dedicated test file (`tests/unit/proxy.test.ts`, 9/9 including 2 new regression cases), `tsc --noEmit` and `eslint` both clean, and a direct HTTP re-check (`curl`) confirming the exact before/after behavior on both the new and the pre-existing webhook route. Two subsequent attempts at one more full 118-file confirmation run were abandoned after they hung partway through — traced to genuine Postgres connection instability (`"Connection terminated due to connection timeout"`) from this machine running the dev server, worker, two Docker Postgres containers, and repeated large test runs continuously for many hours in one session, not a code defect: the specific files nearest the hang point (`job-queue.test.ts`, `job-retry-cancel.test.ts`, both pre-existing and untouched by this module) ran cleanly in isolation immediately afterward. Given the one complete clean run plus fully independent verification of the only change made since, further retries against a visibly strained environment were judged not worth the additional wait.

## Build result

`npm run build` succeeded cleanly: Turbopack compile in 14.0s, TypeScript in 23.2s, all 61 static/dynamic routes generated including the two new ones (`/administration/integrations`, `/api/transactional-email/webhooks/resend`). `npx tsc --noEmit` and `npm run lint` both clean throughout. `npm audit`: the same 9 pre-existing findings as before this module (next, postcss, prisma-dev-tooling, sharp, uuid, exceljs) — confirmed none introduced by `resend`/`svix`.

## Manual browser/HTTP walkthrough

No browser-automation tool was available in this session, so this is an HTTP-level check (via `curl` against a freshly restarted dev server and worker, mock mode throughout), not an actual authenticated click-through of the Integrations page's UI — flagged explicitly rather than claimed as more than it is:

- `GET /api/health` → `{"status":"ok","database":"up"}`.
- `GET /administration/integrations` (unauthenticated) → `307` to `/login`, confirming the new page is genuinely permission-gated, not just hidden client-side.
- `GET /administration/ai-settings` (unauthenticated) → same `307`, confirming the fix below didn't accidentally over-expose anything.
- `POST /api/transactional-email/webhooks/resend` (unauthenticated, `EMAIL_PROVIDER=mock`) → `404`, the route's own "not configured" response — reached correctly, not redirected.
- `POST /api/comms/webhooks/microsoft` (unauthenticated, malformed body) → `400`, same confirmation for the pre-existing route.
- `npm run worker` log confirmed clean startup: `"database schema is up to date."` / `"worker started, listening for jobs."`, with the new `send-system-email` queue registered alongside the existing ones.

**Not done, and you should before relying on this**: an actual signed-in browser session clicking through `/administration/integrations` — toggling the switches, clicking "Test AI connection," submitting the test-email form, and confirming the page visually renders and updates as expected. The server-side logic behind all of that is covered by `integrations-admin.test.ts`, but rendering/interaction itself was not visually verified.

## Deferred / out of scope

- Email fan-out for the in-app notification center (see "Architectural decisions" above).
- Any change to Module Six's CRM-outreach OAuth-mailbox send path — untouched by design.
- A DB-editable global "AI provider" or "email provider" selector — provider selection stays env-var-only, matching `AI_PROVIDER`'s existing precedent; only the on/off switches are DB-editable.
- Per-user or per-territory quiet hours — one business-wide window only, matching the existing single-`BUSINESS_TIMEZONE` simplification.
- A bulk "resend all failed transactional emails" admin action — not required by any of the 13 sections, and would need its own rate-limit/abuse consideration.

## Known limitations

- Because `EMAIL_PROVIDER`/`RESEND_*` are validated together by one shared `env.ts` check that runs in both the `web` and `worker` processes, all four values must be set on **both** Railway services once `EMAIL_PROVIDER=resend`, even though the actual Resend API call only ever happens from `worker` — documented explicitly in `MODULE_3_REPORT.md`'s updated Railway checklist table so this isn't rediscovered the hard way at deploy time.
- The AI connection test (`testAiConnection()`) and a real Resend send have not been exercised against live credentials in this environment — by design, per the user's explicit "do not perform live tests until I approve them" instruction. Manual verification steps are below.
- `PLACES_PROVIDER`/`GOOGLE_PLACES_API_KEY` were found, while extending `tests/unit/env.test.ts`, to be missing from that test file's `REQUIRED_KEYS` regression list (a pre-existing gap from the Google Places module, not introduced here) — left as-is, out of this module's scope, but worth a follow-up.

## Manual verification (after your review — not performed here)

Do not do any of this until you're ready to spend real Resend credits/quota:

1. In your local `.env` (never committed): set `EMAIL_PROVIDER="resend"`, `RESEND_API_KEY` (from your Resend dashboard), `RESEND_FROM_ADDRESS` (a sender on a domain verified in that dashboard), `RESEND_WEBHOOK_SECRET` (create a webhook in the Resend dashboard pointed at `${APP_URL}/api/transactional-email/webhooks/resend`, subscribed to at least `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed` — the dashboard shows the signing secret once).
2. Restart the app and worker so the new env vars load.
3. Sign in as an Administrator, go to `/administration/integrations`, confirm the AI and Email cards render with the mock/live badges you expect.
4. Click **Enable live email sending**.
5. Enter your own email address in **Send a test email to** and click **Send test email**. Check your inbox for "Triviality CRM — test email."
6. On the Integrations page, confirm "Last successful send" updates to a recent timestamp, and once Resend's webhook fires, confirm the status reflects delivery (you can also check `TransactionalEmailMessage` directly if you want to see `DELIVERED`).
7. To confirm unsubscribe/suppression still works for CRM outreach, that's unchanged from Module Six — no new steps needed there.
8. To test AI: set `AI_PROVIDER="anthropic"` and `AI_API_KEY`, then on `/administration/integrations` click **Test AI connection** — this makes exactly one minimal, low-cost real API call. Confirm it reports success and that "Last successful request" and the usage table update.
9. When done experimenting, you can click **Disable live email sending** / switch `AI_PROVIDER` back to `mock` to return to a zero-cost state.
