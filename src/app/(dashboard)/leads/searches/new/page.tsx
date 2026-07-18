import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { SearchForm } from "../search-form";

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
      <div>
        <h1 className="text-3xl font-black tracking-tight">New Research Search</h1>
        <p className="mt-1 text-slate-500">
          The prompt describes the business criteria; country, state/province, cities, and Lead Type are the authoritative filters.
        </p>
      </div>
      <SearchForm prompts={prompts} leadTypes={leadTypes} competitors={competitors} />
    </div>
  );
}
