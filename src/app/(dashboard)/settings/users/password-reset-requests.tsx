"use client";

import { useState, useTransition } from "react";
import { generatePasswordResetLinkAction, dismissPasswordResetRequestAction } from "./actions";
import { Card, SectionHeading } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

export type PendingRequest = {
  id: string;
  userName: string;
  userEmail: string;
  requestedAt: string;
};

function GeneratedLink({ link, expiresAt }: { link: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-1.5 rounded-lg border border-border-strong bg-black/5 p-3">
      <p className="text-xs font-semibold text-text">
        One-time link — copy and send it to the user now. It expires {new Date(expiresAt).toLocaleString()} and won&apos;t be shown again.
      </p>
      <div className="flex items-center gap-2">
        <input readOnly value={link} className="w-full truncate rounded border border-border-strong bg-white px-2 py-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            navigator.clipboard.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export function PasswordResetRequests({ requests }: { requests: PendingRequest[] }) {
  const [isPending, startTransition] = useTransition();
  const [revealed, setRevealed] = useState<Record<string, { link: string; expiresAt: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (requests.length === 0) return null;

  return (
    <Card>
      <SectionHeading>Pending password reset requests</SectionHeading>
      <p className="mt-1 text-xs text-text-muted">There is no automated email delivery — generate a one-time link here and relay it to the user directly (e.g. by phone or chat).</p>
      <div className="mt-4 space-y-3">
        {requests.map((request) => (
          <div key={request.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-text">{request.userName}</span>
                <span className="ml-2 text-xs text-text-muted">{request.userEmail}</span>
                <span className="ml-2 text-xs text-text-muted">requested {new Date(request.requestedAt).toLocaleString()}</span>
              </div>
              {!revealed[request.id] && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await generatePasswordResetLinkAction(request.id);
                        if (!result.ok) {
                          setErrors((prev) => ({ ...prev, [request.id]: result.error }));
                          return;
                        }
                        setRevealed((prev) => ({ ...prev, [request.id]: { link: result.link, expiresAt: result.expiresAt } }));
                      })
                    }
                  >
                    Generate link
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isPending}
                    onClick={() => {
                      if (!window.confirm(`Dismiss the password reset request from ${request.userName}?`)) return;
                      startTransition(async () => {
                        await dismissPasswordResetRequestAction(request.id);
                      });
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
            {errors[request.id] && <FieldError>{errors[request.id]}</FieldError>}
            {revealed[request.id] && <GeneratedLink link={revealed[request.id].link} expiresAt={revealed[request.id].expiresAt} />}
          </div>
        ))}
      </div>
    </Card>
  );
}
