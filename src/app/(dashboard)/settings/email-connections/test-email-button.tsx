"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { sendConnectionTestEmail } from "./actions";

export function TestEmailButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function send() {
    setResult(null);
    startTransition(async () => {
      const outcome = await sendConnectionTestEmail();
      if ("error" in outcome) {
        setResult({ ok: false, message: outcome.error });
      } else {
        setResult({ ok: true, message: "Test email sent — check your inbox." });
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="ghost" onClick={send} disabled={isPending}>
        {isPending ? "Sending..." : "Send test email"}
      </Button>
      {result && <p className={`text-xs ${result.ok ? "text-emerald-700" : "text-danger"}`}>{result.message}</p>}
    </div>
  );
}
