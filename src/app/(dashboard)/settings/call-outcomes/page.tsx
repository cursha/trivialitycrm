import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupTable } from "@/components/lookup-table";
import { AddLookupForm } from "@/components/add-lookup-form";
import { createCallOutcome, renameCallOutcome, setCallOutcomeActive, moveCallOutcome, deleteCallOutcome } from "./actions";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Call & Visit Outcomes — Triviality CRM" };

export default async function CallOutcomesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_call_outcomes");

  const outcomes = await prisma.callOutcome.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Call & Visit Outcomes"
        description="Outcomes available when recording a call in a guided calling session or logging an in-person visit, and what happens automatically when each is selected. An outcome already used to record a call or visit can be deactivated but not deleted."
      />

      <LookupTable
        items={outcomes}
        rename={renameCallOutcome}
        setActive={setCallOutcomeActive}
        move={moveCallOutcome}
        remove={deleteCallOutcome}
        extraColumn={{
          label: "Offered for / Default Action",
          cells: Object.fromEntries(
            outcomes.map((o) => [
              o.id,
              <span key={o.id} className="flex items-center gap-3">
                <span className="text-xs text-text-muted">{[o.appliesToCalls && "Calls", o.appliesToVisits && "Visits"].filter(Boolean).join(" · ")}</span>
                <Link href={`/settings/call-outcomes/${o.id}`} className="text-xs font-semibold text-secondary hover:underline">
                  Configure
                </Link>
              </span>,
            ]),
          ),
        }}
      />

      <AddLookupForm create={createCallOutcome} placeholder="New call outcome" />
    </div>
  );
}
