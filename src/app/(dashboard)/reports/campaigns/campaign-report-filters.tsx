"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input, Select, Label } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { humanizeEnum } from "@/lib/ui/status-tones";

export type CampaignReportCurrentFilters = {
  listId?: string;
  status?: string;
  senderId?: string;
  outcome?: string;
  createdFrom?: string;
  createdTo?: string;
};

const CAMPAIGN_STATUSES = ["DRAFT", "APPROVED", "SCHEDULED", "QUEUED", "SENDING", "COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"];
const RECIPIENT_OUTCOMES = ["PENDING", "ACTIVE", "COMPLETED", "SKIPPED", "STOPPED_OPT_OUT", "STOPPED_STAGE", "STOPPED_REPLY", "CANCELLED"];

export function CampaignReportFilters({
  lists,
  senders,
  currentFilters,
}: {
  lists: { id: string; name: string }[];
  senders: { id: string; name: string }[];
  currentFilters: CampaignReportCurrentFilters;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState(currentFilters);

  function apply() {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) qs.set(key, value);
    }
    router.push(`/reports/campaigns?${qs.toString()}`);
  }

  return (
    <Card className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <Label>List</Label>
          <Select value={filters.listId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, listId: e.target.value }))} className="mt-1">
            <option value="">All lists</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={filters.status ?? ""} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="mt-1">
            <option value="">All statuses</option>
            {CAMPAIGN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanizeEnum(s)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Sender</Label>
          <Select value={filters.senderId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, senderId: e.target.value }))} className="mt-1">
            <option value="">All senders</option>
            {senders.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Recipient outcome</Label>
          <Select value={filters.outcome ?? ""} onChange={(e) => setFilters((f) => ({ ...f, outcome: e.target.value }))} className="mt-1">
            <option value="">All outcomes</option>
            {RECIPIENT_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {humanizeEnum(o)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Created from</Label>
          <Input type="date" value={filters.createdFrom ?? ""} onChange={(e) => setFilters((f) => ({ ...f, createdFrom: e.target.value }))} className="mt-1" />
        </div>
        <div>
          <Label>Created to</Label>
          <Input type="date" value={filters.createdTo ?? ""} onChange={(e) => setFilters((f) => ({ ...f, createdTo: e.target.value }))} className="mt-1" />
        </div>
      </div>
      <Button type="button" onClick={apply}>
        Apply filters
      </Button>
    </Card>
  );
}
