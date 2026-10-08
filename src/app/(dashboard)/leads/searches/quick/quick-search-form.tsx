"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startQuickSearch, saveCityList, deleteCityList, type QuickSearchFormState } from "./actions";
import { Card } from "@/components/ui/card";
import { Label, Input, Select, Textarea, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { parseCityList } from "@/lib/research/city-list";

const VENUE_KINDS = [
  { value: "PUB", label: "Pubs" },
  { value: "BAR", label: "Bars" },
  { value: "TAVERN", label: "Taverns" },
];

// Matches the Quick Search limit (CitiesSchema in validation/search.ts).
const MAX_CITIES = 50;

export type SavedCityList = { id: string; name: string; country: string; region: string; cities: string[] };

export type QuickSearchFormOptions = {
  leadTypes: { id: string; name: string }[];
  cityLists: SavedCityList[];
};

export function QuickSearchForm({ leadTypes, cityLists }: QuickSearchFormOptions) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<QuickSearchFormState, FormData>(startQuickSearch, undefined);
  const [country, setCountry] = useState("Canada");
  const [region, setRegion] = useState("");
  const [citiesInput, setCitiesInput] = useState("");
  const [perCity, setPerCity] = useState(true);
  const cities = parseCityList(citiesInput);

  // Saved city lists: pick one to fill in the area, or save what's typed.
  const [listId, setListId] = useState("");
  const [listName, setListName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [listMessage, setListMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [listPending, startListTransition] = useTransition();
  const selectedList = cityLists.find((list) => list.id === listId) ?? null;
  const nameTaken = cityLists.some((list) => list.name.toLowerCase() === listName.trim().toLowerCase());

  function pickList(id: string) {
    setListId(id);
    setConfirmingDelete(false);
    setListMessage(null);
    const list = cityLists.find((entry) => entry.id === id);
    if (!list) return;
    setCountry(list.country);
    setRegion(list.region);
    setCitiesInput(list.cities.join("\n"));
    setListName(list.name);
  }

  function saveList() {
    setListMessage(null);
    startListTransition(async () => {
      const outcome = await saveCityList({ name: listName, country, region, cities });
      if ("error" in outcome) {
        setListMessage({ tone: "error", text: outcome.error });
        return;
      }
      setListId(outcome.id);
      setListMessage({ tone: "info", text: `${outcome.replaced ? "Replaced" : "Saved"} "${listName.trim()}" with ${cities.length} ${cities.length === 1 ? "city" : "cities"}.` });
      router.refresh();
    });
  }

  function deleteList() {
    if (!selectedList) return;
    const name = selectedList.name;
    setConfirmingDelete(false);
    startListTransition(async () => {
      const outcome = await deleteCityList(selectedList.id);
      if (outcome.error) {
        setListMessage({ tone: "error", text: outcome.error });
        return;
      }
      setListId("");
      setListMessage({ tone: "info", text: `Deleted "${name}".` });
      router.refresh();
    });
  }

  return (
    <form action={formAction}>
      <Card className="space-y-4">
        {/* With a single lead type there's nothing to choose — it's used without asking. */}
        {leadTypes.length === 1 ? (
          <input type="hidden" name="leadTypeIds" value={leadTypes[0].id} />
        ) : (
          <div>
            <Label className="mb-1 block text-xs uppercase">Venue types</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {leadTypes.map((leadType) => (
                <label key={leadType.id} className="flex items-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-sm text-text">
                  <input type="checkbox" name="leadTypeIds" value={leadType.id} />
                  {leadType.name}
                </label>
              ))}
            </div>
            {leadTypes.length === 0 && <p className="text-sm text-text-muted">No active Lead Types configured yet.</p>}
          </div>
        )}

        <div>
          <Label className="mb-1 block text-xs uppercase">Search for</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {VENUE_KINDS.map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-sm text-text">
                <input type="checkbox" name="venueKinds" value={value} defaultChecked={value === "PUB"} />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-text-muted">Each one is its own directory search; the results are combined, without duplicates.</p>
        </div>

        <div>
          <Label className="mb-1 block text-xs uppercase">Only venues that offer (optional)</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-sm text-text">
              <input type="checkbox" name="entertainment" value="TRIVIA" />
              Trivia
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-sm text-text">
              <input type="checkbox" name="entertainment" value="KARAOKE" />
              Karaoke
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-sm text-text">
              <input type="checkbox" name="entertainment" value="BINGO" />
              Bingo
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-sm text-text">
              <input type="checkbox" name="entertainment" value="EVENTS" />
              Any events
            </label>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Tick any to find venues with any of them. Any events catches open mic, game nights and other weekly event nights. Leave all blank to list every venue. This is the directory&apos;s best guess from
            listings and reviews, not a confirmed fact.
          </p>
        </div>

        {cityLists.length > 0 && (
          <div>
            <Label className="mb-1 block text-xs uppercase">Saved lists</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={listId} onChange={(event) => pickList(event.target.value)} className="max-w-xs">
                <option value="">Choose a saved list...</option>
                {cityLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name} ({list.cities.length} {list.cities.length === 1 ? "city" : "cities"}, {list.region})
                  </option>
                ))}
              </Select>
              {selectedList &&
                (confirmingDelete ? (
                  <span className="flex items-center gap-2 text-sm text-text">
                    Delete &quot;{selectedList.name}&quot;?
                    <Button type="button" variant="destructive" disabled={listPending} onClick={deleteList}>
                      Delete
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                      Keep it
                    </Button>
                  </span>
                ) : (
                  <Button type="button" variant="ghost" disabled={listPending} onClick={() => setConfirmingDelete(true)}>
                    Delete list
                  </Button>
                ))}
            </div>
            <p className="mt-1 text-xs text-text-muted">Fills in the country, province and cities. You can still change them before searching.</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-1 block text-xs uppercase">Country</Label>
            <Select name="country" required value={country} onChange={(event) => setCountry(event.target.value)}>
              <option value="Canada">Canada</option>
              <option value="United States">United States</option>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block text-xs uppercase">State / Province</Label>
            <Input name="region" required value={region} onChange={(event) => setRegion(event.target.value)} placeholder="e.g. ON or CO" />
          </div>
        </div>

        <div>
          <Label className="mb-1 block text-xs uppercase">Cities (optional)</Label>
          <Textarea
            rows={4}
            value={citiesInput}
            onChange={(event) => setCitiesInput(event.target.value)}
            placeholder={"Paste a list: one city per line, or separated by commas.\nLeave blank to search the whole state/province."}
          />
          {cities.map((city) => (
            <input key={city} type="hidden" name="cities" value={city} />
          ))}
          {cities.length > 0 && (
            <p className="mt-1 text-xs text-text-muted">
              {cities.length} {cities.length === 1 ? "city" : "cities"}: {cities.join(", ")}
            </p>
          )}
          {cities.length > MAX_CITIES && (
            <p className="mt-1 text-xs font-semibold text-danger">{`Quick Search takes up to ${MAX_CITIES} cities at a time. Remove ${cities.length - MAX_CITIES} or split the list.`}</p>
          )}
          {cities.length > 1 && (
            <label className="mt-2 flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="perCity" checked={perCity} onChange={(event) => setPerCity(event.target.checked)} />
              Run each city as its own search, with its own results page
            </label>
          )}
          {cities.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={listName}
                onChange={(event) => setListName(event.target.value)}
                onKeyDown={(event) => {
                  // Enter here saves the list, not starts the search.
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (listName.trim()) saveList();
                  }
                }}
                placeholder="Name this list to reuse it, e.g. West GTA towns"
                maxLength={60}
                className="max-w-xs"
              />
              <Button type="button" variant="ghost" disabled={listPending || !listName.trim()} onClick={saveList}>
                {nameTaken ? "Replace list" : "Save list"}
              </Button>
              {nameTaken && <span className="text-xs text-text-muted">{`A list called "${listName.trim()}" already exists. Saving replaces it.`}</span>}
            </div>
          )}
          {listMessage && <p className={`mt-1 text-xs ${listMessage.tone === "error" ? "font-semibold text-danger" : "text-text-muted"}`}>{listMessage.text}</p>}
        </div>

        {state?.error && <FieldError>{state.error}</FieldError>}

        <Button type="submit" disabled={pending} variant="primary">
          {pending ? "Starting..." : "List locations"}
        </Button>
      </Card>
    </form>
  );
}
