import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { SearchStatus } from "./search-status";

export const metadata = { title: "Search Status — Triviality CRM" };

export default async function SearchStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "review_research_results");
  const { id } = await params;

  const search = await prisma.leadSearch.findUnique({
    where: { id },
    select: { id: true, status: true, candidatesFound: true, errorMessage: true, region: true, country: true, mode: true },
  });
  if (!search) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Search: {search.region}, {search.country}</h1>
        <p className="mt-1 text-slate-500">Mode: {search.mode}</p>
      </div>
      <SearchStatus
        searchId={search.id}
        initial={{ status: search.status, candidatesFound: search.candidatesFound, errorMessage: search.errorMessage }}
      />
    </div>
  );
}
