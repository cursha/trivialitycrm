import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { buildCsv, buildXlsx, type ExportColumn } from "@/lib/export/serialize";
import type { SearchResultDisposition } from "@/generated/prisma/enums";

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
  { key: "triviaStatus", label: "Trivia Status" },
  { key: "competitor", label: "Competitor" },
  { key: "score", label: "Score" },
  { key: "disposition", label: "Disposition" },
  { key: "researchedAt", label: "Date Researched" },
];

export async function GET(request: Request) {
  const user = await requireUser();
  requirePermission(user, "export_leads");

  const { searchParams } = new URL(request.url);
  const searchId = searchParams.get("searchId");
  const format = searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const view = searchParams.get("view") === "all" ? "all" : "default";

  if (!searchId) {
    return NextResponse.json({ error: "searchId is required" }, { status: 400 });
  }

  const dispositions: SearchResultDisposition[] =
    view === "all" ? ["NEW", "REVIEWED", "TRANSFERRED", "REJECTED", "BELOW_SCORE", "DUPLICATE"] : ["NEW", "REVIEWED"];

  const results = await prisma.searchResult.findMany({
    where: { searchId, disposition: { in: dispositions } },
    orderBy: { score: "desc" },
    include: { search: { include: { leadType: true } }, competitor: true },
  });

  const rows = results.map((result) => ({
    name: result.name,
    address1: result.address1 ?? "",
    city: result.city,
    region: result.region,
    postalCode: result.postalCode ?? "",
    country: result.country,
    phone: result.phone ?? "",
    email: result.email ?? "",
    websiteUrl: result.websiteUrl ?? "",
    leadType: result.search.leadType.name,
    triviaStatus: result.triviaStatus,
    competitor: result.competitor?.name ?? "",
    score: String(result.score),
    disposition: result.disposition,
    researchedAt: result.researchedAt.toISOString(),
  }));

  if (format === "xlsx") {
    const buffer = await buildXlsx(COLUMNS, rows);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="search-results-${searchId}.xlsx"`,
      },
    });
  }

  const csv = buildCsv(COLUMNS, rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="search-results-${searchId}.csv"`,
    },
  });
}
