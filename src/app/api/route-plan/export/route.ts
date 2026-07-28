import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { exportRoutePlanCsv } from "@/lib/route-plan/service";

/**
 * Mirrors src/app/api/export/companies/route.ts's shape (permission check
 * inside the service call, rate limit, buildCsv, download headers) — the
 * one difference is the filename is dynamic (<lead-type-slug>-route-
 * YYYY-MM-DD.csv), computed server-side in exportRoutePlanCsv() so the
 * client never has to derive or trust a client-supplied filename.
 */
export async function GET() {
  const user = await requireUser();

  const rateLimit = await checkRateLimit(`route-plan-export:${user.id}`, { windowMs: 60_000, limit: 10 });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many exports — wait a moment and try again." }, { status: 429 });
  }

  const result = await exportRoutePlanCsv(user);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return new NextResponse(result.csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}"` },
  });
}
