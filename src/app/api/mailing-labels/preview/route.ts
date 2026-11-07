import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { getOrCreateDraft, layoutFor, resolveDraft, sheetChoice } from "@/lib/mailing-labels/service";
import { drawLabelsPdf } from "@/lib/mailing-labels/render";
import { pdfResponse, textError } from "@/lib/mailing-labels/pdf-response";

/**
 * The preview: the real PDF of the user's current draft, drawn by the same
 * pipeline as generation. Only served while the draft still matches the
 * fingerprint the user reviewed (?digest=), so the preview is exactly what
 * would be generated.
 */
export async function GET(request: Request) {
  const user = await requireUser();
  if (!hasPermission(user, "use_mailing_labels")) return textError("You don't have permission to make mailing labels.", 403);
  const digest = new URL(request.url).searchParams.get("digest");
  const draft = await getOrCreateDraft(user);
  if (!digest || draft.reviewedDigest !== digest) return textError("This preview is out of date. Click Preview again.", 409);
  const resolution = await resolveDraft(user, draft);
  if (resolution.digest !== digest) return textError("Some companies changed since you clicked Preview. Click Preview again.", 409);
  const sheet = await sheetChoice(user, draft);
  if (!sheet.ok) return textError(sheet.error, 400);
  const layout = await layoutFor(resolution.included, sheet.choice, draft.startPosition);
  if (!layout.ok || layout.labels.length === 0) return textError("These labels can't be laid out. Click Preview again for details.", 400);
  const bytes = await drawLabelsPdf(layout, sheet.choice.geometry, { title: "Mailing labels preview", createdAt: new Date() });
  return pdfResponse(bytes, "mailing-labels-preview.pdf", false);
}
