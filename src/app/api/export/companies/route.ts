import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { buildCsv, buildXlsx, type ExportColumn } from "@/lib/export/serialize";
import type { Prisma } from "@/generated/prisma/client";

const COLUMNS: ExportColumn[] = [
  { key: "name", label: "Company Name" },
  { key: "address1", label: "Address" },
  { key: "city", label: "City" },
  { key: "region", label: "State/Province" },
  { key: "postalCode", label: "Postal Code" },
  { key: "country", label: "Country" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "websiteUrl", label: "Website" },
  { key: "leadType", label: "Lead Type" },
  { key: "pipelineStage", label: "Pipeline Stage" },
  { key: "assignedTo", label: "Assigned To" },
  { key: "competitor", label: "Competitor" },
  { key: "triviaStatus", label: "Trivia Status" },
  { key: "status", label: "Status" },
];

export async function GET(request: Request) {
  const user = await requireUser();
  requirePermission(user, "export_leads");

  const scope = companyScope(user);
  if (!scope) {
    return NextResponse.json({ error: "No accessible companies" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const filters: Prisma.CompanyWhereInput[] = [scope, { status: "ACTIVE" }];
  const leadTypeId = searchParams.get("leadTypeId");
  const pipelineStageId = searchParams.get("pipelineStageId");
  const competitorId = searchParams.get("competitorId");
  if (leadTypeId) filters.push({ leadTypeId });
  if (pipelineStageId) filters.push({ pipelineStageId });
  if (competitorId) filters.push({ competitorId });

  const companies = await prisma.company.findMany({
    where: { AND: filters },
    orderBy: { name: "asc" },
    include: { leadType: true, pipelineStage: true, assignedTo: true, competitor: true },
  });

  const rows = companies.map((company) => ({
    name: company.name,
    address1: company.address1 ?? "",
    city: company.city,
    region: company.region,
    postalCode: company.postalCode ?? "",
    country: company.country,
    phone: company.phone ?? "",
    email: company.email ?? "",
    websiteUrl: company.websiteUrl ?? "",
    leadType: company.leadType.name,
    pipelineStage: company.pipelineStage.name,
    assignedTo: company.assignedTo.name,
    competitor: company.competitor?.name ?? "",
    triviaStatus: company.triviaStatus,
    status: company.status,
  }));

  if (format === "xlsx") {
    const buffer = await buildXlsx(COLUMNS, rows);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="companies.xlsx"',
      },
    });
  }

  const csv = buildCsv(COLUMNS, rows);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="companies.csv"' },
  });
}
