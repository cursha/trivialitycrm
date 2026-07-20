"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, Mail, CalendarClock, MoreVertical } from "lucide-react";
import { changeCompanyStage } from "@/app/(dashboard)/companies/actions";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import clsx from "clsx";
import type { PipelineCardData } from "./queries";

export type StageOption = { id: string; name: string; active: boolean };

export function CompanyCard({
  card,
  stages,
  canEdit,
  dragHandleProps,
  selected,
  onToggleSelect,
}: {
  card: PipelineCardData;
  stages: StageOption[];
  canEdit: boolean;
  dragHandleProps?: Record<string, unknown>;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [stageId, setStageId] = useState(card.pipelineStageId);
  const [error, setError] = useState<string | undefined>();

  function handleStageChange(newStageId: string) {
    const previous = stageId;
    setStageId(newStageId);
    setError(undefined);
    startTransition(async () => {
      const result = await changeCompanyStage(card.id, newStageId);
      if ("error" in result) {
        setStageId(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className="rounded-xl border border-border-strong bg-surface-raised p-3 shadow-sm"
      {...dragHandleProps}
      data-testid={`pipeline-card-${card.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {onToggleSelect && (
            <input
              type="checkbox"
              className="mt-1"
              checked={selected ?? false}
              onChange={() => onToggleSelect(card.id)}
              aria-label={`Select ${card.name}`}
            />
          )}
          <div>
            <Link href={`/companies/${card.id}`} className="font-bold text-secondary hover:underline">
              {card.name}
            </Link>
            <p className="text-xs text-text-muted">
              {card.city}, {card.region}
            </p>
          </div>
        </div>
        <Menu
          align="end"
          trigger={
            <span className="rounded p-1 text-text-muted hover:bg-black/5" aria-label={`Actions for ${card.name}`}>
              <MoreVertical size={16} />
            </span>
          }
          items={[{ label: "Open company record", onSelect: () => router.push(`/companies/${card.id}`) }]}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{card.leadTypeName}</Badge>
        {card.eosScore !== null && <Badge tone="accent">Score {card.eosScore}</Badge>}
        {card.competitorName && <Badge tone="warning">Uses {card.competitorName}</Badge>}
        {card.overdue && <Badge tone="danger">Overdue</Badge>}
      </div>

      <div className="mt-2 space-y-1 text-xs text-text-muted">
        <p>{card.assignedToName ?? "Unassigned"}</p>
        {card.nextFollowUpAt && (
          <p className={clsx("flex items-center gap-1", card.overdue && "font-semibold text-danger")}>
            <CalendarClock size={12} />
            Follow-up {new Date(card.nextFollowUpAt).toLocaleDateString()}
          </p>
        )}
        <p>{card.daysSinceLastActivity === null ? "No activity logged" : `${card.daysSinceLastActivity}d since last activity`}</p>
        {card.contactName && (
          <p className="flex items-center gap-1">
            {card.contactMethod?.type === "phone" ? <Phone size={12} /> : card.contactMethod?.type === "email" ? <Mail size={12} /> : null}
            {card.contactName}
            {card.contactMethod ? ` · ${card.contactMethod.value}` : ""}
          </p>
        )}
      </div>

      {canEdit && (
        <div className="mt-3">
          <Select
            value={stageId}
            disabled={isPending}
            onChange={(event) => handleStageChange(event.target.value)}
            className="py-1 text-xs"
            aria-label={`Change pipeline stage for ${card.name}`}
          >
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id} disabled={!stage.active && stage.id !== stageId}>
                {stage.name}
              </option>
            ))}
          </Select>
          {error && <p className="mt-1 text-xs font-semibold text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
