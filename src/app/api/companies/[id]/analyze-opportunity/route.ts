import { runOpportunityAnalysis } from "@/lib/companies/analyze-opportunity";

/**
 * Streams newline-delimited JSON progress events while a deep opportunity
 * analysis runs, ending with a `{type: "done", result}` or `{type: "error",
 * message}` line. A plain Server Action here would hold one HTTP request
 * open with zero bytes transferred for the whole call — confirmed live,
 * that got killed by Railway's proxy at its 5-minute no-data-transferred
 * idle timeout. Streaming keeps bytes flowing continuously the entire time
 * (Railway allows up to 15 minutes as long as data keeps transferring), and
 * each event is a real signal (an actual web_search/web_fetch call, or a
 * lifecycle step) rather than a synthetic progress indicator.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: companyId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: object) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }

      send({ type: "status", message: "Starting analysis..." });

      try {
        const outcome = await runOpportunityAnalysis(companyId, (message) => send({ type: "status", message }));
        if ("error" in outcome) {
          send({ type: "error", message: outcome.error });
        } else {
          send({ type: "done", result: outcome });
        }
      } catch {
        // requireUser()/requirePermission() throw rather than returning an
        // error result (matching their behavior everywhere else in the
        // app) — translate that into a terminal stream event instead of
        // letting an unhandled rejection just close the stream silently.
        send({ type: "error", message: "You do not have permission to do this." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
