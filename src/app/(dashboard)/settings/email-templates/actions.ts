"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { formString } from "@/lib/form-data";
import { unknownPlaceholderTokens, hasUnsubscribePlaceholder } from "@/lib/comms/templates";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/email-templates";
const VISIBILITY_VALUES = ["PERSONAL", "SHARED"] as const;
type Visibility = (typeof VISIBILITY_VALUES)[number];

function validateFields(formData: FormData): { error: string } | {
  name: string;
  categoryId: string | null;
  subject: string;
  body: string;
  visibility: Visibility;
  leadTypeId: string | null;
  pipelineStageId: string | null;
  language: string;
  active: boolean;
} {
  const name = formString(formData, "name").trim();
  const categoryId = formString(formData, "categoryId").trim();
  const subject = formString(formData, "subject").trim();
  const body = formString(formData, "body").trim();
  const visibility = formString(formData, "visibility");
  const leadTypeId = formString(formData, "leadTypeId").trim();
  const pipelineStageId = formString(formData, "pipelineStageId").trim();
  const language = formString(formData, "language").trim() || "en";

  if (!name) return { error: "Enter a template name." };
  if (!subject) return { error: "Enter a subject." };
  if (!body) return { error: "Enter a body." };
  if (!VISIBILITY_VALUES.includes(visibility as Visibility)) return { error: "Choose a visibility." };

  const unknownTokens = [...unknownPlaceholderTokens(subject), ...unknownPlaceholderTokens(body)];
  if (unknownTokens.length > 0) {
    return { error: `Unknown placeholder(s): ${[...new Set(unknownTokens)].map((t) => `{{${t}}}`).join(", ")}` };
  }

  // CAN-SPAM requires a working unsubscribe mechanism in every commercial
  // email — a template cannot be saved without this placeholder, so it can
  // never be silently omitted from a send that uses it.
  if (!hasUnsubscribePlaceholder(body)) {
    return { error: "The body must include the {{unsubscribeLink}} placeholder." };
  }

  return {
    name,
    categoryId: categoryId || null,
    subject,
    body,
    visibility: visibility as Visibility,
    leadTypeId: leadTypeId || null,
    pipelineStageId: pipelineStageId || null,
    language,
    active: formString(formData, "active") === "on",
  };
}

export async function requireEditAccess(templateId: string): Promise<{ user: AuthenticatedUser; ownerId: string | null; visibility: Visibility }> {
  const user = await requireUser();
  const template = await prisma.emailTemplate.findUniqueOrThrow({
    where: { id: templateId },
    select: { ownerId: true, visibility: true },
  });

  if (template.visibility === "SHARED") {
    requirePermission(user, "manage_shared_templates");
  } else {
    requirePermission(user, "manage_personal_templates");
    if (template.ownerId !== user.id && !hasPermission(user, "manage_shared_templates")) {
      throw new Error("You can only manage your own personal templates.");
    }
  }

  return { user, ownerId: template.ownerId, visibility: template.visibility };
}

export async function createEmailTemplate(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = validateFields(formData);
  if ("error" in parsed) return parsed;

  if (parsed.visibility === "SHARED") {
    requirePermission(user, "manage_shared_templates");
  } else {
    requirePermission(user, "manage_personal_templates");
  }

  await prisma.emailTemplate.create({
    data: {
      name: parsed.name,
      categoryId: parsed.categoryId,
      subject: parsed.subject,
      body: parsed.body,
      visibility: parsed.visibility,
      ownerId: parsed.visibility === "PERSONAL" ? user.id : null,
      leadTypeId: parsed.leadTypeId,
      pipelineStageId: parsed.pipelineStageId,
      language: parsed.language,
      active: parsed.active,
      createdById: user.id,
    },
  });

  revalidatePath(PATH);
}

export async function updateEmailTemplate(id: string, _prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user } = await requireEditAccess(id);
  const parsed = validateFields(formData);
  if ("error" in parsed) return parsed;

  await prisma.emailTemplate.update({
    where: { id },
    data: {
      name: parsed.name,
      categoryId: parsed.categoryId,
      subject: parsed.subject,
      body: parsed.body,
      leadTypeId: parsed.leadTypeId,
      pipelineStageId: parsed.pipelineStageId,
      language: parsed.language,
      active: parsed.active,
      updatedById: user.id,
    },
  });

  revalidatePath(PATH);
}

export async function setEmailTemplateActive(id: string, active: boolean): Promise<void> {
  const { user } = await requireEditAccess(id);
  await prisma.emailTemplate.update({ where: { id }, data: { active, updatedById: user.id } });
  revalidatePath(PATH);
}

export async function deleteEmailTemplate(id: string): Promise<void> {
  await requireEditAccess(id);
  await prisma.emailTemplate.delete({ where: { id } });
  revalidatePath(PATH);
}

/**
 * Clones a template (and its links) into a new PERSONAL template owned
 * by the current user, regardless of the source's own visibility or
 * owner — anyone who can see a template on this page already has
 * manage_personal_templates (the page-level gate), so duplicating only
 * needs read access to the source, not edit access to it. Starts
 * inactive so a not-yet-reviewed copy can't be picked up by a send
 * before it's checked over and renamed.
 */
export async function duplicateEmailTemplate(id: string): Promise<void> {
  const user = await requireUser();
  requirePermission(user, "manage_personal_templates");

  const [source, links] = await Promise.all([
    prisma.emailTemplate.findUniqueOrThrow({ where: { id } }),
    prisma.emailTemplateLink.findMany({ where: { emailTemplateId: id }, orderBy: { sortOrder: "asc" } }),
  ]);

  const copy = await prisma.emailTemplate.create({
    data: {
      name: `Copy of ${source.name}`,
      categoryId: source.categoryId,
      subject: source.subject,
      body: source.body,
      visibility: "PERSONAL",
      ownerId: user.id,
      leadTypeId: source.leadTypeId,
      pipelineStageId: source.pipelineStageId,
      language: source.language,
      active: false,
      createdById: user.id,
      links: { create: links.map((link) => ({ label: link.label, url: link.url, sortOrder: link.sortOrder })) },
    },
  });

  revalidatePath(PATH);
  redirect(`${PATH}/${copy.id}/edit`);
}

/**
 * Standard template "attachments" — a label + an external URL (Google
 * Drive/OneDrive/Sync/etc.), not a real uploaded file; see
 * EmailTemplateLink's own doc comment for why. Same edit-access gate as
 * every other template mutation.
 */
export async function addEmailTemplateLink(templateId: string, _prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireEditAccess(templateId);

  const label = formString(formData, "label").trim();
  const url = formString(formData, "url").trim();
  if (!label) return { error: "Enter a label for this link." };
  if (!url) return { error: "Enter a URL for this link." };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Enter a valid URL (including https://)." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Only http:// and https:// links are supported." };
  }

  const highest = await prisma.emailTemplateLink.aggregate({ where: { emailTemplateId: templateId }, _max: { sortOrder: true } });
  await prisma.emailTemplateLink.create({
    data: { emailTemplateId: templateId, label, url, sortOrder: (highest._max.sortOrder ?? -1) + 1 },
  });

  revalidatePath(`${PATH}/${templateId}/edit`);
}

export async function removeEmailTemplateLink(templateId: string, linkId: string): Promise<void> {
  await requireEditAccess(templateId);
  await prisma.emailTemplateLink.deleteMany({ where: { id: linkId, emailTemplateId: templateId } });
  revalidatePath(`${PATH}/${templateId}/edit`);
}
