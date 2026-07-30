"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/campaign-instructions";

async function requireCampaignInstructionManager() {
  const user = await requireUser();
  requirePermission(user, "manage_campaign_instructions");
  return user;
}

export async function createCampaignInstructionTemplate(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireCampaignInstructionManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  const highest = await prisma.campaignInstructionTemplate.aggregate({ _max: { sortOrder: true } });

  try {
    await prisma.campaignInstructionTemplate.create({
      data: { name: parsed.data.name, instructions: "", sortOrder: (highest._max.sortOrder ?? -1) + 1, createdById: user.id },
    });
  } catch {
    return { error: "A reusable instruction set with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function renameCampaignInstructionTemplate(id: string, formData: FormData): Promise<ActionResult> {
  await requireCampaignInstructionManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  try {
    await prisma.campaignInstructionTemplate.update({ where: { id }, data: { name: parsed.data.name } });
  } catch {
    return { error: "A reusable instruction set with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function setCampaignInstructionTemplateActive(id: string, active: boolean): Promise<void> {
  await requireCampaignInstructionManager();
  await prisma.campaignInstructionTemplate.update({ where: { id }, data: { active } });
  revalidatePath(PATH);
}

export async function moveCampaignInstructionTemplate(id: string, direction: "up" | "down"): Promise<void> {
  await requireCampaignInstructionManager();

  const items = await prisma.campaignInstructionTemplate.findMany({ orderBy: { sortOrder: "asc" } });
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return;

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= items.length) return;

  const current = items[index];
  const swap = items[swapIndex];

  await prisma.$transaction([
    prisma.campaignInstructionTemplate.update({ where: { id: current.id }, data: { sortOrder: swap.sortOrder } }),
    prisma.campaignInstructionTemplate.update({ where: { id: swap.id }, data: { sortOrder: current.sortOrder } }),
  ]);

  revalidatePath(PATH);
}

/** Never actually deletes a template referenced by any Campaign — a
 * campaign's `reusableInstructionsId` is set null on delete (see schema's
 * onDelete: SetNull), which would silently blank out what an approved,
 * frozen-preview campaign was built from, so deletion is blocked instead —
 * same "deactivate, don't delete referenced history" precedent as
 * RejectionReason/CallOutcome. */
export async function deleteCampaignInstructionTemplate(id: string): Promise<ActionResult> {
  await requireCampaignInstructionManager();

  const usageCount = await prisma.campaign.count({ where: { reusableInstructionsId: id } });
  if (usageCount > 0) {
    return { error: "This instruction set has been used by a campaign — deactivate it instead of deleting." };
  }

  await prisma.campaignInstructionTemplate.delete({ where: { id } });
  revalidatePath(PATH);
}

export async function updateCampaignInstructionText(id: string, formData: FormData): Promise<ActionResult> {
  await requireCampaignInstructionManager();

  const instructions = formString(formData, "instructions").trim();
  if (!instructions) {
    return { error: "Enter the instructions text." };
  }

  await prisma.campaignInstructionTemplate.update({ where: { id }, data: { instructions } });
  revalidatePath(PATH);
  revalidatePath(`${PATH}/${id}`);
}
