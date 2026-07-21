import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeading } from "@/components/ui/card";
import { CreateSequenceForm } from "./create-sequence-form";
import { SequenceActiveToggle } from "./sequence-active-toggle";

export const metadata = { title: "Follow-up Sequences — Triviality CRM" };

export default async function SequencesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_sequences");

  const [sequences, pipelineStages] = await Promise.all([
    prisma.followUpSequence.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { steps: true, enrollments: true } }, createdBy: { select: { name: true } } },
    }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Follow-up Sequences"
        description="Multi-step, explicitly-enrolled follow-up campaigns (wait, email, task reminders). Every step is shown to whoever enrolls a lead before they confirm — nothing is automatic or hidden."
      />

      <Card>
        <SectionHeading>New sequence</SectionHeading>
        <div className="mt-4">
          <CreateSequenceForm pipelineStages={pipelineStages} />
        </div>
      </Card>

      <Card>
        <SectionHeading>Sequences</SectionHeading>
        {sequences.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">No sequences yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {sequences.map((sequence) => (
              <li key={sequence.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                <div>
                  <Link href={`/settings/sequences/${sequence.id}/edit`} className="font-semibold text-secondary hover:underline">
                    {sequence.name}
                  </Link>
                  <p className="text-xs text-text-muted">
                    {sequence._count.steps} step(s) · {sequence._count.enrollments} enrollment(s) · by {sequence.createdBy.name}
                  </p>
                </div>
                <SequenceActiveToggle sequenceId={sequence.id} active={sequence.active} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
