# Version 1 Acceptance

Pass/fail checklist with evidence for every critical workflow, per the
Module Ten spec. **Pre-deployment section only** — the spec's own
"Production Acceptance Walkthrough" and "Controlled Deployment" sections are
explicitly sequenced *after* your review and explicit approval, and after a
real Railway deploy, neither of which has happened yet. Post-deployment
sections below are left as clearly-marked empty checklists.

**Known limitation, stated honestly throughout**: no browser-automation tool
is available in this session. Everything marked "pass" below was verified via
the automated test suite, direct HTTP checks (`curl`), direct database
verification, or code-level review — never an actual signed-in browser
click-through. Nothing here is claimed as browser-verified when it wasn't.

---

## Pre-deployment section

### Deployment gate

| Check | Result | Evidence |
|---|---|---|
| `prisma format` | ✅ Pass | Clean, no changes needed after running |
| `prisma validate` | ✅ Pass | "The schema ... is valid" |
| Migration status (dev + test DBs) | ✅ Pass | 22 migrations, all applied |
| Fresh-database migration test | ✅ Pass | All 22 migrations applied cleanly to a brand-new empty database; dropped after |
| Existing-database migration test | ✅ Pass | Local dev DB already current |
| `prisma generate` | ✅ Pass | Clean |
| Seed run twice | ✅ Pass | Idempotent — identical counts both runs, second run correctly skipped admin bootstrap |
| `npm run lint` | ✅ Pass | Clean, zero warnings/errors |
| `npx tsc --noEmit` | ✅ Pass | Clean |
| Full test suite | ✅ Pass | **128 test files passed (128), 939 tests passed (939)**, zero failures, 884s |
| `npm run build` | ✅ Pass | Failed once on a real bug (client/server bundling — see `MODULE_10_REPORT.md`), fixed, clean rebuild including the new `/onboarding` route |
| `npm audit` | ⚠️ Reviewed | 1 fixed safely (`fast-uri`); 9 reviewed and deliberately deferred with reasoning — see `MODULE_10_REPORT.md` |
| `docker build --target web` | ✅ Pass | Built successfully |
| `docker build --target worker` | ✅ Pass | Built successfully |
| Web container smoke test | ✅ Pass | Correctly refused to boot without required production secrets (validated env-schema behavior); once configured: `/api/health` → `200 {"status":"ok","database":"up"}`, `/login` → 200 with CSP header present, clean SIGTERM exit (143) |
| Worker container smoke test | ✅ Pass | Migration-status gate passed ("database schema is up to date."), `/health` → `200 {"status":"ok"}`, graceful shutdown logged and exit code 0 |
| `git status` review | ✅ Pass | 32 modified, 34 new — every file accounted for in `MODULE_10_REPORT.md`; no stray scratch files |

### Backup/restore drill

✅ **Actually performed**, not just described — 2026-07-24, local dev
database. `pg_dump` → fresh scratch database → `pg_restore` (exit 0) → row
counts matched exactly across `Company`, `User`, `Role`, `Permission`,
`SearchResult`; a foreign-key relationship (`Company.assignedToId → User`)
verified intact post-restore. Scratch database and dump deleted immediately
after. Full procedure documented in `BACKUP_RESTORE.md`.

### Local mock-mode functional walkthrough (new sales-UX features)

Performed via the automated test suite and direct server-action/function
calls — not a live browser session (see the limitation stated above).

| Feature | Verified via | Result |
|---|---|---|
| My Day / priority dashboard | Pre-existing (Module Four), unmodified this module | Not re-walked; no code in this path changed |
| Global search | 8 integration tests, incl. cross-salesperson scope isolation | ✅ Pass |
| Quick Add (Company/Contact/Note/Activity/Follow-up tabs) | 4 integration tests (server-action layer: options, company search, scope, MERGED exclusion); UI itself not browser-tested | ✅ Pass at the layer tested |
| Fast quick-actions (pre-fill + open) | Code review — the pub/sub context wiring was typechecked/linted; no dedicated UI test (no new server action introduced, reuses existing tested `createActivity`/`createTask`) | ✅ Reviewed, reuses already-tested actions |
| Next best action | 12 unit tests covering every rule and their ordering | ✅ Pass |
| Lead-score explanation | 15 unit tests (mock detection, confidence, recommended action) | ✅ Pass |
| First-login onboarding checklist | 5 unit tests (step visibility) + 12 integration tests (completion tracking, permission scoping, per-user isolation) | ✅ Pass |
| Mobile responsive pass | Code review of the `md:hidden`/`hidden md:block` breakpoints; no browser/device testing performed | ⚠️ Reviewed, not visually verified |
| Form/navigation safety (unsaved-changes warning, focus trap) | Code review; `useUnsavedChangesWarning`/`useFocusTrap` are new hooks with no dedicated unit test (browser-event-driven, not meaningfully unit-testable without a DOM) | ⚠️ Reviewed, not browser-verified |
| Worker-heartbeat email alert | 13 tests (4 unit + 9 integration) covering send/dedupe/clear/recover | ✅ Pass |

### Core acceptance test — code-level walkthrough

The spec's acceptance standard: *"A salesperson can find or import a lead,
understand why it is valuable, contact it, record the result, schedule the
next action and move it through the pipeline without technical training."*

Traced through the actual code paths (not a live click-through):

1. **Find/import**: Global search (new) or the existing Companies list/
   filters: `companyScope`-respecting, tested. AI research → transfer
   (existing, Module Two/Nine, untouched this module) or Quick Add's Company
   tab (new, reuses `createCompany` with its existing duplicate-warning
   flow).
2. **Understand why it's valuable**: Next Best Action (new — plain-language
   reasons) and the AI results table's evidence panel (enhanced this
   module — confidence, mock-data marking, recommended action) plus the
   pre-existing EOS score panel (untouched).
3. **Contact it**: Quick sales-actions bar (enhanced — now pre-fills and
   opens the right form) or Quick Add's Note/Activity tabs.
4. **Record the result**: the activity form (existing, `createActivity`,
   tested) — outcome/notes fields, unchanged.
5. **Schedule the next action**: the new "schedule the next follow-up?"
   prompt after logging an activity, or Quick Add's Follow-up tab, or the
   existing Follow-ups panel — all funnel to the existing, tested
   `createTask`.
6. **Move it through the pipeline**: the quick-actions bar's stage dropdown
   (existing, unchanged) — one click, no separate page.

Every step in this chain either calls an already-tested existing action
unchanged, or is covered by this module's own new tests. No step in this
flow requires an admin permission or a technical concept a new salesperson
wouldn't already have from `SALES_QUICKSTART.md`. This is a logical/code
trace, explicitly **not** a substitute for an actual timed click-through with
a real user — that belongs in the post-deployment walkthrough below, where a
real browser session (yours, or a future session with browser tooling) can
record actual click counts, confusing labels, and real friction.

---

## Post-deployment section (not yet performed — to fill in together after your approval and a real Railway deploy)

### Production Acceptance Walkthrough

- [ ] **Administrator**: login → admin home → users & roles → org settings →
      AI & email integration status → audit log → system health
- [ ] **Salesperson**: login → My Day → global search → Quick Add → create
      or import a company → add a contact → log an activity → schedule and
      complete a follow-up → move a pipeline stage → review Next Best Action
- [ ] **Lead research**: create/reuse a prompt → run one small controlled
      live-or-mock search → confirm location/lead-type → review evidence and
      score explanation → select and transfer a lead → verify duplicate
      handling
- [ ] **Communications**: send exactly ONE controlled test email to an
      authorized test address → verify status/unsubscribe/suppression →
      never a bulk campaign
- [ ] **Data quality**: review an issue → confirm duplicate-review behavior
      → verify a safe merge using test records only
- [ ] **Operations**: verify web health, worker heartbeat, DB connectivity,
      background job completion, audit entries, backup status, Railway
      usage controls

### Acceptance standard — live timing

- [ ] Real, timed click-through of the core test above with an actual user
      (steps/clicks counted, confusing labels noted, errors noted, mobile
      issues noted, slow pages noted, missing feedback noted, any manual
      workaround noted)
- [ ] Launch-blocking usability problems (if any) fixed before final approval

### Controlled deployment

- [ ] Commit and push Module Ten
- [ ] Open and review the PR; merge to `main` only after checks pass
- [ ] Deploy to Railway from `main`
- [ ] Apply migrations once, via the `web` service's Pre-Deploy step only
- [ ] Start `worker` only after it confirms migration readiness
- [ ] Verify health endpoints on the real deployment
- [ ] Verify no secrets appear anywhere in Railway logs
- [ ] Confirm the production database was never deleted/replaced

This section stays empty until you've reviewed everything above and told me
explicitly to proceed — per the governing stop point, no commit, push,
merge, or Railway action has been taken.
