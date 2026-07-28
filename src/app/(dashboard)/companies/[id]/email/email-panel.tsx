"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Mail } from "lucide-react";
import { sendComposedEmail, cancelComposedScheduledEmail, applySuggestedPipelineStage } from "./actions";
import { useQuickActions } from "../quick-action-context";
import { Card } from "@/components/ui/card";
import { Label, Input, Select, FieldError } from "@/components/ui/field";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import type { LinkOption } from "@/lib/comms/links";
import { Badge } from "@/components/ui/badge";
import { toneFor } from "@/lib/ui/status-tones";
import type { BadgeTone } from "@/lib/ui/status-tones";

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  SCHEDULED: "focus",
  QUEUED: "focus",
  SENT: "success",
  DELIVERED: "success",
  FAILED: "danger",
  BOUNCED: "danger",
  CANCELLED: "neutral",
  REPLIED: "secondary",
};

export type EmailMessageRow = {
  id: string;
  subject: string;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  links: LinkOption[];
  status: string;
  sentAt: string | null;
  scheduledFor: string | null;
  errorMessage: string | null;
  createdAt: string;
  suggestedPipelineStageId: string | null;
  suggestedPipelineStageName: string | null;
  pipelineStageAppliedAt: string | null;
};

export type TemplateOption = { id: string; name: string; subject: string; body: string; links: LinkOption[] };
export type ContactOption = { id: string; name: string; email: string };

function ScheduledMessageActions({ companyId, messageId }: { companyId: string; messageId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    if (!window.confirm("Cancel this scheduled email?")) return;
    startTransition(async () => {
      const result = await cancelComposedScheduledEmail(companyId, messageId);
      if (result?.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <button type="button" disabled={isPending} onClick={handleCancel} className="mt-1 text-xs font-semibold text-danger hover:underline">
        Cancel send
      </button>
      {error && <p className="mt-1 text-xs font-semibold text-danger">{error}</p>}
    </>
  );
}

/**
 * Spec section 13's confirm-before-applying prompt. Shown inline on any
 * sent message whose template suggested a pipeline stage and that
 * suggestion hasn't been applied yet — the single mechanism for both an
 * immediate send (visible right here as soon as the panel refreshes after
 * sending) and a scheduled send (the user arrives here via the
 * SCHEDULED_EMAIL_STAGE_SUGGESTED notification's "Review" link instead).
 * Never applies automatically either way.
 */
function StageSuggestionBanner({
  companyId,
  messageId,
  suggestedStageName,
}: {
  companyId: string;
  messageId: string;
  suggestedStageName: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function handleApply() {
    startTransition(async () => {
      const result = await applySuggestedPipelineStage(companyId, messageId);
      if (result?.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-2 rounded-lg border border-focus/30 bg-focus/5 p-2 text-xs">
      <p className="text-text">
        This template suggests moving this company to <strong>{suggestedStageName ?? "a stage that no longer exists"}</strong>.
      </p>
      <div className="mt-1 flex gap-3">
        <button
          type="button"
          disabled={isPending || !suggestedStageName}
          onClick={handleApply}
          className="font-semibold text-secondary hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          {isPending ? "Applying..." : "Apply stage change"}
        </button>
        <button type="button" onClick={() => setDismissed(true)} className="font-semibold text-text-muted hover:underline">
          Not now
        </button>
      </div>
      {error && <p className="mt-1 font-semibold text-danger">{error}</p>}
    </div>
  );
}

export function EmailPanel({
  companyId,
  messages,
  templates,
  contacts,
  defaultContactId,
  canSend,
  canSchedule,
  canEdit,
}: {
  companyId: string;
  messages: EmailMessageRow[];
  templates: TemplateOption[];
  contacts: ContactOption[];
  /** The company's primary contact, if set and it currently has an email
   * (src/lib/comms/recipient.ts's resolveCompanyPageDefault) -- pre-fills
   * Compose. A contact row's own "Send Email" shortcut overrides this via
   * registerEmailHandler below, regardless of this default. */
  defaultContactId?: string | null;
  canSend: boolean;
  canSchedule: boolean;
  /** Gates the suggested-pipeline-stage confirm banner -- matches
   * edit_leads, the same permission changeCompanyStage() itself enforces
   * server-side; this is just the client-side visibility mirror of it. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const { registerEmailHandler } = useQuickActions();
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [contactId, setContactId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [links, setLinks] = useState<LinkOption[]>([]);
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");

  useEffect(() => {
    if (!canSend) return;
    return registerEmailHandler((requestedContactId) => {
      setComposing(true);
      setContactId(requestedContactId);
    });
  }, [canSend, registerEmailHandler]);

  const selectedContact = contacts.find((c) => c.id === contactId);

  function handleOpenCompose() {
    setContactId(defaultContactId ?? "");
    setComposing(true);
  }

  function handleTemplateChange(id: string) {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (template) {
      setSubject(template.subject);
      setBody(template.body);
      setLinks(template.links);
    }
  }

  function handleAddLink() {
    const label = newLinkLabel.trim();
    const url = newLinkUrl.trim();
    if (!label || !url) return;
    setLinks((prev) => [...prev, { label, url }]);
    setNewLinkLabel("");
    setNewLinkUrl("");
  }

  function handleRemoveLink(index: number) {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSend(formData: FormData) {
    startTransition(async () => {
      const result = await sendComposedEmail(companyId, undefined, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setComposing(false);
        setSubject("");
        setBody("");
        setContactId("");
        setTemplateId("");
        setSendAt("");
        setLinks([]);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-accent">Email</h2>
        {canSend && !composing && contacts.length > 0 && (
          <button
            type="button"
            onClick={handleOpenCompose}
            className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline"
          >
            <CirclePlus size={15} />
            Compose
          </button>
        )}
      </div>

      {canSend && contacts.length === 0 && (
        <p className="mt-2 text-sm text-text-muted">
          Add a contact with an email address to this company before you can send email — every send must be tied to a tracked contact, not
          a free-text address.
        </p>
      )}

      {composing && (
        <form action={handleSend} className="mt-3 space-y-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3">
          <div>
            <Label className="text-xs">Contact</Label>
            <input type="hidden" name="contactId" value={contactId} />
            <Select required value={contactId} onChange={(e) => setContactId(e.target.value)} className="mt-1 py-1.5">
              <option value="" disabled>
                Choose a contact
              </option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name} ({contact.email})
                </option>
              ))}
            </Select>
            {selectedContact && <p className="mt-1 text-xs text-text-muted">Sending to {selectedContact.email}.</p>}
          </div>

          {templates.length > 0 && (
            <div>
              <Label className="text-xs">Template</Label>
              <Select value={templateId} onChange={(e) => handleTemplateChange(e.target.value)} className="mt-1 py-1.5">
                <option value="">Choose a template (optional)</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
              <input type="hidden" name="templateId" value={templateId} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Cc</Label>
              <Input name="cc" className="mt-1 py-1.5" />
            </div>
            <div>
              <Label className="text-xs">Bcc</Label>
              <Input name="bcc" className="mt-1 py-1.5" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Subject</Label>
            <Input name="subject" required value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 py-1.5" />
          </div>
          <div>
            <Label className="text-xs">Body</Label>
            <div className="mt-1">
              <RichTextEditor name="body" value={body} onChange={setBody} placeholder="Write your message..." />
            </div>
          </div>

          <div>
            <Label className="text-xs">Links</Label>
            <input type="hidden" name="links" value={JSON.stringify(links)} />
            {links.length > 0 && (
              <ul className="mt-1 space-y-1">
                {links.map((link, index) => (
                  <li key={`${link.url}-${index}`} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-xs">
                    <span className="truncate">
                      <span className="font-semibold text-text">{link.label}</span>{" "}
                      <span className="text-text-muted">{link.url}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveLink(index)}
                      className="shrink-0 font-semibold text-text-muted hover:text-danger"
                      aria-label={`Remove link ${link.label}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1 flex gap-2">
              <Input
                placeholder="Label"
                value={newLinkLabel}
                onChange={(e) => setNewLinkLabel(e.target.value)}
                className="py-1.5"
              />
              <Input
                placeholder="https://..."
                value={newLinkUrl}
                onChange={(e) => setNewLinkUrl(e.target.value)}
                className="py-1.5"
              />
              <button
                type="button"
                onClick={handleAddLink}
                className="shrink-0 rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5"
              >
                Add
              </button>
            </div>
          </div>

          {canSchedule && (
            <div>
              <Label className="text-xs">Send at (optional — leave blank to send now)</Label>
              <Input
                type="datetime-local"
                name="sendAt"
                value={sendAt}
                onChange={(e) => setSendAt(e.target.value)}
                className="mt-1 py-1.5"
              />
            </div>
          )}

          {error && <FieldError>{error}</FieldError>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
            >
              {isPending ? "Sending..." : sendAt ? "Schedule email" : "Send email"}
            </button>
            <button
              type="button"
              onClick={() => setComposing(false)}
              className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {messages.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">No email sent yet.</p>
      ) : (
        <ol className="mt-4 space-y-3 border-l border-border pl-4">
          {messages.map((message) => (
            <li key={message.id} className="relative">
              <span className="absolute -left-[21px] flex h-6 w-6 items-center justify-center rounded-full bg-secondary/10 text-secondary ring-4 ring-surface-raised">
                <Mail size={13} />
              </span>
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-text">{message.subject}</p>
                <Badge tone={toneFor(STATUS_TONE, message.status)}>{message.status}</Badge>
              </div>
              <p className="text-xs text-text-muted">
                To {message.toAddresses.join(", ")} ·{" "}
                {message.status === "SCHEDULED" && message.scheduledFor
                  ? `scheduled for ${new Date(message.scheduledFor).toLocaleString()}`
                  : new Date(message.sentAt ?? message.createdAt).toLocaleString()}
              </p>
              {message.ccAddresses.length > 0 && <p className="text-xs text-text-muted">Cc {message.ccAddresses.join(", ")}</p>}
              {message.bccAddresses.length > 0 && <p className="text-xs text-text-muted">Bcc {message.bccAddresses.join(", ")}</p>}
              {message.links.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {message.links.map((link, index) => (
                    <li key={`${link.url}-${index}`}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-secondary hover:underline"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {message.errorMessage && <p className="mt-1 text-xs font-semibold text-danger">{message.errorMessage}</p>}
              {message.status === "SCHEDULED" && canSchedule && <ScheduledMessageActions companyId={companyId} messageId={message.id} />}
              {canEdit && message.suggestedPipelineStageId && !message.pipelineStageAppliedAt && (message.status === "SENT" || message.status === "DELIVERED") && (
                <StageSuggestionBanner companyId={companyId} messageId={message.id} suggestedStageName={message.suggestedPipelineStageName} />
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
