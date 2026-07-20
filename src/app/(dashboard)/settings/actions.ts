"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { formString } from "@/lib/form-data";

export type ActionResult = { error?: string } | undefined;

const WorkspaceSettingsFormSchema = z.object({
  noActivityThresholdDays: z.coerce.number().int().min(1).max(365),
  newlyAssignedThresholdDays: z.coerce.number().int().min(1).max(365),
});

export async function updateWorkspaceSettings(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "manage_settings");

  const parsed = WorkspaceSettingsFormSchema.safeParse({
    noActivityThresholdDays: formString(formData, "noActivityThresholdDays"),
    newlyAssignedThresholdDays: formString(formData, "newlyAssignedThresholdDays"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter valid numbers of days." };
  }

  await prisma.workspaceSettings.upsert({
    where: { id: 1 },
    update: parsed.data,
    create: { id: 1, ...parsed.data },
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
}
