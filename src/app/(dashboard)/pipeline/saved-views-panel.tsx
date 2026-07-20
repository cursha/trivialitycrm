"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Star, Copy, Archive as ArchiveIcon } from "lucide-react";
import { createSavedView, duplicateSavedView, archiveSavedView } from "./actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";

export type SavedViewRow = {
  id: string;
  name: string;
  visibility: "PRIVATE" | "SHARED";
  isDefault: boolean;
  isMine: boolean;
  ownerName: string;
  filters: Record<string, unknown>;
};

const CAPTURED_FILTER_KEYS = ["leadTypeId", "assignedToId", "competitorId", "territoryId"] as const;

export function SavedViewsPanel({ views, canCreateShared }: { views: SavedViewRow[]; canCreateShared: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"PRIVATE" | "SHARED">("PRIVATE");
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function currentFilters(): Record<string, string> {
    const filters: Record<string, string> = {};
    for (const key of CAPTURED_FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value) filters[key] = value;
    }
    return filters;
  }

  function handleCreate() {
    if (!name.trim()) {
      setError("Enter a name for this view.");
      return;
    }
    startTransition(async () => {
      const result = await createSavedView({ name, visibility, filters: currentFilters() });
      if ("error" in result) {
        setError(result.error);
      } else {
        setError(undefined);
        setName("");
        router.refresh();
      }
    });
  }

  function applyView(view: SavedViewRow) {
    const params = new URLSearchParams();
    params.set("view", "board");
    for (const [key, value] of Object.entries(view.filters)) {
      if (typeof value === "string" && value) params.set(key, value);
    }
    router.push(`/pipeline?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-sm font-semibold text-text">Save the current filters as a view</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ontario trials" className="mt-1" />
          </div>
          <div>
            <Label>Visibility</Label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "PRIVATE" | "SHARED")}
              className="mt-1 rounded-lg border border-border-strong bg-surface-raised px-3 py-2 text-sm text-text"
            >
              <option value="PRIVATE">Private</option>
              {canCreateShared && <option value="SHARED">Shared</option>}
            </select>
          </div>
          <Button type="button" variant="primary" disabled={isPending} onClick={handleCreate}>
            Save view
          </Button>
        </div>
        {error && <FieldError>{error}</FieldError>}
      </Card>

      {views.length === 0 ? (
        <EmptyState>No saved views yet.</EmptyState>
      ) : (
        <div className="space-y-2">
          {views.map((view) => (
            <Card key={view.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div className="flex items-center gap-2">
                {view.isDefault && <Star size={14} className="text-amber-500" fill="currentColor" />}
                <span className="font-semibold text-text">{view.name}</span>
                <Badge tone={view.visibility === "SHARED" ? "secondary" : "neutral"}>
                  {view.visibility === "SHARED" ? "Shared" : "Private"}
                </Badge>
                {!view.isMine && <span className="text-xs text-text-muted">by {view.ownerName}</span>}
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" onClick={() => applyView(view)}>
                  Apply
                </Button>
                <button
                  type="button"
                  onClick={() => startTransition(() => void duplicateSavedView(view.id).then(() => router.refresh()))}
                  className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text"
                  aria-label={`Duplicate ${view.name}`}
                >
                  <Copy size={16} />
                </button>
                {view.isMine && (
                  <button
                    type="button"
                    onClick={() => startTransition(() => void archiveSavedView(view.id).then(() => router.refresh()))}
                    className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
                    aria-label={`Archive ${view.name}`}
                  >
                    <ArchiveIcon size={16} />
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
