import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { reportScope } from "@/lib/reports/scope";
import { resolveReportFilters, type ReportFilters } from "@/lib/reports/filters";
import { zonedWeekRange, BUSINESS_TIMEZONE, type DateRange } from "@/lib/timezone";

/** Weekly (Monday-start, BUSINESS_TIMEZONE) buckets spanning [range.start,
 * range.end) — every week in between is included even if empty, so a
 * quiet week shows as a real 0, not a gap. Advances via zonedWeekRange's
 * own `end` boundary rather than a fixed 7*24h step, so DST weeks (which
 * are 167 or 169 hours, not 168) still land on the correct Monday. */
function buildWeekBuckets(range: DateRange): DateRange[] {
  const buckets: DateRange[] = [];
  let cursor = zonedWeekRange(range.start, BUSINESS_TIMEZONE).start;
  while (cursor.getTime() < range.end.getTime()) {
    const { end } = zonedWeekRange(cursor, BUSINESS_TIMEZONE);
    buckets.push({ start: cursor, end });
    cursor = end;
  }
  return buckets;
}

function bucketIndexFor(date: Date, buckets: DateRange[]): number {
  return buckets.findIndex((b) => date >= b.start && date < b.end);
}

export async function getTrendsReport(user: AuthenticatedUser, filters: ReportFilters) {
  const scope = reportScope(user);
  if (!scope) return null;

  const { dateRange, companyWhere } = await resolveReportFilters(filters, scope);

  const [newLeads, decided, activities] = await Promise.all([
    prisma.company.findMany({
      where: { AND: [companyWhere, { createdAt: { gte: dateRange.start, lt: dateRange.end } }] },
      select: { createdAt: true },
    }),
    prisma.pipelineStageHistory.findMany({
      where: { AND: [{ company: companyWhere }, { changedAt: { gte: dateRange.start, lt: dateRange.end } }, { toStage: { outcomeType: { in: ["WON", "LOST"] } } }] },
      select: { changedAt: true, toStage: { select: { outcomeType: true } } },
    }),
    prisma.activity.findMany({
      where: { company: companyWhere, occurredAt: { gte: dateRange.start, lt: dateRange.end } },
      select: { occurredAt: true },
    }),
  ]);

  const buckets = buildWeekBuckets(dateRange);
  const rows = buckets.map((b) => ({ weekStart: b.start, newLeads: 0, won: 0, lost: 0, activities: 0 }));

  for (const c of newLeads) {
    const i = bucketIndexFor(c.createdAt, buckets);
    if (i >= 0) rows[i].newLeads += 1;
  }
  for (const d of decided) {
    const i = bucketIndexFor(d.changedAt, buckets);
    if (i < 0) continue;
    if (d.toStage.outcomeType === "WON") rows[i].won += 1;
    else rows[i].lost += 1;
  }
  for (const a of activities) {
    const i = bucketIndexFor(a.occurredAt, buckets);
    if (i >= 0) rows[i].activities += 1;
  }

  return { rows };
}
