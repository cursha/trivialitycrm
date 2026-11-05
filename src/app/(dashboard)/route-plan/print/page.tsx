import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { getRouteSheet } from "@/lib/route-plan/service";
import { formatRouteDate, googleMapsHref } from "@/lib/route-plan/format";
import { ACTIVITY_TYPE_LABELS } from "@/lib/activities/labels";
import { formatDueDate } from "@/lib/dates";
import { BUSINESS_TIMEZONE } from "@/lib/timezone";
import { buttonClasses } from "@/components/ui/button";
import { PrintButton } from "./print-button";

export const metadata = { title: "Route Sheet — Triviality CRM" };

function formatTouchDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE, month: "short", day: "numeric", year: "numeric" }).format(value);
}

/**
 * Printable sheet of every company on the current route — one block per
 * stop with phone, contact, stage, last touch and room to write notes at the
 * door. The sidebar and header are hidden when printing (see
 * dashboard-shell.tsx).
 */
export default async function RouteSheetPage() {
  const user = await requireUser();
  requirePermission(user, "view_route_plan");
  const { route, companies } = await getRouteSheet(user);
  const day = formatRouteDate(route.plannedDate);
  const printedOn = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE, dateStyle: "medium" }).format(new Date());

  return (
    <div className="mx-auto max-w-4xl space-y-6 print:max-w-none print:space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/route-plan" className={buttonClasses("ghost")}>
          Back to Route Plan
        </Link>
        {companies.length > 0 && <PrintButton />}
        <p className="text-sm text-text-muted">Showing your current route. To print a different one, pick it on the Route Plan page first.</p>
      </div>

      <header className="border-b-2 border-text pb-3">
        <h1 className="text-2xl font-bold text-text">
          Route sheet: {route.name ?? "No route selected"}
          {day && <span className="font-normal"> · {day}</span>}
        </h1>
        <p className="mt-1 text-sm text-text-muted print:text-black">
          {user.name} · {companies.length} stop{companies.length === 1 ? "" : "s"}
          {route.leadTypeName ? ` · ${route.leadTypeName}` : ""} · Printed {printedOn}
        </p>
      </header>

      {companies.length === 0 ? (
        <p className="text-sm text-text-muted">This route has no companies on it yet.</p>
      ) : (
        <ol className="space-y-4 print:space-y-3">
          {companies.map((company, index) => (
            <li key={company.id} className="break-inside-avoid rounded-lg border border-border-strong p-4 print:rounded-none print:border-black print:p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-lg font-bold text-text">
                  {index + 1}. {company.name}
                </h2>
                <span className="text-sm font-semibold text-text-muted print:text-black">{company.stageName}</span>
              </div>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 print:grid-cols-2">
                <div>
                  <dt className="inline font-semibold">Address: </dt>
                  <dd className="inline">
                    {company.formattedAddress || "No address on file"}
                    {googleMapsHref(company.name, company.formattedAddress) && (
                      <a
                        href={googleMapsHref(company.name, company.formattedAddress)!}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="ml-2 font-semibold text-secondary hover:underline print:hidden"
                      >
                        Map
                      </a>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Phone: </dt>
                  <dd className="inline">{company.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Contact: </dt>
                  <dd className="inline">
                    {company.contact
                      ? [company.contact.name, company.contact.title, company.contact.phone].filter(Boolean).join(" · ")
                      : "—"}
                    {company.contact?.bestTimeToReach && <> (best: {company.contact.bestTimeToReach})</>}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Last touch: </dt>
                  <dd className="inline">
                    {company.lastTouch
                      ? `${ACTIVITY_TYPE_LABELS[company.lastTouch.type] ?? company.lastTouch.type}, ${formatTouchDate(company.lastTouch.occurredAt)}`
                      : "None yet"}
                  </dd>
                </div>
                {company.nextFollowUpAt && (
                  <div>
                    <dt className="inline font-semibold">Follow-up due: </dt>
                    <dd className="inline">{formatDueDate(company.nextFollowUpAt, { month: "short", day: "numeric", year: "numeric" })}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-3 text-sm">
                <p className="font-semibold">Notes:</p>
                <div className="mt-1 h-16 border-b border-dashed border-border-strong print:border-black" aria-hidden="true" />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
