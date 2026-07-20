// Deliberately has no "server-only" guard and no Intl/timezone-computation
// code — this is imported by client components (report-filter-bar.tsx) that
// only need the list of valid range keys, not the actual boundary math in
// src/lib/timezone.ts (which IS server-only and would break the client
// bundle if a client component imported it transitively).
export const REPORT_DATE_RANGE_KEYS = ["today", "week", "month", "quarter", "year", "custom"] as const;
export type ReportDateRangeKey = (typeof REPORT_DATE_RANGE_KEYS)[number];
