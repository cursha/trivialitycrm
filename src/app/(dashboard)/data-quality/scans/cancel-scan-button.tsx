"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelScan } from "./actions";

export function CancelScanButton({ scanId }: { scanId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      className="text-xs font-semibold text-danger hover:underline disabled:opacity-50"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm("Cancel this scan?")) return;
        startTransition(async () => {
          await cancelScan(scanId);
          router.refresh();
        });
      }}
    >
      Cancel
    </button>
  );
}
