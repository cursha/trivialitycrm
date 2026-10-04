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
