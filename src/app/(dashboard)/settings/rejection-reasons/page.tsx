import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupTable } from "@/components/lookup-table";
import { AddLookupForm } from "@/components/add-lookup-form";
import { createRejectionReason, renameRejectionReason, setRejectionReasonActive, moveRejectionReason, deleteRejectionReason } from "./actions";

export const metadata = { title: "Rejection Reasons — Triviality CRM" };

export default async function RejectionReasonsPage() {
  const user = await requireUser();
  requirePermission(user, "manage_settings");

  const reasons = await prisma.rejectionReason.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Rejection Reasons</h1>
        <p className="mt-1 text-slate-500">
          Reasons available when rejecting an AI research result. A reason already used on a research result can be
          deactivated but not deleted.
        </p>
      </div>

      <LookupTable
        items={reasons}
        rename={renameRejectionReason}
        setActive={setRejectionReasonActive}
        move={moveRejectionReason}
        remove={deleteRejectionReason}
      />

      <AddLookupForm create={createRejectionReason} placeholder="New rejection reason" />
    </div>
  );
}
