import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { NAV_ITEMS } from "@/lib/nav";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  if (user.mustChangePassword) {
    redirect("/change-password");
  }

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.requiresAnyPermission || item.requiresAnyPermission.some((key) => hasPermission(user, key)),
  );

  const initials =
    user.name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <DashboardShell navItems={visibleNavItems} userName={user.name} userInitials={initials} roleName={user.role.name}>
      {children}
    </DashboardShell>
  );
}
