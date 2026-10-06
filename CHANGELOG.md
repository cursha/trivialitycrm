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

## v8.1 — 2026-10-06
### Fixed — route export download on phones
- Exporting a route on an Android phone left a greyed-out download that
  wouldn't open (Curt hit it). The app let go of the file the instant the
  download started, before the phone's browser had saved it; it now holds
  on for a minute. Same fix for the Audit Log's CSV export.
- Sales Quick Start: "Route plans" says where the file lands on Android and
  iPhone.

## v8.0 — 2026-10-06
### Added — "Why this grade" on the sales analysis
- The opportunity analysis now explains the grade it gave (Curt's call).
  A **Why** box in the analysis results (it opens by itself when you
  analyze one bar) and on the company's EOS card shows:
  - the grade's range and how many points the next grade up needs
    ("EOS 72 of 100 is a B (B is 70–79). 8 more points would make it
    an A.");
  - the AI's reasons in 2–4 plain sentences — the analysis now tells the
    AI to explain why the bar landed at its score and grade;
  - the categories that **helped most** and the ones that **held it back**,
    each with its score and the newest evidence for it;
  - whether a confirmed "no TVs" set Turnkey readiness to 0.
- Older scores show the same box; their AI reasons are whatever the
  analysis wrote at the time. Re-analyze a bar to get the new wording.
- Sales Quick Start: "What's the EOS?" explains the Why box.

## v7.5 — 2026-10-06
### Fixed — Companies sort
- Sorting by **EOS score** or **Follow-up date** looked broken (Curt
  spotted it): on Descending, the database listed every bar without a
  score or follow-up first, so the first pages were all "—". Bars without
  one now always come last, in either direction.
- Bars that tie (same city, same score, imported at the same time) are now
  ordered by name, so the order is stable and paging no longer repeats or
  skips a bar.
- The sort controls now get the red highlight too when changed from Name,
  Ascending (Curt's call). Sales Quick Start updated.

## v7.4 — 2026-10-06
### Improved — active Companies filters are red and shaded
- Filters that are on now have a red outline (was blue in v7.2) and light
  red shading, with the bold text, so they stand out more (Curt's call).
  Sales Quick Start updated to match.

## v7.3 — 2026-10-06
### Improved — User Manual catches up with v7.1 and v7.2
- Sales Quick Start: "Route plans" now explains that **Add Selected to
  Route** asks which route (it still said bars went to the current route),
  and "Finding something" explains the blue outline on Companies filters
  that are on.

## v7.2 — 2026-10-06
### Improved — Companies filters show which ones are on
- On the Companies page, any filter that's narrowing the list (lead type,
  stage, salesperson, competitor, trivia status, follow-up, grade,
  likelihood, confidence, classification, Archived, or a search) now has a
  blue outline and bold text (Curt's call). Filters left on "All"/"Any"
  look as before, and so do the sort controls.

## v7.1 — 2026-10-06
### Fixed — "Add Selected to Route" now asks which route
- Bulk-adding from Companies or a Pipeline list used to put every selected
  bar on your current route without asking (Curt spotted it). It now opens
  the same picker as a single bar: one of your routes, or a new route named
  on the spot (with an optional day). The current route is picked by
  default, and adding elsewhere doesn't change which route is current.
- If the chosen route can't take the selection (wrong lead type or
  country), nothing changes. The "Export current route first" / "Clear
  current route and start new" choices are only offered when the conflict
  is with your current route; otherwise you pick another route.
- A rejected add to a new route no longer leaves an empty route behind
  (bulk or single bar).

## v7.0 — 2026-10-06
### Added — find venues with trivia or karaoke on Quick Search
- Quick Search has **Trivia** and **Karaoke** checkboxes under "Only venues
  that offer" (Curt's call). Tick one to find venues offering it, or both
  for trivia and/or karaoke; leave both blank to list every venue as
  before. Each ticked box is its own directory search per city, and the
  results are merged without duplicates.
- It's the directory's best guess from listings and reviews, so a venue
  found this way isn't marked as running trivia.
- The search's page and the Quick Search summary show what it was
  narrowed to.
- Sales Quick Start: new Quick Search section.
- Database: migration 20261006104701_quick_search_entertainment (adds the
  ticked options to each search; applies on deploy).

## v6.0 — 2026-10-06
### Added — follow-up date when logging an activity
- **Log activity** on a company page has an optional **Follow up on** date
  and title (Curt's call: optional). It creates the follow-up together with
  the activity, for the bar's owner, so there's no separate step afterwards.
- The **activity timeline** shows each follow-up on the entry it came from,
  with its date and title: red when overdue, crossed out when done or
  cancelled. Follow-ups created by visit and call outcomes show there too.
  Follow-ups made before this release aren't linked, so older entries don't
  show one.
### Added — Visit website quick action
- The company page's quick actions always have a website button: **Visit
  website** when one is on file, or **Find website** (a web search for the
  bar's name and city) when not. It used to be hidden without a website.
- Websites saved without `https://` (common from AI research and imports)
  now open properly instead of going nowhere, and anything that isn't a
  web address is never turned into a link.
### Fixed — follow-up dates showed a day early
- A follow-up picked for Oct 9 was saved as midnight UTC, which is the
  evening of Oct 8 in Toronto and Colorado Springs, so it showed as Oct 8.
  New follow-up dates are saved at midday so they show on the day picked,
  and the follow-up lists show dates the same way.
### User manual
- Sales Quick Start: a "Why Triviality CRM exists" section up front (a good
  process works; Curt's words), and the follow-up date on Log activity.
- Admin Guide: transferring a user's companies and follow-ups (Manage),
  deleting research prompts, and how duplicate companies are matched.
- Database: migration 20261006100244_activity_follow_up (adds an optional
  link from a follow-up to its activity; applies on deploy).

## v5.1 — 2026-10-06
### Fixed — password hashes no longer reach the browser
- Company pages loaded the full user record of whoever logged an activity
  or owned a follow-up, including their password hash, and passed it to
  the browser in the page data. It wasn't shown on screen but anyone
  signed in could read it with developer tools. Other pages load full user
  records the same way and may have done the same.
- The database client now never returns a password hash unless the code
  explicitly asks for it (only login and change password do), so this is
  closed everywhere at once, including pages not yet audited.
- The company timeline, follow-ups, pipeline cards and sales lists now load
  only the user's name.
- A new test fails if a password hash is ever returned by default.

## v5.0 — 2026-10-05
### Added — the sweet spot
- A green **Sweet spot** badge marks the bars most likely to buy: an
  independent bar (not a chain at 3+ locations in the CRM), no hosted
  trivia now, TVs not ruled out, and an EOS of 60 to 89. The very best
  trivia venues usually buy hosted trivia or follow head office, so the
  sweet spot is the good-but-not-perfect independent bar (Curt's call).
- Nothing is ruled out: every other bar's score card shows "Less likely,
  still worth working" with the reasons.
- **Sweet spot only** filter on the Companies list; My Day lists
  sweet-spot bars first in Steps 2 to 4, with the badge.

## v4.1 — 2026-10-05
### Added — EOS spelled out
- EOS now reads as the **Entertainment Opportunity Score** (Curt's call):
  the company page's score card is titled "Entertainment Opportunity Score
  (EOS)", the Dashboard card says so, and hovering "EOS" in tables and
  badges shows the full name.
- Sales Quick Start: new "What's the EOS?" section.

## v4.0 — 2026-10-05
### Added — multiple route plans
- Each person can keep **several named routes**, one per day or area
  (Mississauga today, Milton tomorrow, Hamilton on Friday), each with an
  optional day (Curt's call). Routes stay private to their owner.
- **Add a bar to a specific route** from its company page or My Day ("add
  this to my Burlington route"), or start a new route right there. A bar
  can be on more than one route, and each route tag has a × to remove it.
- **Route Plan** shows one route at a time with a switcher to change
  routes, create one, rename or re-date it, or delete it. The export is
  named after the route and dated by its day.
- My Day's Step 3 lists Local Target bars that aren't on any of your
  routes yet.
- Everyone's existing route is kept as "My route".
- Database: migration 20261005050000_multiple_route_plans (applies on
  deploy).

Version note: from here on, new functionality bumps the release number
(v4.0) as the versioning rule says; v3.6 to v3.8 added features but only
bumped the version number.

## v3.9 — 2026-10-05
### Fixed — Manage on Settings → Users
- **Manage** next to a user didn't open properly, so the ownership
  transfer (move a user's companies and open follow-ups to someone else)
  couldn't be reached. The panel now opens under the right user and loads
  what they own once.

## v3.8 — 2026-10-05
### Added — rename users
- Settings → Users has a pencil next to each name to rename the user. The
  first account the CRM creates is named "Administrator", so companies
  assigned to Curt showed "Administrator"; renaming the account fixes that
  everywhere at once. Renames are recorded in the audit log.

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
