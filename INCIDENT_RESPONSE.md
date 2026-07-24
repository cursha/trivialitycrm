# Incident Response

## Existing signals — check these first

- **System Health** (Administration → System Health, needs `view_system_health`):
  web status, database connectivity, worker heartbeat freshness, recent
  migration status, AI provider/key configuration, Microsoft/Google mailbox
  configuration, and a list of recently failed background jobs.
- **Integrations** (Administration → Integrations, needs `view_integrations`):
  AI and email provider status, whether live sending is currently enabled, and
  recent usage.
- **Audit log** (Administration → Audit Log, needs `view_audit_log`): who did
  what, when — administrative actions, not general CRUD.
- **Worker heartbeat email alert** (Module Ten): if the worker goes stale for
  more than ~6 minutes, every user with `manage_background_jobs` gets an email.
  This can only fire while the worker process itself is still running (see the
  honest limitation noted in `worker/handlers/worker-heartbeat-alert-tick.ts`)
  — it cannot alert on a fully-crashed worker, only one that's alive but not
  ticking cleanly. Railway's own service status/logs are the way to notice a
  fully-down worker.
- **Railway dashboard**: service logs, deploy history, and resource usage for
  both `web` and `worker`, plus the Postgres plugin's own metrics/backups tab.

## First questions

1. Is this a `web` problem, a `worker` problem, a database problem, or an
   external provider (AI/email) problem? System Health usually answers this
   directly.
2. Did this start right after a deploy? Check Railway's deploy history — a
   bad deploy is the single most common cause and the fastest to fix (roll
   back to the previous deploy from the Railway dashboard).
3. Is data actually at risk, or is this "just" an outage/slowness? A pure
   availability problem (worker down, AI provider erroring) needs a fix, not a
   restore. Only a genuine data-corruption/data-loss event should make you
   consider `BACKUP_RESTORE.md`.

## Disabling live AI/email during an incident

An administrator can flip live AI research or live transactional email off
from the Integrations admin page without a deploy — useful if a provider is
misbehaving (e.g. erroring on every call, or a runaway cost) and you want to
stop new calls while you investigate, without taking the rest of the app down.
Both fall back to their mock providers immediately; nothing else in the app
depends on them being live.

## Common scenarios

**Worker heartbeat is stale (System Health shows "stale," or you got the alert
email):** check the Railway `worker` service's logs and status directly. A
worker that's still running but stuck usually shows a single job's log line
repeating or stopped mid-way; a crashed worker shows a restart loop or an exit.
Railway restarts a crashed service automatically under its normal restart
policy — if it's not recovering on its own, check recent deploys and the
`worker`-only environment variables in `ENVIRONMENT_VARIABLES.md`.

**Database connectivity down:** System Health's database check and the
Railway Postgres plugin's own status are the two things to look at. If
Postgres itself is healthy but the app can't reach it, check `DATABASE_URL` on
both services and Railway's networking/service-linking configuration.

**A bad migration:** see `MIGRATIONS_AND_SEEDING.md`'s "when a migration
fails partway through" section. Take a manual backup before attempting any
forward fix if the migration already ran against production data.

**AI or email provider errors:** check Integrations for the provider's
configuration status and recent usage/errors. Provider outages are usually
transient — the app already fails a single search/send gracefully rather than
crashing (see the error-taxonomy work from Module Nine) — but a sustained
outage may warrant flipping the affected integration off (see above) until the
provider recovers.

**Suspected data loss/corruption:** stop making further changes to the
affected data if possible, take a fresh backup of the *current* (already
possibly-bad) state before restoring anything (so you don't lose the ability
to diagnose what happened), then follow `BACKUP_RESTORE.md`.

## Incident record checklist

For anything beyond a trivial blip, write down (even briefly, after the fact):

- [ ] What was observed, and when it started/ended
- [ ] What the root cause turned out to be
- [ ] What fixed it (rollback, forward fix, restore, provider-side recovery)
- [ ] If a restore was performed: which backup, from when, and the
      verification steps taken afterward (per `BACKUP_RESTORE.md`)
- [ ] Any follow-up needed (a missing test, a missing alert, a process gap)

This doesn't need a dedicated tool — a dated entry in a shared doc or an issue
is enough. The point is having *something* to look back on the next time
something similar happens.
