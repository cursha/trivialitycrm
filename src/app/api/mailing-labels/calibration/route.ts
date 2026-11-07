import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { geometryOf, latestVersion } from "@/lib/mailing-labels/service";
import { drawCalibrationPdf } from "@/lib/mailing-labels/render";
import { offsetKeepsLabelsOnPage, validateGeometry } from "@/lib/mailing-labels/geometry";
import { pdfResponse, textError } from "@/lib/mailing-labels/pdf-response";

/** A calibration page (fictional address, outlines, rulers) for a sheet,
 * with the user's printer correction if one is chosen. */
export async function GET(request: Request) {
  const user = await requireUser();
  if (!hasPermission(user, "use_mailing_labels") && !hasPermission(user, "manage_label_sheets")) return textError("You don't have permission to make mailing labels.", 403);
  const url = new URL(request.url);
  const templateId = url.searchParams.get("templateId") ?? "";
  const profileId = url.searchParams.get("profileId");
  const version = await latestVersion(templateId);
  if (!version) return textError("That label sheet wasn't found.", 404);
  const geometry = geometryOf(version);
  const problems = validateGeometry(geometry);
  if (problems.length > 0) return textError(`This sheet's measurements need fixing: ${problems[0]}`, 400);
  let offsetXMm = 0;
  let offsetYMm = 0;
  if (profileId) {
    const profile = await prisma.labelAlignmentProfile.findFirst({ where: { id: profileId, userId: user.id, templateId } });
    if (profile) ({ offsetXMm, offsetYMm } = profile);
  }
  if (!offsetKeepsLabelsOnPage(geometry, offsetXMm, offsetYMm)) return textError("The printer correction pushes labels off the page.", 400);
  const bytes = await drawCalibrationPdf(geometry, offsetXMm, offsetYMm, { title: "Label calibration test", createdAt: new Date() });
  return pdfResponse(bytes, `label-calibration-${version.template.name}.pdf`, url.searchParams.get("download") === "1");
}
