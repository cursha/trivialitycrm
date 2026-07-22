import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { getAiSettings, isAiApiKeyConfigured } from "@/lib/ai/budget";
import { getEnv } from "@/lib/env";
import { AiSettingsForm } from "./ai-settings-form";

export const metadata = { title: "AI Settings — Triviality CRM" };

export default async function AiSettingsPage() {
  const user = await requireUser();
  requirePermission(user, "manage_ai_settings");

  const [settings, env] = await Promise.all([getAiSettings(), Promise.resolve(getEnv())]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="AI Settings" description="Non-secret AI research controls. The Anthropic API key itself is never stored or shown here — only whether one is configured." />
      <AiSettingsForm defaultValues={settings} providerMode={env.AI_PROVIDER} apiKeyConfigured={isAiApiKeyConfigured()} />
    </div>
  );
}
