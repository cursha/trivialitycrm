"use client";

// No "server-only" here (unlike service.ts) — this runs in the browser,
// triggered from client components. Fetches first specifically so the
// caller can know the server actually generated the file before
// proceeding — spec 9's "successful" is defined as "the server successfully
// generated and returned the CSV response," not a browser
// download-completion event, since browsers don't reliably report the
// latter.
export type DownloadRoutePlanResult = { ok: true } | { ok: false; error: string };

const EXPORT_URL = "/api/route-plan/export";

export async function downloadRoutePlanCsv(): Promise<DownloadRoutePlanResult> {
  // Same checks as the real export, but no file and no audit entry.
  const response = await fetch(`${EXPORT_URL}?check=1`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return { ok: false, error: (body?.error as string | undefined) ?? "The export failed — try again shortly." };
  }

  // The browser's own download of the URL, not a file built in the page
  // from that response: Chrome on Android left a page-built (blob) download
  // greyed out and unopenable even with the blob kept alive (Curt hit it,
  // v8.1). The export answers with Content-Disposition: attachment, so this
  // saves the file without leaving the page — same as Companies "Export
  // CSV", which is a plain link.
  window.location.assign(EXPORT_URL);

  return { ok: true };
}
