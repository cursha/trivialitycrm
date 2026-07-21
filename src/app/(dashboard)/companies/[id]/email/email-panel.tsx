"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Mail } from "lucide-react";
import { sendComposedEmail } from "./actions";
import { Card } from "@/components/ui/card";
import { Label, Input, Select, Textarea, FieldError } from "@/components/ui/field";
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
  status: string;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type TemplateOption = { id: string; name: string; subject: string; body: string };
export type ContactOption = { id: string; name: string; email: string };

export function EmailPanel({
  companyId,
  messages,
  templates,
  contacts,
  canSend,
}: {
  companyId: string;
  messages: EmailMessageRow[];
  templates: TemplateOption[];
  contacts: ContactOption[];
  canSend: boolean;
}) {
  const router = useRouter();
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [contactId, setContactId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const selectedContact = contacts.find((c) => c.id === contactId);

  function handleTemplateChange(id: string) {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (template) {
      setSubject(template.subject);
      setBody(template.body);
    }
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
            onClick={() => setComposing(true)}
            className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline"
          >
            <CirclePlus size={15} />
            Compose
          </button>
        )}
      </div>

      {canSend && contacts.length === 0 && (
        <p className="mt-2 text-sm text-text-muted">
          Add a contact with an email address to this company before you can send email — every send must be tied to a tracked contact so
          consent can be checked.
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
            <Textarea name="body" required rows={6} value={body} onChange={(e) => setBody(e.target.value)} className="mt-1 py-1.5" />
          </div>

          {error && <FieldError>{error}</FieldError>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
            >
              {isPending ? "Sending..." : "Send email"}
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
                To {message.toAddresses.join(", ")} · {new Date(message.sentAt ?? message.createdAt).toLocaleString()}
              </p>
              {message.errorMessage && <p className="mt-1 text-xs font-semibold text-danger">{message.errorMessage}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
