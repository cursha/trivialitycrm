import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { CompanyForm } from "../company-form";
import { createCompany } from "../actions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export const metadata = { title: "New Company — Triviality CRM" };

export default async function NewCompanyPage() {
  const user = await requireUser();
  requirePermission(user, "add_leads");

  const [leadTypes, pipelineStages, competitors, salespeople] = await Promise.all([
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.competitor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
  ]);

  const defaultStage = pipelineStages.find((stage) => stage.isDefault);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="New Company" description="We'll check for likely duplicates before adding it." />

      <Card>
        <CompanyForm
          action={createCompany}
          defaultValues={defaultStage ? { pipelineStageId: defaultStage.id } : undefined}
          leadTypes={leadTypes}
          pipelineStages={pipelineStages}
          competitors={competitors}
          salespeople={salespeople}
          isAdmin={user.role.name === "Administrator"}
          submitLabel="Create company"
        />
      </Card>
    </div>
  );
}
