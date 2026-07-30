import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { CallOutcomeConfigForm } from "./call-outcome-config-form";

export const metadata = { title: "Configure Call Outcome — Triviality CRM" };

export default async function CallOutcomeConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "manage_call_outcomes");
  const { id } = await params;

  const [outcome, pipelineStages] = await Promise.all([
    prisma.callOutcome.findUnique({ where: { id } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  if (!outcome) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={`Configure "${outcome.name}"`} description="What happens automatically when a salesperson selects this outcome during a guided calling session." />
      <Card>
        <CallOutcomeConfigForm
          outcomeId={outcome.id}
          pipelineStages={pipelineStages}
          initial={{
            requiresNotes: outcome.requiresNotes,
            requiresNextAction: outcome.requiresNextAction,
            defaultNextActionDays: outcome.defaultNextActionDays,
            defaultNextActionTitle: outcome.defaultNextActionTitle,
            defaultPipelineStageId: outcome.defaultPipelineStageId,
            opensEmailComposer: outcome.opensEmailComposer,
            requiresRejectionReason: outcome.requiresRejectionReason,
            skipRestOfSession: outcome.skipRestOfSession,
            appliesDoNotContact: outcome.appliesDoNotContact,
            resultCategory: outcome.resultCategory,
          }}
        />
      </Card>
    </div>
  );
}
