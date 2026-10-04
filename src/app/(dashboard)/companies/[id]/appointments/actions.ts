"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { formString } from "@/lib/form-data";
import { createAppointment, updateAppointment, cancelAppointment } from "@/lib/comms/appointments";
import { parseWallClock, isValidTimeZone } from "@/lib/comms/calendar-time";

export type ActionResult = { error?: string } | undefined;
export type ScheduleActionResult = { error?: string; inviteSent?: boolean } | undefined;

const APPOINTMENT_TYPES = ["DEMO", "TRIAL_REVIEW", "FOLLOW_UP"] as const;
type AppointmentTypeValue = (typeof APPOINTMENT_TYPES)[number];

async function requireCompanyAccess(companyId: string) {
  const user = await requireUser();
  requirePermission(user, "manage_calendar_connections");

  const scope = companyScope(user);
  if (!scope) throw new Error("Forbidden: no access to this company");

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) throw new Error("Forbidden: no access to this company");

  return { user, company };
}

function parseAttendeeEmails(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((address) => address.trim())
    .filter(Boolean);
}

export async function scheduleAppointmentAction(companyId: string, _prevState: ActionResult, formData: FormData): Promise<ScheduleActionResult> {
  const { user } = await requireCompanyAccess(companyId);

  const type = formString(formData, "type");
  if (!APPOINTMENT_TYPES.includes(type as AppointmentTypeValue)) return { error: "Choose an appointment type." };

  const title = formString(formData, "title").trim();
  if (!title) return { error: "Enter a title." };

  const contactId = formString(formData, "contactId").trim() || null;
  const timezone = formString(formData, "timezone").trim();
  if (!isValidTimeZone(timezone)) return { error: "Enter a valid timezone (e.g. America/Toronto)." };

  // The form's datetime-local values are wall-clock times in the chosen
  // timezone — never `new Date(value)`, which would read them in the
  // server's own zone.
  const startAt = parseWallClock(formString(formData, "startAt"), timezone);
  const endAt = parseWallClock(formString(formData, "endAt"), timezone);
  if (!startAt || !endAt) {
    return { error: "Enter a valid start and end time." };
  }

  const attendeeEmails = parseAttendeeEmails(formString(formData, "attendeeEmails"));
  const location = formString(formData, "location").trim() || null;
  // An absent checkbox means "don't send" — but the field is only present
  // on forms that offer the choice, so default to sending when the form
  // didn't include it at all.
  const sendInvite = formData.has("sendInviteChoice") ? formData.get("sendInvite") === "on" : true;

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
    location,
    sendInvite,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/companies/${companyId}`);
  return { inviteSent: result.inviteSent };
}

export async function updateAppointmentAction(companyId: string, appointmentId: string, formData: FormData): Promise<ActionResult> {
  await requireCompanyAccess(companyId);

  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, companyId } });
  if (!appointment) return { error: "Appointment not found." };

  // Rescheduled times are wall-clock in the appointment's own timezone.
  const startAtRaw = formString(formData, "startAt");
  const endAtRaw = formString(formData, "endAt");
  const startAt = startAtRaw ? parseWallClock(startAtRaw, appointment.timezone) : undefined;
  const endAt = endAtRaw ? parseWallClock(endAtRaw, appointment.timezone) : undefined;
  if (startAt === null || endAt === null) {
    return { error: "Enter a valid start and end time." };
  }

  const result = await updateAppointment(appointmentId, { startAt, endAt });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/companies/${companyId}`);
}

export async function cancelAppointmentAction(companyId: string, appointmentId: string): Promise<ActionResult> {
  await requireCompanyAccess(companyId);

  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, companyId }, select: { id: true } });
  if (!appointment) return { error: "Appointment not found." };

  const result = await cancelAppointment(appointmentId);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/companies/${companyId}`);
}
