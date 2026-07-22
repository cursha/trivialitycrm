import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeading } from "@/components/ui/card";
import { ReviewRow, type ReviewMessageData } from "./review-row";

export const metadata = { title: "Communications Review — Triviality CRM" };

const RESULT_LIMIT = 50;

export default async function CommunicationsReviewPage() {
  const user = await requireUser();
  requirePermission(user, "view_team_communications");

  const messages = await prisma.emailMessage.findMany({
    where: { direction: "INBOUND", contactId: null, reviewedAt: null },
    orderBy: { createdAt: "asc" },
    take: RESULT_LIMIT + 1,
  });

  const truncated = messages.length > RESULT_LIMIT;
  const rows: ReviewMessageData[] = messages.slice(0, RESULT_LIMIT).map((message) => ({
    id: message.id,
    fromAddress: message.fromAddress ?? "(unknown sender)",
    subject: message.subject,
    body: message.body,
    receivedAt: message.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Communications Review"
        description="Inbound replies whose sender address didn't match exactly one contact — link each to the right contact, or dismiss it if it's not a real lead reply. Nothing here was ever attached to a company automatically."
      />

      <Card>
        <SectionHeading>Unmatched messages</SectionHeading>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">Nothing waiting for review.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {rows.map((row) => (
              <ReviewRow key={row.id} message={row} />
            ))}
          </ul>
        )}
        {truncated && (
          <p className="mt-3 text-xs text-text-muted">Showing the oldest {RESULT_LIMIT} results — resolve some to see more.</p>
        )}
      </Card>
    </div>
  );
}
