import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getScopedCompany, listCompanyActivities, listCompanyTasks, listCompanyEvidence, listCompanyScoreHistory } from "../queries";
import { CompanyActions } from "./company-actions";
import { QuickActionsBar } from "./quick-actions-bar";
import { ContactsPanel } from "./contacts/contacts-panel";
import { ActivityPanel } from "./activities/activity-panel";
import { TasksPanel } from "./tasks/tasks-panel";
import { ScorePanel } from "./eos/score-panel";
import { EvidencePanel } from "./eos/evidence-panel";
import { EmailPanel } from "./email/email-panel";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TRIVIA_STATUS_LABEL } from "@/lib/ui/status-tones";

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

  const [activities, tasks, salespeople, evidence, scoreHistory, pipelineStages, emailMessages, emailTemplates] = await Promise.all([
    listCompanyActivities(user, id),
    listCompanyTasks(user, id),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
    listCompanyEvidence(user, id),
    listCompanyScoreHistory(user, id),
    prisma.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.emailMessage.findMany({
      where: { companyId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, subject: true, toAddresses: true, status: true, sentAt: true, errorMessage: true, createdAt: true },
    }),
    prisma.emailTemplate.findMany({
      where: { active: true, OR: [{ visibility: "SHARED" }, { ownerId: user.id }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, subject: true, body: true },
    }),
  ]);
  const canEdit = hasPermission(user, "edit_leads");

  return (
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
      />

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

          <ScorePanel
            companyId={company.id}
            summary={company}
            history={scoreHistory}
            canEdit={canEdit}
          />

          <ContactsPanel companyId={company.id} contacts={company.contacts} canEdit={canEdit} />

          <div id="tasks-panel">
            <TasksPanel companyId={company.id} tasks={tasks} salespeople={salespeople} canManage={canEdit} />
          </div>

          <div id="activity-panel">
            <ActivityPanel companyId={company.id} activities={activities} canLog={canEdit} />
          </div>

          <EmailPanel
            companyId={company.id}
            messages={emailMessages.map((m) => ({
              id: m.id,
              subject: m.subject,
              toAddresses: m.toAddresses,
              status: m.status,
              sentAt: m.sentAt?.toISOString() ?? null,
              errorMessage: m.errorMessage,
              createdAt: m.createdAt.toISOString(),
            }))}
            templates={emailTemplates}
            contacts={company.contacts
              .filter((c) => c.email)
              .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, email: c.email as string }))}
            canSend={hasPermission(user, "send_email")}
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
  );
}
