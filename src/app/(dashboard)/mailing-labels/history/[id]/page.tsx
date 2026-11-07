import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { batchAccess, storedLines } from "@/lib/mailing-labels/service";
import { capacity } from "@/lib/mailing-labels/geometry";
import { BatchActions } from "./batch-actions";

export const metadata = { title: "Label Batch — Triviality CRM" };

export default async function LabelBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "use_mailing_labels");
  const { id } = await params;
  const batch = await prisma.mailingLabelBatch.findFirst({
    where: { id, ownerId: user.id },
    include: { recipients: { orderBy: { sequence: "asc" } }, templateVersion: true, parent: { select: { id: true, createdAt: true } } },
  });
  if (!batch) notFound();
  const access = await batchAccess(user, batch.id);
  const exclusions = Array.isArray(batch.exclusions) ? batch.exclusions : [];
  const perSheet = capacity(batch.templateVersion);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Label batch"
        description={`Generated ${batch.createdAt.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}`}
        actions={
          <Link href="/mailing-labels/history" className={buttonClasses("ghost")}>
            All batches
          </Link>
        }
      />
      <Card className="space-y-1 text-sm text-text">
        <p>
          <span className="font-semibold">{batch.recipientCount}</span> labels on <span className="font-semibold">{batch.pageCount}</span> {batch.pageCount === 1 ? "sheet" : "sheets"}, starting at
          position {batch.startPosition}.
        </p>
        <p>
          Sheet: {batch.templateName} (version {batch.templateVersion.version}, {perSheet} per sheet)
          {batch.alignmentProfileName ? ` · printer setting "${batch.alignmentProfileName}" (${batch.offsetXMm} mm across, ${batch.offsetYMm} mm down)` : " · no printer correction"}
        </p>
        {batch.parent && (
          <p>
            Reprint of the batch from{" "}
            <Link href={`/mailing-labels/history/${batch.parent.id}`} className="font-semibold text-primary underline">
              {batch.parent.createdAt.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
            </Link>
            .
          </p>
        )}
        {exclusions.length > 0 && <p className="text-text-muted">{exclusions.length} matching companies were left out because their address needed correcting.</p>}
        {batch.printedAt && <p>Printed: confirmed {batch.printedAt.toLocaleDateString("en-CA", { dateStyle: "medium" })}</p>}
        {batch.mailedAt && (
          <p>
            Mailed: confirmed {batch.mailedAt.toLocaleDateString("en-CA", { dateStyle: "medium" })}
            {batch.mailedNote ? ` · ${batch.mailedNote}` : ""}
          </p>
        )}
      </Card>

      <BatchActions
        batchId={batch.id}
        available={access.ok}
        unavailableReason={access.ok ? null : access.error}
        printed={!!batch.printedAt}
        mailed={!!batch.mailedAt}
        capacity={perSheet}
        recipients={batch.recipientsPurgedAt ? [] : batch.recipients.map((r) => ({ sequence: r.sequence, companyName: r.companyName }))}
      />

      <Card className="space-y-2">
        <h2 className="text-lg font-bold text-text">Labels, in print order</h2>
        {batch.recipientsPurgedAt ? (
          <p className="text-sm text-text-muted">Names and addresses were cleared under the retention policy on {batch.recipientsPurgedAt.toLocaleDateString("en-CA", { dateStyle: "medium" })}.</p>
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2">
            {batch.recipients.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-2 text-xs leading-snug">
                <span className="text-[11px] text-text-muted">#{r.sequence}</span>
                {storedLines(r.lines).map((line, i) => (
                  <div key={i} className={line.bold ? "font-bold" : ""}>
                    {line.text}
                  </div>
                ))}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
