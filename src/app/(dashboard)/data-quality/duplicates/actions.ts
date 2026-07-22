"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser, type AuthenticatedUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { mergeCompanies, CompanyMergeError, CompanyFieldDecisionsSchema } from "@/lib/data-quality/merge-company";
import { mergeContacts, ContactMergeError, ContactFieldDecisionsSchema } from "@/lib/data-quality/merge-contact";

export type DuplicateActionResult = { error?: string } | undefined;

const LIST_PATH = "/data-quality/duplicates";

async function requireReviewer(): Promise<AuthenticatedUser> {
  const user = await requireUser();
  requirePermission(user, "review_data_quality");
  return user;
}

async function currentFieldSnapshot(pair: { entityType: "COMPANY" | "CONTACT"; companyAId: string | null; companyBId: string | null; contactAId: string | null; contactBId: string | null }) {
  if (pair.entityType === "COMPANY" && pair.companyAId) {
    const a = await prisma.company.findUnique({ where: { id: pair.companyAId }, select: { normalizedName: true, normalizedEmail: true, normalizedPhone: true, websiteDomain: true } });
    return { name: a?.normalizedName ?? null, email: a?.normalizedEmail ?? null, phone: a?.normalizedPhone ?? null, websiteDomain: a?.websiteDomain ?? null };
  }
  if (pair.entityType === "CONTACT" && pair.contactAId) {
    const a = await prisma.contact.findUnique({ where: { id: pair.contactAId }, select: { normalizedFirstName: true, normalizedLastName: true, normalizedEmail: true, normalizedPhone: true } });
    return { email: a?.normalizedEmail ?? null, phone: a?.normalizedPhone ?? null, name: `${a?.normalizedFirstName ?? ""} ${a?.normalizedLastName ?? ""}` };
  }
  return {};
}

export async function setDuplicateStatus(id: string, status: "NOT_DUPLICATE" | "CONFIRMED" | "DEFERRED", note?: string): Promise<DuplicateActionResult> {
  const user = await requireReviewer();
  const pair = await prisma.potentialDuplicate.findUnique({ where: { id } });
  if (!pair) return { error: "Not found." };

  const dismissedFieldsSnapshot = status === "NOT_DUPLICATE" ? await currentFieldSnapshot(pair) : undefined;

  await prisma.potentialDuplicate.update({
    where: { id },
    data: {
      status,
      reviewNote: note ?? pair.reviewNote,
      reviewedAt: new Date(),
      reviewedById: user.id,
      ...(dismissedFieldsSnapshot ? { dismissedFieldsSnapshot: dismissedFieldsSnapshot as never } : {}),
    },
  });

  await prisma.dataQualityAuditEvent.create({ data: { action: "DUPLICATE_REVIEWED", actorId: user.id, potentialDuplicateId: id, afterData: { status } as never } });

  revalidatePath(LIST_PATH);
  return undefined;
}

export async function assignDuplicate(id: string, assignedToId: string | null): Promise<DuplicateActionResult> {
  await requireReviewer();
  await prisma.potentialDuplicate.update({ where: { id }, data: { assignedToId } });
  revalidatePath(LIST_PATH);
  return undefined;
}

export async function mergeCompanyDuplicate(
  potentialDuplicateId: string,
  survivingCompanyId: string,
  mergedCompanyId: string,
  fieldDecisionsRaw: Record<string, string>,
  eosChoice: "surviving" | "merged",
): Promise<DuplicateActionResult> {
  const user = await requireUser();
  requirePermission(user, "merge_companies");

  const parsedFields = CompanyFieldDecisionsSchema.safeParse(fieldDecisionsRaw);
  if (!parsedFields.success) return { error: "Invalid field decisions." };

  try {
    await mergeCompanies({
      survivingCompanyId,
      mergedCompanyId,
      fieldDecisions: parsedFields.data,
      eosChoice,
      actorId: user.id,
      potentialDuplicateId,
    });
  } catch (error) {
    if (error instanceof CompanyMergeError) return { error: error.message };
    throw error;
  }

  revalidatePath(LIST_PATH);
  revalidatePath(`/companies/${survivingCompanyId}`);
  redirect(`/companies/${survivingCompanyId}`);
}

export async function mergeContactDuplicate(
  potentialDuplicateId: string,
  survivingContactId: string,
  mergedContactId: string,
  fieldDecisionsRaw: Record<string, string>,
  companyId: string,
): Promise<DuplicateActionResult> {
  const user = await requireUser();
  requirePermission(user, "merge_contacts");

  const parsedFields = ContactFieldDecisionsSchema.safeParse(fieldDecisionsRaw);
  if (!parsedFields.success) return { error: "Invalid field decisions." };

  try {
    await mergeContacts({
      survivingContactId,
      mergedContactId,
      fieldDecisions: parsedFields.data,
      actorId: user.id,
      potentialDuplicateId,
    });
  } catch (error) {
    if (error instanceof ContactMergeError) return { error: error.message };
    throw error;
  }

  revalidatePath(LIST_PATH);
  revalidatePath(`/companies/${companyId}`);
  redirect(`/companies/${companyId}`);
}
