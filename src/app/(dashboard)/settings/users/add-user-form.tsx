"use client";

import { useActionState, useState } from "react";
import { CirclePlus, Eye, EyeOff } from "lucide-react";
import { createUser } from "./actions";
import { Input, Select, FieldError, HelpText } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function AddUserForm({
  roles,
  teams,
}: {
  roles: { id: string; name: string }[];
  teams: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createUser, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-dashed border-border-strong bg-black/[0.02] p-4">
      <h3 className="text-sm font-bold text-accent">Add a user</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="name" placeholder="Full name" required />
        <Input name="email" type="email" placeholder="Email" required />
        <Select name="roleId" required defaultValue="">
          <option value="" disabled>
            Choose a role
          </option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </Select>
        <Select name="teamId" defaultValue="">
          <option value="">No team</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
        <div className="relative sm:col-span-2">
          <Input
            name="initialPassword"
            type={showPassword ? "text" : "password"}
            placeholder="Temporary password"
            required
            autoComplete="new-password"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Hide temporary password" : "Show temporary password"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-text-muted hover:text-text"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <HelpText>
        Share this temporary password with the new user directly — they&apos;ll be required to change it on first
        sign-in. At least 8 characters, with a letter, a number, and a special character.
      </HelpText>
      {state?.error && <FieldError>{state.error}</FieldError>}
      <Button type="submit" disabled={pending} variant="primary">
        <CirclePlus size={16} />
        {pending ? "Adding..." : "Add user"}
      </Button>
    </form>
  );
}
