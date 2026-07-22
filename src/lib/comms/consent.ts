import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/comms/unsubscribe-token";
import { resolveSurvivingContactId } from "@/lib/data-quality/merge-contact";

// No `import "server-only"` — reachable from the public, unauthenticated
// /unsubscribe route as well as authenticated Server Actions, and
// eventually the Phase C sequence-step runner's stop-condition check.

export type ConsentType = "EXPRESS" | "IMPLIED" | "WITHDRAWN";

export type RecordConsentParams = {
  contactId: string;
  type: ConsentType;
  source: string;
  note?: string | null;
  recordedById?: string | null;
};

/**
 * Writes an append-only ConsentRecord, then updates Contact's denormalized
 * "current state" fields from it — the same read/write split Module One
 * established for HistoricalScoreRecord/Company.currentHistoricalScoreId.
 * A WITHDRAWN record always flips doNotContact on; EXPRESS/IMPLIED grants
 * permission and clears doNotContact (a fresh opt-in overrides a prior
 * withdrawal — the latest record is what governs current state).
 */
export async function recordConsent(params: RecordConsentParams): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.consentRecord.create({
      data: {
        contactId: params.contactId,
        type: params.type,
        source: params.source,
        note: params.note ?? null,
        recordedById: params.recordedById ?? null,
      },
    });

    if (params.type === "WITHDRAWN") {
      await tx.contact.update({
        where: { id: params.contactId },
        data: { emailPermitted: false, doNotContact: true, unsubscribedAt: new Date(), unsubscribeSource: params.source },
      });
    } else {
      await tx.contact.update({
        where: { id: params.contactId },
        data: { emailPermitted: true, doNotContact: false },
      });
    }
  });
}

export type UnsubscribeOutcome = { ok: true; contactId: string } | { ok: false; error: string };

/**
 * The one-click, no-login unsubscribe action behind the public
 * /unsubscribe route. `recordedById` is deliberately omitted (left null) —
 * no user performed this action, the contact did. Idempotent: a link
 * followed twice (browser prefetch, a bot re-fetching it, the contact
 * clicking again) never writes a second WITHDRAWN record — it's a safe
 * no-op once the contact is already suppressed.
 */
export async function unsubscribeByToken(token: string): Promise<UnsubscribeOutcome> {
  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return { ok: false, error: "This unsubscribe link is invalid or has expired." };
  }

  const rawContact = await prisma.contact.findUnique({ where: { id: verified.contactId }, select: { id: true, doNotContact: true, status: true } });
  if (!rawContact) {
    return { ok: false, error: "This unsubscribe link is invalid or has expired." };
  }

  // Module Seven: a since-merged contact's own row is a tombstone — the
  // person it represents is now the surviving contact, so their intent
  // ("stop emailing me") must apply there, not to a row nothing sends to
  // anymore. Never let a merge accidentally revive contactability for
  // someone who unsubscribed.
  const contact =
    rawContact.status === "MERGED"
      ? await prisma.contact.findUniqueOrThrow({ where: { id: await resolveSurvivingContactId(rawContact.id) }, select: { id: true, doNotContact: true } })
      : rawContact;

  if (!contact.doNotContact) {
    await recordConsent({ contactId: contact.id, type: "WITHDRAWN", source: "unsubscribe_link" });
  }
  return { ok: true, contactId: contact.id };
}
