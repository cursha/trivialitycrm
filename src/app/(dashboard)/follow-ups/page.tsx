import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import {
  listOverdueTasks,
  listDueTodayTasks,
  listUpcomingTasks,
  listCompletedTasks,
  listCompaniesWithoutFollowUp,
} from "./queries";

export const metadata = { title: "Follow-Ups — Triviality CRM" };

const VIEWS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
  { key: "none", label: "No follow-up" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const view = (VIEWS.find((v) => v.key === toSingle(params.view))?.key ?? "overdue") as ViewKey;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Follow-Ups</h1>
        <p className="mt-1 text-slate-500">Due, upcoming, completed, overdue, and companies with nothing scheduled.</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/follow-ups?view=${v.key}`}
            className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
              view === v.key ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>

      {view === "none" ? <NoFollowUpView user={user} /> : <TaskView user={user} view={view} />}
    </div>
  );
}

async function TaskView({ user, view }: { user: Awaited<ReturnType<typeof requireUser>>; view: Exclude<ViewKey, "none"> }) {
  const tasks =
    view === "overdue"
      ? await listOverdueTasks(user)
      : view === "today"
        ? await listDueTodayTasks(user)
        : view === "upcoming"
          ? await listUpcomingTasks(user)
          : await listCompletedTasks(user);

  if (tasks.length === 0) {
    return <p className="py-8 text-center text-slate-500">Nothing here.</p>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-5 py-3">Company</th>
            <th className="px-5 py-3">Follow-up</th>
            <th className="px-5 py-3">Assigned to</th>
            <th className="px-5 py-3">{view === "completed" ? "Completed" : "Due"}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-t border-slate-100 hover:bg-blue-50/40">
              <td className="px-5 py-4">
                <Link href={`/companies/${task.company.id}`} className="font-bold text-blue-600 hover:underline">
                  {task.company.name}
                </Link>
              </td>
              <td className="px-5 py-4">{task.title}</td>
              <td className="px-5 py-4">{task.assignedTo.name}</td>
              <td className="px-5 py-4">
                {view === "completed"
                  ? task.completedAt && new Date(task.completedAt).toLocaleDateString()
                  : new Date(task.dueAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function NoFollowUpView({ user }: { user: Awaited<ReturnType<typeof requireUser>> }) {
  const companies = await listCompaniesWithoutFollowUp(user);

  if (companies.length === 0) {
    return <p className="py-8 text-center text-slate-500">Every company has an open follow-up scheduled.</p>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-5 py-3">Company</th>
            <th className="px-5 py-3">Assigned to</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.id} className="border-t border-slate-100 hover:bg-blue-50/40">
              <td className="px-5 py-4">
                <Link href={`/companies/${company.id}`} className="font-bold text-blue-600 hover:underline">
                  {company.name}
                </Link>
                <div className="text-xs text-slate-500">
                  {company.city}, {company.region}
                </div>
              </td>
              <td className="px-5 py-4">{company.assignedTo.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
