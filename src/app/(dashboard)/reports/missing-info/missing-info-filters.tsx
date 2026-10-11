"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { Input, Select } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { CountrySelect } from "@/components/country-select";
import { MISSING_FIELDS, MISSING_FIELD_LABEL, type MissingField } from "@/lib/data-quality/missing-info-fields";

type Option = { id: string; name: string };

/** Same highlight the Companies filters use for a filter that's switched on. */
const ACTIVE_FILTER_CLASS = "font-semibold ring-2 ring-primary bg-primary/10!";

export function MissingInfoFilters({
  leadTypes,
  pipelineStages,
  salespeople,
  fields,
  counts,
}: {
  leadTypes: Option[];
  pipelineStages: Option[];
  salespeople: Option[];
  /** The ticked missing-field checkboxes. */
  fields: MissingField[];
  /** How many filtered locations are missing each field. */
  counts: Record<MissingField, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    // Any filter change goes back to page 1.
    params.delete("page");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function toggleField(field: MissingField) {
    const next = fields.includes(field) ? fields.filter((f) => f !== field) : MISSING_FIELDS.filter((f) => f === field || fields.includes(f));
    // All four ticked is the default, so it needs no parameter.
    updateParam("missing", next.length === MISSING_FIELDS.length ? "" : next.join(","));
  }

  function filterClass(key: string, showAllValue = "") {
    return clsx("w-auto", (searchParams.get(key) ?? showAllValue) !== showAllValue && ACTIVE_FILTER_CLASS);
  }

  return (
    <Card className="space-y-3">
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <legend className="mb-2 text-sm font-bold text-accent">Show locations missing any of:</legend>
        {MISSING_FIELDS.map((field) => {
          const checked = fields.includes(field);
          return (
            <label
              key={field}
              className={clsx(
                "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
                checked ? "border-danger bg-danger/10 font-semibold text-text" : "border-border-strong text-text-muted",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                // At least one field must stay ticked, or there's nothing to look for.
                disabled={checked && fields.length === 1}
                onChange={() => toggleField(field)}
              />
              {MISSING_FIELD_LABEL[field]}
              <span className="text-xs text-text-muted">({counts[field].toLocaleString()})</span>
            </label>
          );
        })}
      </fieldset>
      <Input
        type="search"
        className={clsx(searchParams.get("q") && ACTIVE_FILTER_CLASS)}
        placeholder="Search by name, city, email or phone"
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(event) => updateParam("q", event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <CountrySelect
          aria-label="Country"
          emptyLabel="Any country"
          className={filterClass("country")}
          defaultValue={searchParams.get("country")}
          onChange={(event) => updateParam("country", event.target.value)}
        />
        <Input
          className={clsx("w-36", searchParams.get("region") && ACTIVE_FILTER_CLASS)}
          placeholder="State/Province"
          defaultValue={searchParams.get("region") ?? ""}
          onChange={(event) => updateParam("region", event.target.value)}
        />
        <Input
          className={clsx("w-36", searchParams.get("city") && ACTIVE_FILTER_CLASS)}
          placeholder="City"
          defaultValue={searchParams.get("city") ?? ""}
          onChange={(event) => updateParam("city", event.target.value)}
        />
        {/* A lead-type filter only matters once there is more than one lead type. */}
        {leadTypes.length > 1 && (
          <Select className={filterClass("leadTypeId")} defaultValue={searchParams.get("leadTypeId") ?? ""} onChange={(event) => updateParam("leadTypeId", event.target.value)}>
            <option value="">All Lead Types</option>
            {leadTypes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        )}
        <Select className={filterClass("pipelineStageId")} defaultValue={searchParams.get("pipelineStageId") ?? ""} onChange={(event) => updateParam("pipelineStageId", event.target.value)}>
          <option value="">All Pipeline Stages</option>
          {pipelineStages.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
        <Select className={filterClass("assignedToId")} defaultValue={searchParams.get("assignedToId") ?? ""} onChange={(event) => updateParam("assignedToId", event.target.value)}>
          <option value="">All Reps</option>
          {salespeople.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
        <Select className={filterClass("sortBy", "name")} defaultValue={searchParams.get("sortBy") ?? "name"} onChange={(event) => updateParam("sortBy", event.target.value)}>
          <option value="name">Sort: Name</option>
          <option value="city">Sort: City</option>
          <option value="region">Sort: State/Province</option>
          <option value="eosScore">Sort: EOS score</option>
        </Select>
        <Select className={filterClass("sortDir", "asc")} defaultValue={searchParams.get("sortDir") ?? "asc"} onChange={(event) => updateParam("sortDir", event.target.value)}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </Select>
      </div>
    </Card>
  );
}
