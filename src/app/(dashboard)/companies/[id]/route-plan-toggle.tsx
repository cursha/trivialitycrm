"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { MapPin, X } from "lucide-react";
import { addToRoute, removeFromRoute } from "@/app/(dashboard)/route-plan/actions";
import { routeConflictMessage } from "@/lib/route-plan/conflict-message";
import type { CompanyRouteOption } from "@/lib/route-plan/service";
import { routeLabel } from "@/lib/route-plan/format";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";

const NEW_ROUTE = "__new__";

/**
 * "Add to route" for one bar: shows which of the user's routes it's on (each
 * removable) and a picker to add it to another route — e.g. "add this to my
 * Burlington route" — or to a new route named on the spot (Curt's call).
 * A conflict (wrong lead type or country for that route) is explained and
 * nothing changes. Only ever touches the signed-in user's own routes.
 * `compact` drops the card frame and heading, for lists like My Day.
 */
export function AddToRouteToggle({
  companyId,
  routes,
  canManage,
  compact = false,
}: {
  companyId: string;
  routes: CompanyRouteOption[];
  canManage: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [choice, setChoice] = useState("");
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;

  const onRoutes = routes.filter((route) => route.inRoute);
  const available = routes.filter((route) => !route.inRoute);

  function add() {
    if (!choice) return;
    if (choice === NEW_ROUTE && !newName.trim()) {
      setError("Name the new route, e.g. Burlington.");
      return;
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await addToRoute(
        companyId,
        choice === NEW_ROUTE ? { newRoute: { name: newName, plannedDate: newDate || null } } : { routeId: choice },
      );
      if (!result.ok) {
        setError("error" in result ? result.error : routeConflictMessage(result.conflict));
        return;
      }
      setMessage(result.alreadyInRoute ? `Already on your ${result.routeName} route.` : `Added to your ${result.routeName} route (${result.count} stop${result.count === 1 ? "" : "s"}).`);
      setChoice("");
      setNewName("");
      setNewDate("");
      router.refresh();
    });
  }

  function remove(route: CompanyRouteOption) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      await removeFromRoute(companyId, route.id);
      setMessage(`Removed from your ${route.name} route.`);
      router.refresh();
    });
  }

  const body = (
    <div className={clsx("space-y-2", compact && "text-xs")}>
      {onRoutes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!compact && <span className="text-sm text-text-muted">On:</span>}
          {onRoutes.map((route) => (
            <span key={route.id} className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
              <MapPin size={12} aria-hidden="true" />
              {routeLabel(route)}
              <button
                type="button"
                disabled={isPending}
                onClick={() => remove(route)}
                className="rounded-full p-0.5 hover:bg-accent/20"
                aria-label={`Remove from ${route.name} route`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={choice}
          disabled={isPending}
          onChange={(event) => setChoice(event.target.value)}
          aria-label="Add to route"
          className={clsx("w-auto", compact ? "py-1 text-xs" : "py-1.5 text-sm")}
        >
          <option value="">Add to route…</option>
          {available.map((route) => (
            <option key={route.id} value={route.id}>
              {routeLabel(route)}
              {route.isActive ? " (current)" : ""}
            </option>
          ))}
          <option value={NEW_ROUTE}>+ New route…</option>
        </Select>
        {choice === NEW_ROUTE && (
          <>
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Route name, e.g. Burlington"
              maxLength={80}
              aria-label="New route name"
              className={clsx("w-48", compact ? "py-1 text-xs" : "py-1.5")}
            />
            <Input
              type="date"
              value={newDate}
              onChange={(event) => setNewDate(event.target.value)}
              aria-label="New route day (optional)"
              className={clsx("w-auto", compact ? "py-1 text-xs" : "py-1.5")}
            />
          </>
        )}
        {choice && (
          <Button type="button" disabled={isPending} onClick={add} className={compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-xs"}>
            Add
          </Button>
        )}
      </div>
      {message && (compact ? <p className="text-emerald-700">{message}</p> : <Alert tone="success">{message}</Alert>)}
      {error && (compact ? <p className="text-danger">{error}</p> : <Alert tone="danger">{error}</Alert>)}
    </div>
  );

  if (compact) return body;
  return (
    <Card>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-text">
        <MapPin size={16} aria-hidden="true" />
        Route plan
      </h2>
      {body}
    </Card>
  );
}
