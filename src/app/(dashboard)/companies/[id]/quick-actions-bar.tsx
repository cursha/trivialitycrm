"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, Mail, Users, FileText, Presentation, FlaskConical, StickyNote, CalendarClock } from "lucide-react";
import { changeCompanyStage } from "../actions";
import { Card } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/field";

export type StageOption = { id: string; name: string; active: boolean };

const QUICK_LINKS = [
  { href: "#activity-panel", label: "Add note", icon: StickyNote },
  { href: "#activity-panel", label: "Log call", icon: Phone },
  { href: "#activity-panel", label: "Log email", icon: Mail },
  { href: "#activity-panel", label: "Log meeting", icon: Users },
  { href: "#activity-panel", label: "Material sent", icon: FileText },
  { href: "#activity-panel", label: "Log demo", icon: Presentation },
  { href: "#activity-panel", label: "Log trial", icon: FlaskConical },
  { href: "#tasks-panel", label: "Follow-up", icon: CalendarClock },
];

export function QuickActionsBar({
  companyId,
  currentStageId,
  stages,
  canEdit,
}: {
  companyId: string;
  currentStageId: string;
  stages: StageOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [stageId, setStageId] = useState(currentStageId);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function handleStageChange(newStageId: string) {
    const previous = stageId;
    setStageId(newStageId);
    setError(undefined);
    startTransition(async () => {
      const result = await changeCompanyStage(companyId, newStageId);
      if ("error" in result) {
        setStageId(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <h2 className="font-bold text-accent">Quick sales actions</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className="flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold text-text hover:bg-black/5"
          >
            <link.icon size={14} />
            {link.label}
          </a>
        ))}
      </div>
      {canEdit && (
        <div className="mt-3 max-w-xs">
          <Label className="text-xs">Change pipeline stage</Label>
          <Select value={stageId} disabled={isPending} onChange={(e) => handleStageChange(e.target.value)} className="mt-1">
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id} disabled={!stage.active && stage.id !== stageId}>
                {stage.name}
              </option>
            ))}
          </Select>
          {error && <p className="mt-1 text-xs font-semibold text-danger">{error}</p>}
        </div>
      )}
    </Card>
  );
}
