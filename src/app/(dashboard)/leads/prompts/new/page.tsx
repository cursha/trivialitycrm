import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PromptForm } from "../prompt-form";
import { createPrompt } from "../actions";

export const metadata = { title: "New Research Prompt — Triviality CRM" };

export default async function NewPromptPage() {
  const user = await requireUser();
  requirePermission(user, "manage_prompts");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-black tracking-tight">New Research Prompt</h1>
      <PromptForm action={createPrompt} submitLabel="Create prompt" />
    </div>
  );
}
