"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { isValidTimeZone } from "@/lib/comms/calendar-time";
import { formString } from "@/lib/form-data";
import { SCOREBOARD_METRICS, type ScoreCounts } from "@/lib/sales/scoreboard-metrics";
import { MAX_TRIAL_WEEKS } from "@/lib/companies/sales-track";

export type SalesTargetResult = { error?: string } | undefined;

/**
 * Saves one rep's daily scoreboard goals, the timezone their "today" is
 * counted in, and the trial length they offer (which times their bars'
 * trial follow-ups). Managers (view_manager_workspace) set these for their team.
 */
export async function saveSalesTarget(userId: string, formData: FormData): Promise<SalesTargetResult> {
  const manager = await requireUser();
  requirePermission(manager, "view_manager_workspace");

  const rep = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!rep) return { error: "That user no longer exists." };

  const targets = {} as ScoreCounts;
  for (const metric of SCOREBOARD_METRICS) {
    const value = Number(formString(formData, metric));
    if (!Number.isInteger(value) || value < 0 || value > 500) return { error: "Goals must be whole numbers from 0 to 500." };
    targets[metric] = value;
  }

  const timezone = formString(formData, "timezone").trim();
  if (timezone && !isValidTimeZone(timezone)) return { error: "Choose a valid timezone." };

  const trialLengthWeeks = Number(formString(formData, "trialLengthWeeks"));
  if (!Number.isInteger(trialLengthWeeks) || trialLengthWeeks < 1 || trialLengthWeeks > MAX_TRIAL_WEEKS) {
    return { error: `Trial length must be 1 to ${MAX_TRIAL_WEEKS} weeks.` };
  }

  await prisma.$transaction([
    prisma.salesTarget.upsert({ where: { userId }, update: targets, create: { userId, ...targets } }),
    prisma.user.update({ where: { id: userId }, data: { timezone: timezone || null, trialLengthWeeks } }),
  ]);

  revalidatePath("/manager");
  revalidatePath("/dashboard");
}
