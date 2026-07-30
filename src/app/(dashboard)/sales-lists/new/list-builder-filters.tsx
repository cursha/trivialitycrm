"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Input, Select, Label } from "@/components/ui/field";
import { Card } from "@/components/ui/card";

type Option = { id: string; name: string };

export function ListBuilderFilters({
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
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function toggleParam(key: string) {
    updateParam(key, searchParams.get(key) === "true" ? "" : "true");
  }

  const selectClass = "w-auto";
  const checked = (key: string) => searchParams.get(key) === "true";

  return (
    <Card className="space-y-4">
      <Input
        type="search"
        placeholder="Search by name, city, email or phone"
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(event) => updateParam("q", event.target.value)}
      />

      <div>
        <p className="mb-1.5 text-xs font-bold uppercase text-text-muted">Location &amp; assignment</p>
        <div className="flex flex-wrap gap-2">
          <Input className="w-36" placeholder="Country" defaultValue={searchParams.get("country") ?? ""} onChange={(e) => updateParam("country", e.target.value)} />
          <Input className="w-32" placeholder="State/Province" defaultValue={searchParams.get("region") ?? ""} onChange={(e) => updateParam("region", e.target.value)} />
          <Input className="w-36" placeholder="City" defaultValue={searchParams.get("city") ?? ""} onChange={(e) => updateParam("city", e.target.value)} />
          <Select className={selectClass} defaultValue={searchParams.get("leadTypeId") ?? ""} onChange={(e) => updateParam("leadTypeId", e.target.value)}>
            <option value="">All Lead Types</option>
            {leadTypes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select className={selectClass} defaultValue={searchParams.get("pipelineStageId") ?? ""} onChange={(e) => updateParam("pipelineStageId", e.target.value)}>
            <option value="">All Pipeline Stages</option>
            {pipelineStages.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select className={selectClass} defaultValue={searchParams.get("assignedToId") ?? ""} onChange={(e) => updateParam("assignedToId", e.target.value)}>
            <option value="">All Owners</option>
            {salespeople.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select className={selectClass} defaultValue={searchParams.get("competitorId") ?? ""} onChange={(e) => updateParam("competitorId", e.target.value)}>
            <option value="">Any Competitor</option>
            {competitors.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-bold uppercase text-text-muted">Scoring &amp; classification</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-24" type="number" min={0} max={100} placeholder="EOS min" defaultValue={searchParams.get("scoreMin") ?? ""} onChange={(e) => updateParam("scoreMin", e.target.value)} />
          <Input className="w-24" type="number" min={0} max={100} placeholder="EOS max" defaultValue={searchParams.get("scoreMax") ?? ""} onChange={(e) => updateParam("scoreMax", e.target.value)} />
          <Select className={selectClass} defaultValue={searchParams.get("confidenceLevel") ?? ""} onChange={(e) => updateParam("confidenceLevel", e.target.value)}>
            <option value="">Any Confidence</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </Select>
          <Select className={selectClass} defaultValue={searchParams.get("primaryClassification") ?? ""} onChange={(e) => updateParam("primaryClassification", e.target.value)}>
            <option value="">Any Classification</option>
            <option value="ENTERTAINMENT_READY">Entertainment-Ready</option>
            <option value="GREENFIELD">Greenfield</option>
            <option value="REPLACEMENT">Replacement</option>
            <option value="NEEDS_QUALIFICATION">Needs Qualification</option>
            <option value="EXISTING_CUSTOMER">Existing Customer</option>
          </Select>
          <Select className={selectClass} defaultValue={searchParams.get("triviaStatus") ?? ""} onChange={(e) => updateParam("triviaStatus", e.target.value)}>
            <option value="">Any Trivia Status</option>
            <option value="CURRENT_TRIVIA">Current Trivia</option>
            <option value="NO_CURRENT_TRIVIA">No Current Trivia</option>
            <option value="UNCERTAIN">Uncertain</option>
          </Select>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-bold uppercase text-text-muted">Contact history &amp; availability</p>
        <div className="flex flex-wrap items-center gap-4">
          <Select className={selectClass} defaultValue={searchParams.get("followUp") ?? ""} onChange={(e) => updateParam("followUp", e.target.value)}>
            <option value="">Any Follow-up</option>
            <option value="overdue">Overdue follow-up</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="none">Missing next action</option>
          </Select>
          <Input
            className="w-40"
            type="date"
            aria-label="Last contacted before"
            defaultValue={searchParams.get("lastContactedBefore") ?? ""}
            onChange={(e) => updateParam("lastContactedBefore", e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={checked("neverContactedOnly")} onChange={() => toggleParam("neverContactedOnly")} />
            Never contacted
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={searchParams.get("hasPhone") === "true"} onChange={() => updateParam("hasPhone", searchParams.get("hasPhone") === "true" ? "" : "true")} />
            Has phone
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={searchParams.get("hasEmail") === "true"} onChange={() => updateParam("hasEmail", searchParams.get("hasEmail") === "true" ? "" : "true")} />
            Has email
          </label>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-bold uppercase text-text-muted">Status</p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={checked("doNotContactOnly")} onChange={() => toggleParam("doNotContactOnly")} />
            Do-not-contact only
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <Label className="sr-only">Existing customer</Label>
            <Select className={selectClass} defaultValue={searchParams.get("isExistingCustomer") ?? ""} onChange={(e) => updateParam("isExistingCustomer", e.target.value)}>
              <option value="">Any Customer Status</option>
              <option value="true">Existing customers only</option>
              <option value="false">Prospects only</option>
            </Select>
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={checked("neverAnalyzedOnly")} onChange={() => toggleParam("neverAnalyzedOnly")} />
            Never analyzed
          </label>
          <Input
            className="w-40"
            type="date"
            aria-label="Last analyzed before"
            defaultValue={searchParams.get("lastAnalyzedBefore") ?? ""}
            onChange={(e) => updateParam("lastAnalyzedBefore", e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={checked("hasDataQualityWarnings")} onChange={() => toggleParam("hasDataQualityWarnings")} />
            Has data-quality warnings
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Select className={selectClass} defaultValue={searchParams.get("status") ?? "ACTIVE"} onChange={(e) => updateParam("status", e.target.value)}>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </Select>
        <Select className={selectClass} defaultValue={searchParams.get("sortBy") ?? "name"} onChange={(e) => updateParam("sortBy", e.target.value)}>
          <option value="name">Sort: Name</option>
          <option value="city">Sort: City</option>
          <option value="eosScore">Sort: EOS score</option>
          <option value="nextFollowUpAt">Sort: Follow-up date</option>
          <option value="createdAt">Sort: Created</option>
        </Select>
        <Select className={selectClass} defaultValue={searchParams.get("sortDir") ?? "asc"} onChange={(e) => updateParam("sortDir", e.target.value)}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </Select>
      </div>
    </Card>
  );
}
