"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, FieldError } from "@/components/ui/field";
import { generateCampaignPreview, approveCampaign, sendCampaignNow, scheduleCampaign, cancelCampaign, retryFailedRecipients } from "../actions";

type CampaignActionResult = { error: string } | { success: true; id: string };

export function CampaignActions({
  campaignId,
  status,
  canSend,
  isMySender,
  hasFailedRecipients,
}: {
  campaignId: string;
  status: string;
  canSend: boolean;
  isMySender: boolean;
  hasFailedRecipients: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<CampaignActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const canOperate = canSend && (status === "DRAFT" ? true : isMySender);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && (
          <>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => run(() => generateCampaignPreview(campaignId))}>
              {isPending ? "Working..." : "Generate preview"}
            </Button>
            {canSend && (
              <Button type="button" disabled={isPending} onClick={() => run(() => approveCampaign(campaignId))}>
                Approve
              </Button>
            )}
          </>
        )}

        {status === "APPROVED" && canOperate && (
          <>
            <Button type="button" disabled={isPending} onClick={() => run(() => sendCampaignNow(campaignId))}>
              Send now
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setShowSchedule((v) => !v)}>
              Schedule...
            </Button>
            <Button type="button" variant="destructive" disabled={isPending} onClick={() => run(() => cancelCampaign(campaignId))}>
              Cancel
            </Button>
          </>
        )}

        {(status === "SCHEDULED" || status === "QUEUED" || status === "SENDING") && canOperate && (
          <Button type="button" variant="destructive" disabled={isPending} onClick={() => run(() => cancelCampaign(campaignId))}>
            Cancel
          </Button>
        )}

        {(status === "COMPLETED_WITH_WARNINGS" || status === "FAILED") && hasFailedRecipients && canOperate && (
          <Button type="button" disabled={isPending} onClick={() => run(() => retryFailedRecipients(campaignId))}>
            Retry failed recipients
          </Button>
        )}
      </div>

      {showSchedule && status === "APPROVED" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} className="w-auto" />
          <Button
            type="button"
            disabled={isPending || !scheduledFor}
            onClick={() => run(() => scheduleCampaign(campaignId, new Date(scheduledFor).toISOString()))}
          >
            Confirm schedule
          </Button>
        </div>
      )}

      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
