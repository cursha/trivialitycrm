"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, CalendarClock, Kanban, LayoutDashboard, Menu, Search, Settings, Trophy, Users2, X } from "lucide-react";
import type { NavItem, NavIconKey } from "@/lib/nav";
import { logout } from "@/lib/auth/actions";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { NotificationBell, type UnseenReportNotification, type GeneralNotification } from "@/components/notification-bell";

const ICONS: Record<NavIconKey, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  building: Building2,
  calendar: CalendarClock,
  trophy: Trophy,
  settings: Settings,
  search: Search,
  pipeline: Kanban,
  team: Users2,
  reports: BarChart3,
};

export function DashboardShell({
  navItems,
  userName,
  userInitials,
  roleName,
  notifications,
  generalNotifications,
  children,
}: {
  navItems: NavItem[];
  userName: string;
  userInitials: string;
  roleName: string;
  notifications: UnseenReportNotification[];
  generalNotifications: GeneralNotification[];
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-surface text-text">
      {/* Mobile backdrop — dims the page and closes the sidebar on tap
          outside it. Previously absent entirely. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-near-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 w-72 border-r border-border-strong bg-surface transition-transform lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-40 items-center justify-between border-b border-border px-6">
          <Logo size="full" className="h-32" priority />
          <button
            className="rounded-lg p-2 text-text hover:bg-black/5 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = ICONS[item.icon];
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-lg border-l-4 px-4 py-3 text-sm font-medium transition-colors ${
                  active ? "border-accent bg-accent/10 font-semibold text-accent" : "border-transparent text-text hover:bg-black/5"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <section className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-border bg-surface-raised/95 px-5 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-border-strong p-2 text-text hover:bg-black/5 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            {/* Compact mark, mobile only — keeps the brand visible in the
                header once the full sidebar is off-screen. */}
            <Logo size="compact" className="h-12 lg:hidden" />
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell notifications={notifications} generalNotifications={generalNotifications} />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-bold leading-tight">{userName}</p>
              <p className="text-xs text-text-muted">{roleName}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary font-bold text-white">
              {userInitials}
            </div>
            <form action={logout}>
              <Button type="submit" variant="ghost" className="px-3 py-2">
                Sign out
              </Button>
            </form>
          </div>
        </header>

        <div className="p-5 lg:p-8">{children}</div>
      </section>
    </div>
  );
}
