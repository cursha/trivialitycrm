import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { SearchStatus } from "./search-status";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Search Status — Triviality CRM" };

export default async function SearchStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "review_research_results");
  const { id } = await params;

  const search = await prisma.leadSearch.findUnique({
    where: { id },
    select: { id: true, status: true, candidatesFound: true, progressMessage: true, errorMessage: true, region: true, country: true, mode: true },
  });
  if (!search) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={`Search: ${search.region}, ${search.country}`} description={`Mode: ${search.mode}`} />
      <SearchStatus
        searchId={search.id}
        initial={{
          status: search.status,
          candidatesFound: search.candidatesFound,
          progressMessage: search.progressMessage,
          errorMessage: search.errorMessage,
        }}
        canOverrideBudget={hasPermission(user, "manage_ai_settings")}
      />
    </div>
  );
}
