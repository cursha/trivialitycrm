import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeading } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ContactComplianceRow, type ContactComplianceData } from "./contact-compliance-row";

export const metadata = { title: "Communication Compliance — Triviality CRM" };

const RESULT_LIMIT = 50;

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CommunicationCompliancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  requirePermission(user, "manage_communication_compliance");

  const params = await searchParams;
  const q = toSingle(params.q)?.trim();

  const contacts = await prisma.contact.findMany({
    where: {
      status: "ACTIVE",
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" as const } },
              { lastName: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
              { company: { name: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    include: {
      company: { select: { id: true, name: true } },
      consentRecords: { orderBy: { occurredAt: "desc" }, take: 10, include: { recordedBy: { select: { name: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: RESULT_LIMIT + 1,
  });

  const truncated = contacts.length > RESULT_LIMIT;
  const visible = contacts.slice(0, RESULT_LIMIT);

  const rows: ContactComplianceData[] = visible.map((contact) => ({
    id: contact.id,
    name: `${contact.firstName} ${contact.lastName}`,
    email: contact.email,
    companyId: contact.companyId,
    companyName: contact.company.name,
    emailPermitted: contact.emailPermitted,
    doNotContact: contact.doNotContact,
    unsubscribedAt: contact.unsubscribedAt?.toISOString() ?? null,
    history: contact.consentRecords.map((record) => ({
      id: record.id,
      type: record.type,
      source: record.source,
      note: record.note,
      occurredAt: record.occurredAt.toISOString(),
      recordedByName: record.recordedBy?.name ?? null,
    })),
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Communication Compliance"
        description="View and record each contact's email consent — this is a compliance-support tool, not legal advice. A contact cannot receive email from the CRM until consent is recorded here."
      />

      <Card>
        <form method="GET" className="flex gap-2">
          <Input name="q" defaultValue={q ?? ""} placeholder="Search by contact name, email, or company" className="flex-1" />
          <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover">
            Search
          </button>
        </form>
      </Card>

      <Card>
        <SectionHeading>Contacts{q ? ` matching "${q}"` : ""}</SectionHeading>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">
            {q ? "No contacts match that search." : "No contacts yet — search or browse from a company record."}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {rows.map((row) => (
              <ContactComplianceRow key={row.id} contact={row} />
            ))}
          </ul>
        )}
        {truncated && (
          <p className="mt-3 text-xs text-text-muted">
            Showing the first {RESULT_LIMIT} results — refine your search above to narrow this down.
          </p>
        )}
      </Card>
    </div>
  );
}
