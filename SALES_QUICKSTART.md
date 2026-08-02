# Salesperson Quick Start

No technical background required. If something in the CRM ever asks you to
paste in a password, an API key, or a database link, stop and ask your
administrator — that should never happen.

## Signing in

Use the email and password your administrator set up for you. If you're
locked out, ask your administrator for a password reset link — never share
your password with anyone, including your administrator, to fix this.

## Your first few minutes

The **Getting started** checklist (checkbox icon in the header) is a short,
optional walkthrough tailored to what you're allowed to do — it won't ask you
to do anything an administrator should be doing instead. Check items off as
you go, or ignore it entirely; nothing in the CRM is blocked by it.

## Where to start every day: My Day

Your dashboard's My Day view is built to answer "what should I do right now?"
without you having to go hunting:

- Follow-ups that are overdue or due today
- Leads newly assigned to you that you haven't contacted yet
- Leads with no activity logged in a while
- A quick summary of your pipeline

Every item links straight to the company or the action it's about — there's
nothing here that's just a number for its own sake.

## Finding something

The search icon in the header searches companies, contacts, and competitors
at once — type at least 2 characters. Results are grouped by type; use the
arrow keys and Enter to jump straight to one without touching the mouse.

## Adding something quickly

The **Quick Add** button (header) is a fast path for a short form — a new
company, a contact on an existing company, a note, a logged activity, or a
follow-up — without leaving whatever page you're on. If you need more fields
than the quick form offers, it always has an "Open full form" link.

## Working a company

On any company's page:

- **Quick sales actions** at the top: one click each to log a call, email,
  meeting, demo, trial, a general note, or schedule a follow-up — no need to
  scroll down and find the right form first.
- **Next best action**: a short, plain-language list of what this company
  specifically needs next (e.g. "no contact on file," "a follow-up is
  overdue," "no activity in a while") — never an opaque score, and it never
  contacts anyone or changes the pipeline stage on its own. It's a suggestion,
  not an automation.
- **Activity timeline**: everything logged on this company, in order.
- **Follow-ups**: schedule, complete, or cancel. Completing one can prompt you
  to schedule the next one right away, so a lead never quietly falls through
  the cracks between visits.
- Changing the pipeline stage is a dropdown right at the top — no separate
  page needed.

## Sales Lists

A Sales List is a saved set of companies built from the same filters used
elsewhere (location, lead type, pipeline stage, EOS score, contact history,
and more). When you create one, you pick what it's for — a general list, a
**Calling List**, or an **Email Campaign** list — which changes what counts
as "eligible": archived, merged, or do-not-contact companies are always
excluded; a Calling List additionally needs a phone number on file; an
Email Campaign list additionally needs an active contact with an email
address who hasn't opted out or bounced, and excludes existing customers.
These eligibility rules can't be overridden — the preview table shows each
company as Eligible or Ineligible with a plain-English reason before you
save.

You choose **Fixed** (a frozen snapshot of companies you hand-pick, up to
5,000) or **Dynamic** (saves the filter itself and re-runs it — click
Refresh to see what's newly eligible or no longer matches; it won't
silently update on its own). Lists can be private, shared with specific
people, or shared with the whole team. Only you (or an admin) can edit or
archive your own list, and it can't be deleted outright once it has calling
or campaign history — archive it instead.

## Calling Sessions

From a Calling List, choose a call order (priority score, EOS grade, oldest
contact, most overdue follow-up, name, city, or pipeline stage) and click
**Start calling session**. You can only have one active session at a
time, and it's safe to close the tab or restart your browser — reopening
Calling Sessions always picks up right where you left off.

Each call screen shows the company, its primary contact with a
click-to-call link, recent activity, and open follow-ups. After the call,
pick a **Call Outcome** — your administrator defines what's available, and
some outcomes require notes or a rejection reason before you can save.
Saving an outcome can automatically create a follow-up, move the pipeline
stage, mark the company do-not-contact, or open the email composer for you
to review and send yourself — outcomes never send an email on their own.
You can **Pause** the session to come back later, **End session** early, or
**Skip** a company — either just for now (it comes back around later in the
same session) or permanently (it won't be offered again this session, and
nothing is recorded). If you need to fix a note on a call you already
logged, you can edit it afterward from the session overview — but the
outcome itself, and anything it triggered, won't re-fire.

## Email Campaigns (if you have access)

Built from an Email Campaign list. Give the campaign a name, tell the AI
what to write (free text, a reusable house instruction set, and/or a
template — at least one is required), and add one or more steps — a single
email, or a drip sequence where each step sends a set number of days after
the last. It can also be set to stop automatically once a company reaches
a chosen pipeline stage.

New campaigns start as a **Draft**. Click **Generate preview** to have the
AI write every recipient's message for every step up front, review it, then
**Approve** — this locks the messages in and does one final eligibility
check. You need a connected mailbox to approve a campaign, since you become
the sender. Once approved, choose **Send now** or **Schedule**, and you can
**Cancel** at any point before or during sending — anything already sent
stays sent. One thing that can look surprising: if a recipient replies or
becomes ineligible partway through a sequence, they're silently dropped
from the rest of it before their next step goes out — that's intentional,
not a bug. Results live under Reports → Campaigns.

## Connecting your email

Settings → Email Connections lets you connect your own business mailbox so
emails sent from the CRM come from you, and replies land back in your own
inbox:

- **Microsoft 365 / Outlook** and **Google Workspace / Gmail** connect via
  OAuth — click Connect, sign in, and the CRM only ever holds a revocable
  token, never your password. A personal (non-business) Outlook.com or
  Gmail.com account won't work for this — it needs a Microsoft 365 or Google
  Workspace business mailbox.
- **Titan Email** has no OAuth to connect through, so this is the one
  exception: the CRM stores an encrypted copy of your actual mailbox
  password to send through Titan's servers. Only use it if you're
  comfortable with that trade-off; Microsoft/Google are preferred when
  available. Titan also has no calendar API, so scheduling appointments from
  a company page isn't available while a Titan mailbox is connected — the
  Schedule button is hidden and existing appointments are read-only.
- Once connected, use the **Send test email** button on that page any time
  you want to confirm the connection is actually working before relying on
  it for a real send.
- Every outbound email automatically gets an unsubscribe link appended if
  your message doesn't already include one — you don't need to add it
  yourself.

## AI lead research (if you have access)

1. Under Leads, review or create a research prompt — this is what tells the
   AI what kind of business you're looking for.
2. Start a search: choose a location and lead type, and run it.
3. Review results: each one shows a quality score, why it scored that way,
   the evidence behind it (with source links where available), a confidence
   level, and a recommended next action. If a result's evidence panel is
   marked "Mock data," it came from the safe demo provider, not a real
   researched lead — never treat it as one.
4. Select the ones worth pursuing and transfer them into your pipeline as
   companies. Anything that looks like a duplicate of something already in the
   CRM is flagged before you commit, not after.

## On your phone

The company list, search results, My Day, login, and every company detail
page are all designed to work as cards on a narrow screen, not a table you
have to scroll sideways to read. If something looks cramped or unusable on
mobile, that's worth flagging — it's not intentional.

## A few things that are deliberate, not bugs

- Leaving a form with unsaved changes (closing the tab, reloading) will warn
  you first on the longer forms (adding/editing a company, editing a research
  prompt).
- Destructive actions (archiving a company, cancelling a scheduled email,
  merging records) always ask you to confirm first.
- You'll only ever see the companies/contacts you have permission to see —
  search, Quick Add, and every list respect that the same way.
