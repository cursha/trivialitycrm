"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea, Label } from "@/components/ui/field";
import { setDuplicateStatus } from "../actions";

export function ReviewActions({
  potentialDuplicateId,
  canMerge,
  reviewNote,
  status,
}: {
  potentialDuplicateId: string;
  canMerge: boolean;
  reviewNote: string | null;
  status: string;
}) {
  const [note, setNote] = useState(reviewNote ?? "");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function act(newStatus: "NOT_DUPLICATE" | "CONFIRMED" | "DEFERRED") {
    startTransition(async () => {
      await setDuplicateStatus(potentialDuplicateId, newStatus, note || undefined);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-3">
      <div>
        <Label htmlFor="review-note">Review note (optional)</Label>
        <Textarea id="review-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" disabled={isPending} onClick={() => act("NOT_DUPLICATE")}>
          Not a duplicate
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => act("DEFERRED")}>
          Defer for later
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => act("CONFIRMED")}>
          Confirm as duplicate
        </Button>
      </div>
      {!canMerge && status !== "MERGED" && <p className="text-xs text-text-muted">You don&apos;t have permission to merge — confirming still records your review.</p>}
    </Card>
  );
}
