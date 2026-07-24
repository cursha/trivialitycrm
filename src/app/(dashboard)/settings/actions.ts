"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { formString } from "@/lib/form-data";

export type ActionResult = { error?: string } | undefined;

const optionalHour = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((value) => (value ? Number(value) : undefined))
  .refine((value) => value === undefined || (Number.isInteger(value) && value >= 0 && value <= 23), { error: "Must be an hour from 0 to 23." });

const WorkspaceSettingsFormSchema = z
  .object({
    noActivityThresholdDays: z.coerce.number().int().min(1).max(365),
    newlyAssignedThresholdDays: z.coerce.number().int().min(1).max(365),
    mailingAddress: z.string().max(500).optional(),
    // Module Nine: business-wide quiet hours for CRM-outreach email — both
    // set = enabled, both blank = disabled. Transactional/system email is
    // exempt (see src/lib/comms/quiet-hours.ts).
    quietHoursStartHour: optionalHour,
    quietHoursEndHour: optionalHour,
  })
  .refine((value) => (value.quietHoursStartHour === undefined) === (value.quietHoursEndHour === undefined), {
    error: "Set both quiet-hours fields, or leave both blank to disable quiet hours.",
    path: ["quietHoursStartHour"],
  });

export async function updateWorkspaceSettings(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "manage_settings");

  const mailingAddress = formString(formData, "mailingAddress").trim();
  const parsed = WorkspaceSettingsFormSchema.safeParse({
    noActivityThresholdDays: formString(formData, "noActivityThresholdDays"),
    newlyAssignedThresholdDays: formString(formData, "newlyAssignedThresholdDays"),
    mailingAddress: mailingAddress || undefined,
    quietHoursStartHour: formString(formData, "quietHoursStartHour"),
    quietHoursEndHour: formString(formData, "quietHoursEndHour"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter valid numbers of days." };
  }

  await prisma.workspaceSettings.upsert({
    where: { id: 1 },
    update: {
      ...parsed.data,
      mailingAddress: parsed.data.mailingAddress ?? null,
      quietHoursStartHour: parsed.data.quietHoursStartHour ?? null,
      quietHoursEndHour: parsed.data.quietHoursEndHour ?? null,
    },
    create: { id: 1, ...parsed.data },
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
}
