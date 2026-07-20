import Link from "next/link";
import clsx from "clsx";
import { PIPELINE_VIEWS, isViewVisible, type PipelineViewKey } from "./queries";

export function ViewTabs({
  active,
  canSeeBeyondOwn,
  queryString,
}: {
  active: PipelineViewKey;
  canSeeBeyondOwn: boolean;
  queryString: string;
}) {
  const visible = PIPELINE_VIEWS.filter((v) => isViewVisible(v.key, canSeeBeyondOwn));

  return (
    <div className="flex flex-wrap gap-2 border-b border-border pb-2">
      {visible.map((view) => {
        const params = new URLSearchParams(queryString);
        params.set("view", view.key);
        return (
          <Link
            key={view.key}
            href={`/pipeline?${params.toString()}`}
            className={clsx(
              "rounded-full px-3 py-1.5 text-xs font-semibold",
              active === view.key ? "bg-secondary text-white" : "bg-black/5 text-text-muted hover:bg-black/10",
            )}
          >
            {view.label}
          </Link>
        );
      })}
    </div>
  );
}
