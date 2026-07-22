"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { formString } from "@/lib/form-data";
import { stopEnrollmentsForReply } from "@/lib/comms/sequences";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/communications-review";

/**
 * Links an unmatched inbound message to a contact by exact email address —
 * a human confirming what the automatic matcher
 * (src/lib/comms/inbound-sync.ts's matchContactForAddress) couldn't decide
 * on its own (zero or ambiguous matches). Runs the exact same
 * stopEnrollmentsForReply follow-through a successful automatic match
 * would have, so a manually-resolved reply still stops an active sequence.
 */
export async function matchInboundMessageAction(
  emailMessageId: string,
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "view_team_communications");

  const email = formString(formData, "contactEmail").trim();
  if (!email) {
    return { error: "Enter the contact's email address." };
  }

  const message = await prisma.emailMessage.findUnique({ where: { id: emailMessageId } });
  if (!message || message.direction !== "INBOUND" || message.contactId) {
    return { error: "This message is no longer available to review." };
  }

  const matches = await prisma.contact.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, companyId: true },
    take: 2,
  });
  if (matches.length === 0) {
    return { error: "No contact has that email address." };
  }
  if (matches.length > 1) {
    return { error: "More than one contact has that email address — resolve the duplicate contact first." };
  }

  const [contact] = matches;
  await prisma.emailMessage.update({
    where: { id: emailMessageId },
    data: { contactId: contact.id, companyId: contact.companyId, reviewedAt: new Date(), reviewedById: user.id },
  });
  await stopEnrollmentsForReply(contact.id);

  revalidatePath(PATH);
}

/** Marks a message reviewed without linking it to a contact — e.g. spam or
 * a sender genuinely unrelated to any lead. Leaves contactId/companyId
 * null; the message simply drops out of the review queue. */
export async function dismissInboundMessageAction(emailMessageId: string): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "view_team_communications");

  await prisma.emailMessage.updateMany({
    where: { id: emailMessageId, direction: "INBOUND", contactId: null },
    data: { reviewedAt: new Date(), reviewedById: user.id },
  });

  revalidatePath(PATH);
  return undefined;
}
