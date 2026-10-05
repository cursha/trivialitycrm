import Link from "next/link";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { MyScoreboard } from "@/components/sales-scoreboard";
import { SALES_TRACK_LABELS } from "@/lib/companies/sales-track";
import { AddToRouteToggle } from "../companies/[id]/route-plan-toggle";
import { getMyDay, type MyDayCompany } from "./queries";
import type { RouteListItem } from "@/lib/route-plan/service";

export const metadata = { title: "My Day — Triviality CRM" };

type Option = { label: string; description: string; href?: string; show: boolean };

function Options({ options }: { options: Option[] }) {
  const visible = options.filter((option) => option.show);
  if (visible.length === 0) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {visible.map((option) =>
        option.href ? (
          <Link key={option.label} href={option.href} className="rounded-lg border border-border-strong p-3 hover:border-accent hover:bg-accent/5">
            <p className="text-sm font-bold text-secondary">{option.label} →</p>
            <p className="mt-0.5 text-xs text-text-muted">{option.description}</p>
          </Link>
        ) : (
          <div key={option.label} className="rounded-lg border border-dashed border-border-strong p-3">
            <p className="text-sm font-bold text-text">{option.label}</p>
            <p className="mt-0.5 text-xs text-text-muted">{option.description}</p>
          </div>
        ),
      )}
    </div>
  );
}

function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1 text-sm text-text">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function CompanyList({
  companies,
  total,
  empty,
  routeToggle,
}: {
  companies: MyDayCompany[];
  total: number;
  empty: string;
  routeToggle?: { canManage: boolean; routes: RouteListItem[] };
}) {
  if (companies.length === 0) return <p className="text-sm text-text-muted">{empty}</p>;
  return (
    <div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {companies.map((company) => (
          <li key={company.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <div>
              <Link href={`/companies/${company.id}`} className="font-semibold text-secondary hover:underline">
                {company.name}
              </Link>
              <span className="text-text-muted">
                {" "}
                · {company.city}, {company.region} · {SALES_TRACK_LABELS[company.salesTrack]}
              </span>
              {company.note && <p className="text-xs text-amber-700">{company.note}</p>}
            </div>
            {routeToggle && (
              <AddToRouteToggle
                compact
                companyId={company.id}
                routes={routeToggle.routes.map((route) => ({ id: route.id, name: route.name, plannedDate: route.plannedDate, isActive: route.isActive, inRoute: false }))}
                canManage={routeToggle.canManage}
              />
            )}
          </li>
        ))}
      </ul>
      {total > companies.length && <p className="mt-1 text-xs text-text-muted">and {total - companies.length} more</p>}
    </div>
  );
}

function Step({
  number,
  title,
  status,
  done,
  open,
  children,
}: {
  number: number;
  title: string;
  status: string;
  done: boolean;
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="group rounded-2xl border border-border-strong bg-surface-raised shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span
          className={clsx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black",
            done ? "bg-emerald-600 text-white" : "bg-accent text-white",
          )}
          aria-hidden="true"
        >
          {done ? <Check size={16} /> : number}
        </span>
        <span className="flex-1">
          <span className="block font-bold text-accent">
            Step {number}: {title}
          </span>
          <span className="block text-sm text-text-muted">{status}</span>
        </span>
        <ChevronDown size={18} className="shrink-0 text-text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-4 border-t border-border p-4">{children}</div>
    </details>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * My Day: the rep's day as the sales process, one expandable step at a
 * time, each showing every way to do that step (filtered to what the rep
 * is allowed to do) and the bars waiting on it. The first step with work
 * left opens automatically.
 */
export default async function MyDayPage() {
  const user = await requireUser();
  const data = await getMyDay(user);

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="My Day" />
        <p className="mt-2 text-text-muted">Your role can&apos;t view leads, so there&apos;s nothing to plan here.</p>
      </div>
    );
  }

  const can = (permission: string) => hasPermission(user, permission);
  const timeFormat = (date: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
  const dateFormat = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: data.timezone, month: "short", day: "numeric" }).format(date);

  const work = {
    info: data.needInfo.total > 0,
    route: (data.readyToVisit?.total ?? 0) > 0,
    follow: data.tasks.total > 0 || data.introduced.total > 0,
    demos: data.demosToday.length > 0,
    trials: data.trials.booked.length + data.trials.live.length > 0,
  };
  const firstOpen = work.info ? 2 : work.route ? 3 : work.follow ? 4 : work.demos ? 5 : work.trials ? 6 : 1;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title="My Day"
        description="Your day, step by step. Open a step to see every way to do it and the bars waiting on it."
      />

      <Step number={1} title="Add new bars" status="Every way to get new bars into the CRM" done={false} open={firstOpen === 1}>
        <p className="text-sm text-text">New bars start at the Target step, assigned to you. Pick whichever way fits:</p>
        <Options
          options={[
            { label: "Quick Add", description: "The Quick Add button at the top of every page: a short form for one bar, without leaving where you are.", show: can("add_leads") },
            { label: "Add a company", description: "The full form, with every field.", href: "/companies/new", show: can("add_leads") },
            { label: "Pub Lead Finder", description: "Find bars and pubs within a distance of an address or another bar.", href: "/leads/pub-radius", show: can("run_pub_lead_finder") },
            { label: "Quick Search", description: "Tick venue types and an area for a plain list of places, no AI scoring.", href: "/leads/searches/quick", show: can("run_research") },
            { label: "AI research search", description: "AI researches and scores bars in a province or state using a research prompt.", href: "/leads/searches/new", show: can("run_research") },
            { label: "Competition Locator", description: "Find bars already running a competitor's trivia night.", href: "/leads/competition-locator", show: can("run_competition_locator") },
            { label: "Spreadsheet import", description: "Upload a CSV or Excel list of bars.", href: "/leads/import", show: can("import_leads") },
            { label: "Review search results", description: "Pick which found bars to bring into the CRM (searches don't add them on their own).", href: "/leads/searches", show: can("review_research_results") },
          ]}
        />
      </Step>

      <Step
        number={2}
        title="Fill in the info"
        status={work.info ? `${plural(data.needInfo.total, "bar")} at Target missing info` : "Your Target bars have their info"}
        done={!work.info}
        open={firstOpen === 2}
      >
        <Checklist
          items={[
            "Manager's name, phone and email: add them as a contact and mark the decision-maker",
            "Trivia history: do they run trivia now, with whom and which night, and have they tried it before (Bar intel card)",
            "Slowest night, typical crowd that night, and current entertainment (Bar intel card)",
            "Local or Long-distance: set it on the Sales process card",
          ]}
        />
        <CompanyList companies={data.needInfo.companies} total={data.needInfo.total} empty="Nothing missing. Nice." />
        <Options
          options={[
            { label: "Your Target bars", description: "Every bar of yours at the Target step, on the pipeline board.", href: "/pipeline", show: true },
            { label: "Companies list", description: "Search and filter all your bars.", href: "/companies", show: true },
          ]}
        />
      </Step>

      <Step
        number={3}
        title="Plan your route and drop off flyers"
        status={`${data.routeCount !== null && data.routeName ? `${plural(data.routeCount, "stop")} on your ${data.routeName} route · ` : ""}${plural(data.visitsToday, "visit")} logged today`}
        done={!work.route && data.visitsToday > 0}
        open={firstOpen === 3}
      >
        <Checklist
          items={[
            "Add Local Target bars to a route (one per day or area, e.g. Mississauga, Milton), then export it to EZRoutePlanner to order the stops",
            "At each bar: drop off the flyer and ask for the owner or manager. Goal: book a ~20-minute demo (or demo on the spot)",
            "Log every visit (Log visit on the company page) so the follow-up is created and the bar moves to Introduced",
          ]}
        />
        {data.readyToVisit && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Local Target bars not on any of your routes yet</p>
            <CompanyList
              companies={data.readyToVisit.companies}
              total={data.readyToVisit.total}
              empty="All your Local Target bars are on a route."
              routeToggle={{ canManage: can("manage_route_plan"), routes: data.routes }}
            />
          </div>
        )}
        <Options
          options={[
            { label: "Route Plan", description: "Switch between your routes, create new ones, review stops and export the CSV for EZRoutePlanner.", href: "/route-plan", show: can("view_route_plan") },
            { label: "Log a visit", description: "Open the bar and tap Log visit (first quick action). Pick what happened: flyer dropped, demo booked, and so on.", show: can("edit_leads") },
          ]}
        />
      </Step>

      <Step
        number={4}
        title="Follow up and book demos"
        status={`${plural(data.tasks.total, "follow-up")} due · ${plural(data.introduced.total, "introduced bar")} to book`}
        done={!work.follow}
        open={firstOpen === 4}
      >
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Follow-ups due today or overdue</p>
          {data.tasks.items.length === 0 ? (
            <p className="text-sm text-text-muted">None due. You&apos;re caught up.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {data.tasks.items.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold text-text">{task.title}</span>
                    {" · "}
                    <Link href={`/companies/${task.company.id}`} className="text-secondary hover:underline">
                      {task.company.name}
                    </Link>
                  </span>
                  {task.overdue ? <Badge tone="danger">Overdue · {dateFormat(task.dueAt)}</Badge> : <Badge tone="neutral">Today</Badge>}
                </li>
              ))}
            </ul>
          )}
          {data.tasks.total > data.tasks.items.length && <p className="text-xs text-text-muted">and {data.tasks.total - data.tasks.items.length} more</p>}
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Introduced bars: book the demo</p>
          <CompanyList companies={data.introduced.companies} total={data.introduced.total} empty="No introduced bars waiting." />
        </div>
        <Options
          options={[
            { label: "All follow-ups", description: "Everything on your list, with done and reschedule.", href: "/follow-ups", show: true },
            { label: "Calling session", description: "Work through a calling list one bar at a time.", href: "/calling-sessions", show: can("use_calling_lists") },
            { label: "Book a demo", description: "On the bar's page: Log visit → Demo Booked, or the Appointments card. Long-distance bars can skip to a trial.", show: can("edit_leads") },
          ]}
        />
      </Step>

      <Step
        number={5}
        title="Run today's demos"
        status={work.demos ? `${plural(data.demosToday.length, "demo")} today` : "No demos today"}
        done={!work.demos}
        open={firstOpen === 5}
      >
        {data.demosToday.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.demosToday.map((demo) => (
              <li key={demo.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <Link href={`/companies/${demo.company.id}`} className="font-semibold text-secondary hover:underline">
                  {demo.company.name}
                </Link>
                <Badge tone="accent">{timeFormat(demo.startAt, data.timezone)}</Badge>
              </li>
            ))}
          </ul>
        )}
        <Checklist
          items={[
            "Confirm it the day before",
            "About 20 minutes: on the bar's own TVs (Local) or over a video call (Long-distance)",
            "End with the trial ask, then move the bar to Demo Held or Trial Booked on its Sales process card",
          ]}
        />
      </Step>

      <Step
        number={6}
        title="Look after your trials"
        status={`${plural(data.trials.booked.length, "trial")} booked · ${plural(data.trials.live.length, "trial")} live`}
        done={!work.trials}
        open={firstOpen === 6}
      >
        <Checklist
          items={[
            "Trial Booked: name the champion, agree which nights they'll run it, today's headcount, the target and the price, and get them connected online",
            "Trial Live: night 1 support, week-2 check-in, week-3 early-yes ask, conversion meeting or call before the trial ends (your follow-ups have the dates)",
          ]}
        />
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Trial Booked</p>
          <CompanyList companies={data.trials.booked} total={data.trials.booked.length} empty="None booked." />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Trial Live</p>
          <CompanyList companies={data.trials.live} total={data.trials.live.length} empty="None live." />
        </div>
      </Step>

      <Step number={7} title="Check your scoreboard" status="How today is going against your goals" done={false} open={false}>
        {data.score ? <MyScoreboard score={data.score} /> : <p className="text-sm text-text-muted">No scoreboard for your role.</p>}
      </Step>
    </div>
  );
}
