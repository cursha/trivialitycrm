"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";
import { sanitizeRoutePlanSlug } from "@/lib/route-plan/validation";
import { writeAuditEvent } from "@/lib/audit/log";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/lead-types";

async function requireSettingsManager() {
  const user = await requireUser();
  requirePermission(user, "manage_settings");
  return user;
}

/**
 * Deliberately gated by configure_route_plan_lead_types, not
 * manage_settings — deciding Route Plan eligibility is its own permission
 * (spec: "Administrators control which roles have Route Plan permission" /
 * "Administrators mark which lead types are eligible"), granted
 * Administrator-only by default but independently admin-adjustable like
 * every other permission, not hardwired to the general settings-manager
 * permission this file's other actions use.
 */
export async function setLeadTypeRoutePlanSettings(id: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "configure_route_plan_lead_types");

  const enabled = formData.get("routePlanEnabled") === "on";
  const rawSlug = formString(formData, "routePlanSlug");
  const slug = enabled ? sanitizeRoutePlanSlug(rawSlug) : null;

  if (enabled && !slug) {
    return { error: "Enter a filename slug (letters, numbers, and hyphens) to enable Route Planning for this lead type." };
  }

  try {
    await prisma.leadType.update({ where: { id }, data: { routePlanEnabled: enabled, routePlanSlug: slug } });
  } catch {
    return { error: "That filename slug is already used by another lead type." };
  }

  revalidatePath(PATH);
}

export async function createLeadType(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSettingsManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  const highest = await prisma.leadType.aggregate({ _max: { sortOrder: true } });

  try {
    await prisma.leadType.create({
      data: { name: parsed.data.name, sortOrder: (highest._max.sortOrder ?? -1) + 1 },
    });
  } catch {
    return { error: "A lead type with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function renameLeadType(id: string, formData: FormData): Promise<ActionResult> {
  await requireSettingsManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  try {
    await prisma.leadType.update({ where: { id }, data: { name: parsed.data.name } });
  } catch {
    return { error: "A lead type with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function setLeadTypeActive(id: string, active: boolean): Promise<void> {
  await requireSettingsManager();
  await prisma.leadType.update({ where: { id }, data: { active } });
  revalidatePath(PATH);
}

export async function moveLeadType(id: string, direction: "up" | "down"): Promise<void> {
  await requireSettingsManager();

  const items = await prisma.leadType.findMany({ orderBy: { sortOrder: "asc" } });
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return;

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= items.length) return;

  const current = items[index];
  const swap = items[swapIndex];

  await prisma.$transaction([
    prisma.leadType.update({ where: { id: current.id }, data: { sortOrder: swap.sortOrder } }),
    prisma.leadType.update({ where: { id: swap.id }, data: { sortOrder: current.sortOrder } }),
  ]);

  revalidatePath(PATH);
}

export type DeleteLeadTypeResult = { error?: string; needsReplacement?: boolean } | undefined;

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Deletes a lead type. Companies, lead searches, routes and email templates
 * all point at their lead type, so one still in use can only go once
 * everything is moved to `replacementId` — done in the same transaction as
 * the delete, so nothing is ever left pointing at a type that's gone.
 */
export async function deleteLeadType(id: string, replacementId?: string): Promise<DeleteLeadTypeResult> {
  const user = await requireSettingsManager();

  const leadType = await prisma.leadType.findUnique({ where: { id } });
  if (!leadType) return { error: "That lead type no longer exists." };

  const where = { leadTypeId: id };
  const [companies, searches, routes, templates] = await Promise.all([
    prisma.company.count({ where }),
    prisma.leadSearch.count({ where }),
    prisma.routePlan.count({ where }),
    prisma.emailTemplate.count({ where }),
  ]);
  const inUse = companies + searches + routes + templates > 0;

  if (inUse && !replacementId) {
    const uses = [
      companies && plural(companies, "company", "companies"),
      searches && plural(searches, "lead search", "lead searches"),
      routes && plural(routes, "route", "routes"),
      templates && plural(templates, "email template", "email templates"),
    ].filter(Boolean);
    return {
      error: `"${leadType.name}" is used by ${uses.join(", ")}. Choose a lead type to move them to, then delete.`,
      needsReplacement: true,
    };
  }

  if (inUse) {
    if (replacementId === id) return { error: "Choose a different lead type to move them to." };
    const replacement = await prisma.leadType.findUnique({ where: { id: replacementId } });
    if (!replacement) return { error: "The lead type to move them to no longer exists." };

    const data = { leadTypeId: replacement.id };
    await prisma.$transaction([
      prisma.company.updateMany({ where, data }),
      prisma.leadSearch.updateMany({ where, data }),
      prisma.routePlan.updateMany({ where, data }),
      prisma.emailTemplate.updateMany({ where, data }),
      prisma.leadType.delete({ where: { id } }),
    ]);
    await writeAuditEvent({
      actorId: user.id,
      module: "settings",
      action: "lead_type.deleted",
      entityType: "LeadType",
      entityId: id,
      beforeData: { name: leadType.name },
      metadata: { movedTo: { id: replacement.id, name: replacement.name }, companies, searches, routes, templates },
    });
  } else {
    await prisma.leadType.delete({ where: { id } });
    await writeAuditEvent({ actorId: user.id, module: "settings", action: "lead_type.deleted", entityType: "LeadType", entityId: id, beforeData: { name: leadType.name } });
  }

  revalidatePath(PATH);
}
