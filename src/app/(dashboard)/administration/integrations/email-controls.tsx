"use client";

import { useTransition, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { setEmailIntegrationEnabled, sendTestEmail } from "./actions";
import { Button } from "@/components/ui/button";
import { Label, Input, FieldError } from "@/components/ui/field";

export function EmailIntegrationToggle({ sendingEnabled, canManage }: { sendingEnabled: boolean; canManage: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!canManage) return null;

  return (
    <div className="mt-3">
      <Button
        type="button"
        variant={sendingEnabled ? "destructive" : "primary"}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await setEmailIntegrationEnabled(!sendingEnabled);
            if (result?.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        {sendingEnabled ? "Disable live email sending" : "Enable live email sending"}
      </Button>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function TestEmailForm({ canSend }: { canSend: boolean }) {
  const [state, action, pending] = useActionState(sendTestEmail, undefined);

  if (!canSend) return null;

  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <div>
        <Label>Send a test email to</Label>
        <Input name="toAddress" type="email" required placeholder="you@example.com" className="mt-1" />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Sending…" : "Send test email"}
      </Button>
      {state?.error && <FieldError>{state.error}</FieldError>}
      {state?.message && <p className="text-xs text-emerald-700">{state.message}</p>}
    </form>
  );
}
