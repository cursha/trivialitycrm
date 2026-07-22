"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";

/** Marks one Notification read — scoped to `userId` in the where clause
 * itself (not a separate ownership check) so a stray id can never be used
 * to tamper with someone else's unread state. Also used, indirectly, by
 * the report-download route to mark a REPORT_GENERATED notification read
 * on download — see api/reports/generated/[id]/download/route.ts. */
export async function markNotificationRead(id: string): Promise<void> {
  const user = await requireUser();
  await prisma.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}
