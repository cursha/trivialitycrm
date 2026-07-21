"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { formString } from "@/lib/form-data";
import { createAppointment, updateAppointment, cancelAppointment } from "@/lib/comms/appointments";

export type ActionResult = { error?: string } | undefined;

const APPOINTMENT_TYPES = ["DEMO", "TRIAL_REVIEW", "FOLLOW_UP"] as const;
type AppointmentTypeValue = (typeof APPOINTMENT_TYPES)[number];

async function requireCompanyAccess(companyId: string) {
  const user = await requireUser();
  requirePermission(user, "manage_calendar_connections");

  const scope = companyScope(user);
  if (!scope) throw new Error("Forbidden: no access to this company");

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) throw new Error("Forbidden: no access to this company");

  return user;
}

/** A plain string can't be trusted as a real IANA zone name until
 * Intl actually accepts it — an invalid zone throws a RangeError we'd
 * otherwise let escape as an unhandled exception deep inside the provider
 * call instead of a clear, immediate form error. */
function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function parseAttendeeEmails(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((address) => address.trim())
    .filter(Boolean);
}

export async function scheduleAppointmentAction(companyId: string, _prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireCompanyAccess(companyId);

  const type = formString(formData, "type");
  if (!APPOINTMENT_TYPES.includes(type as AppointmentTypeValue)) return { error: "Choose an appointment type." };

  const title = formString(formData, "title").trim();
  if (!title) return { error: "Enter a title." };

  const contactId = formString(formData, "contactId").trim() || null;
  const timezone = formString(formData, "timezone").trim();
  if (!isValidTimeZone(timezone)) return { error: "Enter a valid timezone (e.g. America/Toronto)." };

  const startAt = new Date(formString(formData, "startAt"));
  const endAt = new Date(formString(formData, "endAt"));
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { error: "Enter a valid start and end time." };
  }

  const attendeeEmails = parseAttendeeEmails(formString(formData, "attendeeEmails"));

  const result = await createAppointment({
    userId: user.id,
    companyId,
    contactId,
    type: type as AppointmentTypeValue,
    title,
    startAt,
    endAt,
    timezone,
    attendeeEmails,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/companies/${companyId}`);
}

export async function updateAppointmentAction(companyId: string, appointmentId: string, formData: FormData): Promise<ActionResult> {
  await requireCompanyAccess(companyId);

  const startAtRaw = formString(formData, "startAt");
  const endAtRaw = formString(formData, "endAt");
  const startAt = startAtRaw ? new Date(startAtRaw) : undefined;
  const endAt = endAtRaw ? new Date(endAtRaw) : undefined;
  if ((startAt && Number.isNaN(startAt.getTime())) || (endAt && Number.isNaN(endAt.getTime()))) {
    return { error: "Enter a valid start and end time." };
  }

  const result = await updateAppointment(appointmentId, { startAt, endAt });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/companies/${companyId}`);
}

export async function cancelAppointmentAction(companyId: string, appointmentId: string): Promise<ActionResult> {
  await requireCompanyAccess(companyId);

  const result = await cancelAppointment(appointmentId);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/companies/${companyId}`);
}
