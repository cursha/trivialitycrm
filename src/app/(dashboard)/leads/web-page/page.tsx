import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { WebPageForm } from "./web-page-form";

export const metadata = { title: "Read a Web Page — Triviality CRM" };

export default async function WebPagePage() {
  const user = await requireUser();
  requirePermission(user, "run_research");

  const leadTypes = await prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Read a Web Page"
        description="Paste a link to a public page and the CRM pulls out the businesses on it: name, address, phone, email and website. You review them and transfer the ones you want."
      />
      <WebPageForm leadTypes={leadTypes} />
    </div>
  );
}
