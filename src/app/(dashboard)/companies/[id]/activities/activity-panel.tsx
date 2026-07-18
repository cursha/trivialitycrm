"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Phone, Mail, Users, FileText, Presentation, FlaskConical, StickyNote, GitBranch } from "lucide-react";
import { createActivity } from "./actions";

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
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const result = await createActivity(companyId, undefined, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setLogging(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Activity timeline</h2>
        {canLog && !logging && (
          <button
            type="button"
            onClick={() => setLogging(true)}
            className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline"
          >
            <CirclePlus size={15} />
            Log activity
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}

      {logging && (
        <form action={handleCreate} className="mt-3 space-y-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
          <select name="type" required defaultValue="" className={inputClass}>
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
          </select>
          <input name="outcome" placeholder="Outcome (optional)" className={inputClass} />
          <textarea name="notes" placeholder="Notes" rows={3} className={inputClass} />
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">
              {isPending ? "Saving..." : "Log activity"}
            </button>
            <button
              type="button"
              onClick={() => setLogging(false)}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {activities.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No activity yet.</p>
      ) : (
        <ol className="mt-4 space-y-4 border-l border-slate-200 pl-4">
          {activities.map((activity) => {
            const Icon = TYPE_ICONS[activity.type] ?? StickyNote;
            return (
              <li key={activity.id} className="relative">
                <span className="absolute -left-[21px] flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-blue-600 ring-4 ring-white">
                  <Icon size={13} />
                </span>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold">{TYPE_LABELS[activity.type] ?? activity.type}</p>
                  <p className="text-xs text-slate-400">{new Date(activity.occurredAt).toLocaleString()}</p>
                </div>
                <p className="text-xs text-slate-500">{activity.user.name}</p>
                {activity.outcome && <p className="mt-1 text-sm font-medium text-slate-700">Outcome: {activity.outcome}</p>}
                {activity.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{activity.notes}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
