"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/field";

type Option = { id: string; name: string };

export function FilterBar({
  leadTypes,
  salespeople,
  competitors,
  territories,
}: {
  leadTypes: Option[];
  salespeople: Option[];
  competitors: Option[];
  territories: Option[];
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

  return (
    <div className="flex flex-wrap gap-2">
      <Select
        className="w-auto"
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
        className="w-auto"
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
        className="w-auto"
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
        className="w-auto"
        defaultValue={searchParams.get("territoryId") ?? ""}
        onChange={(event) => updateParam("territoryId", event.target.value)}
      >
        <option value="">All Territories</option>
        {territories.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
