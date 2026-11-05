"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Route } from "lucide-react";
import { planRouteAction } from "./actions";
import type { RoutePlanInfo } from "@/lib/route-plan/service";
import { describeRoutePlan } from "@/lib/route-plan/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

/**
 * "Put stops in driving order": the rep enters where they start and
 * finish, and Google works out the shortest round trip through every bar on
 * the route. The table, route sheet and export then follow that order.
 */
export function RouteOrderPanel({ plan, country, stopCount }: { plan: RoutePlanInfo; country: string | null; stopCount: number }) {
  const router = useRouter();
  const [startAddress, setStartAddress] = useState(plan.startAddress ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handlePlan() {
    setError(null);
    startTransition(async () => {
      const result = await planRouteAction(startAddress);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const summary = describeRoutePlan(plan, country);

  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-bold text-accent">
        <Route size={16} aria-hidden="true" />
        Driving order
      </h2>
      {summary ? (
        <p className="text-sm text-text">
          {summary}
          {plan.unplannedCount > 0 && (
            <span className="mt-1 block font-semibold text-amber-700">
              {plan.unplannedCount} bar{plan.unplannedCount === 1 ? " was" : "s were"} added since, and {plan.unplannedCount === 1 ? "is" : "are"} listed at
              the end. Plan the route again to fit {plan.unplannedCount === 1 ? "it" : "them"} in.
            </span>
          )}
        </p>
      ) : (
        <p className="text-sm text-text-muted">
          Enter where you&apos;ll start and finish, and Google will put the {stopCount} stop{stopCount === 1 ? "" : "s"} in the shortest driving order.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Label htmlFor="route-start" className="mb-1 block text-xs">
            Start and finish at
          </Label>
          <Input
            id="route-start"
            value={startAddress}
            onChange={(e) => setStartAddress(e.target.value)}
            placeholder="e.g. 123 Main St, Milton, ON"
            maxLength={300}
            className="py-1.5"
          />
        </div>
        <Button type="button" variant="primary" disabled={isPending || !startAddress.trim()} onClick={handlePlan}>
          {isPending ? "Planning..." : summary ? "Plan again" : "Put stops in driving order"}
        </Button>
      </div>
      {error && <p className="text-sm font-semibold text-danger">{error}</p>}
    </Card>
  );
}
