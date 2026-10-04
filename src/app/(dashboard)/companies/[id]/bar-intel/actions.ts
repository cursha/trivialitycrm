"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { BarIntelSchema } from "@/lib/validation/visit";
import { formString } from "@/lib/form-data";

export type BarIntelActionResult = { error?: string } | undefined;

/**
 * Saves the company page's Bar intel card. Unlike the visit form (which
 * only ever fills in non-blank values), this is the full editor: a blank
 * field here deliberately clears the stored value.
 */
export async function updateBarIntel(companyId: string, formData: FormData): Promise<BarIntelActionResult> {
  const user = await requireUser();
  requirePermission(user, "edit_leads");

  const scope = companyScope(user);
  if (!scope) return { error: "You do not have access to this company." };
  const company = await prisma.company.findFirst({ where: { id: companyId, status: "ACTIVE", ...scope }, select: { id: true } });
  if (!company) return { error: "You do not have access to this company." };

  const parsed = BarIntelSchema.safeParse({
    slowNight: formString(formData, "slowNight"),
    slowNightHeadcount: formString(formData, "slowNightHeadcount"),
    currentEntertainment: formString(formData, "currentEntertainment"),
    triviaHistory: formString(formData, "triviaHistory"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  await prisma.company.update({
    where: { id: companyId },
    data: {
      slowNight: parsed.data.slowNight ?? null,
      slowNightHeadcount: parsed.data.slowNightHeadcount ?? null,
      currentEntertainment: parsed.data.currentEntertainment ?? null,
      triviaHistory: parsed.data.triviaHistory ?? null,
      updatedById: user.id,
    },
  });

  revalidatePath(`/companies/${companyId}`);
}
