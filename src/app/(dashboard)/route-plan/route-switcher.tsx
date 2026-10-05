"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createRouteAction, updateRouteAction, selectRouteAction, deleteRouteAction } from "./actions";
import type { RouteListItem } from "@/lib/route-plan/service";
import { formatRouteDate } from "@/lib/route-plan/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";

type Mode = { kind: "none" } | { kind: "new" } | { kind: "edit"; route: RouteListItem };

/**
 * The Route Plan page's route picker: switch between the user's routes
 * (Mississauga today, Milton tomorrow...), create one, rename or re-date
 * the current one, or delete it.
 */
export function RouteSwitcher({ routes, canManage }: { routes: RouteListItem[]; canManage: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const current = routes.find((route) => route.isActive) ?? null;

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  function submitRoute(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    const plannedDate = String(formData.get("plannedDate") ?? "") || null;
    if (mode.kind === "edit") run(() => updateRouteAction(mode.route.id, name, plannedDate), () => setMode({ kind: "none" }));
    else run(() => createRouteAction(name, plannedDate), () => setMode({ kind: "none" }));
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-accent">Your routes</h2>
        {canManage && mode.kind === "none" && (
          <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setMode({ kind: "new" })}>
            <Plus size={14} aria-hidden="true" />
            New route
          </Button>
        )}
      </div>

      {routes.length === 0 ? (
        <p className="text-sm text-text-muted">No routes yet. Create one (e.g. &quot;Mississauga&quot;), or add a bar to a route from its page.</p>
      ) : (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a route">
          {routes.map((route) => (
            <button
              key={route.id}
              type="button"
              disabled={isPending}
              aria-pressed={route.isActive}
              onClick={() => !route.isActive && run(() => selectRouteAction(route.id))}
              className={clsx(
                "rounded-lg border px-3 py-2 text-left text-sm",
                route.isActive ? "border-accent bg-accent text-white" : "border-border-strong text-text hover:bg-black/5",
              )}
            >
              <span className="block font-bold">{route.name}</span>
              <span className={clsx("block text-xs", route.isActive ? "text-white/80" : "text-text-muted")}>
                {[formatRouteDate(route.plannedDate), `${route.count} stop${route.count === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}

      {canManage && current && mode.kind === "none" && (
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" className="flex items-center gap-1 font-semibold text-secondary hover:underline" onClick={() => setMode({ kind: "edit", route: current })}>
            <Pencil size={14} aria-hidden="true" />
            Rename or change date
          </button>
          <button
            type="button"
            disabled={isPending}
            className="flex items-center gap-1 font-semibold text-danger hover:underline"
            onClick={() => {
              if (window.confirm(`Delete the "${current.name}" route and its ${current.count} stop${current.count === 1 ? "" : "s"}? The bars themselves aren't affected.`)) {
                run(() => deleteRouteAction(current.id));
              }
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete route
          </button>
        </div>
      )}

      {mode.kind !== "none" && (
        <form action={submitRoute} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
          <div>
            <Label htmlFor="route-name" className="text-xs">
              Route name
            </Label>
            <Input
              id="route-name"
              name="name"
              required
              maxLength={80}
              autoFocus
              placeholder="e.g. Mississauga"
              defaultValue={mode.kind === "edit" ? mode.route.name : ""}
              className="mt-1 py-1.5"
            />
          </div>
          <div>
            <Label htmlFor="route-date" className="text-xs">
              Day (optional)
            </Label>
            <Input id="route-date" name="plannedDate" type="date" defaultValue={mode.kind === "edit" ? (mode.route.plannedDate ?? "") : ""} className="mt-1 py-1.5" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending} className="px-3 py-1.5 text-xs">
              {mode.kind === "edit" ? "Save" : "Create"}
            </Button>
            <Button type="button" variant="ghost" disabled={isPending} className="px-3 py-1.5 text-xs" onClick={() => setMode({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {error && <FieldError>{error}</FieldError>}
    </Card>
  );
}
