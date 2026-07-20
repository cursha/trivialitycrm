"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select, Input, Label } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { REPORT_DATE_RANGE_KEYS } from "@/lib/reports/date-range-keys";

type Option = { id: string; name: string };

const DATE_RANGE_LABELS: Record<string, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  custom: "Custom",
};

/**
 * One shared filter bar for every /reports/* page, driven entirely by URL
 * search params (server components re-read and re-validate them on every
 * render via parseReportFilters — this component never trusts its own
 * client-side state as the source of truth). Each page passes only the
 * option lists relevant to it; a field with no options prop is simply not
 * rendered, so a page never shows a filter it doesn't apply.
 */
export function ReportFilterBar({
  leadTypes,
  pipelineStages,
  salespeople,
  competitors,
  territories,
  showSource,
  showOutcome,
  showStatus,
  showTriviaStatus,
  showScoreRange,
}: {
  leadTypes?: Option[];
  pipelineStages?: Option[];
  salespeople?: Option[];
  competitors?: Option[];
  territories?: Option[];
  showSource?: boolean;
  showOutcome?: boolean;
  showStatus?: boolean;
  showTriviaStatus?: boolean;
  showScoreRange?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  const dateRange = searchParams.get("dateRange") ?? "month";
  const selectClass = "w-auto";

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Date range</Label>
          <Select
            className={selectClass}
            value={dateRange}
            onChange={(event) => updateParam("dateRange", event.target.value)}
          >
            {REPORT_DATE_RANGE_KEYS.map((key) => (
              <option key={key} value={key}>
                {DATE_RANGE_LABELS[key]}
              </option>
            ))}
          </Select>
        </div>

        {dateRange === "custom" && (
          <>
            <div>
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                className={selectClass}
                defaultValue={searchParams.get("customFrom") ?? ""}
                onChange={(event) => updateParam("customFrom", event.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                className={selectClass}
                defaultValue={searchParams.get("customTo") ?? ""}
                onChange={(event) => updateParam("customTo", event.target.value)}
              />
            </div>
          </>
        )}

        {territories && (
          <div>
            <Label className="text-xs">Territory</Label>
            <Select
              className={selectClass}
              defaultValue={searchParams.get("territoryId") ?? ""}
              onChange={(event) => updateParam("territoryId", event.target.value)}
            >
              <option value="">All territories</option>
              {territories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {leadTypes && (
          <div>
            <Label className="text-xs">Lead type</Label>
            <Select
              className={selectClass}
              defaultValue={searchParams.get("leadTypeId") ?? ""}
              onChange={(event) => updateParam("leadTypeId", event.target.value)}
            >
              <option value="">All lead types</option>
              {leadTypes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {pipelineStages && (
          <div>
            <Label className="text-xs">Pipeline stage</Label>
            <Select
              className={selectClass}
              defaultValue={searchParams.get("pipelineStageId") ?? ""}
              onChange={(event) => updateParam("pipelineStageId", event.target.value)}
            >
              <option value="">All stages</option>
              {pipelineStages.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {salespeople && (
          <div>
            <Label className="text-xs">Salesperson</Label>
            <Select
              className={selectClass}
              defaultValue={searchParams.get("assignedToId") ?? ""}
              onChange={(event) => updateParam("assignedToId", event.target.value)}
            >
              <option value="">All salespeople</option>
              {salespeople.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {competitors && (
          <div>
            <Label className="text-xs">Competitor</Label>
            <Select
              className={selectClass}
              defaultValue={searchParams.get("competitorId") ?? ""}
              onChange={(event) => updateParam("competitorId", event.target.value)}
            >
              <option value="">All competitors</option>
              {competitors.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {showSource && (
          <div>
            <Label className="text-xs">Source</Label>
            <Select
              className={selectClass}
              defaultValue={searchParams.get("source") ?? ""}
              onChange={(event) => updateParam("source", event.target.value)}
            >
              <option value="">All sources</option>
              <option value="MANUAL">Manual</option>
              <option value="AI_RESEARCH">AI Research</option>
              <option value="IMPORT">Import</option>
            </Select>
          </div>
        )}

        {showOutcome && (
          <div>
            <Label className="text-xs">Outcome</Label>
            <Select
              className={selectClass}
              defaultValue={searchParams.get("outcome") ?? ""}
              onChange={(event) => updateParam("outcome", event.target.value)}
            >
              <option value="">Won &amp; lost</option>
              <option value="WON">Won</option>
              <option value="LOST">Lost</option>
            </Select>
          </div>
        )}

        {showStatus && (
          <div>
            <Label className="text-xs">Status</Label>
            <Select
              className={selectClass}
              defaultValue={searchParams.get("status") ?? ""}
              onChange={(event) => updateParam("status", event.target.value)}
            >
              <option value="">Active &amp; archived</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </div>
        )}

        {showTriviaStatus && (
          <div>
            <Label className="text-xs">Trivia status</Label>
            <Select
              className={selectClass}
              defaultValue={searchParams.get("triviaStatus") ?? ""}
              onChange={(event) => updateParam("triviaStatus", event.target.value)}
            >
              <option value="">Any</option>
              <option value="CURRENT_TRIVIA">Current Trivia</option>
              <option value="NO_CURRENT_TRIVIA">No Current Trivia</option>
              <option value="UNCERTAIN">Uncertain</option>
            </Select>
          </div>
        )}

        {showScoreRange && (
          <>
            <div>
              <Label className="text-xs">Score min</Label>
              <Input
                type="number"
                min={0}
                max={100}
                className="w-20"
                defaultValue={searchParams.get("scoreMin") ?? ""}
                onChange={(event) => updateParam("scoreMin", event.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Score max</Label>
              <Input
                type="number"
                min={0}
                max={100}
                className="w-20"
                defaultValue={searchParams.get("scoreMax") ?? ""}
                onChange={(event) => updateParam("scoreMax", event.target.value)}
              />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
