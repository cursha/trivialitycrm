# Changelog

Every release to production (a merge to `main`, which auto-deploys via
Railway) gets a version number here, in `package.json`, and as a git tag
(`vX.Y.Z`). The running version shows at the foot of the sidebar and on
Administration → System Health.

- **Minor** (1.**2**.0): new features or workflow changes.
- **Patch** (1.1.**1**): fixes and small tweaks.

Versioning started with 1.1.1. Earlier entries were backfilled from git
history; their tags point at the deployed commit, but the `package.json` in
those commits still says `0.1.0`.

## 1.1.1 (unreleased)

- The release version now shows at the foot of the sidebar for everyone
  (hover it for the exact build).
- Started this changelog and version tags.

## 1.1.0 (2026-10-04)

Field sales: in-person bar visits.

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

## 1.0.x post-launch updates (2026-07-24 to 2026-09-22)

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

## 1.0.0 (2026-07-24)

Version 1 launch: Modules One through Ten. CRM foundation, AI lead
discovery, sales workspace and pipeline, reporting and scheduled reports,
email and calendar (connections, templates, sequences, consent and
unsubscribe, inbound sync, notifications), data quality and record merging,
administration, integrations, and production deployment on Railway. See
`VERSION_1_ACCEPTANCE.md` and the `MODULE_*_REPORT.md` files for detail.
