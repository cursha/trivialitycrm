"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, type AuthenticatedUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope, canAssignTo } from "@/lib/companies/scope";
import { logPipelineChange, logAssignmentChange } from "@/lib/companies/activity-log";
import { TaskSchema } from "@/lib/validation/task";
import type { Company } from "@/generated/prisma/client";

export type BulkActionResult = {
  succeeded: string[];
  failed: { id: string; reason: string }[];
};
export type BulkActionOutcome = BulkActionResult | { error: string };

/**
 * Every bulk action starts here: re-fetches the requested ids restricted by
 * companyScope, so a forbidden id is silently excluded rather than acted
 * on — the same "never bypass company-level permissions" guarantee every
 * single-record action already gives, just applied per-row across a batch.
 * Ids that don't come back are reported as failures with a clear reason,
 * never silently dropped.
 */
async function fetchScopedCompanies(
  user: AuthenticatedUser,
  companyIds: string[],
): Promise<{ companies: Company[]; failed: { id: string; reason: string }[] } | { error: string }> {
  const scope = companyScope(user);
  if (!scope) return { error: "You do not have access to these companies." };

  const companies = await prisma.company.findMany({ where: { id: { in: companyIds }, ...scope } });
  const foundIds = new Set(companies.map((c) => c.id));
  const failed = companyIds
    .filter((id) => !foundIds.has(id))
    .map((id) => ({ id, reason: "Not found or access denied." }));

  return { companies, failed };
}

export async function bulkChangeStage(companyIds: string[], newStageId: string): Promise<BulkActionOutcome> {
  const user = await requireUser();
  requirePermission(user, "bulk_update_leads");
  requirePermission(user, "edit_leads");

  const targetStage = await prisma.pipelineStage.findUnique({ where: { id: newStageId } });
  if (!targetStage || !targetStage.active) {
    return { error: "That pipeline stage is not available." };
  }

  const scoped = await fetchScopedCompanies(user, companyIds);
  if ("error" in scoped) return scoped;
  const { companies, failed } = scoped;

  const succeeded: string[] = [];

  // One transaction for the whole batch: a bulk action either fully lands
  // or fully rolls back, so a mid-batch failure never leaves "some moved,
  // some didn't" for the user to untangle.
  await prisma.$transaction(async (tx) => {
    for (const company of companies) {
      if (company.pipelineStageId === newStageId) {
        succeeded.push(company.id);
        continue;
      }
      await tx.company.update({ where: { id: company.id }, data: { pipelineStageId: newStageId, updatedById: user.id } });
      await logPipelineChange(tx, {
        companyId: company.id,
        userId: user.id,
        fromStageId: company.pipelineStageId,
        toStageId: newStageId,
      });
      succeeded.push(company.id);
    }
  });

  revalidatePath("/pipeline");
  revalidatePath("/companies");
  return { succeeded, failed };
}

export async function bulkAssignCompanies(companyIds: string[], newAssigneeId: string | null): Promise<BulkActionOutcome> {
  const user = await requireUser();
  requirePermission(user, "bulk_update_leads");
  requirePermission(user, "reassign_leads");

  if (!(await canAssignTo(prisma, user, newAssigneeId))) {
    return { error: "You can only assign within your own team." };
  }

  const scoped = await fetchScopedCompanies(user, companyIds);
  if ("error" in scoped) return scoped;
  const { companies, failed } = scoped;

  const succeeded: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const company of companies) {
      if (company.assignedToId === newAssigneeId) {
        succeeded.push(company.id);
        continue;
      }
      await tx.company.update({ where: { id: company.id }, data: { assignedToId: newAssigneeId, updatedById: user.id } });
      await logAssignmentChange(tx, {
        companyId: company.id,
        userId: user.id,
        fromUserId: company.assignedToId,
        toUserId: newAssigneeId,
      });
      succeeded.push(company.id);
    }
  });

  revalidatePath("/pipeline");
  revalidatePath("/companies");
  revalidatePath("/manager");
  return { succeeded, failed };
}

/**
 * "Set territory" has no field to set — Territory membership is computed
 * from a company's location, not stored (see territory-match.ts). In
 * practice, picking a territory for a batch of leads means handing them to
 * whoever owns that territory, so this delegates straight to
 * bulkAssignCompanies with the territory's assignedToId, reusing its
 * permission check, team-boundary check, and ASSIGNMENT_CHANGE audit trail
 * rather than duplicating any of it.
 */
export async function bulkSetTerritory(companyIds: string[], territoryId: string): Promise<BulkActionOutcome> {
  const user = await requireUser();
  requirePermission(user, "bulk_update_leads");

  const territory = await prisma.territory.findUnique({ where: { id: territoryId } });
  if (!territory || !territory.active) {
    return { error: "That territory is not available." };
  }
  if (!territory.assignedToId) {
    return { error: "This territory has no assigned salesperson to assign these leads to." };
  }

  return bulkAssignCompanies(companyIds, territory.assignedToId);
}

export async function bulkCreateFollowUp(
  companyIds: string[],
  input: { title: string; notes?: string; dueAt: string; assignedToId: string },
): Promise<BulkActionOutcome> {
  const user = await requireUser();
  requirePermission(user, "bulk_update_leads");
  requirePermission(user, "edit_leads");

  const parsed = TaskSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the follow-up details." };
  }

  const scoped = await fetchScopedCompanies(user, companyIds);
  if ("error" in scoped) return scoped;
  const { companies, failed } = scoped;

  const succeeded: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const company of companies) {
      await tx.task.create({
        data: {
          companyId: company.id,
          assignedToId: parsed.data.assignedToId,
          title: parsed.data.title,
          notes: parsed.data.notes ?? null,
          dueAt: new Date(parsed.data.dueAt),
        },
      });
      succeeded.push(company.id);
    }
  });

  revalidatePath("/pipeline");
  revalidatePath("/follow-ups");
  return { succeeded, failed };
}

export async function bulkAddNote(companyIds: string[], note: string): Promise<BulkActionOutcome> {
  const user = await requireUser();
  requirePermission(user, "bulk_update_leads");
  requirePermission(user, "edit_leads");

  const trimmed = note.trim();
  if (!trimmed) return { error: "Enter a note." };
  if (trimmed.length > 5000) return { error: "Note is too long." };

  const scoped = await fetchScopedCompanies(user, companyIds);
  if ("error" in scoped) return scoped;
  const { companies, failed } = scoped;

  const succeeded: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const company of companies) {
      await tx.activity.create({
        data: { companyId: company.id, userId: user.id, type: "NOTE", notes: trimmed },
      });
      succeeded.push(company.id);
    }
  });

  revalidatePath("/pipeline");
  revalidatePath("/companies");
  return { succeeded, failed };
}

export async function bulkArchive(companyIds: string[]): Promise<BulkActionOutcome> {
  const user = await requireUser();
  requirePermission(user, "bulk_update_leads");
  requirePermission(user, "delete_leads");

  const scoped = await fetchScopedCompanies(user, companyIds);
  if ("error" in scoped) return scoped;
  const { companies, failed } = scoped;

  const succeeded: string[] = [];
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const company of companies) {
      if (company.status === "ARCHIVED") {
        succeeded.push(company.id);
        continue;
      }
      await tx.company.update({
        where: { id: company.id },
        data: { status: "ARCHIVED", archivedAt: now, archivedById: user.id },
      });
      succeeded.push(company.id);
    }
  });

  revalidatePath("/pipeline");
  revalidatePath("/companies");
  return { succeeded, failed };
}

export async function bulkRestore(companyIds: string[]): Promise<BulkActionOutcome> {
  const user = await requireUser();
  requirePermission(user, "bulk_update_leads");
  requirePermission(user, "restore_archived_leads");

  const scoped = await fetchScopedCompanies(user, companyIds);
  if ("error" in scoped) return scoped;
  const { companies, failed } = scoped;

  const succeeded: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const company of companies) {
      if (company.status === "ACTIVE") {
        succeeded.push(company.id);
        continue;
      }
      await tx.company.update({
        where: { id: company.id },
        data: { status: "ACTIVE", archivedAt: null, archivedById: null },
      });
      succeeded.push(company.id);
    }
  });

  revalidatePath("/pipeline");
  revalidatePath("/companies");
  return { succeeded, failed };
}
