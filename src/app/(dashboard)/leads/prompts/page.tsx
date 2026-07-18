import Link from "next/link";
import { CirclePlus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PromptTable } from "./prompt-table";

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Research Prompts</h1>
          <p className="mt-1 text-slate-500">Reusable prompts for AI-assisted lead discovery, independent of location or Lead Type.</p>
        </div>
        <Link
          href="/leads/prompts/new"
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white"
        >
          <CirclePlus size={16} />
          New prompt
        </Link>
      </div>

      <PromptTable prompts={rows} canManage />
    </div>
  );
}
