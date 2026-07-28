"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { CompanyCard, type StageOption } from "./company-card";
import { BulkToolbar } from "./bulk-toolbar";
import type { PipelineCardData } from "./queries";

type Option = { id: string; name: string };

export function ListView({
  cards,
  stages,
  canEdit,
  canBulk,
  canRoutePlan,
  salespeople,
  territories,
  page,
  pageCount,
}: {
  cards: PipelineCardData[];
  stages: StageOption[];
  canEdit: boolean;
  canBulk: boolean;
  canRoutePlan: boolean;
  salespeople: Option[];
  territories: Option[];
  page?: number;
  pageCount?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function goToPage(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(target));
    router.push(`${pathname}?${params.toString()}`);
  }

  if (cards.length === 0) {
    return <EmptyState>No companies match this view.</EmptyState>;
  }

  return (
    <div className="space-y-3">
      <BulkToolbar
        selectedIds={Array.from(selected)}
        selectedCompanies={cards.filter((c) => selected.has(c.id)).map((c) => ({ id: c.id, name: c.name }))}
        stages={stages}
        salespeople={salespeople}
        territories={territories}
        canBulk={canBulk}
        canRoutePlan={canRoutePlan}
        onClear={() => setSelected(new Set())}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <CompanyCard
            key={card.id}
            card={card}
            stages={stages}
            canEdit={canEdit}
            selected={selected.has(card.id)}
            onToggleSelect={canBulk ? toggleSelect : undefined}
          />
        ))}
      </div>

      {page !== undefined && pageCount !== undefined && <Pagination page={page} pageCount={pageCount} onNavigate={goToPage} />}
    </div>
  );
}
