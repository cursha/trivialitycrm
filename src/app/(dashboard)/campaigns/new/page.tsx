import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { getSalesListById } from "@/lib/sales-lists/queries";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { CreateCampaignForm } from "./create-campaign-form";

export const metadata = { title: "New Campaign — Triviality CRM" };

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  requirePermission(user, "create_campaigns");
  const { listId } = await searchParams;
  const id = Array.isArray(listId) ? listId[0] : listId;
  if (!id) notFound();

  const list = await getSalesListById(user, id);
  if (!list || list.purpose !== "EMAIL_CAMPAIGN") notFound();

  const [reusableInstructions, emailTemplates, pipelineStages] = await Promise.all([
    prisma.campaignInstructionTemplate.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.emailTemplate.findMany({ where: { visibility: "SHARED", active: true }, orderBy: { name: "asc" } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="New Campaign" description={`Build an AI-personalized email campaign from "${list.name}."`} />
      <Card>
        <CreateCampaignForm
          listId={list.id}
          reusableInstructions={reusableInstructions.map((t) => ({ id: t.id, name: t.name }))}
          emailTemplates={emailTemplates.map((t) => ({ id: t.id, name: t.name }))}
          pipelineStages={pipelineStages.map((s) => ({ id: s.id, name: s.name }))}
        />
      </Card>
    </div>
  );
}
