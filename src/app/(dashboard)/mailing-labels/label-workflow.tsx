"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input, Label, Select } from "@/components/ui/field";
import type { LabelFilters } from "@/lib/validation/mailing-labels";
import type { SheetSummary } from "@/lib/mailing-labels/service";
import {
  deleteAlignmentProfile,
  generateLabelBatch,
  reviewLabelJob,
  saveAlignmentProfile,
  saveLabelFilters,
  setLabelContact,
  setLabelRemoved,
  setLabelSheet,
  type DraftResult,
  type PreviewLayout,
  type ReviewResult,
} from "./actions";

// --- draft revision ------------------------------------------------------
// Every save sends the revision this page last saw; the server refuses it
// if another tab saved first. The context keeps the latest revision so two
// quick changes on this page don't trip over each other.

type DraftContextValue = { revision: number; run: (action: (revision: number) => Promise<DraftResult>) => Promise<DraftResult>; pending: boolean };
const DraftContext = createContext<DraftContextValue | null>(null);

export function DraftProvider({ revision: serverRevision, children }: { revision: number; children: ReactNode }) {
  const router = useRouter();
  // Revisions only go up: the latest is whichever is higher, this page's
  // own last save or what the server last rendered.
  const [savedRevision, setRevision] = useState(serverRevision);
  const revision = Math.max(savedRevision, serverRevision);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: (revision: number) => Promise<DraftResult>): Promise<DraftResult> {
    setError(null);
    setNotice(null);
    const result = await action(revision);
    if (result.ok) {
      setRevision(result.revision);
      if (result.message) setNotice(result.message);
      startTransition(() => router.refresh());
    } else setError({ text: result.error, conflict: !!result.conflict });
    return result;
  }

  return (
    <DraftContext.Provider value={{ revision, run, pending }}>
      {error && (
        <div className="mx-auto mb-4 max-w-5xl">
          <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-2">
            <span>{error.text}</span>
            {error.conflict && (
              <Button type="button" variant="ghost" onClick={() => window.location.reload()}>
                Reload
              </Button>
            )}
          </Alert>
        </div>
      )}
      {notice && (
        <div className="mx-auto mb-4 max-w-5xl">
          <Alert tone="info">{notice}</Alert>
        </div>
      )}
      {children}
    </DraftContext.Provider>
  );
}

function useDraft() {
  const value = useContext(DraftContext);
  if (!value) throw new Error("useDraft outside DraftProvider");
  return value;
}

// --- filters ---------------------------------------------------------------

export type FilterOptions = {
  cities: { city: string; region: string }[];
  regions: { region: string; country: string }[];
  stages: { id: string; name: string }[];
  salespeople: { id: string; name: string }[];
  tags: { value: string; label: string }[];
};

const cityKey = (c: { city: string; region: string }) => `${c.city.toLowerCase()}|${c.region.toLowerCase()}`;
const regionKey = (r: { region: string; country: string }) => `${r.region.toLowerCase()}|${r.country.toLowerCase()}`;

function CheckList<T>({ title, items, keyOf, labelOf, selected, onToggle, searchable }: { title: string; items: T[]; keyOf: (item: T) => string; labelOf: (item: T) => string; selected: Set<string>; onToggle: (key: string) => void; searchable?: boolean }) {
  const [search, setSearch] = useState("");
  const shown = search ? items.filter((item) => labelOf(item).toLowerCase().includes(search.toLowerCase())) : items;
  return (
    <div>
      <Label className="mb-1 block text-xs uppercase">
        {title} {selected.size > 0 && <span className="normal-case text-primary">({selected.size} chosen)</span>}
      </Label>
      {searchable && <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="mb-1 py-1 text-xs" />}
      <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-border-strong p-2">
        {shown.length === 0 && <p className="text-xs text-text-muted">None</p>}
        {shown.map((item) => (
          <label key={keyOf(item)} className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={selected.has(keyOf(item))} onChange={() => onToggle(keyOf(item))} />
            {labelOf(item)}
          </label>
        ))}
      </div>
    </div>
  );
}

export function FilterPanel({
  options,
  filters,
  fromCompanies = false,
  allConfirmed,
  hasChoices,
  needsConfirmAll,
  matched,
}: {
  options: FilterOptions;
  filters: LabelFilters;
  /** Opened from the Companies list's Print labels: filters are pre-ticked, not yet saved. */
  fromCompanies?: boolean;
  allConfirmed: boolean;
  hasChoices: boolean;
  needsConfirmAll: boolean;
  matched: number;
}) {
  const router = useRouter();
  const { run, pending } = useDraft();
  const [cities, setCities] = useState(new Set(filters.cities.map(cityKey)));
  const [regions, setRegions] = useState(new Set(filters.regions.map(regionKey)));
  const [stages, setStages] = useState(new Set(filters.stageIds));
  const [people, setPeople] = useState(new Set(filters.salespersonIds));
  const [tags, setTags] = useState(new Set<string>(filters.tags));
  const [tagMode, setTagMode] = useState(filters.tagMode);

  const toggle = (set: Set<string>, update: (s: Set<string>) => void) => (key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update(next);
  };

  const built: LabelFilters = {
    cities: options.cities.filter((c) => cities.has(cityKey(c))),
    regions: options.regions.filter((r) => regions.has(regionKey(r))),
    stageIds: [...stages],
    salespersonIds: [...people],
    tags: [...tags] as LabelFilters["tags"],
    tagMode,
  };
  const empty = built.cities.length + built.regions.length + built.stageIds.length + built.salespersonIds.length + built.tags.length === 0;
  const active = [
    built.cities.length && `City: ${built.cities.map((c) => `${c.city}, ${c.region}`).join(" or ")}`,
    built.regions.length && `Province/State: ${built.regions.map((r) => r.region).join(" or ")}`,
    built.stageIds.length && `Stage: ${options.stages.filter((s) => stages.has(s.id)).map((s) => s.name).join(" or ")}`,
    built.salespersonIds.length && `Salesperson: ${options.salespeople.filter((s) => people.has(s.id)).map((s) => s.name).join(" or ")}`,
    built.tags.length && `Tag: ${options.tags.filter((t) => tags.has(t.value)).map((t) => t.label).join(tagMode === "all" ? " and " : " or ")}`,
  ].filter(Boolean) as string[];

  function apply(confirmAll: boolean) {
    if (hasChoices && !window.confirm("Changing the filters clears your removals and contact choices for companies that no longer match. Continue?")) return;
    void run((revision) => saveLabelFilters({ revision, filters: built, allConfirmed: confirmAll })).then((result) => {
      // Saved: drop the Companies hand-off from the address so it isn't re-applied.
      if (result.ok && fromCompanies) router.replace("/mailing-labels");
    });
  }

  function reset() {
    setCities(new Set());
    setRegions(new Set());
    setStages(new Set());
    setPeople(new Set());
    setTags(new Set());
    setTagMode("any");
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-text">1. Choose companies</h2>
        <Button type="button" variant="ghost" onClick={reset}>
          Reset filters
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CheckList title="City" items={options.cities} keyOf={cityKey} labelOf={(c) => `${c.city}, ${c.region}`} selected={cities} onToggle={toggle(cities, setCities)} searchable />
        <CheckList title="Province / State" items={options.regions} keyOf={regionKey} labelOf={(r) => `${r.region} (${r.country === "United States" ? "USA" : r.country})`} selected={regions} onToggle={toggle(regions, setRegions)} searchable />
        <CheckList title="Sales stage" items={options.stages} keyOf={(s) => s.id} labelOf={(s) => s.name} selected={stages} onToggle={toggle(stages, setStages)} />
        <CheckList title="Salesperson" items={options.salespeople} keyOf={(s) => s.id} labelOf={(s) => s.name} selected={people} onToggle={toggle(people, setPeople)} />
        <div>
          <CheckList title="Tag" items={options.tags} keyOf={(t) => t.value} labelOf={(t) => t.label} selected={tags} onToggle={toggle(tags, setTags)} />
          <div className="mt-1 flex gap-3 text-xs text-text">
            <label className="flex items-center gap-1">
              <input type="radio" checked={tagMode === "any"} onChange={() => setTagMode("any")} /> Any chosen tag
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={tagMode === "all"} onChange={() => setTagMode("all")} /> All chosen tags
            </label>
          </div>
        </div>
      </div>
      <p className="text-xs text-text-muted">
        A company must match every filter you use; within one filter, any chosen value counts. Leave a filter empty to not restrict it. Companies marked do not contact, archived or merged are never
        included.
      </p>
      <p className="text-sm text-text">
        <span className="font-semibold">Active filters:</span> {active.length > 0 ? active.join("; ") : "none"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {empty ? (
          <Button type="button" disabled={pending} onClick={() => apply(true)}>
            {allConfirmed && !needsConfirmAll ? "Using all matching companies" : `Use all matching companies (${matched})`}
          </Button>
        ) : (
          <Button type="button" disabled={pending} onClick={() => apply(false)}>
            Apply filters
          </Button>
        )}
        {needsConfirmAll && <span className="text-xs text-text-muted">With no filters, every company you can see ({matched}) would get a label. Confirm to continue, or choose filters.</span>}
      </div>
    </Card>
  );
}

// --- review rows -------------------------------------------------------------

export function ContactChoice({ companyId, current, defaultLabel, note, options }: { companyId: string; current: string | null; defaultLabel: string | null; note: string | null; options: { id: string; name: string }[] }) {
  const { run, pending } = useDraft();
  return (
    <div className="mt-1">
      <Select
        aria-label="Addressed to"
        value={current ?? ""}
        disabled={pending}
        onChange={(e) => void run((revision) => setLabelContact({ revision, companyId, choice: e.target.value || null }))}
        className="w-auto max-w-full py-1 text-xs"
      >
        <option value="">Default{defaultLabel ? `: Attn: ${defaultLabel}` : ""}</option>
        <option value="MANAGER">Attn: Manager</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            Attn: {o.name}
          </option>
        ))}
      </Select>
      {note && <p className="mt-0.5 text-[11px] text-text-muted">{note}</p>}
    </div>
  );
}

export function RemoveToggle({ companyId, removed }: { companyId: string; removed: boolean }) {
  const { run, pending } = useDraft();
  return (
    <Button type="button" variant="ghost" disabled={pending} onClick={() => void run((revision) => setLabelRemoved({ revision, companyId, removed: !removed }))}>
      {removed ? "Put back" : "Remove"}
    </Button>
  );
}

// --- sheet ----------------------------------------------------------------

type Profile = { id: string; templateId: string; name: string; offsetXMm: number; offsetYMm: number };

export function SheetPanel({ sheets, profiles, templateId, alignmentProfileId, startPosition, capacity, summary, canManageSheets }: { sheets: { id: string; name: string; rows: number; columns: number; valid: boolean }[]; profiles: Profile[]; templateId: string | null; alignmentProfileId: string | null; startPosition: number; capacity: number; summary: SheetSummary | null; canManageSheets: boolean }) {
  const { run, pending } = useDraft();
  const sheet = sheets.find((s) => s.id === templateId) ?? null;
  const sheetProfiles = profiles.filter((p) => p.templateId === templateId);
  const profile = sheetProfiles.find((p) => p.id === alignmentProfileId) ?? null;
  const [editing, setEditing] = useState<{ id?: string; name: string; x: string; y: string } | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const save = (next: { templateId?: string | null; alignmentProfileId?: string | null; startPosition?: number }) =>
    void run((revision) =>
      setLabelSheet({
        revision,
        templateId: next.templateId !== undefined ? next.templateId : templateId,
        alignmentProfileId: next.alignmentProfileId !== undefined ? next.alignmentProfileId : next.templateId !== undefined ? null : alignmentProfileId,
        startPosition: next.startPosition ?? (next.templateId !== undefined ? 1 : startPosition),
      }),
    );

  async function saveProfile() {
    if (!editing || !templateId) return;
    setProfileError(null);
    const result = await saveAlignmentProfile({ id: editing.id, name: editing.name, templateId, offsetXMm: Number(editing.x), offsetYMm: Number(editing.y) });
    if (!result.ok) return setProfileError(result.error);
    setEditing(null);
    save({ alignmentProfileId: result.id });
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-bold text-text">2. Label sheet and starting position</h2>
      {sheets.length === 0 ? (
        <p className="text-sm text-text-muted">
          No label sheets are set up yet. {canManageSheets ? <a href="/settings/label-sheets" className="font-semibold text-primary underline">Add one in Settings → Label Sheets</a> : "Ask an administrator to add one in Settings → Label Sheets."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1 block text-xs uppercase">Label sheet</Label>
            <Select value={templateId ?? ""} disabled={pending} onChange={(e) => save({ templateId: e.target.value || null })}>
              <option value="">Choose a sheet...</option>
              {sheets.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.valid}>
                  {s.name} ({s.rows * s.columns} per sheet){s.valid ? "" : " — measurements need fixing"}
                </option>
              ))}
            </Select>
          </div>
          {sheet && (
            <div>
              <Label className="mb-1 block text-xs uppercase">Printer setting (optional)</Label>
              <div className="flex gap-2">
                <Select value={alignmentProfileId ?? ""} disabled={pending} onChange={(e) => save({ alignmentProfileId: e.target.value || null })}>
                  <option value="">None (no correction)</option>
                  {sheetProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.offsetXMm >= 0 ? "+" : ""}
                      {p.offsetXMm} mm across, {p.offsetYMm >= 0 ? "+" : ""}
                      {p.offsetYMm} mm down)
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="ghost" onClick={() => setEditing(profile ? { id: profile.id, name: profile.name, x: String(profile.offsetXMm), y: String(profile.offsetYMm) } : { name: "My printer", x: "0", y: "0" })}>
                  {profile ? "Adjust" : "New"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="space-y-2 rounded-lg border border-border-strong p-3">
          <p className="text-xs text-text-muted">
            Moves every label&apos;s text without resizing it. Positive across moves right, negative left; positive down moves down, negative up. Print the calibration page on plain paper,
            hold it over a label sheet against the light, and measure how far off the text is.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label className="mb-1 block text-xs">Name</Label>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Across (mm, + right)</Label>
              <Input inputMode="decimal" value={editing.x} onChange={(e) => setEditing({ ...editing, x: e.target.value })} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Down (mm, + down)</Label>
              <Input inputMode="decimal" value={editing.y} onChange={(e) => setEditing({ ...editing, y: e.target.value })} />
            </div>
          </div>
          {profileError && <p className="text-xs font-semibold text-danger">{profileError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void saveProfile()}>
              Save printer setting
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing({ ...editing, x: "0", y: "0" })}>
              Reset to 0
            </Button>
            {editing.id && (
              <Button
                type="button"
                variant="destructive"
                onClick={async () => {
                  await deleteAlignmentProfile(editing.id!);
                  setEditing(null);
                  window.location.reload();
                }}
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {sheet && capacity > 0 && (
        <>
          <div>
            <Label className="mb-1 block text-xs uppercase">First unused label on your first sheet</Label>
            <p className="mb-2 text-xs text-text-muted">
              Click the first unused label. Labels before it stay blank, and later sheets start at 1. If a sheet has used labels scattered around rather than all at the start, use a fresh sheet.
            </p>
            <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(${sheet.columns}, minmax(2.25rem, 4.5rem))` }}>
              {Array.from({ length: capacity }, (_, i) => i + 1).map((position) => (
                <button
                  key={position}
                  type="button"
                  disabled={pending}
                  onClick={() => save({ startPosition: position })}
                  aria-label={`Start at label ${position}`}
                  aria-pressed={position === startPosition}
                  className={`h-8 rounded border text-xs font-semibold ${position < startPosition ? "border-border bg-black/10 text-text-muted line-through" : position === startPosition ? "border-primary bg-primary text-white" : "border-border-strong bg-surface text-text"}`}
                >
                  {position}
                </button>
              ))}
            </div>
          </div>
          {summary && (
            <p className="text-sm text-text">
              {summary.labels} {summary.labels === 1 ? "label" : "labels"} · {summary.perSheet} per sheet · {summary.skipped} skipped at the start · {summary.sheets}{" "}
              {summary.sheets === 1 ? "sheet" : "sheets"} · {summary.unusedOnLast} unused on the last sheet
            </p>
          )}
          <a
            className="inline-block text-sm font-semibold text-primary underline"
            href={`/api/mailing-labels/calibration?templateId=${templateId}${alignmentProfileId ? `&profileId=${alignmentProfileId}` : ""}`}
            target="_blank"
            rel="noopener"
          >
            Print a calibration page (plain paper)
          </a>
        </>
      )}
    </Card>
  );
}

// --- preview and generate ---------------------------------------------------

export function PreviewPanel({ ready, reviewedDigest, blockedReason }: { ready: boolean; reviewedDigest: string | null; blockedReason: string | null }) {
  const router = useRouter();
  const { revision } = useDraft();
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [pending, startTransition] = useTransition();
  const [generateError, setGenerateError] = useState<string | null>(null);
  // Any change to the draft clears the server's reviewed fingerprint.
  const current = digest && reviewedDigest === digest ? digest : null;

  function preview() {
    setGenerateError(null);
    startTransition(async () => {
      const result = await reviewLabelJob({ revision });
      setReview(result);
      if (result.ok) {
        setDigest(result.digest);
        router.refresh();
      }
    });
  }

  function generate() {
    setGenerateError(null);
    startTransition(async () => {
      const result = await generateLabelBatch({ revision });
      if (result.ok) router.push(`/mailing-labels/history/${result.batchId}`);
      else setGenerateError(result.error);
    });
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-bold text-text">3. Preview and generate</h2>
      {!ready && blockedReason && <p className="text-sm text-text-muted">{blockedReason}</p>}
      <Button type="button" disabled={!ready || pending} onClick={preview}>
        {pending ? "Working..." : current ? "Preview again" : "Preview labels"}
      </Button>
      {review && !review.ok && (
        <Alert tone="danger" className="block space-y-1">
          <p>{review.error}</p>
          {review.overflows && (
            <ul className="list-inside list-disc font-normal">
              {review.overflows.map((o) => (
                <li key={o.companyName + o.field}>
                  {o.companyName}: the {o.field} {o.problem}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {review?.ok && current && (
        <>
          <p className="text-sm text-text">
            {review.summary.labels} labels on {review.summary.sheets} {review.summary.sheets === 1 ? "sheet" : "sheets"}, starting at position {review.summary.skipped + 1}.
            {review.warnings > 0 && ` ${review.warnings} ${review.warnings === 1 ? "label has" : "labels have"} a warning to check in the list above.`}
          </p>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">Zoom</span>
            {[75, 100, 150].map((z) => (
              <button key={z} type="button" onClick={() => setZoom(z)} className={`rounded-full px-2 py-1 font-semibold ${zoom === z ? "bg-primary text-white" : "bg-black/5 text-text-muted"}`}>
                {z}%
              </button>
            ))}
            <a href={`/api/mailing-labels/preview?digest=${current}`} target="_blank" rel="noopener" className="font-semibold text-primary underline">
              Open the PDF preview in a new tab
            </a>
          </div>
          <PreviewPages preview={review.preview} zoom={zoom} />
          <p className="text-xs text-text-muted">
            Drawn from the exact layout the PDF uses: same lines, text sizes, positions, blank labels and pages. The dotted outlines are only on screen, never printed. Open the PDF to see it
            exactly as it will print.
          </p>
          <Alert tone="info" className="block space-y-1 font-normal">
            <p className="font-semibold">Printing it</p>
            <ul className="list-inside list-disc">
              <li>Choose the paper size that matches the sheet.</li>
              <li>Print at Actual size / 100%. Turn off Fit to page and Shrink oversized pages.</li>
              <li>Print one-sided, with the printer&apos;s label or heavy-paper setting if it has one.</li>
              <li>Check which way up your printer takes sheets, from its instructions.</li>
              <li>The first time, print on plain paper and hold it over a label sheet to check.</li>
            </ul>
            <p>The CRM can&apos;t see your printer, so it never marks anything as printed or mailed by itself. You can confirm that on the batch afterwards.</p>
          </Alert>
          {generateError && <Alert tone="danger">{generateError}</Alert>}
          <Button type="button" disabled={pending} onClick={generate}>
            Generate PDF
          </Button>
        </>
      )}
    </Card>
  );
}

// --- on-screen preview -----------------------------------------------------

const PT_TO_MM = 25.4 / 72;

/** Each sheet drawn to scale from the server's layout (millimetres), so
 * line breaks, sizes and positions are the PDF's own, not re-flowed here. */
function PreviewPages({ preview, zoom }: { preview: PreviewLayout; zoom: number }) {
  const { geometry: g, ascent } = preview;
  const width = `${Math.round(5.5 * zoom)}px`;
  const outlines = Array.from({ length: g.rows * g.columns }, (_, i) => ({ row: Math.floor(i / g.columns), column: i % g.columns, position: i + 1 }));
  return (
    <div className="max-h-[48rem] space-y-4 overflow-auto rounded-lg border border-border-strong bg-black/5 p-4">
      {Array.from({ length: preview.pages }, (_, page) => (
        <div key={page} className="mx-auto" style={{ width }}>
          <p className="mb-1 text-xs font-semibold text-text-muted">
            Sheet {page + 1} of {preview.pages}
          </p>
          <svg viewBox={`0 0 ${g.pageWidthMm} ${g.pageHeightMm}`} className="block w-full bg-white shadow" role="img" aria-label={`Label sheet ${page + 1}`}>
            {outlines.map((o) => (
              <rect
                key={o.position}
                x={g.leftMm + o.column * (g.labelWidthMm + g.gapXMm)}
                y={g.topMm + o.row * (g.labelHeightMm + g.gapYMm)}
                width={g.labelWidthMm}
                height={g.labelHeightMm}
                fill="none"
                stroke="#b8b8b8"
                strokeWidth={0.2}
                strokeDasharray="1 1"
                rx={1}
              />
            ))}
            {preview.labels
              .filter((l) => l.page === page)
              .map((l) => {
                const size = l.sizePt * PT_TO_MM;
                return (
                  <g key={l.position} fontFamily="'DejaVu Sans', Verdana, sans-serif" fontSize={size} fill="#000">
                    {l.rows.map((row, i) => (
                      <text key={i} x={l.xMm + g.paddingMm} y={l.yMm + g.paddingMm + ascent * size + i * size * g.lineHeight} fontWeight={row.bold ? 700 : 400}>
                        {row.text}
                      </text>
                    ))}
                  </g>
                );
              })}
          </svg>
        </div>
      ))}
    </div>
  );
}
