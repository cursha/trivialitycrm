"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, Mail, Users, FileText, Presentation, FlaskConical, StickyNote, CalendarClock, Sparkles, Globe, Send, MapPin, Search, AtSign } from "lucide-react";
import { changeCompanyStage } from "../actions";
import { findCompanyEmail, searchWebForCompanyEmail, type FindCompanyEmailResult } from "./find-email-actions";
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
  canLogVisit,
  canAnalyze,
  websiteHref,
  findWebsiteHref,
  canSendEmail,
  companyEmail,
  hasEmail,
}: {
  companyId: string;
  currentStageId: string;
  stages: StageOption[];
  canEdit: boolean;
  /** Edit permission on an ACTIVE company — the visit form isn't offered on
   * an archived one. */
  canLogVisit: boolean;
  canAnalyze: boolean;
  /** Safe-to-open link (see websiteHref), or null when none is on file. */
  websiteHref: string | null;
  /** A web search for the bar, offered when there's no website. */
  findWebsiteHref: string;
  canSendEmail: boolean;
  /** Already validated server-side (see page.tsx) — null when the company
   * has no email on file, or it doesn't pass validateEmailAddress(). The
   * "Send email" button is only ever rendered when this is set. */
  companyEmail: string | null;
  /** Any email on file, valid or not — "Find email" is only offered without one. */
  hasEmail: boolean;
}) {
  const router = useRouter();
  const { requestActivity, requestFollowUp, requestAnalyze } = useQuickActions();
  const [stageId, setStageId] = useState(currentStageId);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [showSendEmail, setShowSendEmail] = useState(false);

  // "Find email": the bar's website first (free), then, if that shows
  // none, an AI web search (about 10¢) after the user confirms.
  const [emailPending, startEmailTransition] = useTransition();
  const [emailMessage, setEmailMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [offerWebSearch, setOfferWebSearch] = useState(false);

  function runEmailLookup(lookup: (companyId: string) => Promise<FindCompanyEmailResult>) {
    setEmailMessage(null);
    setOfferWebSearch(false);
    startEmailTransition(async () => {
      const outcome = await lookup(companyId);
      if ("error" in outcome) {
        setEmailMessage({ tone: "error", text: outcome.error });
      } else if (outcome.email !== null) {
        setEmailMessage({ tone: "info", text: `Found ${outcome.email} and saved it to this company.` });
        router.refresh();
      } else {
        setEmailMessage({ tone: "error", text: `${outcome.note}.` });
        setOfferWebSearch(outcome.canSearchWeb);
      }
    });
  }

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
        {canLogVisit && (
          <button
            type="button"
            onClick={() => requestActivity("VISIT")}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover"
          >
            <MapPin size={15} />
            Log visit
          </button>
        )}
        {websiteHref ? (
          <a
            href={websiteHref}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
          >
            <Globe size={14} />
            Visit website
          </a>
        ) : (
          <a
            href={findWebsiteHref}
            target="_blank"
            rel="noreferrer noopener"
            title="No website on file: search the web for this bar"
            className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold text-text hover:bg-black/5"
          >
            <Search size={14} />
            Find website
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
        {canEdit && !hasEmail && (
          <button
            type="button"
            disabled={emailPending}
            onClick={() => runEmailLookup(findCompanyEmail)}
            title="Look for a public email on the bar's website"
            className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold text-text hover:bg-black/5 disabled:opacity-60"
          >
            <AtSign size={14} />
            {emailPending ? "Finding email..." : "Find email"}
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
      {emailMessage && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={emailMessage.tone === "error" ? "font-semibold text-danger" : "text-text-muted"}>{emailMessage.text}</span>
          {offerWebSearch && !emailPending && (
            <>
              <span className="text-text-muted">Search the web for it? An AI web search costs about 10¢.</span>
              <button
                type="button"
                onClick={() => runEmailLookup(searchWebForCompanyEmail)}
                className="rounded-lg border border-border-strong px-2 py-1 font-semibold text-text hover:bg-black/5"
              >
                Search the web
              </button>
            </>
          )}
        </div>
      )}
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
