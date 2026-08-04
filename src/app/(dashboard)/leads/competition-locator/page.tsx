import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { CompetitionLocatorForm } from "./competition-locator-form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Competition Locator — Triviality CRM" };

export default async function CompetitionLocatorPage() {
  const user = await requireUser();
  requirePermission(user, "run_competition_locator");

  const [competitors, leadTypes] = await Promise.all([
    prisma.competitor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Competition Locator"
        description="Find pubs, bars, breweries, and similar venues currently running a competitor's trivia across Canada and the United States."
        actions={
          <Link href="/leads/competition-locator/history" className="text-sm font-semibold text-secondary hover:underline">
            Search history
          </Link>
        }
      />
      <CompetitionLocatorForm competitors={competitors} leadTypes={leadTypes} />
    </div>
  );
}
