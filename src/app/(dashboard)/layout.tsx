import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { NAV_ITEMS } from "@/lib/nav";
import { describeNotification } from "@/lib/notifications";
import { visibleOnboardingSteps } from "@/lib/onboarding/steps";
import { getRouteSummary } from "@/lib/route-plan/service";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // requireUser() itself now redirects to /change-password when the flag is
  // set (see src/lib/auth/current-user.ts) — enforced for every protected
  // route/action, not just this layout.
  const user = await requireUser();

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.requiresAnyPermission || item.requiresAnyPermission.some((key) => hasPermission(user, key)),
  );

  const visibleOnboarding = visibleOnboardingSteps((key) => hasPermission(user, key));
  const canViewRoutePlan = hasPermission(user, "view_route_plan");
  const [unreadNotifications, completedOnboardingCount, routeSummary] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id, readAt: null },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.userOnboardingStep.count({
      where: { userId: user.id, stepKey: { in: visibleOnboarding.map((s) => s.key) } },
    }),
    // Server enforcement remains mandatory regardless (route-plan/service.ts
    // and every action still requirePermission independently) — this is
    // only what decides whether the header badge itself is fetched/shown.
    canViewRoutePlan ? getRouteSummary(user.id) : Promise.resolve(null),
  ]);
  const onboardingRemaining = visibleOnboarding.length - completedOnboardingCount;
  const notifications = unreadNotifications.map((n) => {
    const payload = n.payload as Record<string, unknown>;
    const downloadHref =
      n.type === "REPORT_GENERATED" && payload.status === "SUCCEEDED" && typeof payload.generatedReportId === "string"
        ? `/api/reports/generated/${payload.generatedReportId}/download?format=csv`
        : undefined;
    return {
      id: n.id,
      message: describeNotification(n.type, payload),
      createdAt: n.createdAt.toISOString(),
      downloadHref,
    };
  });

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
      canAddLeads={hasPermission(user, "add_leads")}
      canEditLeads={hasPermission(user, "edit_leads")}
      onboardingRemaining={onboardingRemaining}
      routePlanCount={canViewRoutePlan ? (routeSummary?.count ?? 0) : null}
    >
      {children}
    </DashboardShell>
  );
}
