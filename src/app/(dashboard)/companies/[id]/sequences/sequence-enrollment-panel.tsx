"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus } from "lucide-react";
import { Card, SectionHeading } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { toneFor } from "@/lib/ui/status-tones";
import type { BadgeTone } from "@/lib/ui/status-tones";
import {
  enrollCompanyInSequence,
  pauseCompanyEnrollment,
  resumeCompanyEnrollment,
  cancelCompanyEnrollment,
} from "./actions";

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "secondary",
  CANCELLED: "neutral",
  STOPPED_OPT_OUT: "danger",
  STOPPED_STAGE: "neutral",
  STOPPED_REPLY: "neutral",
};

export type SequenceOption = { id: string; name: string; hasEmailStep: boolean; preview: string[] };
export type ContactOption = { id: string; name: string };
export type EnrollmentRow = {
  id: string;
  sequenceName: string;
  status: string;
  currentStepOrder: number;
  totalSteps: number;
  nextStepDueAt: string | null;
  stopReason: string | null;
  /** The error from this enrollment's most recent failed step, if any — a
   * failed step never stops the sequence (see src/lib/comms/sequences.ts),
   * so this is the only place in the UI that surfaces it after the fact. */
  lastFailedStepError: string | null;
};

export function SequenceEnrollmentPanel({
  companyId,
  sequences,
  contacts,
  enrollments,
  canEnroll,
}: {
  companyId: string;
  sequences: SequenceOption[];
  contacts: ContactOption[];
  enrollments: EnrollmentRow[];
  canEnroll: boolean;
}) {
  const router = useRouter();
  const [enrolling, setEnrolling] = useState(false);
  const [sequenceId, setSequenceId] = useState("");
  const [contactId, setContactId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedSequence = sequences.find((s) => s.id === sequenceId);

  function handleEnroll(formData: FormData) {
    startTransition(async () => {
      const result = await enrollCompanyInSequence(companyId, undefined, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setEnrolling(false);
        setSequenceId("");
        setContactId("");
        router.refresh();
      }
    });
  }

  function handleAction(action: (companyId: string, enrollmentId: string) => Promise<void>, enrollmentId: string) {
    startTransition(async () => {
      await action(companyId, enrollmentId);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionHeading>Follow-up Sequences</SectionHeading>
        {canEnroll && !enrolling && sequences.length > 0 && (
          <button
            type="button"
            onClick={() => setEnrolling(true)}
            className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline"
          >
            <CirclePlus size={15} />
            Enroll
          </button>
        )}
      </div>

      {enrolling && (
        <form action={handleEnroll} className="mt-3 space-y-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3">
          <div>
            <Label className="text-xs">Sequence</Label>
            <Select name="sequenceId" required value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} className="mt-1 py-1.5">
              <option value="" disabled>
                Choose a sequence
              </option>
              {sequences.map((sequence) => (
                <option key={sequence.id} value={sequence.id}>
                  {sequence.name}
                </option>
              ))}
            </Select>
          </div>

          {selectedSequence && (
            <div className="rounded-lg bg-black/5 p-2 text-xs text-text-muted">
              <p className="font-semibold text-text">Every step in this sequence:</p>
              <ol className="mt-1 list-decimal pl-4">
                {selectedSequence.preview.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ol>
            </div>
          )}

          {selectedSequence?.hasEmailStep && (
            <div>
              <Label className="text-xs">Contact (required — this sequence sends email)</Label>
              <Select required value={contactId} onChange={(e) => setContactId(e.target.value)} className="mt-1 py-1.5">
                <option value="" disabled>
                  Choose a contact
                </option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </Select>
              <input type="hidden" name="contactId" value={contactId} />
            </div>
          )}

          {error && <p className="text-xs font-semibold text-danger">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
            >
              {isPending ? "Enrolling..." : "Confirm enrollment"}
            </button>
            <button
              type="button"
              onClick={() => setEnrolling(false)}
              className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {enrollments.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">Not enrolled in any sequence.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {enrollments.map((enrollment) => (
            <li key={enrollment.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-text">{enrollment.sequenceName}</p>
                <Badge tone={toneFor(STATUS_TONE, enrollment.status)}>{enrollment.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Step {enrollment.currentStepOrder} of {enrollment.totalSteps}
                {enrollment.nextStepDueAt && enrollment.status === "ACTIVE" && (
                  <> · next due {new Date(enrollment.nextStepDueAt).toLocaleString()}</>
                )}
                {enrollment.stopReason && <> · {enrollment.stopReason}</>}
              </p>
              {enrollment.lastFailedStepError && (
                <p className="mt-1 text-xs font-semibold text-danger">Last step failed: {enrollment.lastFailedStepError}</p>
              )}
              {canEnroll && (enrollment.status === "ACTIVE" || enrollment.status === "PAUSED") && (
                <div className="mt-2 flex gap-2">
                  {enrollment.status === "ACTIVE" ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleAction(pauseCompanyEnrollment, enrollment.id)}
                      className="text-xs font-semibold text-secondary hover:underline"
                    >
                      Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleAction(resumeCompanyEnrollment, enrollment.id)}
                      className="text-xs font-semibold text-secondary hover:underline"
                    >
                      Resume
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleAction(cancelCompanyEnrollment, enrollment.id)}
                    className="text-xs font-semibold text-danger hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
