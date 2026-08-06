import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { validateEmailAddress } from "@/lib/comms/validate";
import { prisma } from "@/lib/prisma";
import { getScopedCompany, listCompanyActivities, listCompanyTasks, listCompanyEvidence, listCompanyScoreHistory } from "../queries";
import { resolveSurvivingCompanyId } from "@/lib/data-quality/merge-company";
import { CompanyActions } from "./company-actions";
import { QuickActionsBar } from "./quick-actions-bar";
import { QuickActionProvider } from "./quick-action-context";
import { NextBestActionPanel } from "./next-best-action-panel";
import { computeNextBestActions } from "@/lib/workspace/next-best-action";
import { ContactsPanel } from "./contacts/contacts-panel";
import { ActivityPanel } from "./activities/activity-panel";
import { TasksPanel } from "./tasks/tasks-panel";
import { ScorePanel } from "./eos/score-panel";
import { EvidencePanel } from "./eos/evidence-panel";
import { EmailPanel } from "./email/email-panel";
import { SequenceEnrollmentPanel } from "./sequences/sequence-enrollment-panel";
import { AppointmentPanel } from "./appointments/appointment-panel";
import { getConnectionStatus } from "@/lib/comms/connections";
import { AddToRouteToggle } from "./route-plan-toggle";
import { getRouteCompanyIds } from "@/lib/route-plan/service";
import { previewSteps } from "@/lib/comms/sequences";
import { resolveCompanyPageDefault } from "@/lib/comms/recipient";
import { parseStoredLinks } from "@/lib/comms/links";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TRIVIA_STATUS_LABEL, WEEKDAY_LABEL } from "@/lib/ui/status-tones";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-text">{value || <span className="text-text-muted">—</span>}</p>
    </div>
  );
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const company = await getScopedCompany(user, id);
  if (!company) notFound();

  // Module Seven: a MERGED company was absorbed into another via a safe
  // merge (src/lib/data-quality/merge-company.ts) — old links to it
  // resolve to its current survivor rather than 404ing. Resolves a
  // possibly-chained mergedIntoId to its final target. `redirect()` never
  // returns (typed `never`), so TypeScript narrows company.status to
  // "ACTIVE" | "ARCHIVED" for the rest of this function.
  if (company.status === "MERGED") {
    const survivingId = await resolveSurvivingCompanyId(company.id);
    redirect(`/companies/${survivingId}`);
  }

  const [
    activities,
    tasks,
    salespeople,
    evidence,
    scoreHistory,
    pipelineStages,
    emailMessages,
    emailTemplates,
    activeSequences,
    enrollments,
    appointments,
    workspaceSettings,
    pendingDuplicateCount,
    routeCompanyIds,
    connection,
  ] = await Promise.all([
      listCompanyActivities(user, id),
      listCompanyTasks(user, id),
      prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
      listCompanyEvidence(user, id),
      listCompanyScoreHistory(user, id),
      prisma.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.emailMessage.findMany({
        where: { companyId: id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          subject: true,
          toAddresses: true,
          ccAddresses: true,
          bccAddresses: true,
          links: true,
          status: true,
          sentAt: true,
          scheduledFor: true,
          errorMessage: true,
          suggestedPipelineStageId: true,
          suggestedPipelineStage: { select: { name: true } },
          pipelineStageAppliedAt: true,
          createdAt: true,
        },
      }),
      prisma.emailTemplate.findMany({
        where: { active: true, OR: [{ visibility: "SHARED" }, { ownerId: user.id }] },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          subject: true,
          body: true,
          links: { orderBy: { sortOrder: "asc" }, select: { label: true, url: true } },
        },
      }),
      prisma.followUpSequence.findMany({
        where: { active: true },
        include: { steps: { orderBy: { stepOrder: "asc" }, include: { emailTemplate: { select: { name: true } } } } },
      }),
      prisma.sequenceEnrollment.findMany({
        where: { companyId: id },
        orderBy: { enrolledAt: "desc" },
        include: {
          sequence: { select: { name: true, steps: { select: { id: true } } } },
          // Per-enrollment "take 1" — Prisma applies a nested take/orderBy
          // per parent row, not globally, so this is each enrollment's own
          // most recent failed step, not the single most recent across all.
          stepRuns: { where: { status: "FAILED" }, orderBy: { runAt: "desc" }, take: 1 },
        },
      }),
      prisma.appointment.findMany({
        where: { companyId: id },
        orderBy: { startAt: "asc" },
      }),
      prisma.workspaceSettings.findUnique({ where: { id: 1 } }),
      prisma.potentialDuplicate.count({
        where: { status: "PENDING", OR: [{ companyAId: id }, { companyBId: id }] },
      }),
      hasPermission(user, "manage_route_plan") ? getRouteCompanyIds(user.id) : Promise.resolve(new Set<string>()),
      getConnectionStatus(user.id),
    ]);
  const calendarAvailable = connection?.provider !== "titan";
  const canEdit = hasPermission(user, "edit_leads");
  const canRoutePlan = hasPermission(user, "manage_route_plan");
  // Mirrors the permission checks inside runOpportunityAnalysis() itself
  // (src/lib/companies/analyze-opportunity.ts) — shown here only when all
  // three would actually succeed, not just canEdit, so the button never
  // promises an action the server will then reject.
  const canAnalyzeOpportunity =
    hasPermission(user, "run_research") && hasPermission(user, "bulk_update_leads") && canEdit;
  const canSendCompanyEmail = hasPermission(user, "send_email");
  // The Quick Sales Actions "Send email" button — see quick-actions-bar.tsx
  // and email/actions.ts#sendCompanyEmail — is only ever rendered when this
  // is set, but that's a UI nicety only; sendCompanyEmail() re-validates
  // this itself server-side rather than trusting it.
  const validCompanyEmail = company.email && validateEmailAddress(company.email).valid ? company.email : null;

  const nextBestActions = computeNextBestActions({
    now: new Date(),
    noActivityThresholdDays: workspaceSettings?.noActivityThresholdDays ?? 14,
    contactCount: company.contacts.length,
    pipelineOutcomeType: company.pipelineStage.outcomeType,
    referenceActivityAt: activities[0]?.occurredAt ?? company.createdAt,
    lastTrialActivityAt: activities.find((a) => a.type === "TRIAL")?.occurredAt ?? null,
    openTasks: tasks.filter((t) => t.status === "OPEN").map((t) => ({ dueAt: t.dueAt })),
    hasPendingDuplicate: pendingDuplicateCount > 0,
  });

  return (
    <QuickActionProvider>
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          {company.status === "ARCHIVED" && (
            <Badge tone="neutral" className="mb-2">
              Archived
            </Badge>
          )}
          <h1 className="text-3xl font-black tracking-tight text-accent">{company.name}</h1>
          <p className="mt-1 text-text-muted">
            {company.city}, {company.region}, {company.country}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && company.status === "ACTIVE" && (
            <Link
              href={`/companies/${company.id}/edit`}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover"
            >
              <Pencil size={15} />
              Edit
            </Link>
          )}
          <CompanyActions
            companyId={company.id}
            status={company.status}
            canDelete={hasPermission(user, "delete_leads")}
            canRestore={hasPermission(user, "restore_archived_leads")}
            isAdmin={user.role.name === "Administrator"}
          />
        </div>
      </div>

      <QuickActionsBar
        companyId={company.id}
        currentStageId={company.pipelineStageId}
        stages={pipelineStages.map((s) => ({ id: s.id, name: s.name, active: s.active }))}
        canEdit={canEdit}
        canAnalyze={canAnalyzeOpportunity}
        websiteUrl={company.websiteUrl}
        canSendEmail={canSendCompanyEmail}
        companyEmail={validCompanyEmail}
      />

      {canRoutePlan && <AddToRouteToggle companyId={company.id} initiallyInRoute={routeCompanyIds.has(company.id)} canManage={canRoutePlan} />}

      <NextBestActionPanel items={nextBestActions} canEdit={canEdit} />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <h2 className="font-bold text-accent">Company details</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Street address" value={company.address1} />
              <Field label="City" value={company.city} />
              <Field label="State / Province" value={company.region} />
              <Field label="ZIP / Postal code" value={company.postalCode} />
              <Field label="Country" value={company.country} />
              <Field label="Phone" value={company.phone} />
              <Field label="Email" value={company.email} />
              <Field
                label="Website"
                value={
                  company.websiteUrl ? (
                    <a href={company.websiteUrl} target="_blank" rel="noreferrer noopener" className="text-secondary hover:underline">
                      {company.websiteUrl}
                    </a>
                  ) : null
                }
              />
              <Field label="Lead Type" value={company.leadType.name} />
              <Field label="Pipeline Stage" value={company.pipelineStage.name} />
              <Field label="Assigned salesperson" value={company.assignedTo?.name} />
              <Field label="Competitor" value={company.competitor?.name} />
              <Field label="Trivia status" value={TRIVIA_STATUS_LABEL[company.triviaStatus]} />
              <Field label="Existing trivia provider" value={company.competitorTriviaProvider} />
              <Field label="Trivia night" value={company.competitorTriviaDay ? WEEKDAY_LABEL[company.competitorTriviaDay] : null} />
              <Field
                label="Next follow-up"
                value={company.nextFollowUpAt ? new Date(company.nextFollowUpAt).toLocaleDateString() : null}
              />
            </div>
            {company.notes && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-text">{company.notes}</p>
              </div>
            )}
          </Card>

          <div id="eos-panel">
            <ScorePanel
              companyId={company.id}
              companyName={company.name}
              summary={company}
              history={scoreHistory}
              canEdit={canEdit}
              canAnalyze={canAnalyzeOpportunity}
            />
          </div>

          <div id="contacts-panel">
            <ContactsPanel
              companyId={company.id}
              contacts={company.contacts}
              primaryContactId={company.primaryContactId}
              canEdit={canEdit}
              canManageCompliance={hasPermission(user, "manage_communication_compliance")}
              canSendEmail={hasPermission(user, "send_email")}
            />
          </div>

          <div id="tasks-panel">
            <TasksPanel companyId={company.id} tasks={tasks} salespeople={salespeople} canManage={canEdit} />
          </div>

          <div id="activity-panel">
            <ActivityPanel companyId={company.id} activities={activities} canLog={canEdit} />
          </div>

          <div id="email-panel">
            <EmailPanel
              companyId={company.id}
              messages={emailMessages.map((m) => ({
                id: m.id,
                subject: m.subject,
                toAddresses: m.toAddresses,
                ccAddresses: m.ccAddresses,
                bccAddresses: m.bccAddresses,
                links: parseStoredLinks(m.links),
                status: m.status,
                sentAt: m.sentAt?.toISOString() ?? null,
                scheduledFor: m.scheduledFor?.toISOString() ?? null,
                errorMessage: m.errorMessage,
                createdAt: m.createdAt.toISOString(),
                suggestedPipelineStageId: m.suggestedPipelineStageId,
                suggestedPipelineStageName: m.suggestedPipelineStage?.name ?? null,
                pipelineStageAppliedAt: m.pipelineStageAppliedAt?.toISOString() ?? null,
              }))}
              templates={emailTemplates}
              contacts={company.contacts
                .filter((c) => c.email)
                .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, email: c.email as string }))}
              defaultContactId={resolveCompanyPageDefault(
                company.contacts.find((c) => c.id === company.primaryContactId) ?? null,
              )}
              canSend={hasPermission(user, "send_email")}
              canSchedule={hasPermission(user, "schedule_email")}
              canEdit={canEdit}
            />
          </div>

          <SequenceEnrollmentPanel
            companyId={company.id}
            sequences={activeSequences.map((sequence) => ({
              id: sequence.id,
              name: sequence.name,
              hasEmailStep: sequence.steps.some((s) => s.type === "EMAIL"),
              preview: previewSteps(
                sequence.steps,
                Object.fromEntries(sequence.steps.filter((s) => s.emailTemplate).map((s) => [s.id, s.emailTemplate!.name])),
              ).map((entry) => `Day ${entry.cumulativeDays}: ${entry.label}`),
            }))}
            contacts={company.contacts.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` }))}
            enrollments={enrollments.map((enrollment) => ({
              id: enrollment.id,
              sequenceName: enrollment.sequence.name,
              status: enrollment.status,
              currentStepOrder: enrollment.currentStepOrder,
              totalSteps: enrollment.sequence.steps.length,
              nextStepDueAt: enrollment.nextStepDueAt?.toISOString() ?? null,
              stopReason: enrollment.stopReason,
              lastFailedStepError: enrollment.stepRuns[0]?.errorMessage ?? null,
            }))}
            canEnroll={hasPermission(user, "enroll_in_sequences")}
          />

          <AppointmentPanel
            companyId={company.id}
            appointments={appointments.map((appointment) => ({
              id: appointment.id,
              type: appointment.type,
              title: appointment.title,
              startAt: appointment.startAt.toISOString(),
              endAt: appointment.endAt.toISOString(),
              timezone: appointment.timezone,
              status: appointment.status,
              lastError: appointment.lastError,
            }))}
            contacts={company.contacts
              .filter((c) => c.email)
              .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, email: c.email as string }))}
            canManage={hasPermission(user, "manage_calendar_connections")}
            calendarAvailable={calendarAvailable}
          />
        </div>

        <div className="space-y-6">
          <EvidencePanel companyId={company.id} evidence={evidence} canEdit={canEdit} />

          <Card>
            <h2 className="font-bold text-accent">Record history</h2>
            <div className="mt-4 space-y-4">
              <Field label="Created" value={`${company.createdAt.toLocaleDateString()} by ${company.createdBy.name}`} />
              <Field
                label="Last updated"
                value={
                  company.updatedBy
                    ? `${company.updatedAt.toLocaleDateString()} by ${company.updatedBy.name}`
                    : company.updatedAt.toLocaleDateString()
                }
              />
              {company.status === "ARCHIVED" && company.archivedAt && (
                <Field
                  label="Archived"
                  value={`${company.archivedAt.toLocaleDateString()}${company.archivedBy ? ` by ${company.archivedBy.name}` : ""}`}
                />
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
    </QuickActionProvider>
  );
}
