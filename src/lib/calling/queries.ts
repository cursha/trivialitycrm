import "server-only";
import { prisma } from "@/lib/prisma";
import { summarizeEntryCounts, nextEntryToOffer } from "./progress";
import { companyScope } from "@/lib/companies/scope";
import { evaluateCompanyEligibility } from "@/lib/sales-lists/eligibility";
import { SALES_LIST_COMPANY_INCLUDE } from "@/lib/sales-lists/queries";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import type { Prisma } from "@/generated/prisma/client";

type ListLike = { id: string; type: "FIXED" | "DYNAMIC" };

/** Every ELIGIBLE company on a CALLING-purpose list, scoped to the caller —
 * the exact set startCallingSession() snapshots into CallingSessionEntry
 * rows. Ineligible companies are silently excluded here (per the spec's
 * "automatically skip ineligible records when starting calls"); the List
 * page is where a user sees *why* a company was excluded, before starting. */
export async function getEligibleCompaniesForCalling(user: AuthenticatedUser, list: ListLike) {
  const scope = companyScope(user);
  if (!scope) return [];

  const membershipWhere: Prisma.CompanyWhereInput =
    list.type === "FIXED" ? { salesListMembers: { some: { listId: list.id } } } : { salesListDynamicMembers: { some: { listId: list.id } } };

  const companies = await prisma.company.findMany({ where: { AND: [scope, membershipWhere] }, include: SALES_LIST_COMPANY_INCLUDE });

  return companies.filter(
    (c) =>
      evaluateCompanyEligibility(
        {
          status: c.status,
          doNotContact: c.doNotContact,
          isExistingCustomer: c.isExistingCustomer,
          phone: c.phone,
          primaryContact: c.primaryContact
            ? {
                status: c.primaryContact.status,
                email: c.primaryContact.email,
                phone: c.primaryContact.phone,
                doNotContact: c.primaryContact.doNotContact,
                unsubscribedAt: c.primaryContact.unsubscribedAt,
              }
            : null,
        },
        "CALLING",
      ).eligible,
  );
}

/** A user's own in-progress (ACTIVE or PAUSED) session, if any — backs the
 * spec's "do not lose progress when the browser closes" / "continue later"
 * requirement: the entry point checks this before offering to start a new
 * session from a list. Personal, not shared — a calling session is one
 * salesperson's own work session, same privacy boundary as Route Plan. */
export async function getActiveSessionForUser(userId: string) {
  return prisma.callingSession.findFirst({
    where: { startedById: userId, status: { in: ["ACTIVE", "PAUSED"] } },
    include: { list: true },
    orderBy: { startedAt: "desc" },
  });
}

/** Only the person who started a session may view/drive it — a calling
 * session is personal work-in-progress, not a shared list. */
export async function getOwnedSession(userId: string, sessionId: string) {
  return prisma.callingSession.findFirst({ where: { id: sessionId, startedById: userId }, include: { list: true } });
}

export async function getSessionEntries(sessionId: string) {
  return prisma.callingSessionEntry.findMany({ where: { sessionId }, orderBy: { position: "asc" } });
}

export async function getNextEntry(sessionId: string) {
  const session = await prisma.callingSession.findUniqueOrThrow({ where: { id: sessionId } });
  const entries = await getSessionEntries(sessionId);
  const next = nextEntryToOffer(entries, session.currentPosition);
  if (!next) return null;
  return prisma.callingSessionEntry.findUniqueOrThrow({ where: { id: next.id } });
}

/** Full detail for the guided call screen: company, its primary + other
 * contacts, recent activities, open follow-ups. */
export async function getEntryCallDetail(entryId: string) {
  const entry = await prisma.callingSessionEntry.findUnique({
    where: { id: entryId },
    include: {
      company: {
        include: {
          leadType: true,
          pipelineStage: true,
          competitor: true,
          primaryContact: true,
          contacts: { where: { status: "ACTIVE" }, orderBy: { lastName: "asc" } },
          activities: { orderBy: { occurredAt: "desc" }, take: 5 },
          tasks: { where: { status: "OPEN" }, orderBy: { dueAt: "asc" } },
        },
      },
      callRecord: { include: { outcome: true } },
    },
  });
  return entry;
}

export async function getSessionProgress(sessionId: string) {
  const entries = await getSessionEntries(sessionId);
  const counts = summarizeEntryCounts(entries);

  const records = await prisma.callRecord.findMany({ where: { sessionId }, include: { outcome: true } });
  const byCategory = { UNREACHABLE: 0, INTERESTED: 0, DEMO_REQUESTED: 0, NOT_INTERESTED: 0 };
  for (const record of records) {
    if (record.outcome.resultCategory) byCategory[record.outcome.resultCategory]++;
  }

  return { ...counts, ...byCategory };
}

export async function getActiveCallOutcomes() {
  return prisma.callOutcome.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, include: { defaultPipelineStage: true } });
}

/** Every entry in a session, in position order, with its company name and
 * — for a COMPLETED entry — the outcome recorded and whether that outcome's
 * skipRestOfSession flag blocks it from ever being reopened. Backs the
 * session overview page's entry list, the one place a salesperson can find
 * their way to a completed entry to fix a note. */
export async function getSessionEntriesForOverview(sessionId: string) {
  const entries = await prisma.callingSessionEntry.findMany({
    where: { sessionId },
    orderBy: { position: "asc" },
    include: { company: { select: { id: true, name: true } }, callRecord: { include: { outcome: true } } },
  });
  return entries.map((entry) => ({
    id: entry.id,
    position: entry.position,
    status: entry.status,
    company: entry.company,
    outcomeName: entry.callRecord?.outcome.name ?? null,
    notes: entry.callRecord?.notes ?? null,
    editable: entry.status === "COMPLETED" && entry.callRecord ? !entry.callRecord.outcome.skipRestOfSession : false,
  }));
}

/** A single COMPLETED entry's editable notes view — the guided call
 * screen's counterpart for revisiting an already-recorded call, per the
 * spec's "revisit a completed entry to fix a note." Returns null if the
 * entry isn't COMPLETED, has no CallRecord, or its outcome's
 * skipRestOfSession flag blocks reopening it. */
export async function getEditableCompletedEntry(sessionId: string, entryId: string) {
  const entry = await prisma.callingSessionEntry.findFirst({
    where: { id: entryId, sessionId, status: "COMPLETED" },
    include: { company: { select: { id: true, name: true } }, callRecord: { include: { outcome: true } } },
  });
  if (!entry?.callRecord || entry.callRecord.outcome.skipRestOfSession) return null;
  return { id: entry.id, company: entry.company, outcomeName: entry.callRecord.outcome.name, notes: entry.callRecord.notes ?? "" };
}
