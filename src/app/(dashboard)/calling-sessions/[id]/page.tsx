import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { getOwnedSession, getSessionProgress, getNextEntry, getSessionEntriesForOverview } from "@/lib/calling/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SessionControls } from "./session-controls";

const ENTRY_STATUS_TONE: Record<string, "neutral" | "success" | "warning"> = { PENDING: "neutral", COMPLETED: "success", SKIPPED: "warning" };

export const metadata = { title: "Calling Session — Triviality CRM" };

const STATUS_LABEL: Record<string, string> = { ACTIVE: "In progress", PAUSED: "Paused", COMPLETED: "Completed", ENDED: "Ended early" };

export default async function CallingSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");
  const { id: sessionId } = await params;

  const session = await getOwnedSession(user.id, sessionId);
  if (!session) notFound();

  const [progress, next, entries] = await Promise.all([
    getSessionProgress(sessionId),
    session.status === "ACTIVE" ? getNextEntry(sessionId) : null,
    getSessionEntriesForOverview(sessionId),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={`Calling Session — ${session.list.name}`} description={`Started ${new Date(session.startedAt).toLocaleString()}.`} />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <Badge tone={session.status === "ACTIVE" ? "success" : session.status === "PAUSED" ? "warning" : "neutral"}>{STATUS_LABEL[session.status]}</Badge>
        <SessionControls sessionId={sessionId} status={session.status} nextEntryId={next?.id ?? null} />
      </Card>

      <Card className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total" value={progress.total} />
        <Stat label="Completed" value={progress.completed} />
        <Stat label="Remaining" value={progress.remaining} />
        <Stat label="Skipped" value={progress.skipped} />
        <Stat label="Unreachable" value={progress.UNREACHABLE} />
        <Stat label="Interested" value={progress.INTERESTED} />
        <Stat label="Demos Requested" value={progress.DEMO_REQUESTED} />
        <Stat label="Not Interested" value={progress.NOT_INTERESTED} />
      </Card>

      <Card className="space-y-2">
        <h2 className="text-sm font-bold uppercase text-text-muted">Companies</h2>
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <span className="font-semibold text-text">{entry.company.name}</span>
                {entry.outcomeName && <span className="ml-2 text-text-muted">{entry.outcomeName}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={ENTRY_STATUS_TONE[entry.status] ?? "neutral"}>{entry.status}</Badge>
                {entry.editable && session.status === "ACTIVE" && (
                  <Link href={`/calling-sessions/${sessionId}/${entry.id}`} className="text-xs font-semibold text-secondary hover:underline">
                    Edit notes
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Link href="/sales-lists" className="text-sm text-secondary hover:underline">
        ← Back to Sales Lists
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-bold text-text">{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}
