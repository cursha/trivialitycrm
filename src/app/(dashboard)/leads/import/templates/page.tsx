import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { TemplateList } from "./template-list";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Import Mapping Templates — Triviality CRM" };

export default async function ImportTemplatesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_settings");

  const templates = await prisma.importTemplate.findMany({ orderBy: { name: "asc" }, include: { createdBy: true } });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Import Mapping Templates" description="Saved column mappings, reusable across future spreadsheet imports." />
      <TemplateList
        templates={templates.map((t) => ({ id: t.id, name: t.name, createdByName: t.createdBy.name }))}
      />
    </div>
  );
}
