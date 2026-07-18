"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";

type Option = { id: string; name: string };

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

  const selectClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500";

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <input
        type="search"
        placeholder="Search by name, city, email or phone"
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(event) => updateParam("q", event.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      />
      <div className="flex flex-wrap gap-2">
        <select
          className={selectClass}
          defaultValue={searchParams.get("leadTypeId") ?? ""}
          onChange={(event) => updateParam("leadTypeId", event.target.value)}
        >
          <option value="">All Lead Types</option>
          {leadTypes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          defaultValue={searchParams.get("pipelineStageId") ?? ""}
          onChange={(event) => updateParam("pipelineStageId", event.target.value)}
        >
          <option value="">All Pipeline Stages</option>
          {pipelineStages.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          defaultValue={searchParams.get("assignedToId") ?? ""}
          onChange={(event) => updateParam("assignedToId", event.target.value)}
        >
          <option value="">All Salespeople</option>
          {salespeople.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          defaultValue={searchParams.get("competitorId") ?? ""}
          onChange={(event) => updateParam("competitorId", event.target.value)}
        >
          <option value="">All Competitors</option>
          {competitors.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          defaultValue={searchParams.get("triviaStatus") ?? ""}
          onChange={(event) => updateParam("triviaStatus", event.target.value)}
        >
          <option value="">Any Trivia Status</option>
          <option value="CURRENT_TRIVIA">Current Trivia</option>
          <option value="NO_CURRENT_TRIVIA">No Current Trivia</option>
          <option value="UNCERTAIN">Uncertain</option>
        </select>
        <select
          className={selectClass}
          defaultValue={searchParams.get("followUp") ?? ""}
          onChange={(event) => updateParam("followUp", event.target.value)}
        >
          <option value="">Any Follow-up</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="upcoming">Upcoming</option>
          <option value="none">No follow-up set</option>
        </select>
        <select
          className={selectClass}
          defaultValue={searchParams.get("opportunityGrade") ?? ""}
          onChange={(event) => updateParam("opportunityGrade", event.target.value)}
        >
          <option value="">Any Grade</option>
          <option value="A_PLUS">A+</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
        </select>
        <select
          className={selectClass}
          defaultValue={searchParams.get("confidenceLevel") ?? ""}
          onChange={(event) => updateParam("confidenceLevel", event.target.value)}
        >
          <option value="">Any Confidence</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <select
          className={selectClass}
          defaultValue={searchParams.get("primaryClassification") ?? ""}
          onChange={(event) => updateParam("primaryClassification", event.target.value)}
        >
          <option value="">Any Classification</option>
          <option value="ENTERTAINMENT_READY">Entertainment-Ready</option>
          <option value="GREENFIELD">Greenfield</option>
          <option value="REPLACEMENT">Replacement</option>
          <option value="NEEDS_QUALIFICATION">Needs Qualification</option>
          <option value="EXISTING_CUSTOMER">Existing Customer</option>
        </select>
        <select
          className={selectClass}
          defaultValue={searchParams.get("sortBy") ?? "name"}
          onChange={(event) => updateParam("sortBy", event.target.value)}
        >
          <option value="name">Sort: Name</option>
          <option value="city">Sort: City</option>
          <option value="nextFollowUpAt">Sort: Follow-up date</option>
          <option value="eosScore">Sort: EOS score</option>
          <option value="createdAt">Sort: Created</option>
        </select>
        <select
          className={selectClass}
          defaultValue={searchParams.get("sortDir") ?? "asc"}
          onChange={(event) => updateParam("sortDir", event.target.value)}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>
    </div>
  );
}
