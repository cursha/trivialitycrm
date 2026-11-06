"use client";

import { useActionState, useState } from "react";
import { startWebPageSearch, type WebPageFormState } from "./actions";
import { Card } from "@/components/ui/card";
import { Label, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { US_STATES, CA_PROVINCES } from "@/lib/constants/north-american-regions";

export function WebPageForm({ leadTypes }: { leadTypes: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<WebPageFormState, FormData>(startWebPageSearch, undefined);
  const [country, setCountry] = useState("Canada");
  const [region, setRegion] = useState("");
  const regionOptions = country === "Canada" ? CA_PROVINCES : US_STATES;

  return (
    <form action={formAction}>
      <Card className="space-y-4">
        <div>
          <Label htmlFor="url" className="mb-1 block text-xs uppercase">
            Web page
          </Label>
          <Input id="url" name="url" type="url" required placeholder="https://www.tripadvisor.ca/..." autoComplete="off" />
          <p className="mt-1 text-xs text-text-muted">
            Paste the link from your browser&apos;s address bar. It can be one bar&apos;s page or a list of many (a directory, a &quot;best pubs in town&quot; article, a
            league&apos;s venue list).
          </p>
        </div>

        <div>
          <Label htmlFor="pageText" className="mb-1 block text-xs uppercase">
            Page text (optional)
          </Label>
          <Textarea id="pageText" name="pageText" rows={4} placeholder="Leave blank, unless the CRM couldn't open the page." />
          <p className="mt-1 text-xs text-text-muted">
            Some big sites, TripAdvisor and Yelp among them, won&apos;t let the CRM open their pages. For those, open the page in your browser, press Ctrl+A then Ctrl+C
            (Cmd on a Mac), and paste it here. Keep the link above too.
          </p>
        </div>

        {leadTypes.length === 1 ? (
          <input type="hidden" name="leadTypeId" value={leadTypes[0].id} />
        ) : (
          <div>
            <Label htmlFor="leadTypeId" className="mb-1 block text-xs uppercase">
              Lead Type
            </Label>
            <Select id="leadTypeId" name="leadTypeId" required defaultValue={leadTypes[0]?.id ?? ""}>
              {leadTypes.map((leadType) => (
                <option key={leadType.id} value={leadType.id}>
                  {leadType.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="country" className="mb-1 block text-xs uppercase">
              Country
            </Label>
            <Select
              id="country"
              name="country"
              required
              value={country}
              onChange={(event) => {
                setCountry(event.target.value);
                setRegion("");
              }}
            >
              <option value="Canada">Canada</option>
              <option value="United States">USA</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="region" className="mb-1 block text-xs uppercase">
              State / Province
            </Label>
            <Select id="region" name="region" required value={region} onChange={(event) => setRegion(event.target.value)}>
              <option value="" disabled>
                {country === "Canada" ? "Choose a province..." : "Choose a state..."}
              </option>
              {regionOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label} ({option.code})
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p className="-mt-2 text-xs text-text-muted">Used only when the page doesn&apos;t say where a business is.</p>

        {state?.error && <p className="text-sm font-semibold text-danger">{state.error}</p>}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending || leadTypes.length === 0}>
            {pending ? "Starting..." : "Read this page"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
