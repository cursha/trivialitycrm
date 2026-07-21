import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeading } from "@/components/ui/card";
import { addSequenceStep } from "../../actions";
import { StepForm } from "./step-form";
import { StepRow } from "./step-row";

export const metadata = { title: "Edit Sequence — Triviality CRM" };

export default async function EditSequencePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "manage_sequences");
  const { id } = await params;

  const [sequence, templates, enrollmentCount] = await Promise.all([
    prisma.followUpSequence.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepOrder: "asc" }, include: { emailTemplate: { select: { name: true } } } } },
    }),
    prisma.emailTemplate.findMany({ where: { visibility: "SHARED", active: true }, orderBy: { name: "asc" } }),
    prisma.sequenceEnrollment.count({ where: { sequenceId: id } }),
  ]);
  if (!sequence) notFound();

  const stepsLocked = enrollmentCount > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={`Edit Sequence: ${sequence.name}`} description="Every step is shown to whoever enrolls a lead before they confirm." />

      {stepsLocked && (
        <Card className="border-amber-200 bg-amber-50 text-amber-800">
          This sequence has {enrollmentCount} enrollment(s) — its steps are locked. Deactivate it and create a new sequence to change the
          recipe.
        </Card>
      )}

      <Card>
        <SectionHeading>Steps</SectionHeading>
        {sequence.steps.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">No steps yet — add one below.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {sequence.steps.map((step, index) => (
              <StepRow
                key={step.id}
                sequenceId={sequence.id}
                step={{
                  id: step.id,
                  stepOrder: step.stepOrder,
                  type: step.type,
                  waitDays: step.waitDays,
                  emailTemplateName: step.emailTemplate?.name ?? null,
                  taskTitle: step.taskTitle,
                }}
                isFirst={index === 0}
                isLast={index === sequence.steps.length - 1}
                locked={stepsLocked}
              />
            ))}
          </ol>
        )}
      </Card>

      {!stepsLocked && (
        <Card>
          <SectionHeading>Add a step</SectionHeading>
          <div className="mt-4">
            <StepForm action={addSequenceStep.bind(null, sequence.id)} templates={templates} />
          </div>
        </Card>
      )}
    </div>
  );
}
