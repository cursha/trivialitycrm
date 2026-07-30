import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { getOwnedSession, getEntryCallDetail, getSessionProgress, getActiveCallOutcomes, getEditableCompletedEntry } from "@/lib/calling/queries";
import { CallScreen } from "./call-screen";
import { EditCompletedEntry } from "./edit-completed-entry";

export const metadata = { title: "Calling Session — Triviality CRM" };

export default async function CallEntryPage({ params }: { params: Promise<{ id: string; entryId: string }> }) {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");
  const { id: sessionId, entryId } = await params;

  const session = await getOwnedSession(user.id, sessionId);
  if (!session) notFound();
  if (session.status === "PAUSED") redirect(`/calling-sessions/${sessionId}`);
  if (session.status !== "ACTIVE") redirect(`/calling-sessions/${sessionId}`);

  const [entry, outcomes, progress, rejectionReasons] = await Promise.all([
    getEntryCallDetail(entryId),
    getActiveCallOutcomes(),
    getSessionProgress(sessionId),
    prisma.rejectionReason.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  if (!entry || entry.sessionId !== sessionId) notFound();

  if (entry.status !== "PENDING") {
    const editable = await getEditableCompletedEntry(sessionId, entryId);
    if (!editable) redirect(`/calling-sessions/${sessionId}`);
    return <EditCompletedEntry sessionId={sessionId} entryId={entryId} company={editable.company} outcomeName={editable.outcomeName} initialNotes={editable.notes} />;
  }

  return (
    <CallScreen
      sessionId={sessionId}
      entryId={entryId}
      entryPosition={entry.position}
      company={entry.company}
      outcomes={outcomes.map((o) => ({
        id: o.id,
        name: o.name,
        requiresNotes: o.requiresNotes,
        requiresNextAction: o.requiresNextAction,
        defaultNextActionDays: o.defaultNextActionDays,
        defaultNextActionTitle: o.defaultNextActionTitle,
        defaultPipelineStageName: o.defaultPipelineStage?.name ?? null,
        opensEmailComposer: o.opensEmailComposer,
        requiresRejectionReason: o.requiresRejectionReason,
        skipRestOfSession: o.skipRestOfSession,
        appliesDoNotContact: o.appliesDoNotContact,
      }))}
      rejectionReasons={rejectionReasons}
      progress={progress}
    />
  );
}
