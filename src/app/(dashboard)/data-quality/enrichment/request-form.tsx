"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionHeading } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Label, FieldError, HelpText } from "@/components/ui/field";
import { requestEnrichmentSuggestions } from "./actions";

export function RequestForm() {
  const [entityType, setEntityType] = useState<"COMPANY" | "CONTACT">("COMPANY");
  const [recordId, setRecordId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Card className="space-y-3">
      <SectionHeading>Request enrichment suggestions</SectionHeading>
      <HelpText>Uses the mock provider only — no real lookup is performed, and nothing is applied until you accept a suggestion below.</HelpText>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div>
          <Label htmlFor="entity-type">Record type</Label>
          <Select id="entity-type" value={entityType} onChange={(e) => setEntityType(e.target.value as "COMPANY" | "CONTACT")} className="mt-1">
            <option value="COMPANY">Company</option>
            <option value="CONTACT">Contact</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="record-id">Record ID</Label>
          <Input id="record-id" value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder="Paste a company or contact id" className="mt-1" />
        </div>
        <Button
          type="button"
          disabled={isPending || !recordId.trim()}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await requestEnrichmentSuggestions(entityType, recordId.trim());
              if (result?.error) {
                setError(result.error);
                return;
              }
              setRecordId("");
              router.refresh();
            })
          }
        >
          {isPending ? "Requesting…" : "Request suggestions"}
        </Button>
      </div>
      {error && <FieldError>{error}</FieldError>}
    </Card>
  );
}
