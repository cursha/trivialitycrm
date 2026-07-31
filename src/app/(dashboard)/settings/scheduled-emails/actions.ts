"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { formString } from "@/lib/form-data";
import { validateOutgoingEmail } from "@/lib/comms/validate";
import { cancelScheduledEmail } from "@/lib/comms/send-email";
import type { AuthenticatedUser } from "@/lib/auth/current-user";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/scheduled-emails";

function parseAddressList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((address) => address.trim())
    .filter(Boolean);
}

/**
 * Same ownership rule as the company-page cancel action
 * (companies/[id]/email/actions.ts's cancelComposedScheduledEmail) —
 * anyone with schedule_email can edit/cancel their own scheduled sends;
 * view_team_communications additionally allows acting on a teammate's
 * (mirrors communications-review's own team-wide visibility gate, the
 * closest existing precedent for "see other people's outbound comms").
 */
async function requireScheduledEmailAccess(user: AuthenticatedUser, emailMessageId: string) {
  requirePermission(user, "schedule_email");
  const message = await prisma.emailMessage.findUnique({ where: { id: emailMessageId } });
  if (!message || message.status !== "SCHEDULED") {
    return { error: "Scheduled email not found." } as const;
  }
  if (message.createdById !== user.id && !hasPermission(user, "view_team_communications")) {
    return { error: "You can only edit or cancel an email you scheduled yourself." } as const;
  }
  return { message } as const;
}

/**
 * Edits subject/body/cc/bcc/scheduledFor on a still-SCHEDULED row.
 * Deliberately does not allow changing the recipient contact or template —
 * that would re-open consent/address resolution this restrained edit form
 * doesn't attempt. The concurrency guard (status: "SCHEDULED" in the
 * WHERE) means a row a worker already claimed silently fails to update
 * here rather than corrupting an in-flight send — same pattern
 * cancelScheduledEmail() already uses. Content is only lightly validated
 * here for immediate feedback; the full gate (consent, quiet hours,
 * unresolved placeholders) always re-runs for real at actual send time
 * (processDueScheduledEmail), same as an unedited scheduled email.
 */
export async function updateScheduledEmail(emailMessageId: string, _prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const access = await requireScheduledEmailAccess(user, emailMessageId);
  if ("error" in access) return access;

  const cc = parseAddressList(formString(formData, "cc"));
  const bcc = parseAddressList(formString(formData, "bcc"));
  const subject = formString(formData, "subject");
  const body = formString(formData, "body");
  const sendAtRaw = formString(formData, "sendAt").trim();

  const scheduledFor = new Date(sendAtRaw);
  if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) {
    return { error: "Choose a future date and time." };
  }

  const recipientValidation = validateOutgoingEmail({ to: access.message.toAddresses, cc, bcc, subject });
  if (!recipientValidation.valid) {
    return { error: recipientValidation.errors.join(" ") };
  }
  // No unsubscribe-placeholder check here — send-email.ts's prepareSend()
  // silently appends a standard unsubscribe footer at actual-send time if
  // one isn't already present, so this edit form doesn't need to block on
  // it too (see that function's doc comment for the full reasoning).

  const updated = await prisma.emailMessage.updateMany({
    where: { id: emailMessageId, status: "SCHEDULED" },
    data: { subject, body, ccAddresses: cc, bccAddresses: bcc, scheduledFor },
  });
  if (updated.count === 0) {
    return { error: "This email is no longer scheduled — it may have just been sent or cancelled." };
  }

  revalidatePath(PATH);
}

export async function cancelScheduledEmailAction(emailMessageId: string): Promise<ActionResult> {
  const user = await requireUser();
  const access = await requireScheduledEmailAccess(user, emailMessageId);
  if ("error" in access) return access;

  await cancelScheduledEmail(emailMessageId);
  revalidatePath(PATH);
}
