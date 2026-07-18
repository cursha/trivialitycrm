# Triviality CRM

AI-assisted North American lead research and sales CRM for Triviality.

## Module One: CRM foundation with EOS-1.0 data structure

Module One turns the original interface mockup into a working, database-backed CRM:

- PostgreSQL/Prisma data model for companies, multiple contacts, editable Lead Types, Pipeline Stages, competitors, users, roles and permissions
- Custom, DB-backed session authentication (no public registration; Administrators create accounts) with account lockout, forced password change for admin-created users, and full server-side authorization on every page and action
- Table-driven roles and permissions, editable from Settings
- Company CRUD with search, sort, filter, pagination, archive/restore, and admin-only permanent delete
- Duplicate-matching service (name, address, website domain, phone, email) that blocks silent duplicates and lets an Administrator override with confirmation
- Sales activity timeline, with an automatic "Pipeline Change" activity whenever a company's stage changes
- Follow-up tasks with Due Today / Upcoming / Overdue / Completed / No-Follow-Up views, and a combined complete-and-create-next flow
- EOS-1.0 database structure: per-company summary fields, category-scored historical score records (append-only), and evidence records — manual entry only; no AI scoring engine yet
- Database-driven dashboard totals

Not in Module One (by design): live AI research, AI score generation, web search, spreadsheet import, email integration, production hosting.

## Installation

1. Install [Node.js 20+](https://nodejs.org/), [Docker](https://www.docker.com/) (for local Postgres), and Git.
2. Run `npm install`.
3. Copy `.env.example` to `.env`. The default values match `docker-compose.yml`'s local dev database — only change them if you're pointing at a different Postgres instance. Leave `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` blank for now.
4. Start local Postgres: `docker compose up -d postgres-dev`.
5. Run `npx prisma generate`.
6. Run `npx prisma migrate dev`.
7. Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in your `.env` to create your own bootstrap Administrator account (choose your own password — nothing here generates one for you).
8. Run `npx prisma db seed`. This creates Pipeline Stages, Rejection Reasons, Roles, Permissions, the default Role→Permission grants, and your bootstrap Administrator. It's safe to re-run — it skips anything that already exists.
9. Run `npm run dev` for local use, or `npm run build && npm start` for production.
10. Sign in with the email/password you set in step 7. No Lead Types or Competitors are seeded — create them from Settings once you're in.

## Running tests

Tests run against a **separate** database from your dev data — never your `DATABASE_URL`.

1. Start the test database: `docker compose up -d postgres-test`.
2. Copy `.env.test`'s `TEST_DATABASE_URL` value (see `.env.example` for the default matching `docker-compose.yml`) into a local `.env.test` file if you haven't already.
3. Apply migrations to it: `DATABASE_URL="<value of TEST_DATABASE_URL>" npx prisma migrate deploy`.
4. Run `npm test`.

A safety guard (`tests/setup/test-db-guard.ts`) refuses to run any destructive test setup unless the resolved database is unambiguously named as a test database and is separate from your dev `DATABASE_URL` — misconfiguring this fails loudly instead of touching the wrong data.

## Core data rules

- A company has one Lead Type, one Pipeline Stage, one assigned salesperson, and zero or one competitor.
- Competitor location counts are calculated live from linked companies — never stored.
- Contacts are separate records, allowing multiple contacts per company.
- Deleting a company archives it by default, preserving its contacts, activities, follow-ups, and scoring history. Only an Administrator can permanently delete an already-archived company.
- Duplicate candidates are blocked before creation or edit; only an Administrator can override, with explicit confirmation.
- EOS-1.0 historical score records are append-only — a new score never overwrites a prior one. `Company.currentHistoricalScoreId` is the single source of truth for which record is "current."
- Existing customers and do-not-contact companies are excluded from active-prospect ranking queries.

## Permissions

All roles and permission grants are stored in the database (`Role`, `Permission`, `RolePermission`) and editable from Settings → Roles & Permissions — nothing is hardcoded. The seeded defaults:

- **Administrator** — every permission.
- **Manager** — view/add/edit/reassign leads within their own team.
- **Salesperson** — view/add/edit leads assigned to them.

## Service adapters still requiring credentials

The live AI prompt interview, business web research, and email delivery are **not implemented in Module One** and must be connected in a future module. Keep any provider credentials only in environment variables; never commit them.
