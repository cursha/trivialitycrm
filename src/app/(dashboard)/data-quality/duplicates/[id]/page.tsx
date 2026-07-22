import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { MergeComparison } from "./merge-comparison";
import { ReviewActions } from "./review-actions";

export const metadata = { title: "Review Possible Duplicate — Triviality CRM" };

const COMPANY_FIELDS = ["name", "address1", "city", "region", "postalCode", "country", "phone", "email", "websiteUrl", "notes"] as const;
const CONTACT_FIELDS = ["firstName", "lastName", "title", "phone", "email"] as const;

export default async function DuplicateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "review_data_quality");

  const { id } = await params;
  const pair = await prisma.potentialDuplicate.findUnique({ where: { id } });
  if (!pair) notFound();

  if (pair.entityType === "COMPANY") {
    if (!pair.companyAId || !pair.companyBId) notFound();
    const [a, b] = await Promise.all([
      prisma.company.findUnique({
        where: { id: pair.companyAId },
        include: { _count: { select: { contacts: true, activities: true, tasks: true } }, currentHistoricalScore: true },
      }),
      prisma.company.findUnique({
        where: { id: pair.companyBId },
        include: { _count: { select: { contacts: true, activities: true, tasks: true } }, currentHistoricalScore: true },
      }),
    ]);
    if (!a || !b) notFound();

    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader title="Review Possible Duplicate" description={`Score ${pair.score}/100 · ${pair.reasons.join(" · ")}`} />

        {pair.conflictingFields.length > 0 && (
          <Card>
            <p className="text-sm text-text-muted">Conflicting fields: {pair.conflictingFields.join(", ")}</p>
          </Card>
        )}

        <ReviewActions potentialDuplicateId={pair.id} canMerge={hasPermission(user, "merge_companies")} reviewNote={pair.reviewNote} status={pair.status} />

        {hasPermission(user, "merge_companies") && (
          <MergeComparison
            entityType="COMPANY"
            potentialDuplicateId={pair.id}
            recordA={{ id: a.id, label: a.name, extra: `${a._count.contacts} contacts · ${a._count.activities} activities · ${a._count.tasks} tasks`, eosScore: a.eosScore, eosGrade: a.opportunityGrade }}
            recordB={{ id: b.id, label: b.name, extra: `${b._count.contacts} contacts · ${b._count.activities} activities · ${b._count.tasks} tasks`, eosScore: b.eosScore, eosGrade: b.opportunityGrade }}
            fields={COMPANY_FIELDS.map((field) => ({ key: field, label: field, valueA: (a as unknown as Record<string, string | null>)[field], valueB: (b as unknown as Record<string, string | null>)[field] }))}
            companyId={a.id}
          />
        )}
      </div>
    );
  }

  if (!pair.contactAId || !pair.contactBId) notFound();
  const [a, b] = await Promise.all([
    prisma.contact.findUnique({ where: { id: pair.contactAId }, include: { company: { select: { id: true, name: true } } } }),
    prisma.contact.findUnique({ where: { id: pair.contactBId }, include: { company: { select: { id: true, name: true } } } }),
  ]);
  if (!a || !b) notFound();

  const sameCompany = a.companyId === b.companyId;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Review Possible Duplicate" description={`Score ${pair.score}/100 · ${pair.reasons.join(" · ")}`} />

      {!sameCompany && (
        <Card>
          <p className="text-sm text-text-muted">
            These contacts belong to different companies (<strong>{a.company.name}</strong> and <strong>{b.company.name}</strong>) — merge the companies first, which moves every contact onto one company, then merge the contacts.
          </p>
        </Card>
      )}

      {pair.conflictingFields.length > 0 && (
        <Card>
          <p className="text-sm text-text-muted">Conflicting fields: {pair.conflictingFields.join(", ")}</p>
        </Card>
      )}

      <ReviewActions potentialDuplicateId={pair.id} canMerge={hasPermission(user, "merge_contacts") && sameCompany} reviewNote={pair.reviewNote} status={pair.status} />

      {hasPermission(user, "merge_contacts") && sameCompany && (
        <MergeComparison
          entityType="CONTACT"
          potentialDuplicateId={pair.id}
          recordA={{ id: a.id, label: `${a.firstName} ${a.lastName}`, extra: a.email ?? a.phone ?? "", eosScore: null, eosGrade: null }}
          recordB={{ id: b.id, label: `${b.firstName} ${b.lastName}`, extra: b.email ?? b.phone ?? "", eosScore: null, eosGrade: null }}
          fields={CONTACT_FIELDS.map((field) => ({ key: field, label: field, valueA: (a as unknown as Record<string, string | null>)[field], valueB: (b as unknown as Record<string, string | null>)[field] }))}
          companyId={a.companyId}
        />
      )}
    </div>
  );
}
