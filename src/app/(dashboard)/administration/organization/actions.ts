"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { OrganizationSettingsSchema } from "@/lib/validation/organization-settings";
import { formString } from "@/lib/form-data";
import { writeAuditEvent } from "@/lib/audit/log";

export type ActionResult = { error?: string } | undefined;

const PATH = "/administration/organization";

export async function updateOrganizationSettings(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "manage_organization_settings");

  const parsed = OrganizationSettingsSchema.safeParse({
    organizationName: formString(formData, "organizationName"),
    defaultCountry: formString(formData, "defaultCountry"),
    defaultRegion: formString(formData, "defaultRegion"),
    defaultTimezone: formString(formData, "defaultTimezone"),
    defaultCurrency: formString(formData, "defaultCurrency"),
    defaultDateFormat: formString(formData, "defaultDateFormat"),
    defaultPipelineStageId: formString(formData, "defaultPipelineStageId"),
    defaultLeadTypeId: formString(formData, "defaultLeadTypeId"),
    businessPhone: formString(formData, "businessPhone"),
    businessEmail: formString(formData, "businessEmail"),
    businessWebsite: formString(formData, "businessWebsite"),
    businessAddress: formString(formData, "businessAddress"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  const before = await prisma.organizationSettings.findUnique({ where: { id: 1 } });

  const data = {
    organizationName: parsed.data.organizationName,
    defaultCountry: parsed.data.defaultCountry,
    defaultRegion: parsed.data.defaultRegion ?? null,
    defaultTimezone: parsed.data.defaultTimezone,
    defaultCurrency: parsed.data.defaultCurrency,
    defaultDateFormat: parsed.data.defaultDateFormat,
    defaultPipelineStageId: parsed.data.defaultPipelineStageId ?? null,
    defaultLeadTypeId: parsed.data.defaultLeadTypeId ?? null,
    businessPhone: parsed.data.businessPhone ?? null,
    businessEmail: parsed.data.businessEmail ?? null,
    businessWebsite: parsed.data.businessWebsite ?? null,
    businessAddress: parsed.data.businessAddress ?? null,
    updatedById: user.id,
  };

  const after = await prisma.organizationSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "organization",
    action: "organization_settings.updated",
    entityType: "OrganizationSettings",
    entityId: "1",
    beforeData: before ?? undefined,
    afterData: after,
  });

  revalidatePath(PATH);
  revalidatePath("/administration");
}
