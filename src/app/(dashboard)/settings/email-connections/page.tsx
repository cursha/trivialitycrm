import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { getConnectionStatus } from "@/lib/comms/connections";
import { PROVIDER_DISPLAY_NAMES } from "@/lib/comms/provider-kind";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeading } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PROVIDER_CONNECTION_STATUS_TONE } from "@/lib/ui/status-tones";
import { DisconnectButton } from "./disconnect-button";

export const metadata = { title: "Email Connections — Triviality CRM" };

export default async function EmailConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  requirePermission(user, "connect_mailbox");
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const justConnected = params.connected === "1";

  const connection = await getConnectionStatus(user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Email Connections"
        description="Connect your own business mailbox to send email from the CRM. Your password is never stored — the CRM only holds a revocable, encrypted access token."
      />

      {justConnected && (
        <Card className="border-emerald-200 bg-emerald-50 text-emerald-800">Mailbox connected successfully.</Card>
      )}
      {error && <Card className="border-danger/30 bg-danger/5 text-danger">{error}</Card>}

      <Card>
        <SectionHeading>Your mailbox</SectionHeading>
        {connection ? (
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-text">{PROVIDER_DISPLAY_NAMES[connection.provider]}</p>
                <p className="text-sm text-text-muted">{connection.providerAccountEmail}</p>
              </div>
              <Badge tone={PROVIDER_CONNECTION_STATUS_TONE[connection.status]}>{connection.status}</Badge>
            </div>
            {connection.status !== "CONNECTED" && connection.lastError && (
              <p className="text-xs text-danger">{connection.lastError}</p>
            )}
            <p className="text-xs text-text-muted">Connected {connection.connectedAt.toISOString().slice(0, 10)}</p>
            <DisconnectButton />
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-text-muted">
              No mailbox connected yet. Connect the one your business already uses — the CRM will send as you, and
              replies land back in your own inbox.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="/api/comms/oauth/microsoft/authorize"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-hover"
              >
                Connect Microsoft 365 / Outlook
              </a>
              <a
                href="/api/comms/oauth/google/authorize"
                className="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-secondary bg-transparent px-4 py-2.5 text-sm font-bold text-secondary transition-colors hover:border-focus hover:bg-focus hover:text-white"
              >
                Connect Google Workspace / Gmail
              </a>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
