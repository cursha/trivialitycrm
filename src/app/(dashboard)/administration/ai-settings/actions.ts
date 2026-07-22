"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { AiSettingsSchema } from "@/lib/validation/ai-settings";
import { formString } from "@/lib/form-data";
import { writeAuditEvent } from "@/lib/audit/log";

export type ActionResult = { error?: string } | undefined;

const PATH = "/administration/ai-settings";

export async function updateAiSettings(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "manage_ai_settings");

  const parsed = AiSettingsSchema.safeParse({
    researchEnabled: formString(formData, "researchEnabled"),
    approvedModel: formString(formData, "approvedModel"),
    defaultMinimumScore: formString(formData, "defaultMinimumScore"),
    maxCitiesPerSearch: formString(formData, "maxCitiesPerSearch"),
    maxResultsPerSearch: formString(formData, "maxResultsPerSearch"),
    dailyBudgetUsd: formString(formData, "dailyBudgetUsd"),
    monthlyBudgetUsd: formString(formData, "monthlyBudgetUsd"),
    warningThresholdUsd: formString(formData, "warningThresholdUsd"),
    perUserDailySearchLimit: formString(formData, "perUserDailySearchLimit"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  const before = await prisma.aiSettings.findUnique({ where: { id: 1 } });

  const data = {
    researchEnabled: parsed.data.researchEnabled,
    approvedModel: parsed.data.approvedModel,
    defaultMinimumScore: parsed.data.defaultMinimumScore,
    maxCitiesPerSearch: parsed.data.maxCitiesPerSearch,
    maxResultsPerSearch: parsed.data.maxResultsPerSearch ?? null,
    dailyBudgetUsd: parsed.data.dailyBudgetUsd ?? null,
    monthlyBudgetUsd: parsed.data.monthlyBudgetUsd ?? null,
    warningThresholdUsd: parsed.data.warningThresholdUsd ?? null,
    perUserDailySearchLimit: parsed.data.perUserDailySearchLimit ?? null,
    updatedById: user.id,
  };

  const after = await prisma.aiSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "ai-settings",
    action: "ai_settings.updated",
    entityType: "AiSettings",
    entityId: "1",
    beforeData: before ?? undefined,
    afterData: after,
  });

  revalidatePath(PATH);
  revalidatePath("/administration");
}
