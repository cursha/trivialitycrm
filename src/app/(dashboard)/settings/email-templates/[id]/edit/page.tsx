import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, SectionHeading } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TemplateForm } from "../../template-form";
import { LinksPanel } from "../links-panel";
import { requireEditAccess, updateEmailTemplate } from "../../actions";

export const metadata = { title: "Edit Email Template — Triviality CRM" };

export default async function EditEmailTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireEditAccess(id);
  } catch {
    notFound();
  }

  const [template, leadTypes, pipelineStages, categories, links] = await Promise.all([
    prisma.emailTemplate.findUnique({ where: { id } }),
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.emailTemplateCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.emailTemplateLink.findMany({ where: { emailTemplateId: id }, orderBy: { sortOrder: "asc" } }),
  ]);
  if (!template) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Email Template" description={`Editing "${template.name}".`} />

      <Card>
        <SectionHeading>Template</SectionHeading>
        <div className="mt-4">
          <TemplateForm
            action={updateEmailTemplate.bind(null, id)}
            leadTypes={leadTypes}
            pipelineStages={pipelineStages}
            categories={categories}
            canManageShared={template.visibility === "SHARED"}
            submitLabel="Save changes"
            defaultValues={{
              name: template.name,
              categoryId: template.categoryId,
              subject: template.subject,
              body: template.body,
              visibility: template.visibility,
              leadTypeId: template.leadTypeId,
              pipelineStageId: template.pipelineStageId,
              language: template.language,
              active: template.active,
            }}
          />
        </div>
      </Card>

      <LinksPanel templateId={id} links={links} canEdit />
    </div>
  );
}
