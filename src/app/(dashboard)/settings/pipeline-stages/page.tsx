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
} from "./actions";

export const metadata = { title: "Pipeline Stages — Triviality CRM" };

export default async function PipelineStagesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_settings");

  const stages = await prisma.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Pipeline Stages</h1>
        <p className="mt-1 text-slate-500">
          Add, rename, reorder, and activate or deactivate stages. Exactly one stage is marked as the default for new
          companies. A stage in use by existing companies can be deactivated but not deleted.
        </p>
      </div>

      <LookupTable
        items={stages}
        rename={renamePipelineStage}
        setActive={setPipelineStageActive}
        move={movePipelineStage}
        remove={deletePipelineStage}
        setDefault={setDefaultPipelineStage}
      />

      <AddLookupForm create={createPipelineStage} placeholder="New pipeline stage name" />
    </div>
  );
}
