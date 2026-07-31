"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, CalendarClock } from "lucide-react";
import { Card, SectionHeading } from "@/components/ui/card";
import { Label, Input, Select, FieldError } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { toneFor } from "@/lib/ui/status-tones";
import type { BadgeTone } from "@/lib/ui/status-tones";
import { scheduleAppointmentAction, updateAppointmentAction, cancelAppointmentAction } from "./actions";

const STATUS_TONE: Record<string, BadgeTone> = {
  SCHEDULED: "success",
  UPDATED: "focus",
  CANCELLED: "neutral",
  ERROR: "danger",
};

const TYPE_LABELS: Record<string, string> = {
  DEMO: "Demo",
  TRIAL_REVIEW: "Trial review",
  FOLLOW_UP: "Follow-up",
};

export type AppointmentRow = {
  id: string;
  type: string;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  status: string;
  lastError: string | null;
};

export type ContactOption = { id: string; name: string; email: string };

function formatInTimezone(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
}

export function AppointmentPanel({
  companyId,
  appointments,
  contacts,
  canManage,
  calendarAvailable,
}: {
  companyId: string;
  appointments: AppointmentRow[];
  contacts: ContactOption[];
  canManage: boolean;
  /** False when the caller's connected mailbox has no calendar API at all
   * (Titan) — scheduling/rescheduling/cancelling are hidden rather than
   * left to throw "Titan Email has no calendar API" from the provider
   * call. Past appointments (from before switching providers, say) still
   * display read-only. */
  calendarAvailable: boolean;
}) {
  const router = useRouter();
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [contactId, setContactId] = useState("");
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);

  function handleSchedule(formData: FormData) {
    startTransition(async () => {
      const result = await scheduleAppointmentAction(companyId, undefined, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setScheduling(false);
        setContactId("");
        router.refresh();
      }
    });
  }

  function handleCancel(appointmentId: string) {
    if (!window.confirm("Cancel this appointment?")) return;
    startTransition(async () => {
      await cancelAppointmentAction(companyId, appointmentId);
      router.refresh();
    });
  }

  function handleReschedule(appointmentId: string, formData: FormData) {
    startTransition(async () => {
      const result = await updateAppointmentAction(companyId, appointmentId, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setReschedulingId(null);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionHeading>Appointments</SectionHeading>
        {canManage && calendarAvailable && !scheduling && (
          <button
            type="button"
            onClick={() => setScheduling(true)}
            className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline"
          >
            <CirclePlus size={15} />
            Schedule
          </button>
        )}
      </div>

      {canManage && !calendarAvailable && (
        <p className="mt-2 text-xs text-text-muted">
          Your connected mailbox has no calendar API, so scheduling isn&apos;t available — connect Microsoft 365 or Google Workspace instead if
          you need this.
        </p>
      )}

      {scheduling && (
        <form action={handleSchedule} className="mt-3 space-y-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Type</Label>
              <Select name="type" required defaultValue="DEMO" className="mt-1 py-1.5">
                <option value="DEMO">Demo</option>
                <option value="TRIAL_REVIEW">Trial review</option>
                <option value="FOLLOW_UP">Follow-up</option>
              </Select>
            </div>
            {contacts.length > 0 && (
              <div>
                <Label className="text-xs">Contact (optional)</Label>
                <input type="hidden" name="contactId" value={contactId} />
                <Select value={contactId} onChange={(e) => setContactId(e.target.value)} className="mt-1 py-1.5">
                  <option value="">None</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Title</Label>
            <Input name="title" required className="mt-1 py-1.5" placeholder="Product demo with Acme Trivia" />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Start</Label>
              <Input type="datetime-local" name="startAt" required className="mt-1 py-1.5" />
            </div>
            <div>
              <Label className="text-xs">End</Label>
              <Input type="datetime-local" name="endAt" required className="mt-1 py-1.5" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Timezone</Label>
            <Input name="timezone" required defaultValue="America/Toronto" className="mt-1 py-1.5" />
          </div>

          <div>
            <Label className="text-xs">Attendees (comma or newline separated emails, optional)</Label>
            <Input name="attendeeEmails" className="mt-1 py-1.5" placeholder="lead@example.com" />
          </div>

          {error && <FieldError>{error}</FieldError>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
            >
              {isPending ? "Scheduling..." : "Schedule"}
            </button>
            <button
              type="button"
              onClick={() => setScheduling(false)}
              className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {appointments.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">No appointments yet.</p>
      ) : (
        <ol className="mt-4 space-y-3 border-l border-border pl-4">
          {appointments.map((appointment) => (
            <li key={appointment.id} className="relative">
              <span className="absolute -left-[21px] flex h-6 w-6 items-center justify-center rounded-full bg-secondary/10 text-secondary ring-4 ring-surface-raised">
                <CalendarClock size={13} />
              </span>
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-text">
                  {TYPE_LABELS[appointment.type] ?? appointment.type}: {appointment.title}
                </p>
                <Badge tone={toneFor(STATUS_TONE, appointment.status)}>{appointment.status}</Badge>
              </div>
              <p className="text-xs text-text-muted">
                {formatInTimezone(appointment.startAt, appointment.timezone)} – {formatInTimezone(appointment.endAt, appointment.timezone)} (
                {appointment.timezone})
              </p>
              {appointment.lastError && <p className="mt-1 text-xs font-semibold text-danger">{appointment.lastError}</p>}
              {canManage && calendarAvailable && appointment.status !== "CANCELLED" && (
                <div className="mt-1 flex gap-3">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setReschedulingId(reschedulingId === appointment.id ? null : appointment.id)}
                    className="text-xs font-semibold text-secondary hover:underline"
                  >
                    Reschedule
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleCancel(appointment.id)}
                    className="text-xs font-semibold text-danger hover:underline"
                  >
                    Cancel appointment
                  </button>
                </div>
              )}
              {reschedulingId === appointment.id && (
                <form
                  action={(formData) => handleReschedule(appointment.id, formData)}
                  className="mt-2 grid gap-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-2 sm:grid-cols-2"
                >
                  <div>
                    <Label className="text-xs">New start</Label>
                    <Input type="datetime-local" name="startAt" required className="mt-1 py-1.5" />
                  </div>
                  <div>
                    <Label className="text-xs">New end</Label>
                    <Input type="datetime-local" name="endAt" required className="mt-1 py-1.5" />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      disabled={isPending}
                      className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
                    >
                      Save new time
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
