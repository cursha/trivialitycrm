"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setOnboardingStepCompleted } from "./actions";
import type { OnboardingChecklistItem } from "./actions";
import { Card } from "@/components/ui/card";

export function OnboardingChecklist({ items }: { items: OnboardingChecklistItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const completedCount = items.filter((i) => i.completed).length;

  function toggle(item: OnboardingChecklistItem) {
    setError(null);
    startTransition(async () => {
      const result = await setOnboardingStepCompleted(item.key, !item.completed);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <Card>
        <p className="text-sm text-text-muted">There&apos;s nothing on your getting-started checklist yet.</p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-accent">Getting started</h2>
        <p className="text-sm font-semibold text-text-muted">
          {completedCount} of {items.length} done
        </p>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/5">
        <div
          className="h-full rounded-full bg-secondary transition-all"
          style={{ width: `${items.length === 0 ? 0 : (completedCount / items.length) * 100}%` }}
        />
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-danger">{error}</p>}

      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-3 rounded-lg border border-border-strong p-3">
            <input
              type="checkbox"
              checked={item.completed}
              disabled={isPending}
              onChange={() => toggle(item)}
              aria-label={`Mark "${item.label}" as ${item.completed ? "not done" : "done"}`}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div className="flex-1">
              <p className={`text-sm font-semibold ${item.completed ? "text-text-muted line-through" : "text-text"}`}>{item.label}</p>
              <p className="text-xs text-text-muted">{item.description}</p>
            </div>
            <Link href={item.href} className="shrink-0 whitespace-nowrap text-xs font-semibold text-secondary hover:underline">
              Go
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
