<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Pushing to main deploys to production — READ BEFORE `git push`

Both Railway services (`trivialitycrm` web app at trivialitycrm.com, and
`trivialitycrm-worker`) are connected directly to this repo via Railway's
native GitHub integration. There is no `.github/workflows` file and no CI
gate of any kind — a push to `main` is picked up and deployed automatically,
with no separate approval step on Railway's side.

**Critically**: the web service's Pre-Deploy Command is
`npx prisma migrate deploy && npx prisma db seed` (see `RAILWAY.md`). This
runs against the live production database on every single deploy. So
**pushing to `main` is not just a git action — it is an immediate live
production deploy plus a real schema migration and reseed**, whether or not
that was the intent.

This rule exists because an AI session pushed a feature commit to `main`
expecting only a git push, and it silently triggered a full production
deploy + migration on Railway with no separate confirmation step — the
commit/push and the deploy were assumed to be two different, separately
approved actions, but on this repo they are the same action.

**Before running `git push` to `main`:**
1. Confirm the change has already been fully tested locally (migration
   applied and verified against `TEST_DATABASE_URL`, tests passing).
2. Get explicit confirmation that the user wants this **live in production
   right now**, not just committed — treat "commit and push" and "deploy to
   production" as requiring the same explicit sign-off on this repo, since
   Railway makes them inseparable.
3. If a schema migration is involved, call that out specifically as part of
   the confirmation — this isn't a staged/reviewed migration, it applies
   directly to production the moment the deploy's Pre-Deploy Command runs.

Pushing to any other branch does not trigger a deploy — only `main` is wired
to Railway's watched branch.
