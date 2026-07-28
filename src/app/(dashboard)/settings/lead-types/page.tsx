import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { LookupTable } from "@/components/lookup-table";
import { AddLookupForm } from "@/components/add-lookup-form";
import { createLeadType, renameLeadType, setLeadTypeActive, moveLeadType, deleteLeadType } from "./actions";
import { LeadTypeRouteSettings } from "./route-plan-settings";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Lead Types — Triviality CRM" };

export default async function LeadTypesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_settings");

  const leadTypes = await prisma.leadType.findMany({ orderBy: { sortOrder: "asc" } });
  // A hidden button is UX polish, not the security boundary — the action
  // itself (setLeadTypeRoutePlanSettings) independently requires this same
  // permission regardless of what's rendered here.
  const canConfigureRoutePlan = hasPermission(user, "configure_route_plan_lead_types");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Lead Types"
        description="Add, rename, reorder, and activate or deactivate the Lead Types available to companies. A Lead Type in use by existing companies can be deactivated but not deleted."
      />

      <LookupTable
        items={leadTypes}
        rename={renameLeadType}
        setActive={setLeadTypeActive}
        move={moveLeadType}
        remove={deleteLeadType}
        extraColumn={
          canConfigureRoutePlan
            ? {
                label: "Route Planning",
                cells: Object.fromEntries(
                  leadTypes.map((lt) => [
                    lt.id,
                    <LeadTypeRouteSettings key={lt.id} leadTypeId={lt.id} initialEnabled={lt.routePlanEnabled} initialSlug={lt.routePlanSlug} />,
                  ]),
                ),
              }
            : undefined
        }
      />

      <AddLookupForm create={createLeadType} placeholder="New lead type name" />
    </div>
  );
}
