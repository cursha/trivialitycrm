"use client";

import { useActionState } from "react";
import { submitPasswordReset } from "./actions";
import { Label, Input, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(submitPasswordReset, undefined);

  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <Label htmlFor="newPassword">New password</Label>
        <Input id="newPassword" name="newPassword" type="password" required autoComplete="new-password" className="mt-1" />
      </div>
      <div>
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" required autoComplete="new-password" className="mt-1" />
      </div>
      {state?.error && <FieldError>{state.error}</FieldError>}
      <Button type="submit" disabled={pending} variant="primary" className="w-full py-3">
        {pending ? "Saving..." : "Set new password"}
      </Button>
    </form>
  );
}
