import Link from "next/link";
import { ListTree, GitBranch, Users, ShieldCheck, XCircle, FileSpreadsheet } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Settings — Triviality CRM" };

export default async function SettingsPage() {
  const user = await requireUser();

  const cards = [
    {
      href: "/settings/lead-types",
      label: "Lead Types",
      description: "Add, rename, reorder and deactivate the Lead Types companies use.",
      icon: ListTree,
      visible: hasPermission(user, "manage_settings"),
    },
    {
      href: "/settings/pipeline-stages",
      label: "Pipeline Stages",
      description: "Manage the sales pipeline and its default stage.",
      icon: GitBranch,
      visible: hasPermission(user, "manage_settings"),
    },
    {
      href: "/settings/rejection-reasons",
      label: "Rejection Reasons",
      description: "Reasons available when rejecting an AI research result.",
      icon: XCircle,
      visible: hasPermission(user, "manage_settings"),
    },
    {
      href: "/leads/import/templates",
      label: "Import Mapping Templates",
      description: "Saved spreadsheet column mappings for future imports.",
      icon: FileSpreadsheet,
      visible: hasPermission(user, "manage_settings"),
    },
    {
      href: "/settings/users",
      label: "Users",
      description: "Create accounts, assign roles and teams, and disable access.",
      icon: Users,
      visible: hasPermission(user, "manage_users"),
    },
    {
      href: "/settings/roles",
      label: "Roles & Permissions",
      description: "Edit the permission grants for each role.",
      icon: ShieldCheck,
      visible: hasPermission(user, "manage_users"),
    },
  ].filter((card) => card.visible);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Settings" description="Configuration for how the CRM works for your whole team." />

      {cards.length === 0 ? (
        <p className="text-text-muted">You don&apos;t have access to any settings sections.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="rounded-2xl border border-border-strong bg-surface-raised p-5 shadow-sm hover:border-focus hover:shadow-md"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/10 text-secondary">
                <card.icon size={18} />
              </div>
              <b className="text-text">{card.label}</b>
              <p className="mt-1 text-sm text-text-muted">{card.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
