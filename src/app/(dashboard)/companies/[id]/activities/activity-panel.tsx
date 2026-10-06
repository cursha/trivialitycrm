"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Phone, Mail, Users, FileText, Presentation, FlaskConical, StickyNote, GitBranch, MapPin, CalendarClock } from "lucide-react";
import { createActivity } from "./actions";
import { VisitForm, type VisitOutcomeOption, type VisitContactOption, type VisitIntel } from "./visit-form";
import { useQuickActions } from "../quick-action-context";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/field";
import { toDateTimeInputValue, formatDueDate } from "@/lib/dates";
import { ACTIVITY_TYPE_LABELS } from "@/lib/activities/labels";

export type ActivityRow = {
  id: string;
  type: string;
  occurredAt: Date;
  notes: string | null;
  outcome: string | null;
  user: { name: string };
  followUps: { id: string; title: string; dueAt: Date; status: string }[];
};

const TYPE_ICONS: Record<string, typeof Phone> = {
  PHONE: Phone,
  EMAIL: Mail,
  MEETING: Users,
  VISIT: MapPin,
  MATERIAL_SENT: FileText,
  DEMO: Presentation,
  TRIAL: FlaskConical,
  NOTE: StickyNote,
  PIPELINE_CHANGE: GitBranch,
};

/** Everything the in-person visit form needs; null hides the Visit option
 * entirely (e.g. on an archived company). */
export type VisitSetup = {
  outcomes: VisitOutcomeOption[];
  rejectionReasons: { id: string; name: string }[];
  contacts: VisitContactOption[];
  intel: VisitIntel;
  hasMailbox: boolean;
};

export function ActivityPanel({
  companyId,
  activities,
  canLog,
  visit,
}: {
  companyId: string;
  activities: ActivityRow[];
  canLog: boolean;
  visit: VisitSetup | null;
}) {
  const router = useRouter();
  const { registerActivityHandler, requestFollowUp } = useQuickActions();
  const [logging, setLogging] = useState(false);
  const [type, setType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justLogged, setJustLogged] = useState(false);
  const [visitMessage, setVisitMessage] = useState<{ text: string; warning: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [now] = useState(() => toDateTimeInputValue());
  const [followUpAt, setFollowUpAt] = useState("");
  // Today as YYYY-MM-DD in the viewer's timezone, for marking a follow-up
  // overdue (lexical compare matches how due dates are stored, by calendar
  // day). Lazy initializer, as with `now` above.
  const [today] = useState(() => toDateTimeInputValue().slice(0, 10));

  useEffect(() => {
    if (!canLog) return;
    return registerActivityHandler((requestedType) => {
      setLogging(true);
      setType(requestedType);
      setJustLogged(false);
      setVisitMessage(null);
    });
  }, [canLog, registerActivityHandler]);

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const result = await createActivity(companyId, undefined, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setLogging(false);
        // Only offer "Schedule the next follow-up?" when one wasn't set here.
        setJustLogged(!followUpAt);
        setFollowUpAt("");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-accent">Activity timeline</h2>
        {canLog && !logging && (
          <button
            type="button"
            onClick={() => {
              setLogging(true);
              setType("");
              setJustLogged(false);
              setVisitMessage(null);
            }}
            className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline"
          >
            <CirclePlus size={15} />
            Log activity
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-danger">{error}</p>}

      {logging && type === "VISIT" && visit && (
        <VisitForm
          companyId={companyId}
          {...visit}
          onCancel={() => setLogging(false)}
          onDone={(result) => {
            setLogging(false);
            setVisitMessage(
              result.warning
                ? { text: result.warning, warning: true }
                : {
                    text: result.demoBooked
                      ? `Visit logged and demo booked${result.inviteSent ? " — calendar invite sent" : ""}.`
                      : "Visit logged.",
                    warning: false,
                  },
            );
            router.refresh();
          }}
        />
      )}

      {logging && type !== "VISIT" && (
        <form action={handleCreate} className="mt-3 space-y-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3">
          <Select name="type" required value={type} onChange={(e) => setType(e.target.value)} className="py-1.5">
            <option value="" disabled>
              Activity type
            </option>
            <option value="PHONE">Phone call</option>
            <option value="EMAIL">Email</option>
            <option value="MEETING">Meeting</option>
            {visit && <option value="VISIT">In-person visit</option>}
            <option value="MATERIAL_SENT">Material sent</option>
            <option value="DEMO">Demo</option>
            <option value="TRIAL">Trial</option>
            <option value="NOTE">General note</option>
          </Select>
          <Input name="occurredAt" type="datetime-local" defaultValue={now} className="py-1.5" />
          <Input name="outcome" placeholder="Outcome (optional)" className="py-1.5" />
          <Textarea name="notes" placeholder="Notes" rows={3} className="py-1.5" />
          <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
            <label htmlFor="activity-follow-up-at" className="text-xs font-semibold text-text-muted">
              Follow up on (optional)
            </label>
            <Input
              id="activity-follow-up-at"
              name="followUpAt"
              type="date"
              min={today}
              value={followUpAt}
              onChange={(e) => setFollowUpAt(e.target.value)}
              className="py-1.5"
            />
          </div>
          {followUpAt && (
            <Input
              name="followUpTitle"
              placeholder={`Follow-up title (default: Follow up: ${ACTIVITY_TYPE_LABELS[type] ?? "activity"})`}
              maxLength={200}
              className="py-1.5"
            />
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50">
              {isPending ? "Saving..." : "Log activity"}
            </button>
            <button
              type="button"
              onClick={() => {
                setLogging(false);
                setFollowUpAt("");
              }}
              className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {visitMessage && (
        <p className={`mt-3 rounded-lg border p-3 text-sm ${visitMessage.warning ? "border-danger/40 text-danger" : "border-border-strong text-text"}`}>
          {visitMessage.text}
        </p>
      )}

      {justLogged && canLog && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border-strong bg-black/[0.02] p-3 text-sm">
          <p className="text-text">Activity logged. Schedule the next follow-up?</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => {
                setJustLogged(false);
                requestFollowUp();
              }}
              className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover"
            >
              Schedule follow-up
            </button>
            <button
              type="button"
              onClick={() => setJustLogged(false)}
              className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {activities.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">No activity yet.</p>
      ) : (
        <ol className="mt-4 space-y-4 border-l border-border pl-4">
          {activities.map((activity) => {
            const Icon = TYPE_ICONS[activity.type] ?? StickyNote;
            return (
              <li key={activity.id} className="relative">
                <span className="absolute -left-[21px] flex h-6 w-6 items-center justify-center rounded-full bg-secondary/10 text-secondary ring-4 ring-surface-raised">
                  <Icon size={13} />
                </span>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold text-text">{ACTIVITY_TYPE_LABELS[activity.type] ?? activity.type}</p>
                  <p className="text-xs text-text-muted">{new Date(activity.occurredAt).toLocaleString()}</p>
                </div>
                <p className="text-xs text-text-muted">{activity.user.name}</p>
                {activity.outcome && <p className="mt-1 text-sm font-medium text-text">Outcome: {activity.outcome}</p>}
                {activity.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{activity.notes}</p>}
                {activity.followUps.map((followUp) => {
                  const due = new Date(followUp.dueAt).toISOString().slice(0, 10);
                  const overdue = followUp.status === "OPEN" && due < today;
                  const closed = followUp.status !== "OPEN";
                  return (
                    <p
                      key={followUp.id}
                      className={`mt-1 flex items-center gap-1.5 text-sm ${overdue ? "font-semibold text-danger" : closed ? "text-text-muted" : "text-text"}`}
                    >
                      <CalendarClock size={14} className="shrink-0" />
                      <span className={closed ? "line-through" : undefined}>
                        Follow-up {formatDueDate(followUp.dueAt, { weekday: "short", month: "short", day: "numeric" })}: {followUp.title}
                      </span>
                      <span className="text-xs">
                        {overdue ? "(overdue)" : followUp.status === "COMPLETED" ? "(done)" : followUp.status === "CANCELLED" ? "(cancelled)" : ""}
                      </span>
                    </p>
                  );
                })}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
