import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { NAV_ITEMS } from "@/lib/nav";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // requireUser() itself now redirects to /change-password when the flag is
  // set (see src/lib/auth/current-user.ts) — enforced for every protected
  // route/action, not just this layout.
  const user = await requireUser();

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.requiresAnyPermission || item.requiresAnyPermission.some((key) => hasPermission(user, key)),
  );

  const unseenReports = await prisma.generatedReport.findMany({
    where: { recipientIds: { has: user.id }, NOT: { seenByIds: { has: user.id } } },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { scheduledReport: { select: { name: true } } },
  });
  const notifications = unseenReports.map((r) => ({
    id: r.id,
    name: r.scheduledReport?.name ?? r.reportKey,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));

  const initials =
    user.name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <DashboardShell
      navItems={visibleNavItems}
      userName={user.name}
      userInitials={initials}
      roleName={user.role.name}
      notifications={notifications}
    >
      {children}
    </DashboardShell>
  );
}
