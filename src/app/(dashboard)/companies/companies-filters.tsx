"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { Input, Select } from "@/components/ui/field";
import { Card } from "@/components/ui/card";

type Option = { id: string; name: string };

/** A filter that's narrowing the list gets a blue ring and bold text, so
 * it's obvious at a glance which ones are on (Curt's call). A ring, not a
 * border or background, so it doesn't fight the control's own classes. */
const ACTIVE_FILTER_CLASS = "font-semibold ring-2 ring-secondary";

export function CompaniesFilters({
  leadTypes,
  pipelineStages,
  salespeople,
  competitors,
}: {
  leadTypes: Option[];
  pipelineStages: Option[];
  salespeople: Option[];
  competitors: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Any filter change resets pagination back to page 1.
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  /** Classes for a filter control: highlighted when its value isn't the
   * one that shows everything. */
  function filterClass(key: string, showAllValue = "") {
    const value = searchParams.get(key) ?? showAllValue;
    return clsx("w-auto", value !== showAllValue && ACTIVE_FILTER_CLASS);
  }

  return (
    <Card className="space-y-3">
      <Input
        type="search"
        className={clsx(searchParams.get("q") && ACTIVE_FILTER_CLASS)}
        placeholder="Search by name, city, email or phone"
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(event) => updateParam("q", event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Select
          className={filterClass("leadTypeId")}
          defaultValue={searchParams.get("leadTypeId") ?? ""}
          onChange={(event) => updateParam("leadTypeId", event.target.value)}
        >
          <option value="">All Lead Types</option>
          {leadTypes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
        <Select
          className={filterClass("pipelineStageId")}
          defaultValue={searchParams.get("pipelineStageId") ?? ""}
          onChange={(event) => updateParam("pipelineStageId", event.target.value)}
        >
          <option value="">All Pipeline Stages</option>
          {pipelineStages.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
        <Select
          className={filterClass("assignedToId")}
          defaultValue={searchParams.get("assignedToId") ?? ""}
          onChange={(event) => updateParam("assignedToId", event.target.value)}
        >
          <option value="">All Salespeople</option>
          {salespeople.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
        <Select
          className={filterClass("competitorId")}
          defaultValue={searchParams.get("competitorId") ?? ""}
          onChange={(event) => updateParam("competitorId", event.target.value)}
        >
          <option value="">All Competitors</option>
          {competitors.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
        <Select
          className={filterClass("triviaStatus")}
          defaultValue={searchParams.get("triviaStatus") ?? ""}
          onChange={(event) => updateParam("triviaStatus", event.target.value)}
        >
          <option value="">Any Trivia Status</option>
          <option value="CURRENT_TRIVIA">Current Trivia</option>
          <option value="NO_CURRENT_TRIVIA">No Current Trivia</option>
          <option value="UNCERTAIN">Uncertain</option>
        </Select>
        <Select
          className={filterClass("followUp")}
          defaultValue={searchParams.get("followUp") ?? ""}
          onChange={(event) => updateParam("followUp", event.target.value)}
        >
          <option value="">Any Follow-up</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="upcoming">Upcoming</option>
          <option value="none">No follow-up set</option>
        </Select>
        <Select
          className={filterClass("opportunityGrade")}
          defaultValue={searchParams.get("opportunityGrade") ?? ""}
          onChange={(event) => updateParam("opportunityGrade", event.target.value)}
        >
          <option value="">Any Grade</option>
          <option value="A_PLUS">A+</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
        </Select>
        <Select className={filterClass("sweetSpot")} defaultValue={searchParams.get("sweetSpot") ?? ""} onChange={(event) => updateParam("sweetSpot", event.target.value)}>
          <option value="">Any likelihood</option>
          <option value="1">Sweet spot only</option>
        </Select>
        <Select
          className={filterClass("confidenceLevel")}
          defaultValue={searchParams.get("confidenceLevel") ?? ""}
          onChange={(event) => updateParam("confidenceLevel", event.target.value)}
        >
          <option value="">Any Confidence</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </Select>
        <Select
          className={filterClass("primaryClassification")}
          defaultValue={searchParams.get("primaryClassification") ?? ""}
          onChange={(event) => updateParam("primaryClassification", event.target.value)}
        >
          <option value="">Any Classification</option>
          <option value="ENTERTAINMENT_READY">Entertainment-Ready</option>
          <option value="GREENFIELD">Greenfield</option>
          <option value="REPLACEMENT">Replacement</option>
          <option value="NEEDS_QUALIFICATION">Needs Qualification</option>
          <option value="EXISTING_CUSTOMER">Existing Customer</option>
        </Select>
        <Select
          className="w-auto"
          defaultValue={searchParams.get("sortBy") ?? "name"}
          onChange={(event) => updateParam("sortBy", event.target.value)}
        >
          <option value="name">Sort: Name</option>
          <option value="city">Sort: City</option>
          <option value="nextFollowUpAt">Sort: Follow-up date</option>
          <option value="eosScore">Sort: EOS score</option>
          <option value="createdAt">Sort: Created</option>
        </Select>
        <Select
          className="w-auto"
          defaultValue={searchParams.get("sortDir") ?? "asc"}
          onChange={(event) => updateParam("sortDir", event.target.value)}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </Select>
        <Select
          className={filterClass("status", "ACTIVE")}
          defaultValue={searchParams.get("status") ?? "ACTIVE"}
          onChange={(event) => updateParam("status", event.target.value)}
        >
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </Select>
      </div>
    </Card>
  );
}
