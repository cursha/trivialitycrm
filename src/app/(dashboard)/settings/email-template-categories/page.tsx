import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupTable } from "@/components/lookup-table";
import { AddLookupForm } from "@/components/add-lookup-form";
import { createEmailTemplateCategory, renameEmailTemplateCategory, setEmailTemplateCategoryActive, moveEmailTemplateCategory, deleteEmailTemplateCategory } from "./actions";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Email Template Categories — Triviality CRM" };

export default async function EmailTemplateCategoriesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_shared_templates");

  const categories = await prisma.emailTemplateCategory.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Email Template Categories"
        description="Group email templates for the template chooser. A category already used by existing templates can be deactivated but not deleted."
      />

      <LookupTable
        items={categories}
        rename={renameEmailTemplateCategory}
        setActive={setEmailTemplateCategoryActive}
        move={moveEmailTemplateCategory}
        remove={deleteEmailTemplateCategory}
      />

      <AddLookupForm create={createEmailTemplateCategory} placeholder="New category name" />
    </div>
  );
}
