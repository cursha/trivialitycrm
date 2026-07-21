"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { formString } from "@/lib/form-data";
import { sendEmail } from "@/lib/comms/send-email";

export type ActionResult = { error?: string } | undefined;

function parseAddressList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((address) => address.trim())
    .filter(Boolean);
}

export async function sendComposedEmail(companyId: string, _prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "send_email");

  const contactId = formString(formData, "contactId").trim() || null;
  const templateId = formString(formData, "templateId").trim() || null;
  const to = parseAddressList(formString(formData, "to"));
  const cc = parseAddressList(formString(formData, "cc"));
  const bcc = parseAddressList(formString(formData, "bcc"));
  const subject = formString(formData, "subject");
  const body = formString(formData, "body");

  const result = await sendEmail({ userId: user.id, companyId, contactId, templateId, to, cc, bcc, subject, body });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/companies/${companyId}`);
}
