"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, Mail, Users, FileText, Presentation, FlaskConical, StickyNote, CalendarClock, Sparkles, Globe, Send } from "lucide-react";
import { changeCompanyStage } from "../actions";
import { useQuickActions } from "./quick-action-context";
import { SendCompanyEmailModal } from "./send-company-email-modal";
import { Card } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/field";

export type StageOption = { id: string; name: string; active: boolean };

const ACTIVITY_LINKS = [
  { type: "NOTE", label: "Add note", icon: StickyNote },
  { type: "PHONE", label: "Log call", icon: Phone },
  { type: "EMAIL", label: "Log email", icon: Mail },
  { type: "MEETING", label: "Log meeting", icon: Users },
  { type: "MATERIAL_SENT", label: "Material sent", icon: FileText },
  { type: "DEMO", label: "Log demo", icon: Presentation },
  { type: "TRIAL", label: "Log trial", icon: FlaskConical },
];

export function QuickActionsBar({
  companyId,
  currentStageId,
  stages,
  canEdit,
  canAnalyze,
  websiteUrl,
  canSendEmail,
  companyEmail,
}: {
  companyId: string;
  currentStageId: string;
  stages: StageOption[];
  canEdit: boolean;
  canAnalyze: boolean;
  websiteUrl: string | null;
  canSendEmail: boolean;
  /** Already validated server-side (see page.tsx) — null when the company
   * has no email on file, or it doesn't pass validateEmailAddress(). The
   * "Send email" button is only ever rendered when this is set. */
  companyEmail: string | null;
}) {
  const router = useRouter();
  const { requestActivity, requestFollowUp, requestAnalyze } = useQuickActions();
  const [stageId, setStageId] = useState(currentStageId);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [showSendEmail, setShowSendEmail] = useState(false);

  function handleStageChange(newStageId: string) {
    const previous = stageId;
    setStageId(newStageId);
    setError(undefined);
    startTransition(async () => {
      const result = await changeCompanyStage(companyId, newStageId);
      if ("error" in result) {
        setStageId(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <h2 className="font-bold text-accent">Quick sales actions</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {websiteUrl && (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
          >
            <Globe size={14} />
            View website
          </a>
        )}
        {canSendEmail && companyEmail && (
          <button
            type="button"
            onClick={() => setShowSendEmail(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
          >
            <Send size={14} />
            Send email
          </button>
        )}
        {canEdit &&
          ACTIVITY_LINKS.map((link) => (
            <button
              key={link.label}
              type="button"
              onClick={() => requestActivity(link.type)}
              className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold text-text hover:bg-black/5"
            >
              <link.icon size={14} />
              {link.label}
            </button>
          ))}
        {canEdit && (
          <button
            type="button"
            onClick={requestFollowUp}
            className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold text-text hover:bg-black/5"
          >
            <CalendarClock size={14} />
            Follow-up
          </button>
        )}
        {canEdit && canAnalyze && (
          <button
            type="button"
            onClick={requestAnalyze}
            className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold text-text hover:bg-black/5"
          >
            <Sparkles size={14} />
            Analyze opportunity
          </button>
        )}
      </div>
      {!canEdit && <p className="mt-3 text-sm text-text-muted">You don&apos;t have permission to log activity for this company.</p>}
      {canEdit && (
        <div className="mt-3 max-w-xs">
          <Label className="text-xs">Change pipeline stage</Label>
          <Select value={stageId} disabled={isPending} onChange={(e) => handleStageChange(e.target.value)} className="mt-1">
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id} disabled={!stage.active && stage.id !== stageId}>
                {stage.name}
              </option>
            ))}
          </Select>
          {error && <p className="mt-1 text-xs font-semibold text-danger">{error}</p>}
        </div>
      )}
      {showSendEmail && companyEmail && (
        <SendCompanyEmailModal companyId={companyId} companyEmail={companyEmail} onClose={() => setShowSendEmail(false)} />
      )}
    </Card>
  );
}
