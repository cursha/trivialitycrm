"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateScheduledEmail, cancelScheduledEmailAction } from "./actions";
import { Card } from "@/components/ui/card";
import { Label, Input, FieldError } from "@/components/ui/field";
import { RichTextEditor } from "@/components/ui/rich-text-editor";

export type ScheduledEmailRow = {
  id: string;
  subject: string;
  body: string;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  companyId: string | null;
  companyName: string;
  contactName: string | null;
  scheduledFor: string | null;
  senderName: string;
  senderEmail: string | null;
  canManage: boolean;
};

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the viewer's local time, not
 * the ISO UTC string scheduledFor arrives as. */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function EditForm({ row, onDone }: { row: ScheduledEmailRow; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(updateScheduledEmail.bind(null, row.id), undefined);
  const [body, setBody] = useState(row.body);

  return (
    <form
      action={(formData) => {
        formData.set("body", body);
        formAction(formData);
      }}
      className="space-y-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Cc</Label>
          <Input name="cc" defaultValue={row.ccAddresses.join(", ")} className="mt-1 py-1.5" />
        </div>
        <div>
          <Label className="text-xs">Bcc</Label>
          <Input name="bcc" defaultValue={row.bccAddresses.join(", ")} className="mt-1 py-1.5" />
        </div>
      </div>
      <div>
        <Label className="text-xs">Subject</Label>
        <Input name="subject" required defaultValue={row.subject} className="mt-1 py-1.5" />
      </div>
      <div>
        <Label className="text-xs">Body</Label>
        <div className="mt-1">
          <RichTextEditor name="body" value={body} onChange={setBody} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Send at</Label>
        <Input type="datetime-local" name="sendAt" required defaultValue={row.scheduledFor ? toLocalInputValue(row.scheduledFor) : ""} className="mt-1 py-1.5" />
      </div>
      {state?.error && <FieldError>{state.error}</FieldError>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save changes"}
        </button>
        <button type="button" onClick={onDone} className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ScheduledEmailsTable({ messages }: { messages: ScheduledEmailRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCancelSend(id: string) {
    if (!window.confirm("Cancel this scheduled email?")) return;
    startTransition(async () => {
      const result = await cancelScheduledEmailAction(id);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        router.refresh();
      }
    });
  }

  if (messages.length === 0) {
    return (
      <Card>
        <p className="text-sm text-text-muted">No scheduled emails.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs font-semibold text-danger">{error}</p>}
      {messages.map((row) => (
        <Card key={row.id}>
          {editingId === row.id ? (
            <EditForm
              row={row}
              onDone={() => {
                setEditingId(null);
                router.refresh();
              }}
            />
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-text">{row.subject}</p>
                  <p className="text-xs text-text-muted">
                    To {row.toAddresses.join(", ")} ·{" "}
                    {row.companyId ? (
                      <Link href={`/companies/${row.companyId}#email-panel`} className="text-secondary hover:underline">
                        {row.companyName}
                      </Link>
                    ) : (
                      row.companyName
                    )}
                    {row.contactName ? ` (${row.contactName})` : ""}
                  </p>
                  <p className="text-xs text-text-muted">
                    Scheduled for {row.scheduledFor ? new Date(row.scheduledFor).toLocaleString() : "—"} · Sender: {row.senderName}
                    {row.senderEmail ? ` (${row.senderEmail})` : ""}
                  </p>
                </div>
                {row.canManage && (
                  <div className="flex shrink-0 gap-3">
                    <button type="button" onClick={() => setEditingId(row.id)} className="text-xs font-semibold text-secondary hover:underline">
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleCancelSend(row.id)}
                      className="text-xs font-semibold text-danger hover:underline"
                    >
                      Cancel send
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
