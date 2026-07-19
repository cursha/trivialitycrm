"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveCompany, restoreCompany, permanentlyDeleteCompany } from "../actions";
import { Button } from "@/components/ui/button";

export function CompanyActions({
  companyId,
  status,
  canDelete,
  canRestore,
  isAdmin,
}: {
  companyId: string;
  status: "ACTIVE" | "ARCHIVED";
  canDelete: boolean;
  canRestore: boolean;
  isAdmin: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleArchive() {
    if (!window.confirm("Archive this company? Its contacts, activities, and history are preserved and it can be restored later.")) {
      return;
    }
    startTransition(async () => {
      await archiveCompany(companyId);
      router.refresh();
    });
  }

  function handleRestore() {
    startTransition(async () => {
      await restoreCompany(companyId);
      router.refresh();
    });
  }

  function handlePermanentDelete() {
    if (
      !window.confirm(
        "Permanently delete this archived company? This removes all its contacts, activities, follow-ups, and scoring history and CANNOT be undone.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      await permanentlyDeleteCompany(companyId);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "ACTIVE" && canDelete && (
        <Button type="button" variant="ghost" disabled={isPending} onClick={handleArchive}>
          Archive
        </Button>
      )}
      {status === "ARCHIVED" && canRestore && (
        <button
          type="button"
          disabled={isPending}
          onClick={handleRestore}
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:pointer-events-none disabled:opacity-50"
        >
          Restore
        </button>
      )}
      {status === "ARCHIVED" && isAdmin && (
        <Button type="button" variant="destructive" disabled={isPending} onClick={handlePermanentDelete}>
          Permanently delete
        </Button>
      )}
    </div>
  );
}
