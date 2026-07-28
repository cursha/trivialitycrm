import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { Card, SectionHeading } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TemplateForm } from "./template-form";
import { TemplateRow, type TemplateRowData } from "./template-row";
import { createEmailTemplate } from "./actions";

export const metadata = { title: "Email Templates — Triviality CRM" };

function TemplateTable({ templates, title, emptyText }: { templates: TemplateRowData[]; title: string; emptyText: string }) {
  return (
    <Card>
      <SectionHeading>{title}</SectionHeading>
      {templates.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">{emptyText}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                <th scope="col" className="pb-2">
                  Name
                </th>
                <th scope="col" className="pb-2">
                  Subject
                </th>
                <th scope="col" className="pb-2">
                  Lead type
                </th>
                <th scope="col" className="pb-2">
                  Pipeline stage
                </th>
                <th scope="col" className="pb-2">
                  Language
                </th>
                <th scope="col" className="pb-2">
                  Status
                </th>
                <th scope="col" className="pb-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <TemplateRow key={template.id} template={template} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default async function EmailTemplatesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_personal_templates");
  const canManageShared = hasPermission(user, "manage_shared_templates");

  const [templates, leadTypes, pipelineStages, categories] = await Promise.all([
    prisma.emailTemplate.findMany({
      where: { OR: [{ visibility: "SHARED" }, { ownerId: user.id }] },
      orderBy: { name: "asc" },
      include: { leadType: { select: { name: true } }, pipelineStage: { select: { name: true } }, category: { select: { name: true } } },
    }),
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.emailTemplateCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  const toRowData = (template: (typeof templates)[number]): TemplateRowData => ({
    id: template.id,
    name: template.name,
    category: template.category?.name ?? null,
    subject: template.subject,
    language: template.language,
    leadTypeName: template.leadType?.name ?? null,
    pipelineStageName: template.pipelineStage?.name ?? null,
    active: template.active,
    canEdit: template.visibility === "SHARED" ? canManageShared : template.ownerId === user.id || canManageShared,
  });

  const sharedTemplates = templates.filter((t) => t.visibility === "SHARED").map(toRowData);
  const personalTemplates = templates.filter((t) => t.visibility === "PERSONAL").map(toRowData);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Templates"
        description="Reusable email content with placeholders resolved at send time. A template with an unresolved placeholder blocks the send instead of going out with a literal {{token}}."
      />

      <Card>
        <SectionHeading>New template</SectionHeading>
        <div className="mt-4">
          <TemplateForm
            action={createEmailTemplate}
            leadTypes={leadTypes}
            pipelineStages={pipelineStages}
            categories={categories}
            canManageShared={canManageShared}
            submitLabel="Create template"
          />
        </div>
      </Card>

      <TemplateTable title="Shared templates" templates={sharedTemplates} emptyText="No shared templates yet." />
      <TemplateTable title="Your personal templates" templates={personalTemplates} emptyText="No personal templates yet." />
    </div>
  );
}
