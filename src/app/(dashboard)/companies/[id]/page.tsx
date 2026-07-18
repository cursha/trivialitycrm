import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getScopedCompany, listCompanyActivities, listCompanyTasks, listCompanyEvidence, listCompanyScoreHistory } from "../queries";
import { CompanyActions } from "./company-actions";
import { ContactsPanel } from "./contacts/contacts-panel";
import { ActivityPanel } from "./activities/activity-panel";
import { TasksPanel } from "./tasks/tasks-panel";
import { ScorePanel } from "./eos/score-panel";
import { EvidencePanel } from "./eos/evidence-panel";

const TRIVIA_LABELS: Record<string, string> = {
  CURRENT_TRIVIA: "Current Trivia",
  NO_CURRENT_TRIVIA: "No Current Trivia",
  UNCERTAIN: "Uncertain",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-900">{value || <span className="text-slate-400">—</span>}</p>
    </div>
  );
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const company = await getScopedCompany(user, id);
  if (!company) notFound();

  const [activities, tasks, salespeople, evidence, scoreHistory] = await Promise.all([
    listCompanyActivities(user, id),
    listCompanyTasks(user, id),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
    listCompanyEvidence(user, id),
    listCompanyScoreHistory(user, id),
  ]);
  const canEdit = hasPermission(user, "edit_leads");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          {company.status === "ARCHIVED" && (
            <span className="mb-2 inline-block rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">
              Archived
            </span>
          )}
          <h1 className="text-3xl font-black tracking-tight">{company.name}</h1>
          <p className="mt-1 text-slate-500">
            {company.city}, {company.region}, {company.country}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && company.status === "ACTIVE" && (
            <Link
              href={`/companies/${company.id}/edit`}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white"
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

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-bold">Company details</h2>
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
                    <a href={company.websiteUrl} target="_blank" rel="noreferrer noopener" className="text-blue-600 hover:underline">
                      {company.websiteUrl}
                    </a>
                  ) : null
                }
              />
              <Field label="Lead Type" value={company.leadType.name} />
              <Field label="Pipeline Stage" value={company.pipelineStage.name} />
              <Field label="Assigned salesperson" value={company.assignedTo.name} />
              <Field label="Competitor" value={company.competitor?.name} />
              <Field label="Trivia status" value={TRIVIA_LABELS[company.triviaStatus]} />
              <Field
                label="Next follow-up"
                value={company.nextFollowUpAt ? new Date(company.nextFollowUpAt).toLocaleDateString() : null}
              />
            </div>
            {company.notes && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{company.notes}</p>
              </div>
            )}
          </div>

          <ScorePanel
            companyId={company.id}
            summary={company}
            history={scoreHistory}
            canEdit={canEdit}
          />

          <ContactsPanel companyId={company.id} contacts={company.contacts} canEdit={canEdit} />

          <TasksPanel companyId={company.id} tasks={tasks} salespeople={salespeople} canManage={canEdit} />

          <ActivityPanel companyId={company.id} activities={activities} canLog={canEdit} />
        </div>

        <div className="space-y-6">
          <EvidencePanel companyId={company.id} evidence={evidence} canEdit={canEdit} />

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-bold">Record history</h2>
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
          </div>
        </div>
      </div>
    </div>
  );
}
