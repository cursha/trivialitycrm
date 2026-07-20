import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { TerritoryManager } from "./territory-manager";

export const metadata = { title: "Territories — Triviality CRM" };

export default async function TerritoriesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_territories");

  const [territories, salespeople] = await Promise.all([
    prisma.territory.findMany({
      orderBy: [{ country: "asc" }, { region: "asc" }, { city: "asc" }],
      include: { assignedTo: true },
    }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Territories"
        description="Organize companies by country, state/province, and city. A city-level territory overrides a broader region/country-level territory for companies within it; identical scopes cannot be created twice."
      />

      <TerritoryManager
        territories={territories.map((t) => ({
          id: t.id,
          name: t.name,
          country: t.country,
          region: t.region,
          city: t.city,
          active: t.active,
          assignedToId: t.assignedToId,
          assignedToName: t.assignedTo?.name ?? null,
        }))}
        salespeople={salespeople.map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}
