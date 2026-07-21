"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { formString } from "@/lib/form-data";
import { enrollInSequence, pauseEnrollment, resumeEnrollment, cancelEnrollment } from "@/lib/comms/sequences";

export type ActionResult = { error?: string } | undefined;

async function requireCompanyAccess(companyId: string) {
  const user = await requireUser();
  requirePermission(user, "enroll_in_sequences");

  const scope = companyScope(user);
  if (!scope) throw new Error("Forbidden: no access to this company");

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) throw new Error("Forbidden: no access to this company");

  return user;
}

export async function enrollCompanyInSequence(companyId: string, _prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireCompanyAccess(companyId);

  const sequenceId = formString(formData, "sequenceId").trim();
  if (!sequenceId) return { error: "Choose a sequence." };
  const contactId = formString(formData, "contactId").trim() || null;

  const result = await enrollInSequence({ sequenceId, companyId, contactId, enrolledById: user.id });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/companies/${companyId}`);
}

export async function pauseCompanyEnrollment(companyId: string, enrollmentId: string): Promise<void> {
  await requireCompanyAccess(companyId);
  await pauseEnrollment(enrollmentId);
  revalidatePath(`/companies/${companyId}`);
}

export async function resumeCompanyEnrollment(companyId: string, enrollmentId: string): Promise<void> {
  await requireCompanyAccess(companyId);
  await resumeEnrollment(enrollmentId);
  revalidatePath(`/companies/${companyId}`);
}

export async function cancelCompanyEnrollment(companyId: string, enrollmentId: string): Promise<void> {
  await requireCompanyAccess(companyId);
  await cancelEnrollment(enrollmentId);
  revalidatePath(`/companies/${companyId}`);
}
