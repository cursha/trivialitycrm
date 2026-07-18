import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { TemplateList } from "./template-list";

export const metadata = { title: "Import Mapping Templates — Triviality CRM" };

export default async function ImportTemplatesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_settings");

  const templates = await prisma.importTemplate.findMany({ orderBy: { name: "asc" }, include: { createdBy: true } });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Import Mapping Templates</h1>
        <p className="mt-1 text-slate-500">Saved column mappings, reusable across future spreadsheet imports.</p>
      </div>
      <TemplateList
        templates={templates.map((t) => ({ id: t.id, name: t.name, createdByName: t.createdBy.name }))}
      />
    </div>
  );
}
