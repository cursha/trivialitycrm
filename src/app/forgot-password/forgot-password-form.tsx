"use client";

import { useActionState } from "react";
import Link from "next/link";
import { submitForgotPassword } from "./actions";
import { Label, Input, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

// This is the one message shown for every outcome — unknown email, disabled
// account, already-pending request, or a genuine new request — so the page
// never reveals whether an account exists for the submitted address.
const GENERIC_MESSAGE = "If an account exists for that email, an administrator has been notified and will be in touch with reset instructions.";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(submitForgotPassword, undefined);

  if (state && "submitted" in state) {
    return (
      <div className="mt-6 space-y-4">
        <p className="text-sm text-text">{GENERIC_MESSAGE}</p>
        <Link href="/login" className="text-sm font-semibold text-secondary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="username" className="mt-1" />
      </div>
      {state && "error" in state && <FieldError>{state.error}</FieldError>}
      <Button type="submit" disabled={pending} variant="primary" className="w-full py-3">
        {pending ? "Submitting..." : "Request password reset"}
      </Button>
      <Link href="/login" className="block text-center text-sm font-semibold text-secondary hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
