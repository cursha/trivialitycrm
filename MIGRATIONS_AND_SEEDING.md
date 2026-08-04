# Database Migrations and Seeding

Exact, safe procedures for checking, applying, and seeding the schema — locally
and on Railway. Never put a real password in a command, this file, any other
doc, or Git.

## Checking migration status

```
npx prisma migrate status
```

Exit code `0` means the connected database's schema is fully up to date with
`prisma/migrations/`. Anything else means there are pending migrations, or the
database's migration history doesn't match what's on disk — read the printed
message before doing anything else.

## Applying migrations

**Local development** (interactive, can prompt about data-loss risk):

```
npx prisma migrate dev
```

**Everywhere else — CI, Railway, or any non-interactive shell** (never prompts;
this is what Railway's web service pre-deploy step runs):

```
npx prisma migrate deploy
```

`migrate deploy` never creates a new migration — it only applies ones already
committed to `prisma/migrations/`. If a new migration needs hand-review before
it's safe to run non-interactively (e.g. a new `NOT NULL` column over existing
rows, a new unique constraint over data that might already have duplicates),
resolve the conflicting data first or hand-write the migration SQL, then run
`migrate deploy` — it has no interactive gate to fight.

In this app's Railway setup, **only the `web` service's pre-deploy command runs
`migrate deploy`.** The `worker` service never runs migrations itself — it
polls `prisma migrate status` at startup and waits (up to 5 minutes) for the
schema to already be current before it starts accepting jobs. See
`RAILWAY.md` for the full deployment sequence.

## Seeding

```
npx prisma db seed
```

If running this as part of Railway's Pre-Deploy Command chained after
`migrate deploy`, see RAILWAY.md's Pre-Deploy Command gotcha first — that
field is not run through a shell, so a naive `migrate deploy && db seed`
string silently only runs the first command, with the deploy still
reporting SUCCESS and no error anywhere in the logs. Confirmed live: this is
exactly how seeding silently stopped applying to production for an unknown
period. Wrap the whole chain in `sh -c "..."`.

Runs `tsx prisma/seed.ts` (configured in `prisma.config.ts`). The seed script
is fully idempotent — every row it creates uses `upsert`, keyed on a stable
natural key (permission key, role name, pipeline-stage name, etc.), so running
it twice in a row is safe and produces no duplicates. It seeds:

- All permissions and the built-in roles' permission grants
- Default pipeline stages and rejection reasons
- Default organization/AI/integration settings (id=1 singleton rows)
- Default data-quality rules (skipped if no Administrator user exists yet to
  attribute them to — re-run the seed after creating one if you see that message)
- A bootstrap Administrator user, **only if** `SEED_ADMIN_EMAIL` and
  `SEED_ADMIN_PASSWORD` are both set in the environment the seed runs in, and
  only if no user with that email already exists

### Creating the first administrator

Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` as real environment variables
in whatever shell/service is about to run the seed — **never** as a literal in
a command, a doc, a commit message, or a chat message. On Railway, set them as
temporary service variables, run the seed once, then remove them (or change the
password immediately after first login — the account has no forced
password-change flag by default, so do this yourself).

```
npx prisma db seed
```

If `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` are unset, the seed just skips that
step and prints why — safe to run in every environment, including ones that
should never get a bootstrap admin (e.g. an ephemeral test database).

### Verifying seeded permissions

After seeding, confirm the built-in roles actually have the grants you expect
— either from the app itself (Administrator → Settings → Roles), or directly:

```
npx prisma studio
```

and inspect the `Role`, `Permission`, and `RolePermission` tables. There's no
separate CLI verification command — `prisma studio` is the fastest way to
eyeball this without writing a one-off script.

## When a migration fails partway through

Prisma wraps each individual migration file in a transaction, so a single
migration either fully applies or fully rolls back — you won't be left with
half of one migration's statements applied. But **Prisma does not automatically
reverse an already-applied migration** if a later one fails, and it has no
built-in "undo the last migration" command. If `migrate deploy` fails:

1. Read the actual error — most failures are a genuine schema conflict (e.g. a
   column that already exists from a previous partial run) or a data-loss-risk
   statement that needs the underlying data fixed first, not a Prisma bug.
2. Do not hand-edit rows in the `_prisma_migrations` table to force a failed
   migration to look "applied" unless you've personally verified the schema
   change it describes actually happened — this table is Prisma's own source
   of truth for what to run next, and a false entry here causes a *worse*
   drift later.
3. **Rolling back a bad migration means writing a new forward migration that
   undoes it**, or restoring the database from a backup taken before it ran
   (see `BACKUP_RESTORE.md`). There is no `prisma migrate down`.
4. For a genuinely broken deploy on Railway: fix forward locally, test against
   a fresh scratch database, commit the fix as a new migration, and redeploy.
   Only reach for a full database restore if the failed migration already
   corrupted data beyond what a forward fix can repair.

## Fresh-database check

Before trusting any of the above in production, verify the full migration
history applies cleanly to a brand-new, empty database — this is part of the
Phase F deployment gate (see `MODULE_10_REPORT.md`):

```
createdb trivialitycrm_scratch
DATABASE_URL=postgresql://.../trivialitycrm_scratch npx prisma migrate deploy
```

A fresh database is the strongest test that the committed migration history is
actually complete and correctly ordered — an existing dev database can mask a
missing migration if that column/table was added by hand at some point instead
of through a migration file.
