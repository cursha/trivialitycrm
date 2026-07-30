import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { getCampaignById } from "@/lib/campaigns/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CAMPAIGN_STATUS_TONE, humanizeEnum } from "@/lib/ui/status-tones";
import { CampaignActions } from "./campaign-actions";

export const metadata = { title: "Campaign — Triviality CRM" };

const RECIPIENT_STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "focus"> = {
  PENDING: "neutral",
  ACTIVE: "focus",
  COMPLETED: "success",
  SKIPPED: "warning",
  STOPPED_OPT_OUT: "warning",
  STOPPED_STAGE: "warning",
  STOPPED_REPLY: "warning",
  CANCELLED: "neutral",
};

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const campaign = await getCampaignById(user, id);
  if (!campaign) notFound();

  const canSend = hasPermission(user, "send_campaigns");
  const isMySender = campaign.senderId === user.id;

  const counts = campaign.recipients.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const allStepRuns = campaign.recipients.flatMap((r) => r.stepRuns);
  const sentCount = allStepRuns.filter((r) => r.status === "SENT").length;
  const failedCount = allStepRuns.filter((r) => r.status === "FAILED").length;
  const stoppedCount = (counts.STOPPED_OPT_OUT ?? 0) + (counts.STOPPED_STAGE ?? 0) + (counts.STOPPED_REPLY ?? 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={campaign.name}
        description={`From "${campaign.list.name}" — created by ${campaign.createdBy.name}.`}
      />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status] ?? "neutral"}>{humanizeEnum(campaign.status)}</Badge>
          {campaign.sender && <Badge tone="neutral">Sender: {campaign.sender.name}</Badge>}
          {campaign.scheduledFor && <Badge tone="focus">Scheduled for {new Date(campaign.scheduledFor).toLocaleString()}</Badge>}
          {campaign.steps.length > 1 && <Badge tone="secondary">{campaign.steps.length}-step sequence</Badge>}
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Stat label="Total recipients" value={campaign.recipients.length} />
          <Stat label="Active" value={counts.ACTIVE ?? 0} />
          <Stat label="Completed" value={counts.COMPLETED ?? 0} />
          <Stat label="Skipped" value={counts.SKIPPED ?? 0} />
          <Stat label="Stopped" value={stoppedCount} />
          <Stat label="Cancelled" value={counts.CANCELLED ?? 0} />
          <Stat label="Messages sent" value={sentCount} />
          <Stat label="Messages failed" value={failedCount} />
        </dl>

        <CampaignActions
          campaignId={campaign.id}
          status={campaign.status}
          canSend={canSend}
          isMySender={isMySender}
          hasFailedRecipients={failedCount > 0}
        />
      </Card>

      {campaign.steps.length > 1 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-bold uppercase text-text-muted">Steps</h2>
          <ol className="space-y-1 text-sm">
            {campaign.steps.map((step) => (
              <li key={step.id} className="flex items-baseline gap-2">
                <span className="font-semibold text-text">Step {step.stepOrder}</span>
                <span className="text-text-muted">
                  {step.stepOrder === 1 ? "sends immediately" : `sends ${step.waitDays} day(s) after the previous step`}
                  {step.instructions ? ` — ${step.instructions}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="text-sm font-bold uppercase text-text-muted">Recipients</h2>
        {campaign.recipients.length === 0 ? (
          <EmptyState>No recipients.</EmptyState>
        ) : (
          <div className="divide-y divide-border">
            {campaign.recipients.map((recipient) => (
              <div key={recipient.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-text">{recipient.company.name}</span>
                    {recipient.contact && (
                      <span className="ml-2 text-sm text-text-muted">
                        {recipient.contact.firstName} {recipient.contact.lastName}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {recipient.status === "ACTIVE" && recipient.currentStep && (
                      <span className="text-xs text-text-muted">
                        On step {recipient.currentStep.stepOrder}
                        {recipient.nextStepDueAt ? ` — due ${new Date(recipient.nextStepDueAt).toLocaleString()}` : ""}
                      </span>
                    )}
                    <Badge tone={RECIPIENT_STATUS_TONE[recipient.status] ?? "neutral"}>{humanizeEnum(recipient.status)}</Badge>
                  </div>
                </div>
                {recipient.skipReason && <p className="mt-1 text-xs text-text-muted">Skipped: {recipient.skipReason}</p>}
                {recipient.stopReason && <p className="mt-1 text-xs text-text-muted">Stopped: {recipient.stopReason}</p>}

                {recipient.stepRuns.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {recipient.stepRuns.map((run) => {
                      const step = campaign.steps.find((s) => s.id === run.stepId);
                      return (
                        <li key={run.id} className={run.status === "FAILED" ? "text-danger" : "text-text-muted"}>
                          Step {step?.stepOrder ?? "?"}: {run.status === "SENT" ? "Sent" : `Failed — ${run.errorMessage}`} ({new Date(run.runAt).toLocaleString()})
                        </li>
                      );
                    })}
                  </ul>
                )}

                {recipient.snapshots.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-secondary">View message{recipient.snapshots.length > 1 ? "s" : ""}</summary>
                    <div className="mt-2 space-y-2">
                      {recipient.snapshots.map((snapshot) => {
                        const step = campaign.steps.find((s) => s.id === snapshot.stepId);
                        return (
                          <div key={snapshot.id} className="rounded-lg border border-border bg-black/[0.02] p-3">
                            {campaign.steps.length > 1 && <p className="text-xs font-bold text-text-muted">Step {step?.stepOrder ?? "?"}</p>}
                            <p className="text-sm font-semibold text-text">{snapshot.subject}</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{snapshot.body}</p>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {campaign.events.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-bold uppercase text-text-muted">Timeline</h2>
          <ul className="space-y-1.5 text-sm">
            {campaign.events.map((event) => (
              <li key={event.id} className="flex items-baseline justify-between gap-2 text-text-muted">
                <span>
                  {humanizeEnum(event.type)}
                  {event.recipient && <span className="text-text"> — {event.recipient.company.name}</span>}
                </span>
                <span className="whitespace-nowrap text-xs">{new Date(event.occurredAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Link href="/campaigns" className="text-sm text-secondary hover:underline">
        ← Back to Campaigns
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-medium text-text">{value}</dd>
    </div>
  );
}
