"use client";

import { useActionState } from "react";
import { CirclePlus } from "lucide-react";
import { createUser } from "./actions";

export function AddUserForm({
  roles,
  teams,
}: {
  roles: { id: string; name: string }[];
  teams: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createUser, undefined);

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <h3 className="text-sm font-bold text-slate-700">Add a user</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="name"
          placeholder="Full name"
          required
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
        <select
          name="roleId"
          required
          defaultValue=""
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          <option value="" disabled>
            Choose a role
          </option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
        <select
          name="teamId"
          defaultValue=""
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          <option value="">No team</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <input
          name="initialPassword"
          type="password"
          placeholder="Temporary password"
          required
          autoComplete="new-password"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 sm:col-span-2"
        />
      </div>
      <p className="text-xs text-slate-500">
        Share this temporary password with the new user directly — they&apos;ll be required to change it on first
        sign-in. At least 8 characters, with a letter, a number, and a special character.
      </p>
      {state?.error && <p className="text-xs font-semibold text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
      >
        <CirclePlus size={16} />
        {pending ? "Adding..." : "Add user"}
      </button>
    </form>
  );
}
