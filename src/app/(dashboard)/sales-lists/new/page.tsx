import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { previewListCompanies, getSalesListById } from "@/lib/sales-lists/queries";
import { canManageSalesList } from "@/lib/sales-lists/scope";
import { ListBuilderFilters } from "./list-builder-filters";
import { ListBuilder } from "./list-builder";
import type { SalesListPurpose } from "@/generated/prisma/enums";
import { notFound } from "next/navigation";

export const metadata = { title: "Build a Sales List — Triviality CRM" };

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const PURPOSES: { key: SalesListPurpose; label: string; description: string }[] = [
  { key: "GENERAL_SALES", label: "General Sales List", description: "Organize, review, assign, export, or archive a group of companies." },
  { key: "CALLING", label: "Calling List", description: "Work through companies one at a time using the guided calling screen." },
  { key: "EMAIL_CAMPAIGN", label: "Email Campaign", description: "Send a personalized email or sequence to each company's primary contact." },
];

export default async function NewSalesListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  requirePermission(user, "create_sales_lists");
  const params = await searchParams;

  const editListId = toSingle(params.editListId);
  let editList: Awaited<ReturnType<typeof getSalesListById>> = null;
  if (editListId) {
    editList = await getSalesListById(user, editListId);
    if (!editList || editList.type !== "DYNAMIC" || !canManageSalesList(user, editList)) notFound();
  }

  const purpose = editList
    ? editList.purpose
    : ((PURPOSES.some((p) => p.key === toSingle(params.purpose)) ? toSingle(params.purpose) : "GENERAL_SALES") as SalesListPurpose);
  const page = Number(toSingle(params.page)) || 1;

  const filters = {
    q: toSingle(params.q),
    country: toSingle(params.country),
    region: toSingle(params.region),
    city: toSingle(params.city),
    leadTypeId: toSingle(params.leadTypeId),
    pipelineStageId: toSingle(params.pipelineStageId),
    assignedToId: toSingle(params.assignedToId),
    competitorId: toSingle(params.competitorId),
    triviaStatus: toSingle(params.triviaStatus),
    confidenceLevel: toSingle(params.confidenceLevel),
    primaryClassification: toSingle(params.primaryClassification),
    scoreMin: toSingle(params.scoreMin) ? Number(toSingle(params.scoreMin)) : undefined,
    scoreMax: toSingle(params.scoreMax) ? Number(toSingle(params.scoreMax)) : undefined,
    followUp: toSingle(params.followUp),
    lastContactedBefore: toSingle(params.lastContactedBefore) || undefined,
    neverContactedOnly: toSingle(params.neverContactedOnly) === "true" || undefined,
    hasPhone: toSingle(params.hasPhone) === "true" || undefined,
    hasEmail: toSingle(params.hasEmail) === "true" || undefined,
    doNotContactOnly: toSingle(params.doNotContactOnly) === "true" || undefined,
    isExistingCustomer: toSingle(params.isExistingCustomer) ? toSingle(params.isExistingCustomer) === "true" : undefined,
    neverAnalyzedOnly: toSingle(params.neverAnalyzedOnly) === "true" || undefined,
    lastAnalyzedBefore: toSingle(params.lastAnalyzedBefore) || undefined,
    hasDataQualityWarnings: toSingle(params.hasDataQualityWarnings) === "true" || undefined,
    status: toSingle(params.status),
    sortBy: toSingle(params.sortBy),
    sortDir: toSingle(params.sortDir),
  };

  const [preview, leadTypes, pipelineStages, competitors, users] = await Promise.all([
    previewListCompanies(user, filters, { page, sortBy: filters.sortBy, sortDir: filters.sortDir }),
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.competitor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={editList ? `Edit filters — ${editList.name}` : "Build a Sales List"}
        description={editList ? "Adjust the filters, then save changes." : "Filter companies, select who belongs, and save as a fixed or dynamic list."}
      />

      {!editList && (
        <>
          <div className="flex flex-wrap gap-2">
            {PURPOSES.map((p) => (
              <a
                key={p.key}
                href={`/sales-lists/new?purpose=${p.key}`}
                className={`rounded-lg border-2 px-4 py-2.5 text-sm font-bold ${
                  purpose === p.key ? "border-secondary bg-focus text-white" : "border-border-strong text-text hover:bg-black/5"
                }`}
              >
                {p.label}
              </a>
            ))}
          </div>
          <p className="text-sm text-text-muted">{PURPOSES.find((p) => p.key === purpose)?.description}</p>
        </>
      )}

      <ListBuilderFilters
        leadTypes={leadTypes}
        pipelineStages={pipelineStages}
        salespeople={users}
        competitors={competitors}
      />

      {preview ? (
        <ListBuilder
          purpose={purpose}
          filters={filters}
          companies={preview.companies}
          total={preview.total}
          users={users.filter((u) => u.id !== user.id)}
          hasTeam={!!user.teamId}
          editList={
            editList
              ? {
                  id: editList.id,
                  name: editList.name,
                  description: editList.description,
                  visibility: editList.visibility,
                  sharedUserIds: editList.shares.map((s) => s.userId),
                }
              : undefined
          }
        />
      ) : (
        <p className="text-text-muted">You do not have permission to view companies.</p>
      )}
    </div>
  );
}
