"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveCompany, restoreCompany, permanentlyDeleteCompany } from "../actions";

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
        <button
          type="button"
          disabled={isPending}
          onClick={handleArchive}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
        >
          Archive
        </button>
      )}
      {status === "ARCHIVED" && canRestore && (
        <button
          type="button"
          disabled={isPending}
          onClick={handleRestore}
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
        >
          Restore
        </button>
      )}
      {status === "ARCHIVED" && isAdmin && (
        <button
          type="button"
          disabled={isPending}
          onClick={handlePermanentDelete}
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
        >
          Permanently delete
        </button>
      )}
    </div>
  );
}
