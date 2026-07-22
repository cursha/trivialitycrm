import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { toneFor, SEARCH_STATUS_TONE, SEARCH_STATUS_LABEL, humanizeEnum } from "@/lib/ui/status-tones";
import { ScanTrigger } from "./scan-trigger";
import { CancelScanButton } from "./cancel-scan-button";

export const metadata = { title: "Data Quality Scans — Triviality CRM" };

export default async function ScansPage() {
  const user = await requireUser();
  requirePermission(user, "run_duplicate_scan");

  const scans = await prisma.dataQualityScan.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { triggeredBy: { select: { name: true } } },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Data Quality Scans" description="Scans are triggered manually — there is no automatic recurring schedule. A scan is restart-safe and can be cancelled while running." />

      <Card>
        <ScanTrigger />
      </Card>

      <Card className="space-y-3">
        {scans.length === 0 ? (
          <EmptyState>No scans have been run yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <th className="py-2 pr-3">Scope</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Scanned</th>
                  <th className="py-2 pr-3">Issues</th>
                  <th className="py-2 pr-3">Duplicates</th>
                  <th className="py-2 pr-3">Triggered by</th>
                  <th className="py-2 pr-3">Started</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr key={scan.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">{scan.entityType ? humanizeEnum(scan.entityType) : "Companies and contacts"}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={toneFor(SEARCH_STATUS_TONE, scan.status)}>{SEARCH_STATUS_LABEL[scan.status] ?? scan.status}</Badge>
                    </td>
                    <td className="py-2 pr-3">{scan.recordsScanned}</td>
                    <td className="py-2 pr-3">{scan.issuesFound}</td>
                    <td className="py-2 pr-3">{scan.duplicatesFound}</td>
                    <td className="py-2 pr-3">{scan.triggeredBy?.name ?? "—"}</td>
                    <td className="py-2 pr-3 text-text-muted">{scan.startedAt ? scan.startedAt.toLocaleString() : "—"}</td>
                    <td className="py-2 pr-3">{(scan.status === "PENDING" || scan.status === "RUNNING") && <CancelScanButton scanId={scan.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
