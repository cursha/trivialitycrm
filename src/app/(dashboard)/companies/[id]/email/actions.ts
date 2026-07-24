"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { prisma } from "@/lib/prisma";
import { formString } from "@/lib/form-data";
import { sendEmail, scheduleEmail, cancelScheduledEmail } from "@/lib/comms/send-email";
import type { AuthenticatedUser } from "@/lib/auth/current-user";

export type ActionResult = { error?: string } | undefined;

function parseAddressList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((address) => address.trim())
    .filter(Boolean);
}

/**
 * Module Ten: every sibling company sub-resource action file (contacts,
 * tasks, activities) re-fetches the company through companyScope() before
 * mutating — this file was the one exception, checking only the role-level
 * send_email/schedule_email permission and never that companyId is a
 * company the caller is actually scoped to see. A Salesperson holding
 * send_email (scoped to view_assigned_leads) could send/schedule outbound
 * email against any company by ID, outside their assignment/team. Unlike
 * the shared requireCompanyAccess() helper used elsewhere, this doesn't
 * bake in a fixed permission key — send/schedule already check the correct
 * send_email/schedule_email permission themselves, at different points
 * below, so this only verifies scope.
 */
async function requireCompanyInScope(companyId: string, user: AuthenticatedUser): Promise<void> {
  const scope = companyScope(user);
  if (!scope) {
    throw new Error("Forbidden: no access to this company");
  }
  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope }, select: { id: true } });
  if (!company) {
    throw new Error("Forbidden: no access to this company");
  }
}

export async function sendComposedEmail(companyId: string, _prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await requireCompanyInScope(companyId, user);

  const contactId = formString(formData, "contactId").trim();
  if (!contactId) {
    return { error: "Choose a contact before sending — add one to this company first if none exists yet." };
  }

  const templateId = formString(formData, "templateId").trim() || null;
  const cc = parseAddressList(formString(formData, "cc"));
  const bcc = parseAddressList(formString(formData, "bcc"));
  const subject = formString(formData, "subject");
  const body = formString(formData, "body");
  const sendAtRaw = formString(formData, "sendAt").trim();

  if (sendAtRaw) {
    requirePermission(user, "schedule_email");
    const scheduledFor = new Date(sendAtRaw);
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) {
      return { error: "Choose a future date and time to schedule this email." };
    }

    const result = await scheduleEmail({ userId: user.id, companyId, contactId, templateId, cc, bcc, subject, body, scheduledFor });
    if (!result.ok) return { error: result.error };
    revalidatePath(`/companies/${companyId}`);
    return;
  }

  requirePermission(user, "send_email");
  const result = await sendEmail({ userId: user.id, companyId, contactId, templateId, cc, bcc, subject, body });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/companies/${companyId}`);
}

/** Cancels a not-yet-sent scheduled email. Restricted to the salesperson
 * who scheduled it (or anyone with schedule_email and edit access —
 * mirrors the ownership-aware pattern already used for personal email
 * templates) so one salesperson can't cancel another's pending send. */
export async function cancelComposedScheduledEmail(companyId: string, emailMessageId: string): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "schedule_email");
  await requireCompanyInScope(companyId, user);

  const message = await prisma.emailMessage.findUnique({ where: { id: emailMessageId }, select: { createdById: true, companyId: true } });
  if (!message || message.companyId !== companyId) {
    return { error: "Scheduled email not found." };
  }
  if (message.createdById !== user.id) {
    return { error: "You can only cancel an email you scheduled yourself." };
  }

  await cancelScheduledEmail(emailMessageId);
  revalidatePath(`/companies/${companyId}`);
}
