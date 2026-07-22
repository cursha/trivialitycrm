// Safe, transactional contact merge — same shape as merge-company.ts,
// scoped to same-company contacts only (plan Conflict #6: a cross-company
// merge doesn't specify which company should win, so it's blocked with a
// clear message rather than inventing a company-choice UI). Activity/Task
// are NOT reassigned here (plan Conflict #1) — neither model has a
// contactId at all, so there is nothing keyed to Contact to move; they
// stay on whichever company they already belong to.
import "server-only";
import { z } from "zod";
import { prisma } from "../prisma";
import type { Prisma } from "../../generated/prisma/client";
import { resolveConsentConflict } from "./consent-conflict";

export const MERGEABLE_CONTACT_FIELDS = ["firstName", "lastName", "title", "phone", "email"] as const;
export type MergeableContactField = (typeof MERGEABLE_CONTACT_FIELDS)[number];

export const ContactFieldDecisionsSchema = z.partialRecord(z.enum(MERGEABLE_CONTACT_FIELDS), z.union([z.string(), z.null()]));
export type ContactFieldDecisions = z.infer<typeof ContactFieldDecisionsSchema>;

export type ContactMergeParams = {
  survivingContactId: string;
  mergedContactId: string;
  fieldDecisions: ContactFieldDecisions;
  actorId: string;
  potentialDuplicateId?: string;
};

export class ContactMergeError extends Error {}

export async function resolveSurvivingContactId(contactId: string, maxHops = 10): Promise<string> {
  let currentId = contactId;
  for (let hop = 0; hop < maxHops; hop++) {
    const contact = await prisma.contact.findUnique({ where: { id: currentId }, select: { mergedIntoId: true } });
    if (!contact || !contact.mergedIntoId) return currentId;
    currentId = contact.mergedIntoId;
  }
  return currentId;
}

export async function mergeContacts(params: ContactMergeParams): Promise<void> {
  const { survivingContactId, mergedContactId, fieldDecisions, actorId, potentialDuplicateId } = params;

  if (survivingContactId === mergedContactId) {
    throw new ContactMergeError("A contact cannot be merged into itself.");
  }

  await prisma.$transaction(async (tx) => {
    const [surviving, merged] = await Promise.all([
      tx.contact.findUnique({ where: { id: survivingContactId } }),
      tx.contact.findUnique({ where: { id: mergedContactId } }),
    ]);

    if (!surviving) throw new ContactMergeError("Surviving contact not found.");
    if (!merged) throw new ContactMergeError("Contact to merge not found.");
    if (surviving.status === "MERGED") {
      throw new ContactMergeError("The surviving contact has itself already been merged into another contact — pick its current survivor instead.");
    }
    if (merged.status === "MERGED") {
      throw new ContactMergeError("This contact has already been merged into another contact.");
    }
    if (surviving.companyId !== merged.companyId) {
      throw new ContactMergeError(
        "These contacts belong to different companies. Merge the companies first (which moves every contact onto one company), then merge the contacts.",
      );
    }

    const beforeData = { surviving, merged };

    // --- Reassign contact-linked FKs (see this file's header comment for
    // why Activity/Task are NOT here) ---------------------------------
    await tx.emailMessage.updateMany({ where: { contactId: mergedContactId }, data: { contactId: survivingContactId } });
    await tx.appointment.updateMany({ where: { contactId: mergedContactId }, data: { contactId: survivingContactId } });
    await tx.consentRecord.updateMany({ where: { contactId: mergedContactId }, data: { contactId: survivingContactId } });
    await tx.sequenceEnrollment.updateMany({ where: { contactId: mergedContactId }, data: { contactId: survivingContactId } });

    // Same same-sequence dedup guard as mergeCompanies (Conflict #3) —
    // SequenceEnrollment has no DB-level unique constraint per
    // (contact, sequence).
    const survivorEnrollments = await tx.sequenceEnrollment.findMany({
      where: { contactId: survivingContactId, status: { in: ["ACTIVE", "PAUSED"] } },
      orderBy: { enrolledAt: "desc" },
    });
    const seenSequenceIds = new Set<string>();
    for (const enrollment of survivorEnrollments) {
      if (seenSequenceIds.has(enrollment.sequenceId)) {
        await tx.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "CANCELLED", stoppedAt: new Date(), stopReason: "Superseded by contact merge." },
        });
      } else {
        seenSequenceIds.add(enrollment.sequenceId);
      }
    }

    // --- Consent conflict: always most-restrictive, no override (confirmed
    // decision) ------------------------------------------------------
    const resolvedConsent = resolveConsentConflict(
      { emailPermitted: surviving.emailPermitted, doNotContact: surviving.doNotContact, unsubscribedAt: surviving.unsubscribedAt, unsubscribeSource: surviving.unsubscribeSource },
      { emailPermitted: merged.emailPermitted, doNotContact: merged.doNotContact, unsubscribedAt: merged.unsubscribedAt, unsubscribeSource: merged.unsubscribeSource },
    );

    const updateData: Record<string, unknown> = { ...resolvedConsent };
    for (const [field, value] of Object.entries(fieldDecisions)) {
      updateData[field] = value;
    }

    const updatedSurvivor = await tx.contact.update({ where: { id: survivingContactId }, data: updateData });

    const tombstoned = await tx.contact.update({
      where: { id: mergedContactId },
      data: { status: "MERGED", mergedIntoId: survivingContactId, mergedAt: new Date(), mergedById: actorId },
    });

    await tx.dataQualityAuditEvent.create({
      data: {
        action: "CONTACT_MERGED",
        actorId,
        contactId: survivingContactId,
        potentialDuplicateId: potentialDuplicateId ?? null,
        beforeData: beforeData as unknown as Prisma.InputJsonValue,
        afterData: { surviving: updatedSurvivor, merged: tombstoned } as unknown as Prisma.InputJsonValue,
        metadata: { fieldDecisions, resolvedConsent } as unknown as Prisma.InputJsonValue,
      },
    });

    if (potentialDuplicateId) {
      await tx.potentialDuplicate.update({
        where: { id: potentialDuplicateId },
        data: { status: "MERGED", reviewedAt: new Date(), reviewedById: actorId },
      });
    }
  });
}
