"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";

export async function deleteImportTemplate(id: string): Promise<void> {
  const user = await requireUser();
  requirePermission(user, "manage_settings");
  await prisma.importTemplate.delete({ where: { id } });
  revalidatePath("/leads/import/templates");
}
