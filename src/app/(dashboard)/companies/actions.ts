"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { CompanySchema } from "@/lib/validation/company";
import { findPotentialDuplicates, computeNormalizedFields, type DuplicateMatch } from "@/lib/duplicates/match";
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

  const company = await prisma.company.create({
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
      ...normalized,
    },
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

  if (parsed.data.assignedToId !== existing.assignedToId) {
    requirePermission(user, "reassign_leads");

    if (!hasPermission(user, "view_all_leads")) {
      const newAssignee = await prisma.user.findUnique({ where: { id: parsed.data.assignedToId } });
      if (!newAssignee || newAssignee.teamId !== user.teamId) {
        return { error: "You can only reassign within your own team." };
      }
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
        assignedToId: parsed.data.assignedToId,
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
      const [fromStage, toStage] = await Promise.all([
        tx.pipelineStage.findUnique({ where: { id: existing.pipelineStageId } }),
        tx.pipelineStage.findUnique({ where: { id: parsed.data.pipelineStageId } }),
      ]);

      await tx.activity.create({
        data: {
          companyId: id,
          userId: user.id,
          type: "PIPELINE_CHANGE",
          notes: `Pipeline stage changed from "${fromStage?.name ?? "Unknown"}" to "${toStage?.name ?? "Unknown"}".`,
        },
      });
    }
  });

  redirect(`/companies/${id}`);
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
