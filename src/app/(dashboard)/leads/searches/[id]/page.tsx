import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { SearchStatus } from "./search-status";
import { PageHeader } from "@/components/ui/page-header";
import { describeEntertainment, describeVenueKinds } from "@/lib/research/entertainment";

export const metadata = { title: "Search Status — Triviality CRM" };

export default async function SearchStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "review_research_results");
  const { id } = await params;

  const search = await prisma.leadSearch.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      candidatesFound: true,
      progressMessage: true,
      errorMessage: true,
      region: true,
      country: true,
      mode: true,
      entertainment: true,
      venueKinds: true,
      excludeChains: true,
      chainsLeftOut: true,
      originCompany: { select: { name: true } },
    },
  });
  if (!search) notFound();

  const isPubRadius = search.mode === "PUB_RADIUS";
  const title = isPubRadius ? `Search: near ${search.originCompany?.name ?? "Unknown pub"}` : `Search: ${search.region}, ${search.country}`;

  // Each chain once, with how many of its locations were left out.
  const chainCounts = new Map<string, number>();
  for (const name of search.chainsLeftOut) chainCounts.set(name, (chainCounts.get(name) ?? 0) + 1);
  const chainList = [...chainCounts].map(([name, count]) => (count > 1 ? `${name} (${count})` : name)).join(", ");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={title}
        description={`Mode: ${search.mode}${search.venueKinds.length > 0 ? ` · Searched for ${describeVenueKinds(search.venueKinds)}` : ""}${search.entertainment.length > 0 ? ` · Only venues offering ${describeEntertainment(search.entertainment)}` : ""}${search.excludeChains ? " · Chains and franchises left out" : ""}`}
      />
      {search.chainsLeftOut.length > 0 && (
        <p className="text-sm text-text-muted">
          {`Left out ${search.chainsLeftOut.length} chain ${search.chainsLeftOut.length === 1 ? "location" : "locations"}: ${chainList}. Tick "Include chains and franchises" on Quick Search to keep them.`}
        </p>
      )}
      <SearchStatus
        searchId={search.id}
        initial={{
          status: search.status,
          candidatesFound: search.candidatesFound,
          progressMessage: search.progressMessage,
          errorMessage: search.errorMessage,
        }}
        canOverrideBudget={hasPermission(user, "manage_ai_settings")}
        resultsHref={isPubRadius ? `/leads/pub-radius/${search.id}/review` : undefined}
      />
    </div>
  );
}
