# Railway Deployment Guide

This is the living, standalone deployment reference — it supersedes the
checklist embedded in `MODULE_3_REPORT.md`. If the two ever disagree, trust
this file for anything about *how to deploy*, and `MODULE_3_REPORT.md` only
for historical build-testing notes (why the Dockerfile looks the way it does).

## Architecture

Two Railway services build from the same `Dockerfile` via `--target web` /
`--target worker`, plus a managed Postgres plugin:

- **`web`** — the Next.js app. Public-facing.
- **`worker`** — the pg-boss job consumer (durable AI research jobs, scheduled
  email, reports, sequences, cleanup ticks, worker-heartbeat + alert ticks).
  No public networking needed — internal only.
- **Postgres** — Railway's managed plugin. Both services connect to the same
  database via `DATABASE_URL`.

**Migrations run in exactly one place**: the `web` service's Pre-Deploy
Command (`npx prisma migrate deploy`). The `worker` service never runs
migrations itself — `worker/main.ts` blocks at startup, polling `npx prisma
migrate status` (up to 5 minutes) until the schema is confirmed current, before
it calls `boss.work()` on anything. This guarantees the worker never consumes
a job against a schema it hasn't verified is up to date, without needing two
services to coordinate a migration race.

## Prerequisites

- A Railway account with billing configured
- This repo pushed to a GitHub repo Railway can access

## Setup

1. **Create the Postgres service** from the Railway dashboard (managed
   plugin). Note its private `DATABASE_URL` reference variable — you'll wire
   it into both other services as a reference, not a copied literal.
2. **Create the `web` service**, connected to the GitHub repo.
   - Settings → Build: Builder = Dockerfile, Docker Build Target = `web`
   - Settings → Deploy: Start Command = leave as the image default
     (`node_modules/.bin/next start`); Pre-Deploy Command =
     `npx prisma migrate deploy`; Healthcheck Path = `/api/health`; Restart
     Policy = `ON_FAILURE` (or `ALWAYS` — operator preference)
   - Enable public networking; attach a custom domain once ready (see below)
3. **Create the `worker` service** from the same repo.
   - Docker Build Target = `worker`
   - **No Pre-Deploy Command** — do not add `migrate deploy` here. The
     worker's own migration-status gate is the safety net; a second
     `migrate deploy` here would be redundant and isn't needed.
   - Internal networking only (no public domain needed)
4. **Environment variables**: see `ENVIRONMENT_VARIABLES.md` for the complete,
   accurate, grouped list of every variable this app reads, which service(s)
   need it set, and why. Read that file's "how validation works" section
   first — several variables must be set on *both* services even though only
   one process actually uses the resulting value, because `web` and `worker`
   share one validation schema that runs at startup on each.
5. **First deploy**: push to the branch Railway watches, or trigger a manual
   deploy on both services. Watch the `web` service's Pre-Deploy Command logs
   for `prisma migrate deploy` succeeding, then watch the `worker` service's
   logs for `"database schema is up to date."` followed by `"worker started,
   listening for jobs."`.
6. **Verify**: hit `https://<web-domain>/api/health` — expect
   `{"status":"ok","database":"up"}`. Sign in with the seeded administrator
   (see `MIGRATIONS_AND_SEEDING.md` for creating one). Confirm the worker
   process is healthy from System Health inside the app (Administration →
   System Health) rather than trying to reach its internal `/health` endpoint
   directly.

## Custom domain

In Railway, add the custom domain under the `web` service's Settings →
Networking, then add the DNS record(s) Railway provides at your DNS provider.
Only the CRM's own subdomain/domain is touched — this never modifies any
existing `MX` or other mail-related DNS records. Apex/root domains need
CNAME+TXT records and are only directly supported by specific DNS providers
(Cloudflare, DNSimple, Namecheap, bunny.net as of this writing) — a registrar
that doesn't support that may require switching nameservers to a supported
provider first.

## Graceful shutdown and restart behavior

Both the `web` and `worker` container images run their process binary
directly as PID 1 (`node_modules/.bin/next start` / `node_modules/.bin/tsx
worker/index.ts`), not through `npm run`/`npx` — verified during Module Three
that `npm`/`npx` do not reliably forward `SIGTERM` to the process they spawn
when running as PID 1 in a container, which would otherwise skip graceful
shutdown entirely on every Railway redeploy or restart. On `SIGTERM`, the
worker's shutdown handler lets in-flight jobs finish (or reach their next safe
checkpoint) before exiting — see `worker/shutdown.ts`.

## Health endpoints

- **`web`**: `GET /api/health` → `{"status":"ok","database":"up"}` (or
  `"down"` if the database check fails). This is what Railway's Healthcheck
  Path setting should point at.
- **`worker`**: a minimal internal HTTP listener on `PORT` (Railway sets this
  automatically) responds `200 {"status":"ok"}` at `/` or `/health` — purely
  for Railway's own health check, not meant to be queried externally. Don't
  rely on this for day-to-day worker-health checking; use System Health
  inside the app instead, which reads the actual `WorkerHeartbeat` row rather
  than just "is the process's HTTP listener up."

## Backups

See `BACKUP_RESTORE.md` for the full runbook. In short: confirm what backup
tier your Railway Postgres plan includes (this varies by plan — don't assume),
take a manual on-demand backup immediately before any production migration in
addition to the automatic scheduled ones, and restore through the Railway
dashboard, never by hand-editing the database.

## Rollback

Redeploy the previous Railway deployment (Railway keeps per-service deploy
history) for both `web` and `worker`. This is only safe if the migration
between the two versions was purely additive (no dropped/renamed
columns/tables) — verify this for the specific migration involved before
relying on a rollback, since Prisma has no automatic down-migration (see
`MIGRATIONS_AND_SEEDING.md`).

## Operating cost notes

- One always-on worker compute service beyond the web service and Postgres —
  modest additional cost, avoids running the job loop inside the stateless web
  process.
- `pg-boss` (the job queue), `pino` (logging) are free, zero-infra libraries —
  no Redis, no forced third-party subscription.
- The primary variable cost is live AI provider usage once `AI_PROVIDER` is
  switched from `mock` — mitigated by the per-search concurrency limit and the
  optional daily/monthly budget caps (`AI_DAILY_BUDGET_USD`/
  `AI_MONTHLY_BUDGET_USD`).
