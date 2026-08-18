"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Phone, Mail, Users, FileText, Presentation, FlaskConical, StickyNote, GitBranch } from "lucide-react";
import { createActivity } from "./actions";
import { useQuickActions } from "../quick-action-context";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/field";
import { toDateTimeInputValue } from "@/lib/dates";

export type ActivityRow = {
  id: string;
  type: string;
  occurredAt: Date;
  notes: string | null;
  outcome: string | null;
  user: { name: string };
};

const TYPE_LABELS: Record<string, string> = {
  PHONE: "Phone call",
  EMAIL: "Email",
  MEETING: "Meeting",
  MATERIAL_SENT: "Material sent",
  DEMO: "Demo",
  TRIAL: "Trial",
  NOTE: "General note",
  PIPELINE_CHANGE: "Pipeline change",
};

const TYPE_ICONS: Record<string, typeof Phone> = {
  PHONE: Phone,
  EMAIL: Mail,
  MEETING: Users,
  MATERIAL_SENT: FileText,
  DEMO: Presentation,
  TRIAL: FlaskConical,
  NOTE: StickyNote,
  PIPELINE_CHANGE: GitBranch,
};

export function ActivityPanel({ companyId, activities, canLog }: { companyId: string; activities: ActivityRow[]; canLog: boolean }) {
  const router = useRouter();
  const { registerActivityHandler, requestFollowUp } = useQuickActions();
  const [logging, setLogging] = useState(false);
  const [type, setType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justLogged, setJustLogged] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [now] = useState(() => toDateTimeInputValue());

  useEffect(() => {
    if (!canLog) return;
    return registerActivityHandler((requestedType) => {
      setLogging(true);
      setType(requestedType);
      setJustLogged(false);
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
        setJustLogged(true);
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
            }}
            className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline"
          >
            <CirclePlus size={15} />
            Log activity
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-danger">{error}</p>}

      {logging && (
        <form action={handleCreate} className="mt-3 space-y-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3">
          <Select name="type" required value={type} onChange={(e) => setType(e.target.value)} className="py-1.5">
            <option value="" disabled>
              Activity type
            </option>
            <option value="PHONE">Phone call</option>
            <option value="EMAIL">Email</option>
            <option value="MEETING">Meeting</option>
            <option value="MATERIAL_SENT">Material sent</option>
            <option value="DEMO">Demo</option>
            <option value="TRIAL">Trial</option>
            <option value="NOTE">General note</option>
          </Select>
          <Input name="occurredAt" type="datetime-local" defaultValue={now} className="py-1.5" />
          <Input name="outcome" placeholder="Outcome (optional)" className="py-1.5" />
          <Textarea name="notes" placeholder="Notes" rows={3} className="py-1.5" />
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50">
              {isPending ? "Saving..." : "Log activity"}
            </button>
            <button
              type="button"
              onClick={() => setLogging(false)}
              className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5"
            >
              Cancel
            </button>
          </div>
        </form>
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
                  <p className="font-semibold text-text">{TYPE_LABELS[activity.type] ?? activity.type}</p>
                  <p className="text-xs text-text-muted">{new Date(activity.occurredAt).toLocaleString()}</p>
                </div>
                <p className="text-xs text-text-muted">{activity.user.name}</p>
                {activity.outcome && <p className="mt-1 text-sm font-medium text-text">Outcome: {activity.outcome}</p>}
                {activity.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{activity.notes}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
