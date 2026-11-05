// No "server-only": used by the Route Plan page (server) and the route
// pickers (client).

/** A route's planned day for display, e.g. "Fri, Oct 9". Dates are stored
 * as calendar days, so they're formatted in UTC to avoid shifting a day. */
export function formatRouteDate(plannedDate: string | null): string | null {
  if (!plannedDate) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${plannedDate}T00:00:00Z`));
}

/** "Mississauga (Fri, Oct 9)", or just the name when it has no day. */
export function routeLabel(route: { name: string; plannedDate: string | null }): string {
  const day = formatRouteDate(route.plannedDate);
  return day ? `${route.name} (${day})` : route.name;
}


/** "142 km", or miles for a US route. */
export function formatRouteDistance(meters: number, country: string | null): string {
  const us = /^(us|usa|united states)/i.test(country?.trim() ?? "");
  const value = us ? meters / 1609.344 : meters / 1000;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${us ? "mi" : "km"}`;
}

/** "3 h 10 min", "45 min". */
export function formatDriveTime(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** One line for a planned route, or null when it hasn't been planned. */
export function describeRoutePlan(
  plan: { startAddress: string | null; optimizedAt: Date | null; distanceMeters: number | null; durationSeconds: number | null },
  country: string | null,
): string | null {
  if (!plan.optimizedAt || !plan.startAddress) return null;
  const parts = [`In driving order from ${plan.startAddress} and back`];
  if (plan.distanceMeters) parts.push(formatRouteDistance(plan.distanceMeters, country));
  if (plan.durationSeconds) parts.push(`about ${formatDriveTime(plan.durationSeconds)} of driving`);
  return `${parts.join(" · ")}.`;
}
