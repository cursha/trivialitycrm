# Changelog

Format: `v{release}.{version}`, bumped once per push to `main` (every push
is a production deploy). The release number goes up (and the version resets
to 0) when a push adds new functionality; the version number goes up when
something is fixed or improved. Same scheme as Gr8daybingo. See "Every
release gets a version number" in AGENTS.md.

The running version shows at the foot of the sidebar and on
Administration → System Health. Each release is tagged in git with its
number (`v2.1`).

Versioning started on 2026-10-04. Earlier entries were backfilled from git
history.

## v3.7 — 2026-10-05
### Added — My Day
- **My Day** (first in the menu) walks reps through the day as the sales
  process in seven steps: add new bars, fill in the info, plan the route
  and drop off flyers, follow up and book demos, run today's demos, look
  after trials, and check the scoreboard. Each step expands to show every
  way to do it (only what the rep is allowed to do) and the rep's bars
  waiting on it (Curt's call). The first step with work left opens on its
  own; a step shows a green check when nothing's left.
- Step 1 lists every way to add bars: Quick Add, the company form, Pub Lead
  Finder, Quick Search, AI research, Competition Locator, spreadsheet
  import, and reviewing search results.
- Step 3 lets reps add Local Target bars to their route without leaving the
  page.

## v3.6 — 2026-10-05
### Added — delete research prompts
- Leads → Research Prompts has a garbage-can icon to **delete** a prompt,
  next to edit, duplicate and archive/restore. It asks you to confirm
  first. Past searches keep their own copy of the prompt they used, so
  deleting one doesn't change any search history.

## v3.5 — 2026-10-04
### Fixed — duplicate companies matched on name alone
- A company was flagged as a possible duplicate just because another
  company had the same name, even in a different city. Now a **name** (or
  website) match only counts when the **city and province/state match**
  and the **street addresses don't conflict**. Two locations of the same
  chain (Boston Pizza in Oakville and Mississauga, or two on different
  streets in one city) are no longer flagged. A matching **phone**,
  **email**, or **street address + postal code** still flags on its own
  (Curt's call).
- Applies everywhere duplicates are checked: adding or editing a company,
  importing leads, transferring research results, Competition Locator,
  Pub Lead Finder, and the Data Quality scan.
- Pairs the Data Quality scan already flagged on name alone stay in its
  review list until dismissed; future scans won't flag them again.

## v3.4 — 2026-10-04
### Improved — trial wording: a new game each week
- A trial gives the bar **a new game each week**, which they can run as
  often as they like that week, one game at a time (Curt's call). It's no
  longer described as "one night a week": checklists, step bubbles,
  follow-up titles and the Sales Quick Start now say so, and reps agree
  which nights the bar will run it instead of a single trial night.
- Database: migration 20261005040000_trial_weekly_game (rewords existing
  text; applies on deploy).

## v3.3 — 2026-10-04
### Improved — the user manual is in the app
- **Administration → User Manual** shows the Sales Quick Start and the
  Admin Guide, with a tab for each. It reads the same files kept in the
  repo, so it's current with every release.

## v3.2 — 2026-10-04
### Improved — trial length per rep, and an updated user manual
- Managers set each rep's **trial length** (1 to 4 weeks, default 4) on the
  Manager page, next to their daily goals and timezone (Curt's call: by
  rep). A bar follows its assigned rep's trial length.
- The conversion follow-up is now due **a week before the trial ends**
  instead of a fixed 3 weeks in, and Trial Live check-ins that would land
  after a shorter trial has ended are skipped.
- Checklists, step bubbles and follow-up titles say "up to N weeks" using
  the bar's rep's trial length (`{{trialWeeks}}` in Settings → Pipeline
  Stages → Checklist & follow-ups), and follow-ups there can be set to
  "count back from the trial end".
- User manual (Sales Quick Start and Admin Guide) updated for the sales
  process: a step-by-step table for Local and Long-distance bars, trial
  length, the scoreboard, and where to find the version number.
- Database: migration 20261005030000_rep_trial_length (applies on deploy).

## v3.1 — 2026-10-04
### Improved — step descriptions and trivia history
- Each step on a company's Sales process card has a description bubble:
  hover over it, or tap it on a phone. Edit the wording under Settings →
  Pipeline Stages → Checklist & follow-ups.
- The Target step now starts with getting the manager's name, phone and
  email, and the bar's trivia history (Curt's call). Checklists you've
  already edited are left alone.
- Trials are offered for **up to 4 weeks** (Curt's call): checklists,
  descriptions and the conversion follow-up now say "up to 4 weeks" and
  "before the trial ends". Follow-ups already created are unchanged; the
  conversion follow-up is still due 3 weeks into Trial Live, so move it
  earlier for a shorter trial.
- New **Trivia history** field on the Bar intel card, carried over when
  companies are merged.
- Database: migrations 20261005010000_step_descriptions_trivia_history and
  20261005020000_trial_up_to_4_weeks (apply on deploy).

## v3.0 — 2026-10-04
### Added — a sales process to follow, for Local and Long-distance bars
- The pipeline stages are now the sales process: **Target → Introduced →
  Demo Booked → Demo Held → Trial Booked → Trial Live → Won / Lost**.
  Existing stages were renamed in place, so every bar keeps its place and
  history (New → Target, Material Sent → Introduced, Demo Given → Demo
  Held, Trial → Trial Live). Demo Booked and Trial Booked are new. "Booked"
  is hidden; bars already in it stay there.
- Every bar is **Local** (we visit in person) or **Long-distance** (phone,
  email, video). Same steps, different checklist and follow-ups.
  Long-distance bars can skip the demo and go straight to a trial, which
  they start by connecting online (Curt's call). Existing bars are Local.
- **Sales process card** on each company page: the step the bar is at, what
  to do now, and a button to move it to the next step.
- **Automatic follow-ups** when a bar enters a step, however it got there.
  Trial Live sets up night 1, the week-2 check-in, the week-3 early-yes ask,
  and the conversion meeting or call before week 4 ends.
- Visit outcomes move the bar to the matching step, **forward only**. When a
  move creates the step's follow-ups, they replace the outcome's own
  follow-up instead of doubling up.
- **Sales scoreboard**: each rep's visits, long-distance intros, demos
  booked, demos held and trials booked today against daily goals, on the
  Dashboard (your own) and the Manager page (everyone, with this week's
  totals). Managers set each rep's goals and timezone. Defaults: 10 visits,
  2 demos booked, 2 demos held, 1 trial booked.
- Settings → Pipeline Stages → **Checklist & follow-ups** to edit each
  step's checklist and automatic follow-ups.

### Changed
- Dashboard tiles now show Demos booked, Trials booked, Trials live and Won,
  found by each stage's role instead of its name. The Manager page's Active
  trials counts bars in Trial Live.
- Database: migration 20261005000000_sales_process (applies on deploy).

## v2.2 — 2026-10-04
### Changed — version numbers match the Gr8daybingo scheme
- Switched from three-part numbers (1.1.1) to `v{release}.{version}`, the
  same scheme as Gr8daybingo (Curt's call). Renumbered: 1.0.0 → v1.0,
  1.1.0 → v2.0, 1.1.1 → v2.1, with the git tags renamed to match.
- The sidebar now shows just the number (`v2.2`).

## v2.1 — 2026-10-04
### Added — version number in the app
- The release version shows at the foot of the sidebar for everyone (hover
  it for the exact build). Started this changelog and version tags.

## v2.0 — 2026-10-04
### Added — field sales: in-person bar visits

- **Log visit** quick action on the company page, with visit outcomes
  (Flyer Dropped, Spoke to Staff, Demo Booked, Demo Given on the Spot,
  Trial Booked, Already Has Trivia, Closed / Not a Fit, and more). Each
  outcome creates the right follow-up automatically.
- Booking a demo from a visit captures the date, time, length and contact,
  and can send a calendar invite.
- Titan mailboxes can now schedule appointments: they go out as standard
  calendar invite emails, with updated invites on reschedule or cancel.
  Appointments also have a location.
- **Bar intel** card: slowest night, typical crowd that night, current
  entertainment.
- Contact roles: decision-maker, champion, and best time to reach. These
  carry through company and contact merges.
- Settings → Call & Visit Outcomes: each outcome says whether it's offered
  for calls, visits or both, and whether it books a demo.

## v1.x post-launch updates — 2026-07-24 to 2026-09-22

Shipped continuously after launch, before version numbers were in use.
Highlights:

- **Lead finding:** Quick Search, Pub Lead Finder (radius search),
  Competition Locator (find venues by trivia competitor), paginated Google
  Places discovery, live search progress, and many accuracy and reliability
  fixes to AI discovery.
- **Opportunity analysis:** one-click AI opportunity analysis on the
  company page with trivia-specific competitive analysis and live progress.
- **Sales lists, calling sessions and email campaigns.**
- **Route Plan:** select companies, review, and export a CSV for route
  planning.
- **Email:** Titan Email as a third mailbox provider with test send, primary
  contacts, rich-text templates with logo insert, template duplicate,
  scheduled emails page, `{{today}}` placeholder, and an automatic
  unsubscribe footer.
- **Duplicates:** Replace / Merge / Ignore choices and fewer false matches.
- **Everyday polish:** set the date and time when logging an activity,
  Won/Lost outcomes on pipeline stages, postal code validation and
  formatting, full addresses on lead search results and the company list,
  and a show/hide password toggle on login.

## v1.0 — 2026-07-24

Version 1 launch: Modules One through Ten. CRM foundation, AI lead
discovery, sales workspace and pipeline, reporting and scheduled reports,
email and calendar (connections, templates, sequences, consent and
unsubscribe, inbound sync, notifications), data quality and record merging,
administration, integrations, and production deployment on Railway. See
`VERSION_1_ACCEPTANCE.md` and the `MODULE_*_REPORT.md` files for detail.
