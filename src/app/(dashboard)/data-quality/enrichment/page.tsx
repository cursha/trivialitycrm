import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { RequestForm } from "./request-form";
import { SuggestionRowItem } from "./suggestion-row";

export const metadata = { title: "Enrichment Suggestions — Triviality CRM" };

export default async function EnrichmentPage() {
  const user = await requireUser();
  requirePermission(user, "review_enrichment");

  const suggestions = await prisma.enrichmentRecord.findMany({
    orderBy: { suggestedAt: "desc" },
    take: 100,
    include: { company: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true, companyId: true } } },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Enrichment Suggestions"
        description="Provider-neutral enrichment framework — this module ships only the mock provider. No real third-party lookups happen here, and a suggestion never applies itself; every field change requires your explicit acceptance."
      />

      <RequestForm />

      <Card className="overflow-hidden p-0">
        {suggestions.length === 0 ? (
          <div className="p-5">
            <EmptyState>No enrichment suggestions yet.</EmptyState>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {suggestions.map((s) => (
              <SuggestionRowItem
                key={s.id}
                suggestion={{
                  id: s.id,
                  field: s.field,
                  previousValue: s.previousValue,
                  suggestedValue: s.suggestedValue,
                  provider: s.provider,
                  sourceUrl: s.sourceUrl,
                  evidence: s.evidence ?? "",
                  confidence: s.confidence,
                  decision: s.decision,
                  recordHref: s.company ? `/companies/${s.company.id}` : s.contact ? `/companies/${s.contact.companyId}` : null,
                  recordLabel: s.company?.name ?? (s.contact ? `${s.contact.firstName} ${s.contact.lastName}` : "Unknown record"),
                }}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
