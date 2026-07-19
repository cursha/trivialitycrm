"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { Label, Input, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="username" className="mt-1" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required autoComplete="current-password" className="mt-1" />
      </div>
      {state?.error && <FieldError>{state.error}</FieldError>}
      <Button type="submit" disabled={pending} variant="primary" className="w-full py-3">
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
