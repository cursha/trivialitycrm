"use client";

import { useState, useTransition } from "react";
import { logVisit, type LogVisitResult } from "./actions";
import { Input, Label, Select, Textarea, FieldError, HelpText } from "@/components/ui/field";
import { describeDefaultAction } from "@/lib/calling/outcome-preview";
import { toDateTimeInputValue } from "@/lib/dates";
import { WEEKDAY_LABEL } from "@/lib/ui/status-tones";

export type VisitOutcomeOption = {
  id: string;
  name: string;
  requiresNotes: boolean;
  requiresNextAction: boolean;
  defaultNextActionDays: number | null;
  defaultNextActionTitle: string | null;
  defaultPipelineStageName: string | null;
  requiresRejectionReason: boolean;
  appliesDoNotContact: boolean;
  booksDemo: boolean;
};

export type VisitContactOption = { id: string; name: string; email: string | null; isDecisionMaker: boolean };

export type VisitIntel = { slowNight: string | null; slowNightHeadcount: number | null; currentEntertainment: string | null };

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
  } catch {
    return "America/Toronto";
  }
}

/**
 * The in-person visit form — built to be filled in standing outside the
 * bar on a phone: pick what happened, add a note, optionally jot the bar
 * intel and, for "Demo booked", the demo time. Every time on the form is
 * the rep's own local wall-clock time; the browser's timezone travels with
 * the submit so the server never guesses.
 */
export function VisitForm({
  companyId,
  outcomes,
  rejectionReasons,
  contacts,
  intel,
  hasMailbox,
  onDone,
  onCancel,
}: {
  companyId: string;
  outcomes: VisitOutcomeOption[];
  rejectionReasons: { id: string; name: string }[];
  contacts: VisitContactOption[];
  intel: VisitIntel;
  hasMailbox: boolean;
  onDone: (result: Extract<LogVisitResult, { ok: true }>) => void;
  onCancel: () => void;
}) {
  const [outcomeId, setOutcomeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [now] = useState(() => toDateTimeInputValue());
  const [timezone] = useState(browserTimeZone);
  const [demoContactId, setDemoContactId] = useState(() => contacts.find((c) => c.isDecisionMaker)?.id ?? "");

  const outcome = outcomes.find((o) => o.id === outcomeId) ?? null;
  const preview = outcome
    ? describeDefaultAction({ ...outcome, opensEmailComposer: false, skipRestOfSession: false })
    : [];
  const demoContact = contacts.find((c) => c.id === demoContactId) ?? null;

  function handleSubmit(formData: FormData) {
    formData.set("timezone", timezone);
    startTransition(async () => {
      const result = await logVisit(companyId, formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setError(null);
        onDone(result);
      }
    });
  }

  if (outcomes.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3 text-sm text-text-muted">
        No visit outcomes are set up yet — an administrator can add them under Settings → Call &amp; Visit Outcomes.
        <button type="button" onClick={onCancel} className="ml-2 font-semibold text-secondary hover:underline">
          Close
        </button>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="mt-3 space-y-3 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3">
      <div>
        <Label htmlFor="visit-outcome" className="text-xs">
          What happened?
        </Label>
        <Select id="visit-outcome" name="outcomeId" required value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)} className="mt-1 py-2">
          <option value="" disabled>
            Choose an outcome
          </option>
          {outcomes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        {(preview.length > 0 || outcome?.booksDemo) && (
          <ul className="mt-1 list-disc pl-5 text-xs text-text-muted">
            {outcome?.booksDemo && <li>Book the demo appointment below.</li>}
            {preview.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>

      {outcome?.requiresRejectionReason && (
        <div>
          <Label htmlFor="visit-reason" className="text-xs">
            Reason
          </Label>
          <Select id="visit-reason" name="rejectionReasonId" required defaultValue="" className="mt-1 py-2">
            <option value="" disabled>
              Choose a reason
            </option>
            {rejectionReasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {outcome?.booksDemo && (
        <fieldset className="space-y-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold text-text">Demo</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="visit-demo-start" className="text-xs">
                Date and time
              </Label>
              <Input id="visit-demo-start" name="demoStartAt" type="datetime-local" required className="mt-1 py-2" />
            </div>
            <div>
              <Label htmlFor="visit-demo-length" className="text-xs">
                Length
              </Label>
              <Select id="visit-demo-length" name="demoDurationMinutes" defaultValue="20" className="mt-1 py-2">
                <option value="15">15 minutes</option>
                <option value="20">20 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="visit-demo-contact" className="text-xs">
              With
            </Label>
            <Select id="visit-demo-contact" name="demoContactId" value={demoContactId} onChange={(e) => setDemoContactId(e.target.value)} className="mt-1 py-2">
              <option value="">No contact on file yet</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isDecisionMaker ? " (decision-maker)" : ""}
                </option>
              ))}
            </Select>
          </div>
          {hasMailbox ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="sendInvite" defaultChecked className="mt-0.5" />
              <span>
                Send a calendar invite
                <HelpText>
                  {demoContact?.email
                    ? `Goes to ${demoContact.email} and to you.`
                    : "Goes to you only — no email on file for the contact."}
                </HelpText>
              </span>
            </label>
          ) : (
            <HelpText>No mailbox connected, so the demo is saved in the CRM only (no calendar invite).</HelpText>
          )}
          <HelpText>Times are in your timezone ({timezone}).</HelpText>
        </fieldset>
      )}

      <div>
        <Label htmlFor="visit-notes" className="text-xs">
          Notes{outcome?.requiresNotes ? "" : " (optional)"}
        </Label>
        <Textarea
          id="visit-notes"
          name="notes"
          rows={3}
          required={outcome?.requiresNotes ?? false}
          placeholder="Who you spoke to, what they said, when the owner is in…"
          className="mt-1 py-2"
        />
      </div>

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-xs font-semibold text-text">Bar intel (optional)</summary>
        <HelpText className="mt-1">Only fields you fill in are saved — blank fields keep what&apos;s already on file.</HelpText>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="visit-slow-night" className="text-xs">
              Slowest night
            </Label>
            <Select id="visit-slow-night" name="slowNight" defaultValue="" className="mt-1 py-2">
              <option value="">{intel.slowNight ? `No change (${WEEKDAY_LABEL[intel.slowNight]})` : "No change"}</option>
              {Object.entries(WEEKDAY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="visit-headcount" className="text-xs">
              Typical crowd that night
            </Label>
            <Input
              id="visit-headcount"
              name="slowNightHeadcount"
              type="number"
              inputMode="numeric"
              min={0}
              max={5000}
              placeholder={intel.slowNightHeadcount !== null ? `Currently ${intel.slowNightHeadcount}` : "e.g. 15"}
              className="mt-1 py-2"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="visit-entertainment" className="text-xs">
              Current entertainment
            </Label>
            <Input
              id="visit-entertainment"
              name="currentEntertainment"
              maxLength={200}
              placeholder={intel.currentEntertainment ? `Currently: ${intel.currentEntertainment}` : "e.g. Karaoke Thursdays"}
              className="mt-1 py-2"
            />
          </div>
        </div>
      </details>

      <div>
        <Label htmlFor="visit-when" className="text-xs">
          Visited at
        </Label>
        <Input id="visit-when" name="occurredAt" type="datetime-local" defaultValue={now} className="mt-1 py-2" />
      </div>

      {error && <FieldError>{error}</FieldError>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Log visit"}
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-border-strong px-4 py-2 text-sm font-semibold text-text hover:bg-black/5">
          Cancel
        </button>
      </div>
    </form>
  );
}
