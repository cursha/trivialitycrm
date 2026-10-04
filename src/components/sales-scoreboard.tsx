import clsx from "clsx";
import { Card, SectionHeading } from "@/components/ui/card";
import { SCOREBOARD_LABELS, SCOREBOARD_METRICS, type RepScore, type ScoreboardMetric } from "@/lib/sales/scoreboard";

/** Metrics worth showing for a rep: anything with a goal, plus anything
 * they actually did (e.g. a local rep who also made a long-distance intro). */
function visibleMetrics(score: RepScore): ScoreboardMetric[] {
  return SCOREBOARD_METRICS.filter((metric) => score.targets[metric] > 0 || score.today[metric] > 0 || score.week[metric] > 0);
}

/** The rep's own scoreboard for today, on the Dashboard. */
export function MyScoreboard({ score }: { score: RepScore }) {
  const metrics = visibleMetrics(score);
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading>Today&apos;s scoreboard</SectionHeading>
        <p className="text-xs text-text-muted">Goals set by your manager · {score.timezone}</p>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map((metric) => {
          const done = score.today[metric];
          const goal = score.targets[metric];
          const hit = goal > 0 && done >= goal;
          return (
            <div key={metric}>
              <p className="text-sm font-semibold text-text-muted">{SCOREBOARD_LABELS[metric]}</p>
              <p className={clsx("mt-1 text-3xl font-bold", hit ? "text-emerald-700" : "text-text")}>
                {done}
                {goal > 0 && <span className="text-lg font-semibold text-text-muted"> / {goal}</span>}
              </p>
              {goal > 0 && (
                <div className="mt-2 h-1.5 rounded-full bg-black/10" aria-hidden="true">
                  <div className={clsx("h-1.5 rounded-full", hit ? "bg-emerald-600" : "bg-accent")} style={{ width: `${Math.min(100, (done / goal) * 100)}%` }} />
                </div>
              )}
              <p className="mt-1 text-xs text-text-muted">This week: {score.week[metric]}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Every rep's numbers, on the Manager page: today against the daily goal,
 * and this week's total. */
export function TeamScoreboard({ scores }: { scores: RepScore[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-3 w-full min-w-[40rem] text-left text-sm">
        <thead className="text-xs uppercase text-text-muted">
          <tr>
            <th className="py-2 pr-3">Rep</th>
            {SCOREBOARD_METRICS.map((metric) => (
              <th key={metric} className="py-2 pr-3">
                {SCOREBOARD_LABELS[metric]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scores.map((score) => (
            <tr key={score.userId} className="border-t border-border align-top">
              <td className="py-2 pr-3">
                <p className="font-semibold text-text">{score.name}</p>
                <p className="text-xs text-text-muted">{score.timezone}</p>
              </td>
              {SCOREBOARD_METRICS.map((metric) => {
                const done = score.today[metric];
                const goal = score.targets[metric];
                return (
                  <td key={metric} className="py-2 pr-3">
                    <span className={clsx("font-semibold", goal > 0 && done >= goal ? "text-emerald-700" : "text-text")}>
                      {done}
                      {goal > 0 && <span className="font-normal text-text-muted"> / {goal}</span>}
                    </span>
                    <p className="text-xs text-text-muted">Week: {score.week[metric]}</p>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
