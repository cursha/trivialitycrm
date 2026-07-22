"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { formString } from "@/lib/form-data";
import { REPORT_KEYS, type ReportKey } from "@/lib/reports/build-rows";
import { computeNextRunAt, type ReportCadenceValue } from "@/lib/reports/schedule";

export type ActionResult = { error?: string } | undefined;

const PATH = "/reports/scheduled";
const CADENCE_VALUES = ["DAILY", "WEEKLY", "MONTHLY"] as const;

async function requireScheduleManager() {
  const user = await requireUser();
  requirePermission(user, "manage_scheduled_reports");
  return user;
}

export async function createScheduledReport(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireScheduleManager();

  const name = formString(formData, "name")?.trim();
  const reportKey = formString(formData, "reportKey");
  const cadence = formString(formData, "cadence");
  const recipientIds = formData.getAll("recipientIds").map(String).filter(Boolean);

  if (!name) return { error: "Enter a name for this schedule." };
  if (!reportKey || !REPORT_KEYS.includes(reportKey as ReportKey)) return { error: "Choose a report." };
  if (!cadence || !CADENCE_VALUES.includes(cadence as ReportCadenceValue)) return { error: "Choose a cadence." };
  if (recipientIds.length === 0) return { error: "Choose at least one recipient." };

  const validRecipientCount = await prisma.user.count({ where: { id: { in: recipientIds }, disabled: false } });
  if (validRecipientCount !== recipientIds.length) return { error: "One or more recipients are invalid." };

  await prisma.scheduledReport.create({
    data: {
      name,
      reportKey,
      cadence: cadence as ReportCadenceValue,
      recipientIds,
      createdById: user.id,
      nextRunAt: computeNextRunAt(cadence as ReportCadenceValue, new Date()),
    },
  });

  revalidatePath(PATH);
}

export async function setScheduledReportActive(id: string, active: boolean): Promise<void> {
  await requireScheduleManager();
  await prisma.scheduledReport.update({ where: { id }, data: { active } });
  revalidatePath(PATH);
}

export async function deleteScheduledReport(id: string): Promise<void> {
  await requireScheduleManager();
  await prisma.scheduledReport.delete({ where: { id } });
  revalidatePath(PATH);
}
