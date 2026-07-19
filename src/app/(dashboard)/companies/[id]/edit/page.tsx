import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { getScopedCompany } from "../../queries";
import { CompanyForm } from "../../company-form";
import { updateCompany } from "../../actions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Edit Company — Triviality CRM" };

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "edit_leads");
  const { id } = await params;

  const [company, leadTypes, pipelineStages, competitors, salespeople] = await Promise.all([
    getScopedCompany(user, id),
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.competitor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
  ]);

  if (!company) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={`Edit ${company.name}`} />

      <Card>
        <CompanyForm
          action={updateCompany.bind(null, id)}
          defaultValues={{
            name: company.name,
            address1: company.address1 ?? undefined,
            city: company.city,
            region: company.region,
            postalCode: company.postalCode ?? undefined,
            country: company.country,
            phone: company.phone ?? undefined,
            email: company.email ?? undefined,
            websiteUrl: company.websiteUrl ?? undefined,
            leadTypeId: company.leadTypeId,
            pipelineStageId: company.pipelineStageId,
            competitorId: company.competitorId ?? undefined,
            assignedToId: company.assignedToId,
            triviaStatus: company.triviaStatus,
            notes: company.notes ?? undefined,
            nextFollowUpAt: company.nextFollowUpAt ? company.nextFollowUpAt.toISOString().slice(0, 10) : undefined,
          }}
          leadTypes={leadTypes}
          pipelineStages={pipelineStages}
          competitors={competitors}
          salespeople={salespeople}
          isAdmin={user.role.name === "Administrator"}
          submitLabel="Save changes"
        />
      </Card>
    </div>
  );
}
