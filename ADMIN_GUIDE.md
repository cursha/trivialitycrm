# Administrator Guide

For the person setting up and running Triviality CRM day to day — not a
developer reference. For deployment/infrastructure topics, see `RAILWAY.md`,
`ENVIRONMENT_VARIABLES.md`, `MIGRATIONS_AND_SEEDING.md`, `BACKUP_RESTORE.md`,
and `INCIDENT_RESPONSE.md` instead.

## First login

Sign in with the administrator account created during setup (see
`MIGRATIONS_AND_SEEDING.md`). The **Getting started** checklist (the checkbox
icon in the header) walks through initial setup in order — it's tailored to
your permissions, so an ordinary salesperson signing in later won't see the
admin-only steps. Nothing on it is required or blocking; it's there to help,
not to gate.

## Initial setup, in order

1. **Organization settings** (Administration → Organization): your
   organization's name, default country/region/timezone/currency/date format,
   and default lead type/pipeline stage for new companies.
2. **Lead types and pipeline stages** (Settings → Lead Types / Pipeline
   Stages): confirm these match how your team actually sells before anyone
   starts adding real companies — changing them later is fine, but existing
   companies keep whatever they were assigned at the time.
3. **Competitors** (Competitors, in the main nav): the list your AI research
   and reports can flag/track against.
4. **Users and roles** (Settings → Users / Roles): the built-in roles ship
   with sensible permission grants — review Settings → Roles before creating
   custom ones so you're not duplicating something that already exists.
5. **AI and email integrations**: both default to a safe "mock" mode that
   needs no API key and makes no real external calls or sends.
   - **AI research**: going live needs `AI_PROVIDER=anthropic` and
     `AI_API_KEY` set (see `ENVIRONMENT_VARIABLES.md`), plus "Research
     enabled" switched on from the AI Settings admin page
     (`manage_ai_settings`) — which also holds the live daily/monthly/
     per-search budget caps and per-user daily search limit, all editable
     without a redeploy. (`AI_DAILY_BUDGET_USD`/`AI_MONTHLY_BUDGET_USD`
     environment variables only seed the *initial* value the first time this
     settings row is created — after that, the admin page is the only thing
     that matters.)
   - **Transactional email**: going live needs `EMAIL_PROVIDER=resend` and
     its related variables set, plus "Email sending enabled" switched on from
     the Integrations admin page (`manage_email_integration`). Both toggles
     can be flipped back off at any time without touching environment
     variables or redeploying — useful mid-incident (see
     `INCIDENT_RESPONSE.md`).

## Managing users and roles

- Settings → Users: create/deactivate accounts, assign role and territory,
  generate a password-reset link for someone who's locked out (never ask them
  to email or message you their password — you generate a reset link instead).
- Settings → Roles: each role is a named set of permission grants. Duplicate
  an existing role as a starting point rather than building one from scratch.
- The system prevents removing the last active Administrator — you cannot
  lock yourself (or everyone) out of admin access by accident.

## AI research and email — safe operation

- Both AI research and transactional/system email default to mock providers
  that need no credentials and make no external calls. This is intentional —
  the app, its tests, and a fresh local setup should never accidentally make a
  paid call or send a real email.
- Once a live provider is configured (environment variables) **and** enabled
  (AI Settings' "Research enabled" toggle, or Integrations' "Email sending
  enabled" toggle), you can disable it again from that same page at any time
  without a deploy — useful during an incident (see `INCIDENT_RESPONSE.md`)
  or just to pause spend.
- The AI Settings page's daily/monthly/per-search budget caps and per-user
  daily search limit stop new AI activity once exceeded, mid-run included —
  a search that hits its per-search cap mid-way still keeps whatever it had
  already found, it just stops finding more.
- The Integrations page shows recent AI/email usage and any recent provider
  errors — check here first if something AI/email-related seems off.

## System Health and background jobs

Administration → System Health shows: web status, database connectivity, the
worker's heartbeat freshness, recent migration status, and any recently failed
background jobs (with a retry action, where eligible). If the worker heartbeat
goes stale for more than a few minutes, every user who can manage background
jobs gets an automatic email alert — no need to keep this page open just to
notice.

## Audit log

Administration → Audit Log records administrative actions — user/role
changes, settings changes, and similar — not routine CRUD on companies/
contacts (that has its own activity history on each record instead). Useful
for "who changed X and when."

## Data quality administration

Data Quality → Rules/Scans: configure and trigger duplicate-detection scans.
Reviewing and merging actual duplicate records is available to anyone with the
right permission, not just administrators — see the in-app Data Quality
workspace.

## Backups

Confirm what backup tier your Railway Postgres plan includes, and take a
manual on-demand backup before any migration that touches production (see
`BACKUP_RESTORE.md` for the full procedure and the restore drill). This is a
Railway-dashboard action — there's no in-app "backup now" button, deliberately,
since an application-level trigger for something this consequential would
itself be a risk.

## During an incident

See `INCIDENT_RESPONSE.md`. The short version: check System Health and
Integrations first, disable live AI/email from the Integrations page if a
provider is actively misbehaving, and don't reach for a database restore
unless data itself (not just availability) is actually at risk.
