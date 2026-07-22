"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, type AuthenticatedUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { evaluateCompanyRule, evaluateContactRule } from "@/lib/data-quality/rules";
import { computeNormalizedFields } from "@/lib/duplicates/match";
import { computeAddressNormalizedFields, computeContactNormalizedFields } from "@/lib/data-quality/normalize";

export type IssueActionResult = { error?: string } | undefined;

const PATH = "/data-quality/issues";

async function requireReviewer(): Promise<AuthenticatedUser> {
  const user = await requireUser();
  requirePermission(user, "review_data_quality");
  return user;
}

export async function setIssueStatus(issueId: string, status: "OPEN" | "DEFERRED" | "IGNORED" | "REOPENED", note?: string): Promise<IssueActionResult> {
  const user = await requireReviewer();

  const existing = await prisma.dataQualityIssue.findUnique({ where: { id: issueId } });
  if (!existing) return { error: "Issue not found." };

  await prisma.dataQualityIssue.update({
    where: { id: issueId },
    data: {
      status,
      notes: note ? note : existing.notes,
      ...(status === "IGNORED" ? { resolvedAt: new Date(), resolvedById: user.id, resolutionAction: "ignored" } : {}),
    },
  });

  await prisma.dataQualityAuditEvent.create({
    data: { action: "ISSUE_STATUS_CHANGED", actorId: user.id, issueId, companyId: existing.companyId, contactId: existing.contactId, beforeData: { status: existing.status } as never, afterData: { status } as never },
  });

  revalidatePath(PATH);
}

export async function assignIssue(issueId: string, assignedToId: string | null): Promise<IssueActionResult> {
  const user = await requireReviewer();
  const existing = await prisma.dataQualityIssue.findUnique({ where: { id: issueId } });
  if (!existing) return { error: "Issue not found." };

  await prisma.dataQualityIssue.update({ where: { id: issueId }, data: { assignedToId } });
  await prisma.dataQualityAuditEvent.create({ data: { action: "ISSUE_ASSIGNED", actorId: user.id, issueId, metadata: { assignedToId } as never } });

  revalidatePath(PATH);
}

/** Bulk assign/defer/ignore only — merges and field corrections stay
 * individually reviewed, per the plan's explicit "must remain individually
 * reviewed" requirement. */
export async function bulkUpdateIssues(issueIds: string[], action: "assign" | "defer" | "ignore", assignedToId?: string | null): Promise<IssueActionResult> {
  const user = await requireReviewer();
  if (issueIds.length === 0) return { error: "No issues selected." };

  const data = action === "assign" ? { assignedToId: assignedToId ?? null } : action === "defer" ? { status: "DEFERRED" as const } : { status: "IGNORED" as const, resolvedAt: new Date(), resolvedById: user.id, resolutionAction: "ignored (bulk)" };

  await prisma.dataQualityIssue.updateMany({ where: { id: { in: issueIds } }, data });
  await prisma.dataQualityAuditEvent.create({ data: { action: "ISSUE_BULK_UPDATED", actorId: user.id, metadata: { issueIds, action, assignedToId } as never } });

  revalidatePath(PATH);
}

const CorrectionSchema = z.object({ value: z.string().trim().max(2000) });

/**
 * Record Correction (Section 10): shows current/suggested, validates,
 * requires confirmation (enforced client-side via window.confirm — same
 * pattern as every other destructive-ish action in this app), records an
 * audit entry, and re-runs the specific rule that flagged the issue to see
 * whether the correction actually resolved it.
 */
export async function correctIssueField(issueId: string, formData: FormData): Promise<IssueActionResult> {
  const user = await requireReviewer();

  const issue = await prisma.dataQualityIssue.findUnique({ where: { id: issueId }, include: { rule: true } });
  if (!issue) return { error: "Issue not found." };

  const parsed = CorrectionSchema.safeParse({ value: formData.get("value") });
  if (!parsed.success) return { error: "Enter a value." };
  const newValue = parsed.data.value || null;

  if (issue.entityType === "COMPANY" && issue.companyId) {
    const company = await prisma.company.findUnique({ where: { id: issue.companyId } });
    if (!company) return { error: "Company not found." };

    const previousValue = (company as unknown as Record<string, unknown>)[issue.field] ?? null;
    const updateData: Record<string, unknown> = { [issue.field]: newValue, updatedById: user.id };
    if (["name", "phone", "email", "websiteUrl"].includes(issue.field)) {
      Object.assign(updateData, computeNormalizedFields({ ...company, [issue.field]: newValue }));
    }
    if (["city", "region", "postalCode", "country"].includes(issue.field)) {
      Object.assign(updateData, computeAddressNormalizedFields({ ...company, [issue.field]: newValue }));
    }
    const updated = await prisma.company.update({ where: { id: issue.companyId }, data: updateData });

    const result = evaluateCompanyRule(issue.rule, updated as never);
    await prisma.dataQualityIssue.update({
      where: { id: issueId },
      data: result.violates ? { description: result.description ?? issue.description } : { status: "RESOLVED", resolvedAt: new Date(), resolvedById: user.id, resolutionAction: "corrected" },
    });

    await prisma.dataQualityAuditEvent.create({
      data: { action: "RECORD_CORRECTED", actorId: user.id, issueId, companyId: issue.companyId, beforeData: { field: issue.field, value: previousValue } as never, afterData: { field: issue.field, value: newValue } as never },
    });
  } else if (issue.entityType === "CONTACT" && issue.contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: issue.contactId } });
    if (!contact) return { error: "Contact not found." };

    const previousValue = (contact as unknown as Record<string, unknown>)[issue.field] ?? null;
    const updateData: Record<string, unknown> = { [issue.field]: newValue };
    if (["firstName", "lastName", "phone", "email"].includes(issue.field)) {
      Object.assign(updateData, computeContactNormalizedFields({ ...contact, [issue.field]: newValue }));
    }
    const updated = await prisma.contact.update({ where: { id: issue.contactId }, data: updateData });

    const result = evaluateContactRule(issue.rule, updated as never);
    await prisma.dataQualityIssue.update({
      where: { id: issueId },
      data: result.violates ? { description: result.description ?? issue.description } : { status: "RESOLVED", resolvedAt: new Date(), resolvedById: user.id, resolutionAction: "corrected" },
    });

    await prisma.dataQualityAuditEvent.create({
      data: { action: "RECORD_CORRECTED", actorId: user.id, issueId, contactId: issue.contactId, beforeData: { field: issue.field, value: previousValue } as never, afterData: { field: issue.field, value: newValue } as never },
    });
  } else {
    return { error: "This issue has no linked record to correct." };
  }

  revalidatePath(PATH);
}
