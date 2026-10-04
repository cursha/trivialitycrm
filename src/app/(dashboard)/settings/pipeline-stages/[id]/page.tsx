import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { StageProcessEditor } from "./stage-process-editor";

export const metadata = { title: "Sales Process Step — Triviality CRM" };

export default async function StageProcessPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "manage_settings");
  const { id } = await params;

  const stage = await prisma.pipelineStage.findUnique({
    where: { id },
    include: { entryTasks: { orderBy: [{ daysAfter: "asc" }, { sortOrder: "asc" }] } },
  });
  if (!stage) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/settings/pipeline-stages" className="text-sm font-bold text-secondary hover:underline">
        ← Pipeline Stages
      </Link>
      <PageHeader
        title={`Sales process: ${stage.name}`}
        description="The checklist reps see on a company's Sales process card while it's at this step, and the follow-ups created automatically when a company enters it (however it gets here: the card, the pipeline board, the edit form, a bulk change, or a call or visit outcome)."
      />
      <StageProcessEditor
        stageId={stage.id}
        playbookLocal={stage.playbookLocal ?? ""}
        playbookRemote={stage.playbookRemote ?? ""}
        tasks={stage.entryTasks.map((task) => ({ id: task.id, title: task.title, daysAfter: task.daysAfter, track: task.track }))}
      />
    </div>
  );
}
