import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { SearchForm } from "../search-form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "New Search — Triviality CRM" };

export default async function NewSearchPage() {
  const user = await requireUser();
  requirePermission(user, "run_research");

  const [prompts, leadTypes, competitors] = await Promise.all([
    prisma.promptTemplate.findMany({ where: { archived: false }, orderBy: { name: "asc" } }),
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.competitor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="New Research Search"
        description="The prompt describes the business criteria; country, state/province, cities, and Lead Type are the authoritative filters."
      />
      <SearchForm prompts={prompts} leadTypes={leadTypes} competitors={competitors} />
    </div>
  );
}
