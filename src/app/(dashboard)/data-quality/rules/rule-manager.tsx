"use client";

import { useState, useTransition } from "react";
import { Pencil, CirclePlus, ArrowUp, ArrowDown, Archive, ArchiveRestore } from "lucide-react";
import { createRule, updateRule, setRuleEnabled, reorderRule, archiveRule, restoreRule } from "./actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label, Input, Select, Textarea, FieldError, HelpText } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ACTIVE_TONE, DATA_QUALITY_SEVERITY_TONE, toneFor, humanizeEnum } from "@/lib/ui/status-tones";

export type RuleRow = {
  id: string;
  name: string;
  description: string | null;
  entityType: "COMPANY" | "CONTACT";
  field: string;
  ruleType: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  enabled: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
  archivedAt: string | null;
};

const RULE_TYPES = [
  "REQUIRED_FIELD",
  "INVALID_EMAIL_FORMAT",
  "INVALID_PHONE_FORMAT",
  "INVALID_URL_FORMAT",
  "DUPLICATE_EXACT_MATCH",
  "DUPLICATE_NORMALIZED_MATCH",
  "DUPLICATE_FUZZY_MATCH",
  "STALE_RECORD",
  "CUSTOM_REVIEW_FLAG",
] as const;

function RuleFields({ defaultValues }: { defaultValues?: Partial<RuleRow> }) {
  const [ruleType, setRuleType] = useState(defaultValues?.ruleType ?? "REQUIRED_FIELD");

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label>Name</Label>
        <Input name="name" defaultValue={defaultValues?.name ?? ""} required className="mt-1" />
      </div>
      <div className="sm:col-span-2">
        <Label>Description (optional)</Label>
        <Textarea name="description" defaultValue={defaultValues?.description ?? ""} rows={2} className="mt-1" />
      </div>
      <div>
        <Label>Entity type</Label>
        <Select name="entityType" defaultValue={defaultValues?.entityType ?? "COMPANY"} className="mt-1">
          <option value="COMPANY">Company</option>
          <option value="CONTACT">Contact</option>
        </Select>
      </div>
      <div>
        <Label>Field</Label>
        <Input name="field" defaultValue={defaultValues?.field ?? ""} placeholder="e.g. phone, email, name" required className="mt-1" />
        <HelpText>The record field this rule checks — ignored by duplicate-match rule types.</HelpText>
      </div>
      <div>
        <Label>Rule type</Label>
        <Select name="ruleType" defaultValue={defaultValues?.ruleType ?? "REQUIRED_FIELD"} className="mt-1" onChange={(e) => setRuleType(e.target.value)}>
          {RULE_TYPES.map((type) => (
            <option key={type} value={type}>
              {humanizeEnum(type)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Severity</Label>
        <Select name="severity" defaultValue={defaultValues?.severity ?? "MEDIUM"} className="mt-1">
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </Select>
      </div>
      {ruleType === "DUPLICATE_FUZZY_MATCH" && (
        <div>
          <Label>Minimum similarity (0–100)</Label>
          <Input name="minSimilarity" type="number" min={0} max={100} defaultValue={(defaultValues?.config?.minSimilarity as number) ?? 85} className="mt-1" />
        </div>
      )}
      {ruleType === "STALE_RECORD" && (
        <div>
          <Label>Stale after (days)</Label>
          <Input name="staleDays" type="number" min={1} defaultValue={(defaultValues?.config?.staleDays as number) ?? 180} className="mt-1" />
        </div>
      )}
    </div>
  );
}

export function RuleManager({ rules }: { rules: RuleRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleUpdate(id: string, formData: FormData) {
    startTransition(async () => {
      const result = await updateRule(id, formData);
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
      const result = await createRule(undefined, formData);
      if (result?.error) {
        setAddError(result.error);
      } else {
        setAddError(undefined);
        setAdding(false);
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/5 text-xs uppercase text-text-muted">
            <tr>
              <th className="px-4 py-3">Rule</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) =>
              editingId === rule.id ? (
                <tr key={rule.id} className="border-t border-border align-top">
                  <td colSpan={6} className="p-4">
                    <form action={(formData) => handleUpdate(rule.id, formData)} className="space-y-3">
                      <RuleFields defaultValues={rule} />
                      {rowErrors[rule.id] && <FieldError>{rowErrors[rule.id]}</FieldError>}
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
                <tr key={rule.id} className={`border-t border-border ${rule.archivedAt ? "opacity-60" : ""}`}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-text">{rule.name}</p>
                    {rule.description && <p className="text-xs text-text-muted">{rule.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{humanizeEnum(rule.entityType)}</td>
                  <td className="px-4 py-3 text-text-muted">{humanizeEnum(rule.ruleType)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={toneFor(DATA_QUALITY_SEVERITY_TONE, rule.severity)}>{humanizeEnum(rule.severity)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={isPending || !!rule.archivedAt}
                      onClick={() => startTransition(() => setRuleEnabled(rule.id, !rule.enabled))}
                    >
                      <Badge tone={ACTIVE_TONE[rule.enabled ? "active" : "inactive"]}>{rule.enabled ? "Enabled" : "Disabled"}</Badge>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button type="button" disabled={isPending} onClick={() => startTransition(() => reorderRule(rule.id, "up"))} className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text" aria-label={`Move ${rule.name} up`}>
                        <ArrowUp size={16} />
                      </button>
                      <button type="button" disabled={isPending} onClick={() => startTransition(() => reorderRule(rule.id, "down"))} className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text" aria-label={`Move ${rule.name} down`}>
                        <ArrowDown size={16} />
                      </button>
                      <button type="button" onClick={() => setEditingId(rule.id)} className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text" aria-label={`Edit ${rule.name}`}>
                        <Pencil size={16} />
                      </button>
                      {rule.archivedAt ? (
                        <button type="button" disabled={isPending} onClick={() => startTransition(() => restoreRule(rule.id))} className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text" aria-label={`Restore ${rule.name}`}>
                          <ArchiveRestore size={16} />
                        </button>
                      ) : (
                        <button type="button" disabled={isPending} onClick={() => startTransition(() => archiveRule(rule.id))} className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger" aria-label={`Archive ${rule.name}`}>
                          <Archive size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ),
            )}
            {rules.length === 0 && !adding && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  No rules yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {adding ? (
        <Card className="space-y-3">
          <form action={handleCreate} className="space-y-3">
            <RuleFields />
            {addError && <FieldError>{addError}</FieldError>}
            <div className="flex gap-2">
              <Button type="submit" disabled={isPending} variant="primary">
                Add rule
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
          Add rule
        </Button>
      )}
    </div>
  );
}
