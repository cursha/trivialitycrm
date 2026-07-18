# Module One Delivery Report

Triviality CRM Foundation with EOS-1.0 Data Structure — implemented on the `triviality-crm` branch per the approved plan (`abundant-moseying-dongarra.md`). **Nothing has been committed or pushed.** Module Two has not been started.

## Files changed

**Modified:**
- `.gitignore` — added `/src/generated` (regenerated Prisma client) and `!.env.example` (see Deviations)
- `package.json` / `package-lock.json` — new dependencies, `test` script
- `prisma/schema.prisma` — auth, EOS-1.0, evidence, history, and archiving additions (see below)
- `prisma/seed.ts` — rewritten as a real, idempotent Prisma seed script
- `src/app/page.tsx` — now a thin auth-checked redirect to `/dashboard`

**Deleted:**
- `src/lib/demo-data.ts` — replaced by real database-backed data throughout

**New (81 files under `src/app/(dashboard)/**`, `src/app/login/`, `src/app/change-password/`, `src/components/`, `src/lib/auth/`, `src/lib/companies/`, `src/lib/duplicates/`, `src/lib/eos/`, `src/lib/validation/`, `tests/`)** — the full CRM: auth, dashboard shell, Lead Type / Pipeline Stage / Competitor / User / Role admin, company CRUD, contacts, activities, follow-ups, EOS-1.0 evidence and scoring, dashboard stats, and the test suite. Also new at the root: `docker-compose.yml`, `prisma.config.ts`, `vitest.config.ts`, `.env.example` (updated), `src/proxy.ts`, `src/lib/prisma.ts`, `src/lib/nav.ts`, `src/lib/form-data.ts`.

## Migrations created

Three migrations under `prisma/migrations/`, all applied to both the dev and test databases:

1. `20260718022030_module_one_foundation` — the full Module One schema (auth, EOS-1.0, evidence, history, archiving) on top of the original models.
2. `20260718040049_company_normalized_phone_email` — added `Company.normalizedPhone`/`normalizedEmail`, needed once the duplicate-matching service was built (schema only had `normalizedName`/`websiteDomain` precomputed).
3. `20260718040450_company_updated_by` — added `Company.updatedById` (+ `User.updatedCompanies` relation) — the original schema had `createdById` but no equivalent "last updated by" field, which the spec requires ("Updated date and user").

## Packages added

| Package | Why |
|---|---|
| `bcryptjs` | Password hashing (cost factor 12) |
| `@prisma/adapter-pg`, `pg`, `@types/pg` | Prisma 7's driver-adapter model requires an explicit Postgres adapter (`pg` doesn't ship its own types, hence `@types/pg`) |
| `server-only` | Marks server-only modules so they can't be accidentally bundled client-side |
| `tsx` | Runs `prisma/seed.ts` (Prisma 7's `migrations.seed` command) |
| `vitest` | Test runner |

`@types/bcryptjs` was **not** installed — `bcryptjs` ships its own types.

## Tests run and results

`npm test` (Vitest, against the isolated test database, guarded by `tests/setup/test-db-guard.ts`):

```
Test Files  7 passed (7)
     Tests  65 passed (65)
```

Coverage: company CRUD, duplicate detection (block + Administrator-only override), automatic Pipeline Change activity on stage change (and no activity when unchanged), row-level scope enforcement (Salesperson/Manager/Administrator), reassign-permission gating, archive/restore/permanent-delete rules, multiple contacts per company, competitor location count (live `_count`, not stored), follow-up completion + create-next, the five follow-up views, EOS-1.0 history preservation (append-only, never overwritten) and the `currentHistoricalScoreId` pointer, EOS category-maximum/total/grade validation (pure unit tests), conflicting-classification and active-ranking-exclusion rules, the Pipeline Stage single-default invariant, session verification (valid/expired/disabled-user/logout), permission enforcement, and login rate limiting.

Not covered by automated tests: browser-driven UI interaction (see Remaining installation requirements).

## Build result

- `npx prisma format && npx prisma validate` — clean
- `npx prisma migrate status` — up to date
- `npx prisma db seed` run twice consecutively — idempotent (identical row counts both times; bootstrap admin creation correctly skipped with no credentials set)
- `npm run lint` — clean, no warnings
- `npx tsc --noEmit` — clean
- `npm run build` — clean production build; every protected route correctly renders dynamically (not statically prerendered), confirming `requireUser()` is actually gating them

## Remaining installation requirements

1. **A real login smoke test in a browser.** I verified `proxy.ts`'s redirect behavior via HTTP and every server action's logic via the Vitest integration suite (which drives the actual action functions against a real database, including the auth/session code path), but I have no browser tool available to click through the actual login form, dashboard, and company-creation UI myself. To do this yourself: set `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` in your `.env`, run `npx prisma db seed`, start `npm run dev`, and sign in.
2. Docker must be running locally for `docker-compose.yml`'s Postgres containers (dev on `5432`, test on `5433`).
3. No Lead Types, Competitors, or sample companies are seeded — create them through the UI after first login.

## Deviations from the approved plan

- **`.gitignore`'s pre-existing `.env*` pattern was also silently excluding `.env.example`** from every commit in this repo's history (it was never actually tracked, despite the README always describing it as part of the delivered foundation). Added a `!.env.example` negation so the setup template is actually committed going forward. This predates Module One but was only discovered while reviewing the diff for this report.
- **`Company.updatedById` was missing from the original schema** (§2 of the plan flagged the schema gaps I'd already found; this specific one — no field to satisfy "Updated date and user" — was found later, while building Company CRUD in task 10, not during the original review). Added it as migration 3.
- Everything else matches the approved plan; no changes to the auth architecture, role matrix, archiving/restore design, or EOS-1.0 data model as approved.
