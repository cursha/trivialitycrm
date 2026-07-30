"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label, Textarea, FieldError } from "@/components/ui/field";
import { updateCallRecordNotes } from "../../actions";

export function EditCompletedEntry({
  sessionId,
  entryId,
  company,
  outcomeName,
  initialNotes,
}: {
  sessionId: string;
  entryId: string;
  company: { id: string; name: string };
  outcomeName: string;
  initialNotes: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState(initialNotes);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateCallRecordNotes(sessionId, entryId, notes);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(`/calling-sessions/${sessionId}`);
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="space-y-3">
        <div>
          <h1 className="text-xl font-bold text-text">{company.name}</h1>
          <p className="text-sm text-text-muted">Recorded outcome: {outcomeName}</p>
        </div>

        <div>
          <Label htmlFor="notes">Call notes</Label>
          <Textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="button" onClick={save} disabled={isPending}>
            Save notes
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push(`/calling-sessions/${sessionId}`)} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
