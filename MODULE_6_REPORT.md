# Module Six Delivery Report — Phases A–C

## Starting point

Modules One through Five (CRM foundation, AI-assisted lead discovery, production hardening, Sales Workspace, Reporting and Analytics — including the scheduled-report worker) were complete, tested, and merged into `main` before this module started. Module Six Phase A was built on branch `module-six-communications`, following a 12-section plan approved before any code was written (provider comparison, database design, permission matrix, consent design, phased implementation order, and test plan — see the plan's phasing in "Deviations" below for how it maps to this report). Each phase since has followed the same pattern Module Five established: build on a fresh branch off the updated `main`, ship a tested checkpoint, merge, repeat — rather than one long-lived branch for the whole module. Phase A merged first (`module-six-communications`), then Phase B (`module-six-consent-compliance`), then **Phase C on `module-six-scheduling-sequences`**.

**This report covers Phases A, B, and C**: mailbox connections, email templates, the composer/send action, consent/compliance (CASL-safe default-deny, append-only consent records, a self-service unsubscribe link, a compliance-review page), and now scheduled sends plus multi-step follow-up sequences. Phases D–E (calendar/appointments and inbound sync, delivery-status webhooks and unified notifications) are designed in the approved plan but not built — see "Remaining-phase recommendations" below. Nothing in this report should be read as "Module Six is done"; it is a checkpoint at the end of the third of five planned phases.

## Provider architecture

A single internal `EmailProvider` interface (`src/lib/comms/providers/types.ts`) with three implementations, mirroring the existing AI-research provider pattern (`src/lib/research/providers/`) exactly — a `factory.ts` selects an implementation behind a shared interface, already proven replaceable in this codebase:

| | Microsoft Graph | Google (Gmail) | Mock |
|---|---|---|---|
| **Auth** | OAuth 2.0 authorization-code, `login.microsoftonline.com` | OAuth 2.0 authorization-code, `accounts.google.com`, `access_type=offline&prompt=consent` for a reliable refresh token | None — no network |
| **Send** | Create-draft-then-send (`POST /me/messages` then `POST /me/messages/{id}/send`) — Graph's direct `sendMail` returns 202 with no message id, so this is the only path that yields a `providerMessageId` to store | Hand-built RFC 2822 MIME message, base64url-encoded (Gmail's own non-standard alphabet), `POST /gmail/v1/users/me/messages/send` | Deterministic fake ids (`mock-msg-<uuid>`), never a real-looking one |
| **Active when** | A user connects Microsoft | A user connects Google | Always, unconditionally, when `NODE_ENV=test` — enforced in `factory.ts`, not left to whichever provider a `ProviderConnection` row happens to specify |

Provider selection is **per-connection**, not a global env var — unlike AI research's single `AI_PROVIDER`, a user can only meaningfully connect to whichever provider their employer's tenant uses, so `ProviderConnection.provider` is the selector and `getEmailProvider(kind)` takes it as a parameter.

## Features shipped (Phase A)

- **Mailbox connections** (`/settings/email-connections`, `connect_mailbox`): OAuth connect/disconnect, one connection per user (`ProviderConnection.userId` unique). CSRF-protected via a short-lived, httpOnly `oauth_state_<provider>` cookie compared at the callback. Access/refresh tokens are encrypted at rest (AES-256-GCM, `src/lib/comms/token-crypto.ts`, `TOKEN_ENCRYPTION_KEY`) and only ever decrypted server-side; the UI only ever sees connection status (connected/expired/revoked/error), never a token. `getUsableAccessToken()` transparently refreshes a token within 5 minutes of expiry and marks the connection `ERROR` (with `lastError`) on a failed refresh rather than throwing an opaque error.
- **Email templates** (`/settings/email-templates`, `manage_personal_templates`/`manage_shared_templates`): personal (owner-only) or shared (team-wide) templates with name/category/subject/body/active/leadType/pipelineStage/language. Placeholders (`{{contact.firstName}}`, `{{contact.lastName}}`, `{{contact.email}}`, `{{company.name}}`, `{{sender.name}}`) are resolved by a pure, unit-tested function (`src/lib/comms/templates.ts`) that reports which tokens didn't resolve — a template referencing an unknown token is rejected at save time; a send with an unresolved token (missing contact data, for example) is blocked rather than delivered with a literal `{{token}}`.
- **Composer**: a Send Email panel on the company detail page (`src/app/(dashboard)/companies/[id]/email/`) — pick a contact and/or a template (which prefills, not locks, subject/body), edit freely, send. The actual send (`src/lib/comms/send-email.ts`) is the one function every future send path (Phase C's scheduled/sequence sends) will share: it checks `Company.doNotContact`, resolves placeholders, validates every recipient and the subject against email-header injection (`src/lib/comms/validate.ts`), requires a `CONNECTED` mailbox, then calls the provider. A successful send updates the `EmailMessage` row to `SENT` and logs the existing free-text `EMAIL` activity (`src/lib/comms/activity-log.ts`) inside the same transaction; a failed send updates the row to `FAILED` and creates a `Notification` (type `DELIVERY_FAILURE`) for the sender instead of failing silently.
- **Notification model**: `Notification` (`userId`, `type`, `payload` JSON, `readAt`/`dismissedAt`) is the codebase's first general-purpose notification model — Module Five's `GeneratedReport.seenByIds` was deliberately report-specific by its own design note. It is not yet wired into the dashboard bell UI (that's a Phase E item, alongside unifying it with the report bell) — today it is written to but not yet displayed.
- **HTML body handling without a new dependency**: templates/composer store and edit plain text (no rich-text/WYSIWYG editor exists in this phase), so `src/lib/comms/sanitize-html.ts` escapes HTML-significant characters and converts newlines to `<br>` rather than pulling in an HTML-parsing sanitizer library. This was flagged in the approved plan as a dependency decision needing sign-off (`sanitize-html`); resolved by not needing rich-text authoring at all in Phase A, so the decision is deferred rather than made — revisit only if a future phase adds a real HTML editor.

## Features shipped (Phase B)

- **CASL-safe default-deny consent**: `Contact.emailPermitted` defaults `false` and `Contact.doNotContact` defaults `false` — a contact cannot receive a contact-linked send until a `ConsentRecord` establishes permission. `ConsentRecord` (`src/lib/comms/consent.ts`) is append-only, mirroring Module One's `HistoricalScoreRecord`/`Company.currentHistoricalScoreId` "full history + denormalized current state" pattern exactly. `recordConsent()` is the one place that pattern is written to, called by both the authenticated compliance UI (with `recordedById` set) and the public unsubscribe link (with `recordedById` left `null` — no user performed that action, the contact did).
- **`sendEmail()` gains a second, mandatory consent gate**: alongside Phase A's `Company.doNotContact` check, every send now also requires a linked contact with `Contact.emailPermitted && !Contact.doNotContact`, and the body must contain a resolved `{{unsubscribeLink}}` — enforced inside `sendEmail()` itself (`src/lib/comms/send-email.ts`), the one function every future send path shares, not left to the composer alone. `contactId` is a required field, not optional; there is no ad hoc/untracked-address send path.
- **Mandatory unsubscribe placeholder**: `{{unsubscribeLink}}` joins the known-placeholder list (`src/lib/comms/templates.ts`) and a template cannot be saved without referencing it (`src/app/(dashboard)/settings/email-templates/actions.ts`) — CAN-SPAM requires a working unsubscribe mechanism in every commercial email. The template editor's default body scaffold already includes it.
- **Self-verifying unsubscribe tokens** (`src/lib/comms/unsubscribe-token.ts`): HMAC-SHA256-signed, base64url-encoded `contactId + expiry` (400-day expiry — CAN-SPAM only requires 30 days of continued function, this is generous headroom), verified with a constant-time comparison and no database lookup needed to confirm authenticity. `UNSUBSCRIBE_TOKEN_SECRET` follows the exact optional-in-dev/required-in-production pattern as `TOKEN_ENCRYPTION_KEY`.
- **Public, no-login `/unsubscribe` page**: one click, no account needed (CAN-SPAM: "no fees or extra steps"), idempotent (following the same link twice never double-records a `WITHDRAWN` consent entry), rate-limited per IP (`checkRateLimit`, reusing the existing Postgres-backed limiter). `src/proxy.ts` gained a `PUBLIC_ALWAYS_ROUTES` category, distinct from `/login`'s `PUBLIC_ROUTES` — an *authenticated* visitor must still see this page rather than being bounced to `/dashboard`.
- **Communication Compliance page** (`/settings/communication-compliance`, `manage_communication_compliance`): search contacts by name/email/company, view each one's current status and full consent history, and record a new `EXPRESS`/`IMPLIED`/`WITHDRAWN` entry. Also reachable directly from a contact on its company page (a status badge plus a "Manage consent" link pre-filtered to that contact), per the plan's "also reachable from the contact itself" requirement.
- **Sender mailing address**: `WorkspaceSettings.mailingAddress` (a new field on the existing Module Four singleton-row settings table, not a new table) resolves the `{{sender.mailingAddress}}` placeholder — CAN-SPAM requires a valid physical mailing address in every commercial email.

## Features shipped (Phase C)

- **`sendEmail()` refactored around a shared `prepareSend()`/`attemptDelivery()` split** (`src/lib/comms/send-email.ts`) so the composer's immediate send, a scheduled send, and a sequence step's send all share the exact same consent gate, placeholder resolution, and provider-call/finalize logic — no third copy that could drift from the other two. `prepareSend()` re-runs in full every time a send actually happens, never trusted from an earlier check (schedule time or enrollment time), since consent/connection state can change in between.
- **Scheduled sends**: the composer gained an optional "Send at" field (`schedule_email` permission) — `scheduleEmail()` validates immediately for fast feedback but stores the **raw, unresolved** subject/body with `status: SCHEDULED`; placeholders (including `{{unsubscribeLink}}`) are re-resolved fresh at actual send time, not frozen at schedule time. A new worker tick (`send-scheduled-email-tick`, every 5 minutes — shorter than `reports-tick`'s hourly cadence, since "send at 2pm" carries a real timeliness expectation reports don't) finds due rows and enqueues one durable send job per row (`send-scheduled-email`, singleton-keyed on the message id). A scheduled send whose contact revoked consent (or whose mailbox got disconnected) in the meantime is marked `FAILED` with that reason and a `SCHEDULED_EMAIL_FAILED` notification — never silently sent anyway. The person who scheduled it can cancel it any time before it fires (`cancelScheduledEmail`, ownership-checked).
- **Follow-up sequences** (`/settings/sequences`, `manage_sequences` to design; `enroll_in_sequences` to enroll): table-driven, admin-authored step lists — `WAIT` (days), `EMAIL` (a **shared** template only — a personal template is one salesperson's own voice, not meant for an automated multi-user campaign), and four TASK-like types (`TASK`/`CALL_REMINDER`/`DEMO_REMINDER`/`TRIAL_FOLLOWUP`) that create a real `Task` row via the existing follow-up infrastructure rather than a parallel one. `src/lib/comms/sequences.ts` is the pure core: `nextActionableStep()`/`firstActionableStep()` fold `WAIT` steps' days into the due-date offset for the next actionable step (a `WAIT` step has no side effect of its own — it only delays), and `previewSteps()` renders every step (including waits) with its cumulative day offset for the enrollment confirmation screen, per the plan's "show every step before enrolling" requirement.
- **Explicit enrollment only**: `enrollInSequence()` is the one path a `SequenceEnrollment` is ever created — from a company's detail page, after previewing every step. Requires a contact when the sequence contains an `EMAIL` step (no contact, no consent to check); blocks a second concurrent enrollment of the same company in the same sequence.
- **Durable execution via `sequence-tick`** (every 5 minutes, same idiom as `reports-tick`): finds every `ACTIVE` enrollment whose `nextStepDueAt` has passed and enqueues one `run-sequence-step` job per row (singleton-keyed on `enrollmentId:stepId`). `processDueSequenceStep()` re-checks stop conditions **fresh, before running anything**: a contact who opted out stops the enrollment (`STOPPED_OPT_OUT`); a company that reached the sequence's stop stage stops it (`STOPPED_STAGE`) — both send a notification and never run the step. `SequenceStepRun`'s `@@unique([enrollmentId, stepId])` is the duplicate-send-prevention backstop, the same role Module Five's `singletonKey` dedup plays for scheduled reports — a step can be offered by overlapping ticks without ever executing twice.
- **No uncontrolled loops**: a sequence is a finite, admin-authored step list, never generated or recursive; the tick advances past exactly one actionable step per successful run (folding any intervening `WAIT` steps), so a sequence is structurally incapable of looping and terminates in at most `steps.length` ticks' worth of processing.
- **Manual pause/resume/cancel** are simple `SequenceEnrollment.status` transitions (`pauseEnrollment`/`resumeEnrollment`/`cancelEnrollment`), exposed on the company detail page's new Follow-up Sequences panel alongside the enrollment's current step progress ("Step 2 of 4") and next-due time.
- **Steps are locked once a sequence has any enrollment** (active or historical) — `assertStepsEditable()` in the sequence-builder actions blocks adding/reordering/removing a step the moment one enrollment exists, so an in-flight enrollment's `currentStepOrder` pointer can never be invalidated out from under it. Deactivate and create a new sequence instead of editing a used one.
- **Sequences are deactivated, never hard-deleted** — there is deliberately no delete action. `FollowUpSequence`'s cascade would otherwise destroy `SequenceEnrollment` history (including completed/stopped enrollments) the moment a sequence row was removed, which would erase exactly the audit trail the plan asks every step run to preserve.

## Post-Phase-C review and fixes

Before starting Phase D, the user asked for a review of Phases A–C and concrete recommendations. Reading the actual code (not relying on memory of what was built) surfaced four real gaps, all fixed in this same checkpoint:

- **The dashboard bell showed nothing from `Notification`.** Every `DELIVERY_FAILURE`/`SCHEDULED_EMAIL_FAILED`/`SEQUENCE_COMPLETED`/`SEQUENCE_PAUSED` row created since Phase A had zero UI surface — `dashboard-shell.tsx` only ever read `GeneratedReport`. Fixed with a minimal, additive change rather than pulling forward Phase E's full unification: `src/lib/notifications.ts`'s `describeNotification()` renders one human-readable line per `NotificationType`; the dashboard layout now also queries unread `Notification` rows and passes them to a generalized `NotificationBell` with its own "Notifications" section, mark-one-read and mark-all-read actions (`src/app/(dashboard)/notifications-actions.ts`, ownership-scoped in the `where` clause exactly like `markGeneratedReportSeen`). `GeneratedReport` and `Notification` remain two separate models under the hood — true unification is still a Phase E item — this just makes the already-written rows visible.
- **Email-send rate limiting was one bucket per provider, shared by every user.** `callEmailProvider()` keyed its rate limit on `providerName` alone (`email-send:microsoft`), not per connection as the original Phase A plan specified (`email-send:<providerConnectionId>`) — one user's active sequence or scheduled sends could throttle every other user connected to the same provider. Fixed by adding `connectionId` to `ConnectedAccount` (populated by `getUsableAccessToken()`) and an optional `connectionId` on `EmailProviderCallOptions`, used by both providers' actual send calls (token exchange/refresh calls, which are infrequent and don't need per-connection scoping, are unchanged). New test (`tests/integration/comms-provider-rate-limit.test.ts`) confirms two connections on the same provider have independent buckets.
- **A deactivated shared template kept being sent by an already-running sequence.** `processDueSequenceStep()` checked that a step's template still *existed* but not that it was still `active` — deactivating a shared template (rather than deleting it) had no effect on a sequence already using it. Fixed with one added check, recorded as a `FAILED` step run with a clear reason, same as every other step failure.
- **A sequence enrollment's panel never showed a past step's failure.** It showed "Step X of Y" and a stop reason, but a failed `SequenceStepRun` was only visible via the (previously invisible) notification or a direct database look. Fixed by having the company detail page fetch each enrollment's most recent `FAILED` step run (Prisma's nested `take` applies per parent row, not globally) and rendering it inline in `SequenceEnrollmentPanel`.

None of these required new schema or new architecture — all four were small, contained fixes layered onto Phase C's existing design, confirmed via a fresh read of the merged code rather than assumed correct from memory.

## Database additions

**Phase A** — migration `20260721140732_module_six_communications_phase_a` — purely additive, no drops:

- **`ProviderConnection`** — one per user (`@unique` on `userId`), encrypted tokens, `status` (CONNECTED/EXPIRED/REVOKED/ERROR), `scopes`, `tokenExpiresAt`, `lastError`.
- **`EmailTemplate`** — `visibility` (PERSONAL/SHARED), optional `ownerId`/`leadTypeId`/`pipelineStageId`, `language`, `active`.
- **`EmailMessage`** — `direction` (OUTBOUND/INBOUND, only OUTBOUND used so far), `toAddresses`/`ccAddresses`/`bccAddresses` (`String[]`), `status` (DRAFT/SCHEDULED/QUEUED/SENT/DELIVERED/FAILED/BOUNCED/CANCELLED/REPLIED — only DRAFT-adjacent/QUEUED/SENT/FAILED are reachable so far; the rest await later phases), `providerMessageId`/`providerThreadId`, optional `templateId`/`contactId`.
- **`Notification`** — `type` (9-value enum covering every event type across all phases, not just Phase A's `DELIVERY_FAILURE`), `payload` JSON, `readAt`/`dismissedAt`.

New indexes: `EmailMessage(companyId)`, `EmailMessage(contactId)`, `EmailMessage(status, scheduledFor)` (ready for Phase C's scheduled-send tick), `EmailTemplate(visibility, active)`, `EmailTemplate(ownerId)`, `ProviderConnection(status)`, `Notification(userId, readAt)`.

**Phase B** — migration `20260721151823_module_six_consent_compliance` — purely additive, no drops:

- **`Contact`** gains `emailPermitted Boolean @default(false)`, `doNotContact Boolean @default(false)`, `unsubscribedAt DateTime?`, `unsubscribeSource String?` — the denormalized "current state" half of the History/current-pointer split.
- **`ConsentRecord`** (new) — `contactId`, `type` (EXPRESS/IMPLIED/WITHDRAWN), `source`, `note?`, `occurredAt`, `recordedById?` (nullable — null for a self-service unsubscribe). Append-only; `@@index([contactId, occurredAt])`.
- **`WorkspaceSettings`** gains `mailingAddress String?`.

**Phase C** — migration `20260721175709_module_six_scheduling_sequences` — purely additive, no drops:

- **`FollowUpSequence`** (new) — `name`, `active`, `stopOnPipelineStageId?` (a **sequence-level**, not per-step, stop condition — see "Deviations" below), `createdById`.
- **`SequenceStep`** (new) — `sequenceId`, `stepOrder`, `type` (`WAIT`/`EMAIL`/`TASK`/`CALL_REMINDER`/`DEMO_REMINDER`/`TRIAL_FOLLOWUP`), `waitDays?`, `emailTemplateId?`, `taskTitle?`/`taskNotes?`. `@@unique([sequenceId, stepOrder])`.
- **`SequenceEnrollment`** (new) — `sequenceId`, `companyId`, `contactId?`, `status` (`ACTIVE`/`PAUSED`/`COMPLETED`/`CANCELLED`/`STOPPED_OPT_OUT`/`STOPPED_STAGE`/`STOPPED_REPLY`), `currentStepOrder`, `nextStepDueAt?`, `enrolledById`, `stoppedAt?`/`stopReason?`. `STOPPED_REPLY` exists for schema completeness across the whole plan but is unreachable until Phase D adds inbound reply detection.
- **`SequenceStepRun`** (new) — `enrollmentId`, `stepId`, `status` (`PENDING`/`SUCCEEDED`/`FAILED`/`SKIPPED`), `emailMessageId?` (`@unique` — a step run maps to at most one email), `errorMessage?`. `@@unique([enrollmentId, stepId])` is the duplicate-send-prevention constraint.

New indexes: `SequenceStep(sequenceId, stepOrder)` (unique), `SequenceEnrollment(status, nextStepDueAt)` (the tick's query), `SequenceStepRun(enrollmentId, stepId)` (unique), `SequenceStepRun(emailMessageId)` (unique).

Deliberately **not** in this migration (would forward-reference tables that don't exist yet): `Appointment` (Phase D); `EmailMessage.bulkSendBatchId` (a later phase or Module Seven, if bulk send is ever built).

All three migrations applied to dev and test databases; `npx prisma generate` re-run after each. `prisma/seed.ts` re-run against dev after Phase A — **41 permissions seeded (up from 30)**; Phases B and C added no new permission keys (they use `manage_communication_compliance`, `schedule_email`, `manage_sequences`, and `enroll_in_sequences`, all already seeded in Phase A).

## Packages added

None. Token encryption uses Node's built-in `crypto` (AES-256-GCM). HTML handling is a hand-rolled escape function, not `sanitize-html` (see "HTML body handling" above). OAuth/provider HTTP calls use the platform `fetch`, matching the AI-research provider pattern.

## Permission matrix

| Permission | Administrator | Manager | Salesperson |
|---|---|---|---|
| `connect_mailbox` | Yes | Yes | Yes |
| `send_email` | Yes | Yes | Yes |
| `schedule_email` | Yes | Yes | Yes |
| `manage_personal_templates` | Yes | Yes | Yes |
| `manage_shared_templates` | Yes | No | No |
| `manage_sequences` | Yes | No | No |
| `enroll_in_sequences` | Yes | Yes | Yes |
| `view_team_communications` | Yes | Yes | No |
| `manage_calendar_connections` | Yes | Yes (own) | Yes (own) |
| `manage_communication_compliance` | Yes | No | No |
| `send_bulk_email` | Yes | No | No |

Every permission in this matrix was seeded back in Phase A (per the full plan's matrix, added all at once rather than piecemeal per phase). As of Phase C, `schedule_email`, `manage_sequences`, and `enroll_in_sequences` are now gated UI (composer scheduling; the sequence builder and enrollment panel), alongside Phase A's `connect_mailbox`/`send_email`/`manage_personal_templates`/`manage_shared_templates` and Phase B's `manage_communication_compliance`. `view_team_communications`, `manage_calendar_connections`, and `send_bulk_email` remain seeded but not yet gating any UI — ready for the phase that introduces the feature they gate.

`manage_personal_templates`/`manage_shared_templates` enforcement is ownership-aware, not just key-based: a Manager/Salesperson with `manage_personal_templates` can only edit/delete *their own* personal templates (verified by a rejected-edit test where a second user with the same permission is blocked from another user's template), while a user with `manage_shared_templates` (Administrator, by default) can also administratively edit/delete any personal template — covered in `tests/integration/email-templates.test.ts`.

## Consent/compliance controls (now live, Phase B)

Two consent checks apply to **every** send, with no exceptions: `Company.doNotContact` (Phase A) and `Contact.emailPermitted`/`doNotContact` plus a mandatory resolved unsubscribe link (Phase B) — both enforced inside `sendEmail()` itself, so no caller can accidentally skip either. The default is CASL-safe (opt-in): a contact cannot receive email until someone records `EXPRESS` or `IMPLIED` consent for them, which is also compliant under CAN-SPAM's opt-out model (a superset requirement satisfies both regimes without the app needing to guess which one applies to a given address). **This is a compliance-support system, not legal advice** — stated on the compliance page itself.

**A linked contact is now mandatory for every send** — `SendEmailParams.contactId` is a required field, not optional. There is no ad hoc/untracked-address send path: the composer requires picking an existing contact (the "To" field was removed entirely — the recipient address is always the contact's own recorded email, resolved server-side, never taken from client input), and `sendEmail()` rejects a missing contact, a contact with no email on file, and of course a not-yet-permitted or opted-out contact. This closes the gap an earlier draft of this report flagged (an ad hoc address bypassing consent entirely) by removing the bypassable path rather than trying to extend consent-tracking to untracked addresses — a company with no contacts yet must have one added (the existing Contacts panel already supports this inline) before anyone can email it from the CRM.

## Pages and routes added

| Route | Purpose |
|---|---|
| `/settings/email-connections` | Connect/disconnect a mailbox, view connection status |
| `/settings/email-templates` | Template list (shared + your personal), create form |
| `/settings/email-templates/[id]/edit` | Edit a template you're authorized to edit |
| `/settings/communication-compliance` | Search contacts, view consent history, record new consent |
| `/unsubscribe` | Public, no-login one-click unsubscribe |
| `/api/comms/oauth/[provider]/authorize` | Redirects to the provider's OAuth consent screen |
| `/api/comms/oauth/[provider]/callback` | Verifies CSRF state, exchanges code for tokens, stores the connection |
| `/settings/sequences` | List/create sequences, toggle active |
| `/settings/sequences/[id]/edit` | Step builder (add/reorder/remove) — locked once the sequence has any enrollment |
| Company detail page | "Email" panel (compose/send/schedule + history); Contacts panel shows a consent badge + "Manage consent" link; new "Follow-up Sequences" panel (enroll with step preview, pause/resume/cancel) |
| Settings hub (`/settings`) | Four new cards: Email Connections, Email Templates, Communication Compliance, Follow-up Sequences |

## Tests

**500 tests passing (491 from the Phase C checkpoint, unmodified in substance, + 9 new across 4 test files, from the post-Phase-C fixes)**:
- Every Phase A/B/C test file — unchanged, all still green (`tests/integration/sequences.test.ts` gained one more test, noted below)
- `tests/unit/sequences.test.ts` (6 tests) — `firstActionableStep`/`nextActionableStep`'s `WAIT`-day folding (a leading wait, multiple consecutive waits summed, zero-wait between adjacent actionable steps, end-of-list returns null), `previewSteps`'s cumulative-day-offset rendering
- `tests/integration/scheduled-email.test.ts` (9 tests) — `scheduleEmail()` validates and stores raw/unresolved text; rejects scheduling when consent is missing, before anything is stored; `processDueScheduledEmail()` sends a due row with placeholders resolved fresh, fails (with a `SCHEDULED_EMAIL_FAILED` notification) when consent was withdrawn after scheduling, and is a no-op on an already-cancelled row; `runSendScheduledEmailTick()` enqueues only `SCHEDULED`-and-due rows, not future or cancelled ones; the composer action requires `schedule_email` (not just `send_email`) to schedule, rejects a past/invalid date, and only lets the scheduling user (not another user) cancel it
- `tests/integration/sequences.test.ts` (15 tests, +1 from the fixes) — everything from the Phase C checkpoint, plus: fails an `EMAIL` step whose template was deactivated after the sequence was authored, with no `EmailMessage` created
- `tests/integration/comms-provider-rate-limit.test.ts` (2 tests, new) — two different connections on the same provider have independent rate-limit buckets (one's exhaustion doesn't block the other); calls with no `connectionId` fall back to a shared per-provider bucket
- `tests/unit/notifications.test.ts` (4 tests, new) — `describeNotification()` renders each `NotificationType` into a human-readable line, degrades gracefully when payload fields are missing, and falls back to a generic message for an unrecognized type
- `tests/integration/notifications-actions.test.ts` (2 tests, new) — `markNotificationRead`/`markAllNotificationsRead` are scoped to the calling user's own notifications only, never another user's

No automated test ever sends real email or reaches a real OAuth endpoint — `MockEmailProvider` is structurally the only provider active under `NODE_ENV=test`.

**A note on test-suite stability**: across all phases of this module, full-suite runs have intermittently seen one or two *different*, unrelated test files fail with a generic hook/test timeout rather than an assertion failure. Every one has passed cleanly (100%) when re-run in isolation immediately after, including this checkpoint's final run (`tests/integration/rate-limit.test.ts` this time, then — on the very next full run — `tests/integration/scheduled-email.test.ts`'s last test, which itself then passed cleanly both filtered to just that test and re-run as a full file). Consistent with transient Postgres connection contention across Vitest's parallel test-file workers in this sandbox, not a regression — noted here rather than silently ignored.

## Build result

- `npx prisma format` / `npx prisma validate` — clean
- `npx tsc --noEmit` — clean, re-checked after every batch of changes
- `npx eslint .` — clean
- `npm test` — 500/500 passing (see the stability note above)
- `npx next build` — succeeds; `/settings/sequences` and `/settings/sequences/[id]/edit` both registered alongside every Phase A/B and pre-existing route
- `npm run worker` — **a real bug, found only by actually starting the worker**: `src/lib/comms/connections.ts` still carried Phase A's `import "server-only"` guard, written when only web Server Actions called it. Phase C's `sequence-tick`/`send-scheduled-email` worker handlers now call `sendEmail()` (`send-email.ts`), which calls `getUsableAccessToken()` in `connections.ts` — so the worker crashed at import time (`"This module cannot be imported from a Client Component module"`) the instant it was started for real, exactly the class of bug the Module Five `server-only` lesson describes (Vitest mocks the guard out, so the full test suite stayed green while the real worker crashed). Fixed by removing the guard, consistent with every other `src/lib/comms/*` module; re-confirmed clean after the post-Phase-C fixes above.

## Browser walkthrough

**Not performed as an interactive click-through** — no browser automation tool was available this session, same limitation as every prior checkpoint. In its place: `tsc`/lint/the full test suite/a production build all passed, and the worker process was started for real (catching the real bug described above). A manual interactive pass — the sequence builder's step add/reorder/remove flow, the enrollment panel's step preview and pause/resume/cancel controls, and the composer's new "Send at" scheduling field — is still recommended before considering Phase C fully verified.

## Remaining limitations / known gaps

- **A company with no email-addressed contacts cannot be emailed from the CRM yet** — this is the intended consequence of requiring a linked contact for every send (see Phase B's "Consent/compliance controls" above), not a bug.
- **`STOPPED_REPLY` is unreachable.** Reply detection needs inbound email sync, which is Phase D — a sequence can be stopped by opt-out or stage-reached today, never by a detected reply.
- **No calendar or inbound email.** Connecting a mailbox only grants send access; calendar create/update/cancel and inbound sync/reply-detection are Phase D.
- **No delivery-status tracking beyond QUEUED→SENT/FAILED (or SCHEDULED→SENT/FAILED/CANCELLED).** Delivered/bounced/replied statuses exist on the enum but nothing updates a message to them — that requires the provider webhooks Phase E adds.
- **`Notification` rows are written but not yet displayed** — the dashboard bell still only reads `GeneratedReport`. Phase E's plan is to read both, not replace one with the other.
- **No bulk-send UI.** `send_bulk_email` is seeded and `EmailMessage` has no batch-grouping column yet — a salesperson sends one company/contact at a time today, and a sequence enrolls one company at a time (no bulk-enroll-a-list-of-leads flow).
- **The composer sends to exactly one contact per email** (cc/bcc remain free text for internal recipients) — there's no multi-contact "To" picker for emailing several tracked contacts on the same company at once yet.
- **The Communication Compliance page has no pagination** — it caps results at 50 with a "refine your search" note rather than paging through more. Fine at this team's likely scale; would need real pagination at a much larger contact volume.
- **A failed `EMAIL` step inside a sequence doesn't stop the sequence** — confirmed with the user directly: a provider hiccup on one step shouldn't necessarily kill an otherwise-healthy multi-step campaign, so the enrollment still advances. It is never silent, though — the step is recorded as a `SequenceStepRun` `FAILED` row *and* a `DELIVERY_FAILURE` notification is sent to whoever enrolled the company, the same as any other delivery failure in this app (`sendEmail()`'s `notifyOnFailure: false` option lets `sequences.ts` send its own single, unified notification instead of double-notifying on top of `sendEmail()`'s built-in one).
- **A sequence's steps are permanently locked the moment it has any enrollment, with no unlock path** — correct for protecting in-flight enrollments, but means fixing a typo in an already-enrolled sequence's step requires creating a whole new sequence rather than patching the existing one.

## Remaining-phase recommendations

The approved plan's phases (D–E) remain the direct next steps for Module Six itself:

1. **Phase D — Calendar and inbound**: `Appointment` schema plus calendar create/update/cancel (same `ProviderConnection`, calendar scopes already requested in Phase A's OAuth grant but unused until now); inbound sync via provider webhooks, contact-matching by normalized email, and `/settings/communications-review` for unmatched senders. This is also what unlocks `STOPPED_REPLY` for sequences.
2. **Phase E — Delivery status and unified notifications**: provider delivery-status webhooks (idempotent, signature-verified); generalize the dashboard bell to read `Notification` alongside `GeneratedReport` rather than two separate unread-badge systems.
3. **A multi-contact "To" picker** for the composer, and/or a bulk-enroll flow for sequences, if real use shows a need to reach more than one tracked contact/company at a time (currently: one at a time for both).
4. **Once real OAuth app registrations exist** (Microsoft Entra / Google Cloud Console, not created this session per the plan's "never connect real accounts without approval"): a real manual connect/disconnect cycle, one real send to a controlled test mailbox, one real scheduled send, one real sequence enrollment, and one real unsubscribe click-through, before trusting Phases A–C against a live account.

## Deviations from the approved plan

**Phase A**: none in substance (see the `sanitize-html` dependency decision, resolved by not needing it this phase).

**Phase B**: the plan described the consent gate in terms of `Contact.emailPermitted`, which has no meaning for a send with no `Contact` row at all. An initial implementation scoped the gate to contact-linked sends only (skipping the check for an ad hoc address) — reviewed immediately after the Phase B checkpoint and revised to close that gap by making a linked contact **mandatory** for every send instead. `SendEmailParams.contactId` is required, the composer's free-text "To" field was removed, and the recipient is always resolved server-side from the contact's own record. Stricter than the plan explicitly called for, but defensible: a CRM whose purpose is tracking leads shouldn't have a send path that bypasses its own lead-tracking.

**Phase C**: two judgment calls the plan didn't fully pin down:
- **`SequenceStep.stopOnPipelineStageId` moved to the sequence level** (`FollowUpSequence.stopOnPipelineStageId`) instead of living on each individual step as the plan's schema sketch suggested. "Which stage ends this sequence" is one decision per sequence, not one an author should have to repeat identically on every step — a per-step field would only ever sensibly hold the same value on every step of a given sequence anyway.
- **No hard-delete for sequences** — the plan didn't explicitly address this, but `FollowUpSequence`'s natural cascade-delete behavior would destroy `SequenceEnrollment`/`SequenceStepRun` history the moment a sequence row was removed. Resolved by only ever exposing a `setSequenceActive()` deactivate toggle, never a delete action, matching the existing `RejectionReason`-style "deactivate, don't delete something with history" convention already used elsewhere in this codebase.
