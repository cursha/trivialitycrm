"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope, canAssignTo } from "@/lib/companies/scope";
import { CompanySchema } from "@/lib/validation/company";
import { findPotentialDuplicates, computeNormalizedFields, type DuplicateMatch } from "@/lib/duplicates/match";
import { logAssignmentChange, logPipelineChange, logInitialPipelineStage } from "@/lib/companies/activity-log";
import { formString } from "@/lib/form-data";

export type CompanyFormState = { error?: string; duplicates?: DuplicateMatch[] } | undefined;
export type SimpleActionResult = { error?: string } | undefined;

function parseCompanyForm(formData: FormData) {
  return CompanySchema.safeParse({
    name: formString(formData, "name"),
    address1: formString(formData, "address1"),
    city: formString(formData, "city"),
    region: formString(formData, "region"),
    postalCode: formString(formData, "postalCode"),
    country: formString(formData, "country"),
    phone: formString(formData, "phone"),
    email: formString(formData, "email"),
    websiteUrl: formString(formData, "websiteUrl"),
    leadTypeId: formString(formData, "leadTypeId"),
    pipelineStageId: formString(formData, "pipelineStageId"),
    competitorId: formString(formData, "competitorId"),
    assignedToId: formString(formData, "assignedToId"),
    triviaStatus: formString(formData, "triviaStatus"),
    lossReasonId: formString(formData, "lossReasonId"),
    notes: formString(formData, "notes"),
    nextFollowUpAt: formString(formData, "nextFollowUpAt"),
  });
}

export async function createCompany(_prevState: CompanyFormState, formData: FormData): Promise<CompanyFormState> {
  const user = await requireUser();
  requirePermission(user, "add_leads");

  const parsed = parseCompanyForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  const overrideDuplicates = formData.get("overrideDuplicates") === "true";

  if (!overrideDuplicates) {
    const duplicates = await findPotentialDuplicates(prisma, parsed.data);
    if (duplicates.length > 0) {
      return { duplicates };
    }
  } else if (user.role.name !== "Administrator") {
    return { error: "Only an Administrator can add a company despite a possible duplicate match." };
  }

  const normalized = computeNormalizedFields(parsed.data);

  const company = await prisma.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: {
        name: parsed.data.name,
        address1: parsed.data.address1 ?? null,
        city: parsed.data.city,
        region: parsed.data.region,
        postalCode: parsed.data.postalCode ?? null,
        country: parsed.data.country,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        websiteUrl: parsed.data.websiteUrl ?? null,
        leadTypeId: parsed.data.leadTypeId,
        pipelineStageId: parsed.data.pipelineStageId,
        competitorId: parsed.data.competitorId ?? null,
        assignedToId: parsed.data.assignedToId,
        triviaStatus: parsed.data.triviaStatus,
        notes: parsed.data.notes ?? null,
        nextFollowUpAt: parsed.data.nextFollowUpAt ? new Date(parsed.data.nextFollowUpAt) : null,
        createdById: user.id,
        source: "MANUAL",
        ...normalized,
      },
    });

    await logInitialPipelineStage(tx, { companyId: created.id, userId: user.id, toStageId: created.pipelineStageId });

    return created;
  });

  redirect(`/companies/${company.id}`);
}

export async function updateCompany(
  id: string,
  _prevState: CompanyFormState,
  formData: FormData,
): Promise<CompanyFormState> {
  const user = await requireUser();
  requirePermission(user, "edit_leads");

  const scope = companyScope(user);
  if (!scope) {
    return { error: "You do not have access to this company." };
  }

  const existing = await prisma.company.findFirst({ where: { id, ...scope } });
  if (!existing) {
    return { error: "You do not have access to this company." };
  }

  const parsed = parseCompanyForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  const newAssignedToId = parsed.data.assignedToId ?? null;
  const assignmentChanged = newAssignedToId !== existing.assignedToId;

  if (assignmentChanged) {
    requirePermission(user, "reassign_leads");
    if (!(await canAssignTo(prisma, user, newAssignedToId))) {
      return { error: "You can only reassign within your own team." };
    }
  }

  const overrideDuplicates = formData.get("overrideDuplicates") === "true";
  if (!overrideDuplicates) {
    const duplicates = await findPotentialDuplicates(prisma, parsed.data, { excludeCompanyId: id });
    if (duplicates.length > 0) {
      return { duplicates };
    }
  } else if (user.role.name !== "Administrator") {
    return { error: "Only an Administrator can save despite a possible duplicate match." };
  }

  const normalized = computeNormalizedFields(parsed.data);
  const pipelineStageChanged = parsed.data.pipelineStageId !== existing.pipelineStageId;

  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id },
      data: {
        name: parsed.data.name,
        address1: parsed.data.address1 ?? null,
        city: parsed.data.city,
        region: parsed.data.region,
        postalCode: parsed.data.postalCode ?? null,
        country: parsed.data.country,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        websiteUrl: parsed.data.websiteUrl ?? null,
        leadTypeId: parsed.data.leadTypeId,
        pipelineStageId: parsed.data.pipelineStageId,
        competitorId: parsed.data.competitorId ?? null,
        assignedToId: newAssignedToId,
        triviaStatus: parsed.data.triviaStatus,
        notes: parsed.data.notes ?? null,
        nextFollowUpAt: parsed.data.nextFollowUpAt ? new Date(parsed.data.nextFollowUpAt) : null,
        updatedById: user.id,
        ...normalized,
      },
    });

    // Automatic Pipeline Change activity — never left to the user to log
    // manually.
    if (pipelineStageChanged) {
      await logPipelineChange(tx, {
        companyId: id,
        userId: user.id,
        fromStageId: existing.pipelineStageId,
        toStageId: parsed.data.pipelineStageId,
        lossReasonId: parsed.data.lossReasonId ?? null,
      });
    }

    if (assignmentChanged) {
      await logAssignmentChange(tx, {
        companyId: id,
        userId: user.id,
        fromUserId: existing.assignedToId,
        toUserId: newAssignedToId,
      });
    }
  });

  redirect(`/companies/${id}`);
}

export type MutationResult = { error?: string } | { success: true };

/**
 * Lightweight stage-change action for the pipeline board's drag-and-drop
 * and its accessible <Select> alternative — both call this exact same
 * function, so they always produce identical resulting state and Activity.
 * Deliberately does not take a full CompanySchema payload and does not
 * redirect(), unlike updateCompany, since this is called from an
 * AJAX-style client interaction that needs to stay on the page.
 */
export async function changeCompanyStage(companyId: string, newStageId: string): Promise<MutationResult> {
  const user = await requireUser();
  requirePermission(user, "edit_leads");

  const scope = companyScope(user);
  if (!scope) return { error: "You do not have access to this company." };

  const existing = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!existing) return { error: "You do not have access to this company." };

  const targetStage = await prisma.pipelineStage.findUnique({ where: { id: newStageId } });
  if (!targetStage || !targetStage.active) {
    return { error: "That pipeline stage is not available." };
  }

  if (newStageId === existing.pipelineStageId) {
    return { success: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: companyId }, data: { pipelineStageId: newStageId, updatedById: user.id } });
    await logPipelineChange(tx, {
      companyId,
      userId: user.id,
      fromStageId: existing.pipelineStageId,
      toStageId: newStageId,
    });
  });

  revalidatePath("/pipeline");
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/companies");
  return { success: true };
}

/**
 * Lightweight assign/reassign/unassign action, shared by the pipeline
 * board, the company detail quick-actions bar, and (per-row, inside its
 * own transaction) bulk reassignment. Assigning a previously-unassigned
 * company and reassigning an already-assigned one are the same operation —
 * both require reassign_leads, exactly like updateCompany's inline check
 * used to, now shared via canAssignTo.
 */
export async function assignCompany(companyId: string, newAssigneeId: string | null): Promise<MutationResult> {
  const user = await requireUser();
  requirePermission(user, "edit_leads");

  const scope = companyScope(user);
  if (!scope) return { error: "You do not have access to this company." };

  const existing = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!existing) return { error: "You do not have access to this company." };

  if (newAssigneeId === existing.assignedToId) {
    return { success: true };
  }

  requirePermission(user, "reassign_leads");
  if (!(await canAssignTo(prisma, user, newAssigneeId))) {
    return { error: "You can only assign within your own team." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: companyId }, data: { assignedToId: newAssigneeId, updatedById: user.id } });
    await logAssignmentChange(tx, {
      companyId,
      userId: user.id,
      fromUserId: existing.assignedToId,
      toUserId: newAssigneeId,
    });
  });

  revalidatePath("/pipeline");
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/companies");
  return { success: true };
}

export async function archiveCompany(id: string): Promise<SimpleActionResult> {
  const user = await requireUser();
  requirePermission(user, "delete_leads");

  const scope = companyScope(user);
  if (!scope) return { error: "You do not have access to this company." };

  const existing = await prisma.company.findFirst({ where: { id, ...scope } });
  if (!existing) return { error: "You do not have access to this company." };

  await prisma.company.update({
    where: { id },
    data: { status: "ARCHIVED", archivedAt: new Date(), archivedById: user.id },
  });

  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  return undefined;
}

export async function restoreCompany(id: string): Promise<SimpleActionResult> {
  const user = await requireUser();
  requirePermission(user, "restore_archived_leads");

  await prisma.company.update({
    where: { id },
    data: { status: "ACTIVE", archivedAt: null, archivedById: null },
  });

  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  return undefined;
}

export async function permanentlyDeleteCompany(id: string): Promise<SimpleActionResult> {
  const user = await requireUser();
  requirePermission(user, "delete_leads");

  // Belt-and-suspenders: permanent deletion is tied to the Administrator
  // role itself, not just the delete_leads permission flag, since this is
  // the one irreversible operation in the whole module.
  if (user.role.name !== "Administrator") {
    return { error: "Only an Administrator can permanently delete a company." };
  }

  const existing = await prisma.company.findUnique({ where: { id } });
  if (!existing) return { error: "Company not found." };
  if (existing.status !== "ARCHIVED") {
    return { error: "Archive this company before permanently deleting it." };
  }

  await prisma.company.delete({ where: { id } });
  revalidatePath("/companies");
  redirect("/companies");
}
