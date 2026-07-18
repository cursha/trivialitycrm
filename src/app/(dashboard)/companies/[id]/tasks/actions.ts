"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { TaskSchema } from "@/lib/validation/task";
import { formString } from "@/lib/form-data";

export type TaskActionResult = { error?: string } | undefined;

async function requireCompanyAccess(companyId: string) {
  const user = await requireUser();
  requirePermission(user, "edit_leads");

  const scope = companyScope(user);
  if (!scope) {
    throw new Error("Forbidden: no access to this company");
  }

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) {
    throw new Error("Forbidden: no access to this company");
  }
}

function parseTaskForm(formData: FormData, prefix = "") {
  return TaskSchema.safeParse({
    title: formString(formData, `${prefix}title`),
    notes: formString(formData, `${prefix}notes`),
    dueAt: formString(formData, `${prefix}dueAt`),
    assignedToId: formString(formData, `${prefix}assignedToId`),
  });
}

export async function createTask(
  companyId: string,
  _prevState: TaskActionResult,
  formData: FormData,
): Promise<TaskActionResult> {
  await requireCompanyAccess(companyId);

  const parsed = parseTaskForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  await prisma.task.create({
    data: {
      companyId,
      assignedToId: parsed.data.assignedToId,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      dueAt: new Date(parsed.data.dueAt),
    },
  });

  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/follow-ups");
}

export async function completeTask(companyId: string, taskId: string, formData: FormData): Promise<TaskActionResult> {
  await requireCompanyAccess(companyId);

  const existing = await prisma.task.findFirst({ where: { id: taskId, companyId } });
  if (!existing) {
    return { error: "Follow-up not found." };
  }

  const createNext = formData.get("createNext") === "true";
  const nextParsed = createNext ? parseTaskForm(formData, "next-") : null;

  if (nextParsed && !nextParsed.success) {
    return { error: nextParsed.error.issues[0]?.message ?? "Please correct the next follow-up's fields." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    if (nextParsed?.success) {
      await tx.task.create({
        data: {
          companyId,
          assignedToId: nextParsed.data.assignedToId,
          title: nextParsed.data.title,
          notes: nextParsed.data.notes ?? null,
          dueAt: new Date(nextParsed.data.dueAt),
        },
      });
    }
  });

  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/follow-ups");
}

export async function cancelTask(companyId: string, taskId: string): Promise<TaskActionResult> {
  await requireCompanyAccess(companyId);

  const existing = await prisma.task.findFirst({ where: { id: taskId, companyId } });
  if (!existing) {
    return { error: "Follow-up not found." };
  }

  await prisma.task.update({ where: { id: taskId }, data: { status: "CANCELLED" } });

  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/follow-ups");
}
