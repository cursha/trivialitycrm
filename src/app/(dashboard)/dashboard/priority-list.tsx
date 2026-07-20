import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/lib/ui/status-tones";
import type { PriorityItem } from "@/lib/workspace/priority";

const BUCKET_LABEL: Record<PriorityItem["bucket"], string> = {
  OVERDUE_FOLLOW_UP: "Overdue follow-up",
  DUE_TODAY: "Due today",
  ACTIVE_TRIAL: "Active trial",
  NEWLY_ASSIGNED: "Newly assigned",
  NO_RECENT_ACTIVITY: "No recent activity",
  UPCOMING_FOLLOW_UP: "Upcoming follow-up",
};

const BUCKET_TONE: Record<PriorityItem["bucket"], BadgeTone> = {
  OVERDUE_FOLLOW_UP: "danger",
  DUE_TODAY: "warning",
  ACTIVE_TRIAL: "accent",
  NEWLY_ASSIGNED: "secondary",
  NO_RECENT_ACTIVITY: "neutral",
  UPCOMING_FOLLOW_UP: "focus",
};

function itemCompany(item: PriorityItem): { id: string; name: string } {
  switch (item.bucket) {
    case "OVERDUE_FOLLOW_UP":
    case "DUE_TODAY":
    case "UPCOMING_FOLLOW_UP":
      return { id: item.task.companyId, name: item.task.companyName };
    case "ACTIVE_TRIAL":
    case "NEWLY_ASSIGNED":
    case "NO_RECENT_ACTIVITY":
      return { id: item.company.companyId, name: item.company.companyName };
  }
}

export function PriorityList({ items, limit = 8 }: { items: PriorityItem[]; limit?: number }) {
  const shown = items.slice(0, limit);
  const remaining = items.length - shown.length;

  if (shown.length === 0) {
    return <p className="text-sm text-text-muted">Nothing needs your attention right now.</p>;
  }

  return (
    <div>
      <ol className="space-y-2">
        {shown.map((item, index) => {
          const company = itemCompany(item);
          return (
            <li
              key={`${item.bucket}-${company.id}-${index}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm"
            >
              <Badge tone={BUCKET_TONE[item.bucket]}>{BUCKET_LABEL[item.bucket]}</Badge>
              <Link href={`/companies/${company.id}`} className="font-semibold text-secondary hover:underline">
                {company.name}
              </Link>
            </li>
          );
        })}
      </ol>
      {remaining > 0 && <p className="mt-2 text-xs text-text-muted">{remaining} more on the Pipeline board.</p>}
    </div>
  );
}
