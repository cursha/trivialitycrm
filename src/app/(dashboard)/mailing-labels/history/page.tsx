import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";

export const metadata = { title: "Past Label Batches — Triviality CRM" };

/** Your own generated label batches, newest first. */
export default async function LabelHistoryPage() {
  const user = await requireUser();
  requirePermission(user, "use_mailing_labels");
  const batches = await prisma.mailingLabelBatch.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, createdAt: true, templateName: true, recipientCount: true, pageCount: true, printedAt: true, mailedAt: true, parentBatchId: true, recipientsPurgedAt: true },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Past Label Batches"
        description="Label jobs you've generated. Open one to download it again, reprint some of it, or note that it was printed or mailed."
        actions={
          <Link href="/mailing-labels" className={buttonClasses("ghost")}>
            Back to Mailing Labels
          </Link>
        }
      />
      {batches.length === 0 ? (
        <Card className="text-sm text-text-muted">No label batches yet.</Card>
      ) : (
        <Card className="divide-y divide-border p-0">
          {batches.map((b) => (
            <Link key={b.id} href={`/mailing-labels/history/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-black/5">
              <span className="text-sm text-text">
                <span className="font-semibold">{b.createdAt.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</span> · {b.recipientCount} labels on {b.pageCount}{" "}
                {b.pageCount === 1 ? "sheet" : "sheets"} · {b.templateName}
                {b.parentBatchId && " · reprint"}
              </span>
              <span className="flex gap-1">
                {b.printedAt && <Badge tone="success">Printed</Badge>}
                {b.mailedAt && <Badge tone="primary">Mailed</Badge>}
                {b.recipientsPurgedAt && <Badge tone="neutral">Addresses cleared</Badge>}
              </span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
