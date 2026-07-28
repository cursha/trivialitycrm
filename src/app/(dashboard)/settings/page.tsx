import Link from "next/link";
import {
  ListTree,
  GitBranch,
  Users,
  ShieldCheck,
  XCircle,
  FileSpreadsheet,
  MapPin,
  Mail,
  FileText,
  ShieldAlert,
  Workflow,
  Inbox,
  ListChecks,
  Tag,
  CalendarClock,
} from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/prisma";
import { WorkspaceSettingsForm } from "./workspace-settings-form";

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
      href: "/settings/email-connections",
      label: "Email Connections",
      description: "Connect your own business mailbox to send email from the CRM.",
      icon: Mail,
      visible: hasPermission(user, "connect_mailbox"),
    },
    {
      href: "/settings/email-templates",
      label: "Email Templates",
      description: "Reusable email content with placeholders, personal or shared with the team.",
      icon: FileText,
      visible: hasPermission(user, "manage_personal_templates"),
    },
    {
      href: "/settings/email-template-categories",
      label: "Email Template Categories",
      description: "Group email templates for the template chooser.",
      icon: Tag,
      visible: hasPermission(user, "manage_shared_templates"),
    },
    {
      href: "/settings/scheduled-emails",
      label: "Scheduled Emails",
      description: "Emails scheduled for later — edit or cancel before they send.",
      icon: CalendarClock,
      visible: hasPermission(user, "schedule_email"),
    },
    {
      href: "/settings/sequences",
      label: "Follow-up Sequences",
      description: "Multi-step, explicitly-enrolled follow-up campaigns (wait, email, task reminders).",
      icon: Workflow,
      visible: hasPermission(user, "manage_sequences"),
    },
    {
      href: "/settings/communication-compliance",
      label: "Communication Compliance",
      description: "View and record each contact's email consent (CASL/CAN-SPAM compliance support).",
      icon: ShieldAlert,
      visible: hasPermission(user, "manage_communication_compliance"),
    },
    {
      href: "/settings/communications-review",
      label: "Communications Review",
      description: "Inbound replies that couldn't be matched to a contact automatically — review and link them by hand.",
      icon: Inbox,
      visible: hasPermission(user, "view_team_communications"),
    },
    {
      href: "/data-quality/rules",
      label: "Data Quality Rules",
      description: "Table-driven rules for missing fields, invalid formats, duplicates, and stale records.",
      icon: ListChecks,
      visible: hasPermission(user, "manage_data_quality_rules"),
    },
    {
      href: "/settings/territories",
      label: "Territories",
      description: "Organize companies into country/state/city territories with an owning salesperson.",
      icon: MapPin,
      visible: hasPermission(user, "manage_territories"),
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
      visible: hasPermission(user, "manage_roles"),
    },
  ].filter((card) => card.visible);

  const canManageSettings = hasPermission(user, "manage_settings");
  const workspaceSettings = canManageSettings
    ? ((await prisma.workspaceSettings.findUnique({ where: { id: 1 } })) ?? {
        noActivityThresholdDays: 14,
        newlyAssignedThresholdDays: 3,
        mailingAddress: null,
        quietHoursStartHour: null,
        quietHoursEndHour: null,
      })
    : null;

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

      {workspaceSettings && <WorkspaceSettingsForm defaultValues={workspaceSettings} />}
    </div>
  );
}
