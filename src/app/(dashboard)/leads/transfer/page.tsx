import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { TransferForm } from "./transfer-form";

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
    const contactData = (result.contactData as {
      firstName?: string;
      lastName?: string;
      phone?: string;
      email?: string;
      title?: string;
    } | null) ?? {};

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
      <div>
        <h1 className="text-3xl font-black tracking-tight">Transfer to CRM</h1>
        <p className="mt-1 text-slate-500">Review and edit each candidate before creating it as a CRM company.</p>
      </div>
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
