"use client";

// No "server-only" here (unlike service.ts) — this runs in the browser,
// triggered from client components.
//
// Downloading is split in two on purpose. The check runs first (when the
// export confirmation opens), so a problem is shown in the app instead of
// a raw error page. The download itself is then a plain link to
// ROUTE_PLAN_EXPORT_URL that the user taps: Chrome on Android only saved
// the file properly when the download started straight from a tap —
// building it in the page (v8.0), or starting it from code after the check
// had finished (v8.2), left a greyed-out file that wouldn't open (Curt hit
// both). Spec 9's "successful" is the server confirming the export can be
// generated, not a browser download-completion event, which browsers don't
// reliably report.
export const ROUTE_PLAN_EXPORT_URL = "/api/route-plan/export";

export type RoutePlanExportCheck = { ok: true } | { ok: false; error: string };

/** Same checks as the real export, but no file and no audit entry. */
export async function checkRoutePlanExport(): Promise<RoutePlanExportCheck> {
  const response = await fetch(`${ROUTE_PLAN_EXPORT_URL}?check=1`);
  if (response.ok) return { ok: true };
  const body = await response.json().catch(() => null);
  return { ok: false, error: (body?.error as string | undefined) ?? "The export failed — try again shortly." };
}
