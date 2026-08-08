"use client";

import { useActionState, useEffect, useState } from "react";
import { startPubRadiusSearch, searchOriginPubCompanies, type PubRadiusFormState, type PubRadiusOriginOption } from "./actions";
import { RADIUS_BOUNDS } from "@/lib/geo/distance";
import { Card } from "@/components/ui/card";
import { Label, Input, Select, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

type RadiusUnit = "MI" | "KM";

function OriginPicker({ selected, onSelect, onClear }: { selected: PubRadiusOriginOption | null; onSelect: (company: PubRadiusOriginOption) => void; onClear: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PubRadiusOriginOption[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      const found = await searchOriginPubCompanies(query);
      setResults(found);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-lg bg-black/5 px-3 py-2 text-sm">
        <span className="font-semibold text-text">
          {selected.name} <span className="font-normal text-text-muted">— {selected.city}, {selected.region}</span>
        </span>
        <button type="button" onClick={onClear} className="font-semibold text-secondary hover:underline">
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length >= 2) setSearching(true);
        }}
        placeholder="Type a pub's name…"
      />
      <div className="mt-2 space-y-1">
        {query.trim().length < 2 && <p className="text-sm text-text-muted">Type at least 2 characters.</p>}
        {query.trim().length >= 2 && searching && <p className="text-sm text-text-muted">Searching…</p>}
        {query.trim().length >= 2 && !searching && results.length === 0 && (
          <p className="text-sm text-text-muted">No matching pubs — make sure the company exists and is on the &ldquo;Mayhem Lead&rdquo; Lead Type.</p>
        )}
        {results.map((company) => (
          <button
            key={company.id}
            type="button"
            onClick={() => onSelect(company)}
            className="block w-full rounded-lg border border-border-strong px-3 py-2 text-left text-sm hover:bg-black/5"
          >
            <span className="font-semibold text-text">{company.name}</span>
            <span className="ml-2 text-text-muted">
              {company.city}, {company.region}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PubRadiusForm() {
  const [state, formAction, pending] = useActionState<PubRadiusFormState, FormData>(startPubRadiusSearch, undefined);
  const [origin, setOrigin] = useState<PubRadiusOriginOption | null>(null);
  const [radiusUnit, setRadiusUnit] = useState<RadiusUnit>("MI");
  const bounds = RADIUS_BOUNDS[radiusUnit];

  return (
    <form action={formAction}>
      <Card className="space-y-4">
        <div>
          <Label className="mb-1 block text-xs uppercase">Origin pub</Label>
          <OriginPicker selected={origin} onSelect={setOrigin} onClear={() => setOrigin(null)} />
          {origin && <input type="hidden" name="originCompanyId" value={origin.id} />}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-1 block text-xs uppercase">Radius</Label>
            <Input name="radiusValue" type="number" min={bounds.min} max={bounds.max} defaultValue={5} required />
          </div>
          <div>
            <Label className="mb-1 block text-xs uppercase">Unit</Label>
            <Select name="radiusUnit" value={radiusUnit} onChange={(e) => setRadiusUnit(e.target.value as RadiusUnit)}>
              <option value="MI">Miles</option>
              <option value="KM">Kilometers</option>
            </Select>
          </div>
        </div>
        <p className="text-xs text-text-muted">
          {bounds.min}–{bounds.max} {radiusUnit === "MI" ? "miles" : "kilometers"}.
        </p>

        {state?.error && <FieldError>{state.error}</FieldError>}

        <Button type="submit" disabled={pending || !origin} variant="primary">
          {pending ? "Starting..." : "Start search"}
        </Button>
      </Card>
    </form>
  );
}
