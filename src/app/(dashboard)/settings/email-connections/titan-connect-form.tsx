"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";
import { connectTitanAccount } from "./actions";

export function TitanConnectForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function connect() {
    setError(null);
    startTransition(async () => {
      const result = await connectTitanAccount(email, password);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push("/settings/email-connections?connected=1");
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <p className="font-semibold text-text">Titan Email</p>
        <p className="text-xs text-text-muted">
          Titan has no OAuth — this stores your actual mailbox password (encrypted at rest), not a revocable token like the options above. It
          also can&apos;t detect replies, bounces, or sync a calendar. Turn on &quot;Enable Titan on other apps&quot; in Titan&apos;s webmail settings
          first, or the connection below will fail.
        </p>
      </div>
      <div>
        <Label htmlFor="titan-email">Email address</Label>
        <Input id="titan-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </div>
      <div>
        <Label htmlFor="titan-password">Password</Label>
        <Input id="titan-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      {error && <FieldError>{error}</FieldError>}
      <Button type="button" variant="secondary" onClick={connect} disabled={isPending || !email || !password}>
        {isPending ? "Verifying..." : "Connect Titan Email"}
      </Button>
    </div>
  );
}
