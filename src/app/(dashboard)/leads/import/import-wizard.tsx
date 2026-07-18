"use client";

import { useRef, useState, useTransition } from "react";
import { IMPORT_TARGET_FIELDS, type ImportTargetField } from "@/lib/validation/import";
import { uploadSpreadsheet, previewImport, commitImport, saveImportTemplate, type PreviewedRow } from "./actions";

type Option = { id: string; name: string };
type Template = { id: string; name: string; mapping: Record<string, string> };

const FIELD_LABELS: Record<ImportTargetField, string> = {
  name: "Company name *",
  address1: "Address",
  city: "City *",
  region: "State/Province *",
  postalCode: "Postal code",
  country: "Country *",
  phone: "Phone",
  email: "Email",
  websiteUrl: "Website",
  contactFirstName: "Contact first name",
  contactLastName: "Contact last name",
  contactPhone: "Contact phone",
  contactEmail: "Contact email",
  contactTitle: "Contact title",
  contactNote: "Contact note",
};

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
  const [result, setResult] = useState<{ importedCount: number; skippedCount: number } | null>(null);

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
      setStep("map");
    });
  }

  function applyTemplate(templateId: string) {
    const template = templates.find((t) => t.id === templateId);
    if (template) setMapping(template.mapping);
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
      setSelected(new Set(previewResult.rows.filter((r) => r.errors.length === 0 && !r.duplicateOf).map((r) => r.index)));
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
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">
        <p className="font-bold">Imported {result.importedCount} row(s). Skipped {result.skippedCount} (invalid or duplicate).</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}

      {step === "upload" && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="text-sm" />
          <div>
            <button type="button" disabled={isPending} onClick={handleUpload} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {isPending ? "Uploading..." : "Upload"}
            </button>
          </div>
        </div>
      )}

      {step === "map" && (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {templates.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Load a saved mapping</label>
              <select onChange={(e) => applyTemplate(e.target.value)} defaultValue="" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Choose a template...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {IMPORT_TARGET_FIELDS.map((field) => (
              <div key={field}>
                <label className="mb-1 block text-xs font-semibold text-slate-500">{FIELD_LABELS[field]}</label>
                <select
                  value={mapping[field] ?? ""}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [field]: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">(not mapped)</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" disabled={isPending} onClick={handlePreview} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {isPending ? "Validating..." : "Preview"}
            </button>
            <SaveTemplateButton mapping={mapping} />
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Lead Type</label>
              <select value={leadTypeId} onChange={(e) => setLeadTypeId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                {leadTypes.map((lt) => (
                  <option key={lt.id} value={lt.id}>
                    {lt.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Pipeline stage</label>
              <select value={pipelineStageId} onChange={(e) => setPipelineStageId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                {pipelineStages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Assign to</label>
              <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                {salespeople.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Import</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Issues</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.index} className="border-t border-slate-100">
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
                    <td className="px-4 py-3 font-semibold">{row.values.name || <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {row.values.city}, {row.values.region}
                    </td>
                    <td className="px-4 py-3">
                      {row.errors.map((e, i) => (
                        <p key={i} className="text-xs font-semibold text-red-600">
                          {e}
                        </p>
                      ))}
                      {row.duplicateOf && <p className="text-xs font-semibold text-amber-600">Possible duplicate of &quot;{row.duplicateOf}&quot;</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button type="button" disabled={isPending || selected.size === 0} onClick={handleCommit} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
            {isPending ? "Importing..." : `Import ${selected.size} row(s)`}
          </button>
        </div>
      )}
    </div>
  );
}

function SaveTemplateButton({ mapping }: { mapping: Record<string, string> }) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Template name"
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
      />
      <button
        type="button"
        disabled={isPending || !name.trim()}
        onClick={() =>
          startTransition(async () => {
            await saveImportTemplate(name, mapping);
            setSaved(true);
          })
        }
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
      >
        {saved ? "Saved" : "Save mapping as template"}
      </button>
    </div>
  );
}
