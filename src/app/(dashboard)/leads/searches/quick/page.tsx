import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { QuickSearchForm } from "./quick-search-form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Quick Search — Triviality CRM" };

export default async function QuickSearchPage() {
  const user = await requireUser();
  requirePermission(user, "run_research");

  const leadTypes = await prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Quick Search"
        description="Check off the venue types you want and an area — this just lists matching businesses from the directory. No prompt, no AI scoring."
      />
      <QuickSearchForm leadTypes={leadTypes} />
    </div>
  );
}
