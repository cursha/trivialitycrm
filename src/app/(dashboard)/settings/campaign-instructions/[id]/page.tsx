import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { CampaignInstructionForm } from "./campaign-instruction-form";

export const metadata = { title: "Edit Campaign Instructions — Triviality CRM" };

export default async function CampaignInstructionConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "manage_campaign_instructions");
  const { id } = await params;

  const template = await prisma.campaignInstructionTemplate.findUnique({ where: { id } });
  if (!template) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={`Edit "${template.name}"`} description="Guidance passed to the AI when personalizing a campaign message — never facts about a specific company, just tone, offer, and framing." />
      <Card>
        <CampaignInstructionForm templateId={template.id} initialInstructions={template.instructions} />
      </Card>
    </div>
  );
}
