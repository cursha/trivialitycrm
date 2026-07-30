"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Input, Textarea, Select, Label, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { createCampaign, type CampaignStepInput } from "../actions";

let stepKeySeq = 0;
type StepRow = CampaignStepInput & { key: number };

export function CreateCampaignForm({
  listId,
  reusableInstructions,
  emailTemplates,
  pipelineStages,
}: {
  listId: string;
  reusableInstructions: { id: string; name: string }[];
  emailTemplates: { id: string; name: string }[];
  pipelineStages: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [campaignInstructions, setCampaignInstructions] = useState("");
  const [reusableInstructionsId, setReusableInstructionsId] = useState("");
  const [emailTemplateId, setEmailTemplateId] = useState("");
  const [stopStageIds, setStopStageIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<StepRow[]>([{ key: stepKeySeq++, waitDays: 0, instructions: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function addStep() {
    setSteps((prev) => [...prev, { key: stepKeySeq++, waitDays: 3, instructions: "" }]);
  }

  function removeStep(key: number) {
    setSteps((prev) => prev.filter((s) => s.key !== key));
  }

  function updateStep(key: number, patch: Partial<StepRow>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function toggleStopStage(stageId: string) {
    setStopStageIds((prev) => (prev.includes(stageId) ? prev.filter((id) => id !== stageId) : [...prev, stageId]));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createCampaign({
        name,
        listId,
        campaignInstructions,
        reusableInstructionsId: reusableInstructionsId || undefined,
        emailTemplateId: emailTemplateId || undefined,
        stopOnPipelineStageIds: stopStageIds.length > 0 ? stopStageIds : undefined,
        steps: steps.map((s) => ({ instructions: s.instructions, waitDays: s.waitDays })),
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(`/campaigns/${result.id}`);
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">Campaign name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fall trivia night outreach" required />
      </div>

      {reusableInstructions.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="reusableInstructionsId">Reusable instruction set (optional)</Label>
          <Select id="reusableInstructionsId" value={reusableInstructionsId} onChange={(e) => setReusableInstructionsId(e.target.value)}>
            <option value="">None</option>
            {reusableInstructions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {emailTemplates.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="emailTemplateId">Base on a template (optional)</Label>
          <Select id="emailTemplateId" value={emailTemplateId} onChange={(e) => setEmailTemplateId(e.target.value)}>
            <option value="">None</option>
            {emailTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="campaignInstructions">Overall campaign instructions</Label>
        <Textarea
          id="campaignInstructions"
          rows={5}
          value={campaignInstructions}
          onChange={(e) => setCampaignInstructions(e.target.value)}
          placeholder="Tone, offer, and framing for the AI to use when personalizing each message — never invents facts about a company, only writes from what's on file. Falls back for any step that doesn't have its own instructions below."
        />
        <p className="text-xs text-text-muted">
          Provide instructions here, choose a reusable instruction set, or base this on a template — at least one is required.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Steps</Label>
          <Button type="button" variant="ghost" onClick={addStep} disabled={isPending}>
            <Plus size={14} /> Add step
          </Button>
        </div>
        <p className="text-xs text-text-muted">
          A single-email campaign is just one step. Add more to build a sequence — each later step sends the given number of days after the previous one.
        </p>
        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={step.key} className="rounded-lg border border-border-strong p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-text">Step {index + 1}</span>
                {steps.length > 1 && (
                  <button type="button" onClick={() => removeStep(step.key)} className="rounded p-1 text-text-muted hover:bg-danger/10 hover:text-danger" aria-label={`Remove step ${index + 1}`}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {index > 0 && (
                <div className="mb-2 flex items-center gap-2">
                  <Label htmlFor={`wait-${step.key}`} className="text-xs">
                    Days after previous step
                  </Label>
                  <Input
                    id={`wait-${step.key}`}
                    type="number"
                    min={0}
                    className="w-24"
                    value={step.waitDays}
                    onChange={(e) => updateStep(step.key, { waitDays: Number(e.target.value) })}
                  />
                </div>
              )}
              <Textarea
                rows={3}
                value={step.instructions}
                onChange={(e) => updateStep(step.key, { instructions: e.target.value })}
                placeholder={index === 0 ? "This step's specific guidance (optional — falls back to the overall instructions above)." : "e.g. A friendly reminder referencing the earlier email, if they haven't replied."}
              />
            </div>
          ))}
        </div>
      </div>

      {pipelineStages.length > 0 && (
        <div className="space-y-1.5">
          <Label>Stop sending if a company reaches (optional)</Label>
          <div className="flex flex-wrap gap-3">
            {pipelineStages.map((stage) => (
              <label key={stage.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={stopStageIds.includes(stage.id)} onChange={() => toggleStopStage(stage.id)} />
                {stage.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <FieldError>{error}</FieldError>}

      <Button type="button" onClick={submit} disabled={isPending || !name.trim()}>
        {isPending ? "Creating..." : "Create campaign"}
      </Button>
    </div>
  );
}
