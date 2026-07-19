import Link from "next/link";
import { CirclePlus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PromptTable } from "./prompt-table";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Research Prompts — Triviality CRM" };

export default async function PromptsPage() {
  const user = await requireUser();
  requirePermission(user, "manage_prompts");

  const prompts = await prisma.promptTemplate.findMany({ orderBy: [{ archived: "asc" }, { updatedAt: "desc" }] });

  const rows = prompts.map((prompt) => ({
    id: prompt.id,
    name: prompt.name,
    qualificationPrompt: prompt.qualificationPrompt,
    archived: prompt.archived,
    updatedAt: prompt.updatedAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Research Prompts"
        description="Reusable prompts for AI-assisted lead discovery, independent of location or Lead Type."
        actions={
          <Link
            href="/leads/prompts/new"
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover"
          >
            <CirclePlus size={16} />
            New prompt
          </Link>
        }
      />

      <PromptTable prompts={rows} canManage />
    </div>
  );
}
