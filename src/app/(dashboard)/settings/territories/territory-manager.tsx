"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, CirclePlus } from "lucide-react";
import { createTerritory, updateTerritory, setTerritoryActive, deleteTerritory } from "./actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label, Input, Select, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ACTIVE_TONE } from "@/lib/ui/status-tones";

export type TerritoryRow = {
  id: string;
  name: string | null;
  country: string;
  region: string | null;
  city: string | null;
  active: boolean;
  assignedToId: string | null;
  assignedToName: string | null;
};

type SalespersonOption = { id: string; name: string };

function TerritoryFields({ defaultValues }: { defaultValues?: Partial<TerritoryRow>; salespeople: SalespersonOption[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label>Territory name (optional)</Label>
        <Input name="name" defaultValue={defaultValues?.name ?? ""} placeholder="e.g. Greater Toronto Area" className="mt-1" />
      </div>
      <div>
        <Label>Country</Label>
        <Input name="country" defaultValue={defaultValues?.country ?? ""} required className="mt-1" />
      </div>
      <div>
        <Label>State / Province (optional)</Label>
        <Input name="region" defaultValue={defaultValues?.region ?? ""} placeholder="Leave blank for the whole country" className="mt-1" />
      </div>
      <div>
        <Label>City (optional)</Label>
        <Input name="city" defaultValue={defaultValues?.city ?? ""} placeholder="Leave blank for the whole state/province" className="mt-1" />
      </div>
    </div>
  );
}

export function TerritoryManager({
  territories,
  salespeople,
}: {
  territories: TerritoryRow[];
  salespeople: SalespersonOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleUpdate(id: string, formData: FormData) {
    startTransition(async () => {
      const result = await updateTerritory(id, formData);
      if (result?.error) {
        setRowErrors((prev) => ({ ...prev, [id]: result.error! }));
      } else {
        setRowErrors((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setEditingId(null);
      }
    });
  }

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const result = await createTerritory(undefined, formData);
      if (result?.error) {
        setAddError(result.error);
      } else {
        setAddError(undefined);
        setAdding(false);
      }
    });
  }

  function handleDelete(id: string, label: string) {
    if (!window.confirm(`Delete territory "${label}"? This cannot be undone.`)) return;
    startTransition(() => {
      void deleteTerritory(id);
    });
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/5 text-xs uppercase text-text-muted">
            <tr>
              <th className="px-5 py-3">Scope</th>
              <th className="px-5 py-3">Assigned to</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {territories.map((territory) => {
              const label = territory.name ?? [territory.city, territory.region, territory.country].filter(Boolean).join(", ");
              return editingId === territory.id ? (
                <tr key={territory.id} className="border-t border-border align-top">
                  <td colSpan={4} className="p-4">
                    <form action={(formData) => handleUpdate(territory.id, formData)} className="space-y-3">
                      <TerritoryFields defaultValues={territory} salespeople={salespeople} />
                      <div>
                        <Label>Assigned to (optional)</Label>
                        <Select name="assignedToId" defaultValue={territory.assignedToId ?? ""} className="mt-1">
                          <option value="">Unassigned</option>
                          {salespeople.map((sp) => (
                            <option key={sp.id} value={sp.id}>
                              {sp.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {rowErrors[territory.id] && <FieldError>{rowErrors[territory.id]}</FieldError>}
                      <div className="flex gap-2">
                        <Button type="submit" disabled={isPending} variant="primary">
                          Save
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={territory.id} className="border-t border-border">
                  <td className="px-5 py-4">
                    <span className="font-semibold text-text">{label}</span>
                  </td>
                  <td className="px-5 py-4 text-text-muted">{territory.assignedToName ?? "Unassigned"}</td>
                  <td className="px-5 py-4">
                    <button type="button" disabled={isPending} onClick={() => startTransition(() => setTerritoryActive(territory.id, !territory.active))}>
                      <Badge tone={ACTIVE_TONE[territory.active ? "active" : "inactive"]}>
                        {territory.active ? "Active" : "Inactive"}
                      </Badge>
                    </button>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingId(territory.id)}
                        className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text"
                        aria-label={`Edit ${label}`}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleDelete(territory.id, label)}
                        className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
                        aria-label={`Delete ${label}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {territories.length === 0 && !adding && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-text-muted">
                  No territories yet — add the first one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {adding ? (
        <Card className="space-y-3">
          <form action={handleCreate} className="space-y-3">
            <TerritoryFields salespeople={salespeople} />
            <div>
              <Label>Assigned to (optional)</Label>
              <Select name="assignedToId" defaultValue="" className="mt-1">
                <option value="">Unassigned</option>
                {salespeople.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </Select>
            </div>
            {addError && <FieldError>{addError}</FieldError>}
            <div className="flex gap-2">
              <Button type="submit" disabled={isPending} variant="primary">
                Add territory
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
          <CirclePlus size={16} />
          Add territory
        </Button>
      )}
    </div>
  );
}
