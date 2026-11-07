import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { batchAccess, batchFilename, geometryOf, storedLines } from "@/lib/mailing-labels/service";
import { drawLabelsPdf, fontMetrics, layoutLabels } from "@/lib/mailing-labels/render";
import { pdfResponse, textError } from "@/lib/mailing-labels/pdf-response";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";

/**
 * A generated batch's PDF, re-drawn from its frozen snapshot: the stored
 * lines, the exact sheet version, start position and printer correction.
 * Access is checked again on every request. If the re-drawn layout doesn't
 * match the original's fingerprint, it refuses rather than hand over
 * something different.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!hasPermission(user, "use_mailing_labels")) return textError("You don't have permission to make mailing labels.", 403);
  const rateLimit = await checkRateLimit(`mailing-labels-pdf:${user.id}`, { windowMs: 60_000, limit: 30 });
  if (!rateLimit.allowed) return textError("Too many downloads. Wait a moment and try again.", 429);
  const { id } = await params;
  const access = await batchAccess(user, id);
  if (!access.ok) return textError(access.error, access.status);
  const { batch } = access;
  const geometry = geometryOf(batch.templateVersion);
  const layout = layoutLabels(
    batch.recipients.map((r) => ({ key: r.companyId, lines: storedLines(r.lines) })),
    geometry,
    batch.startPosition,
    batch.offsetXMm,
    batch.offsetYMm,
    await fontMetrics(),
  );
  if (!layout.ok || layout.sha256 !== batch.layoutSha256)
    return textError("This batch can't be reproduced exactly (the label layout has changed since it was made). Start a new draft from current data instead.", 409);
  const bytes = await drawLabelsPdf(layout, geometry, { title: "Mailing labels", createdAt: batch.createdAt });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return pdfResponse(bytes, await batchFilename(batch.id, batch.createdAt), download);
}
