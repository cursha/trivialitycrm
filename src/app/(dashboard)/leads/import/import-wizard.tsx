"use client";

import { useRef, useState, useTransition } from "react";
import { IMPORT_TARGET_FIELDS, IMPORT_FIELD_LABELS, autoMapHeaders, type ImportTargetField } from "@/lib/validation/import";
import { uploadSpreadsheet, previewImport, commitImport, saveImportTemplate, type PreviewedRow, type PreviewedMatch } from "./actions";
import { Card } from "@/components/ui/card";
import { Label, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

type Option = { id: string; name: string };
type Template = { id: string; name: string; mapping: Record<string, string> };

// The research fields get their own heading on the mapping screen.
const FIRST_RESEARCH_FIELD = IMPORT_TARGET_FIELDS.indexOf("notes");

export function ImportWizard({
  leadTypes,
  pipelineStages,
  defaultPipelineStageId,
  salespeople,
  templates,
}: {
  leadTypes: Option[];
  pipelineStages: Option[];
  defaultPipelineStageId: string;
  salespeople: Option[];
  templates: Template[];
}) {
  const [step, setStep] = useState<"upload" | "map" | "preview" | "done">("upload");
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<PreviewedRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [leadTypeId, setLeadTypeId] = useState(leadTypes[0]?.id ?? "");
  const [pipelineStageId, setPipelineStageId] = useState(defaultPipelineStageId);
  const [assignedToId, setAssignedToId] = useState(salespeople[0]?.id ?? "");
  const [result, setResult] = useState<{ importedCount: number; updatedCount: number; skippedCount: number } | null>(null);

  function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setError(undefined);
    const formData = new FormData();
    formData.set("file", file);

    startTransition(async () => {
      const uploadResult = await uploadSpreadsheet(formData);
      if ("error" in uploadResult) {
        setError(uploadResult.error);
        return;
      }
      setSessionId(uploadResult.sessionId);
      setHeaders(uploadResult.headers);
      setMapping(autoMapHeaders(uploadResult.headers));
      setStep("map");
    });
  }

  function applyTemplate(templateId: string) {
    const template = templates.find((t) => t.id === templateId);
    // A template saved before a field existed doesn't map it, so columns
    // named exactly like a field still map themselves underneath.
    if (template) setMapping({ ...autoMapHeaders(headers), ...template.mapping });
  }

  function handlePreview() {
    if (!sessionId) return;
    setError(undefined);
    startTransition(async () => {
      const previewResult = await previewImport(sessionId, mapping);
      if ("error" in previewResult) {
        setError(previewResult.error);
        return;
      }
      setRows(previewResult.rows);
      // Rows matching a company already in the CRM are selected too: they
      // only ever fill in what's empty there.
      setSelected(new Set(previewResult.rows.filter((r) => r.errors.length === 0).map((r) => r.index)));
      setStep("preview");
    });
  }

  function handleCommit() {
    if (!sessionId) return;
    setError(undefined);
    startTransition(async () => {
      const commitResult = await commitImport(sessionId, mapping, Array.from(selected), leadTypeId, pipelineStageId, assignedToId);
      if ("error" in commitResult) {
        setError(commitResult.error);
        return;
      }
      setResult(commitResult);
      setStep("done");
    });
  }

  if (step === "done" && result) {
    return (
      <Alert tone="success" className="block p-6 text-base">
        Imported {result.importedCount} new {result.importedCount === 1 ? "company" : "companies"}. Updated {result.updatedCount} already in the CRM
        (empty fields filled in). Skipped {result.skippedCount} (already in the CRM with nothing new to add, or invalid).
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      {step === "upload" && (
        <Card className="space-y-3">
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="text-sm text-text" />
          <div>
            <Button type="button" disabled={isPending} onClick={handleUpload} variant="primary">
              {isPending ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </Card>
      )}

      {step === "map" && (
        <Card className="space-y-4">
          {templates.length > 0 && (
            <div>
              <Label className="mb-1 block text-xs uppercase">Load a saved mapping</Label>
              <Select onChange={(e) => applyTemplate(e.target.value)} defaultValue="">
                <option value="">Choose a template...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <MappingGrid fields={IMPORT_TARGET_FIELDS.slice(0, FIRST_RESEARCH_FIELD)} headers={headers} mapping={mapping} setMapping={setMapping} />
          <div>
            <h3 className="text-sm font-semibold text-text">Lead research</h3>
            <p className="text-xs text-text-muted">Optional. Fills the research details on the company page.</p>
          </div>
          <MappingGrid fields={IMPORT_TARGET_FIELDS.slice(FIRST_RESEARCH_FIELD)} headers={headers} mapping={mapping} setMapping={setMapping} />

          <div className="flex items-center gap-2">
            <Button type="button" disabled={isPending} onClick={handlePreview} variant="primary">
              {isPending ? "Validating..." : "Preview"}
            </Button>
            <SaveTemplateButton mapping={mapping} />
          </div>
        </Card>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <Card className={`grid gap-4 ${leadTypes.length === 1 ? "grid-cols-2" : "grid-cols-3"}`}>
            {/* With a single lead type there's nothing to choose — leadTypeId already holds it. */}
            {leadTypes.length !== 1 && (
              <div>
                <Label className="mb-1 block text-xs uppercase">Lead Type</Label>
                <Select value={leadTypeId} onChange={(e) => setLeadTypeId(e.target.value)} className="py-1.5">
                  {leadTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div>
              <Label className="mb-1 block text-xs uppercase">Pipeline stage</Label>
              <Select value={pipelineStageId} onChange={(e) => setPipelineStageId(e.target.value)} className="py-1.5">
                {pipelineStages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs uppercase">Assign to</Label>
              <Select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="py-1.5">
                {salespeople.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </Select>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <table className="w-full text-left text-sm">
              <thead className="bg-black/5 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-4 py-3">Import</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Issues</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.index} className="border-t border-border">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        disabled={row.errors.length > 0}
                        checked={selected.has(row.index)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.index)) next.delete(row.index);
                            else next.add(row.index);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold text-text">{row.values.name || <span className="text-text-muted">—</span>}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {row.values.city}, {row.values.region}
                    </td>
                    <td className="px-4 py-3">
                      {row.errors.map((e, i) => (
                        <p key={i} className="text-xs font-semibold text-danger">
                          {e}
                        </p>
                      ))}
                      {row.warnings.map((w, i) => (
                        <p key={i} className="text-xs font-semibold text-amber-700">
                          {w}
                        </p>
                      ))}
                      {row.match && <MatchSummary match={row.match} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Button type="button" disabled={isPending || selected.size === 0} onClick={handleCommit} variant="primary" className="px-5 py-2.5">
            {isPending ? "Importing..." : `Import ${selected.size} row(s)`}
          </Button>
        </div>
      )}
    </div>
  );
}

function MappingGrid({
  fields,
  headers,
  mapping,
  setMapping,
}: {
  fields: readonly ImportTargetField[];
  headers: string[];
  mapping: Record<string, string>;
  setMapping: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map((field) => (
        <div key={field}>
          <Label className="mb-1 block text-xs">{IMPORT_FIELD_LABELS[field]}</Label>
          <Select value={mapping[field] ?? ""} onChange={(e) => setMapping((prev) => ({ ...prev, [field]: e.target.value }))} className="py-1.5">
            <option value="">(not mapped)</option>
            {headers.map((header) => (
              <option key={header} value={header}>
                {header}
              </option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  );
}

function MatchSummary({ match }: { match: PreviewedMatch }) {
  const adds = [
    match.fills.length > 0 && `fill in ${match.fills.join(", ")}`,
    match.addsNotes && "add to notes",
    match.addsContact && "add the contact",
  ].filter(Boolean);
  return (
    <p className="text-xs font-semibold text-amber-700">
      Already in the CRM as &quot;{match.name}&quot; ({match.city}).{" "}
      {adds.length > 0 ? `Will ${adds.join("; ")}.` : "Nothing new to add, so it will be skipped."}
    </p>
  );
}

function SaveTemplateButton({ mapping }: { mapping: Record<string, string> }) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" className="py-1.5" />
      <button
        type="button"
        disabled={isPending || !name.trim()}
        onClick={() =>
          startTransition(async () => {
            await saveImportTemplate(name, mapping);
            setSaved(true);
          })
        }
        className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5 disabled:pointer-events-none disabled:opacity-50"
      >
        {saved ? "Saved" : "Save mapping as template"}
      </button>
    </div>
  );
}
