"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { resetUserPassword } from "./actions";
import { Input } from "@/components/ui/field";

/**
 * Sets a fresh temporary password for an existing user, visible via a
 * show/hide toggle while typing — the same pattern as "Add a user". This is
 * a *reset*, not a recovery: their previous password only ever existed as a
 * one-way bcrypt hash, so there is nothing to "look up" — see actions.ts.
 */
export function ResetPasswordControl({ userId, userName }: { userId: string; userName: string }) {
  const [open, setOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [state, action, pending] = useActionState(resetUserPassword, undefined);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-lg border border-border-strong px-2 py-1 text-xs font-semibold text-text hover:bg-black/5"
      >
        <KeyRound size={14} />
        Reset password
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="userId" value={userId} />
      <div className="relative">
        <Input
          name="newPassword"
          type={showPassword ? "text" : "password"}
          placeholder={`New password for ${userName}`}
          required
          autoComplete="new-password"
          className="w-56 py-1 pr-8 text-xs"
        />
        <button
          type="button"
          onClick={() => setShowPassword((current) => !current)}
          aria-label={showPassword ? "Hide temporary password" : "Show temporary password"}
          aria-pressed={showPassword}
          className="absolute inset-y-0 right-0 flex items-center px-2 text-text-muted hover:text-text"
        >
          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {state?.error && <p className="text-xs font-semibold text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-2 py-1 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
        >
          {pending ? "Setting..." : "Set password"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border-strong px-2 py-1 text-xs font-semibold text-text hover:bg-black/5"
        >
          Done
        </button>
      </div>
    </form>
  );
}
