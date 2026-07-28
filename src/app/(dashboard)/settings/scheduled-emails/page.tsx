import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { ScheduledEmailsTable } from "./scheduled-emails-table";

export const metadata = { title: "Scheduled Emails — Triviality CRM" };

export default async function ScheduledEmailsPage() {
  const user = await requireUser();
  requirePermission(user, "schedule_email");
  const canViewTeam = hasPermission(user, "view_team_communications");

  const messages = await prisma.emailMessage.findMany({
    where: { status: "SCHEDULED", ...(canViewTeam ? {} : { createdById: user.id }) },
    orderBy: { scheduledFor: "asc" },
    include: {
      company: { select: { id: true, name: true } },
      contact: { select: { firstName: true, lastName: true } },
      createdBy: { select: { name: true, providerConnection: { select: { providerAccountEmail: true } } } },
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Scheduled Emails"
        description={
          canViewTeam
            ? "Every email the team has scheduled, across every company. Only a message still Scheduled can be edited or cancelled — one a worker has already claimed to send is left alone."
            : "Emails you've scheduled, across every company. Only a message still Scheduled can be edited or cancelled — one a worker has already claimed to send is left alone."
        }
      />

      <ScheduledEmailsTable
        messages={messages.map((m) => ({
          id: m.id,
          subject: m.subject,
          body: m.body,
          toAddresses: m.toAddresses,
          ccAddresses: m.ccAddresses,
          bccAddresses: m.bccAddresses,
          companyId: m.company?.id ?? null,
          companyName: m.company?.name ?? "—",
          contactName: m.contact ? `${m.contact.firstName} ${m.contact.lastName}` : null,
          scheduledFor: m.scheduledFor?.toISOString() ?? null,
          senderName: m.createdBy?.name ?? "—",
          senderEmail: m.createdBy?.providerConnection?.providerAccountEmail ?? null,
          canManage: canViewTeam || m.createdById === user.id,
        }))}
      />
    </div>
  );
}
