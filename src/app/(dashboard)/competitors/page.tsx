import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { CompetitorTable } from "./competitor-table";
import { AddCompetitorForm } from "./add-competitor-form";

export const metadata = { title: "Competitors — Triviality CRM" };

export default async function CompetitorsPage() {
  const user = await requireUser();
  const canManage = hasPermission(user, "manage_competitors");

  const competitors = await prisma.competitor.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { companies: true } } },
  });

  const rows = competitors.map((competitor) => ({
    id: competitor.id,
    name: competitor.name,
    websiteUrl: competitor.websiteUrl,
    active: competitor.active,
    locationCount: competitor._count.companies,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Competitors</h1>
        <p className="mt-1 text-slate-500">
          Location counts are calculated live from linked companies — click a count to see those companies.
        </p>
      </div>

      <CompetitorTable competitors={rows} canManage={canManage} />

      {canManage && <AddCompetitorForm />}
    </div>
  );
}
