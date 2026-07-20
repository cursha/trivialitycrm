"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { changeCompanyStage } from "@/app/(dashboard)/companies/actions";
import { Alert } from "@/components/ui/alert";
import { CompanyCard, type StageOption } from "./company-card";
import type { BoardColumn } from "./queries";

function DraggableCard({ card, stages, canEdit }: { card: BoardColumn["cards"][number]; stages: StageOption[]; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 10 : undefined }
    : undefined;

  return (
    <div ref={setNodeRef} style={style}>
      <CompanyCard card={card} stages={stages} canEdit={canEdit} dragHandleProps={canEdit ? { ...attributes, ...listeners } : undefined} />
    </div>
  );
}

function DroppableColumn({ column, stages, canEdit }: { column: BoardColumn; stages: StageOption[]; canEdit: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-80 shrink-0 flex-col rounded-2xl border p-3 ${
        isOver ? "border-focus bg-focus/5" : "border-border-strong bg-black/[0.02]"
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="font-bold text-accent">{column.name}</h3>
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-text-muted">{column.cards.length}</span>
      </div>
      <div className="space-y-3 overflow-y-auto">
        {column.cards.map((card) => (
          <DraggableCard key={card.id} card={card} stages={stages} canEdit={canEdit} />
        ))}
        {column.cards.length === 0 && <p className="px-1 text-xs text-text-muted">No companies in this stage.</p>}
      </div>
    </div>
  );
}

export function Board({ columns: initialColumns, canEdit }: { columns: BoardColumn[]; canEdit: boolean }) {
  const router = useRouter();
  // Reset local (optimistic) state when the server gives us fresh columns
  // — the React-recommended "adjust state during render" pattern, not an
  // effect, so there's no extra render pass.
  const [prevInitialColumns, setPrevInitialColumns] = useState(initialColumns);
  const [columns, setColumns] = useState(initialColumns);
  if (initialColumns !== prevInitialColumns) {
    setPrevInitialColumns(initialColumns);
    setColumns(initialColumns);
  }
  const [error, setError] = useState<string | undefined>();
  const [mobileStageId, setMobileStageId] = useState(initialColumns[0]?.id ?? "");

  const stages: StageOption[] = columns.map((c) => ({ id: c.id, name: c.name, active: c.active }));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    if (!canEdit) return;
    const { active, over } = event;
    if (!over) return;

    const cardId = String(active.id);
    const targetStageId = String(over.id);

    const sourceColumn = columns.find((c) => c.cards.some((card) => card.id === cardId));
    if (!sourceColumn || sourceColumn.id === targetStageId) return;
    const card = sourceColumn.cards.find((c) => c.id === cardId);
    if (!card) return;

    // Optimistic move, with rollback on failure.
    setError(undefined);
    setColumns((prev) =>
      prev.map((column) => {
        if (column.id === sourceColumn.id) return { ...column, cards: column.cards.filter((c) => c.id !== cardId) };
        if (column.id === targetStageId) return { ...column, cards: [...column.cards, { ...card, pipelineStageId: targetStageId }] };
        return column;
      }),
    );

    changeCompanyStage(cardId, targetStageId).then((result) => {
      if ("error" in result) {
        setColumns(initialColumns);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const mobileColumn = columns.find((c) => c.id === mobileStageId) ?? columns[0];

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}

      {/* Mobile: a single-column stage switcher instead of trying to
          horizontally scroll narrow columns — an accessible alternative to
          drag-and-drop on touch, not just a smaller version of desktop. */}
      <div className="sm:hidden">
        <label className="mb-1 block text-xs font-semibold uppercase text-text-muted" htmlFor="mobile-stage-select">
          Stage
        </label>
        <select
          id="mobile-stage-select"
          value={mobileStageId}
          onChange={(event) => setMobileStageId(event.target.value)}
          className="w-full rounded-lg border border-border-strong bg-surface-raised px-3 py-2 text-sm text-text"
        >
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name} ({column.cards.length})
            </option>
          ))}
        </select>
        {mobileColumn && (
          <div className="mt-3 space-y-3">
            {mobileColumn.cards.map((card) => (
              <CompanyCard key={card.id} card={card} stages={stages} canEdit={canEdit} />
            ))}
            {mobileColumn.cards.length === 0 && <p className="text-sm text-text-muted">No companies in this stage.</p>}
          </div>
        )}
      </div>

      <div className="hidden sm:block">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {columns.map((column) => (
              <DroppableColumn key={column.id} column={column} stages={stages} canEdit={canEdit} />
            ))}
          </div>
        </DndContext>
      </div>
    </div>
  );
}
