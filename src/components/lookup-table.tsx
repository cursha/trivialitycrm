"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Star, Trash2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { ACTIVE_TONE } from "@/lib/ui/status-tones";

export type LookupOutcome = "WON" | "LOST" | null;

export type LookupItem = {
  id: string;
  name: string;
  active: boolean;
  isDefault?: boolean;
  outcomeType?: LookupOutcome;
};

type ActionResult = { error?: string } | undefined;
/** `needsReplacement` (Lead Types only): the item is still in use, so the
 * table asks which other item to move everything to, then calls `remove`
 * again with that item's id. `searches` > 0 also offers deleting that search
 * history instead of moving it; `othersInUse` says whether anything else
 * still has to move (if not, deleting the searches needs no "Move to"). */
type RemoveResult = { error?: string; needsReplacement?: boolean; searches?: number; othersInUse?: boolean } | undefined;
type RemoveOptions = { replacementId?: string; deleteSearches?: boolean };
type Replacing = { id: string; replacementId: string; searches: number; othersInUse: boolean; deleteSearches: boolean };

export function LookupTable({
  items,
  rename,
  setActive,
  move,
  remove,
  setDefault,
  defaultLabel = "Default",
  setOutcome,
  outcomeLabel = "Outcome",
  extraColumn,
}: {
  items: LookupItem[];
  rename: (id: string, formData: FormData) => Promise<ActionResult>;
  setActive: (id: string, active: boolean) => Promise<void>;
  move: (id: string, direction: "up" | "down") => Promise<void>;
  remove: (id: string, options?: RemoveOptions) => Promise<RemoveResult>;
  setDefault?: (id: string) => Promise<void>;
  defaultLabel?: string;
  /** Only pipeline stages pass this — everything else (lead types,
   * rejection reasons, roles, users) has no won/lost concept, so the
   * column is entirely absent for them. */
  setOutcome?: (id: string, outcomeType: LookupOutcome) => Promise<void>;
  outcomeLabel?: string;
  /** Generic escape hatch for a per-row control too specific to build into
   * this shared table directly (e.g. Lead Types' Route Plan eligibility
   * toggle + slug field). `cells` are PRE-RENDERED ReactNode, keyed by item
   * id — never a render callback: a plain function can't cross the
   * Server-to-Client component boundary the way an already-built element
   * (even one wrapping its own further client component) can, since this
   * table is itself "use client" and its caller is typically a Server
   * Component page. */
  extraColumn?: { label: string; cells: Record<string, React.ReactNode> };
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<Replacing | null>(null);
  const [isPending, startTransition] = useTransition();

  function clearError(id: string) {
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function handleRename(id: string, formData: FormData) {
    startTransition(async () => {
      const result = await rename(id, formData);
      if (result?.error) {
        setRowErrors((prev) => ({ ...prev, [id]: result.error! }));
      } else {
        clearError(id);
        setEditingId(null);
      }
    });
  }

  function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await remove(id);
      if (result?.needsReplacement) {
        setReplacing({
          id,
          replacementId: items.find((other) => other.id !== id)?.id ?? "",
          searches: result.searches ?? 0,
          othersInUse: result.othersInUse ?? true,
          deleteSearches: false,
        });
      }
      if (result?.error) {
        setRowErrors((prev) => ({ ...prev, [id]: result.error! }));
      } else {
        clearError(id);
      }
    });
  }

  function handleMoveAndDelete(name: string, choice: Replacing) {
    const needsTarget = choice.othersInUse || !choice.deleteSearches;
    const target = items.find((other) => other.id === choice.replacementId);
    if (needsTarget && !target) return;
    const searchesPart = choice.deleteSearches ? `Delete its ${choice.searches} lead search${choice.searches === 1 ? "" : "es"} and their results, ` : "";
    const movePart = target && needsTarget ? `${choice.deleteSearches ? "move everything else" : "Move everything"} to "${target.name}", ` : "";
    const question = `${searchesPart}${movePart}then delete "${name}"? This cannot be undone.`;
    if (!window.confirm(question.charAt(0).toUpperCase() + question.slice(1))) return;
    const { id } = choice;
    startTransition(async () => {
      const result = await remove(id, { replacementId: needsTarget ? choice.replacementId : undefined, deleteSearches: choice.deleteSearches });
      if (result?.error) {
        setRowErrors((prev) => ({ ...prev, [id]: result.error! }));
      } else {
        clearError(id);
        setReplacing(null);
      }
    });
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-left text-sm">
        <thead className="bg-black/5 text-xs uppercase text-text-muted">
          <tr>
            <th className="px-5 py-3">Order</th>
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Status</th>
            {setDefault && <th className="px-5 py-3">{defaultLabel}</th>}
            {setOutcome && <th className="px-5 py-3">{outcomeLabel}</th>}
            {extraColumn && <th className="px-5 py-3">{extraColumn.label}</th>}
            <th className="px-5 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id} className="border-t border-border align-top">
              <td className="px-5 py-4">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    disabled={isPending || index === 0}
                    onClick={() => startTransition(() => move(item.id, "up"))}
                    className="rounded border border-border-strong p-1 text-text disabled:opacity-30"
                    aria-label={`Move ${item.name} up`}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={isPending || index === items.length - 1}
                    onClick={() => startTransition(() => move(item.id, "down"))}
                    className="rounded border border-border-strong p-1 text-text disabled:opacity-30"
                    aria-label={`Move ${item.name} down`}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              </td>
              <td className="px-5 py-4">
                {editingId === item.id ? (
                  <form
                    action={(formData) => handleRename(item.id, formData)}
                    className="flex items-center gap-2"
                  >
                    <Input name="name" defaultValue={item.name} autoFocus className="py-1" />
                    <button type="submit" className="rounded p-1 text-emerald-600 hover:bg-emerald-50" aria-label="Save">
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        clearError(item.id);
                      }}
                      className="rounded p-1 text-text-muted hover:bg-black/5"
                      aria-label="Cancel"
                    >
                      <X size={16} />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text">{item.name}</span>
                    <button
                      type="button"
                      onClick={() => setEditingId(item.id)}
                      className="rounded p-1 text-text-muted hover:bg-black/5 hover:text-text"
                      aria-label={`Rename ${item.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                )}
                {rowErrors[item.id] && <p className="mt-1 text-xs font-semibold text-danger">{rowErrors[item.id]}</p>}
                {replacing?.id === item.id && (
                  <div className="mt-2 space-y-2 text-xs">
                    {replacing.searches > 0 && (
                      <label className="flex items-center gap-2 font-semibold text-text">
                        <input
                          type="checkbox"
                          checked={replacing.deleteSearches}
                          disabled={isPending}
                          onChange={(event) => setReplacing({ ...replacing, deleteSearches: event.target.checked })}
                        />
                        Delete its {replacing.searches} lead search{replacing.searches === 1 ? "" : "es"} and their results instead of moving them
                      </label>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {(replacing.othersInUse || !replacing.deleteSearches) && (
                        <>
                          <label htmlFor={`replace-${item.id}`} className="font-semibold text-text">
                            {replacing.deleteSearches ? "Move the rest to" : "Move to"}
                          </label>
                          <select
                            id={`replace-${item.id}`}
                            value={replacing.replacementId}
                            disabled={isPending}
                            onChange={(event) => setReplacing({ ...replacing, replacementId: event.target.value })}
                            className="rounded border border-border-strong bg-transparent px-2 py-1 font-semibold text-text"
                          >
                            {items
                              .filter((other) => other.id !== item.id)
                              .map((other) => (
                                <option key={other.id} value={other.id}>
                                  {other.name}
                                  {other.active ? "" : " (inactive)"}
                                </option>
                              ))}
                          </select>
                        </>
                      )}
                      <button
                        type="button"
                        disabled={isPending || ((replacing.othersInUse || !replacing.deleteSearches) && !replacing.replacementId)}
                        onClick={() => handleMoveAndDelete(item.name, replacing)}
                        className="rounded bg-danger px-2 py-1 font-semibold text-white disabled:opacity-50"
                      >
                        {replacing.othersInUse || !replacing.deleteSearches ? "Move and delete" : "Delete"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReplacing(null);
                          clearError(item.id);
                        }}
                        className="rounded px-2 py-1 font-semibold text-text-muted hover:bg-black/5"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </td>
              <td className="px-5 py-4">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => startTransition(() => setActive(item.id, !item.active))}
                >
                  <Badge tone={ACTIVE_TONE[item.active ? "active" : "inactive"]}>{item.active ? "Active" : "Inactive"}</Badge>
                </button>
              </td>
              {setDefault && (
                <td className="px-5 py-4">
                  <button
                    type="button"
                    disabled={isPending || item.isDefault}
                    onClick={() => startTransition(() => setDefault(item.id))}
                    className={`rounded-full p-1.5 ${item.isDefault ? "text-amber-500" : "text-border-strong hover:text-text-muted"}`}
                    aria-label={item.isDefault ? `${item.name} is the default` : `Make ${item.name} the default`}
                  >
                    <Star size={16} fill={item.isDefault ? "currentColor" : "none"} />
                  </button>
                </td>
              )}
              {setOutcome && (
                <td className="px-5 py-4">
                  <select
                    value={item.outcomeType ?? ""}
                    disabled={isPending}
                    onChange={(event) => startTransition(() => setOutcome(item.id, event.target.value === "" ? null : (event.target.value as "WON" | "LOST")))}
                    className="rounded border border-border-strong bg-transparent px-2 py-1 text-xs font-semibold text-text"
                    aria-label={`${item.name} outcome`}
                  >
                    <option value="">Open</option>
                    <option value="WON">Won</option>
                    <option value="LOST">Lost</option>
                  </select>
                </td>
              )}
              {extraColumn && <td className="px-5 py-4">{extraColumn.cells[item.id]}</td>}
              <td className="px-5 py-4 text-right">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleDelete(item.id, item.name)}
                  className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
                  aria-label={`Delete ${item.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td
                colSpan={4 + (setDefault ? 1 : 0) + (setOutcome ? 1 : 0) + (extraColumn ? 1 : 0)}
                className="px-5 py-8 text-center text-text-muted"
              >
                Nothing here yet — add the first one below.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
