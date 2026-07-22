import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { OrganizationSettingsForm } from "./organization-settings-form";

export const metadata = { title: "Organization Settings — Triviality CRM" };

export default async function OrganizationSettingsPage() {
  const user = await requireUser();
  requirePermission(user, "manage_organization_settings");

  const [settings, pipelineStages, leadTypes] = await Promise.all([
    prisma.organizationSettings.findUnique({ where: { id: 1 } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  const defaultValues = settings ?? {
    organizationName: "",
    defaultCountry: "",
    defaultRegion: null,
    defaultTimezone: "America/Toronto",
    defaultCurrency: "CAD",
    defaultDateFormat: "YYYY-MM-DD",
    defaultPipelineStageId: null,
    defaultLeadTypeId: null,
    businessPhone: null,
    businessEmail: null,
    businessWebsite: null,
    businessAddress: null,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Organization Settings" description="One organization-settings record for this single-organization CRM." />
      <OrganizationSettingsForm
        defaultValues={defaultValues}
        pipelineStages={pipelineStages.map((s) => ({ id: s.id, name: s.name }))}
        leadTypes={leadTypes.map((t) => ({ id: t.id, name: t.name }))}
      />
    </div>
  );
}
