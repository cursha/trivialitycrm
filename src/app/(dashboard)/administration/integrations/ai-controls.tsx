"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { setAiIntegrationEnabled, testAiConnection } from "./actions";
import { Button } from "@/components/ui/button";

export function AiControls({ researchEnabled, canManage }: { researchEnabled: boolean; canManage: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  if (!canManage) return null;

  function run(action: () => Promise<{ error?: string; message?: string } | undefined>) {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await action();
      if (result?.error) setError(result.error);
      else {
        if (result?.message) setMessage(result.message);
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button type="button" variant={researchEnabled ? "destructive" : "primary"} disabled={isPending} onClick={() => run(() => setAiIntegrationEnabled(!researchEnabled))}>
        {researchEnabled ? "Disable AI research" : "Enable AI research"}
      </Button>
      <Button type="button" variant="ghost" disabled={isPending} onClick={() => run(() => testAiConnection())}>
        Test AI connection
      </Button>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
      {message && <p className="w-full text-xs text-emerald-700">{message}</p>}
    </div>
  );
}
