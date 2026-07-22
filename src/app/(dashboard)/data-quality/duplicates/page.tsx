import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { toneFor, CONFIDENCE_TONE, CONFIDENCE_LABEL, DUPLICATE_REVIEW_STATUS_TONE, humanizeEnum } from "@/lib/ui/status-tones";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Duplicate Review — Triviality CRM" };

const PAGE_SIZE = 25;

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  requirePermission(user, "review_data_quality");

  const params = await searchParams;
  const entityType = toSingle(params.entityType);
  const confidence = toSingle(params.confidence);
  const status = toSingle(params.status);
  const page = Math.max(1, Number(toSingle(params.page)) || 1);

  const where: Prisma.PotentialDuplicateWhereInput = {
    ...(entityType ? { entityType: entityType as "COMPANY" | "CONTACT" } : {}),
    ...(confidence ? { confidence: confidence as "HIGH" | "MEDIUM" | "LOW" } : {}),
    ...(status ? { status: status as never } : { status: { in: ["PENDING", "CONFIRMED", "DEFERRED"] } }),
  };

  const [pairs, total] = await Promise.all([
    prisma.potentialDuplicate.findMany({
      where,
      orderBy: [{ score: "desc" }, { detectedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        companyA: { select: { name: true } },
        companyB: { select: { name: true } },
        contactA: { select: { firstName: true, lastName: true } },
        contactB: { select: { firstName: true, lastName: true } },
        assignedTo: { select: { name: true } },
      },
    }),
    prisma.potentialDuplicate.count({ where }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function hrefFor(targetPage: number) {
    const qs = new URLSearchParams();
    if (entityType) qs.set("entityType", entityType);
    if (confidence) qs.set("confidence", confidence);
    if (status) qs.set("status", status);
    qs.set("page", String(targetPage));
    return `/data-quality/duplicates?${qs.toString()}`;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Duplicate Review" description="Compare each pair side by side before deciding. A merge is never automatic — every merge is a deliberate, individually-reviewed action." />

      <Card className="overflow-hidden p-0">
        {pairs.length === 0 ? (
          <div className="p-5">
            <EmptyState>No possible duplicates match these filters.</EmptyState>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {pairs.map((pair) => {
              const labelA = pair.entityType === "COMPANY" ? pair.companyA?.name : pair.contactA ? `${pair.contactA.firstName} ${pair.contactA.lastName}` : null;
              const labelB = pair.entityType === "COMPANY" ? pair.companyB?.name : pair.contactB ? `${pair.contactB.firstName} ${pair.contactB.lastName}` : null;
              return (
                <Link key={pair.id} href={`/data-quality/duplicates/${pair.id}`} className="block px-4 py-3 hover:bg-black/5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={toneFor(CONFIDENCE_TONE, pair.confidence)}>{CONFIDENCE_LABEL[pair.confidence] ?? pair.confidence} confidence</Badge>
                    <Badge tone={toneFor(DUPLICATE_REVIEW_STATUS_TONE, pair.status)}>{humanizeEnum(pair.status)}</Badge>
                    <span className="text-xs text-text-muted">Score {pair.score}/100</span>
                    {pair.assignedTo && <span className="text-xs text-text-muted">Assigned: {pair.assignedTo.name}</span>}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-text">
                    {labelA ?? "Unknown"} ↔ {labelB ?? "Unknown"}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">{pair.reasons.join(" · ")}</p>
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      <Pagination page={page} pageCount={pageCount} pageSize={PAGE_SIZE} hrefFor={hrefFor} />
    </div>
  );
}
