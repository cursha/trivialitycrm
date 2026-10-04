// No `import "server-only"` — matches every other comms module the worker
// may eventually need (e.g. a future reminder tick), same reasoning as
// token-crypto.ts.
import { prisma } from "@/lib/prisma";
import type { AppointmentType } from "@/generated/prisma/client";
import { getUsableAccessToken } from "@/lib/comms/connections";
import { getEmailProvider } from "@/lib/comms/providers/factory";
import { providerSlugFromKind } from "@/lib/comms/provider-kind";

export type AppointmentOutcome = { ok: true; appointmentId: string } | { ok: false; error: string };

/** createAppointment's result additionally says whether a calendar event /
 * invite actually went out — false for a CRM-only appointment (no mailbox
 * connected, or the caller chose not to send one). */
export type CreateAppointmentOutcome = { ok: true; appointmentId: string; inviteSent: boolean } | { ok: false; error: string };

export type CreateAppointmentParams = {
  userId: string;
  companyId: string;
  contactId?: string | null;
  type: AppointmentType;
  title: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  attendeeEmails: string[];
  location?: string | null;
  /** Defaults true. False saves a CRM-only appointment and never touches
   * the mailbox/calendar, even if one is connected. */
  sendInvite?: boolean;
};

async function organizerName(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? null;
}

/**
 * Creates the Appointment row first (so a provider failure still leaves an
 * auditable record, same as sendEmail()'s QUEUED-then-finalize pattern),
 * then attempts the real calendar event. `providerEventId` stays null and
 * `status` becomes `ERROR` if the provider call fails — never claim a real
 * event exists when it doesn't.
 */
export async function createAppointment(params: CreateAppointmentParams): Promise<CreateAppointmentOutcome> {
  if (params.endAt.getTime() <= params.startAt.getTime()) {
    return { ok: false, error: "End time must be after the start time." };
  }

  const connection = await prisma.providerConnection.findUnique({ where: { userId: params.userId } });
  const wantsInvite = params.sendInvite ?? true;

  // The CRM itself is the system of record for the schedule — an
  // appointment is saved even with no mailbox connected (or when the caller
  // opts out of an invite); it just has no linked calendar event. The
  // mailbox is only needed to put it on someone's calendar.
  if (!wantsInvite || !connection || connection.status !== "CONNECTED") {
    const appointment = await prisma.appointment.create({
      data: {
        companyId: params.companyId,
        contactId: params.contactId ?? null,
        type: params.type,
        title: params.title,
        startAt: params.startAt,
        endAt: params.endAt,
        timezone: params.timezone,
        location: params.location ?? null,
        attendeeEmails: params.attendeeEmails,
        status: "SCHEDULED",
        createdById: params.userId,
      },
    });
    return { ok: true, appointmentId: appointment.id, inviteSent: false };
  }

  const appointment = await prisma.appointment.create({
    data: {
      companyId: params.companyId,
      contactId: params.contactId ?? null,
      type: params.type,
      title: params.title,
      startAt: params.startAt,
      endAt: params.endAt,
      timezone: params.timezone,
      location: params.location ?? null,
      attendeeEmails: params.attendeeEmails,
      providerConnectionId: connection.id,
      status: "SCHEDULED",
      createdById: params.userId,
    },
  });

  try {
    const account = await getUsableAccessToken(params.userId);
    const provider = getEmailProvider(providerSlugFromKind(connection.provider));
    const result = await provider.createCalendarEvent(account, {
      title: params.title,
      startAt: params.startAt,
      endAt: params.endAt,
      timezone: params.timezone,
      attendeeEmails: params.attendeeEmails,
      location: params.location ?? null,
      organizerName: await organizerName(params.userId),
    });
    await prisma.appointment.update({ where: { id: appointment.id }, data: { providerEventId: result.providerEventId } });
    return { ok: true, appointmentId: appointment.id, inviteSent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create the calendar event.";
    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "ERROR", lastError: message } });
    return { ok: false, error: message };
  }
}

export type UpdateAppointmentParams = {
  title?: string;
  startAt?: Date;
  endAt?: Date;
  timezone?: string;
  attendeeEmails?: string[];
};

/**
 * Update and cancel both call through the *original creator's* connected
 * account (`connection.userId`, read from the stored Appointment row) —
 * never the acting session user's — because the real calendar event lives
 * on whichever mailbox actually created it, regardless of who clicks
 * "update"/"cancel" in the UI. Permission/ownership checks belong in the
 * caller (the server action), not here.
 */
export async function updateAppointment(appointmentId: string, params: UpdateAppointmentParams): Promise<AppointmentOutcome> {
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  const merged = {
    title: params.title ?? appointment.title,
    startAt: params.startAt ?? appointment.startAt,
    endAt: params.endAt ?? appointment.endAt,
    timezone: params.timezone ?? appointment.timezone,
    attendeeEmails: params.attendeeEmails ?? appointment.attendeeEmails,
  };
  if (merged.endAt.getTime() <= merged.startAt.getTime()) {
    return { ok: false, error: "End time must be after the start time." };
  }
  // A CRM-only appointment (never had a calendar event) is simply
  // rescheduled in place — there's nothing remote to keep in sync.
  if (!appointment.providerConnectionId || !appointment.providerEventId) {
    await prisma.appointment.update({ where: { id: appointmentId }, data: { ...merged, status: "UPDATED", lastError: null } });
    return { ok: true, appointmentId };
  }

  const connection = await prisma.providerConnection.findUnique({ where: { id: appointment.providerConnectionId } });
  if (!connection || connection.status !== "CONNECTED") {
    return { ok: false, error: "Reconnect the mailbox this appointment was created with before updating it." };
  }

  try {
    const account = await getUsableAccessToken(connection.userId);
    const provider = getEmailProvider(providerSlugFromKind(connection.provider));
    await provider.updateCalendarEvent(account, appointment.providerEventId, {
      ...merged,
      location: appointment.location,
      organizerName: await organizerName(connection.userId),
    });
    await prisma.appointment.update({ where: { id: appointmentId }, data: { ...merged, status: "UPDATED", lastError: null } });
    return { ok: true, appointmentId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update the calendar event.";
    await prisma.appointment.update({ where: { id: appointmentId }, data: { status: "ERROR", lastError: message } });
    return { ok: false, error: message };
  }
}

/** Idempotent — cancelling an already-cancelled appointment is a no-op,
 * not an error. If the appointment never had (or has lost) its provider
 * link, there's nothing left to cancel remotely — mark it cancelled
 * locally rather than getting stuck. A real provider failure leaves the
 * appointment in `ERROR` rather than falsely claiming it was cancelled. */
export async function cancelAppointment(appointmentId: string): Promise<AppointmentOutcome> {
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  if (appointment.status === "CANCELLED") return { ok: true, appointmentId };

  if (!appointment.providerConnectionId || !appointment.providerEventId) {
    await prisma.appointment.update({ where: { id: appointmentId }, data: { status: "CANCELLED" } });
    return { ok: true, appointmentId };
  }

  const connection = await prisma.providerConnection.findUnique({ where: { id: appointment.providerConnectionId } });
  if (!connection || connection.status !== "CONNECTED") {
    return { ok: false, error: "Reconnect the mailbox this appointment was created with before cancelling it." };
  }

  try {
    const account = await getUsableAccessToken(connection.userId);
    const provider = getEmailProvider(providerSlugFromKind(connection.provider));
    await provider.cancelCalendarEvent(account, appointment.providerEventId, {
      title: appointment.title,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      timezone: appointment.timezone,
      attendeeEmails: appointment.attendeeEmails,
      location: appointment.location,
      organizerName: await organizerName(connection.userId),
    });
    await prisma.appointment.update({ where: { id: appointmentId }, data: { status: "CANCELLED", lastError: null } });
    return { ok: true, appointmentId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel the calendar event.";
    await prisma.appointment.update({ where: { id: appointmentId }, data: { status: "ERROR", lastError: message } });
    return { ok: false, error: message };
  }
}
