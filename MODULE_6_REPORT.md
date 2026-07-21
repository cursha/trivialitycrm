# Module Six Delivery Report — Phase A

## Starting point

Modules One through Five (CRM foundation, AI-assisted lead discovery, production hardening, Sales Workspace, Reporting and Analytics — including the scheduled-report worker) were complete, tested, and merged into `main` before this module started. Module Six was built on branch `module-six-communications`, following a 12-section plan approved before any code was written (provider comparison, database design, permission matrix, consent design, phased implementation order, and test plan — see the plan's phasing in "Deviations" below for how it maps to this report).

**This report covers Phase A only**: mailbox connections, email templates, and the composer/send action. Phases B–E (consent/compliance, scheduled sends and follow-up sequences, calendar/appointments and inbound sync, delivery-status webhooks and unified notifications) are designed in the approved plan but not built — see "Module Seven / remaining-phase recommendations" below. Nothing in this report should be read as "Module Six is done"; it is a checkpoint at the end of the first of five planned phases.

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

## Database additions

Migration `20260721140732_module_six_communications_phase_a` — purely additive, no drops:

- **`ProviderConnection`** — one per user (`@unique` on `userId`), encrypted tokens, `status` (CONNECTED/EXPIRED/REVOKED/ERROR), `scopes`, `tokenExpiresAt`, `lastError`.
- **`EmailTemplate`** — `visibility` (PERSONAL/SHARED), optional `ownerId`/`leadTypeId`/`pipelineStageId`, `language`, `active`.
- **`EmailMessage`** — `direction` (OUTBOUND/INBOUND, only OUTBOUND used this phase), `toAddresses`/`ccAddresses`/`bccAddresses` (`String[]`), `status` (DRAFT/SCHEDULED/QUEUED/SENT/DELIVERED/FAILED/BOUNCED/CANCELLED/REPLIED — only DRAFT-adjacent/QUEUED/SENT/FAILED are reachable in Phase A; the rest await later phases), `providerMessageId`/`providerThreadId`, optional `templateId`/`contactId`.
- **`Notification`** — `type` (9-value enum covering every event type across all phases, not just Phase A's `DELIVERY_FAILURE`), `payload` JSON, `readAt`/`dismissedAt`.

New indexes: `EmailMessage(companyId)`, `EmailMessage(contactId)`, `EmailMessage(status, scheduledFor)` (ready for Phase C's scheduled-send tick), `EmailTemplate(visibility, active)`, `EmailTemplate(ownerId)`, `ProviderConnection(status)`, `Notification(userId, readAt)`.

Deliberately **not** in this migration (would forward-reference tables that don't exist yet): `ConsentRecord`, `Contact.emailPermitted`/`doNotContact`/`unsubscribedAt` (Phase B); `FollowUpSequence`/`SequenceStep`/`SequenceEnrollment`/`SequenceStepRun` (Phase C); `Appointment` (Phase D); `EmailMessage.sequenceEnrollmentId`/`sequenceStepId`/`bulkSendBatchId` (Phases C/F).

Applied to both dev and test databases; `npx prisma generate` re-run; `prisma/seed.ts` re-run against dev — **41 permissions seeded (up from 30)**.

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

## Consent/compliance controls (Phase A scope)

Full consent tracking (`ConsentRecord`, CASL/CAN-SPAM-aware default-deny, unsubscribe links) is Phase B. The only suppression check active today is the pre-existing `Company.doNotContact` flag, enforced as a hard server-side gate inside `sendEmail()` itself — not a UI nicety, and not something a caller could accidentally skip, since every current and future send path (composer today; scheduled sends and sequence steps in Phase C) calls this one function. This is explicitly a partial control: a `doNotContact` company blocks a send, but there is no contact-level consent requirement yet, and no unsubscribe link exists in any template. Do not treat Phase A as CASL/CAN-SPAM-compliant on its own — that compliance posture is Phase B's deliverable.

## Pages and routes added

| Route | Purpose |
|---|---|
| `/settings/email-connections` | Connect/disconnect a mailbox, view connection status |
| `/settings/email-templates` | Template list (shared + your personal), create form |
| `/settings/email-templates/[id]/edit` | Edit a template you're authorized to edit |
| `/api/comms/oauth/[provider]/authorize` | Redirects to the provider's OAuth consent screen |
| `/api/comms/oauth/[provider]/callback` | Verifies CSRF state, exchanges code for tokens, stores the connection |
| Company detail page | New "Email" panel — compose/send, and the company's email history |
| Settings hub (`/settings`) | Two new cards: Email Connections, Email Templates |

## Tests

**433 tests passing (404 pre-existing, unmodified, + 29 new across 5 new test files)**:
- `tests/unit/token-crypto.test.ts` (7 tests) — round-trip, distinct ciphertext per call (random IV), GCM tamper detection, wrong-key/malformed/missing-key failure modes
- `tests/unit/comms-validate.test.ts` — email-header-injection rejection on to/cc/bcc/subject, valid-address acceptance
- `tests/unit/comms-providers.test.ts` — `MockEmailProvider` requires no network access; `MicrosoftGraphProvider`/`GoogleProvider` authorization-URL construction (scopes, `access_type=offline&prompt=consent`) and their "throws without configured credentials" path; `getEmailProvider` always returns mock under `NODE_ENV=test` regardless of requested kind
- `tests/unit/comms-templates.test.ts` (10 tests) — placeholder resolution (known/unknown/blank/whitespace-tolerant/repeated tokens), `unknownPlaceholderTokens` validation
- `tests/integration/email-templates.test.ts` (8 tests) — permission enforcement for personal vs. shared template creation, unknown-placeholder rejection at save time, ownership-scoped edit/delete (including the administrative-override case), active toggle and delete
- `tests/integration/send-email.test.ts` (8 tests) — `Company.doNotContact` blocking, unresolved-placeholder blocking, invalid-recipient blocking, no-connected-mailbox blocking, a full successful send (placeholder resolution + `SENT` status + `EMAIL` activity logged), and a simulated provider failure producing a `FAILED` `EmailMessage` plus a `DELIVERY_FAILURE` `Notification`; the composer server action's own permission gate and recipient-list parsing (comma/newline-separated)

Every pre-existing test (404) stays green, unmodified. No automated test ever sends real email or reaches a real OAuth endpoint — `MockEmailProvider` is structurally the only provider active under `NODE_ENV=test`. A `SIMULATED_SEND_FAILURE_ADDRESS` constant in the mock provider is the only way tests deterministically exercise the failure path, since the mock otherwise always "succeeds."

## Build result

- `npx prisma format` / `npx prisma validate` — clean
- `npx tsc --noEmit` — clean, re-checked after every batch of changes
- `npx eslint .` — clean (three unused-parameter warnings found and fixed during development, by removing the unused parameters rather than underscore-prefixing them, since this project's flat ESLint config has no `argsIgnorePattern` override)
- `npm test` — 433/433 passing
- `npx next build` — succeeds; `/settings/email-connections`, `/settings/email-templates`, and `/settings/email-templates/[id]/edit` all registered as dynamic server-rendered routes alongside every pre-existing route
- `npm run worker` — every new `src/lib/comms/*` module omits `import "server-only"` where the future worker will need it (mirroring the exact Module Five lesson: Vitest mocks that guard out, so only actually starting the worker catches a real crash). Confirmed by starting the worker process directly — it passed every module import and reached its normal startup sequence (logged "database schema is up to date") before hitting an unrelated port conflict from an already-running worker instance from earlier in the session, which happens only after all imports succeed.

## Browser walkthrough

**Not performed as an interactive click-through** — no browser automation tool was available this session (same limitation noted in the Module Five report). In its place: `tsc`/lint/the full test suite/a production build all passed, and the worker process was started for real and confirmed importing every new module without error. A manual interactive pass — the OAuth connect/disconnect flow against a real Microsoft or Google test tenant, the template editor's placeholder picker, the composer's contact/template prefill behavior, and mobile layout — is still recommended before considering Phase A fully verified, and is explicitly **not** attempted here per the plan's "never connect real accounts without approval" instruction.

## Remaining limitations / known gaps (Phase A)

- **No consent enforcement beyond `Company.doNotContact`.** Contact-level consent, unsubscribe links, and CASL/CAN-SPAM-aware defaults are Phase B, not yet built. Do not send real bulk or automated communications relying on this phase's compliance posture.
- **No scheduling or sequences.** `EmailMessage.scheduledFor`/`status: SCHEDULED` are schema-ready but nothing sets or processes them yet — every Phase A send is immediate. Follow-up sequences don't exist at all yet (no `FollowUpSequence`/`SequenceEnrollment` tables).
- **No calendar or inbound email.** Connecting a mailbox only grants send access in this phase; calendar create/update/cancel and inbound sync/reply-detection are Phase D.
- **No delivery-status tracking beyond QUEUED→SENT/FAILED.** Delivered/bounced/replied statuses exist on the enum but nothing updates a message to them — that requires the provider webhooks Phase E adds.
- **`Notification` rows are written but not yet displayed** — the dashboard bell still only reads `GeneratedReport`. Phase E's plan is to read both, not replace one with the other.
- **No bulk-send UI.** `send_bulk_email` is seeded and `EmailMessage` has no batch-grouping column yet (`bulkSendBatchId` was proposed in the plan but not added this phase, since nothing consumes it) — a salesperson sends one company/contact at a time today.
- **Recipient email addresses are entered as free text in the composer** (comma/newline-separated), with an optional contact picker that fills the "To" field for convenience. There's no multi-recipient contact picker across several contacts at once yet.

## Module Seven / remaining-phase recommendations

The approved plan's phases (B–E) remain the direct next steps for Module Six itself, not deferred to a Module Seven:

1. **Phase B — Consent and compliance**: `ConsentRecord` (append-only, mirroring Module One's `HistoricalScoreRecord` pattern), `Contact.emailPermitted`/`doNotContact`/`unsubscribedAt`, `/settings/communication-compliance`, and a mandatory unsubscribe-link placeholder that templates cannot be saved without.
2. **Phase C — Scheduling and sequences**: a `send-scheduled-email` worker tick (same idiom as Module Five's `reports-tick`), then `FollowUpSequence`/`SequenceStep`/`SequenceEnrollment`/`SequenceStepRun` with the `@@unique([enrollmentId, stepId])` + `singletonKey` dedup pattern already proven for scheduled reports.
3. **Phase D — Calendar and inbound**: `Appointment` schema plus calendar create/update/cancel (same `ProviderConnection`, calendar scopes already requested in Phase A's OAuth grant but unused until now); inbound sync via provider webhooks, contact-matching by normalized email, and `/settings/communications-review` for unmatched senders.
4. **Phase E — Delivery status and unified notifications**: provider delivery-status webhooks (idempotent, signature-verified); generalize the dashboard bell to read `Notification` alongside `GeneratedReport` rather than two separate unread-badge systems.
5. **Once real OAuth app registrations exist** (Microsoft Entra / Google Cloud Console, not created this session per the plan's "never connect real accounts without approval"): a real manual connect/disconnect cycle, one real send to a controlled test mailbox, before trusting Phase A against a live account.

## Deviations from the approved plan

None in substance. The approved plan (§10) explicitly proposed Phase A as "connections, composer, templates" with Phase boundaries as "proposed stopping points for check-ins, not a rigid commitment" — this report stops exactly at that boundary. The one implementation-level decision made during Phase A that the plan had flagged as open (§12, the `sanitize-html` dependency question) was resolved by not needing it this phase rather than by picking a side — see "HTML body handling" above; revisit if a future phase adds real HTML authoring.
