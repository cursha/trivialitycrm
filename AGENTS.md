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

# Every release gets a version number

Same scheme as the Gr8daybingo project (its Constitution §10).

- **Every push to `main` gets a new number.** No update goes live without
  one — code, text-only changes and fixes alike.
- **Format: `v{release}.{version}`** (e.g. `v2.1` = release 2, version 1).
  - **The release number goes up when there is new functionality**, and the
    version resets to 0 (`v2.1` → `v3.0`).
  - **The version number goes up when something is fixed or improved**
    (`v2.1` → `v2.2`).
- **One number per push.** Several changes pushed together share one
  number; if any of them is new functionality, the release number goes up.
- **The version lives in `src/lib/version.ts`** (`APP_VERSION`) and shows at
  the foot of the sidebar and on Administration → System Health.
  `package.json`'s `version` is unused.
- **`CHANGELOG.md` gets an entry for every number**, newest at the top: the
  version, the date it ships, and in plain words what changed and why,
  including "Curt's call" where it was his decision.
- **The commit message names the version**, e.g.
  `Add walk-in pipeline stages (v3.0)`.
- **Tag the deployed commit** `v{release}.{version}` after the push to
  `main` succeeds, and push the tag (`git push origin v3.0`; tags don't
  trigger a deploy).
- **Documentation-only changes** that don't touch the app (AGENTS.md, guides)
  don't need a version bump, but note they still deploy when pushed to
  `main`.
