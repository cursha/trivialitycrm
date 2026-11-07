import "server-only";

/** A private PDF response: never cached, never indexed, recipient data
 * only in the body (no addresses in the URL or filename). */
export function pdfResponse(bytes: Uint8Array, filename: string, download: boolean): Response {
  const safe = filename.replace(/[^a-z0-9._-]/gi, "-");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safe}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function textError(message: string, status: number): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
}
