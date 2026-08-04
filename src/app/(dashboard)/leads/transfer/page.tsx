import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { readContactDataEntries } from "@/lib/research/contact-data";
import { TransferForm } from "./transfer-form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Transfer Leads — Triviality CRM" };

export default async function TransferPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const user = await requireUser();
  requirePermission(user, "transfer_leads");
  const { ids } = await searchParams;

  const resultIds = (ids ?? "").split(",").filter(Boolean);
  if (resultIds.length === 0) redirect("/leads");

  const [results, pipelineStages, salespeople] = await Promise.all([
    prisma.searchResult.findMany({
      where: { id: { in: resultIds }, disposition: { not: "TRANSFERRED" } },
      include: { search: { include: { leadType: true } }, competitor: true },
    }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
  ]);

  const defaultStage = pipelineStages.find((stage) => stage.isDefault) ?? pipelineStages[0];

  const rows = results.map((result) => {
    // Only the first collected contact is shown here — the generic transfer
    // form has always been single-contact; Competition Locator's own review
    // flow is where multiple collected contacts actually get surfaced.
    const contactData = readContactDataEntries(result.contactData)[0] ?? {};

    return {
      resultId: result.id,
      leadTypeName: result.search.leadType.name,
      competitorName: result.competitor?.name ?? null,
      name: result.name,
      address1: result.address1 ?? "",
      city: result.city,
      region: result.region,
      postalCode: result.postalCode ?? "",
      country: result.country,
      phone: result.phone ?? "",
      email: result.email ?? "",
      websiteUrl: result.websiteUrl ?? "",
      contactFirstName: contactData.firstName ?? "",
      contactLastName: contactData.lastName ?? "",
      contactPhone: contactData.phone ?? "",
      contactEmail: contactData.email ?? "",
      contactTitle: contactData.title ?? "",
      score: result.score,
    };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Transfer to CRM" description="Review and edit each candidate before creating it as a CRM company." />
      <TransferForm
        rows={rows}
        pipelineStages={pipelineStages.map((stage) => ({ id: stage.id, name: stage.name }))}
        defaultPipelineStageId={defaultStage?.id ?? ""}
        salespeople={salespeople.map((sp) => ({ id: sp.id, name: sp.name }))}
        isAdmin={user.role.name === "Administrator"}
      />
    </div>
  );
}
