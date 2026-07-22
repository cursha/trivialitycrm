// Guards and helpers shared by the user-administration actions
// (src/app/(dashboard)/settings/users/actions.ts) — kept in their own
// module rather than inlined so both setUserRole and setUserDisabled (and
// any future admin action) share exactly one definition of "is this the
// last active Administrator."
import "server-only";
import { prisma } from "../prisma";
import { writeAuditEvent, newCorrelationId } from "../audit/log";

// Matches the existing belt-and-suspenders convention in
// src/app/(dashboard)/companies/actions.ts's permanentlyDeleteCompany
// (`user.role.name !== "Administrator"`) — a string-matched role name,
// not a permission-derived check, for consistency with that established
// precedent rather than inventing a second convention.
const ADMINISTRATOR_ROLE_NAME = "Administrator";

export class LastAdministratorError extends Error {}

/**
 * True when `userId` is the only currently-active (non-disabled) user
 * holding the Administrator role — the CRM would otherwise be left with no
 * one able to manage users or roles at all.
 */
export async function isLastActiveAdministrator(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!user || user.role.name !== ADMINISTRATOR_ROLE_NAME || user.disabled) return false;

  const activeAdminCount = await prisma.user.count({
    where: { disabled: false, role: { name: ADMINISTRATOR_ROLE_NAME } },
  });
  return activeAdminCount <= 1;
}

/**
 * Throws (and audits the blocked attempt with success: false) if `userId`
 * is the last active Administrator. Called before a role change or
 * deactivation that would remove that status.
 */
export async function assertNotLastActiveAdministrator(userId: string, actorId: string, action: string): Promise<void> {
  if (await isLastActiveAdministrator(userId)) {
    await writeAuditEvent({
      actorId,
      module: "users",
      action,
      entityType: "User",
      entityId: userId,
      success: false,
      metadata: { reason: "last_active_administrator" },
    });
    throw new LastAdministratorError("This is the last active Administrator — a CRM must always have at least one.");
  }
}

export type OwnershipSummary = { companyCount: number; openTaskCount: number };

/** Live counts of what a user currently owns — shown before deactivation
 * and on the ownership-transfer form, never cached. */
export async function getOwnershipSummary(userId: string): Promise<OwnershipSummary> {
  const [companyCount, openTaskCount] = await Promise.all([
    prisma.company.count({ where: { assignedToId: userId, status: "ACTIVE" } }),
    prisma.task.count({ where: { assignedToId: userId, status: "OPEN" } }),
  ]);
  return { companyCount, openTaskCount };
}

export class OwnershipTransferError extends Error {}

export type TransferOwnershipResult = { companyCount: number; taskCount: number };

/**
 * Reassigns every active company and open task owned by `fromUserId` onto
 * `toUserId`, in one transaction. Deliberately does NOT reuse
 * bulkAssignCompanies (src/app/(dashboard)/companies/bulk-actions.ts) or
 * canAssignTo's team-boundary check — those enforce a *salesperson's own*
 * reassign permission scoped to their team; this is an administrator
 * transferring everything off a departing/deactivated user, which is
 * allowed to cross team boundaries deliberately. Writes one AuditEvent per
 * entity type, sharing a correlationId so both rows are visibly one
 * logical operation in the audit log.
 */
export async function transferOwnership(params: { fromUserId: string; toUserId: string; actorId: string }): Promise<TransferOwnershipResult> {
  const { fromUserId, toUserId, actorId } = params;

  if (fromUserId === toUserId) {
    throw new OwnershipTransferError("Choose a different user to transfer ownership to.");
  }

  const target = await prisma.user.findUnique({ where: { id: toUserId } });
  if (!target) throw new OwnershipTransferError("Target user not found.");
  if (target.disabled) throw new OwnershipTransferError("Cannot transfer ownership to a deactivated user.");

  const correlationId = newCorrelationId();

  const result = await prisma.$transaction(async (tx) => {
    const companies = await tx.company.updateMany({
      where: { assignedToId: fromUserId, status: "ACTIVE" },
      data: { assignedToId: toUserId, updatedById: actorId },
    });
    const tasks = await tx.task.updateMany({
      where: { assignedToId: fromUserId, status: "OPEN" },
      data: { assignedToId: toUserId },
    });
    return { companyCount: companies.count, taskCount: tasks.count };
  });

  await writeAuditEvent({
    actorId,
    module: "ownership",
    action: "ownership.companies_transferred",
    entityType: "User",
    entityId: fromUserId,
    correlationId,
    metadata: { fromUserId, toUserId, companyCount: result.companyCount },
  });
  await writeAuditEvent({
    actorId,
    module: "ownership",
    action: "ownership.tasks_transferred",
    entityType: "User",
    entityId: fromUserId,
    correlationId,
    metadata: { fromUserId, toUserId, taskCount: result.taskCount },
  });

  return result;
}
