"use client";

import { useActionState } from "react";
import { changePassword } from "./actions";
import { Label, Input, HelpText, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <Label htmlFor="currentPassword">Current password</Label>
        <Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" className="mt-1" />
      </div>
      <div>
        <Label htmlFor="newPassword">New password</Label>
        <Input id="newPassword" name="newPassword" type="password" required autoComplete="new-password" className="mt-1" />
        <HelpText className="mt-1">At least 8 characters, with a letter, a number, and a special character.</HelpText>
      </div>
      <div>
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" required autoComplete="new-password" className="mt-1" />
      </div>
      {state?.error && <FieldError>{state.error}</FieldError>}
      <Button type="submit" disabled={pending} variant="primary" className="w-full py-3">
        {pending ? "Saving..." : "Save new password"}
      </Button>
    </form>
  );
}
