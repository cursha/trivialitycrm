import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { ResultsTable } from "./results-table";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Search Results — Triviality CRM" };

const PAGE_SIZE = 25;

const DISPOSITION_GROUPS = {
  default: ["NEW", "REVIEWED"] as const,
  all: ["NEW", "REVIEWED", "TRANSFERRED", "REJECTED", "BELOW_SCORE", "DUPLICATE"] as const,
};

export default async function SearchResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; sort?: string; page?: string }>;
}) {
  const user = await requireUser();
  requirePermission(user, "review_research_results");
  const { id } = await params;
  const { view = "default", sort = "score_desc", page: pageParam } = await searchParams;

  const search = await prisma.leadSearch.findUnique({ where: { id } });
  if (!search) notFound();

  const dispositions = view === "all" ? DISPOSITION_GROUPS.all : DISPOSITION_GROUPS.default;
  const page = Math.max(1, Number(pageParam) || 1);

  const [total, results, rejectionReasons] = await Promise.all([
    prisma.searchResult.count({ where: { searchId: id, disposition: { in: [...dispositions] } } }),
    prisma.searchResult.findMany({
      where: { searchId: id, disposition: { in: [...dispositions] } },
      orderBy: sort === "score_asc" ? { score: "asc" } : { score: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { rejectionReason: true, competitor: true },
    }),
    prisma.rejectionReason.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  const rows = results.map((result) => ({
    id: result.id,
    name: result.name,
    address1: result.address1,
    city: result.city,
    region: result.region,
    postalCode: result.postalCode,
    country: result.country,
    phone: result.phone,
    email: result.email,
    websiteUrl: result.websiteUrl,
    score: result.score,
    explanation: result.explanation,
    evidence: result.evidence as { category: string; note: string; sourceUrl: string | null; verificationStatus: string }[],
    sources: result.sources as { url: string; title: string | null }[],
    triviaStatus: result.triviaStatus,
    disposition: result.disposition,
    competitorName: result.competitor?.name ?? null,
    rejectionReasonName: result.rejectionReason?.name ?? null,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={`${search.region}, ${search.country} — Results`}
        description={`Ranked highest to lowest quality score. Minimum score for this search: ${search.minimumScore}.`}
      />

      <ResultsTable
        results={rows}
        rejectionReasons={rejectionReasons.map((reason) => ({ id: reason.id, name: reason.name }))}
        canRestore={hasPermission(user, "restore_rejected")}
        canViewEvidence={hasPermission(user, "view_evidence")}
        canTransfer={hasPermission(user, "transfer_leads")}
        canExport={hasPermission(user, "export_leads")}
        canResearch={hasPermission(user, "run_research")}
        view={view}
        sort={sort}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        searchId={id}
      />
    </div>
  );
}
