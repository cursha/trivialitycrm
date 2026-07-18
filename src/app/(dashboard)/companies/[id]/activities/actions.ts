"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { ActivitySchema } from "@/lib/validation/activity";
import { formString } from "@/lib/form-data";

export type ActivityActionResult = { error?: string } | undefined;

export async function createActivity(
  companyId: string,
  _prevState: ActivityActionResult,
  formData: FormData,
): Promise<ActivityActionResult> {
  const user = await requireUser();
  requirePermission(user, "edit_leads");

  const scope = companyScope(user);
  if (!scope) {
    return { error: "You do not have access to this company." };
  }

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) {
    return { error: "You do not have access to this company." };
  }

  const parsed = ActivitySchema.safeParse({
    type: formString(formData, "type"),
    notes: formString(formData, "notes"),
    outcome: formString(formData, "outcome"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  await prisma.activity.create({
    data: {
      companyId,
      userId: user.id,
      type: parsed.data.type,
      notes: parsed.data.notes ?? null,
      outcome: parsed.data.outcome ?? null,
    },
  });

  revalidatePath(`/companies/${companyId}`);
}
