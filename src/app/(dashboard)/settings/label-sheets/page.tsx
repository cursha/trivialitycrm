import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { getLabelSettings, geometryOf } from "@/lib/mailing-labels/service";
import { LabelSheetManager } from "./label-sheet-manager";

export const metadata = { title: "Label Sheets — Triviality CRM" };

export default async function LabelSheetsPage() {
  const user = await requireUser();
  requirePermission(user, "manage_label_sheets");

  const [templates, settings] = await Promise.all([
    prisma.labelSheetTemplate.findMany({ orderBy: { name: "asc" }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } }),
    getLabelSettings(),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Label Sheets"
        description="The label sheets people can print mailing labels on. Enter measurements taken from your actual sheet (or the manufacturer's published template), then print the calibration page on plain paper to check them before using real labels."
      />
      <LabelSheetManager
        sheets={templates
          .filter((t) => t.versions[0])
          .map((t) => ({
            id: t.id,
            name: t.name,
            productCode: t.productCode,
            active: t.active,
            version: t.versions[0].version,
            measurementNote: t.versions[0].measurementNote,
            geometry: geometryOf(t.versions[0]),
          }))}
        settings={{ maxLabelsPerBatch: settings.maxLabelsPerBatch, retentionDays: settings.retentionDays }}
      />
    </div>
  );
}
