"use server";

import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { ONBOARDING_STEPS, visibleOnboardingSteps, type OnboardingStepKey } from "@/lib/onboarding/steps";

export type OnboardingChecklistItem = {
  key: OnboardingStepKey;
  label: string;
  description: string;
  href: string;
  completed: boolean;
};

export async function getOnboardingChecklist(): Promise<{ items: OnboardingChecklistItem[]; completedCount: number }> {
  const user = await requireUser();
  const visible = visibleOnboardingSteps((key) => hasPermission(user, key));

  const completedRows = await prisma.userOnboardingStep.findMany({
    where: { userId: user.id, stepKey: { in: visible.map((s) => s.key) } },
    select: { stepKey: true },
  });
  const completedKeys = new Set(completedRows.map((r) => r.stepKey));

  const items = visible.map((step) => ({
    key: step.key,
    label: step.label,
    description: step.description,
    href: step.href,
    completed: completedKeys.has(step.key),
  }));

  return { items, completedCount: items.filter((i) => i.completed).length };
}

export async function setOnboardingStepCompleted(stepKey: OnboardingStepKey, completed: boolean): Promise<{ error?: string }> {
  const user = await requireUser();

  const step = ONBOARDING_STEPS.find((s) => s.key === stepKey);
  if (!step) return { error: "Unknown onboarding step." };
  if (step.requiresPermission && !hasPermission(user, step.requiresPermission)) {
    return { error: "Forbidden" };
  }

  if (completed) {
    await prisma.userOnboardingStep.upsert({
      where: { userId_stepKey: { userId: user.id, stepKey } },
      update: {},
      create: { userId: user.id, stepKey },
    });
  } else {
    await prisma.userOnboardingStep.deleteMany({ where: { userId: user.id, stepKey } });
  }

  return {};
}
