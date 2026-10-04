import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupTable } from "@/components/lookup-table";
import { AddLookupForm } from "@/components/add-lookup-form";
import {
  createPipelineStage,
  renamePipelineStage,
  setPipelineStageActive,
  movePipelineStage,
  deletePipelineStage,
  setDefaultPipelineStage,
  setPipelineStageOutcome,
} from "./actions";
import { PageHeader } from "@/components/ui/page-header";
import { Label, Select, HelpText } from "@/components/ui/field";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Pipeline Stages — Triviality CRM" };

export default async function PipelineStagesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_settings");

  const stages = await prisma.pipelineStage.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { entryTasks: true } } },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Pipeline Stages"
        description="Add, rename, reorder, and activate or deactivate stages. Exactly one stage is marked as the default for new companies. A stage in use by existing companies can be deactivated but not deleted. Outcome marks a stage as Won or Lost — a Lost stage is excluded from active-pipeline reports and stops generating follow-up nudges; leave it Open for anything still in progress."
      />

      <LookupTable
        items={stages}
        rename={renamePipelineStage}
        setActive={setPipelineStageActive}
        move={movePipelineStage}
        remove={deletePipelineStage}
        setDefault={setDefaultPipelineStage}
        setOutcome={setPipelineStageOutcome}
      />

      <Card>
        <h2 className="font-bold text-accent">Sales process</h2>
        <p className="mt-1 text-sm text-text-muted">
          Each stage&apos;s checklist (shown to reps on the company page) and the follow-ups created automatically when a company enters it.
        </p>
        <ul className="mt-3 divide-y divide-border">
          {stages.map((stage) => (
            <li key={stage.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className={stage.active ? "font-semibold text-text" : "text-text-muted"}>
                {stage.name}
                {!stage.active && " (inactive)"}
              </span>
              <Link href={`/settings/pipeline-stages/${stage.id}`} className="font-bold text-secondary hover:underline">
                Checklist &amp; follow-ups ({stage._count.entryTasks})
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <AddLookupForm
        create={createPipelineStage}
        placeholder="New pipeline stage name"
        extraFields={
          <div>
            <Label>Outcome</Label>
            <Select name="outcomeType" defaultValue="" className="mt-1">
              <option value="">Open</option>
              <option value="WON">Won</option>
              <option value="LOST">Lost</option>
            </Select>
            <HelpText className="mt-1">Lost stages are excluded from active-pipeline reports and follow-up nudges. Can be changed later.</HelpText>
          </div>
        }
      />
    </div>
  );
}
