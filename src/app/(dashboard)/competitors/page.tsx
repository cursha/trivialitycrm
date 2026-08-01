import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { CompetitorTable } from "./competitor-table";
import { AddCompetitorForm } from "./add-competitor-form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Competitors — Triviality CRM" };

export default async function CompetitorsPage() {
  const user = await requireUser();
  const canManage = hasPermission(user, "manage_competitors");

  const competitors = await prisma.competitor.findMany({
    orderBy: { name: "asc" },
  });

  const rows = competitors.map((competitor) => ({
    id: competitor.id,
    name: competitor.name,
    websiteUrl: competitor.websiteUrl,
    active: competitor.active,
    locationCount: competitor.locationCount,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Competitors"
        description="Location count is a manually entered estimate of this competitor's total footprint — it isn't tied to how many of their locations you've linked as companies."
      />

      <CompetitorTable competitors={rows} canManage={canManage} />

      {canManage && <AddCompetitorForm />}
    </div>
  );
}
