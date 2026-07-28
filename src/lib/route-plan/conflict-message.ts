import type { RouteConflictDetail } from "./service";

/** Plain-language rendering of a RouteConflictDetail, shared by every UI
 * surface that can hit one (company profile toggle, list bulk-add) so the
 * wording never drifts between them. */
export function routeConflictMessage(conflict: RouteConflictDetail): string {
  switch (conflict.type) {
    case "ineligible":
      return `"${conflict.leadTypeName}" is not enabled for Route Planning.`;
    case "lead_type_conflict":
      return `Your Route Plan is for "${conflict.currentLeadTypeName}" — this company is "${conflict.newLeadTypeName}", and a route can only ever hold one lead type.`;
    case "country_conflict":
      return `Your Route Plan is for ${conflict.currentCountry} — this company is in ${conflict.newCountry}, and a route can only ever hold one country.`;
  }
}
