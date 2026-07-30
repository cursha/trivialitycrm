"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, type AuthenticatedUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { writeAuditEvent } from "@/lib/audit/log";
import { SalesListFiltersSchema } from "@/lib/sales-lists/filters";
import { canManageSalesList, salesListVisibilityWhere } from "@/lib/sales-lists/scope";
import { evaluateDynamicFilters, selectAllMatchingCompanyIds } from "@/lib/sales-lists/queries";
import type { Prisma } from "@/generated/prisma/client";
import type { SalesListPurpose, SalesListType, SalesListVisibility } from "@/generated/prisma/enums";

export type SalesListActionResult = { error: string } | { success: true; id: string };

async function requireManagedList(
  user: AuthenticatedUser,
  id: string,
): Promise<{ error: string } | { list: Awaited<ReturnType<typeof prisma.salesList.findUniqueOrThrow>> }> {
  const list = await prisma.salesList.findUnique({ where: { id } });
  if (!list) return { error: "List not found." };
  if (!canManageSalesList(user, list)) return { error: "You do not have access to change this list." };
  return { list };
}

/** Re-validates every id server-side against the caller's own companyScope
 * before it's ever added to a list — the same "never trust a client-
 * supplied id" discipline as fetchScopedCompanies in companies/bulk-
 * actions.ts. Ids outside scope are silently dropped, not acted on. */
async function scopedCompanyIds(user: AuthenticatedUser, companyIds: string[]): Promise<string[]> {
  if (companyIds.length === 0) return [];
  const scope = companyScope(user);
  if (!scope) return [];
  const rows = await prisma.company.findMany({ where: { id: { in: companyIds }, ...scope }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function validateSharedUserIds(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.user.findMany({ where: { id: { in: userIds }, disabled: false }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** List Builder's "select all matching" button — re-runs the current
 * in-progress filter selection server-side (never trusts a client-supplied
 * id list) and returns every matching id up to the safety cap. */
export async function selectAllMatchingIds(filters: unknown): Promise<{ ids: string[]; truncated: boolean }> {
  const user = await requireUser();
  requirePermission(user, "create_sales_lists");
  return selectAllMatchingCompanyIds(user, filters);
}

export async function createSalesList(input: {
  name: string;
  description?: string;
  purpose: SalesListPurpose;
  type: SalesListType;
  visibility: SalesListVisibility;
  filters?: unknown;
  companyIds?: string[];
  sharedUserIds?: string[];
}): Promise<SalesListActionResult> {
  const user = await requireUser();
  requirePermission(user, "create_sales_lists");

  const name = input.name.trim();
  if (!name) return { error: "Enter a name for this list." };
  if (name.length > 150) return { error: "Name is too long." };

  if (input.visibility === "SHARED_TEAM" && !user.teamId) {
    return { error: "You're not on a team, so this list can't be shared with a team." };
  }

  let filtersData: Prisma.InputJsonValue | undefined;
  if (input.type === "DYNAMIC") {
    const parsed = SalesListFiltersSchema.safeParse(input.filters ?? {});
    if (!parsed.success) return { error: "Invalid filter selection." };
    filtersData = parsed.data as Prisma.InputJsonValue;
  }

  const validCompanyIds = input.type === "FIXED" ? await scopedCompanyIds(user, input.companyIds ?? []) : [];
  const validSharedUserIds = input.visibility === "SHARED_USERS" ? await validateSharedUserIds(input.sharedUserIds ?? []) : [];
  if (input.visibility === "SHARED_USERS" && validSharedUserIds.length === 0) {
    return { error: "Choose at least one person to share this list with." };
  }

  const list = await prisma.$transaction(async (tx) => {
    const created = await tx.salesList.create({
      data: {
        name,
        description: input.description?.trim() || null,
        purpose: input.purpose,
        type: input.type,
        visibility: input.visibility,
        ownerId: user.id,
        filters: filtersData,
      },
    });

    if (input.type === "FIXED" && validCompanyIds.length > 0) {
      await tx.salesListMember.createMany({
        data: validCompanyIds.map((companyId) => ({ listId: created.id, companyId, addedById: user.id })),
      });
    }
    if (input.visibility === "SHARED_USERS" && validSharedUserIds.length > 0) {
      await tx.salesListShare.createMany({ data: validSharedUserIds.map((userId) => ({ listId: created.id, userId })) });
    }
    return created;
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "sales-lists",
    action: "sales_list.created",
    entityType: "SalesList",
    entityId: list.id,
    metadata: { name, purpose: input.purpose, type: input.type, visibility: input.visibility },
  });

  revalidatePath("/sales-lists");
  return { success: true, id: list.id };
}

export async function updateSalesList(
  id: string,
  input: {
    name?: string;
    description?: string;
    visibility?: SalesListVisibility;
    sharedUserIds?: string[];
    filters?: unknown;
    defaultSortBy?: string | null;
    defaultSortDir?: string | null;
  },
): Promise<SalesListActionResult> {
  const user = await requireUser();
  const managed = await requireManagedList(user, id);
  if ("error" in managed) return managed;
  const before = managed.list;

  if (input.visibility === "SHARED_TEAM" && !user.teamId) {
    return { error: "You're not on a team, so this list can't be shared with a team." };
  }

  const data: Prisma.SalesListUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { error: "Enter a name for this list." };
    data.name = name;
  }
  if (input.description !== undefined) data.description = input.description.trim() || null;
  if (input.visibility !== undefined) data.visibility = input.visibility;
  if (input.defaultSortBy !== undefined) data.defaultSortBy = input.defaultSortBy;
  if (input.defaultSortDir !== undefined) data.defaultSortDir = input.defaultSortDir;

  if (before.type === "DYNAMIC" && input.filters !== undefined) {
    const parsed = SalesListFiltersSchema.safeParse(input.filters);
    if (!parsed.success) return { error: "Invalid filter selection." };
    data.filters = parsed.data as Prisma.InputJsonValue;
  }

  const validSharedUserIds =
    input.sharedUserIds !== undefined ? await validateSharedUserIds(input.sharedUserIds) : undefined;
  const effectiveVisibility = input.visibility ?? before.visibility;
  if (effectiveVisibility === "SHARED_USERS" && validSharedUserIds !== undefined && validSharedUserIds.length === 0) {
    return { error: "Choose at least one person to share this list with." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.salesList.update({ where: { id }, data });
    if (validSharedUserIds !== undefined) {
      await tx.salesListShare.deleteMany({ where: { listId: id } });
      if (validSharedUserIds.length > 0) {
        await tx.salesListShare.createMany({ data: validSharedUserIds.map((userId) => ({ listId: id, userId })) });
      }
    }
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "sales-lists",
    action: input.sharedUserIds !== undefined || input.visibility !== undefined ? "sales_list.shared" : "sales_list.updated",
    entityType: "SalesList",
    entityId: id,
    beforeData: { name: before.name, visibility: before.visibility },
    afterData: { name: data.name ?? before.name, visibility: input.visibility ?? before.visibility },
  });

  revalidatePath("/sales-lists");
  revalidatePath(`/sales-lists/${id}`);
  return { success: true, id };
}

/** Always creates a new PRIVATE list owned by the duplicator, regardless of
 * the source's visibility or type — mirrors duplicateSavedView's exact
 * precedent (one person's "make a copy to tweak" must never mutate what a
 * shared list's other viewers see), and never deletes or alters the
 * original. */
export async function duplicateSalesList(id: string): Promise<SalesListActionResult> {
  const user = await requireUser();
  requirePermission(user, "create_sales_lists");

  const scope = salesListVisibilityWhere(user);
  if (!scope) return { error: "List not found." };
  const source = await prisma.salesList.findFirst({ where: { id, ...scope }, include: { members: true } });
  if (!source) return { error: "List not found." };

  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.salesList.create({
      data: {
        name: `${source.name} (copy)`,
        description: source.description,
        purpose: source.purpose,
        type: source.type,
        visibility: "PRIVATE",
        ownerId: user.id,
        filters: source.filters ?? undefined,
      },
    });
    if (source.type === "FIXED" && source.members.length > 0) {
      const validIds = await scopedCompanyIds(
        user,
        source.members.map((m) => m.companyId),
      );
      if (validIds.length > 0) {
        await tx.salesListMember.createMany({ data: validIds.map((companyId) => ({ listId: created.id, companyId, addedById: user.id })) });
      }
    }
    return created;
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "sales-lists",
    action: "sales_list.duplicated",
    entityType: "SalesList",
    entityId: copy.id,
    metadata: { sourceListId: id },
  });

  revalidatePath("/sales-lists");
  return { success: true, id: copy.id };
}

export async function archiveSalesList(id: string): Promise<SalesListActionResult> {
  const user = await requireUser();
  const managed = await requireManagedList(user, id);
  if ("error" in managed) return managed;

  await prisma.salesList.update({ where: { id }, data: { archivedAt: new Date(), active: false } });
  await writeAuditEvent({ actorId: user.id, module: "sales-lists", action: "sales_list.archived", entityType: "SalesList", entityId: id });

  revalidatePath("/sales-lists");
  return { success: true, id };
}

export async function restoreSalesList(id: string): Promise<SalesListActionResult> {
  const user = await requireUser();
  const managed = await requireManagedList(user, id);
  if ("error" in managed) return managed;

  await prisma.salesList.update({ where: { id }, data: { archivedAt: null, active: true } });
  await writeAuditEvent({ actorId: user.id, module: "sales-lists", action: "sales_list.restored", entityType: "SalesList", entityId: id });

  revalidatePath("/sales-lists");
  return { success: true, id };
}

/** Delete is only ever safe for an already-archived list with no calling
 * or campaign history, mirroring Company's own "only an Administrator can
 * permanently delete an already-archived company" precedent — the spec's
 * "Delete only when safe and permitted" / "Prefer archiving over deletion
 * when a list has activity, campaign or calling-session history." Both
 * CallingSession.listId and Campaign.listId are ON DELETE RESTRICT, so
 * this check exists to return a clear error instead of letting that
 * constraint surface as a raw, unhandled database error. */
export async function deleteSalesList(id: string): Promise<SalesListActionResult> {
  const user = await requireUser();
  requirePermission(user, "manage_all_sales_lists");

  const list = await prisma.salesList.findUnique({ where: { id } });
  if (!list) return { error: "List not found." };
  if (!list.archivedAt) return { error: "Archive this list before deleting it." };

  const [sessionCount, campaignCount] = await Promise.all([
    prisma.callingSession.count({ where: { listId: id } }),
    prisma.campaign.count({ where: { listId: id } }),
  ]);
  if (sessionCount > 0 || campaignCount > 0) {
    return { error: "This list has calling-session or campaign history and cannot be deleted — it can only be archived." };
  }

  await prisma.salesList.delete({ where: { id } });
  await writeAuditEvent({
    actorId: user.id,
    module: "sales-lists",
    action: "sales_list.deleted",
    entityType: "SalesList",
    entityId: id,
    metadata: { name: list.name },
  });

  revalidatePath("/sales-lists");
  return { success: true, id };
}

export async function addCompaniesToList(listId: string, companyIds: string[]): Promise<SalesListActionResult> {
  const user = await requireUser();
  const managed = await requireManagedList(user, listId);
  if ("error" in managed) return managed;
  if (managed.list.type !== "FIXED") return { error: "Only a fixed list has explicit membership to add companies to." };

  const validIds = await scopedCompanyIds(user, companyIds);
  if (validIds.length === 0) return { error: "None of the selected companies could be added." };

  await prisma.salesListMember.createMany({
    data: validIds.map((companyId) => ({ listId, companyId, addedById: user.id })),
    skipDuplicates: true,
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "sales-lists",
    action: "sales_list.companies_added",
    entityType: "SalesList",
    entityId: listId,
    metadata: { companyCount: validIds.length },
  });

  revalidatePath(`/sales-lists/${listId}`);
  return { success: true, id: listId };
}

export async function removeCompanyFromList(listId: string, companyId: string): Promise<SalesListActionResult> {
  const user = await requireUser();
  const managed = await requireManagedList(user, listId);
  if ("error" in managed) return managed;
  if (managed.list.type !== "FIXED") return { error: "Only a fixed list has explicit membership to remove companies from." };

  await prisma.salesListMember.deleteMany({ where: { listId, companyId } });
  await writeAuditEvent({
    actorId: user.id,
    module: "sales-lists",
    action: "sales_list.company_removed",
    entityType: "SalesList",
    entityId: listId,
    metadata: { companyId },
  });

  revalidatePath(`/sales-lists/${listId}`);
  return { success: true, id: listId };
}

/**
 * Re-evaluates a DYNAMIC list's filters against current CRM data, diffs the
 * result against the previous SalesListDynamicMember cache, and replaces
 * the cache wholesale — never incrementally patched, so a stale row from a
 * filter that's since been narrowed can never linger. Anyone permitted to
 * USE the list (view_sales_lists + visibility) may refresh it, not only the
 * owner — refreshing doesn't change the list's definition, only its cached
 * snapshot of current matches, so it doesn't need canManageSalesList.
 */
export async function refreshDynamicList(
  listId: string,
): Promise<{ error: string } | { success: true; total: number; newlyEligible: number; noLongerMatching: number }> {
  const user = await requireUser();
  requirePermission(user, "view_sales_lists");

  const scopeWhere = salesListVisibilityWhere(user);
  if (!scopeWhere) return { error: "List not found." };
  const list = await prisma.salesList.findFirst({ where: { id: listId, ...scopeWhere } });
  if (!list) return { error: "List not found." };
  if (list.type !== "DYNAMIC") return { error: "Only a dynamic list can be refreshed." };

  const matches = await evaluateDynamicFilters(user, list.filters);
  const matchedIds = new Set(matches.map((c) => c.id));

  const previous = await prisma.salesListDynamicMember.findMany({ where: { listId }, select: { companyId: true } });
  const previousIds = new Set(previous.map((r) => r.companyId));

  const newlyEligible = [...matchedIds].filter((id) => !previousIds.has(id));
  const noLongerMatching = [...previousIds].filter((id) => !matchedIds.has(id));

  await prisma.$transaction(async (tx) => {
    await tx.salesListDynamicMember.deleteMany({ where: { listId } });
    if (matchedIds.size > 0) {
      await tx.salesListDynamicMember.createMany({ data: [...matchedIds].map((companyId) => ({ listId, companyId })) });
    }
    await tx.salesList.update({ where: { id: listId }, data: { lastEvaluatedAt: new Date() } });
  });

  revalidatePath(`/sales-lists/${listId}`);
  return { success: true, total: matchedIds.size, newlyEligible: newlyEligible.length, noLongerMatching: noLongerMatching.length };
}
