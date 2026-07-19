import Link from "next/link";
import { Sparkles, ListChecks, Upload, FileText } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Leads — Triviality CRM" };

export default async function LeadsHubPage() {
  const user = await requireUser();

  const cards = [
    {
      href: "/leads/searches/new",
      label: "New Search",
      description: "Run an AI-assisted research search for a state/province and Lead Type.",
      icon: Sparkles,
      show: hasPermission(user, "run_research"),
    },
    {
      href: "/leads/prompts",
      label: "Research Prompts",
      description: "Write, save, and reuse AI research prompts.",
      icon: FileText,
      show: hasPermission(user, "manage_prompts"),
    },
    {
      href: "/leads/import",
      label: "Spreadsheet Import",
      description: "Upload a CSV or Excel file and map its columns to CRM fields.",
      icon: Upload,
      show: hasPermission(user, "import_leads"),
    },
  ].filter((card) => card.show);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Leads" description="AI-assisted research, review, and import for new CRM leads." />

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="flex flex-col gap-2 rounded-2xl border border-border-strong bg-surface-raised p-5 shadow-sm transition hover:border-focus hover:shadow-md"
          >
            <card.icon size={20} className="text-secondary" />
            <span className="font-bold text-text">{card.label}</span>
            <span className="text-sm text-text-muted">{card.description}</span>
          </Link>
        ))}
        {cards.length === 0 && (
          <p className="flex items-center gap-2 text-text-muted">
            <ListChecks size={16} /> You don&apos;t have access to any lead-research tools yet.
          </p>
        )}
      </div>
    </div>
  );
}
