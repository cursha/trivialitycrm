"use client";

// No "server-only" here (unlike service.ts) — this runs in the browser,
// triggered from client components. Fetches (rather than a raw navigation/
// anchor href) specifically so the caller can know the server actually
// generated the file before proceeding — spec 9's "successful" is defined
// as "the server successfully generated and returned the CSV response,"
// not a browser download-completion event, since browsers don't reliably
// report the latter.
export type DownloadRoutePlanResult = { ok: true } | { ok: false; error: string };

export async function downloadRoutePlanCsv(): Promise<DownloadRoutePlanResult> {
  const response = await fetch("/api/route-plan/export");
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return { ok: false, error: (body?.error as string | undefined) ?? "The export failed — try again shortly." };
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filenameMatch = /filename="([^"]+)"/.exec(disposition);
  const filename = filenameMatch?.[1] ?? "route.csv";

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { ok: true };
}
