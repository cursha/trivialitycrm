"use client";

import { useActionState, useTransition } from "react";
import { Input, FieldError } from "@/components/ui/field";
import { matchInboundMessageAction, dismissInboundMessageAction } from "./actions";

export type ReviewMessageData = {
  id: string;
  fromAddress: string;
  subject: string;
  body: string;
  receivedAt: string;
};

export function ReviewRow({ message }: { message: ReviewMessageData }) {
  const [state, formAction, pending] = useActionState(matchInboundMessageAction.bind(null, message.id), undefined);
  const [dismissing, startDismiss] = useTransition();

  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-text">{message.subject || "(no subject)"}</p>
          <p className="text-xs text-text-muted">
            From {message.fromAddress} · {message.receivedAt.slice(0, 10)}
          </p>
        </div>
        <button
          type="button"
          disabled={dismissing}
          onClick={() =>
            startDismiss(async () => {
              await dismissInboundMessageAction(message.id);
            })
          }
          className="text-xs font-semibold text-text-muted hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>

      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-text-muted">{message.body}</p>

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <Input name="contactEmail" placeholder="Contact's email address" className="py-1.5" />
        </div>
        {state?.error && <FieldError>{state.error}</FieldError>}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
        >
          {pending ? "Linking..." : "Link to contact"}
        </button>
      </form>
    </li>
  );
}
