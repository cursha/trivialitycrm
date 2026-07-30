// Calling-list order resolution — pure, unit-tested, shared by the
// admin-configured default (WorkspaceSettings.defaultCallingOrderBy/Dir)
// and a salesperson's own per-session override (spec: "the salesperson may
// change the order... preserve the selected order for that session").
// "Oldest contact date" and "most overdue" have no directly-sortable
// Prisma column (last contact is derived from Activity, not stored), so
// this sorts in application code against an already-fetched, bounded
// company list — correct only because it runs once, at session start, not
// as a live per-page-load query.

export const CALLING_ORDER_FIELDS = ["salesPriorityScore", "eosScore", "lastContact", "nextFollowUpAt", "name", "city", "pipelineStage"] as const;
export type CallingOrderField = (typeof CALLING_ORDER_FIELDS)[number];

const NATURAL_DIRECTION: Record<CallingOrderField, "asc" | "desc"> = {
  salesPriorityScore: "desc",
  eosScore: "desc",
  lastContact: "asc", // oldest contact first
  nextFollowUpAt: "asc", // most overdue (earliest date) first
  name: "asc",
  city: "asc",
  pipelineStage: "asc",
};

export function normalizeCallingOrderField(value: string | null | undefined): CallingOrderField {
  return (CALLING_ORDER_FIELDS as readonly string[]).includes(value ?? "") ? (value as CallingOrderField) : "salesPriorityScore";
}

export function resolveCallingOrderDir(field: CallingOrderField, explicitDir?: string | null): "asc" | "desc" {
  return explicitDir === "asc" || explicitDir === "desc" ? explicitDir : NATURAL_DIRECTION[field];
}

export type OrderableCompany = {
  id: string;
  name: string;
  city: string;
  salesPriorityScore: number | null;
  eosScore: number | null;
  nextFollowUpAt: Date | null;
  pipelineStage: { sortOrder: number };
};

/** Sorts an already-fetched company list for a calling session. Never
 * contacted (no entry in lastContactByCompanyId) sorts as the *oldest*
 * possible contact under the "lastContact" field — a company that's never
 * been reached is at least as overdue as one contacted long ago. */
export function sortCompaniesForCalling<T extends OrderableCompany>(
  companies: T[],
  orderByRaw: string | null | undefined,
  orderDirRaw: string | null | undefined,
  lastContactByCompanyId: Record<string, Date | null>,
): T[] {
  const field = normalizeCallingOrderField(orderByRaw);
  const dir = resolveCallingOrderDir(field, orderDirRaw);
  const sign = dir === "asc" ? 1 : -1;

  if (field === "name" || field === "city") {
    return [...companies].sort((a, b) => sign * a[field].localeCompare(b[field]));
  }

  const keyed = companies.map((c) => {
    let key: number;
    switch (field) {
      case "salesPriorityScore":
        key = c.salesPriorityScore ?? -Infinity;
        break;
      case "eosScore":
        key = c.eosScore ?? -Infinity;
        break;
      case "lastContact": {
        const date = lastContactByCompanyId[c.id];
        key = date ? date.getTime() : -Infinity;
        break;
      }
      case "nextFollowUpAt":
        key = c.nextFollowUpAt ? c.nextFollowUpAt.getTime() : Infinity;
        break;
      case "pipelineStage":
        key = c.pipelineStage.sortOrder;
        break;
    }
    return { c, key };
  });

  return keyed.sort((a, b) => sign * (a.key - b.key)).map((x) => x.c);
}
