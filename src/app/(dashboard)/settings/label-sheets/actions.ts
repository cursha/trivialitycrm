"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { writeAuditEvent } from "@/lib/audit/log";
import { validateGeometry } from "@/lib/mailing-labels/geometry";
import { geometryOf } from "@/lib/mailing-labels/service";
import { LabelSheetSchema, MailingLabelSettingsSchema } from "@/lib/validation/mailing-labels";

export type SheetActionResult = { ok: true; id: string } | { ok: false; error: string };

const PATH = "/settings/label-sheets";

async function requireSheetAdmin() {
  const user = await requireUser();
  requirePermission(user, "manage_label_sheets");
  return user;
}

/**
 * Create a sheet, or save changed measurements as a new version of an
 * existing one. Versions are never edited in place, so past batches keep
 * the exact geometry they were printed with.
 */
export async function saveLabelSheet(id: string | null, input: unknown): Promise<SheetActionResult> {
  const user = await requireSheetAdmin();
  const parsed = LabelSheetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the measurements." };
  const { name, productCode, measurementNote, ...geometry } = parsed.data;
  const problems = validateGeometry(geometry);
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };

  try {
    if (!id) {
      const template = await prisma.labelSheetTemplate.create({
        data: { name, productCode: productCode ?? null, createdById: user.id, versions: { create: { version: 1, ...geometry, measurementNote: measurementNote ?? null, createdById: user.id } } },
      });
      await writeAuditEvent({ actorId: user.id, module: "mailing_labels", action: "sheet.created", entityType: "LabelSheetTemplate", entityId: template.id, metadata: { name, version: 1 } });
      revalidatePath(PATH);
      return { ok: true, id: template.id };
    }
    const template = await prisma.labelSheetTemplate.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    if (!template) return { ok: false, error: "That sheet wasn't found." };
    const latest = template.versions[0];
    const changed = !latest || (Object.keys(geometry) as (keyof typeof geometry)[]).some((key) => latest[key] !== geometry[key]) || (latest.measurementNote ?? undefined) !== measurementNote;
    await prisma.$transaction(async (tx) => {
      await tx.labelSheetTemplate.update({ where: { id }, data: { name, productCode: productCode ?? null } });
      if (changed) await tx.labelSheetTemplateVersion.create({ data: { templateId: id, version: (latest?.version ?? 0) + 1, ...geometry, measurementNote: measurementNote ?? null, createdById: user.id } });
    });
    await writeAuditEvent({
      actorId: user.id,
      module: "mailing_labels",
      action: "sheet.updated",
      entityType: "LabelSheetTemplate",
      entityId: id,
      metadata: { name, newVersion: changed ? (latest?.version ?? 0) + 1 : null },
    });
    revalidatePath(PATH);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "There's already a sheet with that name." };
  }
}

/** A copy of a sheet's latest measurements under a new name, to adjust. */
export async function duplicateLabelSheet(id: string): Promise<SheetActionResult> {
  const user = await requireSheetAdmin();
  const template = await prisma.labelSheetTemplate.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  const latest = template?.versions[0];
  if (!template || !latest) return { ok: false, error: "That sheet wasn't found." };
  let name = `${template.name} (copy)`;
  for (let n = 2; await prisma.labelSheetTemplate.findUnique({ where: { name } }); n++) name = `${template.name} (copy ${n})`;
  const copy = await prisma.labelSheetTemplate.create({
    data: { name, productCode: template.productCode, createdById: user.id, versions: { create: { ...geometryOf(latest), measurementNote: latest.measurementNote, version: 1, createdById: user.id } } },
  });
  await writeAuditEvent({ actorId: user.id, module: "mailing_labels", action: "sheet.duplicated", entityType: "LabelSheetTemplate", entityId: copy.id, metadata: { from: id, name } });
  revalidatePath(PATH);
  return { ok: true, id: copy.id };
}

/** Inactive sheets can't be chosen for new jobs; past batches keep theirs. */
export async function setLabelSheetActive(id: string, active: boolean): Promise<SheetActionResult> {
  const user = await requireSheetAdmin();
  const { count } = await prisma.labelSheetTemplate.updateMany({ where: { id }, data: { active } });
  if (count === 0) return { ok: false, error: "That sheet wasn't found." };
  await writeAuditEvent({ actorId: user.id, module: "mailing_labels", action: active ? "sheet.activated" : "sheet.deactivated", entityType: "LabelSheetTemplate", entityId: id });
  revalidatePath(PATH);
  return { ok: true, id };
}

export async function saveMailingLabelSettings(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireSheetAdmin();
  const parsed = MailingLabelSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the settings." };
  await prisma.mailingLabelSettings.upsert({ where: { id: 1 }, create: { id: 1, ...parsed.data, updatedById: user.id }, update: { ...parsed.data, updatedById: user.id } });
  await writeAuditEvent({ actorId: user.id, module: "mailing_labels", action: "settings.updated", entityType: "MailingLabelSettings", entityId: "1", metadata: parsed.data });
  revalidatePath(PATH);
  return { ok: true };
}
