"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { ActivitySchema } from "@/lib/validation/activity";
import { VisitSchema } from "@/lib/validation/visit";
import { formString } from "@/lib/form-data";
import { applyOutcomeEffects } from "@/lib/companies/outcome-effects";
import { createAppointment } from "@/lib/comms/appointments";
import { isValidTimeZone, parseWallClock } from "@/lib/comms/calendar-time";
import { formatRouteAddress } from "@/lib/route-plan/validation";

export type ActivityActionResult = { error?: string } | undefined;

export async function createActivity(
  companyId: string,
  _prevState: ActivityActionResult,
  formData: FormData,
): Promise<ActivityActionResult> {
  const user = await requireUser();
  requirePermission(user, "edit_leads");

  const scope = companyScope(user);
  if (!scope) {
    return { error: "You do not have access to this company." };
  }

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) {
    return { error: "You do not have access to this company." };
  }

  const parsed = ActivitySchema.safeParse({
    type: formString(formData, "type"),
    occurredAt: formString(formData, "occurredAt"),
    notes: formString(formData, "notes"),
    outcome: formString(formData, "outcome"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  await prisma.activity.create({
    data: {
      companyId,
      userId: user.id,
      type: parsed.data.type,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined,
      notes: parsed.data.notes ?? null,
      outcome: parsed.data.outcome ?? null,
    },
  });

  revalidatePath(`/companies/${companyId}`);
}

export type LogVisitResult = { error: string } | { ok: true; demoBooked: boolean; inviteSent: boolean; warning?: string };

/**
 * Logs an in-person visit (a VISIT activity with a structured outcome) and
 * applies the outcome's configured effects — the same follow-up / stage /
 * do-not-contact behavior a calling-session call gets (see
 * applyOutcomeEffects). Optionally records bar intel learned at the door,
 * and books the demo appointment when the outcome is a "books demo" one.
 *
 * Bar intel from this form only ever fills in or overwrites with a
 * non-blank value — a blank field never clears what's already on file
 * (that's what the company page's Bar intel card is for), so a rep in a
 * hurry can't wipe data by skipping the optional fields.
 *
 * The visit, its follow-up and stage change commit together in one
 * transaction. The demo appointment is created after that commit (it may
 * send an invite over the network), so a problem with the appointment is
 * reported as a warning on an already-logged visit, never by losing the
 * visit itself.
 */
export async function logVisit(companyId: string, formData: FormData): Promise<LogVisitResult> {
  const user = await requireUser();
  requirePermission(user, "edit_leads");

  const scope = companyScope(user);
  if (!scope) return { error: "You do not have access to this company." };
  const company = await prisma.company.findFirst({ where: { id: companyId, status: "ACTIVE", ...scope } });
  if (!company) return { error: "You do not have access to this company." };

  const parsed = VisitSchema.safeParse({
    outcomeId: formString(formData, "outcomeId"),
    notes: formString(formData, "notes"),
    rejectionReasonId: formString(formData, "rejectionReasonId"),
    timezone: formString(formData, "timezone"),
    occurredAt: formString(formData, "occurredAt"),
    slowNight: formString(formData, "slowNight"),
    slowNightHeadcount: formString(formData, "slowNightHeadcount"),
    currentEntertainment: formString(formData, "currentEntertainment"),
    demoStartAt: formString(formData, "demoStartAt"),
    demoDurationMinutes: formString(formData, "demoDurationMinutes"),
    demoContactId: formString(formData, "demoContactId"),
    sendInvite: formString(formData, "sendInvite"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }
  const input = parsed.data;
  if (!isValidTimeZone(input.timezone)) return { error: "Your browser reported an invalid timezone — reload the page and try again." };

  const outcome = await prisma.callOutcome.findFirst({ where: { id: input.outcomeId, active: true, appliesToVisits: true } });
  if (!outcome) return { error: "Choose a valid visit outcome." };
  if (outcome.requiresNotes && !input.notes) return { error: "Notes are required for this outcome." };
  if (outcome.requiresRejectionReason) {
    if (!input.rejectionReasonId) return { error: "Choose a reason for this outcome." };
    const reason = await prisma.rejectionReason.findFirst({ where: { id: input.rejectionReasonId, active: true } });
    if (!reason) return { error: "Choose a valid reason for this outcome." };
  }

  let occurredAt: Date | undefined;
  if (input.occurredAt) {
    const parsedAt = parseWallClock(input.occurredAt, input.timezone);
    if (!parsedAt) return { error: "Enter a valid visit date and time." };
    occurredAt = parsedAt;
  }

  // Everything the demo needs is validated up front, before anything is
  // written, so a bad demo time can't leave a half-logged visit behind.
  let demo: { startAt: Date; endAt: Date; contactId: string | null; attendeeEmails: string[] } | null = null;
  if (outcome.booksDemo) {
    if (!hasPermission(user, "manage_calendar_connections")) {
      return { error: "You don't have permission to book appointments — ask an administrator, or choose a different outcome." };
    }
    if (!input.demoStartAt) return { error: "Enter the demo date and time." };
    const startAt = parseWallClock(input.demoStartAt, input.timezone);
    if (!startAt) return { error: "Enter a valid demo date and time." };

    let contactId: string | null = null;
    const attendeeEmails: string[] = [];
    if (input.demoContactId) {
      const contact = await prisma.contact.findFirst({ where: { id: input.demoContactId, companyId, status: "ACTIVE" } });
      if (!contact) return { error: "Choose a contact from this company for the demo." };
      contactId = contact.id;
      if (input.sendInvite && contact.email && !contact.doNotContact && !company.doNotContact) attendeeEmails.push(contact.email);
    }
    demo = { startAt, endAt: new Date(startAt.getTime() + input.demoDurationMinutes * 60 * 1000), contactId, attendeeEmails };
  }

  const intel = {
    ...(input.slowNight ? { slowNight: input.slowNight } : {}),
    ...(input.slowNightHeadcount !== undefined ? { slowNightHeadcount: input.slowNightHeadcount } : {}),
    ...(input.currentEntertainment ? { currentEntertainment: input.currentEntertainment } : {}),
  };

  await prisma.$transaction(async (tx) => {
    await tx.activity.create({
      data: {
        companyId,
        userId: user.id,
        type: "VISIT",
        occurredAt,
        outcome: outcome.name,
        callOutcomeId: outcome.id,
        notes: input.notes ?? null,
      },
    });

    await applyOutcomeEffects(tx, {
      company,
      userId: user.id,
      outcome,
      canChangeStage: true,
      rejectionReasonId: input.rejectionReasonId ?? null,
    });

    if (Object.keys(intel).length > 0) {
      await tx.company.update({ where: { id: companyId }, data: { ...intel, updatedById: user.id } });
    }
  });

  let result: LogVisitResult = { ok: true, demoBooked: false, inviteSent: false };
  if (demo) {
    const appointment = await createAppointment({
      userId: user.id,
      companyId,
      contactId: demo.contactId,
      type: "DEMO",
      title: `Triviality demo: ${company.name}`,
      startAt: demo.startAt,
      endAt: demo.endAt,
      timezone: input.timezone,
      location: formatRouteAddress(company) || null,
      attendeeEmails: demo.attendeeEmails,
      sendInvite: input.sendInvite,
    });
    result = appointment.ok
      ? { ok: true, demoBooked: true, inviteSent: appointment.inviteSent }
      : {
          ok: true,
          demoBooked: false,
          inviteSent: false,
          warning: `Visit logged, but the demo appointment had a problem: ${appointment.error} Check the Appointments panel.`,
        };
  }

  revalidatePath(`/companies/${companyId}`);
  return result;
}
