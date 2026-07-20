"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, type AuthenticatedUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { SavedViewFiltersSchema } from "@/lib/workspace/saved-view-filters";
import type { Prisma } from "@/generated/prisma/client";

export type SavedViewActionResult = { error: string } | { success: true; id: string };

async function requireOwnedView(
  user: AuthenticatedUser,
  id: string,
): Promise<{ error: string } | { view: Awaited<ReturnType<typeof prisma.savedView.findUniqueOrThrow>> }> {
  const view = await prisma.savedView.findUnique({ where: { id } });
  if (!view) return { error: "View not found." };
  // Ownership, not visibility, gates editing — a SHARED view is visible to
  // everyone but only its owner (or an Administrator) may change or
  // archive it, so one person's edit can't silently mutate what a whole
  // team sees.
  if (view.ownerId !== user.id && user.role.name !== "Administrator") {
    return { error: "You do not have access to this saved view." };
  }
  return { view };
}

export async function createSavedView(input: {
  name: string;
  visibility: "PRIVATE" | "SHARED";
  isDefault?: boolean;
  filters: unknown;
}): Promise<SavedViewActionResult> {
  const user = await requireUser();

  if (input.visibility === "SHARED") {
    requirePermission(user, "create_shared_views");
  }

  const name = input.name.trim();
  if (!name) return { error: "Enter a name for this view." };
  if (name.length > 100) return { error: "Name is too long." };

  const filtersResult = SavedViewFiltersSchema.safeParse(input.filters);
  if (!filtersResult.success) return { error: "Invalid filter selection." };

  const view = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.savedView.updateMany({ where: { ownerId: user.id, isDefault: true }, data: { isDefault: false } });
    }
    return tx.savedView.create({
      data: {
        name,
        ownerId: user.id,
        visibility: input.visibility,
        isDefault: input.isDefault ?? false,
        filters: filtersResult.data as Prisma.InputJsonValue,
      },
    });
  });

  revalidatePath("/pipeline");
  return { success: true, id: view.id };
}

export async function updateSavedView(
  id: string,
  input: { name?: string; visibility?: "PRIVATE" | "SHARED"; isDefault?: boolean; filters?: unknown },
): Promise<SavedViewActionResult> {
  const user = await requireUser();
  const owned = await requireOwnedView(user, id);
  if ("error" in owned) return owned;

  if (input.visibility === "SHARED") {
    requirePermission(user, "create_shared_views");
  }

  const data: Prisma.SavedViewUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { error: "Enter a name for this view." };
    data.name = name;
  }
  if (input.visibility !== undefined) data.visibility = input.visibility;
  if (input.filters !== undefined) {
    const filtersResult = SavedViewFiltersSchema.safeParse(input.filters);
    if (!filtersResult.success) return { error: "Invalid filter selection." };
    data.filters = filtersResult.data as Prisma.InputJsonValue;
  }

  await prisma.$transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx.savedView.updateMany({
        where: { ownerId: owned.view.ownerId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
      data.isDefault = true;
    } else if (input.isDefault === false) {
      data.isDefault = false;
    }
    await tx.savedView.update({ where: { id }, data });
  });

  revalidatePath("/pipeline");
  return { success: true, id };
}

/** Duplicating always creates a new PRIVATE view owned by the duplicator,
 * regardless of the source's visibility — prevents one person's "make a
 * copy to tweak" from accidentally mutating a shared team view. */
export async function duplicateSavedView(id: string): Promise<SavedViewActionResult> {
  const user = await requireUser();

  const view = await prisma.savedView.findFirst({
    where: { id, OR: [{ ownerId: user.id }, { visibility: "SHARED" }] },
  });
  if (!view) return { error: "View not found." };

  const created = await prisma.savedView.create({
    data: {
      name: `${view.name} (copy)`,
      ownerId: user.id,
      visibility: "PRIVATE",
      isDefault: false,
      filters: view.filters as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/pipeline");
  return { success: true, id: created.id };
}

export async function archiveSavedView(id: string): Promise<SavedViewActionResult> {
  const user = await requireUser();
  const owned = await requireOwnedView(user, id);
  if ("error" in owned) return owned;

  await prisma.savedView.update({ where: { id }, data: { archivedAt: new Date() } });
  revalidatePath("/pipeline");
  return { success: true, id };
}

export async function restoreSavedView(id: string): Promise<SavedViewActionResult> {
  const user = await requireUser();
  const owned = await requireOwnedView(user, id);
  if ("error" in owned) return owned;

  await prisma.savedView.update({ where: { id }, data: { archivedAt: null } });
  revalidatePath("/pipeline");
  return { success: true, id };
}
