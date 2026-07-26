import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Quick Search — Triviality CRM" };

export default async function QuickSearchBatchPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const user = await requireUser();
  requirePermission(user, "review_research_results");
  const { ids } = await searchParams;

  const searchIds = (ids ?? "").split(",").filter(Boolean);
  const searches = await prisma.leadSearch.findMany({
    where: { id: { in: searchIds } },
    include: { leadType: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Quick Search started"
        description="One search per venue type you checked — open each to watch its progress and see its results."
      />
      <Card className="divide-y divide-border p-0">
        {searches.map((search) => (
          <Link key={search.id} href={`/leads/searches/${search.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-black/5">
            <span className="font-semibold text-text">{search.leadType.name}</span>
            <span className="text-sm text-text-muted">
              {search.region}, {search.country} — {search.status}
            </span>
          </Link>
        ))}
        {searches.length === 0 && <p className="px-4 py-6 text-center text-text-muted">No searches found.</p>}
      </Card>
    </div>
  );
}
