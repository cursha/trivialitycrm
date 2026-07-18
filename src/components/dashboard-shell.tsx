"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CalendarClock, LayoutDashboard, Menu, Search, Settings, Trophy, X } from "lucide-react";
import type { NavItem, NavIconKey } from "@/lib/nav";
import { logout } from "@/lib/auth/actions";

const ICONS: Record<NavIconKey, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  building: Building2,
  calendar: CalendarClock,
  trophy: Trophy,
  settings: Settings,
  search: Search,
};

export function DashboardShell({
  navItems,
  userName,
  userInitials,
  roleName,
  children,
}: {
  navItems: NavItem[];
  userName: string;
  userInitials: string;
  roleName: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 border-r border-slate-200 bg-[#10233f] text-white transition-transform lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-24 items-center justify-between border-b border-white/10 px-5">
          <div className="flex items-center gap-3">
            <Image
              src="/triviality-mayhem-logo.png"
              alt="Triviality Mayhem"
              width={142}
              height={80}
              className="h-[72px] w-auto object-contain"
              priority
            />
            <span className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-black tracking-[.18em] text-blue-200">
              CRM
            </span>
          </div>
          <button className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
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
                className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium ${
                  active
                    ? "bg-blue-500 text-white shadow-lg shadow-blue-950/20"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <section className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur lg:px-8">
          <button className="rounded-lg border p-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-bold leading-tight">{userName}</p>
              <p className="text-xs text-slate-500">{roleName}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-bold text-white">
              {userInitials}
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        <div className="p-5 lg:p-8">{children}</div>
      </section>
    </div>
  );
}
