"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { FieldError } from "@/components/ui/field";
import { CALLING_ORDER_FIELDS } from "@/lib/calling/order";
import { startCallingSession } from "../../calling-sessions/actions";

const FIELD_LABEL: Record<string, string> = {
  salesPriorityScore: "Highest sales priority",
  eosScore: "Highest EOS",
  lastContact: "Oldest contact date",
  nextFollowUpAt: "Most overdue",
  name: "Company name",
  city: "City",
  pipelineStage: "Pipeline stage",
};

export function StartCallingSessionButton({ listId, defaultOrderBy }: { listId: string; defaultOrderBy: string }) {
  const router = useRouter();
  const [orderBy, setOrderBy] = useState(defaultOrderBy);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function start() {
    setError(null);
    startTransition(async () => {
      const result = await startCallingSession(listId, { orderBy });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(`/calling-sessions/${result.id}`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className="w-auto" value={orderBy} onChange={(e) => setOrderBy(e.target.value)}>
        {CALLING_ORDER_FIELDS.map((f) => (
          <option key={f} value={f}>
            {FIELD_LABEL[f]}
          </option>
        ))}
      </Select>
      <Button type="button" onClick={start} disabled={isPending}>
        Start calling session
      </Button>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
