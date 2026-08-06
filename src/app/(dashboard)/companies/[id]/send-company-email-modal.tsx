"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/field";
import { Card, SectionHeading } from "@/components/ui/card";
import { sendCompanyEmail } from "./email/actions";

/**
 * The Company detail page's "Send email" quick action — a small,
 * self-contained inline card, not wired into the page's QuickActionProvider
 * scroll-panel system (that machinery coordinates separately-rendered page
 * sections; this action is fully self-contained, simpler to keep local).
 * Sends directly to the Company's own email address via sendCompanyEmail()
 * — see that action's doc comment for why this is a deliberately separate,
 * simpler path than the existing per-Contact Compose panel.
 */
export function SendCompanyEmailModal({ companyId, companyEmail, onClose }: { companyId: string; companyEmail: string; onClose: () => void }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await sendCompanyEmail(companyId, subject, body);
      if (result && "error" in result) {
        setError(result.error ?? "Something went wrong sending this email.");
        return;
      }
      setSent(true);
      router.refresh();
    });
  }

  return (
    <Card className="mt-3 space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeading>Send email</SectionHeading>
        <button type="button" onClick={onClose} className="text-text-muted hover:text-text" aria-label="Close">
          <X size={16} />
        </button>
      </div>
      {sent ? (
        <p className="text-sm font-semibold text-emerald-700">Email sent to {companyEmail}.</p>
      ) : (
        <>
          <p className="text-xs text-text-muted">To: {companyEmail}</p>
          <div>
            <Label htmlFor="company-email-subject">Subject</Label>
            <Input id="company-email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={isPending} />
          </div>
          <div>
            <Label htmlFor="company-email-body">Message</Label>
            <Textarea id="company-email-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} disabled={isPending} />
          </div>
          {error && <FieldError>{error}</FieldError>}
          <div className="flex gap-2">
            <Button type="button" variant="primary" onClick={send} disabled={isPending || !subject.trim() || !body.trim()}>
              {isPending ? "Sending..." : "Send"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
