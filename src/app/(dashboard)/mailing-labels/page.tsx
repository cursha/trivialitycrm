import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { canonicalCountry } from "@/lib/constants/countries";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { buttonClasses } from "@/components/ui/button";
import { getLabelSettings, getOrCreateDraft, geometryOf, resolveDraft, summarize, type Candidate } from "@/lib/mailing-labels/service";
import { capacity, validateGeometry } from "@/lib/mailing-labels/geometry";
import { parseStoredOverrides, type LabelFilters } from "@/lib/validation/mailing-labels";
import { DraftProvider, FilterPanel, SelectionSummary, ContactChoice, RemoveToggle, SheetPanel, PreviewPanel, type FilterOptions } from "./label-workflow";

export const metadata = { title: "Mailing Labels — Triviality CRM" };

const REVIEW_PAGE_SIZE = 50;
const VIEWS = ["included", "removed", "excluded"] as const;
type View = (typeof VIEWS)[number];

async function filterOptions(user: Awaited<ReturnType<typeof requireUser>>): Promise<FilterOptions> {
  const scope = companyScope(user) ?? { id: "__none__" };
  const [places, stages, salespeople] = await Promise.all([
    prisma.company.groupBy({ by: ["city", "region", "country"], where: { AND: [scope, { status: "ACTIVE" }] } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: {
        disabled: false,
        ...(hasPermission(user, "view_all_leads") ? {} : hasPermission(user, "view_team_leads") ? { teamId: user.teamId } : { id: user.id }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  // Same city/province spelled with different capitals is one choice.
  const cities = new Map<string, { city: string; region: string }>();
  const regions = new Map<string, { region: string; country: string }>();
  for (const p of places) {
    const city = p.city.trim();
    const region = p.region.trim();
    const country = canonicalCountry(p.country);
    if (city && region) cities.set(`${city.toLowerCase()}|${region.toLowerCase()}`, { city, region });
    if (region) regions.set(`${region.toLowerCase()}|${country.toLowerCase()}`, { region, country });
  }
  const byText = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });
  return {
    cities: [...cities.values()].sort((a, b) => byText(a.city, b.city) || byText(a.region, b.region)),
    regions: [...regions.values()].sort((a, b) => byText(a.country, b.country) || byText(a.region, b.region)),
    stages,
    salespeople,
    tags: [
      { value: "EASY_WIN", label: "Easy Win" },
      { value: "REVENUE_READY", label: "Revenue Ready" },
      { value: "NO_HOST_READY", label: "No Host Ready" },
    ],
  };
}

function AddressBlock({ candidate }: { candidate: Candidate }) {
  return (
    <div className="text-xs leading-snug text-text">
      {candidate.lines.map((line, i) => (
        <div key={i} className={line.bold ? "font-bold" : ""}>
          {line.text}
        </div>
      ))}
    </div>
  );
}

type FromCompanies = { city?: string; region?: string; country?: string; pipelineStageId?: string; assignedToId?: string };

/**
 * The filters a Companies-list "Print labels" click brought over, matched
 * to this page's choices (a city is ticked in every province/state it's in
 * unless the province was given too). Null when the page wasn't opened
 * that way. Nothing is saved until the user clicks Apply.
 */
function companiesPrefill(params: FromCompanies & { from?: string }, options: FilterOptions): LabelFilters | null {
  if (params.from !== "companies") return null;
  const same = (a: string, b: string | undefined) => !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const country = params.country ? canonicalCountry(params.country) : undefined;
  return {
    cities: params.city ? options.cities.filter((c) => same(c.city, params.city) && (!params.region || same(c.region, params.region))) : [],
    regions: !params.city && params.region ? options.regions.filter((r) => same(r.region, params.region) && (!country || same(r.country, country))) : [],
    stageIds: params.pipelineStageId && options.stages.some((s) => s.id === params.pipelineStageId) ? [params.pipelineStageId] : [],
    salespersonIds: params.assignedToId && options.salespeople.some((s) => s.id === params.assignedToId) ? [params.assignedToId] : [],
    tags: [],
    tagMode: "any",
    companyIds: [],
  };
}

export default async function MailingLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string; from?: string } & FromCompanies>;
}) {
  const user = await requireUser();
  requirePermission(user, "use_mailing_labels");
  const params = await searchParams;
  const view: View = VIEWS.includes(params.view as View) ? (params.view as View) : "included";
  const q = (params.q ?? "").trim().slice(0, 100);

  const draft = await getOrCreateDraft(user);
  const [resolution, options, templates, profiles, settings] = await Promise.all([
    resolveDraft(user, draft),
    filterOptions(user),
    prisma.labelSheetTemplate.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } }),
    prisma.labelAlignmentProfile.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    getLabelSettings(),
  ]);

  const list = view === "included" ? resolution.included : view === "removed" ? resolution.removed : resolution.excluded;
  const searched = q ? list.filter((c) => c.companyName.toLowerCase().includes(q.toLowerCase())) : list;
  const pageCount = Math.max(1, Math.ceil(searched.length / REVIEW_PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(params.page) || 1), pageCount);
  const rows = searched.slice((page - 1) * REVIEW_PAGE_SIZE, page * REVIEW_PAGE_SIZE);
  const hrefFor = (target: { view?: View; page?: number }) => {
    const sp = new URLSearchParams();
    const v = target.view ?? view;
    if (v !== "included") sp.set("view", v);
    if (q && !target.view) sp.set("q", q);
    if (target.page && target.page > 1) sp.set("page", String(target.page));
    const s = sp.toString();
    return s ? `/mailing-labels?${s}` : "/mailing-labels";
  };

  const sheets = templates
    .filter((t) => t.versions[0])
    .map((t) => {
      const geometry = geometryOf(t.versions[0]);
      return { id: t.id, name: t.name, rows: geometry.rows, columns: geometry.columns, valid: validateGeometry(geometry).length === 0 };
    });
  const chosenSheet = templates.find((t) => t.id === draft.templateId)?.versions[0];
  const summary = chosenSheet ? summarize(resolution.included.length, draft.startPosition, geometryOf(chosenSheet)) : null;
  const overrides = parseStoredOverrides(draft.contactOverrides);
  const prefill = companiesPrefill(params, options);

  return (
    <DraftProvider revision={draft.revision}>
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title="Mailing Labels"
          description="Address labels for every company matching your filters, one per company, printed on sheets of labels from a PDF."
          actions={
            <Link href="/mailing-labels/history" className={buttonClasses("ghost")}>
              Past label batches
            </Link>
          }
        />

        {prefill && (
          <Card className="text-sm text-text">
            Filters brought over from Companies are ticked below. Click <span className="font-semibold">Apply filters</span> to use them. Only city, province/state, sales stage and
            salesperson carry over; other Companies filters (search, lead type and so on) don&apos;t apply to labels.
          </Card>
        )}

        {/* Companies ticked in the Companies checkbox menu are already the
            choice: no filters to set, straight on to review and print. */}
        {!prefill && resolution.filters.companyIds.length > 0 ? (
          <SelectionSummary ticked={resolution.filters.companyIds.length} available={resolution.matched} />
        ) : (
          <FilterPanel
            key={prefill ? "from-companies" : "saved"}
            options={options}
            filters={prefill ?? resolution.filters}
            fromCompanies={!!prefill}
            allConfirmed={draft.allConfirmed}
            hasChoices={draft.removedCompanyIds.length > 0 || Object.keys(overrides).length > 0}
            needsConfirmAll={resolution.needsConfirmAll}
            matched={resolution.matched}
          />
        )}

        {resolution.tooMany && <Card className="text-sm font-semibold text-danger">{resolution.matched.toLocaleString()} companies match. That&apos;s too many to review; narrow the filters.</Card>}

        {!resolution.needsConfirmAll && !resolution.tooMany && (
          <>
            <Card className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              <div>
                <p className="text-2xl font-black text-text">{resolution.matched}</p>
                <p className="text-xs text-text-muted">match the filters</p>
              </div>
              <div>
                <p className="text-2xl font-black text-text">{resolution.included.length + resolution.removed.length}</p>
                <p className="text-xs text-text-muted">have a complete address</p>
              </div>
              <div>
                <p className={`text-2xl font-black ${resolution.excluded.length > 0 ? "text-danger" : "text-text"}`}>{resolution.excluded.length}</p>
                <p className="text-xs text-text-muted">need correcting</p>
              </div>
              <div>
                <p className="text-2xl font-black text-primary">{resolution.included.length}</p>
                <p className="text-xs text-text-muted">labels to print</p>
              </div>
            </Card>
            {resolution.included.length > settings.maxLabelsPerBatch && (
              <Card className="text-sm font-semibold text-danger">
                {resolution.included.length} labels is more than the {settings.maxLabelsPerBatch} allowed in one job. Narrow the filters or remove companies, and print the rest as
                a second job.
              </Card>
            )}

            <Card className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2" role="tablist">
                  {VIEWS.map((v) => (
                    <Link
                      key={v}
                      href={hrefFor({ view: v })}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${view === v ? "bg-primary text-white" : "bg-black/5 text-text-muted"}`}
                    >
                      {v === "included" ? `Printing (${resolution.included.length})` : v === "removed" ? `Removed (${resolution.removed.length})` : `Needs correcting (${resolution.excluded.length})`}
                    </Link>
                  ))}
                </div>
                <form className="flex gap-2" action="/mailing-labels">
                  {view !== "included" && <input type="hidden" name="view" value={view} />}
                  <input name="q" defaultValue={q} placeholder="Find a company" className="rounded-lg border border-border-strong px-3 py-1.5 text-sm" />
                </form>
              </div>
              {view === "excluded" && resolution.excluded.length > 0 && (
                <p className="text-xs text-text-muted">These can&apos;t be printed until their address is complete. Fix the company, then come back; this page always reads the latest data.</p>
              )}
              {rows.length === 0 ? (
                <p className="text-sm text-text-muted">{q ? "No companies match that search." : "None."}</p>
              ) : (
                <div className="divide-y divide-border">
                  {rows.map((c) => (
                    <div key={c.companyId} className="grid gap-3 py-3 sm:grid-cols-[1fr_1fr_auto]">
                      <div className="min-w-0">
                        <Link href={`/companies/${c.companyId}`} className="font-semibold text-primary underline">
                          {c.companyName}
                        </Link>
                        {c.state === "excluded" ? (
                          <ul className="mt-1 list-inside list-disc text-xs font-semibold text-danger">
                            {c.reasons.map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                          </ul>
                        ) : (
                          <ContactChoice companyId={c.companyId} current={c.override} defaultLabel={c.override ? null : c.attention} note={c.attentionNote} options={c.contactOptions} />
                        )}
                        {c.warnings.map((w) => (
                          <p key={w} className="mt-1 text-xs font-semibold text-amber-700">
                            {w}
                          </p>
                        ))}
                      </div>
                      <div>
                        {c.state === "excluded" ? (
                          <Link href={`/companies/${c.companyId}/edit`} className="text-xs font-semibold text-primary underline">
                            Correct the address
                          </Link>
                        ) : (
                          <>
                            <AddressBlock candidate={c} />
                            <p className="mt-1 text-[11px] text-text-muted">Address source: company address</p>
                          </>
                        )}
                      </div>
                      <div>{c.state !== "excluded" && <RemoveToggle companyId={c.companyId} removed={c.state === "removed"} />}</div>
                    </div>
                  ))}
                </div>
              )}
              <Pagination page={page} pageCount={pageCount} pageSize={REVIEW_PAGE_SIZE} hrefFor={(p) => hrefFor({ page: p })} />
            </Card>

            <SheetPanel
              sheets={sheets}
              profiles={profiles.map((p) => ({ id: p.id, templateId: p.templateId, name: p.name, offsetXMm: p.offsetXMm, offsetYMm: p.offsetYMm }))}
              templateId={draft.templateId}
              alignmentProfileId={draft.alignmentProfileId}
              startPosition={draft.startPosition}
              capacity={chosenSheet ? capacity(chosenSheet) : 0}
              summary={summary}
              canManageSheets={hasPermission(user, "manage_label_sheets")}
            />

            <PreviewPanel
              ready={resolution.included.length > 0 && !!summary && resolution.included.length <= settings.maxLabelsPerBatch}
              reviewedDigest={draft.reviewedDigest}
              blockedReason={
                resolution.included.length === 0
                  ? "There are no labels to print. Check the filters and the Needs correcting list."
                  : !summary
                    ? "Choose a label sheet first."
                    : resolution.included.length > settings.maxLabelsPerBatch
                      ? "Too many labels for one job."
                      : null
              }
            />
          </>
        )}
      </div>
    </DraftProvider>
  );
}
