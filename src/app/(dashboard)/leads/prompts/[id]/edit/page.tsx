import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PromptForm } from "../../prompt-form";
import { updatePrompt } from "../../actions";

export const metadata = { title: "Edit Research Prompt — Triviality CRM" };

export default async function EditPromptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "manage_prompts");
  const { id } = await params;

  const prompt = await prisma.promptTemplate.findUnique({ where: { id } });
  if (!prompt) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-black tracking-tight">Edit {prompt.name}</h1>
      <PromptForm
        action={updatePrompt.bind(null, id)}
        initialName={prompt.name}
        initialPrompt={prompt.qualificationPrompt}
        submitLabel="Save changes"
      />
    </div>
  );
}
