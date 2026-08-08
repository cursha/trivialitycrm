import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { groupSearchResult } from "@/lib/research/competition-locator-buckets";
import { readContactDataEntries } from "@/lib/research/contact-data";
import { ResultsGroups } from "./results-groups";
import { PageHeader } from "@/components/ui/page-header";
import type { ScoredDuplicateMatch } from "@/lib/duplicates/scored-match";

export const metadata = { title: "Review Results — Triviality CRM" };

// Fork of competition-locator/[runId]/review/page.tsx — queries by
// LeadSearch.id directly (a PUB_RADIUS run is always exactly one LeadSearch,
// no runCorrelationId fan-out needed), and titles/attributes the page after
// the origin pub instead of a competitor. groupSearchResult()/bucketing
// logic is reused unmodified — it's already fully mode-agnostic.
export default async function PubRadiusReviewPage({ params }: { params: Promise<{ searchId: string }> }) {
  const user = await requireUser();
  requirePermission(user, "review_research_results");
  const { searchId } = await params;

  const results = await prisma.searchResult.findMany({
    where: { searchId },
    include: {
      search: { include: { leadType: true, originCompany: true } },
      rejectionReason: true,
    },
    orderBy: { score: "desc" },
  });
  if (results.length === 0) notFound();

  const originCompanyName = results[0].search.originCompany?.name ?? "Unknown pub";

  const topMatchCompanyIds = Array.from(
    new Set(
      results
        .map((r) => (Array.isArray(r.duplicateMatches) ? (r.duplicateMatches as unknown as ScoredDuplicateMatch[])[0]?.companyId : undefined))
        .filter((id): id is string => !!id),
    ),
  );

  const matchedCompanies =
    topMatchCompanyIds.length > 0
      ? await prisma.company.findMany({
          where: { id: { in: topMatchCompanyIds } },
          include: { competitor: true, contacts: { where: { status: "ACTIVE" }, orderBy: { lastName: "asc" } } },
        })
      : [];
  const companiesById = new Map(matchedCompanies.map((c) => [c.id, c]));

  const [pipelineStages, salespeople] = await Promise.all([
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
  ]);
  const defaultStage = pipelineStages.find((stage) => stage.isDefault) ?? pipelineStages[0];

  const rows = results.map((result) => {
    const duplicateMatches = (Array.isArray(result.duplicateMatches) ? result.duplicateMatches : []) as unknown as ScoredDuplicateMatch[];
    const topMatch = duplicateMatches[0];
    const matchedCompany = topMatch ? companiesById.get(topMatch.companyId) : undefined;

    return {
      id: result.id,
      bucket: groupSearchResult(result),
      name: result.name,
      address1: result.address1,
      city: result.city,
      region: result.region,
      postalCode: result.postalCode,
      country: result.country,
      phone: result.phone,
      email: result.email,
      websiteUrl: result.websiteUrl,
      contacts: readContactDataEntries(result.contactData),
      score: result.score,
      explanation: result.explanation,
      evidence: result.evidence as { category: string; note: string; sourceUrl: string | null; verificationStatus: string; verifiedAt?: string | null }[],
      sources: result.sources as { url: string; title: string | null }[],
      triviaStatus: result.triviaStatus,
      disposition: result.disposition,
      rejectionReasonName: result.rejectionReason?.name ?? null,
      duplicateMatches,
      matchedCompany: matchedCompany
        ? {
            id: matchedCompany.id,
            name: matchedCompany.name,
            address1: matchedCompany.address1,
            city: matchedCompany.city,
            region: matchedCompany.region,
            postalCode: matchedCompany.postalCode,
            country: matchedCompany.country,
            phone: matchedCompany.phone,
            email: matchedCompany.email,
            websiteUrl: matchedCompany.websiteUrl,
            contactCount: matchedCompany.contacts.length,
          }
        : null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Review results: near ${originCompanyName}`} description={`${results.length} result(s) found.`} />
      <ResultsGroups
        searchId={searchId}
        rows={rows}
        pipelineStages={pipelineStages.map((s) => ({ id: s.id, name: s.name }))}
        salespeople={salespeople.map((s) => ({ id: s.id, name: s.name }))}
        defaultStageId={defaultStage?.id ?? ""}
      />
    </div>
  );
}
