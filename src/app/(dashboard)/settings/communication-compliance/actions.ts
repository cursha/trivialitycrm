"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { formString } from "@/lib/form-data";
import { recordConsent } from "@/lib/comms/consent";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/communication-compliance";
const CONSENT_TYPES = ["EXPRESS", "IMPLIED", "WITHDRAWN"] as const;
type ConsentTypeValue = (typeof CONSENT_TYPES)[number];

export async function recordContactConsentAction(contactId: string, _prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "manage_communication_compliance");

  const type = formString(formData, "type");
  const source = formString(formData, "source").trim();
  const note = formString(formData, "note").trim();

  if (!CONSENT_TYPES.includes(type as ConsentTypeValue)) {
    return { error: "Choose a consent type." };
  }
  if (!source) {
    return { error: "Enter a source — how was this consent obtained (e.g. verbal at trade show, signed form, reply email)?" };
  }

  await recordConsent({ contactId, type: type as ConsentTypeValue, source, note: note || null, recordedById: user.id });

  revalidatePath(PATH);
  revalidatePath("/companies", "layout");
}
