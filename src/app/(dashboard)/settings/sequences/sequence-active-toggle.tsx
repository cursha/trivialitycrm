"use client";

import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { ACTIVE_TONE } from "@/lib/ui/status-tones";
import { setSequenceActive } from "./actions";

export function SequenceActiveToggle({ sequenceId, active }: { sequenceId: string; active: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => setSequenceActive(sequenceId, !active))}
    >
      <Badge tone={ACTIVE_TONE[active ? "active" : "inactive"]}>{active ? "Active" : "Inactive"}</Badge>
    </button>
  );
}
