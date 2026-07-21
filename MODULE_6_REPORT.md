# Module Six Delivery Report — Phases A–B

## Starting point

Modules One through Five (CRM foundation, AI-assisted lead discovery, production hardening, Sales Workspace, Reporting and Analytics — including the scheduled-report worker) were complete, tested, and merged into `main` before this module started. Module Six Phase A was built on branch `module-six-communications`, following a 12-section plan approved before any code was written (provider comparison, database design, permission matrix, consent design, phased implementation order, and test plan — see the plan's phasing in "Deviations" below for how it maps to this report). Phase A was merged to `main` as its own checkpoint; **Phase B was then built on a fresh branch, `module-six-consent-compliance`**, off the updated `main` — mirroring how Module Five itself shipped core reporting, then scheduled reports, as two separate merges rather than one long-lived branch.

**This report covers Phases A and B**: mailbox connections, email templates, the composer/send action, and consent/compliance (CASL-safe default-deny, append-only consent records, a self-service unsubscribe link, and a compliance-review page). Phases C–E (scheduled sends and follow-up sequences, calendar/appointments and inbound sync, delivery-status webhooks and unified notifications) are designed in the approved plan but not built — see "Remaining-phase recommendations" below. Nothing in this report should be read as "Module Six is done"; it is a checkpoint at the end of the second of five planned phases.

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

Deliberately **not** in this migration (would forward-reference tables that don't exist yet): `FollowUpSequence`/`SequenceStep`/`SequenceEnrollment`/`SequenceStepRun` (Phase C); `Appointment` (Phase D); `EmailMessage.sequenceEnrollmentId`/`sequenceStepId`/`bulkSendBatchId` (Phases C/F).

Both migrations applied to dev and test databases; `npx prisma generate` re-run after each. `prisma/seed.ts` re-run against dev after Phase A — **41 permissions seeded (up from 30)**; Phase B added no new permission keys (it uses `manage_communication_compliance`, already seeded in Phase A).

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

`schedule_email`, `manage_sequences`, `view_team_communications`, `manage_calendar_connections`, `manage_communication_compliance`, and `send_bulk_email` are seeded now (per the full plan's matrix) but have no gated UI yet in Phase A — they're ready for the phase that introduces the feature they gate, rather than being added piecemeal per phase.

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
| Company detail page | "Email" panel (compose/send + history); Contacts panel now shows a consent badge + "Manage consent" link per contact |
| Settings hub (`/settings`) | Three new cards: Email Connections, Email Templates, Communication Compliance |

## Tests

**462 tests passing (433 from the Phase A checkpoint, unmodified in substance, + 29 new/extended across 7 test files)**:
- `tests/unit/token-crypto.test.ts`, `tests/unit/comms-validate.test.ts`, `tests/unit/comms-providers.test.ts` — unchanged from Phase A
- `tests/unit/comms-templates.test.ts` — extended with `hasUnsubscribePlaceholder` coverage and resolution of the new `unsubscribeLink`/`sender.mailingAddress` placeholders
- `tests/unit/unsubscribe-token.test.ts` (6 tests, new) — round-trip, wrong-secret rejection, tampered-payload rejection, malformed-token rejection, expiry (via `vi.useFakeTimers`), missing-secret error
- `tests/integration/email-templates.test.ts` — extended with a test rejecting a template body missing `{{unsubscribeLink}}`; the base fixture body now includes it so every other test still exercises the full validation path
- `tests/integration/send-email.test.ts` (14 tests) — rewritten around the now-mandatory `contactId`: every test uses a real linked contact; covers a not-yet-permitted contact, a `doNotContact` contact (even with permission granted), a missing/nonexistent contact, a contact with no email on file, a contact-linked send missing the unsubscribe placeholder, and a full successful send asserting the resolved unsubscribe link is a real, independently-verifiable token; the composer server action's own tests confirm it rejects a submission with no contact selected and that the recipient is always the selected contact's own email, never client-supplied text
- `tests/integration/consent.test.ts` (11 tests, new) — `recordConsent()`'s EXPRESS/WITHDRAWN state transitions and append-only history; `unsubscribeByToken()`'s self-service path (null `recordedById`), invalid-token rejection, and double-click idempotency; `recordContactConsentAction`'s permission enforcement and required-`source` validation
- `tests/unit/proxy.test.ts` — extended with two tests confirming `/unsubscribe` is reachable both unauthenticated and authenticated (unlike `/login`, which bounces an authenticated visitor away)
- `tests/unit/env.test.ts` — extended for `UNSUBSCRIBE_TOKEN_SECRET`'s required-in-production check

Every Phase A test stays green. No automated test ever sends real email or reaches a real OAuth endpoint — `MockEmailProvider` is structurally the only provider active under `NODE_ENV=test`.

**A note on test-suite stability**: three separate full-suite runs during this phase each saw one or two *different*, unrelated pre-existing test files (never the same file twice, never a Phase B file) fail with a generic hook/test timeout rather than an assertion failure. Every one of those files passed cleanly (100%) when re-run in isolation immediately after. This is consistent with transient Postgres connection contention across Vitest's parallel test-file workers in this sandbox, not a regression — but it's noted here rather than silently ignored, since a flaky suite is worth knowing about regardless of cause.

## Build result

- `npx prisma format` / `npx prisma validate` — clean
- `npx tsc --noEmit` — clean, re-checked after every batch of changes
- `npx eslint .` — clean
- `npm test` — 462/462 passing (see the stability note above; all 462 passed cleanly on the final full-suite run with no contention flakes)
- `npx next build` — succeeds; `/settings/communication-compliance` and `/unsubscribe` both registered (the latter as a dynamic server-rendered route, since it reads a query-string token and performs the unsubscribe on render) alongside every Phase A and pre-existing route
- `npm run worker` — every new Phase B `src/lib/comms/*` module (`consent.ts`, `unsubscribe-token.ts`) omits `import "server-only"`, same reasoning as every other comms module. Confirmed by starting the worker process directly — it passed every module import and reached its normal startup sequence before hitting an unrelated port conflict from an already-running worker instance from earlier in the session (which only happens after all imports succeed).

## Browser walkthrough

**Not performed as an interactive click-through** — no browser automation tool was available this session, same limitation as Phase A and the Module Five report. In its place: `tsc`/lint/the full test suite/a production build all passed, and the worker process was started for real and confirmed importing every new module without error. A manual interactive pass — the compliance page's search/record-consent flow, the unsubscribe page's real click-through with a real generated link, and the contact panel's new consent badge/link — is still recommended before considering Phase B fully verified.

## Remaining limitations / known gaps

- **A company with no email-addressed contacts cannot be emailed from the CRM yet** — this is the intended consequence of requiring a linked contact for every send (see "Consent/compliance controls" above), not a bug, but it does mean the Email panel shows a "add a contact first" message instead of a compose button until at least one contact with an email exists.
- **No scheduling or sequences.** `EmailMessage.scheduledFor`/`status: SCHEDULED` are schema-ready but nothing sets or processes them yet — every send today is immediate. Follow-up sequences don't exist at all yet (no `FollowUpSequence`/`SequenceEnrollment` tables).
- **No calendar or inbound email.** Connecting a mailbox only grants send access; calendar create/update/cancel and inbound sync/reply-detection are Phase D.
- **No delivery-status tracking beyond QUEUED→SENT/FAILED.** Delivered/bounced/replied statuses exist on the enum but nothing updates a message to them — that requires the provider webhooks Phase E adds.
- **`Notification` rows are written but not yet displayed** — the dashboard bell still only reads `GeneratedReport`. Phase E's plan is to read both, not replace one with the other.
- **No bulk-send UI.** `send_bulk_email` is seeded and `EmailMessage` has no batch-grouping column yet — a salesperson sends one company/contact at a time today.
- **The composer sends to exactly one contact per email** (cc/bcc remain free text for internal recipients) — there's no multi-contact "To" picker for emailing several tracked contacts on the same company at once yet.
- **The Communication Compliance page has no pagination** — it caps results at 50 with a "refine your search" note rather than paging through more. Fine at this team's likely scale; would need real pagination at a much larger contact volume.

## Remaining-phase recommendations

The approved plan's phases (C–E) remain the direct next steps for Module Six itself:

1. **Phase C — Scheduling and sequences**: a `send-scheduled-email` worker tick (same idiom as Module Five's `reports-tick`), then `FollowUpSequence`/`SequenceStep`/`SequenceEnrollment`/`SequenceStepRun` with the `@@unique([enrollmentId, stepId])` + `singletonKey` dedup pattern already proven for scheduled reports. The sequence-step stop-condition check should also re-check `Contact.doNotContact` at run time, not just at enrollment.
2. **Phase D — Calendar and inbound**: `Appointment` schema plus calendar create/update/cancel (same `ProviderConnection`, calendar scopes already requested in Phase A's OAuth grant but unused until now); inbound sync via provider webhooks, contact-matching by normalized email, and `/settings/communications-review` for unmatched senders.
3. **Phase E — Delivery status and unified notifications**: provider delivery-status webhooks (idempotent, signature-verified); generalize the dashboard bell to read `Notification` alongside `GeneratedReport` rather than two separate unread-badge systems.
4. **A multi-contact "To" picker** for the composer, if real use shows a need to email more than one tracked contact on the same send (currently: one contact per send, cc/bcc for everyone else).
5. **Once real OAuth app registrations exist** (Microsoft Entra / Google Cloud Console, not created this session per the plan's "never connect real accounts without approval"): a real manual connect/disconnect cycle, one real send to a controlled test mailbox, and one real unsubscribe click-through, before trusting Phases A–B against a live account.

## Deviations from the approved plan

None in substance for Phase A (see the prior checkpoint's notes on the `sanitize-html` dependency decision). For Phase B, one judgment call the plan didn't fully specify: the plan described the consent gate in terms of `Contact.emailPermitted`, which has no meaning for a send with no `Contact` row at all. An initial implementation scoped the gate to contact-linked sends only (skipping the check for an ad hoc address) — reviewed immediately after the Phase B checkpoint and revised to close that gap by making a linked contact **mandatory** for every send instead, rather than leaving an untracked-address path unchecked. `SendEmailParams.contactId` is now required, the composer's free-text "To" field was removed, and the recipient is always resolved server-side from the contact's own record. This is a stricter posture than the plan explicitly called for, but a defensible one: a CRM whose purpose is tracking leads shouldn't have a send path that bypasses its own lead-tracking.
