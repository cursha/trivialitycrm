import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { ImportWizard } from "./import-wizard";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Import Leads — Triviality CRM" };

export default async function ImportPage() {
  const user = await requireUser();
  requirePermission(user, "import_leads");

  const [leadTypes, pipelineStages, salespeople, templates] = await Promise.all([
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
    prisma.importTemplate.findMany({ orderBy: { name: "asc" } }),
  ]);

  const defaultStage = pipelineStages.find((stage) => stage.isDefault) ?? pipelineStages[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Import Leads"
        description="Upload a CSV or Excel file, map its columns, then review and confirm before importing."
      />
      <ImportWizard
        leadTypes={leadTypes.map((lt) => ({ id: lt.id, name: lt.name }))}
        pipelineStages={pipelineStages.map((stage) => ({ id: stage.id, name: stage.name }))}
        defaultPipelineStageId={defaultStage?.id ?? ""}
        salespeople={salespeople.map((sp) => ({ id: sp.id, name: sp.name }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name, mapping: t.mapping as Record<string, string> }))}
      />
    </div>
  );
}
