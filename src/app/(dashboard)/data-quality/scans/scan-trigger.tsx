"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, Label } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { triggerDataQualityScan } from "./actions";

export function ScanTrigger() {
  const [entityType, setEntityType] = useState<"" | "COMPANY" | "CONTACT">("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleRun() {
    setError(null);
    startTransition(async () => {
      const result = await triggerDataQualityScan(entityType || null);
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div>
        <Label htmlFor="scan-scope">Scope</Label>
        <Select id="scan-scope" value={entityType} onChange={(e) => setEntityType(e.target.value as typeof entityType)}>
          <option value="">Companies and contacts</option>
          <option value="COMPANY">Companies only</option>
          <option value="CONTACT">Contacts only</option>
        </Select>
      </div>
      <Button type="button" onClick={handleRun} disabled={isPending}>
        {isPending ? "Starting…" : "Run scan"}
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
