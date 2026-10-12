import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { parseReportFilters } from "@/lib/reports/filters";
import { Card, SectionHeading } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { userCode } from "@/lib/ui/user-code";
import { getAiSpendReport, AI_SPEND_CALLS_PAGE_SIZE } from "./queries";
import { getReportFilterOptions, rawFiltersFromParams } from "../filter-options";
import { ReportFilterBar } from "../report-filter-bar";
import { ExportLinks } from "../export-links";
import { StatTile } from "../report-ui";

export const metadata = { title: "AI Spend — Triviality CRM" };

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function usd(value: number, decimals = 2): string {
  return `$${value.toFixed(decimals)}`;
}

const dateTime = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" });

/** A spend breakdown as one table: label, calls, cost and share, with a bar
 * under each label like the other report breakdowns. */
function SpendBreakdown({ title, rows, emptyLabel }: { title: string; rows: { label: string; costUsd: number; calls: number; href?: string }[]; emptyLabel: string }) {
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0);
  return (
    <Card>
      <SectionHeading>{title}</SectionHeading>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">{emptyLabel}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                <th scope="col" className="pb-2"></th>
                <th scope="col" className="pb-2 text-right">
                  Calls
                </th>
                <th scope="col" className="pb-2 text-right">
                  Cost
                </th>
                <th scope="col" className="pb-2 text-right">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pct = total > 0 ? Math.round((row.costUsd / total) * 100) : 0;
                return (
                  <tr key={row.href ?? row.label} className="border-t border-border/40">
                    <td className="py-2 pr-2">
                      {row.href ? (
                        <Link href={row.href} className="font-medium text-secondary hover:underline">
                          {row.label}
                        </Link>
                      ) : (
                        <span className="font-medium text-text">{row.label}</span>
                      )}
                      <div className="mt-1 h-1.5 w-full rounded-full bg-border/40">
                        <div className="h-1.5 rounded-full bg-secondary" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="py-2 pl-3 text-right text-text-muted">{row.calls.toLocaleString()}</td>
                    <td className="py-2 pl-3 text-right font-semibold text-text">{usd(row.costUsd)}</td>
                    <td className="py-2 pl-3 text-right text-text-muted">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default async function AiSpendReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;

  const filters = parseReportFilters(rawFiltersFromParams(params));
  const page = Number(toSingle(params.page)) || 1;
  const [options, report] = await Promise.all([getReportFilterOptions(), getAiSpendReport(user, filters, page)]);
  if (!report) {
    return (
      <p className="text-text-muted">
        You do not have the &quot;View AI research cost estimates&quot; permission — ask an Administrator for access.
      </p>
    );
  }

  const canExport = hasPermission(user, "export_reports");

  function pageHref(targetPage: number) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const single = toSingle(value);
      if (single && key !== "page") query.set(key, single);
    }
    query.set("page", String(targetPage));
    return `/reports/ai-spend?${query.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportFilterBar salespeople={options.salespeople} />
        {canExport && <ExportLinks reportKey="ai-spend" />}
      </div>

      <p className="text-sm text-text-muted">
        Every AI call the CRM made, priced at the provider&apos;s published rates when the call returned. These are <strong>estimates</strong>, in US dollars — your
        actual bill is in the Anthropic Console under Billing. Hosting (Railway) is billed separately and isn&apos;t included.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Estimated AI spend" value={usd(report.totalUsd)} />
        <StatTile label="AI calls" value={report.callCount.toLocaleString()} />
        <StatTile label="Average per call" value={report.callCount > 0 ? usd(report.totalUsd / report.callCount, 4) : "—"} />
        <StatTile label="Tokens used" value={(report.inputTokens + report.outputTokens + report.cacheTokens).toLocaleString()} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SpendBreakdown title="By feature" rows={report.byOperation} emptyLabel="No AI calls in this range." />
        <SpendBreakdown title="By person" rows={report.byUser} emptyLabel="No AI calls in this range." />
        <SpendBreakdown title="Most expensive lead searches" rows={report.topSearches} emptyLabel="No lead searches used AI in this range." />
        <SpendBreakdown title="By AI model" rows={report.byModel} emptyLabel="No AI calls in this range." />
      </div>

      <Card>
        <SectionHeading>Spend per {report.period}</SectionHeading>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Spend per {report.period}</caption>
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                <th scope="col" className="pb-2">
                  {report.period === "day" ? "Day" : "Month"}
                </th>
                <th scope="col" className="pb-2 text-right">
                  Calls
                </th>
                <th scope="col" className="pb-2 text-right">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const max = Math.max(0, ...report.timeline.map((row) => row.costUsd));
                return report.timeline.map((row) => (
                  <tr key={row.label} className="border-t border-border/40">
                    <td className="py-1.5 pr-2">
                      <span className="font-medium text-text">{row.label}</span>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-border/40">
                        <div className="h-1.5 rounded-full bg-secondary" style={{ width: `${max > 0 ? Math.round((row.costUsd / max) * 100) : 0}%` }} />
                      </div>
                    </td>
                    <td className="py-1.5 pl-3 text-right text-text-muted">{row.calls.toLocaleString()}</td>
                    <td className={row.costUsd > 0 ? "py-1.5 pl-3 text-right font-semibold text-text" : "py-1.5 pl-3 text-right text-text-muted"}>{usd(row.costUsd)}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="p-4 pb-0">
          <SectionHeading>Every AI call</SectionHeading>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-black/5 text-xs uppercase text-text-muted">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Feature</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3 text-right">Tokens in / out</th>
                <th className="px-4 py-3 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {report.calls.map((call) => (
                <tr key={call.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-4 py-2">{dateTime.format(call.createdAt)}</td>
                  <td className="px-4 py-2">
                    {call.searchId ? (
                      <Link href={`/leads/searches/${call.searchId}`} className="text-secondary hover:underline">
                        {call.operation}
                      </Link>
                    ) : (
                      call.operation
                    )}
                  </td>
                  <td className="px-4 py-2">{call.user ? <span title={call.user.name}>{userCode(call.user)}</span> : <span className="text-text-muted">System</span>}</td>
                  <td className="px-4 py-2 text-text-muted">{call.model}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-text-muted">
                    {call.inputTokens.toLocaleString()} / {call.outputTokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">{usd(call.costUsd, 4)}</td>
                </tr>
              ))}
              {report.calls.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-text-muted">
                    No AI calls in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Pagination page={report.page} pageCount={report.pageCount} pageSize={AI_SPEND_CALLS_PAGE_SIZE} hrefFor={pageHref} />
    </div>
  );
}
