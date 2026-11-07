"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input, Label, Textarea } from "@/components/ui/field";
import { MM_PER_INCH, validateGeometry, type SheetGeometry } from "@/lib/mailing-labels/geometry";
import { duplicateLabelSheet, saveLabelSheet, saveMailingLabelSettings, setLabelSheetActive } from "./actions";

type Sheet = { id: string; name: string; productCode: string | null; active: boolean; version: number; measurementNote: string | null; geometry: SheetGeometry };
type Unit = "mm" | "in";

const LENGTH_FIELDS: { key: keyof SheetGeometry; label: string; help?: string }[] = [
  { key: "pageWidthMm", label: "Page width" },
  { key: "pageHeightMm", label: "Page height" },
  { key: "labelWidthMm", label: "Label width" },
  { key: "labelHeightMm", label: "Label height" },
  { key: "topMm", label: "Top margin", help: "Page top to the top of the first row" },
  { key: "leftMm", label: "Left margin", help: "Page left to the left of the first column" },
  { key: "gapXMm", label: "Gap across", help: "Space between two labels side by side (not their pitch)" },
  { key: "gapYMm", label: "Gap down", help: "Space between two rows (0 if they touch)" },
  { key: "paddingMm", label: "Inner padding", help: "Blank space kept inside each label's edge" },
];

const NEW_SHEET: SheetGeometry = {
  pageWidthMm: 215.9,
  pageHeightMm: 279.4,
  rows: 10,
  columns: 3,
  labelWidthMm: 0,
  labelHeightMm: 0,
  topMm: 0,
  leftMm: 0,
  gapXMm: 0,
  gapYMm: 0,
  paddingMm: 2,
  preferredFontPt: 10,
  minFontPt: 8,
  lineHeight: 1.15,
};

function toDisplay(mm: number, unit: Unit): string {
  const value = unit === "mm" ? mm : mm / MM_PER_INCH;
  return String(Math.round(value * 10000) / 10000);
}
function toMm(text: string, unit: Unit): number {
  const value = Number(text.trim());
  return unit === "mm" ? value : value * MM_PER_INCH;
}

function SheetForm({ sheet, onDone }: { sheet: Sheet | null; onDone: () => void }) {
  const start = sheet?.geometry ?? NEW_SHEET;
  const [unit, setUnit] = useState<Unit>("in");
  // Lengths are held in mm and only converted for display, so switching
  // units never accumulates rounding.
  const [lengths, setLengths] = useState<Record<string, string>>(() => Object.fromEntries(LENGTH_FIELDS.map((f) => [f.key, sheet || start[f.key] ? toDisplay(start[f.key] as number, "in") : ""])));
  const [name, setName] = useState(sheet?.name ?? "");
  const [productCode, setProductCode] = useState(sheet?.productCode ?? "");
  const [rows, setRows] = useState(String(start.rows));
  const [columns, setColumns] = useState(String(start.columns));
  const [preferredFontPt, setPreferred] = useState(String(start.preferredFontPt));
  const [minFontPt, setMin] = useState(String(start.minFontPt));
  const [lineHeight, setLineHeight] = useState(String(start.lineHeight));
  const [note, setNote] = useState(sheet?.measurementNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function switchUnit(next: Unit) {
    if (next === unit) return;
    setLengths((current) => Object.fromEntries(Object.entries(current).map(([key, text]) => [key, text.trim() === "" ? "" : toDisplay(toMm(text, unit), next)])));
    setUnit(next);
  }

  function setPage(widthMm: number, heightMm: number) {
    setLengths((current) => ({ ...current, pageWidthMm: toDisplay(widthMm, unit), pageHeightMm: toDisplay(heightMm, unit) }));
  }

  const geometry: SheetGeometry = {
    ...(Object.fromEntries(LENGTH_FIELDS.map((f) => [f.key, toMm(lengths[f.key] ?? "", unit)])) as Pick<SheetGeometry, (typeof LENGTH_FIELDS)[number]["key"]>),
    rows: Number(rows),
    columns: Number(columns),
    preferredFontPt: Number(preferredFontPt),
    minFontPt: Number(minFontPt),
    lineHeight: Number(lineHeight),
  } as SheetGeometry;
  const problems = Object.values(lengths).some((v) => v.trim() === "") ? ["Fill in every measurement."] : validateGeometry(geometry);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveLabelSheet(sheet?.id ?? null, { name, productCode, ...geometry, measurementNote: note });
      if (!result.ok) setError(result.error);
      else onDone();
    });
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-text">{sheet ? `Edit "${sheet.name}"` : "New label sheet"}</h2>
        <div className="flex items-center gap-1 text-sm" role="group" aria-label="Units">
          {(["in", "mm"] as const).map((u) => (
            <button key={u} type="button" onClick={() => switchUnit(u)} className={`rounded-full px-3 py-1 font-semibold ${unit === u ? "bg-primary text-white" : "bg-black/5 text-text-muted"}`}>
              {u === "in" ? "Inches" : "Millimetres"}
            </button>
          ))}
        </div>
      </div>
      {sheet && <p className="text-xs text-text-muted">Saving changed measurements makes version {sheet.version + 1}. Batches already printed keep the version they used.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="mb-1 block text-xs uppercase">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. 30 address labels, Letter" />
        </div>
        <div>
          <Label className="mb-1 block text-xs uppercase">Brand / product number (optional)</Label>
          <Input value={productCode} onChange={(e) => setProductCode(e.target.value)} maxLength={40} placeholder="For your reference only" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="self-center text-text-muted">Page size:</span>
        <Button type="button" variant="ghost" onClick={() => setPage(215.9, 279.4)}>
          US Letter
        </Button>
        <Button type="button" variant="ghost" onClick={() => setPage(210, 297)}>
          A4
        </Button>
        <span className="self-center text-text-muted">or type a custom size below.</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {LENGTH_FIELDS.map((f) => (
          <div key={f.key}>
            <Label className="mb-1 block text-xs">
              {f.label} ({unit})
            </Label>
            <Input inputMode="decimal" value={lengths[f.key] ?? ""} onChange={(e) => setLengths((c) => ({ ...c, [f.key]: e.target.value }))} />
            {f.help && <p className="mt-0.5 text-[11px] text-text-muted">{f.help}</p>}
          </div>
        ))}
        <div>
          <Label className="mb-1 block text-xs">Rows</Label>
          <Input inputMode="numeric" value={rows} onChange={(e) => setRows(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block text-xs">Columns</Label>
          <Input inputMode="numeric" value={columns} onChange={(e) => setColumns(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block text-xs">Line height (x font size)</Label>
          <Input inputMode="decimal" value={lineHeight} onChange={(e) => setLineHeight(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block text-xs">Preferred text size (pt)</Label>
          <Input inputMode="decimal" value={preferredFontPt} onChange={(e) => setPreferred(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block text-xs">Smallest text size (pt)</Label>
          <Input inputMode="decimal" value={minFontPt} onChange={(e) => setMin(e.target.value)} />
          <p className="mt-0.5 text-[11px] text-text-muted">Long addresses shrink down to this, never smaller.</p>
        </div>
      </div>
      <div>
        <Label className="mb-1 block text-xs uppercase">Where the measurements came from</Label>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Measured with a ruler from our sheet, 6 Nov 2026" />
      </div>
      {problems.length > 0 && (
        <ul className="list-inside list-disc text-xs font-semibold text-danger">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="button" disabled={pending || problems.length > 0 || !name.trim()} onClick={submit}>
          {pending ? "Saving..." : "Save sheet"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

export function LabelSheetManager({ sheets, settings }: { sheets: Sheet[]; settings: { maxLabelsPerBatch: number; retentionDays: number } }) {
  const [editing, setEditing] = useState<Sheet | "new" | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [maxLabels, setMaxLabels] = useState(String(settings.maxLabelsPerBatch));
  const [retention, setRetention] = useState(String(settings.retentionDays));

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? { tone: "success", text: success } : { tone: "danger", text: result.error ?? "That didn't work." });
    });
  }

  return (
    <div className="space-y-6">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {editing ? (
        <SheetForm sheet={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <Button type="button" onClick={() => setEditing("new")}>
          Add a label sheet
        </Button>
      )}

      {sheets.length === 0 && !editing && (
        <Card className="text-sm text-text-muted">
          No label sheets yet. Add one with the measurements of the labels you have. No measurements are built in, because manufacturers don&apos;t publish full
          margin and spacing details for every product, and a guess wastes labels.
        </Card>
      )}

      {sheets.map((sheet) => (
        <Card key={sheet.id} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold text-text">
              {sheet.name} {sheet.productCode && <span className="text-xs font-normal text-text-muted">· {sheet.productCode}</span>}
            </p>
            <Badge tone={sheet.active ? "success" : "neutral"}>{sheet.active ? "Active" : "Inactive"}</Badge>
          </div>
          <p className="text-xs text-text-muted">
            {sheet.geometry.rows * sheet.geometry.columns} labels ({sheet.geometry.columns} across, {sheet.geometry.rows} down), each {toDisplay(sheet.geometry.labelWidthMm, "in")}&quot; ×{" "}
            {toDisplay(sheet.geometry.labelHeightMm, "in")}&quot; ({Math.round(sheet.geometry.labelWidthMm * 10) / 10} × {Math.round(sheet.geometry.labelHeightMm * 10) / 10} mm), page{" "}
            {Math.round(sheet.geometry.pageWidthMm * 10) / 10} × {Math.round(sheet.geometry.pageHeightMm * 10) / 10} mm · text {sheet.geometry.preferredFontPt} pt (down to {sheet.geometry.minFontPt}) · version {sheet.version}
          </p>
          {sheet.measurementNote && <p className="text-xs text-text-muted">Measurements: {sheet.measurementNote}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(sheet)}>
              Edit
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => duplicateLabelSheet(sheet.id), `Copied "${sheet.name}".`)}>
              Duplicate
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => setLabelSheetActive(sheet.id, !sheet.active), sheet.active ? "Sheet made inactive." : "Sheet made active.")}>
              {sheet.active ? "Make inactive" : "Make active"}
            </Button>
            <a className="self-center text-sm font-semibold text-primary underline" href={`/api/mailing-labels/calibration?templateId=${sheet.id}`} target="_blank" rel="noopener">
              Calibration page (PDF)
            </a>
          </div>
        </Card>
      ))}

      <Card className="space-y-3">
        <h2 className="text-lg font-bold text-text">Mailing label settings</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1 block text-xs uppercase">Most labels in one job</Label>
            <Input inputMode="numeric" value={maxLabels} onChange={(e) => setMaxLabels(e.target.value)} />
            <p className="mt-0.5 text-[11px] text-text-muted">Bigger jobs are refused with a note to narrow the filters, never cut short.</p>
          </div>
          <div>
            <Label className="mb-1 block text-xs uppercase">Keep names and addresses on past batches for (days)</Label>
            <Input inputMode="numeric" value={retention} onChange={(e) => setRetention(e.target.value)} />
            <p className="mt-0.5 text-[11px] text-text-muted">After this, a batch keeps its counts and settings but its names and addresses are cleared and it can&apos;t be reprinted.</p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => saveMailingLabelSettings({ maxLabelsPerBatch: maxLabels, retentionDays: retention }), "Settings saved.")}
        >
          Save settings
        </Button>
        <p className="text-xs text-text-muted">
          Labels leave the country line off for mail within the workspace&apos;s default country (Settings → Workspace) and add it for the other country.
        </p>
      </Card>
    </div>
  );
}
