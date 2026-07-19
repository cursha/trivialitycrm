import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupTable } from "@/components/lookup-table";
import { AddLookupForm } from "@/components/add-lookup-form";
import { createLeadType, renameLeadType, setLeadTypeActive, moveLeadType, deleteLeadType } from "./actions";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Lead Types — Triviality CRM" };

export default async function LeadTypesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_settings");

  const leadTypes = await prisma.leadType.findMany({ orderBy: { sortOrder: "asc" } });

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
      />

      <AddLookupForm create={createLeadType} placeholder="New lead type name" />
    </div>
  );
}
