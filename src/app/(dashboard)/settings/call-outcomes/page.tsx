import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupTable } from "@/components/lookup-table";
import { AddLookupForm } from "@/components/add-lookup-form";
import { createCallOutcome, renameCallOutcome, setCallOutcomeActive, moveCallOutcome, deleteCallOutcome } from "./actions";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Call Outcomes — Triviality CRM" };

export default async function CallOutcomesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_call_outcomes");

  const outcomes = await prisma.callOutcome.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Call Outcomes"
        description="Outcomes available when recording a call in a guided calling session, and what happens automatically when each is selected. An outcome already used to record a call can be deactivated but not deleted."
      />

      <LookupTable
        items={outcomes}
        rename={renameCallOutcome}
        setActive={setCallOutcomeActive}
        move={moveCallOutcome}
        remove={deleteCallOutcome}
        extraColumn={{
          label: "Default Action",
          cells: Object.fromEntries(
            outcomes.map((o) => [
              o.id,
              <Link key={o.id} href={`/settings/call-outcomes/${o.id}`} className="text-xs font-semibold text-secondary hover:underline">
                Configure
              </Link>,
            ]),
          ),
        }}
      />

      <AddLookupForm create={createCallOutcome} placeholder="New call outcome" />
    </div>
  );
}
