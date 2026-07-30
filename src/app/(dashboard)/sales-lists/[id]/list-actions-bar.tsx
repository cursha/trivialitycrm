"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { archiveSalesList, restoreSalesList, duplicateSalesList, deleteSalesList, refreshDynamicList } from "../actions";

export function ListActionsBar({
  listId,
  type,
  archived,
  canManage,
  canDelete,
}: {
  listId: string;
  type: "FIXED" | "DYNAMIC";
  archived: boolean;
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function refresh() {
    startTransition(async () => {
      const result = await refreshDynamicList(listId);
      if ("error" in result) {
        setNotice(result.error);
        return;
      }
      setNotice(
        `${result.total.toLocaleString()} companies currently match — ${result.newlyEligible} newly eligible, ${result.noLongerMatching} no longer match.`,
      );
      router.refresh();
    });
  }

  function duplicate() {
    startTransition(async () => {
      const result = await duplicateSalesList(listId);
      if ("success" in result) router.push(`/sales-lists/${result.id}`);
    });
  }

  function archiveOrRestore() {
    startTransition(async () => {
      await (archived ? restoreSalesList(listId) : archiveSalesList(listId));
      router.refresh();
    });
  }

  function confirmDelete() {
    startTransition(async () => {
      const result = await deleteSalesList(listId);
      if ("success" in result) router.push("/sales-lists");
      else setNotice(result.error);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {type === "DYNAMIC" && (
          <Button variant="secondary" onClick={refresh} disabled={isPending}>
            Refresh
          </Button>
        )}
        {type === "DYNAMIC" && canManage && !archived && (
          <Link href={`/sales-lists/new?editListId=${listId}`}>
            <Button type="button" variant="ghost">
              Edit filters
            </Button>
          </Link>
        )}
        <Button variant="ghost" onClick={duplicate} disabled={isPending}>
          Duplicate
        </Button>
        {canManage && (
          <Button variant="ghost" onClick={archiveOrRestore} disabled={isPending}>
            {archived ? "Restore" : "Archive"}
          </Button>
        )}
        {canDelete && archived && !confirmingDelete && (
          <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
            Delete permanently
          </Button>
        )}
        {canDelete && archived && confirmingDelete && (
          <>
            <span className="self-center text-sm text-text-muted">Delete this list permanently? This cannot be undone.</span>
            <Button variant="destructive" onClick={confirmDelete} disabled={isPending}>
              Confirm delete
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {notice && <Alert tone="info">{notice}</Alert>}
    </div>
  );
}
