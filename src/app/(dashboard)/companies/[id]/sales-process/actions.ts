"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { SalesTrackValues } from "@/lib/validation/company";

export type SalesTrackResult = { error?: string } | undefined;

/**
 * Switches a company between the Local and Long-distance sales process.
 * Only changes which playbook and automatic follow-ups apply from here on;
 * follow-ups already created stay as they are.
 */
export async function setSalesTrack(companyId: string, track: string): Promise<SalesTrackResult> {
  const user = await requireUser();
  requirePermission(user, "edit_leads");

  const salesTrack = SalesTrackValues.find((value) => value === track);
  if (!salesTrack) return { error: "Choose Local or Long-distance." };

  const scope = companyScope(user);
  if (!scope) return { error: "You do not have access to this company." };
  const company = await prisma.company.findFirst({ where: { id: companyId, status: "ACTIVE", ...scope }, select: { id: true } });
  if (!company) return { error: "You do not have access to this company." };

  await prisma.company.update({ where: { id: companyId }, data: { salesTrack, updatedById: user.id } });
  revalidatePath(`/companies/${companyId}`);
}
