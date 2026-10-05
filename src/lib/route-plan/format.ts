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
