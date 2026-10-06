# Administrator Guide

For the person setting up and running Triviality CRM day to day — not a
developer reference. For deployment/infrastructure topics, see `RAILWAY.md`,
`ENVIRONMENT_VARIABLES.md`, `MIGRATIONS_AND_SEEDING.md`, `BACKUP_RESTORE.md`,
and `INCIDENT_RESPONSE.md` instead.

Why the CRM exists, and the sales process it's built around, is at the top
of the Sales Quick Start: a good process works.

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
   The stages are also the **sales process** (Target → Introduced → Demo
   Booked → Demo Held → Trial Booked → Trial Live → Won / Lost). On the
   Pipeline Stages page, **Checklist & follow-ups** opens each step's
   description (the bubble reps see when they hover over or tap the step),
   its checklist (what reps see on the company page, separately for Local and
   Long-distance bars) and its automatic follow-ups (created when a company
   enters the step, for all bars or one kind only, due a set number of days
   later, or a set number of days **before the trial ends** with "Count back
   from the trial end"). In any of this text, `{{trialWeeks}}` is replaced
   with the bar's rep's trial length (e.g. "up to {{trialWeeks}} weeks
   free"). Edits apply from then on; follow-ups already created are left
   alone. Renaming a step is safe: the process, dashboard counts and
   scoreboard find steps by their role, not their name.
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

## Sales Lists, Calling Sessions, and Campaigns

- **Call & visit outcomes** (Settings → Call & Visit Outcomes,
  `manage_call_outcomes`): the set of outcomes salespeople choose from after
  a call in a calling session or an in-person visit. Each outcome says where
  it's offered (calls, visits, or both); a visit outcome can also **book a
  demo**, which makes the visit form ask for the demo date and time. The
  seed ships a starting set of visit outcomes (Flyer Dropped, Spoke to
  Staff, Demo Booked, Trial Booked, Already Has Trivia, Closed / Not a Fit,
  plus Not Interested and Do Not Contact shared with calls). For each one you
  control whether notes or a rejection reason are required, whether it
  auto-creates a follow-up (with a default title and days-out), moves the
  pipeline stage, applies do-not-contact, opens the email composer, or
  permanently removes the company from that calling session — plus which
  progress category it counts toward (Unreachable / Interested / Demo
  Requested / Not Interested). Outcomes can be reordered or deactivated
  without deleting call or visit history that already used them.
- **Reusable campaign instructions** (Settings → Campaign Instructions,
  `manage_campaign_instructions`): house-wide tone/guidance text any
  campaign creator can apply on top of, or instead of, their own
  instructions — useful for keeping AI-generated campaign copy consistent
  without every sender having to write the same guidance from scratch.
- Only Administrators can edit or delete another user's Sales List
  (`manage_all_sales_lists`) or export leads; regular users manage their own
  lists only.
- Campaign creation, sending, and campaign reports (`/reports/campaigns`)
  require permissions most Manager-level roles have by default but
  Salesperson does not — review Settings → Roles if someone needs (or
  shouldn't have) that access.
- A campaign can only be approved (locking in the AI-generated messages
  before sending) by someone with a connected mailbox, since they become
  the sender of record — see "Email connections" below.

## Sales scoreboard, daily goals and trial length

The Manager page shows every rep's scoreboard (anyone whose role can edit
leads): today's visits, long-distance intros, demos booked, demos held and
trials booked against their daily goal, plus this week's totals.

Under **Daily goals & trial length**, click **Edit** next to a rep to set:

- **Daily goals.** Reps with none saved get the defaults: 10 visits, 2
  demos booked, 2 demos held, 1 trial booked. A goal of 0 hides that number
  from the rep's own scoreboard unless they do some.
- **Trial length** (1 to 4 weeks; default 4). A bar's trial follows the
  trial length of the rep it's assigned to: the conversion follow-up is due
  a week before the trial ends, Trial Live check-ins that would land after
  the trial are skipped, and the checklists say "up to N weeks". It applies
  the next time one of the rep's bars enters a step; follow-ups already
  created don't move.
- **Timezone**, so a Colorado Springs rep's "today" is Mountain time.

## User manual

Administration → **User Manual** shows this guide and the Sales Quick
Start in the app. They're the `ADMIN_GUIDE.md` and `SALES_QUICKSTART.md`
files in the repo, so editing those (and releasing) updates the page.

## Versions and the changelog

Every release to production gets a number (`v{release}.{version}`, e.g.
v3.2), shown at the foot of the sidebar and on Administration → System
Health. `CHANGELOG.md` lists what changed in each one, and the release
steps are in `AGENTS.md`.

## Managing users and roles

- Settings → Users: create/deactivate accounts, assign role and territory,
  generate a password-reset link for someone who's locked out (never ask them
  to email or message you their password — you generate a reset link instead).
- **Rename a user** with the pencil next to their name on Settings → Users.
  The first account the CRM creates is named "Administrator"; rename it to
  the person's real name. Everything assigned to that user shows the new
  name right away.
- **Hand a user's work to someone else** (they're leaving, or changing
  territory): click **Manage** next to them on Settings → Users. It shows
  how many active companies and open follow-ups they own. Choose a person
  under **Transfer to…** and click **Transfer**; after you confirm, all of
  them move at once.
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
- Anyone with `view_administration` also sees a running today's-spend/
  this-month's-spend card right on the Dashboard, with a "Manage →" link
  straight to AI Settings — you don't need to visit Administration just to
  check spend at a glance. It shows "No budget configured" until you set a
  daily or monthly cap.
- Leads → **Research Prompts**: edit, duplicate, archive/restore, or delete
  a prompt (the garbage can; it asks you to confirm). Past searches keep
  their own copy of the prompt they used, so deleting one never changes
  search history.

## Email connections (per-user)

Settings → Email Connections (`connect_mailbox`) is where each user connects
their own mailbox — there's no admin-side provisioning step. Microsoft 365 /
Outlook and Google Workspace / Gmail connect via OAuth (revocable token
only). Titan Email is the one exception: it has no OAuth, so the CRM stores
an encrypted copy of the user's actual mailbox password to authenticate over
SMTP — worth knowing before recommending it to your team, since it's a
different trust model than the other two. Titan connections also can't use
the in-app calendar/appointment scheduling (no calendar API), so that UI is
hidden automatically for Titan-connected users.

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

How the CRM decides two companies might be the same bar (everywhere it
checks: adding or editing a company, imports, research results, Competition
Locator, Pub Lead Finder, and the scan):

- A matching **phone**, **email**, or **street address + postal code** is
  enough on its own.
- A matching **name** (or website) only counts when the **city and
  province/state match** and the street addresses don't conflict. Two
  locations of the same chain, such as Boston Pizza in Oakville and in
  Mississauga, are not flagged.

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
