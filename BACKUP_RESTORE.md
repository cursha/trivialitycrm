# Backup and Recovery

## Railway Postgres backups

Railway's managed Postgres plugin takes automatic daily backups and keeps a
rolling window of them (retention depends on your Railway plan — check the
Backups tab on the Postgres service in the Railway dashboard, since Railway can
change plan details without this doc being updated). This app adds no extra
backup mechanism of its own — it relies on Railway's built-in backups as the
primary recovery path, restored **through the Railway dashboard**, not by hand.

**Recommended retention:** the shortest window that still lets you recover
from a bad deploy or a bad migration — for this app's data volume and traffic,
daily backups with Railway's default retention are enough. There is no
regulatory or contractual reason (known as of this writing) to keep backups
longer than Railway's default; keeping the *shortest safe* retention avoids
storing more historical customer/lead data than necessary.

### Before every migration that touches production

Take a manual backup from the Railway dashboard (Postgres service → Backups →
Create backup) immediately before running `migrate deploy` against production,
in addition to the automatic daily one. A migration is the single highest-risk
moment for data loss in this app's operation — a fresh, on-demand backup taken
seconds before it runs is worth more than yesterday's automatic one.

## Restore procedure (production)

1. Confirm the incident actually needs a restore, not a forward fix — see
   `INCIDENT_RESPONSE.md`. Restoring loses every write made after the backup's
   timestamp; a forward fix (new migration, corrected data) usually loses less.
2. From the Railway dashboard, open the Postgres service's Backups tab and
   restore the chosen backup. **Never delete or replace the production database
   as a first step** — Railway's restore flow handles bringing the database
   back to the backup's state; you are not manually dropping and recreating it.
3. After restore, verify before declaring the incident resolved: row counts on
   a few key tables (`Company`, `Contact`, `User`), that a recent known record
   is present or absent as expected for the backup's timestamp, and that the
   web/worker services reconnect cleanly (check System Health).
4. Document what was restored, from when, and why in the incident record (see
   `INCIDENT_RESPONSE.md`'s checklist).

## Local restore drill (verification, not production)

This is a safe, local dry run of "does a Postgres dump/restore of this schema
actually work" — it never touches the dev or test databases you use day to day,
and it is **not** a substitute for testing Railway's own restore flow, which
can only be exercised on Railway itself.

Local Postgres runs in Docker for this project and the host has no installed
`psql`/`pg_dump` client, so every step runs through `docker exec` against the
dev container (`trivialitycrm-postgres-dev`) instead of a bare host command —
substitute your own container/host names if yours differ:

```
# 1. Dump the local dev database (inside the container, then copy out)
docker exec trivialitycrm-postgres-dev pg_dump -U trivialitycrm -d trivialitycrm -F c -f /tmp/trivialitycrm-drill.dump

# 2. Create a brand-new, empty scratch database — never reuse dev/test
docker exec trivialitycrm-postgres-dev createdb -U trivialitycrm trivialitycrm_restore_drill

# 3. Restore the dump into the scratch database only
docker exec trivialitycrm-postgres-dev pg_restore -U trivialitycrm -d trivialitycrm_restore_drill /tmp/trivialitycrm-drill.dump

# 4. Verify — compare row counts between source and scratch for a few tables
docker exec trivialitycrm-postgres-dev psql -U trivialitycrm -d trivialitycrm -c "SELECT count(*) FROM \"Company\";"
docker exec trivialitycrm-postgres-dev psql -U trivialitycrm -d trivialitycrm_restore_drill -c "SELECT count(*) FROM \"Company\";"

# 5. Clean up — this was a drill, not a database anyone should keep around
docker exec trivialitycrm-postgres-dev dropdb -U trivialitycrm trivialitycrm_restore_drill
docker exec trivialitycrm-postgres-dev rm /tmp/trivialitycrm-drill.dump
```

On a host with `psql`/`pg_dump`/`pg_restore`/`createdb`/`dropdb` installed and a
Postgres reachable directly (not just via Docker), drop the `docker exec
trivialitycrm-postgres-dev` prefix and add the usual `-h`/`-p` connection flags
instead.

**Never test a restore by overwriting the dev/test database you actually use,
and never test it against production.** Always restore into a fresh, isolated,
throwaway database and verify counts/relationships there, then discard it.

**Actually run** during Module Ten (2026-07-24) against the local dev database:
`pg_dump` (custom format) → `createdb trivialitycrm_restore_drill` →
`pg_restore` (exit code 0, no errors) → row counts compared across `Company`
(2/2), `User` (2/2), `Role` (3/3), `Permission` (62/62), and `SearchResult`
(10/10) — all matched exactly — plus a spot-check that `Company.assignedToId`
still resolved to the correct `User` row after restore. Scratch database and
dump file were both deleted immediately after. See `MODULE_10_REPORT.md` for
the full write-up.

## RTO / RPO expectations

- **RPO (how much data could be lost):** up to 24 hours under Railway's daily
  automatic backup schedule, or effectively zero for the specific migration
  moments where a manual pre-migration backup is taken.
- **RTO (how long a restore takes):** dependent on database size and Railway's
  own restore-flow duration — not independently measured by this app. Budget
  at least 15–30 minutes for a real incident (locating the right backup,
  running the restore, verifying, and getting the web/worker services healthy
  again), and treat that as a rough floor, not a guarantee, until it's been
  exercised against a real Railway restore at least once.

## Responsible-person checklist

Whoever holds Railway account access for this project is the only person who
can trigger a Railway-side restore — there is no in-app "restore" feature, by
design (an application-level restore trigger would itself be a dangerous
attack surface). Before an incident happens, confirm:

- [ ] At least one person with Railway dashboard access knows where the
      Backups tab is and has looked at it at least once.
- [ ] That person has read this doc and `INCIDENT_RESPONSE.md`.
- [ ] The local restore drill above has been run at least once so the
      mechanics are familiar before they're needed under pressure.
