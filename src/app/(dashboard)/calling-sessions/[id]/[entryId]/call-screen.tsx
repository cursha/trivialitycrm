"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea, FieldError } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { CONFIDENCE_LABEL, CONFIDENCE_TONE, TRIVIA_STATUS_LABEL } from "@/lib/ui/status-tones";
import { describeDefaultAction, type CallOutcomeLike } from "@/lib/calling/outcome-preview";
import { recordCallOutcome, skipEntryTemporarily, skipEntryPermanently, pauseCallingSession, endCallingSession, goToNextEntryOrSummary } from "../../actions";

type Contact = { id: string; firstName: string; lastName: string; title: string | null; phone: string | null; email: string | null };
type Activity = { id: string; type: string; occurredAt: Date; notes: string | null; outcome: string | null };
type Task = { id: string; title: string; dueAt: Date };

type CompanyDetail = {
  id: string;
  name: string;
  address1: string | null;
  city: string;
  region: string;
  websiteUrl: string | null;
  phone: string | null;
  eosScore: number | null;
  confidenceLevel: string | null;
  recommendedNextAction: string | null;
  leadType: { name: string };
  pipelineStage: { name: string };
  competitor: { name: string } | null;
  triviaStatus: string;
  primaryContact: Contact | null;
  contacts: Contact[];
  activities: Activity[];
  tasks: Task[];
};

type Outcome = CallOutcomeLike & { id: string };
type RejectionReason = { id: string; name: string };

export function CallScreen({
  sessionId,
  entryId,
  entryPosition,
  company,
  outcomes,
  rejectionReasons,
  progress,
}: {
  sessionId: string;
  entryId: string;
  entryPosition: number;
  company: CompanyDetail;
  outcomes: Outcome[];
  rejectionReasons: RejectionReason[];
  progress: { total: number; completed: number; remaining: number; skipped: number };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [outcomeId, setOutcomeId] = useState("");
  const [notes, setNotes] = useState("");
  const [rejectionReasonId, setRejectionReasonId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectedOutcome = outcomes.find((o) => o.id === outcomeId) ?? null;
  const preview = selectedOutcome ? describeDefaultAction(selectedOutcome) : [];

  function save() {
    setError(null);
    if (!outcomeId) {
      setError("Choose a call outcome.");
      return;
    }
    startTransition(async () => {
      const result = await recordCallOutcome(sessionId, entryId, { outcomeId, notes, rejectionReasonId: rejectionReasonId || undefined });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.opensEmailComposer) {
        router.push(`/companies/${result.companyId}#email`);
        return;
      }
      await goToNextEntryOrSummary(sessionId);
    });
  }

  function skipTemporarily() {
    startTransition(async () => {
      await skipEntryTemporarily(sessionId, entryPosition);
      await goToNextEntryOrSummary(sessionId);
    });
  }

  function skipPermanently() {
    if (!window.confirm("Skip this company for the rest of the session? It will not be offered again.")) return;
    startTransition(async () => {
      await skipEntryPermanently(sessionId, entryId);
      await goToNextEntryOrSummary(sessionId);
    });
  }

  function pause() {
    startTransition(async () => {
      await pauseCallingSession(sessionId);
      router.push(`/calling-sessions/${sessionId}`);
    });
  }

  function end() {
    if (!window.confirm("End this calling session? You can review what was completed afterward.")) return;
    startTransition(async () => {
      await endCallingSession(sessionId);
      router.push(`/calling-sessions/${sessionId}`);
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">
          {progress.completed + progress.skipped + 1} of {progress.total} — {progress.remaining} remaining
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={pause} disabled={isPending}>
            Pause
          </Button>
          <Button type="button" variant="ghost" onClick={end} disabled={isPending}>
            End session
          </Button>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-text">{company.name}</h1>
            <p className="text-sm text-text-muted">
              {company.address1 ? `${company.address1}, ` : ""}
              {company.city}, {company.region}
            </p>
            {company.websiteUrl && (
              <a href={company.websiteUrl} target="_blank" rel="noreferrer" className="text-sm text-secondary hover:underline">
                {company.websiteUrl}
              </a>
            )}
          </div>
          {company.phone && (
            <a
              href={`tel:${company.phone}`}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-hover"
            >
              <Phone size={16} />
              {company.phone}
            </a>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone="secondary">{company.leadType.name}</Badge>
          <Badge tone="secondary">{company.pipelineStage.name}</Badge>
          {company.confidenceLevel && <Badge tone={CONFIDENCE_TONE[company.confidenceLevel]}>{CONFIDENCE_LABEL[company.confidenceLevel]}</Badge>}
          <Badge tone="neutral">{TRIVIA_STATUS_LABEL[company.triviaStatus]}</Badge>
          {company.competitor && <Badge tone="warning">Competitor: {company.competitor.name}</Badge>}
          {company.eosScore !== null && <Badge tone="focus">EOS {company.eosScore}</Badge>}
        </div>

        {company.recommendedNextAction && (
          <p className="rounded-lg bg-focus/10 p-3 text-sm text-text">
            <span className="font-semibold">Recommended: </span>
            {company.recommendedNextAction}
          </p>
        )}
      </Card>

      {company.primaryContact && (
        <Card className="space-y-1">
          <p className="text-xs font-bold uppercase text-text-muted">Primary Contact</p>
          <p className="font-semibold text-text">
            {company.primaryContact.firstName} {company.primaryContact.lastName}
            {company.primaryContact.title ? ` — ${company.primaryContact.title}` : ""}
          </p>
          <div className="flex flex-wrap gap-4 text-sm text-text-muted">
            {company.primaryContact.phone && (
              <a href={`tel:${company.primaryContact.phone}`} className="text-secondary hover:underline">
                {company.primaryContact.phone}
              </a>
            )}
            {company.primaryContact.email && <span>{company.primaryContact.email}</span>}
          </div>
        </Card>
      )}

      {(company.activities.length > 0 || company.tasks.length > 0) && (
        <Card className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase text-text-muted">Recent Activities</p>
            <ul className="mt-1 space-y-1 text-sm text-text">
              {company.activities.map((a) => (
                <li key={a.id}>
                  <span className="text-text-muted">{new Date(a.occurredAt).toLocaleDateString()}</span> — {a.outcome ?? a.type}
                </li>
              ))}
              {company.activities.length === 0 && <li className="text-text-muted">None yet.</li>}
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-text-muted">Open Follow-ups</p>
            <ul className="mt-1 space-y-1 text-sm text-text">
              {company.tasks.map((t) => (
                <li key={t.id}>
                  {t.title} — due {new Date(t.dueAt).toLocaleDateString()}
                </li>
              ))}
              {company.tasks.length === 0 && <li className="text-text-muted">None.</li>}
            </ul>
          </div>
        </Card>
      )}

      <Card className="space-y-3">
        <div>
          <Label htmlFor="outcome">Call outcome</Label>
          <Select id="outcome" className="w-auto" value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)}>
            <option value="">Choose an outcome…</option>
            {outcomes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>

        {preview.length > 0 && (
          <Alert tone="info">
            <ul className="list-disc pl-4">
              {preview.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Alert>
        )}

        {selectedOutcome?.requiresRejectionReason && (
          <div>
            <Label htmlFor="rejectionReason">Reason</Label>
            <Select id="rejectionReason" className="w-auto" value={rejectionReasonId} onChange={(e) => setRejectionReasonId(e.target.value)}>
              <option value="">Choose a reason…</option>
              {rejectionReasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div>
          <Label htmlFor="notes">
            Call notes {selectedOutcome?.requiresNotes && <span className="text-danger">*</span>}
          </Label>
          <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="button" onClick={save} disabled={isPending}>
            Save and continue
          </Button>
          <Button type="button" variant="ghost" onClick={skipTemporarily} disabled={isPending}>
            Skip for now
          </Button>
          <Button type="button" variant="ghost" onClick={skipPermanently} disabled={isPending}>
            Skip for rest of session
          </Button>
        </div>
      </Card>
    </div>
  );
}
