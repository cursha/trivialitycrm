"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export type ReportTab = { href: string; label: string };

export function ReportTabs({ tabs }: { tabs: ReportTab[] }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-2 border-b border-border pb-2">
      {tabs.map((tab) => {
        const active = tab.href === "/reports" ? pathname === "/reports" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={clsx(
              "rounded-full px-3 py-1.5 text-xs font-semibold",
              active ? "bg-secondary text-white" : "bg-black/5 text-text-muted hover:bg-black/10",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
