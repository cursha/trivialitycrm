import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import type { Prisma } from "@/generated/prisma/client";
import { IssueList } from "./issue-list";

export const metadata = { title: "Data Quality Issues — Triviality CRM" };

const PAGE_SIZE = 25;

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DataQualityIssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  requirePermission(user, "review_data_quality");

  const params = await searchParams;
  const entityType = toSingle(params.entityType);
  const field = toSingle(params.field);
  const ruleType = toSingle(params.ruleType);
  const status = toSingle(params.status);
  const severity = toSingle(params.severity);
  const page = Math.max(1, Number(toSingle(params.page)) || 1);

  const where: Prisma.DataQualityIssueWhereInput = {
    ...(entityType ? { entityType: entityType as "COMPANY" | "CONTACT" } : {}),
    ...(field ? { field } : {}),
    ...(severity ? { severity: severity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" } : {}),
    ...(status ? { status: status as "OPEN" | "DEFERRED" | "RESOLVED" | "IGNORED" | "REOPENED" } : { status: { in: ["OPEN", "DEFERRED", "REOPENED"] } }),
    ...(ruleType ? { rule: { ruleType: ruleType as never } } : {}),
  };

  const [issues, total, salespeople] = await Promise.all([
    prisma.dataQualityIssue.findMany({
      where,
      orderBy: [{ severity: "desc" }, { detectedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, firstName: true, lastName: true, companyId: true } },
        rule: { select: { name: true, ruleType: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    }),
    prisma.dataQualityIssue.count({ where }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function hrefFor(targetPage: number) {
    const qs = new URLSearchParams();
    if (entityType) qs.set("entityType", entityType);
    if (field) qs.set("field", field);
    if (ruleType) qs.set("ruleType", ruleType);
    if (status) qs.set("status", status);
    if (severity) qs.set("severity", severity);
    qs.set("page", String(targetPage));
    return `/data-quality/issues?${qs.toString()}`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Data Quality Issues" description="Open, deferred, and reopened issues from the most recent scan. Merges and field corrections stay individually reviewed even in bulk actions." />

      <IssueList
        issues={issues.map((issue) => ({
          id: issue.id,
          entityType: issue.entityType,
          field: issue.field,
          severity: issue.severity,
          status: issue.status,
          description: issue.description,
          detectedAt: issue.detectedAt.toISOString(),
          notes: issue.notes,
          ruleName: issue.rule.name,
          companyId: issue.company?.id ?? null,
          companyName: issue.company?.name ?? null,
          contactId: issue.contact?.id ?? null,
          contactName: issue.contact ? `${issue.contact.firstName} ${issue.contact.lastName}` : null,
          contactCompanyId: issue.contact?.companyId ?? null,
          assignedToId: issue.assignedTo?.id ?? null,
          assignedToName: issue.assignedTo?.name ?? null,
        }))}
        salespeople={salespeople}
        total={total}
      />

      <Pagination page={page} pageCount={pageCount} pageSize={PAGE_SIZE} hrefFor={hrefFor} />
    </div>
  );
}
