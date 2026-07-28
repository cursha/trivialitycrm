"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addToRoute, removeFromRoute } from "@/app/(dashboard)/route-plan/actions";
import { routeConflictMessage } from "@/lib/route-plan/conflict-message";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

/**
 * Company-profile "Add to Route" control (spec 4.2). Checking it validates
 * eligibility/lead-type/country before adding — a conflict here shows the
 * same plain-language explanation the list's bulk-add conflict uses, but
 * with no export/clear-and-retry choice: adding one company from its own
 * profile is a much lower-stakes action than a multi-company bulk add, so
 * the simplest correct behavior is "explain why, leave it unchecked, let
 * the user go resolve it from the Route Plan page or the list instead."
 * Unchecking only ever removes THIS company from the signed-in user's own
 * route — never affects anyone else's.
 */
export function AddToRouteToggle({
  companyId,
  initiallyInRoute,
  canManage,
}: {
  companyId: string;
  initiallyInRoute: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [inRoute, setInRoute] = useState(initiallyInRoute);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;

  function handleToggle() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      if (inRoute) {
        const result = await removeFromRoute(companyId);
        setInRoute(false);
        setMessage(`Removed from Route Plan — ${result.count} compan${result.count === 1 ? "y" : "ies"} now in your route.`);
        router.refresh();
        return;
      }

      const result = await addToRoute(companyId);
      if (!result.ok) {
        setError("error" in result ? result.error : routeConflictMessage(result.conflict));
        return;
      }
      setInRoute(true);
      setMessage(
        result.alreadyInRoute
          ? "Already in your Route Plan."
          : `Added to Route Plan — ${result.count} compan${result.count === 1 ? "y" : "ies"} now in your route.`,
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <label className="flex items-center gap-2 text-sm font-bold text-text">
        <input type="checkbox" checked={inRoute} disabled={isPending} onChange={handleToggle} aria-label="Add to Route" />
        Add to Route
      </label>
      {message && (
        <Alert tone="success" className="mt-2">
          {message}
        </Alert>
      )}
      {error && (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      )}
    </Card>
  );
}
