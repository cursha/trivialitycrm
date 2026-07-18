"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PromptTemplateSchema, PromptRefineSchema } from "@/lib/validation/prompt";
import { formString } from "@/lib/form-data";
import { getProviders } from "@/lib/research/providers/factory";

export type PromptFormState = { error?: string } | undefined;
export type PromptRefineState = { error?: string; prompt?: string } | undefined;

const PATH = "/leads/prompts";

async function requirePromptManager() {
  const user = await requireUser();
  requirePermission(user, "manage_prompts");
  return user;
}

function parsePromptForm(formData: FormData) {
  return PromptTemplateSchema.safeParse({
    name: formString(formData, "name"),
    qualificationPrompt: formString(formData, "qualificationPrompt"),
  });
}

export async function createPrompt(_prevState: PromptFormState, formData: FormData): Promise<PromptFormState> {
  const user = await requirePromptManager();

  const parsed = parsePromptForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  await prisma.promptTemplate.create({
    data: { name: parsed.data.name, qualificationPrompt: parsed.data.qualificationPrompt, createdById: user.id },
  });

  revalidatePath(PATH);
  redirect(PATH);
}

export async function updatePrompt(id: string, _prevState: PromptFormState, formData: FormData): Promise<PromptFormState> {
  await requirePromptManager();

  const parsed = parsePromptForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  await prisma.promptTemplate.update({
    where: { id },
    data: { name: parsed.data.name, qualificationPrompt: parsed.data.qualificationPrompt },
  });

  revalidatePath(PATH);
  redirect(PATH);
}

export async function duplicatePrompt(id: string): Promise<void> {
  const user = await requirePromptManager();

  const existing = await prisma.promptTemplate.findUniqueOrThrow({ where: { id } });
  await prisma.promptTemplate.create({
    data: {
      name: `${existing.name} (copy)`,
      qualificationPrompt: existing.qualificationPrompt,
      createdById: user.id,
    },
  });

  revalidatePath(PATH);
}

export async function archivePrompt(id: string): Promise<void> {
  await requirePromptManager();
  await prisma.promptTemplate.update({ where: { id }, data: { archived: true } });
  revalidatePath(PATH);
}

export async function restorePrompt(id: string): Promise<void> {
  await requirePromptManager();
  await prisma.promptTemplate.update({ where: { id }, data: { archived: false } });
  revalidatePath(PATH);
}

export async function refinePrompt(_prevState: PromptRefineState, formData: FormData): Promise<PromptRefineState> {
  await requirePromptManager();

  const parsed = PromptRefineSchema.safeParse({
    description: formString(formData, "description"),
    currentPrompt: formString(formData, "currentPrompt"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Describe what you'd like the AI to change." };
  }

  const { promptAssistant } = getProviders();
  const { prompt } = await promptAssistant.refine({ description: parsed.data.description, currentPrompt: parsed.data.currentPrompt });
  return { prompt };
}
