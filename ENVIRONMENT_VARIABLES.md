# Environment Variables

The authoritative source is `src/lib/env.ts` — this document is a human-readable
checklist derived from it. If the two ever disagree, trust the code.

**Never put real values for these in this file, any other doc, `.env.example`, a
command, a chat message, a screenshot, or a log line.** Set them directly in each
Railway service's Variables tab (or your local `.env`, which is gitignored).

## How validation works (read this first)

- `web` and `worker` are two separate Railway services, but they both call the
  exact same `getEnv()` — there is only one shared validation schema, run once per
  process at startup. A variable is **not** magically web-only or worker-only just
  because only one of the two processes happens to read the resulting value: if a
  var is *required* under the current settings (e.g. `AI_API_KEY` when
  `AI_PROVIDER=anthropic`), it must be set on **both** services, or the process
  that's missing it refuses to boot — even if that specific process never touches
  the value itself.
- An env var set to an empty string (`FOO=`) is treated exactly like it being
  unset entirely — "leave it blank" and "don't set it" are the same thing
  everywhere in this app.
- A provider selector left unset defaults to `mock` (`AI_PROVIDER`,
  `PLACES_PROVIDER`, `EMAIL_PROVIDER`) — the mock providers need no API key or
  secret at all, and are what local dev and the automated test suite run against.
  Only switching a selector to its live value (`anthropic`, `google`, `resend`)
  makes that value's credential variable required.
- A boot failure names which variable is wrong and why, but never logs the value
  itself — by design, so a misconfigured secret never ends up in aggregated logs.

## Core / shared

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | No — defaults to `development` | Railway sets `production` automatically for a deployed service. |
| `DATABASE_URL` | **Yes, always** | Postgres connection string. Used directly by Prisma and reused as-is by pg-boss (the job queue) — no separate queue connection string exists. |

## Web-specific (value only used by `web`, but must still be *set* on `worker` too — see above)

| Variable | Required | Notes |
|---|---|---|
| `APP_URL` | Required when `NODE_ENV=production` | Public base URL of the deployed app (e.g. `https://crm.example.com`). Used for the CSP / Server Actions trusted-origin allowlist. Not required in dev — there's no fixed origin to pin locally. |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Required when `NODE_ENV=production` | Next.js encrypts Server Action closures before sending them to the client; a multi-instance or restarting deployment needs a stable, pinned value or each instance/restart generates its own key. |

## Worker-specific

| Variable | Required | Notes |
|---|---|---|
| `PORT` | No — Railway provides it automatically | The worker's minimal HTTP listener for Railway's health check. You should not need to set this by hand on Railway. |

## AI research

| Variable | Required | Notes |
|---|---|---|
| `AI_PROVIDER` | No — defaults to `mock` | `mock` or `anthropic`. Any other value fails loudly at boot rather than silently falling back. |
| `AI_API_KEY` | Required when `AI_PROVIDER=anthropic` | Not needed at all in mock mode. |
| `AI_DAILY_BUDGET_USD` | Optional | Positive number. **One-time seed only** — used to populate the `AiSettings` database row the first time it's created; after that, the live daily budget is controlled entirely from the AI Settings admin page (`manage_ai_settings`), and this env var is no longer consulted. Changing it later has no effect once the row exists. |
| `AI_MONTHLY_BUDGET_USD` | Optional | Same one-time-seed-only behavior as above, for the monthly budget. |
| `PLACES_PROVIDER` | No — defaults to `mock` | `mock` or `google`. Only affects GENERAL-mode lead discovery — a separate credential/billing account from `AI_PROVIDER`, since a business-directory lookup isn't an AI call. |
| `GOOGLE_PLACES_API_KEY` | Required when `PLACES_PROVIDER=google` | Not needed in mock mode. |

## Email

### Transactional (system email — password reset, admin test-send, worker heartbeat alerts)

| Variable | Required | Notes |
|---|---|---|
| `EMAIL_PROVIDER` | No — defaults to `mock` | `mock` or `resend`. Deliberately separate from the per-user OAuth mailbox settings below — this is for system-triggered email only, never CRM outreach. |
| `RESEND_API_KEY` | Required when `EMAIL_PROVIDER=resend` | |
| `RESEND_FROM_ADDRESS` | Required when `EMAIL_PROVIDER=resend` | Must be on a domain verified in the Resend dashboard. |
| `RESEND_WEBHOOK_SECRET` | Required when `EMAIL_PROVIDER=resend` | Verifies the Resend delivery-events webhook's Svix signature. |

Even when `EMAIL_PROVIDER=resend` is fully configured, actual sending stays off
until an administrator enables it from the Integrations admin page
(`IntegrationSettings.emailSendingEnabled`) — these variables only select which
provider *would* be used.

### Per-user mailbox connections (CRM outreach — Module Six)

| Variable | Required | Notes |
|---|---|---|
| `MICROSOFT_CLIENT_ID` | Must be set together with `MICROSOFT_CLIENT_SECRET`, or both left unset | Enables "Connect your mailbox" via Microsoft OAuth. |
| `MICROSOFT_CLIENT_SECRET` | See above | |
| `GOOGLE_CLIENT_ID` | Must be set together with `GOOGLE_CLIENT_SECRET`, or both left unset | Enables "Connect your mailbox" via Google OAuth. |
| `GOOGLE_CLIENT_SECRET` | See above | |

## Security

| Variable | Required | Notes |
|---|---|---|
| `TOKEN_ENCRYPTION_KEY` | Required when `NODE_ENV=production` | AES-256-GCM key (32 bytes, base64-encoded) encrypting stored OAuth tokens (`ProviderConnection`) at rest. Optional in dev/test so the app boots without it. |
| `UNSUBSCRIBE_TOKEN_SECRET` | Required when `NODE_ENV=production` | HMAC secret signing `{{unsubscribeLink}}` tokens so an unauthenticated visitor can't forge or extend one. |

## Optional / operational

| Variable | Required | Notes |
|---|---|---|
| `SENTRY_DSN` | Optional | Error reporting. The app runs fine without it — errors are just logged, not forwarded. |
| `IMPORT_BATCH_TTL_HOURS` | No — defaults to `4` | How long an uncommitted import batch is kept before cleanup. 24 max. |
| `SEED_ADMIN_EMAIL` | Must be set together with `SEED_ADMIN_PASSWORD`, or both left unset | Used only by the seed script to create the first administrator. Never put an actual password value in this file, `.env.example`, a command, or a Git commit — see `MIGRATIONS_AND_SEEDING.md`. |
| `SEED_ADMIN_PASSWORD` | See above | |

## What NOT to do

- Do not add real values to `.env.example` — it exists to document variable
  *names*, and every value in it must stay a harmless placeholder.
- Do not paste a real secret into a chat message, a Railway deploy log comment,
  a GitHub issue/PR description, or ask a teammate to do so.
- Do not commit a populated `.env` file. It's gitignored — keep it that way.
